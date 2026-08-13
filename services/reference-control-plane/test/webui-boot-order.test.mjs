// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Boot-order invariant of the shipped WebUI module — `D-0416`.
//
// This exists because of a defect that shipped in slice 3 of `D-0404` and killed the ENTIRE
// WebUI at boot, not merely the surface it belonged to. The terminal block was appended to the
// end of `app.js`:
//
//     initRouter();                 // line ~5880 — activates the initial view
//     …
//     let codenTerminal=null;       // line ~5891
//     function detachCodenTerminal(){ if(!codenTerminal) return; … }
//
// `attachCodenTerminal` and `detachCodenTerminal` are function declarations, so they hoist and
// are callable from the first tick. `let codenTerminal` does not hoist: it is in the temporal
// dead zone until its own line runs. `initRouter()` activates the initial destination
// immediately, that path calls `detachCodenTerminal()`, and the read of `codenTerminal` threw
//
//     Uncaught ReferenceError: Cannot access 'codenTerminal' before initialization
//
// which aborts evaluation of the whole module. The auth gate never rendered, `#setupForm`
// stayed hidden, and the browser suite failed at its very first step with every later check
// unreachable. 2514 unit tests passed against exactly this code: the fault is load-order
// shaped and cannot be seen by a test that imports functions and calls them.
//
// ESLint cannot see it either, and that was measured rather than assumed before this file was
// written (`D-0416`): `no-use-before-define` scores POSITIONS, and the read of `codenTerminal`
// sits textually AFTER its declaration — inside a function whose CALL SITE is what runs early.
// Enabling the rule produced 54 hits across the first-party tree, every one of them correct
// code, and zero hits on the actual defect. A rule that reports 54 false positives and misses
// the true one is the checker `D-0034` already rejected twice.
//
// So the invariant is stated where it is actually true: nothing this module binds with `let`,
// `const`, `var` or `class` at the top level may be declared after the line that starts
// painting the interface. Anything the router can reach must already exist when it runs.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '../../../apps/webui-static/app.js');
const lines = readFileSync(APP, 'utf8').split('\n');

/** Column zero only. A declaration indented by even one space is inside a function or a block,
 *  where it is evaluated when that body runs and not during module evaluation — the hazard this
 *  file guards does not exist there. Scoping the scan this way is what keeps it at zero noise:
 *  measured 2026-08-13, the invariant holds with no exemption list, and an exemption list is how
 *  a check quietly stops checking. */
const TOP_LEVEL_BINDING = /^(let|const|var|class)\s/;

/** The line that first paints a destination. Every boot call above it only wires listeners;
 *  this one activates the initial view and therefore reaches application state. */
const BOOT_LINE = /^initRouter\(\);\s*$/;

describe('webui boot order · D-0416', () => {
  test('the router is started exactly once, at the top level', () => {
    const found = lines.map((line, index) => (BOOT_LINE.test(line) ? index + 1 : 0)).filter(Boolean);
    assert.equal(found.length, 1, `expected one top-level initRouter(); call, found ${found.length} at ${found.join(', ')}`);
  });

  test('no module-level binding is declared after the router starts', () => {
    const bootLine = lines.findIndex((line) => BOOT_LINE.test(line)) + 1;
    assert.ok(bootLine > 0, 'initRouter(); not found at the top level of app.js');
    const late = [];
    lines.forEach((line, index) => {
      if (index + 1 > bootLine && TOP_LEVEL_BINDING.test(line)) late.push(`${index + 1}: ${line.slice(0, 70)}`);
    });
    assert.deepEqual(late, [], `module-level bindings declared after initRouter() (line ${bootLine}) are in the temporal dead zone for anything the router calls:\n${late.join('\n')}`);
  });

  test('the terminal binding is declared before the FIRST top-level call, not merely before the router', () => {
    // Tightened after `D-0418` moved the reach earlier: `initAppearance()` -> `applyTheme()` ->
    // `codenTerminalTheme()` reads `codenTerminal`, and `initAppearance()` runs about thirty
    // lines BEFORE `initRouter()`. "Before the router" was true and no longer sufficient — the
    // near-miss that proves a guard has to name the property, not the symptom.
    const firstCall = lines.findIndex((line) => /^[A-Za-z$_][\w$]*\([^)]*\);\s*$/.test(line)) + 1;
    assert.ok(firstCall > 0, 'no top-level call found in app.js — re-derive this guard');
    const declared = lines.findIndex((line) => /^let codenTerminal\b/.test(line)) + 1;
    assert.ok(declared > 0, 'codenTerminal is no longer declared at the top level — this guard needs updating');
    assert.ok(declared < firstCall,
      `codenTerminal is declared at line ${declared}, after the first top-level call at line ${firstCall}: any boot call that reaches it would read it in the temporal dead zone`);
  });

  test('the router activation path really does reach the terminal helpers', () => {
    // Without this, the guard above could go on passing after the call site moved away, and
    // would then be protecting nothing. The point is the reachability, not the two names.
    const source = lines.join('\n');
    assert.match(source, /if\(target==='coden'\)attachCodenTerminal\(\);else detachCodenTerminal\(\);/,
      'the view-activation path no longer calls attach/detachCodenTerminal — re-derive what the router reaches before trusting this file');
  });
});
