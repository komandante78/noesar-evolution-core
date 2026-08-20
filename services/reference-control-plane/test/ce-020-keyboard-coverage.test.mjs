// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-020` — "ogni capacità ha una forma da tastiera completa" — measured over the WHOLE
// capability set, which is the half nothing measured. `D-0590`.
//
// # Why this exists next to `ce-020-tui-fullscreen.mjs`
//
// That runner boots a real engine and presses real keys, and it is the stronger evidence about
// the mechanism: the menu paints, Tab completes, a call reaches the engine, the screen is
// restored. What it cannot say is **how much of the product** those keys reach. It exercises one
// capability end to end (`repoMap.scan`) and proves the shell works; the criterion asks that
// *every* capability have a keyboard form, and a runner that drives one capability perfectly
// answers a different question.
//
// So the two are complementary and neither replaces the other: that one proves the keyboard path
// is real, this one proves it is complete. Measured when this was written: **21 of 27**.
//
// # What counts as a keyboard form, and why the line shell does not
//
// Three ways a capability is reachable by typing, all of them in the shell a real user gets:
//
//   1. a slash command — `AGENT_COMMANDS`, resolved through the shared `planTurn`, so it works
//      identically in both shells by construction;
//   2. an address view — typing `/coden/bench/…` at the prompt, rendered from
//      `coden-address-views.mjs`, which `coden-shell-parity` already drives one by one for all
//      twenty-five;
//   3. the full-screen shell's own machinery — `tui-fullscreen.mjs` calling it to paint (the
//      address space it offers, the branch in the footer).
//
// **`tools/tui-client.mjs`'s bare-word verbs are deliberately NOT counted**, and that exclusion
// is the finding rather than a technicality. Those verbs (`session-show`, `session-archive`, …)
// live in the LINE shell, which `tui-client.mjs` runs only when stdin is a pipe. A person who
// opens `ssh` and types gets `runFullScreen`. Counting the line shell would have scored
// `sessions.get` and `sessions.action` as covered while the shell a human actually meets had no
// path to them at all — the same shape of mistake as `D-0405`'s address views, written in the
// client where only one of the two shells could ever reach them, and invisible for two phases
// because the two shells live in neighbouring files.
//
// # The rule this asserts, rather than the number it happens to have
//
// It reads `SESSION_METHOD_POLICY` — the engine's own register of what it exposes and what
// gates it — instead of a list of its own. A 28th method added tomorrow with no keyboard form
// turns this red without anyone remembering to update it, which is the property `D-0343` records
// as the difference between a test that keeps working and one that pinned yesterday's value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SESSION_METHOD_POLICY } from '../src/session-protocol.mjs';
import { AGENT_COMMANDS } from '../../../apps/shared/coden/agent-commands.js';
import { RUN } from '../../../apps/webui-static/coden-view-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

/** Every `session.call('method', …)` a file makes. The shape both keyboard surfaces use. */
const methodsCalledIn = (file) =>
  new Set([...read(file).matchAll(/\bcall\(\s*'([a-zA-Z][a-zA-Z.]*)'/g)].map((hit) => hit[1]));

const ADDRESS_VIEWS = 'apps/shared/coden/coden-address-views.mjs';
const FULL_SCREEN = 'tools/tui-fullscreen.mjs';

/** method -> the keyboard forms that reach it, named so a failure says what to build. */
function keyboardForms() {
  const forms = new Map(Object.keys(SESSION_METHOD_POLICY).map((method) => [method, []]));
  const add = (method, form) => { if (forms.has(method)) forms.get(method).push(form); };

  for (const command of AGENT_COMMANDS) if (command.method) add(command.method, `/${command.name}`);
  for (const method of methodsCalledIn(ADDRESS_VIEWS)) add(method, 'address view');
  for (const method of methodsCalledIn(FULL_SCREEN)) add(method, 'full-screen shell');
  return forms;
}

test('CE-020 — every capability the engine exposes has a keyboard form', () => {
  const forms = keyboardForms();
  const stranded = [...forms].filter(([, where]) => where.length === 0).map(([method]) => method);
  assert.deepEqual(stranded, [],
    `${stranded.length} of ${forms.size} capabilities cannot be reached by typing in the shell an `
    + 'ssh user gets: give each a slash command, an address view, or state why it is not a '
    + 'capability a person exercises');
});

test('CE-020 — a command that names a method carries the permission that method is gated on', () => {
  // `coden-shell-parity` asserts this for the entries it knew about; asserted here too because
  // this file is what will be edited when a capability gains a command, and a permission copied
  // by hand into a registry the engine never reads is exactly how a menu offers a door that
  // answers 403. Cheap, and it fails in the same file as the change that would break it.
  const wrong = AGENT_COMMANDS
    .filter((command) => command.method && SESSION_METHOD_POLICY[command.method])
    .filter((command) => (command.permission ?? null) !== (SESSION_METHOD_POLICY[command.method].permission ?? null))
    .map((command) => `/${command.name}: declares ${command.permission}, engine gates on ${SESSION_METHOD_POLICY[command.method].permission}`);
  assert.deepEqual(wrong, []);
});

test('CE-020 — a command that names a method has a transport, and it calls that method', () => {
  // A menu entry with no `RUN` builder resolves, paints, and then answers "has no transport
  // here" — a keyboard form in the list and not in the product. The second half matters as much:
  // a builder that returns a DIFFERENT method than the entry declares would satisfy both the
  // permission check above and the coverage check, while the capability stayed unreachable.
  const broken = AGENT_COMMANDS
    .filter((command) => command.kind === 'call' && command.method)
    .flatMap((command) => {
      const build = RUN[command.name];
      if (!build) return [`/${command.name}: declares ${command.method} and has no transport`];
      const [method] = build('probe');
      return method === command.method
        ? []
        : [`/${command.name}: declares ${command.method}, its transport calls ${method}`];
    });
  assert.deepEqual(broken, []);
});

test('CE-020 — a capability that cannot be undone asks for a typed word first', () => {
  // `15` §13: in a terminal a lone `y` is one paste away from being typed by something that is
  // not you. The LINE shell already refused to act without a confirmation for session actions;
  // when that capability gained a slash command it had to bring the refusal with it, or the
  // full-screen shell would have been the cheaper way to do the more dangerous thing.
  const confirming = AGENT_COMMANDS.filter((command) => command.confirm);
  assert.ok(confirming.length > 0, 'no command declares a confirmation — the flag is dead code');
  for (const command of confirming) {
    assert.ok(/confirm/.test(String(command.argument ?? '')),
      `/${command.name} requires a confirmation the person cannot see in its own argument line`);
  }
});
