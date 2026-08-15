// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The approval queue — WP-2. `MASTER_REFERENCE/01_PRODUCT/11` names the bottom approval
// strip as part of the binding visual direction, and the footer it describes was a static
// status bar.
//
// The queue's whole value is aggregation: before it, an approval waiting inside an agent run
// was visible only inside that run. So the tests that matter are the ones proving items from
// *different* subsystems arrive in one list and that a decision reaches the subsystem that
// owns it — not that a single happy path returns 200.
//
// The queue deliberately holds no copy of any approval. A second source of truth would drift
// from the first, which is the defect already found twice on this project: the WebUI's five
// hardcoded invariants, and security matrix rows describing behaviour the code did not have.
// The test below pins that by mutating a run directly and requiring the queue to follow.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { totpCode } from '../src/auth-crypto.mjs';
import { freshTempDir } from './support/workspace.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = freshTempDir('noesar-approvals-');
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
  cookie = (response.headers.getSetCookie?.() ?? []).find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = JSON.parse(confirmedText).csrfToken;
});

after(async () => {
  watchdog.stop();
  await new Promise((resolve) => server.close(resolve));
});

describe('the queue aggregates across subsystems', () => {
  test('an empty installation has an empty queue and honest counts', async () => {
    const queue = await get('/api/v1/approvals');
    assert.equal(queue.status, 200);
    assert.deepEqual(queue.json.approvals, []);
    assert.equal(queue.json.counts.total, 0);
    assert.deepEqual(queue.json.counts.byKind, {});
  });

  test('a workflow gate and an agent step appear together in one list', async () => {
    // A workflow waiting on a human.
    const workflow = await post('/api/v1/workflows', {
      name: 'gated',
      steps: [{ key: 'gate', type: 'human_approval', title: 'Confirm the plan' }],
    });
    assert.equal(workflow.status, 201, workflow.text.slice(0, 300));
    const workflowRun = await post(`/api/v1/workflows/${workflow.json.id}/runs`, {});
    assert.equal(workflowRun.json.status, 'awaiting_approval');

    // An agent run waiting on a human, raised by a different subsystem entirely.
    const agent = await post('/api/v1/agents', { name: 'Reviewer', instructions: 'Review things' });
    assert.equal(agent.status, 201, agent.text.slice(0, 300));
    const agentRun = await post('/api/v1/agent-runs', {
      agentId: agent.json.id,
      goal: 'Do something that needs approval',
      steps: [{ title: 'Mutate something', mutative: true }],
    });
    assert.equal(agentRun.status, 201, agentRun.text.slice(0, 300));
    assert.equal(agentRun.json.steps[0].status, 'awaiting_approval');

    const queue = await get('/api/v1/approvals');
    const kinds = queue.json.approvals.map((item) => item.kind).sort();
    assert.ok(kinds.includes('workflow-step'), 'the workflow gate must be in the queue');
    assert.ok(kinds.includes('agent-step'), 'the agent step must be in the same queue');
    assert.equal(queue.json.counts.byKind['workflow-step'], 1);
    assert.equal(queue.json.counts.byKind['agent-step'], 1);
    assert.equal(queue.json.counts.total, queue.json.approvals.length);
  });

  test('every item states the permission needed to decide it', async () => {
    const queue = await get('/api/v1/approvals');
    assert.ok(queue.json.approvals.length > 0, 'this test needs the items created above');
    for (const item of queue.json.approvals) {
      assert.ok(item.requiredPermission, `${item.id} must state the permission that decides it`);
      assert.ok(item.summary, `${item.id} must be readable without opening the run`);
      assert.ok(Array.isArray(item.effects), `${item.id} must declare the effects being approved`);
    }
  });

  test('a decision reaches the subsystem that raised it', async () => {
    const queue = await get('/api/v1/approvals');
    const agentItem = queue.json.approvals.find((item) => item.kind === 'agent-step');
    assert.ok(agentItem, 'this test needs the agent step created above');

    const decided = await post(`/api/v1/approvals/${encodeURIComponent(agentItem.id)}/decision`, { decision: 'approve' });
    assert.equal(decided.status, 200, decided.text.slice(0, 300));
    assert.equal(decided.json.kind, 'agent-step');

    // The queue holds no copy, so approving in the agent service must remove it here.
    const after = await get('/api/v1/approvals');
    assert.equal(after.json.approvals.some((item) => item.id === agentItem.id), false,
      'the queue reads the owning subsystem; it must follow that subsystem, not its own record');
  });

  test('rejecting an agent step fails it with the stated reason', async () => {
    const agent = await post('/api/v1/agents', { name: 'Rejector', instructions: 'x' });
    const run = await post('/api/v1/agent-runs', {
      agentId: agent.json.id,
      goal: 'Something to refuse',
      steps: [{ title: 'Mutate', mutative: true }],
    });
    const itemId = `agent-step:${run.json.id}:${run.json.steps[0].id}`;
    const decided = await post(`/api/v1/approvals/${encodeURIComponent(itemId)}/decision`, { decision: 'reject', reason: 'unsafe' });
    assert.equal(decided.status, 200, decided.text.slice(0, 300));
    assert.equal(decided.json.run.steps[0].status, 'failed');
    assert.equal(decided.json.run.steps[0].error, 'unsafe');
  });
});

describe('the queue refuses what it cannot route', () => {
  test('an unparseable approval id is refused with 404, not guessed at', async () => {
    const refused = await post('/api/v1/approvals/not-a-real-id/decision', { decision: 'approve' });
    assert.equal(refused.status, 404);
  });

  test('a known source with a missing target is refused', async () => {
    const refused = await post(
      `/api/v1/approvals/${encodeURIComponent('workflow-step:00000000-0000-4000-8000-000000000000:also-missing')}/decision`,
      { decision: 'approve' });
    assert.equal(refused.status, 404);
  });

  test('a decision other than approve or reject is refused', async () => {
    const refused = await post(
      `/api/v1/approvals/${encodeURIComponent('workflow-step:a:b')}/decision`,
      { decision: 'maybe' });
    assert.equal(refused.status, 400);
  });

  test('deciding requires the CSRF header', async () => {
    const saved = csrf;
    csrf = null;
    try {
      const refused = await post(`/api/v1/approvals/${encodeURIComponent('workflow-step:a:b')}/decision`, { decision: 'approve' });
      assert.equal(refused.status, 403);
    } finally {
      csrf = saved;
    }
  });

  test('reading the queue requires a session', async () => {
    const saved = cookie;
    cookie = null;
    try {
      const refused = await get('/api/v1/approvals');
      assert.equal(refused.status, 401);
    } finally {
      cookie = saved;
    }
  });
});
