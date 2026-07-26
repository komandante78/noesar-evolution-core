// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SEC-003 — "Owner bypass cannot disable invariants" (acceptance-matrix.yaml, severity
// blocker). Until this file existed, nothing anywhere exercised the claim.
//
// The claim itself lives in `createPathPlan`, which returns a `nonBypassableInvariants`
// list alongside a `blocked` verdict and a computed `canonicalPath`. `/api/v1/coden/
// path-plan` computes that plan server-side and refuses a blocked path with 403.
//
// `/api/v1/coden/authorize` then took `request.plan` **straight from the request body**
// and never recomputed it. Every field the plan carries — `blocked`, `canonicalPath`,
// `mode`, `nonBypassableInvariants` — was therefore an assertion made by the caller
// about itself. A caller who never invoked `path-plan` at all could hand-write a plan
// that declared a protected path unblocked and receive a stored approval for it.
//
// This is the same failure the projection verifier work names precisely: a verdict must
// be recomputed from the original operands, never read back off the answer's own path.
// The plan is the answer; the path, operation and mode are the operands.
//
// Reach matters here. `coden.authorize` is held by `developer` and `admin` as well as
// `owner`, while `coden.owner-bypass` is owner-only — so trusting a client-supplied
// `mode` also let a non-owner mint an approval carrying whatever mode it chose.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-coden-authz-'));
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

async function post(path, payload, extraHeaders = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-noesar-csrf': csrf } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, json, text, headers: response.headers };
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const begun = await post('/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': SETUP_TOKEN });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);

  // Confirm with the previous step's code, leaving steps 0 and +1 unspent — the replay
  // guard demands strictly increasing steps, so a test that burns 'now' here breaks
  // every later code it might need.
  const confirmed = await post('/api/v1/auth/setup/confirm', {
    challenge: begun.json.challenge,
    totpCode: totpCode(begun.json.totpSecret, stepStart(-1)),
  });
  assert.equal(confirmed.status, 201, `setup confirm failed: ${confirmed.text.slice(0, 200)}`);

  const setCookie = confirmed.headers.getSetCookie?.() ?? [];
  const session = setCookie.find((entry) => entry.startsWith('noesar_session='));
  assert.ok(session, 'the bootstrap must issue a session cookie');
  cookie = session.split(';')[0];
  csrf = confirmed.json.csrfToken;
  assert.ok(csrf, 'the bootstrap must issue a CSRF token');
});

after(async () => {
  watchdog.stop();
  await new Promise((resolve) => server.close(resolve));
});

describe('SEC-003 · the authorization endpoint recomputes the plan it is given', () => {
  test('the planner itself refuses a protected root', async () => {
    const planned = await post('/api/v1/coden/path-plan',
      { mode: 'NORMAL', operation: 'write', path: '/etc/noesar-sec003-probe' });
    assert.equal(planned.status, 403, 'a protected root must not plan cleanly');
    assert.equal(planned.json.blocked, true);
    assert.equal(planned.json.risk, 'CRITICAL');
  });

  test('a hand-written plan cannot declare a protected root unblocked', async () => {
    // This plan never came from the server. Every field is the caller's claim.
    const forged = {
      mode: 'NORMAL',
      requestedPath: '/etc/noesar-sec003-probe',
      canonicalPath: '/etc/noesar-sec003-probe',
      workspaceRoot: workspace,
      insideWorkspace: true,
      operation: 'write',
      recursive: false,
      commands: [],
      dependencies: [],
      networkRequested: false,
      secretsRequested: false,
      symlinkFindings: [],
      protectedMatch: null,
      risk: 'LOW',
      blocked: false,
      requiresStrongReauthentication: false,
      consentOptions: ['ONE_OPERATION'],
      nonBypassableInvariants: [],
    };
    const authorized = await post('/api/v1/coden/authorize',
      { plan: forged, consentScope: 'ONE_OPERATION' });
    assert.equal(authorized.status, 403,
      'the server must recompute the verdict instead of believing the caller');
    assert.equal(authorized.json?.id, undefined, 'no approval may be stored');
  });

  test('the invariant list on a stored approval is the server\'s, not the caller\'s', async () => {
    const planned = await post('/api/v1/coden/path-plan',
      { mode: 'NORMAL', operation: 'write', path: `${workspace}/notes.txt` });
    assert.equal(planned.status, 200, `an in-workspace write must plan: ${planned.text.slice(0, 160)}`);
    assert.ok(planned.json.nonBypassableInvariants.length > 0);

    // Same legitimate request, with the invariants stripped out on the way through.
    const stripped = { ...planned.json, nonBypassableInvariants: [] };
    const authorized = await post('/api/v1/coden/authorize',
      { plan: stripped, consentScope: 'ONE_OPERATION' });
    assert.equal(authorized.status, 201, `a legitimate authorization must still succeed: ${authorized.text.slice(0, 160)}`);
    assert.deepEqual(
      authorized.json.nonBypassableInvariants,
      planned.json.nonBypassableInvariants,
      'a caller must not be able to empty the list the approval records as non-bypassable',
    );
  });

  test('the canonical path on a stored approval is the server\'s, not the caller\'s', async () => {
    const planned = await post('/api/v1/coden/path-plan',
      { mode: 'NORMAL', operation: 'write', path: `${workspace}/report.txt` });
    assert.equal(planned.status, 200);

    // The plan is legitimate; only the destination is rewritten in flight.
    const redirected = { ...planned.json, canonicalPath: '/etc/passwd' };
    const authorized = await post('/api/v1/coden/authorize',
      { plan: redirected, consentScope: 'ONE_OPERATION' });
    assert.equal(authorized.status, 201, `expected the recomputed request to authorize: ${authorized.text.slice(0, 160)}`);
    assert.notEqual(authorized.json.canonicalPath, '/etc/passwd',
      'the approval must not record a destination the server never planned');
    assert.equal(authorized.json.canonicalPath, planned.json.canonicalPath);
  });

  test('a non-owner cannot reach Owner Bypass by declaring the mode itself', async () => {
    // The owner session used here holds coden.owner-bypass but has not re-authenticated,
    // so the elevation gate is the one under test. A developer session would be refused
    // one step earlier, on the permission.
    const planned = await post('/api/v1/coden/path-plan',
      { mode: 'NORMAL', operation: 'write', path: `${workspace}/bypass.txt` });
    assert.equal(planned.status, 200);

    const escalated = { ...planned.json, mode: 'OWNER_BYPASS' };
    const authorized = await post('/api/v1/coden/authorize',
      { plan: escalated, consentScope: 'ONE_OPERATION' });
    assert.equal(authorized.status, 403,
      'Owner Bypass without recent strong reauthentication must be refused');
    assert.match(authorized.json.error, /reauthentication/i);
  });

  // Negative control. A closure that also breaks the working path is not a closure.
  test('the ordinary in-workspace path still authorizes end to end', async () => {
    const planned = await post('/api/v1/coden/path-plan',
      { mode: 'NORMAL', operation: 'write', path: `${workspace}/ordinary.txt` });
    assert.equal(planned.status, 200);
    assert.equal(planned.json.blocked, false);

    const authorized = await post('/api/v1/coden/authorize',
      { plan: planned.json, consentScope: 'ONE_OPERATION', durationMinutes: 5 });
    assert.equal(authorized.status, 201, `the legitimate flow must not regress: ${authorized.text.slice(0, 160)}`);
    assert.ok(authorized.json.id, 'an approval must be issued');
    assert.equal(authorized.json.mode, 'NORMAL');
    assert.equal(authorized.json.operation, 'write');
    assert.equal(authorized.json.consentScope, 'ONE_OPERATION');
  });
});
