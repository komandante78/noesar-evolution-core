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
 *
 * `resolve`, `parse` and `commands` are injected rather than imported so that this module
 * stays free of even that dependency and a test can drive it with a known registry.
 */
export function planTurn(typed, { resolve, parse, commands }) {
  const line = String(typed ?? '').trim();
  if (!line) return { kind: 'empty' };

  if (line === '/help' || line === '/') {
    return {
      kind: 'help',
      lines: commands.map((c) => `/${c.name} ${c.argument}`.trim().padEnd(28) + c.summary),
    };
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

  const build = RUN[resolved.command.name];
  if (!build) return { kind: 'unknown', message: `\`/${resolved.command.name}\` has no transport here.` };

  const [method, params] = build(resolved.argument);
  return {
    kind: 'call',
    command: resolved.command.name,
    argument: resolved.argument,
    method,
    params,
    label: `${method}(${resolved.argument || ''})`,
  };
}
