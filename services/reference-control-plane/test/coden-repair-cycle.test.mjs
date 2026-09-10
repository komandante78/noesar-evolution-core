// SPDX-License-Identifier: AGPL-3.0-or-later
//
// THE CYCLE: modifica -> test -> ripara.
//
// WHY THIS FILE EXISTS. Every half of this loop was already built. `author()` has accepted
// `attempts` and `previousAttemptDigests` since it was written, `#authoringHistory` has always
// built them, the novelty budget has always been there to stop a small model repeating itself,
// and the shadow / `compare()` / promotion / refusal have been measured for weeks. What no code
// path did was carry a MEASURED FAILURE back to the Author: an attempt sentence said what had
// been tried (`goal -> paths`) and never why it did not work, because at `plan()` time nothing
// has been measured and after `measure()` nothing read the result back.
//
// So every plan the product ever made was one shot. On the SWE-bench capture of 10/09/2026 that
// is `1 step` on 155 of 155 plans. This is the join, and these are its criteria.
//
// THE ORACLE, and it was run rather than asserted. Against the tree at `45e71d30` — the commit
// before this one — the whole file refuses to load:
//
//   SyntaxError: The requested module '../src/workspace-actions.mjs' does not provide an
//   export named 'repairBrief'                              # tests 1, pass 0, fail 1
//
// Which is the honest shape of the oracle for a mechanism that did not exist: there is no
// `repair()` to call, no `iterate()`, and no second prompt for the assertion that matters to
// be made about. Stated as it happened and not as a per-test failure list, because claiming
// thirteen individual failures nobody watched would be the same defect this file is about.
//
// No sandbox binary is needed anywhere in this file, deliberately, so the loop is proven on
// every machine that runs the suite. The failure driven end-to-end is the one a weak model
// actually produces: it returns the file it was given, nothing is written, and `compare()`
// REFUSES the observation — «an observation of nothing cannot be compared: it is
// indistinguishable from a clean run». That path was found by executing this file, not by
// reading the code: the first version of `repairBrief` read only `surprise`, which is `null`
// there, so it had nothing to say about the commonest failure of all. The command-output half
// is proven directly against `repairBrief`, which is exported for exactly that reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator, WorkspaceActionError, repairBrief } from '../src/workspace-actions.mjs';
import { Author } from '../src/author.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const NOW = Math.floor(Date.now() / 1000);
const ORIGINAL = 'original\n';
const fenced = (body) => `\`\`\`\n${body}\`\`\``;

/**
 * `answers` is consumed one per model call; the last one repeats, so a test that wants "the
 * model keeps saying the same thing" says it with one element instead of a counter.
 */
function fixture({ answers = [fenced(ORIGINAL)], noveltyBudget = 5 } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-cycle-ws-'));
  writeFileSync(join(ws, 'a.txt'), ORIGINAL);
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-cycle-shadows-'));
  const prompts = [];
  const author = new Author({
    model: 'test-model',
    generate: async ({ prompt }) => {
      const answer = answers[Math.min(prompts.length, answers.length - 1)];
      prompts.push(prompt);
      return answer;
    },
  });
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32), { ceiling: null }),
    events: new EventLedger(),
    author, noveltyBudget,
    // `env: {}`, not the ambient one: an operator shell that had selected an external reasoning
    // provider must not change what this fixture measures.
    env: {},
  });
  const plan = () => orch.plan({
    request: 'make a.txt say something else',
    files: [{ path: 'a.txt', contents: ORIGINAL }],
    actor: 'owner', nowUnix: NOW, conversationId: 'c-1',
  });
  return { ws, shadows, orch, prompts, plan, read: () => readFileSync(join(ws, 'a.txt'), 'utf8') };
}
const cleanup = ({ ws, shadows }) => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(shadows, { recursive: true, force: true });
};
// Takes a THUNK, not a promise. `approve()` and `measure()` are synchronous and throw before a
// promise ever exists, so a helper that only awaited one would let their refusal escape the
// test — which is how this file first reported a correct `NOT_MEASURED` as a failure.
const refusal = async (work) => {
  try { await work(); return null; } catch (error) {
    if (error instanceof WorkspaceActionError) return error;
    throw error;
  }
};

// --- the join itself ----------------------------------------------------------------------

test('the repair prompt carries the failure the measurement found', async () => {
  // THE criterion of this whole piece of work. Everything else here protects it.
  const fx = fixture({ answers: [fenced(ORIGINAL), fenced('repaired\n')] });
  try {
    const { runId } = await fx.plan();
    const first = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(first.clean, false, 'a write that changes nothing must not measure clean');
    // The model returned the file it was given, so nothing was written and `compare()` refused
    // the observation rather than calling it clean. That refusal is the failure being repaired.
    assert.ok(first.result.comparisonRefused, 'a run that changed nothing cannot be compared');

    await fx.orch.repair({ runId, actor: 'owner', nowUnix: NOW });

    assert.equal(fx.prompts.length, 2, 'the repair is a second call to the Author');
    const repairPrompt = fx.prompts[1];
    assert.match(repairPrompt, /Approaches already tried on this step — do not repeat them:/);
    // Not "something failed": the sentence says what was wrong in terms the writer can act on.
    // This is the byte-level difference between a loop and a retry.
    assert.match(repairPrompt, /returned the file it was given, byte for byte/);
    assert.match(repairPrompt, /ITS OWN DECLARED TESTS REFUSED IT/);
    // And the first prompt could not have carried it: nothing had been measured yet.
    assert.doesNotMatch(fx.prompts[0], /returned the file it was given/);
  } finally { cleanup(fx); }
});

test('the cycle closes: a run that measured dirty is repaired and measures clean', async () => {
  const fx = fixture({ answers: [fenced(ORIGINAL), fenced('repaired\n')] });
  try {
    const { runId } = await fx.plan();
    const outcome = await fx.orch.iterate({ runId, actor: 'owner', nowUnix: NOW, maxAttempts: 3 });
    assert.equal(outcome.clean, true);
    assert.equal(outcome.stopped, 'clean');
    assert.equal(outcome.attempts.length, 2, 'one failing measurement, one repair, one clean measurement');
    assert.equal(outcome.attempts[0].clean, false);
    assert.equal(outcome.attempts[1].clean, true);
    assert.equal(outcome.status, 'MEASURED');

    // And the loop leaves a run the existing calls still accept — the promotion path is
    // untouched by any of this.
    const approved = fx.orch.approve({ runId, approverId: 'owner', nowUnix: NOW });
    assert.equal(approved.promoted, true);
    assert.equal(fx.read(), 'repaired\n');
  } finally { cleanup(fx); }
});

// --- what the loop must never do ----------------------------------------------------------

test('a repaired run is PENDING_APPROVAL again, and approve() refuses it — CE-008 survives the loop', async () => {
  // The reason `repair()` is a separate call and not a flag on `measure()`. New bytes nobody
  // has measured must not be approvable, and the refusal must be the SAME one CE-008 already
  // gives — not a new kind a shell would have to learn.
  const fx = fixture({ answers: [fenced(ORIGINAL)] });
  try {
    const { runId } = await fx.plan();
    fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    const repaired = await fx.orch.repair({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(repaired.status, 'PENDING_APPROVAL');
    assert.equal(repaired.attempt, 2);

    const error = await refusal(() => fx.orch.approve({ runId, approverId: 'owner', nowUnix: NOW }));
    assert.ok(error, 'unmeasured repaired bytes must not be approvable');
    assert.equal(error.kind, 'NOT_MEASURED');
    assert.equal(fx.read(), ORIGINAL, 'nothing reached the workspace');
  } finally { cleanup(fx); }
});

test('a clean run is not repairable: a measured result the approver can act on is not replaced', async () => {
  const fx = fixture({ answers: [fenced('repaired\n')] });
  try {
    const { runId } = await fx.plan();
    const measured = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(measured.clean, true);
    const error = await refusal(() => fx.orch.repair({ runId, actor: 'owner', nowUnix: NOW }));
    assert.ok(error, 'a clean run has nothing to repair');
    assert.equal(error.kind, 'NOTHING_TO_REPAIR');
  } finally { cleanup(fx); }
});

test('repair() refuses a run nobody has measured', async () => {
  const fx = fixture();
  try {
    const { runId } = await fx.plan();
    const error = await refusal(() => fx.orch.repair({ runId, actor: 'owner', nowUnix: NOW }));
    assert.ok(error);
    assert.equal(error.kind, 'NOT_MEASURED');
  } finally { cleanup(fx); }
});

// --- the loop stops, and says why ---------------------------------------------------------

test('the loop stops at maxAttempts and never spends a measurement more than it was given', async () => {
  // The ceiling is the property, whatever the run does: `maxAttempts` is what the caller is
  // paying for, and a loop that took one more measurement than it was given would be a cost
  // nobody authorised.
  const fx = fixture({ answers: [fenced(ORIGINAL)] });
  try {
    const { runId } = await fx.plan();
    const outcome = await fx.orch.iterate({ runId, actor: 'owner', nowUnix: NOW, maxAttempts: 2 });
    assert.ok(outcome.attempts.length <= 2, `took ${outcome.attempts.length} measurements for maxAttempts 2`);
    assert.ok(['clean', 'exhausted', 'repeat', 'refused'].includes(outcome.stopped));
    assert.equal(outcome.status, 'MEASURED', 'the loop always leaves a measured run');
  } finally { cleanup(fx); }
});

test('a model that repeats itself stops the loop, and its bytes are still measured', async () => {
  // `CE-030` / `15` §5 — a repeat is not an attempt. Asking again would spend a model call to
  // receive the same answer, so the ASKING stops; but the run must still carry a verdict about
  // the bytes it actually holds, or a caller would read a failure belonging to replaced text.
  const fx = fixture({ answers: [fenced(ORIGINAL)] });
  try {
    const { runId } = await fx.plan();
    const outcome = await fx.orch.iterate({ runId, actor: 'owner', nowUnix: NOW, maxAttempts: 5 });
    assert.equal(outcome.clean, false);
    assert.equal(outcome.stopped, 'repeat');
    assert.equal(outcome.status, 'MEASURED');
    assert.ok(fx.prompts.length < 5, `the loop kept asking a model that had nothing new: ${fx.prompts.length} calls`);
  } finally { cleanup(fx); }
});

test('the exhausted novelty budget stops the loop as a refusal, with its reason', async () => {
  const fx = fixture({ answers: [fenced(ORIGINAL), fenced('b\n'), fenced('c\n')], noveltyBudget: 1 });
  try {
    const { runId } = await fx.plan();
    const outcome = await fx.orch.iterate({ runId, actor: 'owner', nowUnix: NOW, maxAttempts: 5 });
    assert.equal(outcome.clean, false);
    assert.ok(['refused', 'repeat'].includes(outcome.stopped), `stopped: ${outcome.stopped}`);
    assert.equal(outcome.status, 'MEASURED');
  } finally { cleanup(fx); }
});

// --- the evidence a repair is given -------------------------------------------------------

test('repairBrief carries the exit code and the text the command printed, not just "it failed"', () => {
  const brief = repairBrief({
    surprise: { declaredCommandsThatFailed: ['npm test'], testsExpectedToPassThatFailed: [], testsNeverRun: [], expectedAndAbsent: [], unexpected: [] },
    outcomes: [{ operation: 'EXECUTE', name: 'npm test', performed: true, exitCode: 1, stdout: '', stderr: 'AssertionError: expected 3 to equal 4' }],
  });
  assert.equal(brief.length, 1);
  assert.match(brief[0], /`npm test` exited 1/);
  assert.match(brief[0], /AssertionError: expected 3 to equal 4/);
});

test('repairBrief keeps the END of a long output, because that is where the error is', () => {
  // A build that prints a thousand warnings puts the fault it stopped on last. A head-first
  // budget would send the model the banner and drop the reason.
  const noise = `${'warning: unused\n'.repeat(500)}error: THE ACTUAL FAULT\n`;
  const brief = repairBrief({
    surprise: { declaredCommandsThatFailed: ['make'], testsExpectedToPassThatFailed: [], testsNeverRun: [], expectedAndAbsent: [], unexpected: [] },
    outcomes: [{ operation: 'EXECUTE', name: 'make', performed: true, exitCode: 2, stdout: '', stderr: noise }],
  }, { budget: 200 });
  assert.match(brief[0], /error: THE ACTUAL FAULT/);
  assert.ok(brief[0].length < 400, 'the budget must bound what travels to the model');
});

test('repairBrief says nothing about a command that was DECLARED to fail', () => {
  // There the failure is the claim, and `compare()` already excludes it from the surprise.
  // A repair asked to fix an expected failure would be asked to break the plan.
  const brief = repairBrief({
    surprise: { declaredCommandsThatFailed: [], testsExpectedToPassThatFailed: [], testsNeverRun: [], expectedAndAbsent: [], unexpected: [] },
    outcomes: [{ operation: 'EXECUTE', name: '/bin/false', performed: true, exitCode: 1, stdout: '', stderr: '' }],
  });
  assert.deepEqual(brief, []);
});

test('repairBrief names the paths the comparison found wrong, in both directions', () => {
  const brief = repairBrief({
    surprise: {
      declaredCommandsThatFailed: [], testsExpectedToPassThatFailed: [], testsNeverRun: ['npm test'],
      expectedAndAbsent: ['src/a.js'], unexpected: ['src/b.js'],
    },
    outcomes: [],
  });
  assert.equal(brief.length, 3);
  assert.match(brief[0], /`npm test` never ran/);
  assert.match(brief[1], /`src\/a\.js` was declared as changed and no change reached it/);
  assert.match(brief[2], /`src\/b\.js` was written and no step declared it/);
});

test('repairBrief on a run with no comparison is empty, not a guess', () => {
  assert.deepEqual(repairBrief(null), []);
  assert.deepEqual(repairBrief({ outcomes: [] }), []);
});
