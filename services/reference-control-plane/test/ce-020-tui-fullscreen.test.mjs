// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Wires `tools/acceptance/ce-020-tui-fullscreen.mjs` into `node --test` — the improvement
// proposal `D-0441` raised and closed in the same phase.
//
// That script drives the ssh shell with real keystrokes against a real engine and proves the
// menu, the footer and the transcript — a claim no unit test of the renderer alone can make.
// It was never part of `node --test`, and it drifted: `D-0437` flattened the `/` menu and this
// script kept asserting the removed two-level design (group headings, a key to enter one) for
// the rest of that session, undetected, because nothing ran it until a debug pass asked for it
// by hand. Self-contained (its own process, its own port, its own cleanup) and under two
// seconds — there was no cost reason it was excluded, only that nothing had wired it in yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = join(ROOT, 'tools/acceptance/ce-020-tui-fullscreen.mjs');

test('CE-020 — the ssh shell, driven by real keystrokes against a real engine', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    // The script's own PASS/FAIL lines are the useful part of a failure, not the stack of the
    // process that ran it — stdout carries them even on a non-zero exit.
    assert.fail(`ce-020-tui-fullscreen.mjs failed:\n${error.stdout ?? error.message}`);
  }
  assert.match(output, /CE020_FAIL=0/, `ce-020-tui-fullscreen.mjs reported failures:\n${output}`);
});
