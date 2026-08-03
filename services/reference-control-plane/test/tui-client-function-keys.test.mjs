// SPDX-License-Identifier: AGPL-3.0-or-later
// D3b (UI-054's other half), rewritten for phase 4 (D-0300): `F1`…`F9` reach the first nine
// BENCH addresses, in the order the workbench itself lists them — read from the served
// address list, not from a mapping typed into the client. A hotkey is a faster way to reach
// the one vocabulary, never a second one, and after phase 4 that is true by construction:
// add a panel to the markup and the hotkeys shift with the bench.
//
// `functionKeyAddresses`/`addressForFunctionKey` are the pure mapping this file can test
// without a real TTY; the raw-mode plumbing that actually receives keypresses
// (`wireFunctionKeys` in tools/tui-client.mjs) needs one to mean anything and is not
// exercised here — same class of gap `login()`'s own password-masking comment discloses.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addressForFunctionKey, functionKeyAddresses, showAddress, createTuiState } from '../../../tools/tui-client.mjs';
import { buildCodenAddressBook } from '../src/coden-address-book.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const addresses = buildCodenAddressBook(join(here, '../../../apps/webui-static'));

describe('addressForFunctionKey (D3b, phase 4)', () => {
  test('F1…F9 are the first nine bench panels, in the order the markup lists them', () => {
    const expected = addresses.filter((entry) => entry.region === 'bench').slice(0, 9).map((entry) => entry.address);
    assert.deepEqual(functionKeyAddresses(addresses).map((entry) => entry.address), expected);
    assert.equal(expected.length, 9, 'the bench has fewer than nine panels; the hotkey set moved');
    for (let n = 1; n <= 9; n += 1) {
      assert.equal(addressForFunctionKey(addresses, `f${n}`).address, expected[n - 1]);
    }
    // The agent column has no hotkey of its own; its panels are reached by name or by `/`.
    for (const entry of functionKeyAddresses(addresses)) assert.equal(entry.region, 'bench');
  });

  test('F10, F11, F12 and non-function keys resolve to nothing — no tenth panel exists on a hotkey', () => {
    for (const name of ['f10', 'f11', 'f12', 'a', 'return', 'up', undefined, '']) {
      assert.equal(addressForFunctionKey(addresses, name), null);
    }
  });

  test('a resolved key goes through the same showAddress the typed command and `/` both use', async () => {
    const calls = [];
    const session = { call: async (method, params) => { calls.push({ method, params }); return { shadow: {} }; } };
    // F1 is the bench's first panel — Shadow run, whose view is the status snapshot's shadow.
    await showAddress(session, createTuiState(), addressForFunctionKey(addresses, 'f1'), undefined);
    assert.deepEqual(calls[0], { method: 'status', params: {} });
  });

  test('a hotkey onto a panel that needs a runId asks for one, exactly as typing it bare does', async () => {
    const needsRun = functionKeyAddresses(addresses).find((entry) => ['logs', 'editor', 'diff'].includes(entry.panel));
    assert.ok(needsRun, 'no run-scoped panel is on a hotkey any more; this test needs rewriting');
    const original = console.log;
    const lines = [];
    console.log = (...args) => lines.push(args.join(' '));
    try {
      await showAddress({ call: async () => ({}) }, createTuiState(), needsRun, undefined);
    } finally { console.log = original; }
    assert.match(lines.join('\n'), new RegExp(`Usage: /${needsRun.address} <runId>`));
  });
});
