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
 *  — the same reason the entries do. `id`/`title` still organise `/help`'s printed command
 *  list and the language catalogues; there is no navigable group LEVEL any more.
 *
 * # Flattened 2026-08-14, on direct Owner instruction
 *
 * `/` used to be two levels: a bare `/` listed these groups, a single letter (`key`) entered
 * one, and a letter followed by text filtered inside it. Measured complaint: that read as a
 * menu under a menu, and finding a command meant first knowing — or guessing — which of seven
 * groups held it. `matchCommands` already ranks hits (name starts with, then contains, then
 * summary contains), so the ranked list a person wants is already on top; `/` now shows it
 * directly, windowed to the box height, the same shape a Claude Code `/` palette uses. See
 * `menuFrame`/`commandMenuRows` for the mechanism this replaced.
 *
 * # Three groups removed 2026-08-14, with the entries that were in them
 *
 * `TOOLS`, `MODULES` and `APPROVALS` held ONLY hand-written address entries — removed below —
 * so with those gone they were three headings over nothing. A heading over an empty group is
 * the "door with no room behind it" `groupMenu` already refuses to render; this removes the
 * door rather than leaving it to be filtered out at paint time.
 *
 * `DESTINATIONS` STAYS, and the distinction is the whole point of that change: what was removed
 * is the seventeen destinations written down BY HAND here, duplicating what
 * `coden-address-book.mjs` already derives from the markup. The derived ones — all 54 of them —
 * are still shaped into this group by `addressEntries()` and still appear the moment something
 * is typed. So the group is no longer a hand-kept list that can drift; it is the heading over
 * the list the product derives from itself.
 */
export const MENU_GROUPS = Object.freeze([
  { id: 'work', title: 'WORK' },
  { id: 'applications', title: 'DESTINATIONS' },
  { id: 'configure', title: 'CONFIGURE' },
  { id: 'session', title: 'SESSION' },
]);

/* `groupFor` (a single-character key opening a group) was removed with the group navigation
 * level it served — nothing resolves a typed word to a group any more, only `matchCommands`
 * ranking it among the flat hits. */

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
  { name: 'measure', argument: '<run>', summary: 'Run a plan in the shadow and show what it does — nothing reaches the workspace', group: 'work', kind: 'call', method: 'workspace.measure', permission: 'workspace.write' },
  { name: 'approve', argument: '<run>', summary: 'Approve a MEASURED plan — promotes the shadow you were shown', group: 'work', kind: 'call', method: 'workspace.approve', permission: 'workspace.write' },
  { name: 'reject', argument: '<run> [why]', summary: 'Reject a pending plan', group: 'work', kind: 'call', method: 'workspace.reject', permission: 'workspace.write' },
  { name: 'restore', argument: '<run>', summary: 'Undo a promoted run', group: 'work', kind: 'call', method: 'workspace.restore', permission: 'workspace.write' },
  { name: 'diff', argument: '<run>', summary: 'What a run changed, against the shadow', group: 'work', kind: 'call', method: 'workspace.get', permission: null },
  { name: 'map', argument: '[path]', summary: 'Scan the workspace: languages, entry points, symbols', group: 'work', kind: 'call', method: 'repoMap.scan', permission: 'workspace.read' },
  { name: 'search', argument: '<text>', summary: 'Literal search across the workspace', group: 'work', kind: 'call', method: 'repoMap.search', permission: 'workspace.read' },
  // `web` and not `search`: the line above searches the WORKSPACE, and two commands whose names
  // differ by a qualifier nobody reads is how a person sends their code to a search engine by
  // accident. `CE-020` is what required this to exist at all — a capability the engine exposes
  // with no keyboard form fails that row, and `research.search` had none.
  { name: 'web', argument: '<text>', summary: 'Search the web through the search instance this operator runs — results come back unverified', group: 'work', kind: 'call', method: 'research.search', permission: 'workspace.read' },
  { name: 'events', argument: '<id>', summary: 'The causal event trail of a piece of work', group: 'work', kind: 'call', method: 'events.correlation', permission: null },
  { name: 'status', argument: '', summary: 'Engine status, authority, shadow', group: 'work', kind: 'call', method: 'status', permission: null },
  // `D-0577`. Two verbs, not one, because listing and withdrawing are two permissions — see
  // `SESSION_METHOD_POLICY`. Before this, the only way to name a live grant was to have kept
  // the mint response; the only way to stop one was to wait for it to lapse.
  { name: 'grants', argument: '', summary: 'The capability grants this engine is holding right now', group: 'work', kind: 'call', method: 'capability.grants', permission: 'workspace.read' },
  { name: 'revoke', argument: '<token>', summary: 'Withdraw a live grant before it lapses — the ledger records what it covered', group: 'work', kind: 'call', method: 'capability.revoke', permission: 'workspace.write' },
  // `D-0606`, answering `D-0598`. Same two-verb shape as `grants`/`revoke`, and for a sharper
  // reason: `retention` shows what a sweep would delete and deletes nothing, `sweep` deletes.
  // One verb with a `--force` flag would put a destructive act one forgotten word away from a
  // read, in a shell where the previous line is one arrow key up.
  { name: 'retention', argument: '', summary: 'What a sweep of the replay store would remove — and removes nothing', group: 'work', kind: 'call', method: 'replay.retention', permission: 'workspace.read' },
  { name: 'sweep', argument: '', summary: 'Delete replay bytes no surviving run references — the ledger keeps saying the calls happened', group: 'work', kind: 'call', method: 'replay.sweep', permission: 'workspace.write' },
  // `CE-024`, the product's own metric. No argument, for `retention`'s reason above: the number
  // is derived from the runs this installation holds, and a window an operator could widen by
  // typing would let the metric be chosen instead of measured.
  { name: 'review', argument: '', summary: 'How long human review costs per change — rejections included, because excluding them would pick the denominator', group: 'work', kind: 'call', method: 'review.latency', permission: 'workspace.read' },
  { name: 'sessions', argument: '[active|archived|bin]', summary: 'List sessions', group: 'work', kind: 'call', method: 'sessions.list', permission: 'workspace.read' },
  { name: 'git', argument: '', summary: 'Branch and divergence of the workspace', group: 'work', kind: 'call', method: 'coden.gitStatus', permission: 'coden.plan' },

  // `D-0590`, closing `CE-020`. Six capabilities the engine exposed and gated, and that nothing
  // in the shell an `ssh` user gets could reach. Four had no keyboard path anywhere; two —
  // `sessions.get` and `sessions.action` — existed only as bare-word verbs in the LINE shell,
  // which `tui-client.mjs` runs only when stdin is a pipe. That is worse than a plain gap: it
  // reads as covered from the file, and a person at a real prompt cannot get to it. Same shape
  // as `D-0405`'s address views, and invisible for the same reason.
  //
  // They go here, in the one list both shells import, so the browser gains them in the same
  // change — `CE-034` fails on a capability one shell has and the other does not.
  { name: 'runs', argument: '[scope]', summary: 'The runs this workspace is holding, newest first', group: 'work', kind: 'call', method: 'workspace.runs', permission: 'workspace.read' },
  { name: 'session', argument: '<id>', summary: 'Everything one session holds — its work, its branches, its state', group: 'work', kind: 'call', method: 'sessions.get', permission: 'workspace.read' },
  // `confirm: true`, and the reason is `15` §13: in a terminal a lone `y` is one paste away from
  // being typed by something that is not you. The line shell already refused to archive or bin a
  // session without a confirmation, and a slash command that skipped it would have made the
  // full-screen shell the CHEAPER way to do the more dangerous thing. `purge` cannot be undone.
  { name: 'session-action', argument: '<archive|bin|purge|restore> <id> confirm', summary: 'Archive, bin, purge or restore a session — asks for the word `confirm`', group: 'work', kind: 'call', method: 'sessions.action', permission: 'workspace.write', confirm: true },
  // `<paths>` and not `[paths]`: BOTH transports refuse an empty path list by name — the socket
  // with `INVALID`, the route with a 400 — so an optional argument here would send every bare
  // `/divergence` to a refusal the person never asked for. `s333 point 2` again, avoided by
  // reading what the engine actually requires instead of choosing the friendlier-looking bracket.
  { name: 'divergence', argument: '<paths>', summary: 'How this repository writes: the conventions a change to these paths is held to', group: 'work', kind: 'call', method: 'coden.divergence', permission: 'coden.plan' },
  { name: 'skills', argument: '', summary: 'Which skills this installation has, and whether each one is usable', group: 'work', kind: 'call', method: 'skills.status', permission: null },
  { name: 'skills-search', argument: '<text>', summary: 'Find a skill by what it does, not by its name', group: 'work', kind: 'call', method: 'skills.search', permission: 'workspace.read' },
  // Phase 3b. A FORM, not a call: `UI-036` makes a closure name what was left undone or
  // state that nothing was, plus the residual risk, and the register refuses one that does
  // neither. Three fields with a mandatory refusal clause do not fit on a prompt line, so each
  // shell renders the same capability its own way (`coden-view-model.js`'s `FORMS`): the
  // browser opens the panel that already holds the form, the terminal walks the fields.
  { name: 'closure', argument: '<run>', summary: 'Close a piece of work — what was done, what was NOT, and the residual risk', group: 'work', kind: 'form', method: 'closure.record', permission: 'workspace.write' },
  { name: 'help', argument: '', summary: 'These commands', group: 'work', kind: 'shell', method: null, permission: null },
  { name: 'clear', argument: '', summary: 'Clear the transcript on screen (the session keeps its state)', group: 'work', kind: 'shell', method: null, permission: null },

  // SEVENTEEN address entries stood here and were REMOVED 2026-08-14, on the Owner's
  // instruction that the `/` menu show only what is necessary and working: "in / non si
  // capisce nulla, metti solo quello necessario e funzionante". Three measurements, not a
  // preference:
  //
  //   1. They were a SECOND copy. `coden-address-book.mjs` already derives all thirteen
  //      top-level destinations from the markup (measured: 54 addresses, every one of these
  //      among them), so nothing became unreachable — typing `/settings` still resolves,
  //      through the one list that is derived rather than hand-kept. This is the exact
  //      `PANEL_NAMES` duplication this project has already paid for twice.
  //   2. They did NOTHING in the browser terminal — the surface the Owner actually uses.
  //      `coden-terminal.js` had no `navigate` branch at all, so all seventeen address
  //      commands were a silent no-op there: no message, no movement, nothing. Fixed in the
  //      same change, so the addresses that remain (the bench panels, which have real views)
  //      finally answer.
  //   3. In the browser they duplicated the sidebar, which carries all thirteen as buttons.
  //
  // What a `/` menu in a shell is FOR is commands that act. Going somewhere is what a sidebar
  // and an address are for, and both still work.
  //
  // `/models` is the one the Owner reported by name: it navigated to a page that could show
  // status and could not load anything, which is what "non fa inserire il modello" describes.
  // `/model <id>` is what replaced it — a command that acts.
  //
  // CONFIGURE — changes how the product behaves.
  //
  // `D-0444`. The catalogue (what is present on disk, verified by sha256) and the local model
  // runtime (configure/release/launch) both already existed and had never been joined to a
  // command. Scoped to a model already present: acquiring a new one is a separate transport
  // this installation does not have (`/api/v1/models/acquire` answers 501 and says so).
  //
  // `[id]`, not `<id>` (Owner, 2026-08-15): a required argument nobody can discover is the same
  // dead end `s333 point 2` already named for `/diff` and friends — `/model` with no id would
  // fall into `needs-argument` and say only that an id is needed, never which ones exist. Made
  // optional so `planTurn` treats it as an ordinary call: the SAME `model.activate` handler,
  // given no id, answers with what is actually loadable right now instead of refusing.
  { name: 'model', argument: '[id]', summary: 'List models present on this installation, or load one by id', group: 'configure', kind: 'call', method: 'model.activate', permission: 'model.manage' },

  // Owner, 2026-08-26: "togli modello, sempre con doppio consenso" — asked for the browser's
  // picker and built there first, which left the terminal without it. `CE-034` fails on a
  // capability one shell has and the other does not, so it is a command here rather than a
  // second button somewhere.
  //
  // `confirm: true` is the same gate `/session-action` uses, and for the reason `15` §13 states:
  // in a terminal a lone `y` is one paste away from being typed by something that is not you. It
  // is also the terminal's rendition of the picker's two-act `Free` → `Free it` — one rule, two
  // shells, neither of them cheaper than the other.
  { name: 'model-free', argument: '[confirm]', summary: 'Unload the model from memory — asks for the word `confirm`; chat cannot answer until one is started again', group: 'configure', kind: 'call', method: 'model.deactivate', permission: 'model.manage', confirm: true },

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
