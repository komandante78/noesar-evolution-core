// SPDX-License-Identifier: AGPL-3.0-or-later
// D3b (UI-054's other half): `F1`…`F9` map onto the first nine of `panel <name>`'s own
// vocabulary, in the same order the CLI's own `panel` (no name) listing already declares —
// a hotkey, not a second vocabulary. `panelForFunctionKey`/`FUNCTION_KEY_PANELS` are the
// pure mapping this file can test without a real TTY; the raw-mode plumbing that actually
// receives keypresses (`wireFunctionKeys` in tools/tui-client.mjs) needs one to mean
// anything and is not exercised here — same class of gap `login()`'s own password-masking
// comment discloses.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { panelForFunctionKey, FUNCTION_KEY_PANELS, runPanel } from '../../../tools/tui-client.mjs';

describe('panelForFunctionKey (D3b)', () => {
  test('F1…F9 resolve to the first nine PANEL_NAMES, in order', () => {
    assert.deepEqual(FUNCTION_KEY_PANELS, [
      'plan', 'map', 'logs', 'shadow', 'invariants', 'authority', 'editor', 'diff', 'tests',
    ]);
    for (let n = 1; n <= 9; n += 1) {
      assert.equal(panelForFunctionKey(`f${n}`), FUNCTION_KEY_PANELS[n - 1]);
    }
  });

  test('F10, F11, F12 and non-function keys resolve to nothing — no tenth panel exists on a hotkey', () => {
    for (const name of ['f10', 'f11', 'f12', 'a', 'return', 'up', undefined, '']) {
      assert.equal(panelForFunctionKey(name), null);
    }
  });

  test('resolved names are real `panel` names, callable through the same `runPanel` the typed command uses', async () => {
    const calls = [];
    const session = { call: async (method, params) => { calls.push({ method, params }); return { invariants: [] }; } };
    await runPanel(session, panelForFunctionKey('f5'), undefined); // invariants
    assert.deepEqual(calls[0], { method: 'product.invariants', params: {} });
  });

  test('F3/F7/F8 (logs/editor/diff) need a runId — a hotkey does not invent one, same as typing the bare command', async () => {
    const original = console.log;
    const lines = [];
    console.log = (...args) => lines.push(args.join(' '));
    try {
      await runPanel({ call: async () => ({}) }, panelForFunctionKey('f3'), undefined);
    } finally { console.log = original; }
    assert.match(lines.join('\n'), /Usage: panel logs <runId>/);
  });
});
