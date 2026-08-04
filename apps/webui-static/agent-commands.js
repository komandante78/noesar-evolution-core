// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The slash commands of the coding agent — ONE list, imported by both shells.
//
// This file lives under the static directory on purpose: the browser fetches it as a module
// (`app.js` is `type="module"`), and the terminal client imports it off disk. Not a copy in
// each shell that happens to agree, and not a list served over the protocol either — a
// literal single file, which is the strongest version of the rule `D-0300` established for
// addresses after `PANEL_NAMES` had drifted to fourteen entries against a markup of
// twenty-five.
//
// What a slash command IS here, since the product already has a different `/`:
//
//   `/` in the PROMPT is a command to the agent — you type it where you type the message,
//   the way Codex and Claude Code work. It acts on the session.
//
//   `/` in the top box was jump-to-address (`coden-address-book.mjs`). That is navigation —
//   an application's Ctrl-K — and it is NOT this. Both exist; they are different gestures at
//   different places, and conflating them is the mistake this file exists to end.
//
// Every command below maps to a method the engine already exposes and already gates
// (`SESSION_METHOD_POLICY`). There is no `/exec` and there will not be one: the executor
// refuses EXECUTE permanently and on purpose, and a prompt is not a way around that.

export const AGENT_COMMANDS = Object.freeze([
  { name: 'plan', argument: '<goal>', summary: 'Start a plan: a goal, then the exact files it may touch', method: 'workspace.plan' },
  { name: 'simulate', argument: '<run>', summary: 'Ask what a pending plan would do, executing nothing', method: 'workspace.simulate' },
  { name: 'approve', argument: '<run>', summary: 'Approve a plan — runs in the shadow, promotes only if clean', method: 'workspace.approve' },
  { name: 'reject', argument: '<run> [why]', summary: 'Reject a pending plan', method: 'workspace.reject' },
  { name: 'restore', argument: '<run>', summary: 'Undo a promoted run', method: 'workspace.restore' },
  { name: 'diff', argument: '<run>', summary: 'What a run changed, against the shadow', method: 'workspace.get' },
  { name: 'map', argument: '[path]', summary: 'Scan the workspace: languages, entry points, symbols', method: 'repoMap.scan' },
  { name: 'search', argument: '<text>', summary: 'Literal search across the workspace', method: 'repoMap.search' },
  { name: 'events', argument: '<id>', summary: 'The causal event trail of a piece of work', method: 'events.correlation' },
  { name: 'status', argument: '', summary: 'Engine status, authority, shadow', method: 'status' },
  { name: 'sessions', argument: '[active|archived|bin]', summary: 'List sessions', method: 'sessions.list' },
  { name: 'git', argument: '', summary: 'Branch and divergence of the workspace', method: 'coden.gitStatus' },
  { name: 'help', argument: '', summary: 'These commands', method: null },
  { name: 'clear', argument: '', summary: 'Clear the transcript on screen (the session keeps its state)', method: null },
]);

/**
 * True when what is typed should open the command menu: a `/` that begins the prompt.
 *
 * Deliberately NOT "the text contains a slash" — a prompt is prose, and `and/or` or a path
 * like `src/index.mjs` must never turn into a command menu mid-sentence. The gesture is the
 * first character, which is what both Codex and Claude Code do.
 */
export function isCommandPrompt(text) {
  return typeof text === 'string' && text.startsWith('/');
}

/** Splits `/plan fix the thing` into its command word and the rest, without deciding whether
 *  the word names a real command — the caller shows the menu for a partial word and only
 *  resolves it on submit. */
export function parseCommandPrompt(text) {
  if (!isCommandPrompt(text)) return null;
  const body = text.slice(1);
  const space = body.indexOf(' ');
  return space === -1
    ? { word: body, argument: '' }
    : { word: body.slice(0, space), argument: body.slice(space + 1).trim() };
}

/**
 * The commands matching a partial word, in one deliberate order: names that START with what
 * was typed, then names that merely contain it, then a match on the summary's prose. Same
 * three ranks the address box uses, so the two `/` gestures rank consistently even though
 * they do different things — a user who learns one ordering does not have to learn a second.
 */
export function matchCommands(word) {
  const wanted = String(word ?? '').trim().toLowerCase();
  if (!wanted) return [...AGENT_COMMANDS];
  return AGENT_COMMANDS
    .map((command) => {
      const name = command.name.toLowerCase();
      if (name.startsWith(wanted)) return { command, rank: 0 };
      if (name.includes(wanted)) return { command, rank: 1 };
      if (command.summary.toLowerCase().includes(wanted)) return { command, rank: 2 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .map((hit) => hit.command);
}

/** The exact command a submitted prompt names, or null. Exact only: a prompt that begins
 *  `/pl` must not silently run `/plan` — the menu is how you choose, and guessing at submit
 *  time is how a keystroke becomes an action nobody selected. */
export function resolveCommand(text) {
  const parsed = parseCommandPrompt(text);
  if (!parsed) return null;
  const command = AGENT_COMMANDS.find((entry) => entry.name === parsed.word);
  return command ? { command, argument: parsed.argument } : null;
}
