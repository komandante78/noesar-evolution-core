// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A step abandoned mid-flight must not be skipped.
//
// This defect was found by reviewing the engine, not by any scanner — no static analyser on
// this host can see it, because nothing is syntactically wrong. `advance()` looked for the
// next step whose status was `pending` or `awaiting_approval`. A step left `running` by a
// process that died is neither, so it was passed over; and if every other step had already
// finished, the run was declared `completed`.
//
// That is the worst failure shape this project recognises: a run reporting success while one
// of its steps never finished. It is the same class as the log redactor that corrupted UUIDs
// while every test passed, and as the `--memory-swap` flag that had no effect — the record
// said one thing and reality said another.
//
// The engine is driven directly here rather than over HTTP because there is no route that
// leaves a step `running`, and there should not be one. Killing a process mid-step is what
// produces this state, and the store is the only place that state is observable.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { WorkflowService } from '../src/ai-workspace/workflow-service.mjs';
import { freshTempDir } from './support/workspace.mjs';

function freshService() {
  const directory = freshTempDir('noesar-workflow-interrupted-');
  const store = new AtomicJsonStore(join(directory, 'state/ai-workspace.json'));
  const appended = [];
  const service = new WorkflowService({ store, ledger: { append: (entry) => appended.push(entry) } });
  return { store, service, appended };
}

// Simulates the process dying mid-step: the step is left `running`, with an attempt record
// that was opened and never closed. Exactly what the store would hold after a SIGKILL.
function abandonStep(store, runId, stepKey) {
  store.transact((state) => {
    const run = state.workflowRuns.find((candidate) => candidate.id === runId);
    const step = run.steps.find((candidate) => candidate.key === stepKey);
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    step.attempts.push({ attempt: 1, startedAt: new Date().toISOString(), endedAt: null, result: 'running', error: null });
    run.status = 'running';
  });
}

describe('a step interrupted by a dead process', () => {
  test('is not skipped, and the run is not reported completed', async () => {
    const { store, service } = freshService();
    const workflow = service.createWorkflow({
      name: 'interrupted',
      steps: [
        { key: 'first', type: 'transform', operation: 'identity' },
        { key: 'second', type: 'transform', operation: 'identity' },
      ],
    });
    const run = service.createRun({ workflowId: workflow.id, input: { n: 1 } });

    // The first step finished; the second was in flight when the process stopped.
    store.transact((state) => {
      const current = state.workflowRuns.find((candidate) => candidate.id === run.id);
      const first = current.steps.find((candidate) => candidate.key === 'first');
      first.status = 'completed';
      first.output = { n: 1 };
      first.completedAt = new Date().toISOString();
    });
    abandonStep(store, run.id, 'second');

    const resumed = await service.advance(run.id, 'operator');
    assert.notEqual(resumed.status, 'completed',
      'a run with a step that never finished must never be reported as completed');
    assert.equal(resumed.status, 'failed');
    assert.match(resumed.error, /was interrupted before it finished/);
  });

  test('is recorded as interrupted, distinctly from a step that failed on its own', async () => {
    const { store, service } = freshService();
    const workflow = service.createWorkflow({ name: 'interrupted-record', steps: [{ key: 'only', type: 'transform', operation: 'identity' }] });
    const run = service.createRun({ workflowId: workflow.id });
    abandonStep(store, run.id, 'only');

    const resumed = await service.advance(run.id, 'operator');
    const step = resumed.steps[0];
    assert.equal(step.status, 'interrupted',
      '"interrupted" and "failed" are different facts and an operator must be able to tell them apart');
    assert.match(step.error, /stopped before it finished/);
    assert.ok(resumed.evidence.some((entry) => entry.event === 'step.interrupted'),
      'the interruption must be in the evidence, not silently repaired');
  });

  test('the open attempt record is closed rather than left dangling', async () => {
    const { store, service } = freshService();
    const workflow = service.createWorkflow({ name: 'attempt-closed', steps: [{ key: 'only', type: 'transform', operation: 'identity' }] });
    const run = service.createRun({ workflowId: workflow.id });
    abandonStep(store, run.id, 'only');

    const resumed = await service.advance(run.id, 'operator');
    const attempt = resumed.steps[0].attempts[0];
    assert.ok(attempt.endedAt, 'an attempt with no end time cannot be reasoned about');
    assert.equal(attempt.result, 'interrupted');
  });

  test('work already completed is still compensated', async () => {
    // The interrupted step's own effects are unknown, but the steps before it succeeded and
    // their compensation is exactly as due as it would be after any other failure.
    const { store, service } = freshService();
    const workflow = service.createWorkflow({
      name: 'interrupted-compensation',
      steps: [
        { key: 'first', type: 'transform', operation: 'identity', compensation: { type: 'transform', operation: 'constant', config: { value: 'undone' } } },
        { key: 'second', type: 'transform', operation: 'identity' },
      ],
    });
    const run = service.createRun({ workflowId: workflow.id });
    store.transact((state) => {
      const current = state.workflowRuns.find((candidate) => candidate.id === run.id);
      const first = current.steps.find((candidate) => candidate.key === 'first');
      first.status = 'completed';
      first.completedAt = new Date().toISOString();
      first.compensation.status = 'pending';
    });
    abandonStep(store, run.id, 'second');

    const resumed = await service.advance(run.id, 'operator');
    assert.equal(resumed.status, 'failed');
    assert.equal(resumed.steps[0].compensation.status, 'compensated');
  });

  test('the interruption is reported to the audit ledger', async () => {
    const { store, service, appended } = freshService();
    const workflow = service.createWorkflow({ name: 'interrupted-audit', steps: [{ key: 'only', type: 'transform', operation: 'identity' }] });
    const run = service.createRun({ workflowId: workflow.id });
    abandonStep(store, run.id, 'only');
    await service.advance(run.id, 'operator');
    assert.ok(appended.some((entry) => entry.action === 'workflow.run-interrupted'),
      'an interrupted run is an operational event, not only an internal state change');
  });

  test('a healthy run is unaffected by the reconciliation', async () => {
    const { service } = freshService();
    const workflow = service.createWorkflow({
      name: 'healthy',
      steps: [
        { key: 'a', type: 'transform', operation: 'count' },
        { key: 'b', type: 'transform', operation: 'identity' },
      ],
    });
    const run = service.createRun({ workflowId: workflow.id, input: [1, 2, 3] });
    const finished = await service.advance(run.id, 'operator');
    assert.equal(finished.status, 'completed');
    assert.deepEqual(finished.steps.map((step) => step.status), ['completed', 'completed']);
    assert.equal(finished.evidence.some((entry) => entry.event === 'step.interrupted'), false);
  });

  test('every attempt of a healthy run is opened and closed', async () => {
    const { service } = freshService();
    const workflow = service.createWorkflow({ name: 'attempts-closed', steps: [{ key: 'a', type: 'transform', operation: 'identity' }] });
    const run = service.createRun({ workflowId: workflow.id });
    const finished = await service.advance(run.id, 'operator');
    for (const attempt of finished.steps[0].attempts) {
      assert.ok(attempt.startedAt && attempt.endedAt, JSON.stringify(attempt));
      assert.equal(attempt.result, 'completed');
    }
  });
});
