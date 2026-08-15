// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0207 — HTTP-level proof that SCIM is actually WIRED, not just its pure functions
// (scim.test.mjs already covers those). Real cookie session mints a real bearer token,
// the bearer token creates a real account through UserDirectory, and the same rigor
// workspace-actions-http-adversarial.test.mjs (D-0193) applied to the first surface that
// spends a capability token is applied here to the first surface phase 7 wires for real:
// no Authorization header, a wrong token, and a revoked token are each tried once.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { totpCode } from '../src/auth-crypto.mjs';
import { freshTempDir } from './support/workspace.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = freshTempDir('noesar-scim-http-');
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
let scimToken = null;
let scimTokenId = null;

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

function scim(path, opts = {}) {
  return raw(path, { ...opts, headers: { authorization: `Bearer ${scimToken}`, ...(opts.headers ?? {}) } });
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

  const minted = await authed('/api/v1/scim/tokens', { method:'POST', payload:{ name:'integration-test' } });
  assert.equal(minted.status, 201, `token mint failed: ${minted.text.slice(0, 200)}`);
  scimToken = minted.json.token;
  scimTokenId = minted.json.tokenId;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('SCIM protocol, end to end against a real server', () => {
  test('ServiceProviderConfig answers with a valid token', async () => {
    const result = await scim('/scim/v2/ServiceProviderConfig');
    assert.equal(result.status, 200);
    assert.equal(result.json.patch.supported, true);
  });

  test('no Authorization header is refused, RFC 7644 error shape', async () => {
    const result = await raw('/scim/v2/Users');
    assert.equal(result.status, 401);
    assert.ok(result.json.schemas.includes('urn:ietf:params:scim:api:messages:2.0:Error'));
  });

  test('a bearer token that does not exist is refused', async () => {
    const result = await raw('/scim/v2/Users', { headers:{ authorization:'Bearer not-a-real-token' } });
    assert.equal(result.status, 401);
  });

  let createdUserId = null;

  test('POST creates a real account through UserDirectory — WIRED, not a framework', async () => {
    const created = await scim('/scim/v2/Users', { method:'POST', payload:{ userName:'scim-provisioned', displayName:'SCIM Provisioned' } });
    assert.equal(created.status, 201);
    assert.equal(created.json.userName, 'scim-provisioned');
    assert.equal(created.json.active, true);
    createdUserId = created.json.id;

    // provable independently of the SCIM layer: the owner's own admin view sees it too
    const viaAdmin = await authed('/api/v1/admin/users');
    assert.ok(viaAdmin.json.users.some((u) => u.id === createdUserId && u.username === 'scim-provisioned'));
  });

  test('GET Users lists the created account', async () => {
    const list = await scim('/scim/v2/Users');
    assert.equal(list.status, 200);
    assert.ok(list.json.Resources.some((r) => r.id === createdUserId));
    assert.equal(list.json.schemas[0], 'urn:ietf:params:scim:api:messages:2.0:ListResponse');
  });

  test('GET Users/{id} returns the one account', async () => {
    const got = await scim(`/scim/v2/Users/${createdUserId}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.userName, 'scim-provisioned');
  });

  test('GET Users/{id} for an unknown id is a SCIM 404, not a crash', async () => {
    const got = await scim('/scim/v2/Users/no-such-id');
    assert.equal(got.status, 404);
    assert.ok(got.json.schemas.includes('urn:ietf:params:scim:api:messages:2.0:Error'));
  });

  test('PATCH active:false disables the real account', async () => {
    const patched = await scim(`/scim/v2/Users/${createdUserId}`, { method:'PATCH', payload:{ Operations:[{ op:'replace', path:'active', value:false }] } });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.active, false);
  });

  test('an unsupported PATCH path is refused (501), not silently accepted', async () => {
    const patched = await scim(`/scim/v2/Users/${createdUserId}`, { method:'PATCH', payload:{ Operations:[{ op:'replace', path:'displayName', value:'Renamed' }] } });
    assert.equal(patched.status, 501);
  });

  test('PATCH active:true reinstates the account', async () => {
    const patched = await scim(`/scim/v2/Users/${createdUserId}`, { method:'PATCH', payload:{ Operations:[{ op:'replace', path:'active', value:true }] } });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.active, true);
  });

  test('DELETE deprovisions — the account still exists, revoked, not erased', async () => {
    const deleted = await scim(`/scim/v2/Users/${createdUserId}`, { method:'DELETE' });
    assert.equal(deleted.status, 200);
    const after2 = await scim(`/scim/v2/Users/${createdUserId}`);
    assert.equal(after2.status, 200);
    assert.equal(after2.json.active, false);
  });

  test('a SCIM route requires no CSRF header — a valid bearer token alone is enough by design', async () => {
    const result = await raw('/scim/v2/ServiceProviderConfig', { headers:{ authorization:`Bearer ${scimToken}` } });
    assert.equal(result.status, 200);
  });

  test('revoking the SCIM token immediately invalidates it', async () => {
    const revoked = await authed(`/api/v1/scim/tokens/${scimTokenId}/revoke`, { method:'POST' });
    assert.equal(revoked.status, 200);
    const result = await raw('/scim/v2/Users', { headers:{ authorization:`Bearer ${scimToken}` } });
    assert.equal(result.status, 401);
  });
});
