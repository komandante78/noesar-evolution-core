// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-005 (03_ARCHITETTURA.md §4): "no adapter may grant itself a permission — a manifest
// is a request, the engine issues the tokens." adapter-capability.test.mjs proves the
// orchestrator in isolation; this proves the same claim through the actual HTTP routes a
// real WebUI session would call, the same way capability-http-adversarial.test.mjs and
// workspace_actions_http_adversarial prove their surfaces.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-adapter-cap-http-'));
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

  const setCookie = response.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = confirmed.csrfToken;

  await authed('/api/v1/runtime/local-model', {
    method: 'PUT',
    payload: { mode: 'manual', profileId: 'cpu', launchCommand: ['/bin/sleep', '30'] },
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('adapter capability HTTP adversarial — local-model-runtime cannot launch without a granted token', () => {
  test('launching with no grant requested at all is refused', async () => {
    const attempt = await authed('/api/v1/runtime/local-model/launch', { method: 'POST', payload: {} });
    assert.equal(attempt.status, 403, `an ungranted launch must be refused: ${attempt.text.slice(0, 200)}`);
    assert.match(attempt.json.reason, /no valid capability token/);
  });

  test('requesting a grant for an operation outside the adapter\'s manifest is refused', async () => {
    const attempt = await authed('/api/v1/adapters/local-model-runtime/grants', {
      method: 'POST', payload: { operation: 'DELETE' },
    });
    assert.equal(attempt.status, 422, `an out-of-manifest ask must be refused: ${attempt.text.slice(0, 200)}`);
    assert.equal(attempt.json.kind, 'OUT_OF_SCOPE');
  });

  test('requesting a grant for an adapter that does not exist is refused with 404', async () => {
    const attempt = await authed('/api/v1/adapters/no-such-adapter/grants', {
      method: 'POST', payload: { operation: 'EXECUTE' },
    });
    assert.equal(attempt.status, 404);
    assert.equal(attempt.json.kind, 'UNKNOWN_ADAPTER');
  });

  test('a session cookie with no CSRF header cannot request a grant', async () => {
    const attempt = await raw('/api/v1/adapters/local-model-runtime/grants', {
      method: 'POST', payload: { operation: 'EXECUTE' }, headers: { cookie },
    });
    assert.equal(attempt.status, 403, 'an ambient cookie alone must not be enough to request a grant');
  });

  test('a requested-but-not-approved grant mints no token an adapter can use', async () => {
    const requested = await authed('/api/v1/adapters/local-model-runtime/grants', {
      method: 'POST', payload: { operation: 'EXECUTE' },
    });
    assert.equal(requested.status, 201);
    // Attempting to launch with the run's own plan (not a token — an adapter has no
    // token until a human approves) must be refused exactly like having nothing at all.
    const attempt = await authed('/api/v1/runtime/local-model/launch', {
      method: 'POST', payload: { capabilityToken: requested.json.plan },
    });
    assert.equal(attempt.status, 403);
  });

  test('negative control · request -> approve -> launch works end to end, and the token cannot be replayed', async () => {
    const requested = await authed('/api/v1/adapters/local-model-runtime/grants', {
      method: 'POST', payload: { operation: 'EXECUTE' },
    });
    assert.equal(requested.status, 201, `grant request must succeed: ${requested.text.slice(0, 200)}`);

    const approved = await authed(`/api/v1/adapters/grants/${requested.json.runId}/approve`, { method: 'POST' });
    assert.equal(approved.status, 200, `grant approval must succeed: ${approved.text.slice(0, 200)}`);
    assert.ok(approved.json.token.id);

    const launched = await authed('/api/v1/runtime/local-model/launch', {
      method: 'POST', payload: { capabilityToken: approved.json.token },
    });
    assert.equal(launched.status, 202, `a properly granted launch must succeed: ${launched.text.slice(0, 200)}`);
    assert.equal(launched.json.launched, true);

    await authed('/api/v1/runtime/local-model/release', { method: 'POST' });

    const replay = await authed('/api/v1/runtime/local-model/launch', {
      method: 'POST', payload: { capabilityToken: approved.json.token },
    });
    assert.equal(replay.status, 403, 'a single-use grant must not authorise a second launch');
  });

  test('GET /api/v1/adapters reports the manifest and states self-grant is not possible', async () => {
    const status = await authed('/api/v1/adapters');
    assert.equal(status.status, 200);
    assert.equal(status.json.adaptersMaySelfGrant, false);
    assert.deepEqual(status.json.manifests['local-model-runtime'].operations, ['EXECUTE']);
  });
});
