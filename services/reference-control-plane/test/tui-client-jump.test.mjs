// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 4 (D-0300): `/` in the terminal shell.
//
// The accepted design (s313) is ONE jump-to-address mechanism, identical in the WebUI and
// the TUI. Phase 2 built the browser's half inside the box that already existed; this is the
// other half, and "identical" is the thing under test here: the same list, the same three
// ranks, the same names, so that an address read off the browser's address bar and pasted at
// this prompt reaches the panel it names.
//
// What is deliberately NOT identical, and is asserted as such: a terminal has no highlighted
// row to arrow through before committing, so an empty query lists instead of preselecting,
// and the runners-up of a real query are named after the jump rather than before it. Same
// outcome for the same keystrokes; the correction arrives a moment later.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dispatchCommand, createTuiState, matchAddresses } from '../../../tools/tui-client.mjs';
import { buildCodenAddressBook } from '../src/coden-address-book.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const addresses = buildCodenAddressBook(join(here, '../../../apps/webui-static'));

function stubs(results = {}) {
  const calls = [];
  const session = {
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === 'coden.addresses') return { addresses, accessFiltered: false };
      return results[method] ?? {};
    },
  };
  return { session, reader: { next: async () => '' }, calls, engineCalls: () => calls.filter((entry) => entry.method !== 'coden.addresses') };
}

async function captureLog(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

describe('matchAddresses — the browser\'s own three ranks (app.js::matchAddresses)', () => {
  // Built so one query hits all three ranks at once, which is the only way to prove they
  // are ranks and not a filter: the interface's own order would put them the other way up.
  const book = [
    { address: 'settings/health', label: 'Diff viewer settings' }, // label only  — rank 2
    { address: 'coden/bench/diff', label: 'Diff' }, //                 contains    — rank 1
    { address: 'diff-page', label: 'A page' }, //                      starts with — rank 0
  ];

  test('an address that starts with the query beats one that contains it, which beats a label match', () => {
    assert.deepEqual(
      matchAddresses(book, 'diff').map((entry) => entry.address),
      ['diff-page', 'coden/bench/diff', 'settings/health'],
    );
  });

  test('equal ranks keep the interface\'s own order — the sort is stable, not alphabetical', () => {
    const twins = [
      { address: 'coden/bench/zzz-second', label: 'Second' },
      { address: 'coden/bench/aaa-first', label: 'First' },
    ];
    assert.deepEqual(matchAddresses(twins, 'coden').map((entry) => entry.address), twins.map((entry) => entry.address));
  });

  test('a leading slash is stripped, so an address pasted from the browser\'s bar finds its panel', () => {
    assert.equal(matchAddresses(book, '/coden/bench/diff')[0].address, 'coden/bench/diff');
    // More than one, because the key that opens the box in the browser can end up in the
    // query there too — the strip is of every leading slash, not of exactly one.
    assert.equal(matchAddresses(book, '//coden/bench/diff')[0].address, 'coden/bench/diff');
  });

  test('an empty query is every address, in the interface\'s own order — not none', () => {
    assert.deepEqual(matchAddresses(book, '/').map((entry) => entry.address), book.map((entry) => entry.address));
  });

  test('a query nothing carries matches nothing, rather than falling back to something', () => {
    assert.deepEqual(matchAddresses(book, 'zzzz'), []);
  });
});

describe('`/` in the terminal — the same jump the browser answers to', () => {
  test('`/` alone lists every address the product declares, grouped, with the access-filter gap disclosed', async () => {
    const { session, reader, engineCalls } = stubs();
    const output = await captureLog(() => dispatchCommand(reader, session, '/', createTuiState()));
    assert.equal(engineCalls().length, 0, 'listing addresses must not touch the engine');
    for (const entry of addresses) assert.ok(output.includes(`/${entry.address}`), `${entry.address} is not listed`);
    assert.match(output, /Bench/);
    assert.match(output, /not filtered by what this account may open/);
  });

  test('`/diff` jumps to the panel, exactly as typing it in the browser\'s box and pressing Enter does', async () => {
    const { session, reader, engineCalls } = stubs({ 'workspace.get': { runId: 'r1' } });
    const output = await captureLog(() => dispatchCommand(reader, session, '/diff r1', createTuiState()));
    assert.match(output, /→ Diff \(\/coden\/bench\/diff\)/);
    assert.deepEqual(engineCalls()[0], { method: 'workspace.get', params: { runId: 'r1' } });
  });

  test('a full address pasted out of the browser\'s address bar reaches the same place', async () => {
    const { session, reader, engineCalls } = stubs({ 'repoMap.scan': {} });
    await captureLog(() => dispatchCommand(reader, session, '/coden/bench/map', createTuiState()));
    assert.deepEqual(engineCalls()[0], { method: 'repoMap.scan', params: { path: undefined } });
  });

  test('the runners-up are named, so a jump to the wrong one is visible and correctable', async () => {
    // `session` matches both the Settings page and the bench's own Sessions panel, and both
    // route to this shell's sessions list — so the jump lands somewhere real and still says
    // what else it could have meant.
    const { session, reader } = stubs({ 'sessions.list': { place: 'active', items: [], from: 0, to: 0, total: 0, page: 1, pageCount: 1 } });
    const output = await captureLog(() => dispatchCommand(reader, session, '/session', createTuiState()));
    assert.match(output, /other match/);
    assert.match(output, /\/coden\/bench\/sessions/);
  });

  test('a page of the other shell says where it lives — a panel with no method says something else', async () => {
    // Two different kinds of "not here", and a shell that ran them together would read as
    // broken in one case and as a claim about the product in the other.
    const page = stubs();
    const pageOutput = await captureLog(() => dispatchCommand(page.reader, page.session, '/memory', createTuiState()));
    assert.equal(page.engineCalls().length, 0);
    assert.match(pageOutput, /a destination of the browser shell/);
    assert.match(pageOutput, /means the same place there/);

    const panel = stubs();
    const panelOutput = await captureLog(() => dispatchCommand(panel.reader, panel.session, '/coden/bench/tasks', createTuiState()));
    assert.equal(panel.engineCalls().length, 0);
    assert.match(panelOutput, /no source over this transport/);
    assert.match(panelOutput, /would read as "there are none"/);
  });

  test('a query that matches nothing says so — it does not jump somewhere plausible', async () => {
    const { session, reader, engineCalls } = stubs();
    const output = await captureLog(() => dispatchCommand(reader, session, '/zzzz-no-such-place', createTuiState()));
    assert.equal(engineCalls().length, 0);
    assert.match(output, /Nothing matches that\./);
  });

  test('`/` is checked before the verb table, so no command can shadow an address', async () => {
    // `map`, `status` and `plan` are all verbs AND addresses. Typed with a slash they must
    // be the address every time, or the two shells would disagree about what `/map` means.
    const { session, reader, engineCalls } = stubs({ 'repoMap.scan': {} });
    await captureLog(() => dispatchCommand(reader, session, '/coden/agent/plan', createTuiState()));
    assert.equal(engineCalls().length, 0, '`/coden/agent/plan` started a plan instead of opening the panel');
  });

  test('one address list per connection, whether it is `/` or `panel` that asks for it', async () => {
    const { session, reader, calls } = stubs({ 'repoMap.scan': {} });
    const state = createTuiState();
    await captureLog(() => dispatchCommand(reader, session, '/', state));
    await captureLog(() => dispatchCommand(reader, session, '/map', state));
    await captureLog(() => dispatchCommand(reader, session, 'panel tests', state));
    assert.equal(calls.filter((entry) => entry.method === 'coden.addresses').length, 1);
  });
});
