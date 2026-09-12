// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-034` — *«Ogni cosa che si fa nel browser si fa nel terminale con lo stesso nome, e
// viceversa»* (`MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` §11, severity
// **H**), verification method *«l'insieme dei comandi e degli indirizzi delle due shell è lo
// **stesso insieme**»*.
//
// # Why this criterion is the one this project has already been burned by
//
// The `noesar-evolution` skill records it as rule 5, from a real incident: *«le due shell non
// divergono in nessun punto» è scritto dal 26 luglio, mai applicato, e niente lo faceva
// fallire*. A criterion no row measures is not closed, however often the document repeats it.
//
// # The method is SET EQUALITY, and that is what is asserted
//
// The criterion does not ask for a screenshot of each shell. It asks whether the two offer the
// same names. Three shells exist, not two — `app.js` (the page), `coden-terminal.js` (the
// browser's embedded terminal) and `tui-fullscreen.mjs` (the `ssh` shell) — and each builds its
// offered set with one expression:
//
// ```js
// [...menuFor(account).entries, ...addressEntries(addressBook)]
// ```
//
// So the set equality holds by CONSTRUCTION, and the thing that can rot is the construction. A
// test that only compared the three computed sets would compare one expression with itself and
// always agree — the `PANEL_NAMES` mistake this project has paid for twice. So the closure is
// derived from the SOURCE of each shell at every run: a shell that builds its set any other way
// fails here, whether it adds a name, drops one, or filters with a second opinion.
//
// The set itself is then computed once and exercised for real: every command in it resolves in
// the **running** `ssh` shell, driven with injected streams, so "the same set" is not merely a
// list that agrees with itself.
//
// # Declared width, not rounded up
//
// The ADDRESS half of the set is exercised end-to-end by `coden-shell-parity.test.mjs`, which
// opens all 25 CodeN addresses from the prompt of the real shell. This file does not repeat
// that; it asserts the addresses are in the offered set and names where they are driven.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_COMMANDS, NEXT_STEPS, menuFor, nextStepsFor, resolveCommand } from '../../../apps/shared/coden/agent-commands.js';
import { addressEntries } from '../../../apps/webui-static/coden-view-model.js';
import { runFullScreen } from '../../../tools/tui-fullscreen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');

/** The three shells, and the file each one's offered set is built in. Three, not two: the
 *  criterion says "browser" and "terminal", and the browser has two surfaces that both offer
 *  commands. Leaving the embedded one out would measure the pair that agree most easily. */
const SHELLS = Object.freeze({
  'the page': 'apps/webui-static/app.js',
  'the browser terminal': 'apps/webui-static/coden-terminal.js',
  'the ssh shell': 'tools/tui-fullscreen.mjs',
});

/** An owner-like account: every permission any entry asks for, so the set under test is the
 *  WHOLE product rather than one role's slice. `CE-036` is the criterion about filtering. */
const OWNER = Object.freeze({
  role: 'owner',
  permissions: [...new Set(AGENT_COMMANDS.map((entry) => entry.permission).filter(Boolean))],
});

/** A small address book in the shape `coden.addresses` returns. Two entries are enough: this
 *  file is about whether addresses are IN the set, not about what each one renders. */
const ADDRESS_BOOK = Object.freeze([
  { address: 'coden/agent/authority', label: 'Authority requests', region: 'agent', panel: 'authority', kind: 'panel' },
  { address: 'settings/sessions', label: 'Sessions', kind: 'page' },
]);

const offeredSet = (account, book) => [
  ...menuFor(account).entries,
  ...addressEntries(book),
];

describe('CE-034 — the two shells offer the same set of names', () => {
  test('every shell builds its offered set from the same two sources, and none adds a third', () => {
    for (const [label, file] of Object.entries(SHELLS)) {
      const source = read(file);
      // The composition, whitespace-insensitively: `[...<menu>.entries, ...addressEntries(<book>)]`.
      assert.match(source, /\[\s*\.\.\.\s*\w+(?:\(\))?\.entries\s*,\s*\.\.\.\s*addressEntries\(/,
        `${label} (${file}) does not build its offered set from menuFor().entries + addressEntries()`);
      // And it reaches the SHARED registry for the first half rather than a list of its own.
      assert.match(source, /menuFor/, `${label} does not use the shared menuFor()`);
      assert.doesNotMatch(source, /const\s+AGENT_COMMANDS\s*=/,
        `${label} defines its own command list — a second copy always agrees with itself`);
    }
  });

  test('the set is the whole product, and both halves are in it', () => {
    const offered = offeredSet(OWNER, ADDRESS_BOOK);
    const names = offered.map((entry) => entry.name);

    // Every command, because this account holds every permission any of them asks for.
    for (const command of AGENT_COMMANDS) {
      assert.ok(names.includes(command.name),
        `\`/${command.name}\` is in the shared registry and not in the offered set`);
    }
    // And the addresses, which are the other half of "everything you can do".
    assert.equal(offered.filter((entry) => entry.kind === 'address').length, ADDRESS_BOOK.length,
      'the addresses did not reach the offered set — half the product would be terminal-only or page-only');
    assert.ok(names.length > AGENT_COMMANDS.length, 'the set must be commands PLUS addresses');
  });

  test('the resolver answers to every name in the set, so "offered" means reachable', () => {
    const offered = offeredSet(OWNER, ADDRESS_BOOK);
    for (const entry of offered) {
      const resolved = resolveCommand(`/${entry.name}`, offered);
      assert.ok(resolved, `\`/${entry.name}\` is offered and resolves to nothing — an entry nobody can reach`);
      assert.equal(resolved.command.name, entry.name);
    }
  });

  test('the RUNNING ssh shell resolves every command of the set — not a list agreeing with itself', async () => {
    const offered = offeredSet(OWNER, ADDRESS_BOOK);
    const frames = [];
    const out = new EventEmitter();
    out.columns = 200; out.rows = 60; out.isTTY = false;
    out.write = (chunk) => { frames.push(String(chunk).replace(/\[[0-9;?]*[a-zA-Z]/g, '')); return true; };
    out.off = out.removeListener.bind(out);
    const input = new EventEmitter();
    input.isTTY = false; input.isRaw = false;
    input.off = input.removeListener.bind(input);

    const finished = runFullScreen({
      // Every method answers `{}`: this test is about which names the shell KNOWS, never about
      // what each one returns. A refusal from the engine is not a name the shell failed to have.
      session: { call: async () => ({}) },
      status: {}, account: OWNER, out, input,
    });
    const settle = () => new Promise((done) => { setTimeout(done, 5); });
    await settle();

    const missing = [];
    for (const command of AGENT_COMMANDS) {
      frames.length = 0;
      // TYPED, not submitted. Submitting would run the command; what is under test is whether
      // this shell recognises the name, and `planTurn`'s own "Nothing named" branch is the
      // answer a shell gives to a name it does not have.
      for (const character of `/${command.name}`) input.emit('keypress', character, { name: character });
      await settle();
      const screen = frames.join('\n');
      if (/Nothing named/.test(screen)) missing.push(command.name);
      // Clear the prompt for the next name.
      input.emit('keypress', null, { name: 'u', ctrl: true });
      await settle();
    }
    assert.deepEqual(missing, [],
      'the ssh shell does not know these names, which the browser offers — the two shells have diverged');

    input.emit('keypress', null, { name: 'c', ctrl: true });
    await finished.catch(() => {});
    assert.ok(offered.length, 'the offered set must not be empty, or the assertion above passes vacuously');
  });
});

// --- what to type NEXT: one declaration, and it has to keep naming real things ----------------
//
// Added 2026-09-12, from the Owner's observation: «while CodeN works, the keys to choose the
// consents and the suggestions do not appear in the terminal». `runPlanFlow` printed the run's
// state and stopped, leaving the operator to remember a state machine that lives in the engine.
//
// The same discipline as the rest of this file: the suggestion list is compared against the
// SOURCES it claims to describe — the command table it names, and the engine whose states it
// covers — never against itself.
describe('CE-034 · the next step is suggested from one declaration, and it names real things', () => {
  const suggestHere = dirname(fileURLToPath(import.meta.url));
  const engineSource = readFileSync(join(suggestHere, '../src/workspace-actions.mjs'), 'utf8');
  const tuiSource = readFileSync(join(suggestHere, '../../../tools/tui-client.mjs'), 'utf8');

  test('every suggested name is a command both shells actually offer', () => {
    // The real drift risk: a command renamed in the table above, and a suggestion still pointing
    // at the old word. The operator would be told to type something that does not exist.
    const offered = new Set(AGENT_COMMANDS.map((command) => command.name));
    for (const [state, names] of Object.entries(NEXT_STEPS)) {
      for (const name of names) {
        assert.ok(offered.has(name), `\`${state}\` suggests \`/${name}\`, which no command declares`);
      }
    }
  });

  test('the table names every state the ENGINE can put a run in', () => {
    // Read from the engine's own assignments, so a new state cannot arrive without this failing.
    // A run in a state nobody wrote a row for would print no next step at all, which reads as
    // «there is nothing to do» — the one answer that must never be a side effect of an omission.
    const states = new Set([...engineSource.matchAll(/run\.status = '([A-Z_]+)'/g)].map((m) => m[1]));
    assert.ok(states.size >= 4, 'the engine no longer assigns run.status this way; this test is blind');
    for (const state of states) {
      const named = state === 'MEASURED'
        ? Object.hasOwn(NEXT_STEPS, 'MEASURED_CLEAN') && Object.hasOwn(NEXT_STEPS, 'MEASURED_DIRTY')
        : Object.hasOwn(NEXT_STEPS, state);
      assert.ok(named, `the engine can put a run in \`${state}\` and NEXT_STEPS has no row for it`);
    }
  });

  test('a clean measurement is not offered a repair, and a dirty one is not offered an approval', () => {
    // Not a preference: `repair()` refuses a clean run with NOTHING_TO_REPAIR and `approve()`
    // refuses a dirty one, so offering either would be offering a refusal.
    const clean = nextStepsFor('MEASURED', { clean: true }).map((step) => step.name);
    const dirty = nextStepsFor('MEASURED', { clean: false }).map((step) => step.name);
    assert.ok(clean.includes('approve') && !clean.includes('repair'), clean.join(' '));
    assert.ok(dirty.includes('repair') && !dirty.includes('approve'), dirty.join(' '));
    // Unknown cleanliness offers both halves rather than guessing which one the run is in.
    const unknown = nextStepsFor('MEASURED').map((step) => step.name);
    assert.ok(unknown.includes('approve') && unknown.includes('repair'), unknown.join(' '));
  });

  test('an installation with no model is not told to repair', () => {
    // `CE-029`: with no model `repair()` answers NO_AUTHOR every time. Suggesting it would be
    // sending somebody to discover by typing what the plan already said in words.
    const steps = nextStepsFor('MEASURED', { clean: false, authorAvailable: false }).map((s) => s.name);
    assert.ok(!steps.includes('repair'), steps.join(' '));
    assert.ok(!steps.includes('iterate'), steps.join(' '));
    assert.ok(steps.includes('reject'), 'stopping must always be offered');
  });

  test('a state nobody decided about suggests nothing, rather than something', () => {
    assert.deepEqual(nextStepsFor('REJECTED'), []);
    assert.deepEqual(nextStepsFor('BANANA'), []);
    assert.deepEqual(nextStepsFor(null), []);
  });

  test('the line shell actually prints them, so the declaration is read and not just kept', () => {
    // A list nobody renders is scaffolding. This is the assertion that keeps it wired.
    assert.match(tuiSource, /nextStepsFor\(/,
      'tools/tui-client.mjs no longer asks what comes next: the plan flow went back to printing a state and stopping');
    assert.match(tuiSource, /from '\.\.\/apps\/shared\/coden\/agent-commands\.js'/,
      'the line shell must take the suggestions from the shared declaration, not from a copy');
  });
});
