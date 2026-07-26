// SPDX-License-Identifier: AGPL-3.0-or-later
//
// WP-2 — the workflow engine, tested against the properties the specification names.
//
// MASTER_REFERENCE/04_AI_PLATFORM/46 requires "typed steps, retries, compensation,
// idempotency, timeout, cancellation, human approval, evidence and replay where
// possible". There is one test below per property, and each is written to fail if the
// property is absent rather than to confirm that the happy path returns 200.
//
// Two of them are worth naming here because they defend against defects this project has
// already paid for:
//
//   * `host_mutation` is refused. This build has `executionEnabled:false` and no execution
//     surface, so a step type that claims to write to the host must fail closed and name
//     the layer that owns it. A workflow that appeared to perform host mutations would be
//     the same false claim as the invariant list nothing enforced.
//
//   * A run snapshots its definition. Editing a workflow afterwards must not rewrite what
//     already ran, and a replay must replay the original — not the edit.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-workflows-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server, watchdog } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;

async function request(method, path, payload, extraHeaders = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-noesar-csrf': csrf } : {}),
      ...extraHeaders,
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, json, text };
}

const get = (path) => request('GET', path);
const post = (path, payload = {}, headers = {}) => request('POST', path, payload, headers);
const patch = (path, payload = {}) => request('PATCH', path, payload);

// Creates a workflow and returns it, failing the test loudly if the definition is refused.
async function defineWorkflow(definition) {
  const created = await post('/api/v1/workflows', definition);
  assert.equal(created.status, 201, `workflow definition refused: ${created.text.slice(0, 300)}`);
  return created.json;
}

async function startRun(workflowId, payload = {}) {
  const started = await post(`/api/v1/workflows/${workflowId}/runs`, payload);
  assert.ok([200, 201].includes(started.status), `run start failed: ${started.text.slice(0, 300)}`);
  return started;
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const begun = await post('/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': SETUP_TOKEN });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);

  const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: begun.json.challenge, totpCode: totpCode(begun.json.totpSecret, stepStart(-1)) }),
  });
  const confirmedText = await response.text();
  assert.equal(response.status, 201, `setup confirm failed: ${confirmedText.slice(0, 200)}`);
  const confirmed = JSON.parse(confirmedText);
  cookie = (response.headers.getSetCookie?.() ?? []).find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = confirmed.csrfToken;
});

after(async () => {
  watchdog.stop();
  await new Promise((resolve) => server.close(resolve));
});

describe('typed steps', () => {
  test('the step vocabulary is closed and an unknown type is refused', async () => {
    const refused = await post('/api/v1/workflows', {
      name: 'unknown type',
      steps: [{ key: 'a', type: 'exfiltrate_everything' }],
    });
    assert.equal(refused.status, 400, 'an unknown step type must be refused, not stored');
    assert.match(refused.json.error, /Unknown step type/);
  });

  test('every declared type states its effects and whether this build can execute it', async () => {
    const listed = await get('/api/v1/workflows');
    assert.equal(listed.status, 200);
    const types = listed.json.stepTypes;
    assert.ok(Array.isArray(types) && types.length >= 5, 'the type vocabulary must travel with the list');
    for (const type of types) {
      assert.ok(Array.isArray(type.effects), `${type.type} must declare its effects`);
      assert.equal(typeof type.executable, 'boolean', `${type.type} must state whether it is executable`);
      if (type.executable === false) {
        assert.ok(type.enforcedBy, `${type.type} is not executable here and must name the layer that owns it`);
      }
    }
  });

  test('a host_mutation step is refused by this build instead of pretending to run', async () => {
    const workflow = await defineWorkflow({
      name: 'declared host mutation',
      steps: [{ key: 'write', type: 'host_mutation', title: 'Write to the host', requiresApproval: false }],
    });
    const started = await startRun(workflow.id);
    assert.equal(started.json.status, 'failed', `a non-executable step must fail the run: ${JSON.stringify(started.json.steps)}`);
    assert.match(started.json.error, /not executable in this build/);
    assert.match(started.json.error, /execution layer/);
  });

  test('a transform operation outside the fixed registry is refused', async () => {
    const refused = await post('/api/v1/workflows', {
      name: 'arbitrary operation',
      steps: [{ key: 'a', type: 'transform', operation: 'process.exit' }],
    });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /Unknown transform operation/);
  });
});

describe('a deterministic run completes and carries its evidence', () => {
  test('steps run in order and the run output is the last step output', async () => {
    const workflow = await defineWorkflow({
      name: 'count then pick',
      steps: [
        { key: 'count', type: 'transform', operation: 'count' },
        { key: 'keep', type: 'transform', operation: 'pick', config: { keys: ['count'] } },
      ],
    });
    const started = await startRun(workflow.id, { input: [1, 2, 3, 4] });
    assert.equal(started.json.status, 'completed', `run did not complete: ${started.text.slice(0, 300)}`);
    assert.deepEqual(started.json.output, { count: 4 });
    assert.deepEqual(started.json.steps.map((step) => step.status), ['completed', 'completed']);
  });

  test('evidence records every attempt, including the ones that failed', async () => {
    const workflow = await defineWorkflow({
      name: 'evidence',
      steps: [{ key: 'only', type: 'transform', operation: 'identity' }],
    });
    const started = await startRun(workflow.id, { input: { probe: true } });
    const events = started.json.evidence.map((entry) => entry.event);
    assert.ok(events.includes('run.created'), 'evidence must record the run being created');
    assert.ok(events.includes('step.attempt-started'), 'evidence must record each attempt starting');
    assert.ok(events.includes('step.completed'), 'evidence must record the step completing');
    assert.ok(events.includes('run.completed'), 'evidence must record the terminal state');
    // Sequence numbers are what make the record readable as a history rather than a set.
    assert.deepEqual(
      started.json.evidence.map((entry) => entry.seq),
      started.json.evidence.map((_entry, index) => index + 1),
    );
  });
});

describe('retries', () => {
  test('a step that keeps failing is attempted exactly maxAttempts times', async () => {
    // `pick` on a non-object input is harmless; to force a repeatable failure the step
    // asks for a tool that has no granted consent — the default state of every tool.
    const workflow = await defineWorkflow({
      name: 'retry until exhausted',
      steps: [{
        key: 'call',
        type: 'tool_call',
        toolId: '00000000-0000-4000-8000-000000000000',
        requiresApproval: false,
        retry: { maxAttempts: 3, backoffMs: 0 },
      }],
    });
    const started = await startRun(workflow.id);
    assert.equal(started.json.status, 'failed');
    const step = started.json.steps[0];
    assert.equal(step.attempts.length, 3, `expected 3 attempts, saw ${step.attempts.length}`);
    assert.ok(step.attempts.every((attempt) => attempt.result === 'failed'));
    assert.deepEqual(step.attempts.map((attempt) => attempt.attempt), [1, 2, 3]);
  });

  test('maxAttempts is clamped rather than trusted', async () => {
    const workflow = await defineWorkflow({
      name: 'absurd retry budget',
      steps: [{ key: 'a', type: 'transform', operation: 'identity', retry: { maxAttempts: 10_000 } }],
    });
    assert.equal(workflow.steps[0].retry.maxAttempts, 5, 'an unbounded retry budget is a denial of service against ourselves');
  });
});

describe('timeout', () => {
  test('a step that outlives its timeout is recorded as timed out', async () => {
    const workflow = await defineWorkflow({
      name: 'slow step',
      steps: [{ key: 'slow', type: 'wait', durationMs: 5_000, timeoutMs: 50, requiresApproval: false, retry: { maxAttempts: 1 } }],
    });
    const started = await startRun(workflow.id);
    assert.equal(started.json.status, 'failed');
    assert.equal(started.json.steps[0].attempts[0].result, 'timed_out',
      'a step killed by its timeout must be distinguishable from one that failed on its own');
    assert.match(started.json.steps[0].error, /timeout/);
  });
});

describe('human approval', () => {
  test('a step requiring approval suspends the run and appears in the queue', async () => {
    const workflow = await defineWorkflow({
      name: 'needs a human',
      steps: [
        { key: 'gate', type: 'human_approval', title: 'Confirm the plan' },
        { key: 'after', type: 'transform', operation: 'identity' },
      ],
    });
    const started = await startRun(workflow.id, { input: { value: 7 } });
    assert.equal(started.json.status, 'awaiting_approval', 'the run must suspend, not fail and not proceed');
    assert.equal(started.json.steps[0].status, 'awaiting_approval');
    assert.equal(started.json.steps[1].status, 'pending', 'the following step must not have run');

    const queue = await get('/api/v1/approvals');
    assert.equal(queue.status, 200);
    const item = queue.json.approvals.find((entry) => entry.runId === started.json.id);
    assert.ok(item, 'a suspended step must be visible in the approval queue');
    assert.equal(item.kind, 'workflow-step');
    assert.deepEqual(item.effects, ['APPROVAL_GATE']);

    const decided = await post(`/api/v1/approvals/${encodeURIComponent(item.id)}/decision`, { decision: 'approve', reason: 'checked' });
    assert.equal(decided.status, 200, `approval failed: ${decided.text.slice(0, 300)}`);
    assert.equal(decided.json.run.status, 'completed', 'approving must resume the run to completion');
    assert.equal(decided.json.run.steps[1].status, 'completed');
  });

  test('a rejection stops the run and is recorded with its reason', async () => {
    const workflow = await defineWorkflow({
      name: 'rejected',
      steps: [
        { key: 'gate', type: 'human_approval', title: 'Confirm' },
        { key: 'after', type: 'transform', operation: 'identity' },
      ],
    });
    const started = await startRun(workflow.id);
    const stepId = started.json.steps[0].id;
    const decided = await post(`/api/v1/workflow-runs/${started.json.id}/steps/${stepId}/decision`, { decision: 'reject', reason: 'not this time' });
    assert.equal(decided.status, 200);
    assert.equal(decided.json.status, 'rejected');
    assert.equal(decided.json.steps[0].approval.decision, 'reject');
    assert.equal(decided.json.steps[0].approval.reason, 'not this time');
    assert.equal(decided.json.steps[1].status, 'pending', 'a rejected gate must not let the rest of the run proceed');
  });

  test('deciding a step that is not awaiting a decision is refused', async () => {
    const workflow = await defineWorkflow({ name: 'no gate', steps: [{ key: 'a', type: 'transform', operation: 'identity' }] });
    const started = await startRun(workflow.id);
    const refused = await post(`/api/v1/workflow-runs/${started.json.id}/steps/${started.json.steps[0].id}/decision`, { decision: 'approve' });
    assert.equal(refused.status, 409);
  });
});

describe('idempotency', () => {
  test('the same idempotency key starts one run, not two', async () => {
    const workflow = await defineWorkflow({ name: 'idempotent', steps: [{ key: 'a', type: 'transform', operation: 'identity' }] });
    const first = await startRun(workflow.id, { input: { n: 1 }, idempotencyKey: 'order-4417' });
    assert.equal(first.status, 201);
    const second = await startRun(workflow.id, { input: { n: 1 }, idempotencyKey: 'order-4417' });
    assert.equal(second.status, 200, 'a repeated start is not a new resource');
    assert.equal(second.json.id, first.json.id, 'the second call must return the first run');
    assert.equal(second.json.deduplicated, true);

    const runs = await get(`/api/v1/workflow-runs?workflowId=${workflow.id}`);
    assert.equal(runs.json.runs.length, 1, 'exactly one run may exist for one idempotency key');
  });

  test('runs without a key are independent', async () => {
    const workflow = await defineWorkflow({ name: 'not idempotent', steps: [{ key: 'a', type: 'transform', operation: 'identity' }] });
    const first = await startRun(workflow.id);
    const second = await startRun(workflow.id);
    assert.notEqual(first.json.id, second.json.id);
  });
});

describe('cancellation', () => {
  test('cancelling a suspended run ends it and marks the waiting step cancelled', async () => {
    const workflow = await defineWorkflow({
      name: 'cancel me',
      steps: [
        { key: 'gate', type: 'human_approval', title: 'Confirm' },
        { key: 'after', type: 'transform', operation: 'identity' },
      ],
    });
    const started = await startRun(workflow.id);
    assert.equal(started.json.status, 'awaiting_approval');
    const cancelled = await post(`/api/v1/workflow-runs/${started.json.id}/cancel`, { reason: 'no longer needed' });
    assert.equal(cancelled.status, 200, cancelled.text.slice(0, 300));
    assert.equal(cancelled.json.status, 'cancelled');
    assert.equal(cancelled.json.steps[0].status, 'cancelled');
    assert.ok(cancelled.json.evidence.some((entry) => entry.event === 'run.cancellation-requested'));

    const queue = await get('/api/v1/approvals');
    assert.equal(queue.json.approvals.some((item) => item.runId === started.json.id), false,
      'a cancelled run must leave the approval queue');
  });

  test('cancelling a finished run is refused', async () => {
    const workflow = await defineWorkflow({ name: 'already done', steps: [{ key: 'a', type: 'transform', operation: 'identity' }] });
    const started = await startRun(workflow.id);
    assert.equal(started.json.status, 'completed');
    const refused = await post(`/api/v1/workflow-runs/${started.json.id}/cancel`, {});
    assert.equal(refused.status, 409);
  });
});

describe('compensation', () => {
  test('a failing run compensates its completed steps in reverse order', async () => {
    const workflow = await defineWorkflow({
      name: 'compensated',
      steps: [
        { key: 'first', type: 'transform', operation: 'identity', compensation: { type: 'transform', operation: 'constant', config: { value: 'undone-first' } } },
        { key: 'second', type: 'transform', operation: 'identity', compensation: { type: 'transform', operation: 'constant', config: { value: 'undone-second' } } },
        { key: 'boom', type: 'host_mutation', requiresApproval: false, retry: { maxAttempts: 1 } },
      ],
    });
    const started = await startRun(workflow.id, { input: { n: 1 } });
    assert.equal(started.json.status, 'failed');
    assert.equal(started.json.steps[0].compensation.status, 'compensated');
    assert.equal(started.json.steps[1].compensation.status, 'compensated');

    // Reverse order is the whole point: undoing step 1 before step 2 can leave state that
    // step 2's compensation then depends on and cannot find.
    const compensated = started.json.evidence.filter((entry) => entry.event === 'step.compensated').map((entry) => entry.stepKey);
    assert.deepEqual(compensated, ['second', 'first']);
  });

  test('a step with no compensation declared is simply not compensated', async () => {
    const workflow = await defineWorkflow({
      name: 'uncompensated',
      steps: [
        { key: 'first', type: 'transform', operation: 'identity' },
        { key: 'boom', type: 'host_mutation', requiresApproval: false, retry: { maxAttempts: 1 } },
      ],
    });
    const started = await startRun(workflow.id);
    assert.equal(started.json.status, 'failed');
    assert.equal(started.json.steps[0].compensation, null);
  });

  test('a compensation that itself fails is reported, not swallowed', async () => {
    const workflow = await defineWorkflow({
      name: 'compensation fails',
      steps: [
        { key: 'first', type: 'transform', operation: 'identity', compensation: { type: 'host_mutation' } },
        { key: 'boom', type: 'host_mutation', requiresApproval: false, retry: { maxAttempts: 1 } },
      ],
    });
    const started = await startRun(workflow.id);
    assert.equal(started.json.status, 'compensation_failed',
      'a half-undone run that reports plain failure hides that the undo did not work');
    assert.equal(started.json.steps[0].compensation.status, 'failed');
    assert.ok(started.json.evidence.some((entry) => entry.event === 'step.compensation-failed'));
  });

  test('cancellation compensates too', async () => {
    const workflow = await defineWorkflow({
      name: 'cancel after work',
      steps: [
        { key: 'work', type: 'transform', operation: 'identity', compensation: { type: 'transform', operation: 'constant', config: { value: 'rolled back' } } },
        { key: 'gate', type: 'human_approval', title: 'Confirm' },
      ],
    });
    const started = await startRun(workflow.id);
    assert.equal(started.json.status, 'awaiting_approval');
    assert.equal(started.json.steps[0].status, 'completed');
    const cancelled = await post(`/api/v1/workflow-runs/${started.json.id}/cancel`, {});
    assert.equal(cancelled.json.status, 'cancelled');
    assert.equal(cancelled.json.steps[0].compensation.status, 'compensated',
      'work already done must be undone when the run is abandoned');
  });
});

describe('replay', () => {
  test('a finished deterministic run replays to the same step outcomes', async () => {
    const workflow = await defineWorkflow({
      name: 'replayable',
      steps: [
        { key: 'count', type: 'transform', operation: 'count' },
        { key: 'keep', type: 'transform', operation: 'pick', config: { keys: ['count'] } },
      ],
    });
    const original = await startRun(workflow.id, { input: ['a', 'b', 'c'] });
    assert.equal(original.json.status, 'completed');

    const replayed = await post(`/api/v1/workflow-runs/${original.json.id}/replay`, {});
    assert.equal(replayed.status, 201, replayed.text.slice(0, 300));
    assert.equal(replayed.json.replayOf, original.json.id);
    assert.equal(replayed.json.status, original.json.status);
    assert.deepEqual(replayed.json.output, original.json.output);
    assert.deepEqual(
      replayed.json.steps.map((step) => [step.key, step.status]),
      original.json.steps.map((step) => [step.key, step.status]),
    );
  });

  test('a replay does not mutate the run it replays', async () => {
    const workflow = await defineWorkflow({ name: 'immutable original', steps: [{ key: 'a', type: 'transform', operation: 'identity' }] });
    const original = await startRun(workflow.id, { input: { n: 5 } });
    const before = await get(`/api/v1/workflow-runs/${original.json.id}`);
    await post(`/api/v1/workflow-runs/${original.json.id}/replay`, {});
    const afterReplay = await get(`/api/v1/workflow-runs/${original.json.id}`);
    assert.deepEqual(afterReplay.json.evidence, before.json.evidence,
      'the original evidence is the only record of what is being compared against');
  });

  test('an unfinished run cannot be replayed', async () => {
    const workflow = await defineWorkflow({ name: 'still waiting', steps: [{ key: 'gate', type: 'human_approval' }] });
    const started = await startRun(workflow.id);
    const refused = await post(`/api/v1/workflow-runs/${started.json.id}/replay`, {});
    assert.equal(refused.status, 409);
  });
});

describe('a run is bound to the definition it started from', () => {
  test('editing the workflow afterwards does not change what already ran, or its replay', async () => {
    const workflow = await defineWorkflow({
      name: 'versioned',
      steps: [{ key: 'a', type: 'transform', operation: 'constant', config: { value: 'first-definition' } }],
    });
    const original = await startRun(workflow.id);
    assert.equal(original.json.output, 'first-definition');

    const edited = await patch(`/api/v1/workflows/${workflow.id}`, {
      steps: [{ key: 'a', type: 'transform', operation: 'constant', config: { value: 'second-definition' } }],
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.version, 2, 'editing the steps is a new version');

    const stillFirst = await get(`/api/v1/workflow-runs/${original.json.id}`);
    assert.equal(stillFirst.json.output, 'first-definition', 'history must not be rewritten by a later edit');

    const replayed = await post(`/api/v1/workflow-runs/${original.json.id}/replay`, {});
    assert.equal(replayed.json.output, 'first-definition', 'a replay replays the original, not the edit');

    const fresh = await startRun(workflow.id);
    assert.equal(fresh.json.output, 'second-definition', 'a new run uses the current definition');
  });
});

describe('authorisation', () => {
  test('an unauthenticated caller cannot read or define workflows', async () => {
    const savedCookie = cookie;
    const savedCsrf = csrf;
    cookie = null;
    csrf = null;
    try {
      const read = await get('/api/v1/workflows');
      assert.equal(read.status, 401);
      const write = await post('/api/v1/workflows', { name: 'x', steps: [{ key: 'a', type: 'transform' }] });
      assert.equal(write.status, 401);
      const queue = await get('/api/v1/approvals');
      assert.equal(queue.status, 401);
    } finally {
      cookie = savedCookie;
      csrf = savedCsrf;
    }
  });

  test('a mutating call without the CSRF header is refused', async () => {
    const savedCsrf = csrf;
    csrf = null;
    try {
      const refused = await post('/api/v1/workflows', { name: 'no csrf', steps: [{ key: 'a', type: 'transform', operation: 'identity' }] });
      assert.equal(refused.status, 403);
    } finally {
      csrf = savedCsrf;
    }
  });
});

describe('definition validation', () => {
  test('a workflow with no steps is refused', async () => {
    const refused = await post('/api/v1/workflows', { name: 'empty', steps: [] });
    assert.equal(refused.status, 400);
  });

  test('duplicate step keys are refused, because evidence is keyed by them', async () => {
    const refused = await post('/api/v1/workflows', {
      name: 'duplicate keys',
      steps: [
        { key: 'same', type: 'transform', operation: 'identity' },
        { key: 'same', type: 'transform', operation: 'identity' },
      ],
    });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /unique/);
  });

  test('a tool_call without a toolId is refused at definition time', async () => {
    const refused = await post('/api/v1/workflows', { name: 'no tool', steps: [{ key: 'a', type: 'tool_call' }] });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /toolId/);
  });

  test('an archived workflow cannot be run', async () => {
    const workflow = await defineWorkflow({ name: 'archived', steps: [{ key: 'a', type: 'transform', operation: 'identity' }] });
    await patch(`/api/v1/workflows/${workflow.id}`, { archived: true });
    const refused = await post(`/api/v1/workflows/${workflow.id}/runs`, {});
    assert.equal(refused.status, 409);
  });

  test('a step whose effects are non-empty requires approval unless the author says otherwise', async () => {
    const workflow = await defineWorkflow({
      name: 'default gating',
      steps: [
        { key: 'pure', type: 'transform', operation: 'identity' },
        { key: 'effectful', type: 'tool_call', toolId: '00000000-0000-4000-8000-000000000000' },
      ],
    });
    assert.equal(workflow.steps[0].requiresApproval, false, 'a pure step needs no human');
    assert.equal(workflow.steps[1].requiresApproval, true, 'a step with declared effects is gated by default');
  });
});
