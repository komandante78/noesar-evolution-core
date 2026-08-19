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
// `apps/shared/coden/tui-screen.mjs` stays where it is. It renders character rows clipped to a width,
// which is correct for a TTY and would be throwing away the medium in a browser. The shells
// share the STATE, not the pixels — `16` §4b.2.
//
// # The one import, and why it is not an injection
//
// `menuFrame` needs the group table and the matcher. Both live in `agent-commands.js`, the
// other file both shells already import, and the dependency runs one way only — that file
// imports nothing. `planTurn` injects its registry instead, and that was right for a function a
// test must drive with a made-up command list; a menu that assembled its own groups per shell
// would be the hand-built object `accountFromUser` exists to have stopped (`M-11`: one shell
// passed `null` and its menu went unfiltered with nothing failing).
import { matchCommands } from '../shared/coden/agent-commands.js';

/** How each command turns into an engine call. The method names come from the shared registry
 *  (`agent-commands.js`); this decides only what to send with them. */
export const RUN = {
  plan: (argument) => ['workspace.plan', { request: argument, files: [] }],
  simulate: (argument) => ['workspace.simulate', { runId: argument }],
  // `D-0567`, `CE-008`: the step that produces the result `approve` is answered against.
  measure: (argument) => ['workspace.measure', { runId: argument }],
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
  model: (argument) => ['model.activate', { id: argument }],
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
    // Phase 6: which provider is actually answering. `—` until a run says. The whole of
    // `D-0312` is that the product carries on WITHOUT carrying on quietly, and a status line
    // that cannot show the difference is where "quietly" would come back in.
    reasoning: '—',
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
 * The reasoning chip — built from what the engine answered, exactly like `gitSummary`, and
 * never from a second opinion this file forms on its own.
 *
 * Three states, and the third is the point of phase 6:
 *
 *   '—'                       nothing has run yet, or the engine did not say
 *   'atom'                    the chain worked: ATOM checked and answered
 *   'reference (degraded: …)' ATOM was asked for, could not be reached, and the reference
 *                             provider answered instead — with the reason, in the same words
 *                             the Session Proof records
 *
 * The reason is CARRIED, not summarised into a symbol. A red dot next to "reference" would be
 * a shell deciding how bad it is; the operator decides that, and needs the sentence to do it.
 */
export function reasoningSummary(reasoning) {
  if (!reasoning || typeof reasoning !== 'object') return '—';
  if (!reasoning.degraded) return reasoning.provider ?? 'atom';
  const why = (reasoning.reasons ?? []).filter(Boolean)[0];
  return why ? `reference (degraded: ${why})` : 'reference (degraded)';
}

/**
 * How often ATOM has fallen, shaped for a status line — the second half of `D-0312`.
 *
 * Formatting lives here and measuring lives in `degradationFrequency`, which returns a RATIO and
 * refuses to return a percentage string: a module that formats has already decided what a shell
 * may show.
 *
 * "0 of 0" is not "0%". An installation that has never planned anything is not a healthy one,
 * and rendering it as `0%` would tell an operator the opposite of what the data says.
 */
export function frequencySummary(frequency) {
  if (!frequency || typeof frequency !== 'object') return '—';
  if (!frequency.runs) return 'no runs yet';
  const percent = Math.round((frequency.rate ?? 0) * 1000) / 10;
  return `${frequency.degradedRuns}/${frequency.runs} runs degraded (${percent}%)`;
}

/**
 * The divergence profile, shaped for a screen — `CE-010`, and the one rule it carries.
 *
 * **Four signals with their level. Never a number.** `divergence-profile.mjs` refuses to
 * produce a score, and a test guards that refusal; this is the place a score would most
 * plausibly sneak back in — averaging four levels into "68% divergent" reads as rigour and is
 * an invention. So the levels are shown as they are, and nothing here counts them.
 *
 * The `note` is carried, not summarised. «no test changed; 78% of accepted changes here carry
 * one» is the sentence a maintainer would say; `tests: high` is a colour.
 *
 * Unavailable is a real answer with a real reason — a workspace with no git history has no
 * precedent to diverge FROM, which is not the same as diverging from none.
 */
export const DIVERGENCE_LEVELS = Object.freeze(['none', 'medium', 'high']);

export function divergenceLines(divergence) {
  if (!divergence || typeof divergence !== 'object') return [];
  if (!divergence.available) {
    return [{ id: 'divergence', level: 'unavailable', note: divergence.reason ?? 'no profile was computed for this change' }];
  }
  return (divergence.signals ?? []).map((signal) => ({
    id: signal.id,
    level: DIVERGENCE_LEVELS.includes(signal.level) ? signal.level : 'unknown',
    note: signal.note ?? '',
  }));
}

/** The one-line form a status row can hold: which signals are raised, not how many. */
export function divergenceSummary(divergence) {
  if (!divergence || typeof divergence !== 'object') return '—';
  if (!divergence.available) return 'divergence unavailable';
  const raised = (divergence.signals ?? []).filter((signal) => signal.level && signal.level !== 'none');
  if (!raised.length) return 'in keeping with this repository';
  return raised.map((signal) => `${signal.id} ${signal.level}`).join(' · ');
}

/**
 * Rank a list of addresses against what was typed — the ONE copy of that rule.
 *
 * It existed twice, byte-different, and the second one's comment said so out loud: "the
 * browser's own ranking, in the same three ranks (app.js::matchAddresses)". A rule maintained
 * in two files is `PANEL_NAMES` again, and a documented duplicate is still a duplicate — the
 * note explains the drift, it does not prevent it.
 *
 * Three ranks: an address that STARTS with the query beats one that merely contains it, which
 * beats a match on the label's prose — so `diff` reaches the Diff panel rather than the first
 * page whose description happens to say "difference". A leading slash is stripped, so the key
 * that opens the menu does not also become the first character of the query. Array sort is
 * stable, so equal ranks keep the interface's own order.
 */
export function matchAddresses(addresses, query) {
  const wanted = String(query ?? '').replace(/^\/+/, '').trim().toLowerCase();
  if (!wanted) return [...addresses];
  return addresses
    .map((entry) => {
      const address = String(entry.address ?? '').toLowerCase();
      if (address.startsWith(wanted)) return { entry, rank: 0 };
      if (address.includes(wanted)) return { entry, rank: 1 };
      if (String(entry.label ?? '').toLowerCase().includes(wanted)) return { entry, rank: 2 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .map((hit) => hit.entry);
}

/**
 * The served addresses, shaped as menu entries — so `/` offers them without either shell
 * writing a list of its own.
 *
 * They go in APPLICATIONS by §4b.4's own criterion: that group is "le destinazioni del
 * prodotto — è un posto dove si va", and a bench panel is exactly that. A fifth group would
 * have been a fifth thing to choose from, which is what rule 1 spends its whole paragraph
 * forbidding; and a hand-written copy of the panel names is what `PANEL_NAMES` was.
 *
 * `name` IS the address, so what the menu shows is what you type. The commands keep their
 * short names — `/diff` stays the work command — and an address is reached by its full
 * address, which is the only spelling that cannot collide with one.
 */
/**
 * Does this command need a subject before it can run?
 *
 * The distinction is already written in the catalogue and was simply never read: `<run>` is
 * required, `[path]` is optional. Reading it here rather than keeping a second list of
 * "commands that need things" is deliberate — a second list agrees with the first only until
 * one of them is edited.
 */
export function requiresArgument(command) {
  return /^</.test(String(command?.argument ?? '').trim());
}

/**
 * The coden panel that shows what a command is about, if there is one.
 *
 * Matched on the LAST segment of the address, because that is where a panel's own name lives
 * (`coden/bench/diff`, `coden/agent/plan`). Restricted to `coden/` on purpose: `/search`
 * must not be answered by wandering off to some unrelated destination that happens to end in
 * the same word — the offer is "here is the panel of this bench that shows this", and a jump
 * out of the page would be a different promise.
 */
export function panelOwning(name, entries) {
  return (entries ?? []).find((entry) => entry.kind === 'address'
    && typeof entry.address === 'string'
    && entry.address.startsWith('coden/')
    && entry.address.endsWith(`/${name}`)) ?? null;
}

export function addressEntries(addresses) {
  return (addresses ?? [])
    .filter((entry) => entry.address)
    .map((entry) => ({
      name: entry.address,
      argument: '',
      summary: entry.label ?? entry.address,
      group: 'applications',
      kind: 'address',
      address: entry.address,
      permission: null,
    }));
}

/**
 * What the menu LISTS for a given query — commands always, the address space once something
 * has been typed.
 *
 * Measured, not guessed: folding all fifty-three addresses in unconditionally made the bare
 * `/` menu useless. The renderer divides its row budget across the four groups, APPLICATIONS
 * went from eleven entries to sixty-four, and WORK's share shrank until `/approve` no longer
 * appeared at a normal terminal height. `CE-020` caught it — the acceptance run that types `/`
 * and looks for the commands the shell is FOR.
 *
 * So the bare `/` is the product's own menu, which is what §4b.4 draws: four groups, the
 * things you do and the places you go. Type anything and the address space joins in, which is
 * the case where you are looking for a panel by name. This is still ONE menu and one list —
 * what changes is how much of it a query with no letters in it is worth showing.
 *
 * Note what this does NOT do: it does not narrow what can be RESOLVED. Typing a full address
 * always goes there, whether or not the menu had got round to listing it — the filtering is
 * about what is worth painting, never about what the prompt accepts.
 */
export function menuEntriesFor(word, commands, addresses) {
  return String(word ?? '').trim() ? [...commands, ...addressEntries(addresses)] : [...commands];
}

/**
 * What the menu shows for what has been typed — ONE function, both shells, ONE flat ranked
 * list. Owner instruction, 2026-08-14: the earlier two-level design (`/` for groups, a group
 * key to enter one) read as a menu under a menu — a reader had to learn or remember which of
 * seven groups held a command before finding it, which is exactly the friction a `/` palette
 * exists to remove. `matchCommands` already ranks (name-starts-with, then name-contains, then
 * summary-contains), so the list a person actually wants is already at the top; the renderer
 * just has to show it without making them pick a category first.
 *
 *   `/`         → { level: 'entries' }   every command, ranked, windowed to the box height
 *   `/appr`     → { level: 'entries' }   the same list, filtered
 *
 * # Why the addresses still wait for a keystroke
 *
 * `menuEntriesFor` keeps the fifty-three addresses out of a bare `/` — measured, `CE-020`
 * failed for a phase when they were in it unconditionally. That constraint survives the
 * flattening unchanged: a bare `/` shows the ~30 commands (still windowed, never all at once
 * unless they fit), and the address book joins in the moment a query narrows the list, which
 * is also the moment there is room to show it.
 */
export function menuFrame(parsed, { commands = [], addresses = [] } = {}) {
  const word = String(parsed?.word ?? '');

  return { level: 'entries', group: null, hits: matchCommands(word, menuEntriesFor(word, commands, addresses)) };
}

/**
 * The menu as the RENDERER wants it — one shaper, both shells (`D-0420`).
 *
 * Flattened 2026-08-14 alongside `menuFrame`: there is no group level left to translate
 * between shapes, so this is now a plain pass-through of `hits` plus the bookkeeping
 * (`selected`, the access-filtered note, the key legend) neither shell should compute twice.
 * Kept as its own function rather than inlined at each call site for the same reason it always
 * was one: a third shell gets the shape right by construction instead of by copying it.
 */
export function menuViewModel(frame, { menu = null, note = '', keys = null, selected = 0 } = {}) {
  if (!frame) return null;
  return {
    level: frame.level,
    hits: frame.hits ?? [],
    selected,
    accessFiltered: menu?.accessFiltered ?? false,
    hidden: menu?.hidden ?? 0,
    note,
    keys: keys ?? promptKeys(frame),
  };
}

/**
 * WHAT THE NEXT KEY DOES, right now — property 6 of the approved design, and the half of
 * "terminal style" that is functional rather than decorative.
 *
 * The research the owner's point 3 rests on names this exactly: Zellij's bar changes with the
 * context and shows the keys that are valid *at this moment*, which is why its command set
 * scales; a static legend is furniture. From the CIDER note in the same passage — the only
 * reliable place to teach a function is inside the flow, at the moment of hesitation.
 *
 * One list, both shells, because a prompt that claims `⏎ enter` in the browser and does
 * something else in the terminal is worse than no legend at all. Each shell renders it in its
 * own idiom — the browser into the hint line under the prompt, the terminal as the menu's last
 * row — which is the same split `.coden-bar` and the terminal footer already are.
 *
 * The translator is injected for the same reason `hiddenNote`'s is (s336, voice stage 2): the
 * browser joins these into ONE line. The terminal passes nothing and keeps English, which is
 * what it shows everywhere else.
 */
export function promptKeys(frame, translate = (text) => text) {
  const say = (text) => translate(text);
  if (!frame) return [say('Enter sends'), say('/ opens the menu'), say('Tab completes without sending')];
  return [say('↑↓ move'), say('Tab completes'), say('⏎ sends'), say('esc close')];
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
 *
 * # Phase 3c · why the prompt resolves an address at all
 *
 * `16` §4b.4 rule 1 fixes it: there is ONE `/`. The browser's top box was the only gesture
 * that opened the twenty-five CodeN panels, and 3c removes it — so the prompt has to reach
 * them, or removing the box takes navigation with it. Measured before writing this: typed at
 * the prompt, 0 of 25 resolved, in BOTH shells.
 *
 * Nothing in THIS function knows that. The caller resolves against one list — its commands
 * plus `addressEntries(served)` — and an address arrives here as an entry whose `kind` is
 * already `address`. A second lookup here, after the first one failed, would have been a
 * second mechanism for one gesture, which is the thing rule 1 exists to prevent; and it
 * would have let the two shells offer one set in the menu and accept another at the prompt.
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
    // Prose, or a slash word that names nothing — neither a command nor an address, since
    // phase 3c puts both in the one list the caller resolves against. Said plainly rather than
    // guessed at: running the nearest command would be an action nobody chose.
    //
    // Owner report, 2026-08-17: typing `/model` answered "Nothing named `mode`" — so `/mode`
    // is what reached the engine, and the shell had the answer and did not give it. A near miss
    // is the ORDINARY case of this branch, not prose: one dropped character turns every command
    // in the list into this sentence. `matchCommands` already ranks by prefix, then substring,
    // then summary, and it is the same ranking the menu paints while typing — so the suggestion
    // and the menu can never offer different words for the same three keystrokes.
    //
    // Suggested, never run. Guessing at submit time is precisely what `resolveCommand`'s
    // exact-match exists to prevent, and this branch does not soften it: the sentence names the
    // candidates, the person chooses.
    const typedWord = line.startsWith('/') ? String(parse(line)?.word ?? '') : '';
    const near = typedWord ? matchCommands(typedWord, commands).slice(0, 3).map((entry) => `/${entry.name}`) : [];
    return {
      kind: 'unknown',
      suggestions: near,
      message: line.startsWith('/')
        ? `Nothing named \`${typedWord}\`.${near.length ? ` Did you mean ${near.join(' · ')}?` : ''} Type / for the list.`
        : 'This shell has no model wired for prose. Every capability is a command — type / for the list.',
    };
  }

  const { command, argument } = resolved;

  // A required argument that was not given — s333 point 2.
  //
  // Owner: «i comandi / non so se funzionano, non vedo cambiamenti e non si capisce».
  // Measured in the browser rather than assumed, because s328's precedent forbids treating
  // this as styling: typing `/diff` fired `workspace.get()` with no run and came back
  // "diff refused: no run" — a server sentence, in a transcript, about a call the person never
  // asked to make, with nothing on screen moving. Nine of the thirty-three commands take a
  // required argument and every one behaved this way. So the honest answer to "do the slash
  // commands work" was that the most obvious one produced an error and no visible movement.
  //
  // The convention was already in the data and simply never read: `<run>` is required,
  // `[path]` is optional. A command given no subject has not been asked to RUN — it has been
  // NAMED. Naming goes to the panel that shows that thing where one exists, which is both the
  // useful answer and a visible one; where none exists it says what is missing and still runs
  // nothing. Either way no doomed call is made.
  //
  // Deciding it here rather than in each shell is this file's whole reason to exist: two
  // shells that each decide when a call is safe will disagree, and the disagreement surfaces
  // in whichever one is used less.
  if (command.kind !== 'address' && requiresArgument(command) && !String(argument ?? '').trim()) {
    const needed = String(command.argument ?? '').trim();
    const panel = panelOwning(command.name, commands);
    if (panel) {
      return {
        kind: 'navigate',
        command: command.name,
        address: panel.address,
        label: panel.summary,
        argument: '',
        // Carried so the shell can SAY why it moved instead of running. A move for an unstated
        // reason is the same «non si capisce», seen from the other side.
        because: `\`/${command.name}\` needs ${needed} to run, so this is the panel that shows it. \`/${command.name} ${needed}\` runs it.`,
      };
    }
    return {
      kind: 'needs-argument',
      command: command.name,
      needed,
      message: `\`/${command.name}\` needs ${needed}. Nothing was run, and no panel shows this on its own.`,
    };
  }

  // A destination. The shell performs it with whatever "going somewhere" means for it — a
  // route change in a browser, a rendered address in a terminal — and this module names the
  // place without knowing which.
  if (command.kind === 'address') {
    // `argument` since phase 3c: three of the twenty-five panels are a view OF A RUN
    // (`/coden/bench/diff <runId>`), and dropping it here would make them the only addresses
    // that cannot be opened at the thing they show — a jump that arrives with its subject
    // thrown away.
    return { kind: 'navigate', command: command.name, address: command.address, label: command.summary, argument };
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
