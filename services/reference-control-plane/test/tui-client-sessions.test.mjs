// SPDX-License-Identifier: AGPL-3.0-or-later
// UI-050 (D-0267): the sessions half of the CodeN Evolution TUI (tools/tui-client.mjs).
// session-protocol.test.mjs already proves the `sessions.*` wire methods reach the real
// contextGraph; this file proves the CLI layer on top of them — number-to-id resolution
// against the last list shown, `all`, and that a destructive/moving action never calls the
// wire method without an explicit `y` (UI-008/UI-051/UI-052) — against a stubbed `session`
// so it needs neither a socket nor a running product.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCommand, createTuiState, resolveSessionSelection } from '../../../tools/tui-client.mjs';

function itemFixture(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i + 1}`, title: `Session ${i + 1}` }));
}

/** Records every `session.call` and answers `reader.next()` from a fixed queue — a real
 *  confirmation prompt asks exactly one question per action, so a short queue is enough. */
function stubs({ answers = [], results = {} } = {}) {
  const calls = [];
  const session = { call: async (method, params) => { calls.push({ method, params }); return results[method] ?? {}; } };
  const queue = [...answers];
  const reader = { next: async () => (queue.length ? queue.shift() : '') };
  return { session, reader, calls };
}

describe('resolveSessionSelection — number-to-id resolution against the last list', () => {
  test('refuses before any list has been loaded', () => {
    const result = resolveSessionSelection(createTuiState(), ['1']);
    assert.match(result.error, /run `sessions` first/);
  });

  test('`all` resolves to every item of the last list, in order', () => {
    const state = createTuiState();
    state.lastList = { place: 'active', items: itemFixture(3) };
    const result = resolveSessionSelection(state, ['all']);
    assert.deepEqual(result.ids, ['id-1', 'id-2', 'id-3']);
  });

  test('one or more 1-based row numbers resolve to their real ids', () => {
    const state = createTuiState();
    state.lastList = { place: 'active', items: itemFixture(3) };
    const result = resolveSessionSelection(state, ['2', '1']);
    assert.deepEqual(result.ids, ['id-2', 'id-1']);
  });

  test('a row number outside the current list is refused, not clamped', () => {
    const state = createTuiState();
    state.lastList = { place: 'active', items: itemFixture(2) };
    const result = resolveSessionSelection(state, ['5']);
    assert.match(result.error, /not a session number/);
  });
});

describe('dispatchCommand — sessions.* commands', () => {
  test('`sessions` calls sessions.list and stores the page as the resolvable list', async () => {
    const { session, reader, calls } = stubs({
      results: { 'sessions.list': { place: 'archived', items: itemFixture(2), from: 1, to: 2, total: 2, page: 1, pageCount: 1 } },
    });
    const state = createTuiState();
    await dispatchCommand(reader, session, 'sessions archived 1', state);
    assert.deepEqual(calls[0], { method: 'sessions.list', params: { place: 'archived', page: 1 } });
    assert.equal(state.lastList.place, 'archived');
    assert.equal(state.lastList.items.length, 2);
  });

  test('`session-archive <n>` asks for confirmation and does NOT call sessions.action on a bare Enter (UI-052)', async () => {
    const { session, reader, calls } = stubs({ answers: [''] });
    const state = createTuiState();
    state.lastList = { place: 'active', items: itemFixture(1) };
    await dispatchCommand(reader, session, 'session-archive 1', state);
    assert.equal(calls.length, 0);
  });

  test('`session-archive <n>` calls sessions.action with action=archive once confirmed', async () => {
    const { session, reader, calls } = stubs({
      answers: ['y'],
      results: { 'sessions.action': { action: 'archive', applied: [{ id: 'id-1' }], refused: [] } },
    });
    const state = createTuiState();
    state.lastList = { place: 'active', items: itemFixture(1) };
    await dispatchCommand(reader, session, 'session-archive 1', state);
    assert.deepEqual(calls[0], { method: 'sessions.action', params: { action: 'archive', ids: ['id-1'] } });
  });

  test('`session-delete` sends `bin` from the active list and `purge` from the bin — matching the browser\'s own Delete-key rule', async () => {
    const active = stubs({ answers: ['y'], results: { 'sessions.action': { action: 'bin', applied: [{}], refused: [] } } });
    const activeState = createTuiState();
    activeState.lastList = { place: 'active', items: itemFixture(1) };
    await dispatchCommand(active.reader, active.session, 'session-delete 1', activeState);
    assert.equal(active.calls[0].params.action, 'bin');

    const bin = stubs({ answers: ['y'], results: { 'sessions.action': { action: 'purge', applied: [{}], refused: [] } } });
    const binState = createTuiState();
    binState.lastList = { place: 'bin', items: itemFixture(1) };
    await dispatchCommand(bin.reader, bin.session, 'session-delete 1', binState);
    assert.equal(bin.calls[0].params.action, 'purge');
  });

  test('a partially refused batch is remembered for `session-undone`', async () => {
    const { session, reader } = stubs({
      answers: ['y'],
      results: { 'sessions.action': { action: 'bin', applied: [{ id: 'id-1' }], refused: [{ id: 'id-2', reason: 'Conversation not found.' }] } },
    });
    const state = createTuiState();
    state.lastList = { place: 'active', items: itemFixture(2) };
    await dispatchCommand(reader, session, 'session-delete all', state);
    assert.deepEqual(state.lastRefused, [{ id: 'id-2', reason: 'Conversation not found.' }]);
  });
});
