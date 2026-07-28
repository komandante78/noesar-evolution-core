// SPDX-License-Identifier: AGPL-3.0-or-later
//
// F4-017, closed. `D-0193` found that `workspace-actions.mjs`'s HTTP routes were missing
// `requireCsrf()` and fixed it. The same read of server.mjs found the identical gap one block
// down: `/api/v1/capability/mint` and `/api/v1/capability/spend` — the routes that mint and
// spend the token workspace-actions.mjs itself relies on — called `requireSession()` and
// checked `workspace.write`, but never `requireCsrf()`, unlike every other mutating route.
// That phase named it and moved on rather than widen its declared file scope; this is the
// phase that closes it, with the same proof discipline: seen failing red, then green.
//
// A real, server-computed `plan` is obtained through `/api/v1/workspace-actions/plan` rather
// than hand-built, so the mint attempt below is attacking the actual route with a plan the
// server itself would accept — not a strawman shape a real mint call would reject anyway.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-cap-http-adv-'));
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
function authed(path, opts = {}) {
  return raw(path, { ...opts, headers: { cookie, 'x-noesar-csrf': csrf, ...(opts.headers ?? {}) } });
}

/** A real, server-built plan with one WRITE step over `path`, via the route that builds one. */
async function realPlan(path) {
  const planned = await authed('/api/v1/workspace-actions/plan', {
    method: 'POST', payload: { request: 'fixture', files: [{ path, contents: 'x' }] },
  });
  assert.equal(planned.status, 201, `fixture plan must succeed: ${planned.text.slice(0, 160)}`);
  return planned.json.plan;
}
function mintRequest(nowUnix, { plan, approval }) {
  const step = plan.steps[0];
  return { plan, approval, request: { stepId: step.id, paths: step.files, operations: ['WRITE'], uses: step.files.length, expiresAtUnix: approval.expiresAtUnix } };
}
function approvalFor(nowUnix) {
  return { approverId: ownerId, grantedAtUnix: nowUnix, expiresAtUnix: nowUnix + 900 };
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

describe('capability HTTP adversarial — mint and spend require more than an ambient session', () => {
  test('csrf_required · a valid session cookie with no CSRF header cannot mint', async () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    const plan = await realPlan('cap-csrf-mint.txt');
    const body = mintRequest(nowUnix, { plan, approval: approvalFor(nowUnix) });

    const attempt = await raw('/api/v1/capability/mint', { method: 'POST', payload: body, headers: { cookie } });
    assert.equal(attempt.status, 403, `an ambient cookie alone must not be enough to mint: ${attempt.text.slice(0, 160)}`);
  });

  test('csrf_required · a wrong CSRF header value is refused exactly like a missing one, for mint', async () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    const plan = await realPlan('cap-csrf-mint-wrong.txt');
    const body = mintRequest(nowUnix, { plan, approval: approvalFor(nowUnix) });

    const attempt = await raw('/api/v1/capability/mint', {
      method: 'POST', payload: body, headers: { cookie, 'x-noesar-csrf': 'not-the-real-token' },
    });
    assert.equal(attempt.status, 403, 'a guessed or stale CSRF value must be refused, not merely an absent one');
  });

  test('csrf_required · a valid session cookie with no CSRF header cannot spend a real token', async () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    const plan = await realPlan('cap-csrf-spend.txt');
    const minted = await authed('/api/v1/capability/mint', { method: 'POST', payload: mintRequest(nowUnix, { plan, approval: approvalFor(nowUnix) }) });
    assert.equal(minted.status, 201, `legitimate mint must succeed: ${minted.text.slice(0, 160)}`);

    const spendBody = { token: minted.json.token, attempt: { path: plan.steps[0].files[0], operation: 'WRITE' } };
    const forged = await raw('/api/v1/capability/spend', { method: 'POST', payload: spendBody, headers: { cookie } });
    assert.equal(forged.status, 403, `an ambient cookie alone must not be enough to spend: ${forged.text.slice(0, 160)}`);

    // The token must still be genuinely unspent afterwards — a forged attempt must not
    // consume a use even while being refused.
    const real = await authed('/api/v1/capability/spend', { method: 'POST', payload: spendBody });
    assert.equal(real.status, 200, `the legitimate spend must still work after the forged attempt: ${real.text.slice(0, 160)}`);
    assert.equal(real.json.spent, true);
  });

  // Negative control. A suite that also breaks the working path proves nothing.
  test('negative control · a legitimate mint and spend still work end to end with the CSRF header present', async () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    const plan = await realPlan('cap-legit.txt');
    const minted = await authed('/api/v1/capability/mint', { method: 'POST', payload: mintRequest(nowUnix, { plan, approval: approvalFor(nowUnix) }) });
    assert.equal(minted.status, 201, `legitimate mint must succeed: ${minted.text.slice(0, 160)}`);
    assert.ok(minted.json.token.id);

    const spent = await authed('/api/v1/capability/spend', {
      method: 'POST', payload: { token: minted.json.token, attempt: { path: plan.steps[0].files[0], operation: 'WRITE' } },
    });
    assert.equal(spent.status, 200, `legitimate spend must succeed: ${spent.text.slice(0, 160)}`);
    assert.equal(spent.json.spent, true);
  });
});
