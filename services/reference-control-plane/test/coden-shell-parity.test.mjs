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
  accessRuleFor, accountFromUser, SECTION_ACCESS, groupFor, hiddenNote, parseCommandPrompt,
} from '../../../apps/shared/coden/agent-commands.js';
import { planTurn, FORMS, startForm, fillForm, addressEntries, menuEntriesFor, menuFrame, menuViewModel, menuGroupRows, promptKeys } from '../../../apps/webui-static/coden-view-model.js';
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
  // Four until point 2b. The stack the owner named at the bottom of the CodeN page (Strumenti ·
  // Strumenti installati · Installable catalogues · Approvals) left the page and became keys of
  // its own, which is what "le sezioni escono dalla pagina principale" has to mean once there
  // is only one door. Asserted exactly rather than as a floor, for the reason the original note
  // gives: a floor cannot notice a group quietly reappearing.
  assert.deepEqual(MENU_GROUPS.map((group) => group.id),
    ['work', 'applications', 'tools', 'modules', 'approvals', 'configure', 'session']);
  // Every entry belongs to one of them. An entry with a group nobody renders would be present
  // in the list and absent from both menus, which is the failure mode a flat list hides.
  const known = new Set(MENU_GROUPS.map((group) => group.id));
  for (const entry of AGENT_COMMANDS) assert.ok(known.has(entry.group), `\`/${entry.name}\` has no group`);
  for (const group of MENU_GROUPS) {
    assert.ok(AGENT_COMMANDS.some((entry) => entry.group === group.id), `group \`${group.id}\` is empty`);
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
  // Role-gated destinations, through the SAME table the browser hides its nav with.
  assert.ok(names(owner).includes('modules'), 'the Owner is offered the modules section');
  assert.ok(!names(reader).includes('modules'), 'a non-owner is not offered an owner-only section');
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
  const hasEntry = AGENT_COMMANDS.some((entry) => entry.name === 'skills');
  const hasSection = /data-section="skills"/.test(MARKUP);
  assert.equal(hasEntry, hasSection,
    hasEntry
      ? '`/skills` is in the menu and the page has no skills section for it to open'
      : 'a skills section exists and no menu entry reaches it');

  if (hasEntry) {
    const entry = AGENT_COMMANDS.find((item) => item.name === 'skills');
    assert.equal(entry.group, 'configure', '§4b.4 puts skills in CONFIGURE');
    assert.equal(entry.address, 'settings/skills');
  }
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
  const menuRows = commandMenuRows(
    {
      hits: [...AGENT_COMMANDS].slice(0, 4), selected: 0, rowLimit: 12, groups: groupMenu,
      note: hiddenNote(filtered),
    },
    80,
  );
  assert.ok(menuRows.length > 0, 'the terminal renders no menu');
  assert.ok(menuRows.some((row) => row.includes('WORK')), 'the terminal menu has no group headings');
  assert.ok(menuRows.some((row) => row.includes('hidden')), 'the terminal menu does not declare it was filtered');
  // …and it NAMES the requirement, which is rule 4 of the approved design: "dichiara ciò che
  // non mostra, E PERCHÉ". A bare count leaves a reader to guess whether the short menu is
  // policy or breakage.
  assert.ok(menuRows.some((row) => row.includes('workspace.write')), 'the terminal hides entries without saying what they need');
});

test('point 3 — the group keys can never shadow a command, and are unique', () => {
  // The whole progressive mechanism rests on one character meaning one thing. Two groups
  // sharing a key, or a command named as short as a key, would make `/t` ambiguous — and
  // `MENU_GROUPS` is exactly the kind of hand-kept table that drifts, so it is asserted rather
  // than trusted.
  const keys = MENU_GROUPS.map((group) => group.key);
  assert.equal(new Set(keys).size, keys.length, 'two groups share a key');
  for (const key of keys) assert.equal(String(key).length, 1, `group key ${key} is not one character`);
  for (const command of AGENT_COMMANDS) {
    assert.ok(command.name.length > 1, `command /${command.name} is as short as a group key`);
  }
  for (const group of MENU_GROUPS) assert.equal(groupFor(group.key)?.id, group.id);
  // A prefix is NOT a key: `/mo` must go on filtering for models/modules/memory.
  assert.equal(groupFor('mo'), null);
  assert.equal(groupFor(''), null);
  assert.equal(groupFor('z'), null);
});

test('point 3 — `/` lists groups, a key opens one, and the addresses come back', () => {
  const commands = [...AGENT_COMMANDS];
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  assert.ok(addresses.length > 20, 'the address book is too small for this to measure anything');

  // Level zero: one row per group, never one row per entry. The count is the number that made
  // a flat menu impossible — `menuEntriesFor` keeps the addresses out of a bare `/` precisely
  // because they did not fit.
  const top = menuFrame({ word: '', argument: '' }, { commands, addresses });
  assert.equal(top.level, 'groups');
  assert.equal(top.groups.length, groupMenu([...commands, ...addressEntries(addresses)]).length);
  assert.ok(top.groups.length < 10, 'level zero is not a short list');

  // …and the addresses are COUNTED there rather than dropped: the row says how many places the
  // group holds, not how many a renderer felt like painting.
  const destinations = top.groups.find((row) => row.id === 'applications');
  assert.ok(destinations.count > addresses.length, 'the destinations row does not include the address space');
  assert.ok(destinations.hint.length > 0, 'a group row carries no hint');
  // The hint is DERIVED from the entries, never written beside them.
  assert.equal(destinations.hint, [...commands, ...addressEntries(addresses)]
    .filter((entry) => entry.group === 'applications').slice(0, 3).map((entry) => entry.name)
    .join(' · '));

  // A key opens exactly one group, and everything in it — including the addresses a bare `/`
  // could not afford to list.
  const opened = menuFrame({ word: 'd', argument: '' }, { commands, addresses });
  assert.equal(opened.level, 'entries');
  assert.equal(opened.group.id, 'applications');
  assert.equal(opened.hits.length, destinations.count);
  assert.ok(opened.hits.every((entry) => entry.group === 'applications'));

  // A key plus text filters INSIDE the group — `/d diff` — and never leaves it.
  const filtered = menuFrame({ word: 'd', argument: 'diff' }, { commands, addresses });
  assert.ok(filtered.hits.length > 0, 'nothing matched inside the group');
  assert.ok(filtered.hits.length < opened.hits.length, 'the argument did not filter');
  assert.ok(filtered.hits.every((entry) => entry.group === 'applications'));

  // Anything longer than a key is the flat filter, unchanged.
  const flat = menuFrame({ word: 'appro', argument: '' }, { commands, addresses });
  assert.equal(flat.level, 'entries');
  assert.equal(flat.group, null);
  assert.deepEqual(flat.hits, matchCommands('appro', menuEntriesFor('appro', commands, addresses)));
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

test('point 3 — the browser really branches on the level, and does not just import the frame', () => {
  // A source guard that only looks for `menuFrame(` is satisfied by a page that calls it and
  // then ignores the answer — mutation proved it: replacing the level-zero branch with `if(false)`
  // left this file green and only the browser suite noticed. The branch itself is asserted now,
  // and the browser suite still drives the real thing.
  assert.match(BROWSER, /frame\.level==='groups'/, 'the browser does not branch on the menu level');
  assert.match(BROWSER, /data-coden-group="/, 'the browser paints no group rows');
  assert.match(BROWSER, /promptKeys\(/, 'the browser writes its own key legend');
});

test('point 3 — both shells paint level zero, off the same frame', () => {
  const commands = [...AGENT_COMMANDS];
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const top = menuFrame({ word: '', argument: '' }, { commands, addresses });

  // The terminal. Group rows carry the key, the title and the count — the three things you
  // cannot work out from anything else on the screen.
  const rows = commandMenuRows({ level: 'groups', groupRows: top.groups, selected: 0, rowLimit: 12, note: null, keys: promptKeys(top) }, 90);
  for (const group of top.groups) {
    assert.ok(rows.some((row) => row.includes(group.title)), `the terminal drops the ${group.title} row`);
  }
  assert.ok(rows.some((row) => row.includes('⏎ enter')), 'the terminal does not say which key enters a group');

  // The browser paints the same rows from the same frame — asserted on its source, since this
  // markup is written by `app.js` rather than shipped in `index.html`.
  const app = readFileSync(join(ROOT, 'apps/webui-static/app.js'), 'utf8');
  assert.match(app, /menuFrame\(/, 'the browser does not use the shared frame');
  assert.match(app, /data-coden-group=/, 'the browser has no group row to click');
  assert.match(app, /hiddenNote\(/, 'the browser words the filter note itself');
});

test('point 3 — the terminal menu still cannot outgrow its height at level zero', () => {
  const commands = [...AGENT_COMMANDS];
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const top = menuFrame({ word: '', argument: '' }, { commands, addresses });
  for (const limit of [1, 2, 3, 7, 12]) {
    const rows = commandMenuRows(
      {
        level: 'groups', groupRows: top.groups, selected: 0, rowLimit: limit,
        note: hiddenNote({ accessFiltered: true, hidden: 2, hiddenBy: { 'workspace.write': 2 } }),
      },
      80,
    );
    assert.ok(rows.length <= limit, `rowLimit ${limit} produced ${rows.length} rows at level zero`);
  }

  // …and the note survives the squeeze here too. At a height that cannot hold every group row,
  // the row reserved for the disclosure has to be the one that is kept — the group rows are
  // recoverable by scrolling, "nobody checked what this account may use" is not recoverable at
  // all. Measured at limits BELOW the group count, which is where the two forms diverge; the
  // first draft only tested comfortable heights and the mutation walked through it.
  const note = hiddenNote({ accessFiltered: false });
  for (const limit of [3, 4, 5, 6, 7]) {
    const rows = commandMenuRows(
      { level: 'groups', groupRows: top.groups, selected: 0, rowLimit: limit, note, keys: promptKeys(top) },
      80,
    );
    assert.ok(rows.some((row) => row.includes('Not filtered')),
      `at ${limit} rows level zero drops the disclosure: ${JSON.stringify(rows)}`);
    assert.ok(rows.length <= limit, `rowLimit ${limit} produced ${rows.length} rows at level zero`);
  }
});

test('point 3 — menuGroupRows drops a group with nothing in it', () => {
  // A heading over nothing is a door with no room behind it — the rule `groupMenu` already
  // applies one level down.
  const rows = menuGroupRows([{ name: 'plan', group: 'work' }]);
  assert.deepEqual(rows.map((row) => row.id), ['work']);
  assert.equal(rows[0].count, 1);
  assert.deepEqual(menuGroupRows([]), []);
});

test('CE-033 — the terminal menu cannot outgrow the height it was given', () => {
  // Group headings are rows too. Counting only the entries let a menu of four groups push the
  // prompt off the bottom of a short terminal — and the prompt is the one row that must never
  // move.
  for (const limit of [1, 3, 7, 12]) {
    const rows = commandMenuRows(
      { hits: [...AGENT_COMMANDS], selected: 0, rowLimit: limit, groups: groupMenu, accessFiltered: true, hidden: 0 },
      80,
    );
    assert.ok(rows.length <= limit + 1, `rowLimit ${limit} produced ${rows.length} rows`);
  }
});

test('CE-036 — every group is reachable at a real terminal height', () => {
  // Found by DRIVING the shell, not by reading it. `renderFrame` gives the menu `h/3` rows, so
  // a 30-row terminal budgets ten — and spending them first-come meant WORK's fourteen entries
  // took all ten and APPLICATIONS, CONFIGURE and SESSION never rendered. "Una casella, tutto
  // il prodotto" is false if three quarters of the product only appears once you already know
  // what to type. No unit test failed; the menu simply showed one group.
  // POINT 3 MOVED THIS PROPERTY, it did not weaken it. "Every group is reachable" was a claim
  // about the BARE `/`, and the bare `/` is no longer a flat list of every entry — it is one row
  // per group, so the guarantee now lives at level zero and is stronger there: it holds by
  // construction (one row each) instead of by an arithmetic that happened to fit four groups
  // and stopped fitting seven. What the flat branch below still owes is a different and true
  // thing — it is the FILTERED view, so it must show the matches and never lose the selection.
  const commands = [...AGENT_COMMANDS];
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));
  const top = menuFrame({ word: '', argument: '' }, { commands, addresses });
  for (const rowLimit of [10, 12, 16]) {
    const rows = commandMenuRows({ level: 'groups', groupRows: top.groups, selected: 0, rowLimit, note: null }, 100);
    for (const group of MENU_GROUPS) {
      assert.ok(rows.some((row) => row.includes(group.title)),
        `at ${rowLimit} rows level zero never shows ${group.title}: ${JSON.stringify(rows)}`);
    }
    assert.ok(rows.length <= rowLimit, `${rows.length} rows against a budget of ${rowLimit}`);
  }

  // And the filtered branch keeps its own half of the old guarantee: whatever it can afford to
  // paint, it paints — no group heading over an empty share, no unspent rows.
  const hits = [...AGENT_COMMANDS];
  for (const rowLimit of [10, 12, 16]) {
    const rows = commandMenuRows({ hits, selected: 0, rowLimit, groups: groupMenu, note: null }, 100);
    assert.ok(rows.length <= rowLimit + 1, `${rows.length} rows against a budget of ${rowLimit}`);
    assert.ok(rows.length >= Math.min(rowLimit, hits.length), `${rows.length} rows left a budget of ${rowLimit} unspent`);
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

test('phase 3c — the menu SPENDS its budget, instead of one entry per group', () => {
  // Red since 3a, and nothing said so. 3a fixed a real defect — WORK's fourteen entries were
  // taking every row and three groups never rendered — by giving each group an EQUAL share.
  // An equal share is not a shared budget: `floor((limit - headings - note) / groups)` is 1 at
  // any ordinary height, so the menu showed "WORK 1 of 15" and `/approve` was not on the list
  // the shell exists for. The tests written for 3a asserted that every group APPEARS and that
  // the rows FIT; both stayed true through two phases. `CE-020` failed the whole time and is
  // not part of `npm test`, so nobody read it.
  const hits = [...AGENT_COMMANDS];
  const work = AGENT_COMMANDS.filter((entry) => entry.group === 'work').length;
  const rows = commandMenuRows({ hits, selected: 0, rowLimit: 20, groups: groupMenu, accessFiltered: true, hidden: 0 }, 100);
  // Stripped first: a painted row carries ANSI, so the `/` is preceded by an escape rather
  // than by whitespace and a naive pattern counts zero of them.
  const plain = (row) => row.replace(/\u001b\[[0-9;]*m/g, '');
  const entries = rows.filter((row) => /\s\/[a-z]/.test(plain(row))).length;
  assert.ok(entries >= 12, `the menu painted ${entries} entries out of a budget of 20 rows`);
  const workRow = plain(rows.find((row) => row.includes('WORK')));
  const showing = Number(/ (\d+) of /.exec(workRow)?.[1] ?? work);
  assert.ok(showing > 1, `WORK shows ${showing} of ${work} — the budget is not being spent`);

  // What a SHORT group cannot use goes to the others rather than sitting unspent. SESSION holds
  // one entry; an allocator that reserves an equal share for it wastes the difference.
  const session = AGENT_COMMANDS.filter((entry) => entry.group === 'session').length;
  assert.equal(session, 1, 'SESSION is no longer the short group this asserts through');
  assert.ok(showing > Math.floor(20 / MENU_GROUPS.length),
    `WORK got ${showing}, no more than an equal share would have given it`);

  // 3a's property still holds where it can: every group the budget REACHES is reachable, and
  // what it cannot reach is declared rather than dropped. Seven groups do not fit under twelve
  // rows with entries beneath each; the honest answer is the `⋯ N groups above` marker plus the
  // level-zero list, not a heading over nothing.
  for (const limit of [4, 8, 12, 20]) {
    const tight = commandMenuRows({ hits, selected: 0, rowLimit: limit, groups: groupMenu }, 100);
    assert.ok(tight.length <= limit + 1, `rowLimit ${limit} produced ${tight.length} rows`);
    if (limit >= 20) {
      for (const group of MENU_GROUPS) {
        assert.ok(tight.some((row) => row.includes(group.title)), `at ${limit} rows ${group.title} is missing`);
      }
    }
  }
});

test('CE-036 — a group showing fewer entries than it holds says so', () => {
  // Truncating is the fix; truncating SILENTLY is not — a reader who cannot tell there is more
  // takes what is shown for the whole group. The same rule `detailLines` already follows.
  const hits = [...AGENT_COMMANDS];
  const rows = commandMenuRows({ hits, selected: 0, rowLimit: 12, groups: groupMenu }, 100);
  const work = rows.find((row) => row.includes('WORK'));
  assert.match(work, new RegExp(` \\d+ of ${AGENT_COMMANDS.filter((e) => e.group === 'work').length}`), `WORK is truncated but does not say so: ${JSON.stringify(work)}`);
  // A group that fits shows no count — a "4 of 4" would be noise on every row.
  const session = rows.find((row) => row.includes('SESSION'));
  assert.ok(!/ \d+ of \d+/.test(session), `SESSION fits entirely but claims to be truncated: ${JSON.stringify(session)}`);
});

test('CE-036 — the selected entry is painted however far down its group it sits', () => {
  // The window follows the selection. A fixed window would hide the highlight the moment the
  // arrow keys walked past the share, which is the same defect the prompt box already solves
  // by keeping the caret visible — and it would be invisible in exactly the case it matters.
  const hits = [...AGENT_COMMANDS];
  for (let selected = 0; selected < hits.length; selected += 1) {
    const rows = commandMenuRows({ hits, selected, rowLimit: 12, groups: groupMenu }, 100);
    const marked = rows.filter((row) => row.includes('▸'));
    assert.equal(marked.length, 1, `selection ${selected} (\`/${hits[selected].name}\`) painted ${marked.length} markers`);
    assert.match(marked[0], new RegExp(`/${hits[selected].name}\\b`),
      `selection ${selected} should be \`/${hits[selected].name}\`, got ${JSON.stringify(marked[0])}`);
  }
});

test('CE-033 — the highlight and Tab agree on which entry is selected', () => {
  // The index each painted row carries is its position in the FLAT hit list, which is what the
  // arrow keys move through. Rebuilding it per group would put the marker on a different entry
  // than the one Tab completes, for every group after the first — invisible in the first
  // group, wrong everywhere else.
  const hits = [...AGENT_COMMANDS];
  const applications = hits.findIndex((entry) => entry.group === 'applications');
  assert.ok(applications > 0, 'no entry after the first group — this assertion would prove nothing');
  const rows = commandMenuRows({ hits, selected: applications, rowLimit: 99, groups: groupMenu }, 80);
  const marked = rows.filter((row) => row.includes('▸'));
  assert.equal(marked.length, 1, 'exactly one row is marked');
  assert.match(marked[0], new RegExp(`/${hits[applications].name}\\b`));
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
  const turn = planTurn('/', {
    resolve: () => null, parse: () => null, commands: AGENT_COMMANDS, groups: groupMenu,
  });
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
// The defect this pins was found in a real browser, not by reading: typing `/` in the embedded
// terminal drew "nothing to show", on an owner account holding every permission, while the DOM
// prompt on the same page drew all seven groups from the same registry.
//
// The cause is a two-shape boundary. `menuFrame` returns the group rows under `groups`;
// `tui-screen.mjs` reads them from `groupRows`, because it carries the grouping FUNCTION under
// `groups`. `tui-fullscreen.mjs` did that translation by hand and `coden-terminal.js` spread the
// frame straight through — so one shell worked and the other rendered an empty menu. Both halves
// were individually correct, which is exactly why no test saw it.
//
// `menuViewModel` is now the only translation, and these assert the property rather than the
// call: the rows arrive under the name the renderer reads, and the field it uses for the
// grouping function holds a function.
{
  const commands = [...AGENT_COMMANDS];
  const addresses = buildCodenAddressBook(join(ROOT, 'apps/webui-static'));

  test('group rows arrive under groupRows, and groups stays the grouping function', () => {
    const frame = menuFrame({ word: '', argument: '' }, { commands, addresses });
    const model = menuViewModel(frame, { grouping: groupMenu, menu: menuFor(null), note: '' });
    assert.equal(model.level, 'groups');
    assert.ok(Array.isArray(model.groupRows) && model.groupRows.length > 0,
      'the renderer reads groupRows and would print "nothing to show" for an empty one');
    assert.equal(typeof model.groups, 'function',
      'groups must hold the grouping function — an array here is what the renderer would try to call');
  });

  test('what the renderer draws from it is the groups, not an empty menu', () => {
    const frame = menuFrame({ word: '', argument: '' }, { commands, addresses });
    const model = menuViewModel(frame, { grouping: groupMenu, menu: menuFor(null), note: '' });
    const rows = commandMenuRows({ ...model, rowLimit: 12 }, 90).join('\n');
    assert.doesNotMatch(rows, /nothing to show/, 'this is the exact frame the browser drew');
    for (const title of ['WORK', 'DESTINATIONS', 'TOOLS', 'SESSION']) {
      assert.match(rows, new RegExp(title), `the ${title} group is missing from the drawn menu`);
    }
  });

  test('both shells build it through the same call, and neither shapes it by hand', () => {
    // A source guard, because the property above can be satisfied by a helper nobody calls.
    for (const file of ['apps/webui-static/coden-terminal.js', 'tools/tui-fullscreen.mjs']) {
      const source = read(file);
      assert.match(source, /menuViewModel\(frame, \{ grouping: groupMenu/,
        `${file} does not build its menu through the shared shaper`);
      assert.doesNotMatch(source, /groupRows: frame\.groups/,
        `${file} still translates the frame by hand — that is the drift this closes`);
    }
  });

  test('an entries-level frame keeps its hits and its selection', () => {
    const frame = menuFrame({ word: 'd', argument: '' }, { commands, addresses });
    const model = menuViewModel(frame, { grouping: groupMenu, menu: menuFor(null), note: '' });
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
