// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0272. Before this route existed, `UpdateManager#installChannelKey()` was reachable
// only from a unit test constructing the class directly (update-manager.test.mjs) — no
// HTTP route called it, on any of the eight `/api/v1/updates/*` endpoints server.mjs
// registered. That made deferred_items[2]'s claim literally true by construction: no
// operator, online or offline, could ever pin a channel's public key on a running
// installation, so `check()`/`verifyMetadata()`/`verifyBundle()` failed `NO_CHANNEL_KEY`
// unconditionally — a signed bundle could exist and still never be verifiable.
//
// This suite proves the new route end to end: CSRF is required (same as every other
// mutating update route), strong reauthentication is required (same as `apply`, because
// pinning the key that makes update packages trusted carries the same weight as applying
// one), a private key is refused exactly as the class already refuses it, and — the
// negative control — a legitimate channel key, produced by the new
// tools/sign-update-artifact.mjs, is installed and then reflected in
// GET /api/v1/updates/status.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-upd-key-http-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server } = await import('../src/server.mjs');
const TOOL = new URL('../../../tools/sign-update-artifact.mjs', import.meta.url).pathname;

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;
let totpSecret = null;

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

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  return { status: response.status, json: await response.json() };
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const begun = await post('/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': SETUP_TOKEN });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);
  totpSecret = begun.json.totpSecret;

  const confirmed = await post('/api/v1/auth/setup/confirm', {
    challenge: begun.json.challenge,
    totpCode: totpCode(totpSecret, stepStart(-1)),
  });
  assert.equal(confirmed.status, 201, `setup confirm failed: ${confirmed.text.slice(0, 200)}`);
  const setCookie = confirmed.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = confirmed.json.csrfToken;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/v1/updates/channel-key — the missing pin for a verifier nothing could ever satisfy', () => {
  test('csrf_required · an ambient session cookie alone cannot pin a key', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const attempt = await post('/api/v1/updates/channel-key',
      { channel: 'offline', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      { cookie, 'x-noesar-csrf': '' });
    assert.equal(attempt.status, 403, `an ambient cookie with no CSRF header must not be enough: ${attempt.text.slice(0, 160)}`);
  });

  test('reauth_required · a valid CSRF-protected session, not yet elevated, is still refused', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const attempt = await post('/api/v1/updates/channel-key', {
      channel: 'offline', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    assert.equal(attempt.status, 403, `pinning a channel key must require the same recent strong reauthentication as apply: ${attempt.text.slice(0, 200)}`);
    assert.match(attempt.text, /strong reauthentication/i);
  });

  test('private_key_refused · installing a private key where a public key belongs fails exactly as the class refuses it', async () => {
    const elevated = await post('/api/v1/auth/reauth', { password: PASSWORD, totpCode: totpCode(totpSecret, stepStart(0)) });
    assert.equal(elevated.status, 200, `reauth failed: ${elevated.text.slice(0, 200)}`);
    assert.ok(elevated.json.elevatedUntil > Date.now());

    const { privateKey } = generateKeyPairSync('ed25519');
    const attempt = await post('/api/v1/updates/channel-key', {
      channel: 'offline', publicKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    assert.equal(attempt.status, 400, `a private key must be refused, not installed: ${attempt.text.slice(0, 200)}`);
    assert.match(attempt.text, /private key must never be installed/i);
  });

  test('negative control · a real keypair from tools/sign-update-artifact.mjs is pinned and shows up in status', async () => {
    const keysDir = mkdtempSync(join(tmpdir(), 'noesar-upd-key-out-'));
    const keygen = execFileSync('node', [TOOL, 'keygen', '--channel', 'offline', '--out-dir', keysDir], { encoding: 'utf8' });
    assert.match(keygen, /KEYGEN channel=offline fingerprint=[0-9a-f]{64}/);
    const publicKeyPem = readFileSync(join(keysDir, 'offline.pub.pem'), 'utf8');

    const elevated = await post('/api/v1/auth/reauth', { password: PASSWORD, totpCode: totpCode(totpSecret, stepStart(1)) });
    assert.equal(elevated.status, 200, `reauth failed: ${elevated.text.slice(0, 200)}`);

    const pinned = await post('/api/v1/updates/channel-key', { channel: 'offline', publicKeyPem });
    assert.equal(pinned.status, 200, `pinning a legitimate key must succeed: ${pinned.text.slice(0, 200)}`);
    assert.deepEqual(pinned.json, { channel: 'offline', installed: true });

    const status = await get('/api/v1/updates/status');
    assert.equal(status.status, 200);
    assert.ok(status.json.pinnedChannelKeys.includes('offline'), `status must reflect the pinned key: ${JSON.stringify(status.json.pinnedChannelKeys)}`);
  });
});
