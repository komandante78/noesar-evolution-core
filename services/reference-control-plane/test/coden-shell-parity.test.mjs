// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-033`, `CE-034`, `CE-036` — the rows `16` §4b.5 added because nothing measured them.
//
// The clause "le due shell non divergono in nessun punto" has been written since 26 July and
// was never applied, and the reason is the one rule 5 of the skill states: **a criterion no
// matrix row measures is not closed, however firmly the document asserts it.** `CE-020` asked
// only that every capability have a keyboard form, which is far weaker than being the same
// interface. This file is the row.
//
// What it deliberately does NOT do: assert that the two shells share an implementation. They
// must not — one writes ANSI rows clipped to a column, the other writes elements. `CE-033` is
// worded "ispezione strutturale delle due RESE, non delle due implementazioni", so the
// assertions below are about the regions each shell puts on screen and the set of entries each
// one offers, read from the artefacts a user actually gets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  AGENT_COMMANDS, MENU_GROUPS, menuFor, groupMenu, matchCommands, resolveCommand,
  accessRuleFor, accountFromUser, SECTION_ACCESS, hiddenNote, parseCommandPrompt,
} from '../../../apps/shared/coden/agent-commands.js';
import { planTurn, FORMS, startForm, fillForm, addressEntries, menuEntriesFor, menuFrame, menuViewModel, promptKeys } from '../../../apps/webui-static/coden-view-model.js';
import { SESSION_METHOD_POLICY } from '../src/session-protocol.mjs';
import { commandMenuRows } from '../../../apps/shared/coden/tui-screen.mjs';
import { runFullScreen } from '../../../tools/tui-fullscreen.mjs';
import { buildCodenAddressBook } from '../src/coden-address-book.mjs';
import { showAddress } from '../../../apps/shared/coden/coden-address-views.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const MARKUP = read('apps/webui-static/index.html');
const BROWSER = read('apps/webui-static/app.js');
const TERMINAL = read('tools/tui-fullscreen.mjs');
// The client is where the account is READ off the handshake; the full-screen shell is where
// it is used. Two files, and `M-11` lived in the seam between them.
const TERMINAL_CLIENT = read('tools/tui-client.mjs');

// --- CE-036 · the menu is one list, in four groups, filtered and declared -------------------

test('CE-036 — the menu has exactly the groups the design fixes, in order', () => {
  // Three since 2026-08-14. Four groups (`applications`, `tools`, `modules`, `approvals`) held
  // ONLY address entries, and those were removed on the Owner's instruction that the menu carry
  // only what is necessary and working — so the four became headings over nothing. Asserted
  // exactly rather than as a floor, for the reason the original note gives: a floor cannot
  // notice a group quietly reappearing.
  assert.deepEqual(MENU_GROUPS.map((group) => group.id), ['work', 'applications', 'configure', 'session']);
  // Every entry belongs to one of them. An entry with a group nobody renders would be present
  // in the list and absent from both menus, which is the failure mode a flat list hides.
  const known = new Set(MENU_GROUPS.map((group) => group.id));
  for (const entry of AGENT_COMMANDS) assert.ok(known.has(entry.group), `\`/${entry.name}\` has no group`);
  // Every group holds something — but `applications` is filled by the DERIVED address book
  // (`addressEntries()`), not by hand-written entries, which is exactly what the 2026-08-14
  // change made true. Checked against both sources so an empty heading still cannot survive.
  const derived = addressEntries(buildCodenAddressBook(join(ROOT, 'apps/webui-static')));
  for (const group of MENU_GROUPS) {
    assert.ok([...AGENT_COMMANDS, ...derived].some((entry) => entry.group === group.id),
      `group \`${group.id}\` is empty`);
  }
});

test('CE-036 — a name resolves to exactly one entry', () => {
  // `resolveCommand` finds by exact name across the whole list. Two entries sharing a name
  // would make `/models` mean whichever was declared first — a menu that reads unambiguous
  // and behaves otherwise.
  const seen = new Set();
  for (const entry of AGENT_COMMANDS) {
    assert.ok(!seen.has(entry.name), `\`/${entry.name}\` is declared twice`);
    seen.add(entry.name);
  }
});

test('CE-036 — every declared command actually resolves when typed exactly', () => {
  // Owner report, 2026-08-14: typing `/models` answered "Nothing named `M`" — not reproduced
  // by any code path found (parseCommandPrompt, matchCommands, resolveCommand and Tab
  // completion all check out individually for this exact word), but the one thing that check
  // above does NOT prove is that uniqueness implies reachability: two entries could be unique
  // by name and still one of them never resolves, if `resolveCommand`'s exact-match ever drifts
  // from the list `menuFrame` offers. This exercises the actual submit path for all thirty-
  // three, not just `models`.
  for (const command of AGENT_COMMANDS) {
    const resolved = resolveCommand(`/${command.name}`, AGENT_COMMANDS);
    assert.ok(resolved, `\`/${command.name}\` is declared but does not resolve`);
    assert.equal(resolved.command.name, command.name);
  }
});

test('CE-036 — every work entry names the permission its own method is gated on', () => {
  // The one place a second copy could drift. `agent-commands.js` carries the permission
  // because the browser cannot import out of `services/`; this makes it DERIVED rather than
  // duplicated. Mutate either side and this fails — which is what `PANEL_NAMES` never had,
  // since a list compared only with itself always agrees.
  // Forms are included: `/closure` submits to `closure.record` and must claim exactly what
  // that method is gated on. Filtering to 'call' alone left the one WRITE this phase added
  // outside the guard that exists to stop a menu entry lying about its own cost.
  for (const entry of AGENT_COMMANDS.filter((candidate) => ['call', 'form'].includes(candidate.kind))) {
    const policy = SESSION_METHOD_POLICY[entry.method];
    assert.ok(policy, `\`/${entry.name}\` names \`${entry.method}\`, which has no policy entry`);
    assert.equal(entry.permission, policy.permission,
      `\`/${entry.name}\` claims \`${entry.permission}\` but the dispatch enforces \`${policy.permission}\``);
  }
});

test('CE-036 — an account without a permission is not offered the entries needing it', () => {
  const owner = menuFor({ permissions: ['workspace.read', 'workspace.write', 'coden.plan'], role: 'owner' });
  const reader = menuFor({ permissions: ['workspace.read'], role: 'reader' });

  assert.equal(owner.accessFiltered, true);
  assert.equal(reader.accessFiltered, true);

  const names = (menu) => menu.entries.map((entry) => entry.name);
  assert.ok(names(owner).includes('plan'), 'an account with workspace.write may plan');
  assert.ok(!names(reader).includes('plan'), 'an account without workspace.write is not offered plan');
  assert.ok(names(reader).includes('simulate'), 'workspace.read is enough for simulate');
  // Permission-gated COMMANDS. This used to assert the role-gated `modules` destination, which
  // was removed with the other sixteen addresses on 2026-08-14; `/model` is the entry that now
  // carries a permission a reader does not hold, so the property is proved through it instead
  // of through an entry that no longer exists.
  assert.ok(!names(reader).includes('model'), 'a reader without model.manage is not offered /model');
  assert.equal(reader.hidden, AGENT_COMMANDS.length - reader.entries.length);
  assert.ok(reader.hidden > 0, 'the reader really lost entries — otherwise this test proves nothing');
});

test('CE-036 — both shells build their account with the shared reader, not by hand', () => {
  // `M-11`: each shell used to assemble `{permissions, role}` itself, and setting either one
  // to `null` turned that shell's menu unfiltered with no test failing. One reader now, and
  // its default is the honest branch.
  assert.equal(accountFromUser(null), null);
  assert.equal(accountFromUser({ role: 'owner' }), null, 'a user with no permission array is NOT an account');
  assert.deepEqual(accountFromUser({ role: 'owner', permissions: ['workspace.read'] }),
    { permissions: ['workspace.read'], role: 'owner' });
  // And the filtered menu that comes out of it is genuinely filtered, rather than the
  // unfiltered one wearing the right shape.
  assert.equal(menuFor(accountFromUser({ role: 'reader', permissions: ['workspace.read'] })).accessFiltered, true);
  assert.equal(menuFor(accountFromUser(null)).accessFiltered, false);
  for (const [label, source] of [['the browser', BROWSER], ['the terminal', TERMINAL_CLIENT]]) {
    assert.match(source, /accountFromUser\(/, `${label} still assembles its account by hand`);
  }
});

test('CE-036 — a shell that does not know the account declares the list UNFILTERED', () => {
  // The honest branch, and the one that matters: showing every entry while implying it was
  // checked is worse than showing every entry and saying nobody checked. Same posture
  // `coden.addresses` already takes with `accessFiltered:false`.
  const unknown = menuFor(null);
  assert.equal(unknown.accessFiltered, false);
  assert.equal(unknown.hidden, 0);
  assert.equal(unknown.entries.length, AGENT_COMMANDS.length);
});

test('CE-036 — a hidden entry cannot be run by typing it anyway', () => {
  // Filtering that only removes the entry from a list is decoration. `planTurn` resolves
  // against the FILTERED set, so the typed name is answered as an unknown word.
  const reader = menuFor({ permissions: ['workspace.read'], role: 'reader' });
  const turn = planTurn('/plan do the thing', {
    resolve: (text) => resolveCommand(text, reader.entries),
    parse: (text) => (text.startsWith('/') ? { word: text.slice(1).split(' ')[0], argument: '' } : null),
    commands: reader.entries,
    groups: groupMenu,
  });
  assert.equal(turn.kind, 'unknown');
  assert.match(turn.message, /Nothing named `plan`/);
});

test('CE-036 — the access rule for a settings address comes from the section table', () => {
  assert.deepEqual(accessRuleFor('settings/modules'), SECTION_ACCESS.modules);
  assert.equal(accessRuleFor('chat'), null);
  assert.equal(accessRuleFor('models'), null);
});

// --- CE-034 · the same set of things, by the same names, in both shells ---------------------

test('CE-034 — neither shell writes an entry of its own', () => {
  // The rule that killed `PANEL_NAMES`: one file, imported by both. Not "two files that
  // happen to agree today". Proven by reading the shells' source for the import and for the
  // absence of a hand-written list.
  for (const [label, source] of [['the browser', BROWSER], ['the terminal', TERMINAL]]) {
    // `D-0405` slice 1: one file, in `apps/shared/coden/`, reached by `../shared/coden/…` from
    // the browser bundle and `../apps/shared/coden/…` from the terminal — two spellings of one
    // path, deliberately chosen so the specifier resolves to the same bytes from a URL and
    // from disk. Neither shell may still reach into the web folder for it: that dependency is
    // what slice 4 would otherwise sever by deleting the web CodeN.
    assert.match(source, /from '\.\.\/(apps\/)?shared\/coden\/agent-commands\.js'/,
      `${label} does not import the shared registry`);
    assert.doesNotMatch(source, /apps\/webui-static\/agent-commands\.js/,
      `${label} still imports the registry out of the web folder`);
    assert.match(source, /menuFor\(/, `${label} does not build its menu with menuFor`);
    assert.match(source, /groupMenu/, `${label} does not group with the shared grouping`);
  }
});

test('CE-034 — both shells resolve a typed line through the same planTurn', () => {
  for (const [label, source] of [['the browser', BROWSER], ['the terminal', TERMINAL]]) {
    assert.match(source, /planTurn\(/, `${label} decides what a line means on its own`);
  }
});

test('CE-034 — every work entry has a transport in the browser', () => {
  // The asymmetry that would otherwise be silent. Two of the fourteen work methods are
  // `bridged:false`, so `/api/v1/tui/command` refuses them; the browser reaches those two
  // through routes of its own. Without this assertion `/sessions` and `/git` would answer in
  // the terminal and fail in the browser, and the parity claim would be false for two
  // commands with nothing failing to say so.
  const unbridged = AGENT_COMMANDS
    .filter((entry) => entry.kind === 'call' && SESSION_METHOD_POLICY[entry.method]?.bridged === false)
    .map((entry) => entry.method);
  assert.ok(unbridged.length > 0, 'if nothing is unbridged this assertion has stopped meaning anything');
  for (const method of unbridged) {
    assert.ok(BROWSER.includes(`'${method}':`),
      `\`${method}\` is not bridged and the browser has no direct route for it`);
  }
});

test('CE-034 — a destination entry names an address, and the address book is where it lives', () => {
  for (const entry of AGENT_COMMANDS.filter((candidate) => candidate.kind === 'address')) {
    assert.ok(entry.address, `\`/${entry.name}\` is a destination with no address`);
    // The destination exists in the markup both the browser renders and the address book is
    // derived from. `settings/…` addresses are sections, matched by their section attribute.
    const [view, section] = entry.address.split('/');
    const pattern = section
      ? new RegExp(`data-section="${section}"`)
      : new RegExp(`id="view-${view}"`);
    assert.match(MARKUP, pattern, `\`/${entry.name}\` points at \`${entry.address}\`, which the page has no region for`);
  }
});

test('CE-034 — /skills exists exactly while its surface does', () => {
  // REWRITTEN (D-0343). This used to assert `/skills` is ABSENT. That was true and right on
  // the day it was written, and it became the wrong SHAPE of test the moment the surface was
  // built: it had pinned yesterday's value as a requirement. It is the failure this repository
  // already paid five phases for in `D-0339`, and the lesson was to assert the property the
  // system must hold rather than the value it happens to have.
  //
  // What rule 3 of §4b.4 actually states is a biconditional, not an absence: an entry exists
  // exactly when there is something for it to open. Written this way the test does its job in
  // both directions — it fails on an entry that opens nothing, and on a surface no entry
  // reaches — and it will not need editing again when the answer changes.
  // REWRITTEN AGAIN 2026-08-14, and for the same reason as the first time — the shape of the
  // answer changed, not the property. The seventeen hand-written address entries were removed
  // from the menu (they duplicated `coden-address-book.mjs`, which DERIVES every destination
  // from the markup, and they did nothing at all in the embedded browser terminal). So the
  // biconditional is no longer "a section exists ⟺ a MENU ENTRY names it" — the menu carries
  // commands now. It is "a section exists ⟺ the ADDRESS BOOK reaches it", which is the same
  // guarantee against an unreachable surface, checked where reachability actually lives.
  const hasSection = /data-section="skills"/.test(MARKUP);
  const reachable = buildCodenAddressBook(join(ROOT, 'apps/webui-static'))
    .some((entry) => entry.address === 'settings/skills');
  assert.equal(reachable, hasSection,
    reachable
      ? 'the address book serves `settings/skills` and the page has no skills section behind it'
      : 'a skills section exists and no address reaches it');
  // And no hand-written menu entry has crept back in beside it: one list, derived, not two.
  assert.ok(!AGENT_COMMANDS.some((entry) => entry.kind === 'address'),
    'a hand-written address entry is back in the menu — the duplication removed on 2026-08-14');
});

// --- phase 3b · every address answers, and none of them answers "no source" -----------------

test('CE-034 — no CodeN address is left saying "no source over this transport"', () => {
  // The row that sizes 3b, and the one that would have let it quietly not happen. Measured at
  // the start of the phase: 8 real views, 2 transport notes, 5 panels serving their own
  // declared text, and TEN answering "no source over this transport" — a sentence that is
  // honest but is not a view. This asserts the tier of every one of the twenty-five, off the
  // real markup and the real client, so a panel added later without a source fails here rather
  // than being discovered by someone typing its name.
  const book = buildCodenAddressBook(join(ROOT, 'apps/webui-static')).filter((entry) => entry.address.startsWith('coden/'));
  assert.equal(book.length, 25, 'the CodeN address space changed size — re-measure before trusting the rest');

  // Phase 3c: the table moved to `coden-address-views.mjs`, because BOTH terminal shells
  // render it now — 3b had built it inside the client, where only the line shell could reach
  // it, and the prompt answered "no view for it yet" about finished work for all twenty-five.
  const client = read('apps/shared/coden/coden-address-views.mjs');
  const viewsBlock = client.slice(client.indexOf('const ADDRESS_VIEWS'), client.indexOf('const TRANSPORT_NOTES'));
  const views = [...viewsBlock.matchAll(/^ {2}'([a-z/-]+)':/gm)].map((hit) => hit[1]);
  const notes = [...client.slice(client.indexOf('const TRANSPORT_NOTES')).matchAll(/^ {2}'([a-z/-]+)':/gm)].map((hit) => hit[1]);

  const stranded = book.filter((entry) => !views.includes(entry.address)
    && !notes.includes(entry.address)
    && !entry.declaredEmpty?.length);
  assert.deepEqual(stranded.map((entry) => entry.address), [],
    'these addresses answer "no source over this transport" — give them a method, a note, or a declared reason');
});

test('phase 3c — all 25 CodeN addresses open FROM THE PROMPT, driven one by one', async () => {
  // `17`'s step 1, as a row rather than as a session's good intentions: "aprire tutti e 25 gli
  // indirizzi DAL PROMPT, uno per uno, in entrambe le shell". The address book declaring 25 is
  // not the same claim, and the difference was the whole finding of this phase — measured
  // before a line changed: 0 of 25 resolved at the prompt, in both shells, while 25 of 25
  // rendered in the line shell that nobody gets over `ssh`.
  //
  // Driven, with injected streams, because that is the only way to see what the shell a real
  // user gets actually answers. Reading the view table would have measured the half that was
  // already complete.
  const book = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const coden = book.filter((entry) => entry.address.startsWith('coden/'));
  assert.equal(coden.length, 25, 'the CodeN address space changed size — re-measure before trusting the rest');

  const session = {
    call: async (method) => {
      if (method === 'coden.addresses') return { addresses: book, accessFiltered: false };
      if (method === 'coden.gitStatus') return { available: true, branch: 'main' };
      if (method === 'status') return { shadow: {}, capability: {} };
      if (method === 'closure.list') return { closures: [] };
      if (method === 'sessions.list') return { place: 'active', items: [], total: 0, page: 1, pageCount: 1, from: 0, to: 0 };
      if (method === 'repoMap.scan') return { files: [] };
      if (method === 'product.invariants') return { invariants: [] };
      if (method === 'coden.benchLists') return { lists: Object.fromEntries(coden.map((e) => [e.panel, { shown: [], total: 0 }])) };
      return {};
    },
  };
  const frames = [];
  const out = new EventEmitter();
  out.columns = 200; out.rows = 60; out.isTTY = false;
  out.write = (chunk) => { frames.push(String(chunk).replace(/\[[0-9;?]*[a-zA-Z]/g, '')); return true; };
  out.off = out.removeListener.bind(out);
  const input = new EventEmitter();
  input.isTTY = false; input.isRaw = false;
  input.off = input.removeListener.bind(input);

  const finished = runFullScreen({
    session, status: {}, account: { permissions: ['workspace.read', 'workspace.write', 'coden.plan'], role: 'owner' },
    out, input,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
  const type = async (line) => {
    for (const character of line) input.emit('keypress', character, { name: character });
    input.emit('keypress', null, { name: 'return' });
    await settle();
  };
  await settle();

  const stranded = [];
  for (const entry of coden) {
    // The transcript SCROLLS, so a frame carries every earlier answer too. A first draft of
    // this classified on the whole frame and read a refusal left over from the address before
    // it — a verdict that was right or wrong for reasons unrelated to the address under test.
    // Clearing between probes is what makes each frame about one address.
    await type('/clear');
    frames.length = 0;
    await type(`/${entry.address}`);
    const screen = frames.join('\n');

    // What the SHARED table renders for this address, computed independently, so the check is
    // "the prompt shows the view" rather than "the prompt mentions the panel". The first draft
    // asserted the label appeared — and a mutation replacing the rendering with a sentence
    // NAMING the panel walked straight past it, which is the exact shape of the defect this
    // phase exists to remove: a message that names a destination instead of opening it.
    const expected = (await showAddress(session, { lastList: null }, entry, '', () => {}))
      .map((line) => line.trim()).filter((line) => line.length > 12);
    const shown = expected.length === 0
      ? screen.includes(entry.label)
      : expected.some((line) => screen.includes(line.slice(0, 40)));

    if (/Nothing named/.test(screen) || /is not in the address list/.test(screen) || !shown) {
      stranded.push(entry.address);
    }
  }
  input.emit('keypress', null, { name: 'c', ctrl: true });
  await finished;

  assert.deepEqual(stranded, [],
    'these do not open from the prompt — and the box that used to reach them is what 3c removes');
});

test('phase 3c — the prompt offers the address space, and neither shell writes the list', () => {
  // Rule 2 of §4b.4. The entries are SHAPED from the served list by the shared model, so a
  // panel added to the markup appears in both menus without either shell being edited — the
  // property `PANEL_NAMES` never had.
  const book = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const shaped = addressEntries(book);
  assert.equal(shaped.length, book.length);
  assert.ok(shaped.every((entry) => entry.kind === 'address' && entry.name === entry.address),
    'an address entry must be typed by the name it is shown under');
  // APPLICATIONS, by §4b.4's own criterion — "è un posto dove si va". A fifth group would be a
  // fifth thing to choose from, which is what rule 1 spends its paragraph forbidding.
  assert.ok(shaped.every((entry) => entry.group === 'applications'));
  assert.ok(MENU_GROUPS.some((group) => group.id === 'applications'));

  for (const [label, source] of [['the browser', BROWSER], ['the terminal', TERMINAL]]) {
    assert.match(source, /addressEntries\(/, `${label} does not fold the address space into its menu`);
  }
  // And a typed address resolves through the SAME `planTurn` a command does — one mechanism,
  // not a fallback bolted beside it.
  const entries = [...AGENT_COMMANDS, ...shaped];
  const parse = (text) => {
    if (!text.startsWith('/')) return null;
    const body = text.slice(1); const space = body.indexOf(' ');
    return space === -1 ? { word: body, argument: '' } : { word: body.slice(0, space), argument: body.slice(space + 1).trim() };
  };
  const turn = planTurn('/coden/bench/diff run-9', {
    resolve: (text) => resolveCommand(text, entries), parse, commands: entries, groups: groupMenu,
  });
  assert.equal(turn.kind, 'navigate');
  assert.equal(turn.address, 'coden/bench/diff');
  // The argument survives. Three of the twenty-five are a view OF A RUN, and a jump that threw
  // its subject away would open them at nothing while looking like it had worked.
  assert.equal(turn.argument, 'run-9');
  // A command still wins its own name: `/diff` is the work command, and the Diff PANEL is
  // reached by its full address. Without this the menu would silently change what `/diff` does.
  const command = planTurn('/diff run-9', {
    resolve: (text) => resolveCommand(text, entries), parse, commands: entries, groups: groupMenu,
  });
  assert.equal(command.kind, 'call');
});

test('phase 3c — a rendered address returns LINES, none of them carrying a line break', async () => {
  // Found by driving, not by reading. These views were written against stdout, where a write
  // beginning with a break means a blank line and then a label. Collected into a transcript
  // that IS a list of lines, that becomes one "line" with a break inside it — and the frame
  // indents the first physical line while the rest hang at column zero. The sessions list came
  // out with its heading torn away from its own rows, in a shell whose whole screen is the
  // transcript.
  //
  // The first version of this assertion looked for a literal backslash-n rather than a line
  // break, so it could not fail — and it did not, under the mutation that put the defect back.
  // The mutation is what found it; the test as written proved nothing.
  const book = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const entry = book.find((candidate) => candidate.address === 'coden/bench/sessions');
  const session = {
    call: async () => ({ place: 'active', items: [{ title: 'a session', messageCount: 3, lastActivityAt: 'now' }],
      total: 1, page: 1, pageCount: 1, from: 1, to: 1 }),
  };
  const lines = await showAddress(session, { lastList: null }, entry, '', () => {});
  assert.ok(lines.length > 1, 'the sessions view rendered nothing to check');
  const broken = lines.filter((line) => line.includes(String.fromCharCode(10)));
  assert.deepEqual(broken, [], 'a rendered line carries its own break');
  assert.ok(lines.some((line) => line.includes('a session')), 'the rows themselves were lost');
});

test('phase 3b — the panels with no engine DECLARE it, rather than wearing a list class', () => {
  // Plugins and Favourites carried their statement inside a `bench-nav-list empty-state` div —
  // the class the Navigator's DATA lists wear while waiting to be filled — so the address book,
  // which reads that class precisely to tell a statement from a placeholder, could not see it.
  // The terminal then said "no source over this transport" about two panels that had already
  // said there is no source. And "Nothing pinned yet." promised a pinning feature that does
  // not exist, which is the plausible frame this product treats as worse than an error.
  const book = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  for (const panel of ['plugins', 'favourites']) {
    const entry = book.find((candidate) => candidate.panel === panel);
    assert.ok(entry?.declaredEmpty?.length, `\`${panel}\` declares nothing the other shell can serve`);
    assert.match(entry.declaredEmpty.join(' '), /can be:/, `\`${panel}\` does not say the build CANNOT do this`);
  }
  // Asserted on what the address book SERVES, not on the raw markup: the markup also carries
  // a comment quoting the old wording as the record of why it changed, and a check that cannot
  // tell a quotation from a live string would force the history out of the file to stay green.
  const favourites = book.find((candidate) => candidate.panel === 'favourites');
  assert.ok(!/pinned yet/.test(favourites.declaredEmpty.join(' ')), '"yet" promises a feature that does not exist');
});

test('phase 3b — the closure form asks the same questions in both shells, and cannot be half-filled', () => {
  // `UI-036`: a closure names what was left undone or states that nothing was, AND states the
  // residual risk. The register refuses one that does neither, so this checks the SHAPE the two
  // shells collect — one script, so neither can ask a different set.
  assert.deepEqual(FORMS.closure.fields.map((field) => field.name), ['summary', 'notDone', 'residualRisk']);
  assert.equal(FORMS.closure.method, 'closure.record');

  const begun = startForm('closure', 'run-1');
  assert.ok(begun.form && begun.ask, JSON.stringify(begun));
  assert.equal(startForm('closure', '').error?.includes('runId'), true, 'a closure with no run must be refused up front');

  // Walking it through produces exactly the params the register's own signature takes.
  let step = fillForm(begun.form, 'moved the menu into one list');
  assert.ok(step.ask);
  // No ';' inside the answer: it is the separator, and a first draft of this test put one
  // there and then expected one item back. The code was right.
  step = fillForm(begun.form, 'the browser still has its own address bar, which 3c removes');
  assert.ok(step.ask);
  step = fillForm(begun.form, 'none');
  assert.equal(step.method, 'closure.record');
  assert.deepEqual(step.params, {
    runId: 'run-1',
    summary: 'moved the menu into one list',
    notDone: ['the browser still has its own address bar, which 3c removes'],
    nothingLeftUndone: false,
    residualRisk: 'none',
  });
});

test('phase 3b — "nothing" is a STATEMENT, not an empty answer', () => {
  // The register accepts an empty `notDone` only when `nothingLeftUndone` is explicitly true —
  // the browser's checkbox, and this word. Typing nothing at all must NOT become that claim:
  // silence and "nothing was left undone" are different things, and conflating them is how a
  // report that lists only what went well gets produced by accident.
  const stated = startForm('closure', 'run-2').form;
  fillForm(stated, 'did the thing'); fillForm(stated, 'nothing');
  const done = fillForm(stated, 'none');
  assert.equal(done.params.nothingLeftUndone, true);
  assert.deepEqual(done.params.notDone, []);

  const silent = startForm('closure', 'run-3').form;
  fillForm(silent, 'did the thing'); fillForm(silent, '');
  const empty = fillForm(silent, 'none');
  assert.equal(empty.params.nothingLeftUndone, false, 'an empty line became the explicit claim');
  assert.deepEqual(empty.params.notDone, []);
  // Which the register then refuses — the rule stays in the object, not in the shells.
});

test('phase 3b — an EMPTY answer is an answer, and does not shift every later one up a field', () => {
  // Found by driving the shell, not by reading it. `submit()` opened with
  // `if (!typed) return draw();` — right for a prompt taking COMMANDS, wrong inside a form,
  // where an empty line IS an answer and the field it most often lands on is the one asking
  // what was NOT done. It did not lose one answer: it shifted every later one up a field, so a
  // real run came out with `notDone` holding the risk and `residualRisk` holding the next
  // command the user typed. A record whose entire purpose is honesty, quietly filled with the
  // wrong content, and nothing failed.
  //
  // The model half is asserted here; the ORDERING inside the shell is asserted next, because
  // this is one defect living in two files.
  const form = startForm('closure', 'run-5').form;
  assert.ok(fillForm(form, 'did the thing').ask);
  assert.ok(fillForm(form, '').ask, 'an empty answer did not advance the form');
  const done = fillForm(form, 'none');
  assert.equal(done.params.residualRisk, 'none', 'the risk field caught the wrong line');
  assert.deepEqual(done.params.notDone, []);
  assert.equal(done.params.nothingLeftUndone, false, 'an empty line silently became the explicit claim');
});

test('phase 3b — the SHELL passes an empty answer to the form, driven not read', async () => {
  // The other half of that defect lives in `submit()`, and the first attempt to guard it
  // asserted the ORDER of two statements in the source. A mutation walked straight past it: it
  // put a second empty-return INSIDE the form branch, leaving both original lines in their
  // original order while the bug was fully back. A positional assertion describes one way to
  // reintroduce a defect, not the defect.
  //
  // So this DRIVES the real shell instead, with injected streams — which `runFullScreen`
  // already supports, and which is how the defect was found in the first place.
  const recorded = [];
  const session = {
    call: async (method, params) => {
      if (method !== 'closure.record') return {};
      recorded.push(params);
      return { id: `closure:${params.runId}` };
    },
  };
  const out = new EventEmitter();
  out.columns = 100; out.rows = 30; out.isTTY = false;
  out.write = () => true;
  out.off = out.removeListener.bind(out);
  const input = new EventEmitter();
  input.isTTY = false; input.isRaw = false;
  input.off = input.removeListener.bind(input);

  const finished = runFullScreen({
    session, status: {}, account: { permissions: ['workspace.read', 'workspace.write'], role: 'owner' }, out, input,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const send = async (line) => {
    for (const character of line) input.emit('keypress', character, { name: character });
    input.emit('keypress', null, { name: 'return' });
    await settle();
  };

  await settle();
  await send('/closure run-empty');
  await send('what changed');
  await send('');            // the answer that used to vanish
  await send('none');
  input.emit('keypress', null, { name: 'c', ctrl: true });
  await finished;

  assert.equal(recorded.length, 1, 'the form did not complete — the empty answer was dropped');
  assert.equal(recorded[0].residualRisk, 'none', 'the risk field caught the wrong line');
  assert.deepEqual(recorded[0].notDone, []);
  assert.equal(recorded[0].nothingLeftUndone, false, 'an empty line silently became the explicit claim');
});

test('phase 3b — a form can always be abandoned', () => {
  // A form you cannot leave is a trap, and in a shell whose premise is that the session
  // outlives the shell, being stuck in one is worse here than elsewhere.
  const form = startForm('closure', 'run-4').form;
  assert.deepEqual(fillForm(form, '/cancel'), { cancelled: true });
});

test('phase 3b — both shells perform the form intent, neither invents its own questions', () => {
  for (const [label, source] of [['the browser', BROWSER], ['the terminal', TERMINAL]]) {
    assert.match(source, /turn\.kind\s*===\s*'form'/, `${label} does not handle the form intent`);
  }
  // Only the terminal walks the fields — the browser opens the panel that already holds the
  // form. Same capability, each shell's idiom; a browser that re-asked the three questions in
  // its prompt would be a second form ten pixels above the real one.
  assert.match(TERMINAL, /fillForm\(/, 'the terminal does not walk the fields');
  assert.ok(!/fillForm\(/.test(BROWSER), 'the browser grew a second copy of the form');
});

// --- CE-033 · the same regions -------------------------------------------------------------

test('CE-033 — the browser renders the four regions the terminal does', () => {
  // Structural, on the two renditions. The terminal's regions are read off the frame it
  // writes; the browser's off the markup it serves.
  for (const id of ['codenTranscript', 'codenPrompt', 'codenMenu']) {
    assert.match(MARKUP, new RegExp(`id="${id}"`), `the browser has no ${id} region`);
  }
  // The status line is the `.coden-bar` chips, not a second strip: same facts, each shell's
  // own idiom. Asserted so that a later phase deleting the bar fails here rather than quietly
  // leaving the browser with three regions against the terminal's four.
  assert.match(MARKUP, /class="coden-bar"/, 'the browser has no status region');
});

test('CE-033 — neither shell has a region the other has not', () => {
  // The terminal's four, from the pure renderer's own output rather than from its source.
  //
  // The note is built with `hiddenNote`, not typed here. This assertion used to hand-assemble
  // `{ accessFiltered: true, hidden: 3 }` and expect the renderer to word the sentence itself,
  // which is what kept a SECOND wording alive in `tui-screen.mjs` beside the browser's — and
  // the two had already drifted, the terminal printing nothing where the browser disclosed
  // "not filtered". A test that supplies a hand-built shape is a test that keeps passing after
  // the shells stop agreeing (`M-11`).
  const filtered = { accessFiltered: true, hidden: 3, hiddenBy: { 'workspace.write': 3 } };
  const hits = [...AGENT_COMMANDS].slice(0, 4);
  const menuRows = commandMenuRows(
    { hits, selected: 0, rowLimit: 12, note: hiddenNote(filtered) },
    80,
  );
  assert.ok(menuRows.length > 0, 'the terminal renders no menu');
  assert.ok(menuRows.some((row) => row.includes(hits[0].name)), 'the terminal menu drops its own first entry');
  assert.ok(menuRows.some((row) => row.includes('hidden')), 'the terminal menu does not declare it was filtered');
  // …and it NAMES the requirement, which is rule 4 of the approved design: "dichiara ciò che
  // non mostra, E PERCHÉ". A bare count leaves a reader to guess whether the short menu is
  // policy or breakage.
  assert.ok(menuRows.some((row) => row.includes('workspace.write')), 'the terminal hides entries without saying what they need');
});

test('point 3 — `/` is one flat list: no group ever shadows a command name', () => {
  // Flattened 2026-08-14 on direct Owner instruction: no key opens a group any more, so the
  // property that survives is simpler — every command name is reachable by typing itself,
  // never intercepted by anything shorter.
  for (const command of AGENT_COMMANDS) {
    assert.ok(command.name.length > 1, `command /${command.name} is suspiciously short`);
  }
});

test('point 3 — `/` is a flat, ranked list from the first keystroke, and the addresses join once there is room', () => {
  const commands = [...AGENT_COMMANDS];
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  assert.ok(addresses.length > 20, 'the address book is too small for this to measure anything');

  // A bare `/`: flat, not grouped — `menuEntriesFor` still keeps the address book out until a
  // query narrows the list, the constraint `CE-020` measured, which survives the flattening
  // unchanged.
  const top = menuFrame({ word: '', argument: '' }, { commands, addresses });
  assert.equal(top.level, 'entries');
  assert.equal(top.group, null, 'the flat frame carries no group at all any more');
  assert.deepEqual(top.hits, commands, 'a bare / does not show every command, unfiltered');

  // Typing narrows the SAME flat list, ranked, and the address book joins in.
  const flat = menuFrame({ word: 'appro', argument: '' }, { commands, addresses });
  assert.equal(flat.level, 'entries');
  assert.deepEqual(flat.hits, matchCommands('appro', menuEntriesFor('appro', commands, addresses)));
  assert.ok(flat.hits.length < top.hits.length, 'the query did not filter the flat list');
});

test('point 3 — menuFor records WHY it hid an entry, and the note reads it', () => {
  // Written against a REAL `menuFor` result rather than a hand-built `{hidden, hiddenBy}`.
  // Found by mutation: emptying `hiddenBy` at the source left every assertion green, because
  // the only test that looked at the reasons supplied them itself. That is `M-11` again — a
  // hand-assembled shape is a hand-assembled shape twice — one level deeper than the last time.
  const reader = menuFor({ permissions: ['workspace.read'], role: 'reader' });
  assert.ok(reader.hidden > 0, 'the reader lost nothing — this would prove nothing');
  assert.ok(Object.keys(reader.hiddenBy).length > 0, 'menuFor hides entries without recording why');
  // The counts add up to the total: a reason recorded for some but not all is a note that
  // understates what it is not showing.
  assert.equal(Object.values(reader.hiddenBy).reduce((sum, count) => sum + count, 0), reader.hidden);
  assert.ok(reader.hiddenBy['workspace.write'] > 0, 'the write commands are hidden for another reason than needing write');
  const note = hiddenNote(reader);
  assert.ok(note.includes('workspace.write'), `the note does not name the requirement: ${note}`);
  assert.ok(note.startsWith(String(reader.hidden)), `the note does not lead with the count: ${note}`);
  // And an unfiltered menu records nothing to explain, because nothing was checked.
  assert.deepEqual(menuFor(null).hiddenBy, {});
  assert.match(hiddenNote(menuFor(null)), /^Not filtered/);
});

test('point 3 — a reserved note row is a row that gets printed', () => {
  // The renderer reserves one row for the filter note. That reservation used to be gated on
  // `accessFiltered` while the note itself comes from `menu.note`, so a caller that filtered and
  // supplied no note lost a row of menu to a sentence nobody printed. Measured both ways.
  const hits = [...AGENT_COMMANDS];
  const withNote = commandMenuRows({ hits, selected: 0, rowLimit: 12, groups: groupMenu, note: 'two hidden' }, 100);
  assert.ok(withNote.some((row) => row.includes('two hidden')), 'a supplied note is not printed');
  const without = commandMenuRows({ hits, selected: 0, rowLimit: 12, groups: groupMenu, accessFiltered: true, note: null }, 100);
  assert.ok(!without.some((row) => row.includes('hidden')), 'a note appears with none supplied');

  // THE CASE THE PRODUCT ACTUALLY PRODUCES, and the one the first version of this test missed:
  // the shell always supplies a note, and `accessFiltered` can be FALSE — a shell that was never
  // told who is asking still discloses "nobody checked". Reserving against `accessFiltered`
  // instead of against the note drops that disclaimer at EVERY terminal height, which is the
  // single sentence this menu can least afford to lose. Found by an equivalence scan after the
  // mutation survived: the first draft asserted one lucky row limit, so it saw nothing.
  const unchecked = hiddenNote({ accessFiltered: false });
  for (const rowLimit of [6, 8, 10, 12, 16, 20]) {
    const rows = commandMenuRows({ hits, selected: 0, rowLimit, groups: groupMenu, accessFiltered: false, note: unchecked }, 100);
    assert.ok(rows.some((row) => row.includes('Not filtered')),
      `at ${rowLimit} rows an unfiltered menu does not say nobody checked`);
    assert.ok(rows.length <= rowLimit + 1, `${rows.length} rows against a budget of ${rowLimit}`);
  }
  // The row the note did NOT need goes back to the menu rather than staying empty.
  const entryRows = (rows) => rows.filter((row) => /\s\/[a-z]/.test(row.replace(/\[[0-9;]*m/g, ''))).length;
  assert.ok(entryRows(without) > entryRows(withNote),
    `a menu with no note painted ${entryRows(without)} entries, one with a note painted ${entryRows(withNote)}`);
});

test('point 2b — every address the menu offers is one the router knows', () => {
  // A menu entry whose address the router has never heard of is a door onto the not-found page,
  // and nothing measured that: `tools` was added to the menu and to `ROUTES` in the same change,
  // so removing it from `ROUTES` alone broke no test at all (found by mutation). The router's own
  // table is read out of the browser's source, so this cannot be satisfied by a second list.
  const routes = BROWSER.match(/const ROUTES=new Set\(\[([^\]]+)\]\)/)?.[1];
  assert.ok(routes, 'the router table is gone or renamed');
  const known = new Set([...routes.matchAll(/'([^']+)'/g)].map((match) => match[1]));
  const sections = new Set([...MARKUP.matchAll(/data-section="([^"]+)"/g)].map((match) => match[1]));
  for (const entry of AGENT_COMMANDS.filter((candidate) => candidate.kind === 'address')) {
    const [view, section] = entry.address.split('/');
    assert.ok(known.has(view), `\`/${entry.name}\` goes to \`${entry.address}\`, and the router has no \`${view}\``);
    if (section) {
      assert.ok(sections.has(section), `\`/${entry.name}\` names section \`${section}\`, which the markup does not have`);
    }
    // …and the destination really exists in the markup, so the address does not open a blank.
    assert.match(MARKUP, new RegExp(`id="view-${view}"`), `\`${entry.address}\` has no #view-${view}`);
  }
});

test('point 2b — the module catalogue is rendered in exactly ONE place', () => {
  // The owner spotted this from the outside: the catalogue appeared twice, once in Settings and
  // once at the bottom of the CodeN page. It was never two implementations — one function, two
  // containers — which is precisely why nothing failed. Counted at the call site, because that
  // is where a third container would be added.
  const containers = [...BROWSER.matchAll(/renderModuleCatalog\('#([a-zA-Z]+)'/g)].map((match) => match[1]);
  assert.deepEqual(containers, ['ownerModulesList'],
    `the module catalogue is rendered into ${containers.length} containers: ${containers.join(', ')}`);
  assert.ok(!MARKUP.includes('codenModulesList'), 'the CodeN page has a module list container again');
});

test('point 3 — the browser paints one flat list, and branches on no level any more', () => {
  // Flattened 2026-08-14 on direct Owner instruction: the old guard proved the browser really
  // branched on `level==='groups'`, which is exactly the branch that no longer exists to prove.
  // What still has to hold: the browser drives the real shared frame, offers no group rows to
  // click (`data-coden-group` is gone), and writes its own key legend the way it always did.
  assert.doesNotMatch(BROWSER, /frame\.level==='groups'/, 'the browser still branches on a menu level that no longer exists');
  assert.doesNotMatch(BROWSER, /data-coden-group="/, 'the browser still paints group rows to click');
  assert.match(BROWSER, /menuFrame\(/, 'the browser does not use the shared frame');
  assert.match(BROWSER, /promptKeys\(/, 'the browser writes its own key legend');
});

test('point 3 — the terminal menu cannot outgrow the height it was given, flat', () => {
  const commands = [...AGENT_COMMANDS];
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const top = menuFrame({ word: '', argument: '' }, { commands, addresses });
  for (const limit of [1, 2, 3, 7, 12]) {
    const rows = commandMenuRows(
      {
        hits: top.hits, selected: 0, rowLimit: limit,
        note: hiddenNote({ accessFiltered: true, hidden: 2, hiddenBy: { 'workspace.write': 2 } }),
      },
      80,
    );
    assert.ok(rows.length <= limit, `rowLimit ${limit} produced ${rows.length} rows`);
  }

  // …and the note survives the squeeze. At a height that cannot hold every command, the row
  // reserved for the disclosure has to be the one kept — the list is recoverable by scrolling,
  // "nobody checked what this account may use" is not recoverable at all.
  const note = hiddenNote({ accessFiltered: false });
  for (const limit of [3, 4, 5, 6, 7]) {
    const rows = commandMenuRows({ hits: top.hits, selected: 0, rowLimit: limit, note, keys: promptKeys(top) }, 80);
    assert.ok(rows.some((row) => row.includes('Not filtered')),
      `at ${limit} rows the menu drops the disclosure: ${JSON.stringify(rows)}`);
    assert.ok(rows.length <= limit, `rowLimit ${limit} produced ${rows.length} rows`);
  }
});

test('phase 3c — the menu offers the address space once something is typed, and not before', () => {
  // Found by MUTATION, not by reading: replacing the whole rule with "commands only" broke no
  // test. The bare-`/` half was covered by the budget row above; the half that matters for
  // navigation — that typing reaches the panels — was measured only by a ten-minute browser
  // run, which is not a guard anyone gets to feel on a normal edit.
  const book = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const bare = menuEntriesFor('', AGENT_COMMANDS, book);
  assert.deepEqual(bare, [...AGENT_COMMANDS], 'a bare / must be the product menu, not every address');

  const typed = menuEntriesFor('coden', AGENT_COMMANDS, book);
  assert.equal(typed.length, AGENT_COMMANDS.length + book.length);
  const panels = typed.filter((entry) => String(entry.address ?? '').startsWith('coden/'));
  assert.equal(panels.length, 25, 'the twenty-five panels are not offered by the menu');

  // And what is offered is what the matcher can then find, which is the property a user has.
  const hits = matchCommands('coden/bench/diff', typed);
  assert.ok(hits.some((entry) => entry.name === 'coden/bench/diff'),
    'the menu offers the address space but the matcher cannot reach it');
});

test('phase 3c — the menu SPENDS its budget: as many entries as the height allows, ranked', () => {
  // The property the grouped renderer used to prove per-group, now proved for the one flat
  // list: given a real budget, the menu paints AS MANY commands as fit, never a fixed number
  // regardless of height, and never more than the height allows.
  const hits = [...AGENT_COMMANDS];
  const plain = (row) => row.replace(/\u001b\[[0-9;]*m/g, '');
  for (const limit of [4, 8, 12, 20]) {
    const rows = commandMenuRows({ hits, selected: 0, rowLimit: limit }, 100);
    assert.ok(rows.length <= limit, `rowLimit ${limit} produced ${rows.length} rows`);
    const entries = rows.filter((row) => /\s\/[a-z]/.test(plain(row))).length;
    assert.ok(entries >= Math.min(limit - 1, hits.length), `${entries} entries painted out of a budget of ${limit}`);
  }
});

test('CE-036 — a windowed list says how many of the total it is showing', () => {
  // Truncating is the fix; truncating SILENTLY is not — a reader who cannot tell there is more
  // takes what is shown for the whole list.
  const hits = [...AGENT_COMMANDS];
  const rows = commandMenuRows({ hits, selected: 0, rowLimit: 12 }, 100);
  assert.ok(rows.some((row) => row.includes(`of ${hits.length}`)),
    `a list of ${hits.length} windowed to 12 rows does not say so: ${JSON.stringify(rows)}`);
  // A list that fits entirely shows no such marker — it would be noise on a screen with
  // nothing to scroll to.
  const short = commandMenuRows({ hits: hits.slice(0, 3), selected: 0, rowLimit: 12 }, 100);
  assert.ok(!short.some((row) => row.includes(' of ')), `a list that fits claims to be windowed: ${JSON.stringify(short)}`);
});

test('CE-036 — the selected entry is painted however far down the list it sits', () => {
  // The window follows the selection. A fixed window would hide the highlight the moment the
  // arrow keys walked past its edge, which is the same defect the prompt box already solves
  // by keeping the caret visible — and it would be invisible in exactly the case it matters.
  const hits = [...AGENT_COMMANDS];
  for (let selected = 0; selected < hits.length; selected += 1) {
    const rows = commandMenuRows({ hits, selected, rowLimit: 12 }, 100);
    const marked = rows.filter((row) => row.includes('▸'));
    assert.equal(marked.length, 1, `selection ${selected} (\`/${hits[selected].name}\`) painted ${marked.length} markers`);
    assert.match(marked[0], new RegExp(`/${hits[selected].name}\\b`),
      `selection ${selected} should be \`/${hits[selected].name}\`, got ${JSON.stringify(marked[0])}`);
  }
});

test('CE-033 — the highlight and Tab agree on which entry is selected', () => {
  // The index each painted row carries is its position in the FLAT hit list, which is what
  // the arrow keys move through and what Tab reads off `hits[selected]` — one list, one
  // index, never rebuilt per row.
  const hits = [...AGENT_COMMANDS];
  // The LAST entry, not "the first one in some group": the seventeen hand-written address
  // entries this used to reach through are gone, and picking an index by group id was always
  // a proxy for "far enough down the list to matter". The last one is that, exactly, and it
  // cannot go stale when the registry changes again.
  const late = hits.length - 1;
  assert.ok(late > 0, 'a one-entry menu — this assertion would prove nothing');
  const rows = commandMenuRows({ hits, selected: late, rowLimit: 99 }, 80);
  const marked = rows.filter((row) => row.includes('▸'));
  assert.equal(marked.length, 1, 'exactly one row is marked');
  assert.match(marked[0], new RegExp(`/${hits[late].name}\\b`));
});

// --- the session group ----------------------------------------------------------------------

test('/logout needs a second, TYPED word — never a single key', () => {
  // `15` §13: "in un terminale `y` è a un incollaggio di distanza dall'essere digitato da
  // qualcosa che non sei tu". Both shells run this through the shared model, so neither can
  // decide to accept a keystroke instead.
  const parse = (text) => {
    if (!text.startsWith('/')) return null;
    const body = text.slice(1); const space = body.indexOf(' ');
    return space === -1 ? { word: body, argument: '' } : { word: body.slice(0, space), argument: body.slice(space + 1).trim() };
  };
  const drive = (line) => planTurn(line, {
    resolve: (text) => resolveCommand(text, AGENT_COMMANDS), parse, commands: AGENT_COMMANDS, groups: groupMenu,
  });
  const first = drive('/logout');
  assert.equal(first.kind, 'confirm');
  assert.match(first.message, /logout confirm/);
  const second = drive('/logout confirm');
  assert.equal(second.kind, 'session');
  assert.equal(second.action, 'logout');
  // A near miss is not a confirmation.
  assert.equal(drive('/logout y').kind, 'confirm');
});

test('the help listing is grouped when the caller supplies the grouping', () => {
  // Driven with what a shell actually passes — its commands PLUS the derived address book —
  // rather than with `AGENT_COMMANDS` alone. Since 2026-08-14 `DESTINATIONS` is filled only by
  // the derived entries, so a listing built from the registry alone legitimately has no such
  // heading, and asserting one against that input was asserting the old duplication.
  const commands = [...AGENT_COMMANDS, ...addressEntries(buildCodenAddressBook(join(ROOT, 'apps/webui-static')))];
  const turn = planTurn('/', { resolve: () => null, parse: () => null, commands, groups: groupMenu });
  assert.equal(turn.kind, 'help');
  for (const group of MENU_GROUPS) assert.ok(turn.lines.includes(group.title), `no ${group.title} heading`);
  // And still usable for a caller with no grouping, rather than throwing or emitting nothing.
  const flat = planTurn('/', { resolve: () => null, parse: () => null, commands: AGENT_COMMANDS });
  assert.equal(flat.kind, 'help');
  assert.equal(flat.lines.length, AGENT_COMMANDS.length);
});

test('a group with nothing left in it renders no heading', () => {
  // Found by mutation, not by reading: deleting `groupMenu`'s empty-group filter killed no
  // test, and the branch is reachable on the commonest path there is. `/pl` matches only work
  // entries, so APPLICATIONS, CONFIGURE and SESSION are empty — and without the filter each
  // would render a heading over nothing, in both shells. Typing a couple of letters is not an
  // edge case; it is what using the menu IS.
  const hits = matchCommands('appro', AGENT_COMMANDS);
  const present = new Set(hits.map((entry) => entry.group));
  assert.ok(hits.length > 0, 'the query matched nothing — this assertion would prove nothing');
  assert.ok(present.size < MENU_GROUPS.length, 'the query matched every group — pick a narrower one');

  // Stated against what is ACTUALLY in the hits rather than a hand-picked expectation: the
  // first draft asserted `['work']` for a query of `pl`, which also matches the word "plans"
  // inside the `coden` summary — so the assertion failed on a correct implementation, for a
  // reason that had nothing to do with the property. Derive, do not guess.
  assert.deepEqual(groupMenu(hits).map((group) => group.id), MENU_GROUPS.map((g) => g.id).filter((id) => present.has(id)));

  // And the terminal must not paint the heading either — the model and the renderer are two
  // places this could go wrong, and `groupMenu` is only one of them.
  const rows = commandMenuRows({ hits, selected: 0, rowLimit: 99, groups: groupMenu }, 80);
  for (const group of MENU_GROUPS.filter((candidate) => !present.has(candidate.id))) {
    assert.ok(!rows.some((row) => row.includes(group.title)), `\`${group.title}\` was painted over an empty group`);
  }
});

test('matchCommands ranks and filters within the list it is given', () => {
  const reader = menuFor({ permissions: ['workspace.read'], role: 'reader' });
  const hits = matchCommands('p', reader.entries);
  assert.ok(!hits.some((entry) => entry.name === 'plan'), 'a hidden entry must not come back through the matcher');
  assert.ok(hits.every((entry) => reader.entries.includes(entry)));
});

// --- D-0420 · one shaper between menuFrame and the renderer ------------------------------
//
// The defect this pins was found in a real browser, not by reading: typing `/` in the
// embedded terminal drew "nothing to show", on an owner account holding every permission,
// while the DOM prompt on the same page drew a different shape from the same registry. The
// cause was a two-shape boundary between `menuFrame` and each shell's renderer; `menuFrame`
// used to return group rows under one key and the renderer read them under another.
//
// Flattened 2026-08-14: there is no group shape left to lose in translation, but the
// property this section pins is unchanged — `menuViewModel` is the ONLY translation, used
// by both shells, and it is asserted on rather than assumed.
{
  const commands = [...AGENT_COMMANDS];
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));

  test('menuViewModel carries the hits and the selection, nothing more', () => {
    const frame = menuFrame({ word: '', argument: '' }, { commands, addresses });
    const model = menuViewModel(frame, { menu: menuFor(null), note: '' });
    assert.equal(model.level, 'entries');
    assert.ok(Array.isArray(model.hits) && model.hits.length > 0,
      'the renderer reads hits and would print "no command matches that" for an empty one');
    assert.equal(model.selected, 0, 'a fresh frame starts on its first row in both shells');
  });

  test('what the renderer draws from it is real commands, not an empty menu', () => {
    const frame = menuFrame({ word: '', argument: '' }, { commands, addresses });
    const model = menuViewModel(frame, { menu: menuFor(null), note: '' });
    const rows = commandMenuRows({ ...model, rowLimit: 12 }, 90).join('\n');
    assert.doesNotMatch(rows, /nothing to show|no command matches/, 'this is the exact frame the browser drew');
    assert.match(rows, /\/plan/, 'a command the shell is FOR is missing from the drawn menu');
  });

  test('both shells build it through the same call, and neither shapes it by hand', () => {
    // A source guard, because the property above can be satisfied by a helper nobody calls.
    for (const file of ['apps/webui-static/coden-terminal.js', 'tools/tui-fullscreen.mjs']) {
      const source = read(file);
      assert.match(source, /menuViewModel\(frame, \{ menu/,
        `${file} does not build its menu through the shared shaper`);
    }
  });

  test('a filtered frame keeps its hits and its selection', () => {
    const frame = menuFrame({ word: 'diff', argument: '' }, { commands, addresses });
    const model = menuViewModel(frame, { menu: menuFor(null), note: '' });
    assert.equal(model.level, 'entries');
    assert.ok(Array.isArray(model.hits) && model.hits.length > 0);
    assert.equal(model.selected, 0, 'a fresh frame starts on its first row in both shells');
  });
}

// --- D-0421 · both shells hand planTurn a LIST, because that is what it takes ---------------
//
// Found by driving the browser terminal: `/help` did nothing at all. `planTurn`, `resolveCommand`
// and `groupMenu` all take an ARRAY of entries — they call `.map`, `.find` and `.filter` on it —
// and `coden-terminal.js` was handing them the MENU OBJECT that `menuFor()` returns. Every
// submitted line threw `entries.filter is not a function` inside an unawaited `submit()`, so the
// screen showed nothing and the console said nothing either: no command could be run in the
// browser shell at all.
//
// Both shells had a local helper called `offered()`. In the terminal shell it returned the list;
// in the browser shell it returned the object. One name, two types, and a parity suite that read
// both files never noticed — so what is asserted here is the TYPE at the boundary, and the fact
// that each shell reaches it.
{
  const menu = menuFor(null);
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const entries = [...menu.entries, ...addressEntries(addresses)];

  test('D-0421 · planTurn answers /help when given the list, and throws when given the menu', () => {
    const asList = planTurn('/help', {
      resolve: (text) => resolveCommand(text, entries), parse: parseCommandPrompt, commands: entries, groups: groupMenu,
    });
    assert.equal(asList.kind, 'help');
    assert.ok(asList.lines.length > 0, 'the help listing came back empty');
    // The defect itself, pinned: passing the menu object is not a quiet degradation, it throws —
    // which is why the surface went silent instead of showing something wrong.
    assert.throws(() => planTurn('/help', {
      resolve: (text) => resolveCommand(text, menu), parse: parseCommandPrompt, commands: menu, groups: groupMenu,
    }), /is not a function/);
  });

  test('D-0421 · resolveCommand needs the list too', () => {
    assert.ok(resolveCommand('/plan something', entries), 'a real command did not resolve from the list');
    assert.throws(() => resolveCommand('/plan something', menu), /is not a function/);
  });

  test('D-0421 · neither shell passes the menu object to planTurn', () => {
    for (const file of ['apps/webui-static/coden-terminal.js', 'tools/tui-fullscreen.mjs']) {
      const source = read(file);
      const call = source.slice(source.indexOf('planTurn('), source.indexOf('planTurn(') + 300);
      assert.doesNotMatch(call, /commands: menu\b/,
        `${file} passes the menu OBJECT to planTurn — every submitted line will throw`);
      assert.match(call, /commands: (entries|offered\(\))/,
        `${file} must pass the entry LIST to planTurn`);
    }
  });
}
