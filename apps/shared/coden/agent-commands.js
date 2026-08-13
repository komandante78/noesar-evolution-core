// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The slash commands of the coding agent — ONE list, imported by both shells.
//
// This file lives in `apps/shared/coden/` on purpose: the browser fetches it as a module
// (`app.js` is `type="module"`, and the server serves this tree at `/shared/coden/`), and the
// terminal client imports it off disk. Not a copy in each shell that happens to agree, and not
// a list served over the protocol either — a literal single file, which is the strongest
// version of the rule `D-0300` established for addresses after `PANEL_NAMES` had drifted to
// fourteen entries against a markup of twenty-five.
//
// It used to live under `apps/webui-static/`, which made the terminal — a shell with no
// browser — depend on the web folder for its own vocabulary. `D-0405` moved it out before
// anything is removed, because deleting the web CodeN while the TUI still imported out of it
// would have taken the TUI's command set with it. The specifier `../shared/coden/…` was chosen
// because it resolves to the same file from disk (Node) and from `/`-rooted URL (browser); a
// module both shells import cannot afford two different answers.
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

/** The groups, in display order. The heading text lives here so neither shell writes its own
 *  — the same reason the entries do.
 *
 * # Points 2 and 3 of the owner's list — the key is what you TYPE, and it IS the mechanism
 *
 * `/` was a flat list of thirty entries under four headings, and both shells had already
 * MEASURED what a flat list costs without either of them calling it a defect:
 *
 *  - `commandMenuRows` divides an eight-row budget across the groups and prints
 *    `WORK  5 of 15`, because the list does not fit at a terminal height;
 *  - `menuEntriesFor` deliberately keeps the fifty-three addresses OUT of the bare `/`,
 *    because folding them in took APPLICATIONS from eleven entries to sixty-four and pushed
 *    `/approve` off the menu entirely (`CE-020` caught that one).
 *
 * Both are the same fact — a flat menu does not scale — and both were *declared* rather than
 * repaired. So `/` gains exactly one level: a bare `/` lists the GROUPS, a single letter opens
 * one, and a letter followed by text filters inside it (`/t mcp`). Two speeds, one mechanism:
 * whoever does not know browses, whoever knows types and skips the level.
 *
 * The key is not a shortcut sitting beside the list. It is the group's address, the same way
 * `coden/bench/diff` is a panel's — which is why the same `/` reaches both and why neither
 * shell needs a second gesture.
 *
 * **The cost, stated rather than hidden:** a key is one character and every command name is
 * longer than one, so a key can never shadow a command — but `/w` opens WORK instead of
 * filtering for `workflows`. Typing a second letter filters as it always did. That the keys
 * are unique, single, and shorter than every command name is asserted rather than assumed
 * (`menu-group-keys`), because this file is exactly where a hand-kept list drifts.
 */
export const MENU_GROUPS = Object.freeze([
  { id: 'work', key: 'w', title: 'WORK' },
  // Renamed from APPLICATIONS with the key. `a` belongs to APPROVALS and a group whose key is
  // `d` cannot go on calling itself APPLICATIONS; the group's own criterion in `16` §4b.4 has
  // always been "le destinazioni del prodotto — è un posto dove si va", so the heading now says
  // what the criterion says. The `id` is untouched: entries carry it, and renaming a heading is
  // not a reason to rewrite thirty `group:` fields.
  { id: 'applications', key: 'd', title: 'DESTINATIONS' },
  // POINT 2b — the stack that used to be scrolled to at the bottom of the CodeN page. The
  // owner named it item by item (Strumenti · Strumenti installati · Installable catalogues ·
  // LOCAL ONLY VERIFIED · Approvals) and the approved mockup gives those items keys of their
  // own rather than a heading on a page. They are groups instead of three more rows in
  // DESTINATIONS for the reason the whole point exists: sixty-four destinations under one
  // heading is the flat list again, one level down.
  //
  // A group holding one entry is not a defect and is not padded to look fuller — the row says
  // `1 entry` and means it. What would be a defect is a NAMED place in the owner's model with
  // nowhere to go, which is what these three were.
  { id: 'tools', key: 't', title: 'TOOLS' },
  { id: 'modules', key: 'm', title: 'MODULES' },
  { id: 'approvals', key: 'a', title: 'APPROVALS' },
  { id: 'configure', key: 'c', title: 'CONFIGURE' },
  { id: 'session', key: 's', title: 'SESSION' },
]);

/**
 * The group a typed word opens, or `null` — an EXACT single-character key, nothing else.
 *
 * Deliberately not a prefix match: `/mo` must go on filtering for `models`/`modules`/`memory`
 * the way it always has, and a lookup that accepted prefixes would turn every second keystroke
 * into a level change. One character means one thing, and the guard above proves no command
 * name is one character long, so this can never intercept a command.
 */
export function groupFor(word) {
  const wanted = String(word ?? '').trim().toLowerCase();
  if (!wanted) return null;
  // Exact, not a prefix, and that is the whole rule. A length check used to stand here as well
  // and it was DEAD: an equality against a one-character key already rejects every longer word,
  // so no input could reach it and no mutation could kill it. A guard that cannot fail is a
  // guard nobody can trust — the invariant it was defending (every key is one character, every
  // command name is longer) is asserted where it can actually be measured, in
  // `menu-group-keys`.
  return MENU_GROUPS.find((group) => group.key === wanted) ?? null;
}

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
  // Phase 3b. A FORM, not a call: `UI-036` makes a closure name what was left undone or
  // state that nothing was, plus the residual risk, and the register refuses one that does
  // neither. Three fields with a mandatory refusal clause do not fit on a prompt line, so each
  // shell renders the same capability its own way (`coden-view-model.js`'s `FORMS`): the
  // browser opens the panel that already holds the form, the terminal walks the fields.
  { name: 'closure', argument: '<run>', summary: 'Close a piece of work — what was done, what was NOT, and the residual risk', group: 'work', kind: 'form', method: 'closure.record', permission: 'workspace.write' },
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

  // CONFIGURE — changes how the product behaves.
  //
  // `/skills` was absent here for three sessions, and the comment that stood in its place was
  // right to refuse it: there was no destination, no section and no route, and an entry that
  // appears and then has nowhere to go is the failure rule 3 of §4b.4 names. It is here now
  // because all three exist — `settings/skills` is DERIVED from the markup by
  // `coden-address-book.mjs` rather than written down a second time, `skill-catalog.mjs` is
  // the surface behind it, and `skills.status`/`skills.search` carry it to the terminal so
  // both shells reach the same object. The order of those facts is the whole point: the entry
  // followed the surface, it did not summon it.
  { name: 'skills', argument: '', summary: 'Skills — what the agent knows how to do, and what adopting one costs in context', group: 'configure', kind: 'address', address: 'settings/skills' },
  { name: 'models', argument: '', summary: 'Models — which model answers, and on what hardware', group: 'configure', kind: 'address', address: 'models' },
  { name: 'settings', argument: '', summary: 'Everything else about how this installation behaves', group: 'configure', kind: 'address', address: 'settings' },

  // TOOLS · MODULES · APPROVALS — point 2b. What the CodeN page used to hold at the bottom of
  // its own scroll, as places with addresses.
  //
  // `/tools` is NEW, and the measurement that produced it is the point of the whole item: the
  // Tools surface had no address at ALL. It was a `work-block` nested inside `view-coden`, so
  // it was not a nav button, not a settings section and not a bench panel — the three shapes
  // `coden-address-book.mjs` reads — and therefore existed for the browser's scrollbar and for
  // nothing else. The terminal could not reach a registered tool, and no test could say so,
  // because you cannot assert a gap in a list nobody keeps.
  { name: 'tools', argument: '', summary: 'Registered tools — local, MCP and OpenAPI, and what each is allowed to do', group: 'tools', kind: 'address', address: 'tools' },
  // Moved out of CONFIGURE rather than copied: `/modules` is one entry and stays one entry.
  // Its page is also the ONLY render of the catalogue now — the CodeN page used to draw the
  // same list a second time through a second container, which is the divergence `D-0300` named
  // and the owner spotted from the outside.
  { name: 'modules', argument: '', summary: 'Sector modules — the one catalogue: install, activate, remove', group: 'modules', kind: 'address', address: 'settings/modules' },
  // The queue the permanent footer strip counts. The strip could always be CLICKED and never
  // typed: `Open queue` went to `settings/audit` while no command named it, so the one thing
  // the product interrupts you about was the one thing the menu could not reach.
  { name: 'approvals', argument: '', summary: 'Everything waiting for a human decision, whichever subsystem raised it', group: 'approvals', kind: 'address', address: 'settings/audit' },

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
  if (!account) return { entries: [...AGENT_COMMANDS], accessFiltered: false, hidden: 0, hiddenBy: {} };
  const held = new Set(account.permissions ?? []);
  const role = account.role ?? null;
  // WHY an entry is not offered, counted per requirement — rule 4 of the approved design:
  // "dichiara ciò che non mostra, E PERCHÉ". `N hidden` alone tells a reader the menu is
  // shorter than the product and leaves them to guess whether that is policy or breakage,
  // which is the same ambiguity `accessFiltered:false` exists to remove one level up.
  //
  // Counted here rather than recomputed by a renderer: the reason is known exactly once, at
  // the moment the entry is rejected, and any later attempt to work it out again would be a
  // second copy of this filter written in a shell.
  const hiddenBy = {};
  const deny = (requirement) => {
    hiddenBy[requirement] = (hiddenBy[requirement] ?? 0) + 1;
    return false;
  };
  const entries = AGENT_COMMANDS.filter((entry) => {
    if (entry.kind === 'call' && entry.permission && !held.has(entry.permission)) return deny(entry.permission);
    const rule = entry.kind === 'address' ? accessRuleFor(entry.address) : null;
    if (rule?.role && rule.role !== role) return deny(`the ${rule.role} role`);
    if (rule?.permission && !held.has(rule.permission)) return deny(rule.permission);
    return true;
  });
  return { entries, accessFiltered: true, hidden: AGENT_COMMANDS.length - entries.length, hiddenBy };
}

/**
 * The one sentence the menu says about what it is not showing — written HERE because both
 * shells were writing their own, in different words, off the same two fields.
 *
 * Three states, and the third is the one that matters: filtered and complete, filtered and
 * short (with the requirement named), or *not filtered at all* — a shell that was never told
 * who is asking says so rather than implying the list is everything this account may use.
 * Same posture `coden.addresses` takes with `accessFiltered:false`.
 *
 * # Why the translator is INJECTED and not imported (s336, voice stage 2)
 *
 * Two of these three sentences are COMPOSED — a count and a list of permission names sit inside
 * them — so the finished string can never be a catalogue key: `5 hidden — they need
 * workspace.write` would miss in every language forever and be reported as a coverage gap no
 * catalogue could close. `i18n.js` states the rule for this case: compose from translated parts.
 *
 * The parts therefore have to be translated HERE, where the composing happens, and that means
 * this module needs a translator. Importing one would have been wrong twice over: the terminal
 * imports this same file and has no `i18n.js` at all, and a shared registry that reaches for
 * browser state is a shared registry only by accident. Injected with an identity default, the
 * terminal keeps today's English by doing nothing and the browser passes `t` — the same shape
 * `planTurn` already uses for `resolve` and `parse`, and for the same stated reason.
 *
 * The permission names are NOT passed through the translator. `workspace.write` is a token the
 * server matches against; a translated one would name a permission that does not exist.
 */
export function hiddenNote(menu, translate = (text) => text) {
  if (!menu?.accessFiltered) return translate('Not filtered — this shell does not know what this account may use');
  const hidden = menu.hidden ?? 0;
  if (!hidden) return translate('Filtered for this account');
  // Most-blocking requirement first, then alphabetically so the sentence is stable between
  // renders: a note whose wording changes on every repaint reads as a fault.
  const reasons = Object.entries(menu.hiddenBy ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([requirement]) => requirement);
  return reasons.length
    ? `${hidden} ${translate('hidden — they need')} ${reasons.join(', ')}`
    : `${hidden} ${translate('hidden — this account may not use them')}`;
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
