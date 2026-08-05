// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a CodeN Evolution session LOOKS LIKE, in one place, for both shells.
//
// Phase 2 of `MASTER_PROJECT/17_CODEN_EVOLUTION_PIANO_DI_LAVORO.md`. Measured before writing
// it: exactly ONE transcript structure existed, inside `tools/tui-fullscreen.mjs`, and the
// browser had none at all — it had a workbench of twenty-five panels. So this is not two
// models being merged. It is the one model moving to where both shells can read it, BEFORE the
// browser is built on it (phase 3), because the alternative is a second model written by hand
// and a repeat of the drift phase 1 just repaired.
//
// It lives beside `agent-commands.js` for the same reason that file does: it is the only
// location both shells already import from — the browser over HTTP, the terminal over a
// relative path. A copy in `tools/` would be a second copy, which is the thing being removed.
//
// # The seam
//
// **This module decides WHAT. The shell does the I/O.** Nothing here opens a socket, issues a
// fetch, touches a DOM or writes to a terminal. `planTurn()` takes what the user typed and
// returns the intent; the caller performs it with whatever transport it owns and reports the
// outcome back through `say()`. That is what makes one model serve a socket and a browser
// without either of them being able to bend it.
//
// # What is deliberately NOT here
//
// `tools/tui-screen.mjs` stays where it is. It renders character rows clipped to a width,
// which is correct for a TTY and would be throwing away the medium in a browser. The shells
// share the STATE, not the pixels — `16` §4b.2.

/** How each command turns into an engine call. The method names come from the shared registry
 *  (`agent-commands.js`); this decides only what to send with them. */
export const RUN = {
  plan: (argument) => ['workspace.plan', { request: argument, files: [] }],
  simulate: (argument) => ['workspace.simulate', { runId: argument }],
  approve: (argument) => ['workspace.approve', { runId: argument }],
  reject: (argument) => {
    const [runId, ...why] = argument.split(' ');
    return ['workspace.reject', { runId, reason: why.join(' ') || undefined }];
  },
  restore: (argument) => ['workspace.restore', { runId: argument }],
  diff: (argument) => ['workspace.get', { runId: argument }],
  map: (argument) => ['repoMap.scan', argument ? { path: argument } : {}],
  search: (argument) => ['repoMap.search', { q: argument }],
  events: (argument) => ['events.correlation', { correlationId: argument }],
  status: () => ['status', {}],
  sessions: (argument) => ['sessions.list', argument ? { filter: argument } : {}],
  git: () => ['coden.gitStatus', {}],
};

/**
 * Phase 3b — the forms. A form is a capability whose input does not fit on one prompt line.
 *
 * `closure` is the only one, and its shape is not chosen for convenience: `UI-036` requires a
 * closure to name what was left undone OR to state that nothing was, and to state the residual
 * risk — and the register REFUSES one that does neither. Three fields with a mandatory refusal
 * clause is a form, and folding it into `closure <run> | did | not-done | risk` would make the
 * one field the whole object exists to carry the easiest to leave off.
 *
 * Defined here, once, so the two shells ask the SAME questions in the same order. HOW each asks
 * differs: the browser already has this as a panel with a form in it and opens that; the
 * terminal walks the fields at its prompt. One capability, two renditions (`16` §4b.2) —
 * rather than one shell having a closure the other does not, which is `CE-034` failing.
 */
export const FORMS = {
  closure: {
    method: 'closure.record',
    address: 'coden/bench/closure',
    argument: 'runId',
    fields: [
      { name: 'summary', ask: 'What was done — one paragraph. What changed, and why it was accepted.' },
      {
        name: 'notDone',
        // The wording carries the rule instead of hiding it behind a refusal three steps later.
        ask: 'What was NOT done — one item per line, `;` between them. Type `nothing` to state that nothing was left undone; that statement is recorded as yours.',
      },
      { name: 'residualRisk', ask: 'Residual risk. "none" is an answer; silence is not.' },
    ],
  },
};

/** Begins a form, or says why it cannot begin. Pure: returns state, performs nothing. */
export function startForm(name, argument) {
  const spec = FORMS[name];
  if (!spec) return null;
  const subject = String(argument ?? '').trim();
  if (!subject) return { error: `\`/${name}\` needs a ${spec.argument}: \`/${name} <${spec.argument}>\`` };
  return { form: { name, subject, index: 0, answers: {} }, ask: spec.fields[0].ask };
}

/**
 * Feeds one typed line into a running form.
 *
 * Returns `{ ask }` while more is wanted, `{ method, params }` once it is complete, or
 * `{ cancelled: true }` for `/cancel`. A form you cannot get out of is a trap, and in a shell
 * whose whole point is that the session outlives the shell, being stuck in one is worse here
 * than it would be elsewhere.
 */
export function fillForm(form, line) {
  const spec = FORMS[form.name];
  const typed = String(line ?? '').trim();
  if (typed === '/cancel') return { cancelled: true };

  form.answers[spec.fields[form.index].name] = typed;
  form.index += 1;
  if (form.index < spec.fields.length) return { ask: spec.fields[form.index].ask };

  const notDone = form.answers.notDone ?? '';
  const nothing = notDone.toLowerCase() === 'nothing';
  return {
    method: spec.method,
    params: {
      runId: form.subject,
      summary: form.answers.summary ?? '',
      // Split on `;`, dropping empties, so `a; b;` is two items rather than three.
      notDone: nothing ? [] : notDone.split(';').map((item) => item.trim()).filter(Boolean),
      nothingLeftUndone: nothing,
      residualRisk: form.answers.residualRisk ?? '',
    },
  };
}

// Ten lines, and the count of what was dropped.
//
// It was twenty-four, and a single `/map` buried the tool call that produced it: the answer
// scrolled the question off the screen, which is the opposite of what a transcript is for.
// Truncating is the fix; truncating SILENTLY would not be — a reader who cannot see that there
// was more would take ten lines for the whole answer.
export const DETAIL_LINES = 10;

export function detailLines(value, limit = DETAIL_LINES) {
  const all = (value === undefined || value === null ? '(nothing)' : JSON.stringify(value, null, 2)).split('\n');
  return all.length <= limit ? all : [...all.slice(0, limit), `… ${all.length - limit} more lines`];
}

export const OPENING_NOTE =
  'CodeN Evolution — attached to the live session. Type a command, or / for the list.';

export const CLEARED_NOTE =
  'Transcript cleared. The session kept its state — this shell is a viewer.';

/** The whole of what a shell has to show. Every field is data: no element, no escape code. */
export function createView(overrides = {}) {
  return {
    transcript: [{ kind: 'note', text: OPENING_NOTE }],
    prompt: '',
    menu: null,
    mode: 'NORMAL',
    network: 'local-only',
    git: '—',
    model: '—',
    context: '—',
    sourcedNote: null,
    ...overrides,
  };
}

/** The only way anything reaches the transcript. Kept as a function rather than a bare push so
 *  that the entry shape is stated once — a shell inventing a fifth `kind` fails a test instead
 *  of rendering as blank. */
export const TRANSCRIPT_KINDS = Object.freeze(['note', 'user', 'agent', 'tool', 'error']);

export function say(view, kind, text, detail) {
  if (!TRANSCRIPT_KINDS.includes(kind)) throw new Error(`unknown transcript kind \`${kind}\``);
  view.transcript.push({ kind, text, detail });
  return view;
}

/** The branch line, built from what the engine answered — never from a second git call. */
export function gitSummary(git) {
  if (!git?.available) return '—';
  const parts = [git.detached ? 'detached' : git.branch];
  if (!git.hasUpstream) parts.push('(no upstream)');
  else {
    if (git.ahead) parts.push(`↑${git.ahead}`);
    if (git.behind) parts.push(`↓${git.behind}`);
  }
  return parts.join(' ');
}

/**
 * What should happen to what the user typed — decided here, performed by the caller.
 *
 * Returns one of:
 *   { kind: 'empty' }                                  nothing was typed
 *   { kind: 'help', lines }                            the command list, already formatted
 *   { kind: 'clear' }                                  reset the transcript
 *   { kind: 'unknown', message }                       say this, do nothing
 *   { kind: 'call', command, argument, method, params, label }
 *   { kind: 'navigate', command, address, label }      an application or a setting
 *   { kind: 'confirm', command, action, message }      logout, before the second word
 *   { kind: 'session', command, action }               logout, after it
 *
 * `resolve`, `parse` and `commands` are injected rather than imported so that this module
 * stays free of even that dependency and a test can drive it with a known registry.
 * `commands` is the list this ACCOUNT may use — already filtered by `menuFor` — so a typed
 * `/modules` from an account that cannot see it resolves to nothing and is answered as an
 * unknown word, exactly like a name that does not exist. An entry hidden from the menu but
 * still runnable by typing it would make the filtering decorative.
 */
export function planTurn(typed, { resolve, parse, commands, groups }) {
  const line = String(typed ?? '').trim();
  if (!line) return { kind: 'empty' };

  if (line === '/help' || line === '/') {
    // Grouped when the caller supplies the grouping, flat when it does not — the four groups
    // are `16` §4b.4, and a caller that has none still gets a usable list rather than nothing.
    const format = (c) => `  /${c.name} ${c.argument ?? ''}`.trimEnd().padEnd(28) + c.summary;
    const lines = groups
      ? groups(commands).flatMap((group) => [group.title, ...group.entries.map(format)])
      : commands.map((c) => format(c).trimStart());
    return { kind: 'help', lines };
  }
  if (line === '/clear') return { kind: 'clear' };

  const resolved = resolve(line);
  if (!resolved) {
    // Prose, or a slash word that names nothing. Said plainly rather than guessed at: running
    // the nearest command would be an action nobody chose.
    return {
      kind: 'unknown',
      message: line.startsWith('/')
        ? `No command named \`${parse(line)?.word ?? ''}\`. Type / for the list.`
        : 'This shell has no model wired for prose. Every capability is a command — type / for the list.',
    };
  }

  const { command, argument } = resolved;

  // A destination. The shell performs it with whatever "going somewhere" means for it — a
  // route change in a browser, a rendered address in a terminal — and this module names the
  // place without knowing which.
  if (command.kind === 'address') {
    return { kind: 'navigate', command: command.name, address: command.address, label: command.summary };
  }

  // A form. The intent names the capability; each shell renders it in its own idiom — the
  // browser opens the panel that already holds the form, the terminal walks the fields at its
  // prompt. Deciding WHICH here, rather than in each shell, is what stops one of them growing
  // a closure the other does not have.
  if (command.kind === 'form') {
    return {
      kind: 'form',
      command: command.name,
      argument,
      address: FORMS[command.name]?.address ?? null,
      method: command.method,
    };
  }

  // `/logout` twice, and the second time as a typed WORD. `15` §13 refuses a one-key
  // confirmation for exactly this: in a terminal a lone `y` is one paste away from being
  // typed by something that is not you.
  if (command.kind === 'session') {
    if (argument.trim().toLowerCase() !== 'confirm') {
      return {
        kind: 'confirm',
        command: command.name,
        action: command.action,
        message: `This ends the session for every shell attached to it. Type \`/${command.name} confirm\` to go ahead.`,
      };
    }
    return { kind: 'session', command: command.name, action: command.action };
  }

  const build = RUN[command.name];
  if (!build) return { kind: 'unknown', message: `\`/${command.name}\` has no transport here.` };

  const [method, params] = build(argument);
  return {
    kind: 'call',
    command: command.name,
    argument,
    method,
    params,
    label: `${method}(${argument || ''})`,
  };
}
