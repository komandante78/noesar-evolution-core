// SPDX-License-Identifier: AGPL-3.0-or-later
// UI-054 (D-0268), rewritten for phase 4 (D-0300): `panel <name>` reaching the same views the
// workbench shows, full-screen as text. What changed underneath it is where the panel names
// come from — the server's `coden.addresses`, derived from the markup, instead of a list
// written inside tools/tui-client.mjs that had drifted to fourteen names against the
// markup's twenty-five.
//
// The stub session answers `coden.addresses` from the REAL interface, through the real
// parser, so these tests exercise the product's actual address space: `panel projects` is
// here because the markup has a Projects panel, not because this file remembered to add one.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dispatchCommand, createTuiState } from '../../../tools/tui-client.mjs';
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
  const reader = { next: async () => '' };
  // The address fetch is not an engine call and would drown every assertion below it; what
  // each test cares about is which ENGINE method a panel reaches, or that it reaches none.
  return { session, reader, calls, engineCalls: () => calls.filter((entry) => entry.method !== 'coden.addresses') };
}

/** dispatchCommand talks to the terminal via console.log — capturing it is the only way to
 *  assert on a declared-empty message without also asserting on session.call, which for
 *  those panels must be zero engine calls (the whole point: no wire method exists to invent
 *  data from). Restored in a `finally` so a failing assertion never leaves console.log
 *  patched. */
async function captureLog(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines;
}

describe('dispatchCommand — panel <name> (UI-054, list served by the server)', () => {
  test('`panel` with no name lists every panel the markup declares, and the hotkeys', async () => {
    const { session, reader, engineCalls } = stubs();
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel', createTuiState()));
    assert.equal(engineCalls().length, 0);
    const listed = lines.find((line) => line.startsWith('Panels:'));
    // All twenty-five, not the fourteen the old hand-written list carried.
    for (const entry of addresses.filter((item) => item.region)) {
      assert.ok(listed.includes(entry.panel), `\`panel\` does not list ${entry.address}`);
    }
    assert.match(lines.find((line) => line.startsWith('Hotkeys:')), /F1 shadow/);
  });

  test('`panel map` routes to repoMap.scan, same as the `map` command', async () => {
    const { session, reader, engineCalls } = stubs({ 'repoMap.scan': { filesScanned: 3 } });
    await dispatchCommand(reader, session, 'panel map', createTuiState());
    assert.deepEqual(engineCalls()[0], { method: 'repoMap.scan', params: { path: undefined } });
  });

  test('`panel logs` with no runId asks for one instead of guessing which run', async () => {
    const { session, reader, engineCalls } = stubs();
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel logs', createTuiState()));
    assert.equal(engineCalls().length, 0);
    assert.match(lines.join('\n'), /Usage: \/coden\/bench\/logs <runId>/);
  });

  test('`panel logs <runId>` routes to events.correlation', async () => {
    const { session, reader, engineCalls } = stubs({ 'events.correlation': { events: [] } });
    await dispatchCommand(reader, session, 'panel logs run-1', createTuiState());
    assert.deepEqual(engineCalls()[0], { method: 'events.correlation', params: { correlationId: 'run-1' } });
  });

  test('`panel invariants` calls product.invariants and renders each entry\'s enforcement location', async () => {
    const { session, reader } = stubs({
      'product.invariants': { invariants: [{ id: 'no_bypass', status: 'ACTIVE', enforcedBy: 'engine' }] },
    });
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel invariants', createTuiState()));
    assert.match(lines.join('\n'), /no bypass — enforced here \(engine\)/);
  });

  test('`panel editor <runId>` and `panel diff <runId>` both route to workspace.get — the run IS the editor/diff data', async () => {
    const editor = stubs({ 'workspace.get': { runId: 'r1', files: ['a.txt'] } });
    await dispatchCommand(editor.reader, editor.session, 'panel editor r1', createTuiState());
    assert.deepEqual(editor.engineCalls()[0], { method: 'workspace.get', params: { runId: 'r1' } });

    const diff = stubs({ 'workspace.get': { runId: 'r1', files: ['a.txt'] } });
    await dispatchCommand(diff.reader, diff.session, 'panel diff r1', createTuiState());
    assert.deepEqual(diff.engineCalls()[0], { method: 'workspace.get', params: { runId: 'r1' } });
  });

  test('`panel sessions` reaches the sessions this shell already lists — the same address, either shell', async () => {
    // The bench's Sessions panel used not to exist here at all. It is the clearest case of
    // what phase 4 buys: one address, one list, two shells.
    const { session, reader, engineCalls } = stubs({ 'sessions.list': { place: 'active', items: [], from: 0, to: 0, total: 0, page: 1, pageCount: 1 } });
    await dispatchCommand(reader, session, 'panel sessions', createTuiState());
    assert.deepEqual(engineCalls()[0], { method: 'sessions.list', params: { place: 'active', page: 1 } });
  });

  test('a panel the product declares empty answers with the product\'s own words, from the markup', async () => {
    const { session, reader, engineCalls } = stubs();
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel tests', createTuiState()));
    assert.equal(engineCalls().length, 0);
    // Quoted from the interface at call time, not copied into this client: the sentence
    // asserted here is the one apps/webui-static/index.html carries.
    const declared = addresses.find((entry) => entry.address === 'coden/bench/tests').declaredEmpty[0];
    assert.ok(lines.join('\n').includes(declared));
  });

  test('phase 3b · a bench list panel now HAS a source, and says how much of it is shown', async () => {
    // This asserted the opposite until 3b, and correctly: Projects was filled by the browser
    // over routes the socket did not carry, so printing "none" here would have been a claim
    // about the product. `coden.benchLists` gives the socket the same snapshot the browser
    // fills all seven panels from, so the honest answer changed — and the test now states what
    // it is, rather than being deleted for having become inconvenient.
    const { session, reader, engineCalls } = stubs({
      'coden.benchLists': { cappedAt: 6, lists: { projects: { shown: [{ name: 'alpha' }, { name: 'beta' }], total: 9 } } },
    });
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel projects', createTuiState()));
    assert.deepEqual(engineCalls().map((entry) => entry.method), ['coden.benchLists']);
    const printed = lines.join('\n');
    // "2 of 9" rather than two rows and silence: the browser slices to six too, so a reader
    // has to be able to see that what they are shown is a window and not the whole list.
    assert.match(printed, /showing 2 of 9/);
    assert.match(printed, /alpha/);
    assert.match(printed, /beta/);
  });

  test('phase 3b · each list panel shows ITS OWN list, not whichever came back first', async () => {
    // The seven panels share one view function and one engine call, which is the point — and
    // also the risk. Found by mutation: reading the first value of the response instead of the
    // one keyed by this panel left every test green while every panel showed Projects. Stubbing
    // one list at a time could never have caught it, so this stubs several and checks that each
    // address lands on its own.
    const lists = {
      projects: { shown: [{ name: 'the-project' }], total: 1 },
      agents: { shown: [{ name: 'the-agent' }], total: 1 },
      tools: { shown: [{ name: 'the-tool' }], total: 1 },
    };
    for (const [panel, expected] of [['projects', 'the-project'], ['agents', 'the-agent'], ['tools', 'the-tool']]) {
      const { session, reader } = stubs({ 'coden.benchLists': { cappedAt: 6, lists } });
      const printed = (await captureLog(() => dispatchCommand(reader, session, `panel ${panel}`, createTuiState()))).join('\n');
      assert.match(printed, new RegExp(expected), `\`panel ${panel}\` did not show its own list`);
      for (const other of ['the-project', 'the-agent', 'the-tool'].filter((name) => name !== expected)) {
        assert.doesNotMatch(printed, new RegExp(other), `\`panel ${panel}\` also showed ${other}`);
      }
    }
  });

  test('the "no source over this transport" branch survives, though no real address reaches it', async () => {
    // After 3b each of the twenty-five has a view, a transport note, or its own declared text,
    // so this branch is unreachable from the real address space — which is precisely when a
    // branch stops being checked, a failure mode this repository has already been bitten by.
    // Driven with a synthetic region entry so the wording stays covered for whatever address
    // needs it next.
    const invented = [...addresses, {
      address: 'coden/bench/not-wired', panel: 'not-wired', label: 'Not wired', region: 'bench', declaredEmpty: [],
    }];
    const session = {
      call: async (method) => (method === 'coden.addresses' ? { addresses: invented, accessFiltered: false } : {}),
    };
    const lines = await captureLog(() => dispatchCommand({ next: async () => '' }, session, 'panel not-wired', createTuiState()));
    assert.match(lines.join('\n'), /no source over this transport/);
    assert.match(lines.join('\n'), /would read as "there are none"/);
  });

  test('an unknown panel name is refused, not silently ignored', async () => {
    const { session, reader, engineCalls } = stubs();
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel not-a-real-panel', createTuiState()));
    assert.equal(engineCalls().length, 0);
    assert.match(lines.join('\n'), /Unknown panel/);
  });

  test('the address list is fetched once per connection, not once per command', async () => {
    const { session, reader, calls } = stubs({ 'repoMap.scan': {} });
    const state = createTuiState();
    await dispatchCommand(reader, session, 'panel map', state);
    await dispatchCommand(reader, session, 'panel tests', state);
    await captureLog(() => dispatchCommand(reader, session, 'panel', state));
    assert.equal(calls.filter((entry) => entry.method === 'coden.addresses').length, 1);
  });
});

describe('dispatchCommand — `status` carries the bench\'s own status line (UI-035/UI-054)', () => {
  test('Elapsed and Authority are sourced; the other ten read "—", matching the browser\'s own honesty', async () => {
    const { session, reader } = stubs({ status: { capability: { outstandingTokens: 2 } } });
    const state = createTuiState();
    state.connectedAt = Date.now() - 5000;
    const lines = await captureLog(() => dispatchCommand(reader, session, 'status', state));
    const statusLine = lines.find((line) => line.includes('Elapsed'));
    assert.match(statusLine, /Authority 2/);
    assert.match(statusLine, /Stage —\/16/);
    assert.match(lines.find((line) => line.includes('fields have a source')), /2 of 12 fields have a source/);
  });
});
