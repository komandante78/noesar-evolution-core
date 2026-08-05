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
//
// # Phase 3a — the menu is the WHOLE product, in four groups
//
// `16` §4b.4: `/` opens the one menu of the product, not merely the work commands. Four
// groups, and the criterion that decides where an entry goes is the one the document fixes:
//
//   work          changes the state of the work        → a method on the engine
//   applications  is a place you go                    → a destination
//   configure     changes how the product behaves      → a destination that is a setting
//   session       changes who you are                  → logout
//
// Rule 1 of §4b.4 is why this is ONE list rather than a second widget: `D-0299` removed three
// navigation widgets because the problem was *how many there are*. This menu absorbs what was
// left; it does not become a fourth.

/** The four groups, in display order. The heading text lives here so neither shell writes
 *  its own — the same reason the entries do. */
export const MENU_GROUPS = Object.freeze([
  { id: 'work', title: 'WORK' },
  { id: 'applications', title: 'APPLICATIONS' },
  { id: 'configure', title: 'CONFIGURE' },
  { id: 'session', title: 'SESSION' },
]);

/**
 * What a page needs before it is worth offering at all — moved here from `app.js` in phase 3a.
 *
 * It was the browser's private table, which was correct while only the browser had
 * destinations to hide. The menu gives the terminal the same entries, and a gate only one
 * shell can read is a gate the other shell silently does not apply — `CE-036` says an entry
 * the account cannot use does not appear, in BOTH. So the table moved to the file both import
 * rather than being copied into the second one.
 *
 * `role` mirrors the routes the server guards with `requireOwner` — a literal role check, not
 * a permission — and `permission` is tested against the set the server itself reports for the
 * account. None of this is enforcement: every request is still checked by the server.
 */
export const ROUTE_ACCESS = Object.freeze({});
export const SECTION_ACCESS = Object.freeze({
  people: { permission: 'user.manage' },
  storage: { permission: 'data.manage' },
  health: { role: 'owner' },
  updates: { role: 'owner' },
  // D-0277: install/activate/deactivate are owner-only server-side (requireOwner); the
  // section itself is owner-only too, same as updates/health above, rather than showing
  // every other role a page whose one action always answers 403.
  modules: { role: 'owner' },
});

/** The access rule guarding an address, or null when it is open to any signed-in session.
 *  A settings address is gated by its SECTION, which is where the product's gates live. */
export function accessRuleFor(address) {
  const [view = '', section = ''] = String(address ?? '').split('/');
  if (section) return SECTION_ACCESS[section] ?? null;
  return ROUTE_ACCESS[view] ?? null;
}

export const AGENT_COMMANDS = Object.freeze([
  // This said "a goal, then the exact files it may touch" for as long as naming files was
  // mandatory — which was also as long as this command could not work at all, since both
  // shells send an empty list. Files are now found in the repository when none are named
  // (`request-grounding.mjs`), so the line says that instead. A command's own description is
  // the first thing to go stale when its engine changes, and both shells render this string.
  // WORK — a method on the engine. `permission` is the one `SESSION_METHOD_POLICY` names for
  // that method, and `menu-permission-parity` in `coden-shell-parity.test.mjs` fails if the
  // two ever disagree. Written here rather than imported because the browser cannot import
  // out of `services/`; derived-by-test rather than copied-and-hoped, which is the difference
  // between this and `PANEL_NAMES` — a list compared only with itself always agrees.
  { name: 'plan', argument: '<goal>', summary: 'Start a plan from a goal — the repository decides which files it may touch', group: 'work', kind: 'call', method: 'workspace.plan', permission: 'workspace.write' },
  { name: 'simulate', argument: '<run>', summary: 'Ask what a pending plan would do, executing nothing', group: 'work', kind: 'call', method: 'workspace.simulate', permission: 'workspace.read' },
  { name: 'approve', argument: '<run>', summary: 'Approve a plan — runs in the shadow, promotes only if clean', group: 'work', kind: 'call', method: 'workspace.approve', permission: 'workspace.write' },
  { name: 'reject', argument: '<run> [why]', summary: 'Reject a pending plan', group: 'work', kind: 'call', method: 'workspace.reject', permission: 'workspace.write' },
  { name: 'restore', argument: '<run>', summary: 'Undo a promoted run', group: 'work', kind: 'call', method: 'workspace.restore', permission: 'workspace.write' },
  { name: 'diff', argument: '<run>', summary: 'What a run changed, against the shadow', group: 'work', kind: 'call', method: 'workspace.get', permission: null },
  { name: 'map', argument: '[path]', summary: 'Scan the workspace: languages, entry points, symbols', group: 'work', kind: 'call', method: 'repoMap.scan', permission: 'workspace.read' },
  { name: 'search', argument: '<text>', summary: 'Literal search across the workspace', group: 'work', kind: 'call', method: 'repoMap.search', permission: 'workspace.read' },
  { name: 'events', argument: '<id>', summary: 'The causal event trail of a piece of work', group: 'work', kind: 'call', method: 'events.correlation', permission: null },
  { name: 'status', argument: '', summary: 'Engine status, authority, shadow', group: 'work', kind: 'call', method: 'status', permission: null },
  { name: 'sessions', argument: '[active|archived|bin]', summary: 'List sessions', group: 'work', kind: 'call', method: 'sessions.list', permission: 'workspace.read' },
  { name: 'git', argument: '', summary: 'Branch and divergence of the workspace', group: 'work', kind: 'call', method: 'coden.gitStatus', permission: 'coden.plan' },
  { name: 'help', argument: '', summary: 'These commands', group: 'work', kind: 'shell', method: null, permission: null },
  { name: 'clear', argument: '', summary: 'Clear the transcript on screen (the session keeps its state)', group: 'work', kind: 'shell', method: null, permission: null },

  // APPLICATIONS — the destinations of the product. `address` is the address of that
  // destination in the one address space (`coden-address-book.mjs`), so the menu and the
  // address book cannot name the same place two ways. Thirteen destinations exist and eleven
  // are here: `settings` and `models` are places you go AND places you change how the product
  // behaves, and §4b.4's criterion puts those in CONFIGURE. Listing them twice would put the
  // same door in two groups, which is the thing one menu exists to stop.
  //
  // Each summary says what the destination IS, never just its own name again. A menu whose
  // right-hand column repeats its left-hand column has a column that costs width and carries
  // nothing — the guard in `tui-screen-layout.test.mjs` caught the first draft doing exactly
  // that, on eight entries.
  { name: 'home', argument: '', summary: 'The overview — what is running and what is waiting', group: 'applications', kind: 'address', address: 'home' },
  { name: 'chat', argument: '', summary: 'Talk to the model in the same session this shell is attached to', group: 'applications', kind: 'address', address: 'chat' },
  { name: 'coden', argument: '', summary: 'The coding workbench — plans, diffs, shadow runs', group: 'applications', kind: 'address', address: 'coden' },
  { name: 'tui', argument: '', summary: 'The terminal shell, and how to reach it over ssh', group: 'applications', kind: 'address', address: 'coden-tui' },
  { name: 'projects', argument: '', summary: 'The workspaces this installation knows about', group: 'applications', kind: 'address', address: 'projects' },
  { name: 'documents', argument: '', summary: 'Files ingested for the model to read', group: 'applications', kind: 'address', address: 'documents' },
  { name: 'knowledge', argument: '', summary: 'What has been indexed, and what it was drawn from', group: 'applications', kind: 'address', address: 'knowledge' },
  { name: 'memory', argument: '', summary: 'What the product remembers between sessions', group: 'applications', kind: 'address', address: 'memory' },
  { name: 'agents', argument: '', summary: 'The agents defined here, and the authority each holds', group: 'applications', kind: 'address', address: 'agents' },
  { name: 'workflows', argument: '', summary: 'Work that runs on a schedule or on a trigger', group: 'applications', kind: 'address', address: 'workflows' },
  { name: 'research', argument: '', summary: 'Search across the sources this installation can reach', group: 'applications', kind: 'address', address: 'research' },

  // CONFIGURE — changes how the product behaves. `/skills` is in §4b.4's drawing and is NOT
  // here: this product has no skills surface (measured — no such destination, no such
  // section, no such route). An entry that appears and then has nowhere to go is the failure
  // rule 3 of §4b.4 names, and drawing one to match a mockup is the worse half of it.
  { name: 'models', argument: '', summary: 'Models — which model answers, and on what hardware', group: 'configure', kind: 'address', address: 'models' },
  { name: 'modules', argument: '', summary: 'Sector modules — install, activate, remove', group: 'configure', kind: 'address', address: 'settings/modules' },
  { name: 'settings', argument: '', summary: 'Everything else about how this installation behaves', group: 'configure', kind: 'address', address: 'settings' },

  // SESSION — changes who you are. `/logout` needs a second, TYPED word rather than a key:
  // `15` §13, "in un terminale `y` è a un incollaggio di distanza dall'essere digitato da
  // qualcosa che non sei tu".
  { name: 'logout', argument: '[confirm]', summary: 'End this session — asks for `logout confirm`', group: 'session', kind: 'session', action: 'logout' },
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
/**
 * The menu this account may actually use — `CE-036`, rule 3 of `16` §4b.4: an entry the
 * account cannot use does not appear, and the list DECLARES that it was filtered.
 *
 * `authority` is `{ permissions, role }`, from the same source each shell already has: the
 * browser from `GET /api/v1/auth/me`, the terminal from its `auth.mfa` reply. Passing `null`
 * — a shell that does not know who is asking — returns everything with `accessFiltered:false`
 * rather than pretending. That is the same posture `coden.addresses` already takes, and it is
 * the difference between "you may use all of these" and "nobody checked".
 *
 * Not enforcement, and never described as such: the server checks every call regardless. This
 * decides what is worth OFFERING, so the menu never shows a door that answers 403.
 */
/**
 * The account shape `menuFor` filters by, built from whatever a shell was told about its user.
 *
 * Exported and shared because BOTH shells were assembling this object by hand, and a
 * hand-assembled object is a hand-assembled object twice: setting one of them to `null` turned
 * that shell's menu unfiltered with nothing failing (found by mutation, `M-11`). Returning
 * `null` when there is no permission array is the load-bearing part — it makes the honest
 * "nobody checked" branch the DEFAULT rather than something each shell has to remember.
 */
export function accountFromUser(user) {
  if (!user || !Array.isArray(user.permissions)) return null;
  return { permissions: user.permissions, role: user.role ?? null };
}

export function menuFor(account) {
  if (!account) return { entries: [...AGENT_COMMANDS], accessFiltered: false, hidden: 0 };
  const held = new Set(account.permissions ?? []);
  const role = account.role ?? null;
  const entries = AGENT_COMMANDS.filter((entry) => {
    if (entry.kind === 'call' && entry.permission && !held.has(entry.permission)) return false;
    const rule = entry.kind === 'address' ? accessRuleFor(entry.address) : null;
    if (rule?.role && rule.role !== role) return false;
    if (rule?.permission && !held.has(rule.permission)) return false;
    return true;
  });
  return { entries, accessFiltered: true, hidden: AGENT_COMMANDS.length - entries.length };
}

/** The groups that have at least one entry, in display order — so a group emptied entirely by
 *  the permission filter does not render as a heading over nothing. */
export function groupMenu(entries) {
  return MENU_GROUPS
    .map((group) => ({ ...group, entries: entries.filter((entry) => entry.group === group.id) }))
    .filter((group) => group.entries.length > 0);
}

export function matchCommands(word, entries = AGENT_COMMANDS) {
  const wanted = String(word ?? '').trim().toLowerCase();
  if (!wanted) return [...entries];
  return entries
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
export function resolveCommand(text, entries = AGENT_COMMANDS) {
  const parsed = parseCommandPrompt(text);
  if (!parsed) return null;
  const command = entries.find((entry) => entry.name === parsed.word);
  return command ? { command, argument: parsed.argument } : null;
}
