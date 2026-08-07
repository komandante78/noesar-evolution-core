// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0193 — the Owner asked for the adversarial rigor of `coden-invariant-adversarial.test.mjs`
// applied to `workspace-actions.mjs`: one dedicated attempt per invariant this surface relies
// on, from a genuinely authenticated HTTP session, plus meta-tests that the server does not
// advertise more than it enforces, plus a negative control. `workspace-actions.test.mjs`
// already attacks the orchestrator's own authority (files-required, path-escape, double-decide,
// unknown run, restore-once, cross-run isolation) by calling its methods directly. What that
// file cannot see is the HTTP boundary in front of it — server.mjs, not workspace-actions.mjs,
// is where a session becomes a request, and that is exactly where this suite found a real gap.
//
// THE FINDING THIS SUITE EXISTS TO PROVE, THEN CLOSE. Every other mutating route in server.mjs
// calls `requireCsrf()` after `requireSession()` — the capability/mint+spend routes are the one
// other exception (named, not fixed, in docs/DECISION_LOG.md D-0193: out of this phase's
// declared file scope). The workspace-actions `plan`/`approve`/`reject`/`restore` routes — the
// surface that spends a capability token and writes a real file — did not call it at all. The
// session cookie is `SameSite=Strict`, which already blocks a classic cross-site POST, so this
// is a second layer the rest of the codebase treats as mandatory and this newest, most
// consequential surface silently skipped. The 'csrf required' tests below were run RED against
// the unfixed route (an authenticated cookie with no CSRF header was enough to plan and
// approve) before `requireCsrf()` was added; they are the regression proof that it stays fixed.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-wa-http-adv-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;
let ownerId = null;

async function raw(path, { method = 'GET', payload, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, json, text };
}

/** A fully legitimate call: real cookie, real CSRF header. The baseline every attack deviates from. */
function authed(path, opts = {}) {
  return raw(path, { ...opts, headers: { cookie, 'x-noesar-csrf': csrf, ...(opts.headers ?? {}) } });
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const begun = await raw('/api/v1/auth/setup', {
    method: 'POST',
    payload: { username: 'owner', displayName: 'Owner', password: PASSWORD },
    headers: { 'x-noesar-setup-token': SETUP_TOKEN },
  });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);

  const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: begun.json.challenge, totpCode: totpCode(begun.json.totpSecret, stepStart()) }),
  });
  assert.equal(response.status, 201, 'setup confirm failed');
  const confirmed = await response.json();
  ownerId = confirmed.user.id;

  const setCookie = response.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = confirmed.csrfToken;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('workspace-actions HTTP adversarial — one attempt per invariant this surface relies on', () => {
  // ---------------------------------------------------------------- invariant 1
  test('session_required · every mutating route and the run-detail route refuse an anonymous caller', async () => {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST', payload: { request: 'seed', files: [{ path: 'session-seed.txt', contents: 'x' }] },
    });
    assert.equal(planned.status, 201, `seed plan must succeed: ${planned.text.slice(0, 160)}`);
    const runId = planned.json.runId;

    for (const attempt of [
      () => raw('/api/v1/workspace-actions/plan', { method: 'POST', payload: { request: 'x', files: [{ path: 'a.txt', contents: 'x' }] } }),
      () => raw(`/api/v1/workspace-actions/${runId}`),
      () => raw(`/api/v1/workspace-actions/${runId}/approve`, { method: 'POST' }),
      () => raw(`/api/v1/workspace-actions/${runId}/reject`, { method: 'POST' }),
      () => raw(`/api/v1/workspace-actions/${runId}/restore`, { method: 'POST' }),
    ]) {
      const result = await attempt();
      assert.equal(result.status, 401, `an anonymous caller must be refused: ${result.text.slice(0, 160)}`);
    }
  });

  // ---------------------------------------------------------------- invariant 2 (the finding)
  test('csrf_required · a valid session cookie with no CSRF header cannot plan', async () => {
    const attempt = await raw('/api/v1/workspace-actions/plan', {
      method: 'POST', payload: { request: 'csrf-probe', files: [{ path: 'csrf-plan.txt', contents: 'attacker' }] },
      headers: { cookie },
    });
    assert.equal(attempt.status, 403, `an ambient cookie alone must not be enough to plan: ${attempt.text.slice(0, 160)}`);
    assert.equal(existsSync(join(workspace, 'csrf-plan.txt')), false);
  });

  test('csrf_required · a valid session cookie with no CSRF header cannot approve a real, pending run', async () => {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST', payload: { request: 'legit plan for a forged approve', files: [{ path: 'csrf-approve.txt', contents: 'x' }] },
    });
    assert.equal(planned.status, 201);

    const forged = await raw(`/api/v1/workspace-actions/${planned.json.runId}/approve`, {
      method: 'POST', headers: { cookie },
    });
    assert.equal(forged.status, 403, `approval must require the CSRF header even for a legitimately planned run: ${forged.text.slice(0, 160)}`);
    assert.equal(existsSync(join(workspace, 'csrf-approve.txt')), false, 'nothing may be written by a forged approval');

    // The plan must still be approvable normally afterwards — a forged attempt must not
    // consume or corrupt the pending run.
    const real = await authed(`/api/v1/workspace-actions/${planned.json.runId}/approve`, { method: 'POST' });
    assert.equal(real.status, 200, `the legitimate approval must still work after the forged attempt: ${real.text.slice(0, 160)}`);
    assert.equal(real.json.promoted, true);
  });

  test('csrf_required · a wrong CSRF header value is refused exactly like a missing one', async () => {
    const attempt = await raw('/api/v1/workspace-actions/plan', {
      method: 'POST', payload: { request: 'wrong token', files: [{ path: 'csrf-wrong.txt', contents: 'x' }] },
      headers: { cookie, 'x-noesar-csrf': 'not-the-real-token' },
    });
    assert.equal(attempt.status, 403, 'a guessed or stale CSRF value must be refused, not merely an absent one');
  });

  // ---------------------------------------------------------------- invariant 3
  test('identity_not_client_supplied · the plan actor and the approver are the session\'s identity, never a body field', async () => {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST',
      payload: { request: 'spoof actor', files: [{ path: 'identity.txt', contents: 'x' }], actor: 'someone-else' },
    });
    assert.equal(planned.status, 201);

    const approved = await authed(`/api/v1/workspace-actions/${planned.json.runId}/approve`, {
      method: 'POST', payload: { approverId: 'someone-else-entirely' },
    });
    assert.equal(approved.status, 200);

    const detail = await authed(`/api/v1/workspace-actions/${planned.json.runId}`);
    assert.equal(detail.json.actor, ownerId, 'a client-supplied `actor` in the plan body must be ignored');
  });

  // ---------------------------------------------------------------- invariant 4
  test('write_only_by_construction · fields that name a destructive operation do not reach the built plan', async () => {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST',
      payload: {
        request: 'try to smuggle a destructive step', files: [{ path: 'noise.txt', contents: 'x' }],
        operation: 'delete', recursive: true, destructive: true, commands: ['rm -rf /'],
      },
    });
    assert.equal(planned.status, 201);
    assert.equal(planned.json.plan.steps[0].blastRadius.destructive, false,
      'no request-body field reaches blastRadius.destructive; the WRITE-only boundary is structural, not a filter');
    assert.deepEqual(planned.json.plan.steps[0].commands, []);
  });

  // ---------------------------------------------------------------- invariant 5
  test('run_scope_is_server_computed · approve ignores an attempt to widen the token past the planned files', async () => {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST', payload: { request: 'narrow plan', files: [{ path: 'narrow.txt', contents: 'x' }] },
    });
    assert.equal(planned.status, 201);

    // approve() takes no file list from the request at all; this proves the body is ignored
    // rather than merely unused today, so a future refactor that starts reading it would break
    // this test before it could ship.
    const approved = await authed(`/api/v1/workspace-actions/${planned.json.runId}/approve`, {
      method: 'POST', payload: { files: [{ path: '../../../etc/passwd', contents: 'pwned' }] },
    });
    assert.equal(approved.status, 200);
    assert.equal(existsSync(join(workspace, 'narrow.txt')), true);
    assert.equal(existsSync('/etc/passwd-noesar-http-test'), false);
    assert.deepEqual(approved.json.diff.map((entry) => entry.path), ['narrow.txt']);
  });

  // -------------------------------------------------------------- meta / honesty
  test('the wire status matches the module\'s own declared boundary, not a stronger claim', async () => {
    const status = await authed('/api/v1/workspace-actions');
    assert.equal(status.status, 200);
    assert.deepEqual(status.json.operationsSupported, ['WRITE']);
    assert.ok(status.json.operationsNotSupported.includes('DELETE'));
    assert.ok(status.json.operationsNotSupported.includes('EXECUTE'));
    assert.equal(status.json.testExecution, false);
    assert.equal(status.json.runsPersistAcrossRestart, false);
  });

  // Negative control. A suite that also breaks the working path proves nothing.
  test('negative control · a legitimate plan, approve and promote still works end to end over real HTTP', async () => {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST', payload: { request: 'legitimate end to end', files: [{ path: 'legitimate-http.txt', contents: 'real content\n' }] },
    });
    assert.equal(planned.status, 201);
    assert.equal(planned.json.risk.overall, 'LOW');

    const approved = await authed(`/api/v1/workspace-actions/${planned.json.runId}/approve`, { method: 'POST' });
    assert.equal(approved.status, 200, `legitimate approval must still work: ${approved.text.slice(0, 160)}`);
    assert.equal(approved.json.promoted, true);
    assert.equal(existsSync(join(workspace, 'legitimate-http.txt')), true);
    assert.equal(readFileSync(join(workspace, 'legitimate-http.txt'), 'utf8'), 'real content\n');
  });

  // ------------------------------------------------------------ the Logs panel's endpoint
  test('GET /api/v1/events/:correlationId · requires a session, and returns this run\'s own causal trail', async () => {
    const anonymous = await raw('/api/v1/events/anything');
    assert.equal(anonymous.status, 401, 'the per-run event trail must not be readable by an anonymous caller');

    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST', payload: { request: 'events trail probe', files: [{ path: 'events-trail.txt', contents: 'x' }] },
    });
    assert.equal(planned.status, 201);
    const approved = await authed(`/api/v1/workspace-actions/${planned.json.runId}/approve`, { method: 'POST' });
    assert.equal(approved.status, 200);

    const trail = await authed(`/api/v1/events/${planned.json.runId}`);
    assert.equal(trail.status, 200);
    assert.equal(trail.json.correlationId, planned.json.runId);
    const actions = trail.json.events.map((event) => event.action);
    assert.deepEqual(actions, [
      'workspace_action.planned', 'workspace_action.approved', 'capability.minted',
      'executor.ran', 'shadow.compared', 'workspace_action.claims_verified', 'workspace_action.promoted',
    ], `the trail must be this run's own events, in causal order: ${JSON.stringify(actions)}`);

    // An id that never correlated to anything returns an empty trail, not 404: the ledger
    // cannot tell "no such run" from "this run recorded nothing yet", and a 404 here would
    // claim a distinction the route does not actually have.
    const unknown = await authed('/api/v1/events/no-such-run-id');
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.json.events, []);
  });
});

// --- point 4b · the chat owns the run, across the HTTP boundary ------------------------------
// The orchestrator holds a conversation id opaquely (workspace-actions.mjs says so in as many
// words); whether that conversation EXISTS is authority this boundary holds. These are the
// attempts on it.
describe('point 4b · attaching a run to a chat', () => {
  async function newConversation(title) {
    const project = await authed('/api/v1/projects', { method: 'POST', payload: { name: `p-${title}` } });
    assert.equal(project.status, 201, `project failed: ${project.text.slice(0, 200)}`);
    const created = await authed('/api/v1/conversations', {
      method: 'POST', payload: { projectId: project.json.id, title },
    });
    assert.equal(created.status, 201, `conversation failed: ${created.text.slice(0, 200)}`);
    return created.json.conversation.id;
  }

  test('the runs route is not eaten by the `/:id` matcher above it', async () => {
    // `/api/v1/workspace-actions/([^/]+)` would read the word `runs` as a run id and answer
    // 404 for a route that exists. Ordering is the whole fix, so it gets its own attempt.
    const listing = await authed('/api/v1/workspace-actions/runs');
    assert.equal(listing.status, 200);
    assert.ok(Array.isArray(listing.json.runs));
    // Flipped deliberately in D-0338, not worked around: this asserted `false`, and was honest
    // when it was written. The ASSEMBLED server now wires a run store, so `false` here would
    // mean that wiring had been lost — which is what makes the line worth keeping.
    assert.equal(listing.json.persistence.durable, true);
    assert.equal(listing.json.persistence.rebuiltFromDisk, true);
    assert.deepEqual(listing.json.persistence.damaged, [], 'the server started with unreadable run files');
  });

  test('a plan naming a real conversation is attached, and shows up in that chat only', async () => {
    const mine = await newConversation('mine');
    const other = await newConversation('other');
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST',
      payload: { request: 'attached work', files: [{ path: 'attached.txt', contents: 'x' }], conversationId: mine },
    });
    assert.equal(planned.status, 201, `plan failed: ${planned.text.slice(0, 200)}`);
    assert.equal(planned.json.conversationId, mine);

    const here = await authed(`/api/v1/workspace-actions/runs?conversationId=${encodeURIComponent(mine)}`);
    assert.ok(here.json.runs.some((run) => run.runId === planned.json.runId));
    const elsewhere = await authed(`/api/v1/workspace-actions/runs?conversationId=${encodeURIComponent(other)}`);
    assert.ok(!elsewhere.json.runs.some((run) => run.runId === planned.json.runId));
  });

  test('a plan naming a conversation that does not exist is REFUSED, not filed anyway', async () => {
    // Fail-closed. The alternative — storing the id and letting the panel render empty — is a
    // link that resolves to nothing, which looks exactly like a chat with no work.
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST',
      payload: { request: 'ghost work', files: [{ path: 'ghost.txt', contents: 'x' }], conversationId: 'conv-does-not-exist' },
    });
    assert.equal(planned.status, 422);
    assert.equal(planned.json.kind, 'UNKNOWN_CONVERSATION');

    // And nothing was created under that name.
    const listing = await authed('/api/v1/workspace-actions/runs?conversationId=conv-does-not-exist');
    assert.deepEqual(listing.json.runs, []);
  });

  test('a plan with no conversation is unattached, and stays out of every chat list', async () => {
    const chat = await newConversation('untouched');
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST',
      payload: { request: 'unattached work', files: [{ path: 'unattached.txt', contents: 'x' }] },
    });
    assert.equal(planned.status, 201);
    assert.equal(planned.json.conversationId, null);

    const unattached = await authed('/api/v1/workspace-actions/runs?scope=unattached');
    assert.ok(unattached.json.runs.some((run) => run.runId === planned.json.runId));
    const inChat = await authed(`/api/v1/workspace-actions/runs?conversationId=${encodeURIComponent(chat)}`);
    assert.ok(!inChat.json.runs.some((run) => run.runId === planned.json.runId));
  });

  test('a malformed conversationId is refused at the boundary, before the orchestrator', async () => {
    for (const bad of ['', '   ', 42, { id: 'x' }]) {
      const planned = await authed('/api/v1/workspace-actions/plan', {
        method: 'POST',
        payload: { request: 'bad link', files: [{ path: 'bad.txt', contents: 'x' }], conversationId: bad },
      });
      assert.equal(planned.status, 422, `\`${JSON.stringify(bad)}\` should not plan`);
      assert.ok(['INVALID_CONVERSATION', 'UNKNOWN_CONVERSATION'].includes(planned.json.kind));
    }
  });
});
