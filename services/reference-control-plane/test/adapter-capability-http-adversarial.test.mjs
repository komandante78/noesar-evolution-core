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
import { generateKeyPairSync } from 'node:crypto';
import { totpCode } from '../src/auth-crypto.mjs';
import { signSectorModuleManifest } from '../src/sector-modules.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-adapter-cap-http-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';
// D-0274: without this, server.mjs defaults sectorModulesRoot to `<repo>/.sector-modules`
// -- the canonical tree, not a fixture. The sector-modules describe() block below installs
// and activates a real module through this server; pinning the env var here is what keeps
// that write inside a throwaway directory instead of leaking into the repository itself
// (found by running this file: a first version without this line left
// `.sector-modules/http.lifecycle.one/` — active -- sitting in the real repo afterward).
process.env.NOESAR_SECTOR_MODULES = mkdtempSync(join(tmpdir(), 'noesar-adapter-cap-http-sector-modules-'));

const { server } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;
let totpSecret = null;

async function elevate(offset = 0) {
  const elevated = await authed('/api/v1/auth/reauth', {
    method: 'POST', payload: { password: PASSWORD, totpCode: totpCode(totpSecret, stepStart(offset)) },
  });
  assert.equal(elevated.status, 200, `reauth must succeed: ${elevated.text.slice(0, 200)}`);
  return elevated;
}

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

/** ARCH-005: the same request()->approve() flow a real operator session would drive,
 * against the `sector-modules` adapter's single WRITE gate (D-0274). Module-scoped so
 * both the sector-modules describe() block and the publisher-registry one below can
 * install/activate real modules over real HTTP. */
async function grantSectorModulesWrite() {
  const requested = await authed('/api/v1/adapters/sector-modules/grants', { method: 'POST', payload: { operation: 'WRITE' } });
  assert.equal(requested.status, 201, `grant request must succeed: ${requested.text.slice(0, 200)}`);
  const approved = await authed(`/api/v1/adapters/grants/${requested.json.runId}/approve`, { method: 'POST' });
  assert.equal(approved.status, 200, `grant approval must succeed: ${approved.text.slice(0, 200)}`);
  return approved.json.token;
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
  totpSecret = begun.json.totpSecret;

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

// D-0274: sector-modules gained the same shape of gate (request -> approve -> spend), but
// through its own three dedicated routes rather than a generic adapter method, and its
// mutating routes are owner-only (the same convention as /api/v1/updates/*).
describe('adapter capability HTTP adversarial — sector-modules install/activate/deactivate cannot self-authorize', () => {
  const lowRiskManifest = (id) => ({
    id, version: '0.1.0', publisher: 'customer.private', trust_level: 'customer-private',
    sector: ['scientific-research'], intended_use: ['internal research workflow support'],
    excluded_use: ['clinical diagnosis'], permissions: ['filesystem.read.project'], evidence: [],
  });

  test('install with no grant at all is refused, not a 500', async () => {
    const attempt = await authed('/api/v1/sector-modules/install', {
      method: 'POST', payload: { id: 'http.no-grant', manifest: lowRiskManifest('http.no-grant') },
    });
    assert.equal(attempt.status, 422, `an ungranted install must be refused cleanly: ${attempt.text.slice(0, 200)}`);
    assert.equal(attempt.json.kind, 'NOT_AUTHORIZED');
  });

  test('install without a session is refused before any grant logic runs', async () => {
    const attempt = await raw('/api/v1/sector-modules/install', {
      method: 'POST', payload: { id: 'http.anon', manifest: lowRiskManifest('http.anon') },
    });
    assert.equal(attempt.status, 401);
  });

  test('install/activate/deactivate: request -> approve -> spend works end to end, and each token is single-use', async () => {
    const id = 'http.lifecycle.one';
    const manifest = lowRiskManifest(id);

    const installed = await authed('/api/v1/sector-modules/install', {
      method: 'POST', payload: { id, manifest, capabilityToken: await grantSectorModulesWrite() },
    });
    assert.equal(installed.status, 201, `install must succeed: ${installed.text.slice(0, 200)}`);

    const activated = await authed('/api/v1/sector-modules/activate', {
      method: 'POST', payload: { id, capabilityToken: await grantSectorModulesWrite() },
    });
    assert.equal(activated.status, 200, `activate must succeed: ${activated.text.slice(0, 200)}`);
    assert.equal(activated.json.status, 'active');
    assert.equal(activated.json.highRisk, false);

    const listed = await authed('/api/v1/sector-modules/list');
    assert.equal(listed.status, 200);
    const entry = listed.json.valid.find((candidate) => candidate.id === id);
    assert.equal(entry.state.status, 'active');

    const deactivated = await authed('/api/v1/sector-modules/deactivate', {
      method: 'POST', payload: { id, capabilityToken: await grantSectorModulesWrite() },
    });
    assert.equal(deactivated.status, 200, `deactivate must succeed: ${deactivated.text.slice(0, 200)}`);
    assert.equal(deactivated.json.status, 'installed');

    const tokenForReplay = await grantSectorModulesWrite();
    const spent = await authed('/api/v1/sector-modules/activate', {
      method: 'POST', payload: { id, capabilityToken: tokenForReplay },
    });
    assert.equal(spent.status, 200);
    const replay = await authed('/api/v1/sector-modules/deactivate', {
      method: 'POST', payload: { id, capabilityToken: tokenForReplay },
    });
    assert.equal(replay.status, 422, 'a single-use grant must not authorise a second privileged action');
    assert.equal(replay.json.kind, 'NOT_AUTHORIZED');
  });

  test('install refuses without CSRF even with a valid session cookie', async () => {
    const attempt = await raw('/api/v1/sector-modules/install', {
      method: 'POST', payload: { id: 'http.no-csrf', manifest: lowRiskManifest('http.no-csrf') }, headers: { cookie },
    });
    assert.equal(attempt.status, 403);
  });
});

// D-0275: the trusted publisher registry. Registering and revoking a key both carry the
// same weight as pinning an update channel key (D-0272) — an Owner session, CSRF, AND
// recent strong reauthentication, not merely a session.
describe('adapter capability HTTP adversarial — publisher registry requires strong reauthentication to register or revoke', () => {
  test('register without CSRF, and register with CSRF but not yet elevated, are both refused', async () => {
    const noCsrf = await raw('/api/v1/publishers/register', {
      method: 'POST', payload: { publisherId: 'no-csrf-publisher', trustLevel: 'community', publicKeyPem: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) },
      headers: { cookie },
    });
    assert.equal(noCsrf.status, 403);

    const notElevated = await authed('/api/v1/publishers/register', {
      method: 'POST', payload: { publisherId: 'not-elevated-publisher', trustLevel: 'community', publicKeyPem: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) },
    });
    assert.equal(notElevated.status, 403, `an un-elevated session must not register a publisher key: ${notElevated.text.slice(0, 200)}`);
    assert.match(notElevated.json.error, /strong reauthentication/i);
  });

  test('GET /api/v1/publishers without a session is refused', async () => {
    const attempt = await raw('/api/v1/publishers');
    assert.equal(attempt.status, 401);
  });

  // A single TOTP step can be spent once (auth.mjs's monotonic lastTotpStep) and
  // verifies only within one step of the real current time (auth-crypto.mjs's
  // verifyTotpStep window=1) -- so this whole describe() block elevates exactly ONCE
  // (`before()` already spent the step at offset 0 confirming setup) and every
  // subsequent owner action below rides the resulting 5-minute elevation, the same way
  // a real operator would not be asked to re-enter a TOTP code for every click in one
  // sitting.
  test('register -> list -> revoke -> list, then a full high-risk sector-module activation — one elevation, real HTTP throughout', async () => {
    await elevate(1);

    const pem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    const registered = await authed('/api/v1/publishers/register', {
      method: 'POST', payload: { publisherId: 'http-test-publisher', trustLevel: 'community', publicKeyPem: pem },
    });
    assert.equal(registered.status, 201, `register must succeed: ${registered.text.slice(0, 200)}`);
    const fingerprint = registered.json.fingerprint;

    const listed = await authed('/api/v1/publishers');
    assert.equal(listed.status, 200);
    const entry = listed.json.publishers.find((publisher) => publisher.publisherId === 'http-test-publisher');
    assert.equal(entry.trustLevel, 'community');
    assert.equal(entry.keys[0].fingerprint, fingerprint);
    assert.equal(entry.keys[0].state, 'active');

    const revoked = await authed('/api/v1/publishers/revoke', {
      method: 'POST', payload: { publisherId: 'http-test-publisher', fingerprint, reason: 'end-to-end test teardown' },
    });
    assert.equal(revoked.status, 200, `revoke must succeed: ${revoked.text.slice(0, 200)}`);
    assert.equal(revoked.json.revokedCount, 1);

    const listedAfter = await authed('/api/v1/publishers');
    const entryAfter = listedAfter.json.publishers.find((publisher) => publisher.publisherId === 'http-test-publisher');
    assert.equal(entryAfter.keys[0].state, 'revoked');

    // Same elevation, still valid (5 minutes >> this test's runtime): register a SECOND,
    // distinct publisher at noesar-official and prove a real high-risk module activates
    // end to end through it.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const registeredHighRisk = await authed('/api/v1/publishers/register', {
      method: 'POST', payload: { publisherId: 'http-highrisk-publisher', trustLevel: 'noesar-official', publicKeyPem },
    });
    assert.equal(registeredHighRisk.status, 201, `register must succeed: ${registeredHighRisk.text.slice(0, 200)}`);

    const manifest = signSectorModuleManifest({
      id: 'http.highrisk.module', version: '0.1.0', publisher: 'http-highrisk-publisher', trust_level: 'noesar-official',
      sector: ['scientific-research'], intended_use: ['internal validation'], excluded_use: ['physical actuation'],
      permissions: ['filesystem.write.project'], evidence: [{ kind: 'internal-review', ref: 'HTTP-TEST-1' }],
      human_oversight: { required: true, decisionAuthority: 'owner', overrideAvailable: true },
    }, privateKeyPem);

    const installed = await authed('/api/v1/sector-modules/install', {
      method: 'POST', payload: { id: manifest.id, manifest, capabilityToken: await grantSectorModulesWrite() },
    });
    assert.equal(installed.status, 201, `install must succeed: ${installed.text.slice(0, 200)}`);

    const activated = await authed('/api/v1/sector-modules/activate', {
      method: 'POST', payload: { id: manifest.id, capabilityToken: await grantSectorModulesWrite() },
    });
    assert.equal(activated.status, 200, `activate must succeed once the publisher is registered at the matching trust level: ${activated.text.slice(0, 200)}`);
    assert.equal(activated.json.highRisk, true);
    assert.equal(activated.json.status, 'active');
  });
});

// D-0277: the one-click owner-module catalog. Runs AFTER the describe() block above on
// purpose and issues no elevate() call of its own — the prior block's single TOTP-backed
// reauthentication is still valid (5-minute window, this whole file runs in well under
// that), the same way a real Owner would not be asked to re-enter a code for every click
// in one sitting.
describe('adapter capability HTTP adversarial — owner module catalog is a one-click wrapper, not a bypass', () => {
  test('GET /api/v1/sector-modules/catalog without a session is refused', async () => {
    const attempt = await raw('/api/v1/sector-modules/catalog');
    assert.equal(attempt.status, 401);
  });

  test('install/activate/deactivate for an unknown catalog id are all refused with 404', async () => {
    for (const [path, method] of [
      ['/api/v1/sector-modules/catalog/not-a-real-module/install', 'POST'],
      ['/api/v1/sector-modules/catalog/not-a-real-module/activate', 'POST'],
      ['/api/v1/sector-modules/catalog/not-a-real-module/deactivate', 'POST'],
    ]) {
      const attempt = await authed(path, { method, payload: {} });
      assert.equal(attempt.status, 404, `${method} ${path} -> ${attempt.status}`);
    }
  });

  test('debug-evolution: not-installed -> install -> active -> deactivate, over the catalog routes, no manifest or key ever leaves the client', async () => {
    const before = await authed('/api/v1/sector-modules/catalog');
    assert.equal(before.status, 200);
    const beforeEntry = before.json.modules.find((module) => module.id === 'debug-evolution');
    assert.ok(beforeEntry, 'debug-evolution must be a known catalog entry');
    assert.equal(beforeEntry.status, 'not-installed');

    const installed = await authed('/api/v1/sector-modules/catalog/debug-evolution/install', { method: 'POST', payload: {} });
    assert.equal(installed.status, 201, `install must succeed: ${installed.text.slice(0, 200)}`);

    const afterInstall = await authed('/api/v1/sector-modules/catalog');
    assert.equal(afterInstall.json.modules.find((module) => module.id === 'debug-evolution').status, 'installed');

    // The publisher was auto-registered by the install call above — visible in the
    // registry exactly as if an operator had called /api/v1/publishers/register by hand.
    const publishers = await authed('/api/v1/publishers');
    const noesarPublisher = publishers.json.publishers.find((publisher) => publisher.publisherId === 'noesar');
    assert.ok(noesarPublisher, 'the noesar publisher must now be registered');
    assert.equal(noesarPublisher.trustLevel, 'noesar-official');
    assert.equal(noesarPublisher.keys.filter((key) => key.state === 'active').length, 1);

    const activated = await authed('/api/v1/sector-modules/catalog/debug-evolution/activate', { method: 'POST', payload: {} });
    assert.equal(activated.status, 200, `activate must succeed: ${activated.text.slice(0, 200)}`);
    assert.equal(activated.json.highRisk, true);
    assert.equal(activated.json.status, 'active');

    const afterActivate = await authed('/api/v1/sector-modules/catalog');
    assert.equal(afterActivate.json.modules.find((module) => module.id === 'debug-evolution').status, 'active');

    // Installing again while already installed is refused (ALREADY_INSTALLED), not a
    // silent duplicate — same invariant the raw D-0274 install route already carries.
    const reinstall = await authed('/api/v1/sector-modules/catalog/debug-evolution/install', { method: 'POST', payload: {} });
    assert.equal(reinstall.status, 409);

    const deactivated = await authed('/api/v1/sector-modules/catalog/debug-evolution/deactivate', { method: 'POST', payload: {} });
    assert.equal(deactivated.status, 200, `deactivate must succeed: ${deactivated.text.slice(0, 200)}`);
    assert.equal(deactivated.json.status, 'installed');

    const afterDeactivate = await authed('/api/v1/sector-modules/catalog');
    assert.equal(afterDeactivate.json.modules.find((module) => module.id === 'debug-evolution').status, 'installed');
  });

  test('a second catalog module would reuse the same noesar publisher key, not mint a new one (idempotent registration)', async () => {
    const publishersBefore = await authed('/api/v1/publishers');
    const keyCountBefore = publishersBefore.json.publishers.find((publisher) => publisher.publisherId === 'noesar').keys.length;
    // debug-evolution is already installed by the previous test; reinstalling a
    // DIFFERENT hypothetical catalog id is not possible without a second catalog entry,
    // so this proves the narrower claim directly: calling the install path's own
    // ensureOwnerPublisherRegistered() logic a second time (via a second activate
    // attempt cycle) never grows the key count. Deactivate/reactivate exercises exactly
    // that code path again.
    const reactivated = await authed('/api/v1/sector-modules/catalog/debug-evolution/activate', { method: 'POST', payload: {} });
    assert.equal(reactivated.status, 200, `reactivate must succeed: ${reactivated.text.slice(0, 200)}`);
    const publishersAfter = await authed('/api/v1/publishers');
    const keyCountAfter = publishersAfter.json.publishers.find((publisher) => publisher.publisherId === 'noesar').keys.length;
    assert.equal(keyCountAfter, keyCountBefore, 'the same signing key must be reused, not a new one minted per call');
  });
});
