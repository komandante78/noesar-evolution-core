// SPDX-License-Identifier: AGPL-3.0-or-later
// UI-054 (D-0268): the panels half of the CodeN Evolution TUI — `panel <name>` reaching the
// same views the workbench's agent column and bench tabs show, full-screen as text, plus the
// bench's own status line. session-protocol.test.mjs already proves `product.invariants`
// reaches the real enforcement record; this file proves the CLI routing on top of it against
// a stubbed `session`, and that a panel with no real source (any transport, not just this
// one) answers with the same declared-empty text the browser shows rather than a guess.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCommand, createTuiState } from '../../../tools/tui-client.mjs';

function stubs(results = {}) {
  const calls = [];
  const session = { call: async (method, params) => { calls.push({ method, params }); return results[method] ?? {}; } };
  const reader = { next: async () => '' };
  return { session, reader, calls };
}

/** dispatchCommand talks to the terminal via console.log — capturing it is the only way to
 *  assert on a declared-empty message without also asserting on session.call, which for
 *  those panels must be zero calls (the whole point: no wire method exists to invent data
 *  from). Restored in a `finally` so a failing assertion never leaves console.log patched. */
async function captureLog(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines;
}

describe('dispatchCommand — panel <name> (UI-054)', () => {
  test('`panel` with no name lists the panel names, without calling the wire at all', async () => {
    const { session, reader, calls } = stubs();
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel', createTuiState()));
    assert.equal(calls.length, 0);
    assert.match(lines.join('\n'), /Panels: plan, map, logs/);
  });

  test('`panel map` routes to repoMap.scan, same as the `map` command', async () => {
    const { session, reader, calls } = stubs({ 'repoMap.scan': { filesScanned: 3 } });
    await dispatchCommand(reader, session, 'panel map', createTuiState());
    assert.deepEqual(calls[0], { method: 'repoMap.scan', params: { path: undefined } });
  });

  test('`panel logs` with no runId asks for one instead of guessing which run', async () => {
    const { session, reader, calls } = stubs();
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel logs', createTuiState()));
    assert.equal(calls.length, 0);
    assert.match(lines.join('\n'), /Usage: panel logs <runId>/);
  });

  test('`panel logs <runId>` routes to events.correlation', async () => {
    const { session, reader, calls } = stubs({ 'events.correlation': { events: [] } });
    await dispatchCommand(reader, session, 'panel logs run-1', createTuiState());
    assert.deepEqual(calls[0], { method: 'events.correlation', params: { correlationId: 'run-1' } });
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
    assert.deepEqual(editor.calls[0], { method: 'workspace.get', params: { runId: 'r1' } });

    const diff = stubs({ 'workspace.get': { runId: 'r1', files: ['a.txt'] } });
    await dispatchCommand(diff.reader, diff.session, 'panel diff r1', createTuiState());
    assert.deepEqual(diff.calls[0], { method: 'workspace.get', params: { runId: 'r1' } });
  });

  test('a panel with no real source anywhere (e.g. `tests`) answers with the declared-empty text and calls nothing', async () => {
    const { session, reader, calls } = stubs();
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel tests', createTuiState()));
    assert.equal(calls.length, 0);
    assert.match(lines.join('\n'), /nothing has ever run a plan-declared command/);
  });

  test('an unknown panel name is refused, not silently ignored', async () => {
    const { session, reader, calls } = stubs();
    const lines = await captureLog(() => dispatchCommand(reader, session, 'panel not-a-real-panel', createTuiState()));
    assert.equal(calls.length, 0);
    assert.match(lines.join('\n'), /Unknown panel/);
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
