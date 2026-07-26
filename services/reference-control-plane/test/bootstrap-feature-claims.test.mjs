// SPDX-License-Identifier: AGPL-3.0-or-later
//
// WP-2 — every feature `/api/v1/bootstrap` advertises must have a route behind it.
//
// The bootstrap response carries a `features` list that the interface renders as this
// build's capabilities. Nothing checked that the list was true. It advertised
// `Workflows` while no page, no route and no engine existed — the same class of defect
// this project has now found three times: an interface asserting something the code does
// not do (the WebUI's five hardcoded invariants, the security matrix rows describing
// absent behaviour, the Podman installer that never installed).
//
// The probe map lives HERE and not in the server on purpose. If it lived beside the
// feature list, one edit could add a feature and a matching claim of proof in the same
// breath, which proves nothing. Kept separate, the two must agree: adding a feature to
// the server without a probe fails this test with "no probe defined", and adding a probe
// for a route that does not exist fails it with a 404.
//
// A probe passes when the route answers as an authorised caller — any status except 404
// and 501. A 4xx from a route that exists and refused this particular input still proves
// the capability is wired; a 404 proves it is not there at all.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-feature-claims-'));
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
const post = (path, payload = {}, extraHeaders = {}) => request('POST', path, payload, extraHeaders);

// One probe per advertised feature: the route that proves the capability is wired.
// Where a feature is served by several routes, the probe names the one that cannot be
// satisfied by anything else.
const FEATURE_PROBES = Object.freeze({
  'Ask': () => get('/api/v1/ai/bootstrap'),
  'Create': () => get('/api/v1/ai/bootstrap'),
  'Act': () => get('/api/v1/ai/bootstrap'),
  'Versioned Context Graph': () => get('/api/v1/conversations'),
  'Projects': () => get('/api/v1/projects'),
  'Documents': () => get('/api/v1/sources'),
  'Artifacts': () => get('/api/v1/artifacts'),
  'Agents': () => get('/api/v1/agents'),
  'Workflows': () => get('/api/v1/workflows'),
  'CodeN Evolution': () => post('/api/v1/coden/path-plan', { mode: 'NORMAL', operation: 'read', path: 'projects' }),
  'Knowledge': () => get('/api/v1/knowledge/search?q=probe'),
  'Memory': () => get('/api/v1/memories'),
  'Local and External Providers': () => get('/api/v1/providers'),
  'MCP and OpenAPI Tools': () => get('/api/v1/tools'),
  'Compute & Hardware': () => get('/api/v1/hardware'),
  'Data Export and Retention': () => get('/api/v1/data/export'),
  'Update Center': () => get('/api/v1/updates/status'),
});

let advertised = [];

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const begun = await post('/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': SETUP_TOKEN });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);

  // Confirm with the previous step's code, leaving steps 0 and +1 unspent — the replay
  // guard demands strictly increasing steps.
  const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: begun.json.challenge,
      totpCode: totpCode(begun.json.totpSecret, stepStart(-1)),
    }),
  });
  const confirmedText = await response.text();
  assert.equal(response.status, 201, `setup confirm failed: ${confirmedText.slice(0, 200)}`);
  const confirmed = JSON.parse(confirmedText);
  const session = (response.headers.getSetCookie?.() ?? []).find((entry) => entry.startsWith('noesar_session='));
  assert.ok(session, 'the bootstrap must issue a session cookie');
  cookie = session.split(';')[0];
  csrf = confirmed.csrfToken;

  const bootstrap = await get('/api/v1/bootstrap');
  assert.equal(bootstrap.status, 200, `bootstrap failed: ${bootstrap.text.slice(0, 200)}`);
  assert.ok(Array.isArray(bootstrap.json.features), 'bootstrap must advertise a feature list');
  advertised = bootstrap.json.features;
});

after(async () => {
  watchdog.stop();
  await new Promise((resolve) => server.close(resolve));
});

describe('the bootstrap feature list is a claim the routes must honour', () => {
  test('every advertised feature has a probe defined in this test', () => {
    const unprobed = advertised.filter((feature) => !(feature in FEATURE_PROBES));
    assert.deepEqual(unprobed, [],
      `these features are advertised with no probe in this test — add the probe, or stop advertising them: ${unprobed.join(', ')}`);
  });

  test('no probe describes a feature the bootstrap does not advertise', () => {
    const orphaned = Object.keys(FEATURE_PROBES).filter((feature) => !advertised.includes(feature));
    assert.deepEqual(orphaned, [],
      `these probes no longer match the advertised list: ${orphaned.join(', ')}`);
  });

  for (const [feature, probe] of Object.entries(FEATURE_PROBES)) {
    test(`"${feature}" is served by a route that exists`, async () => {
      const result = await probe();
      assert.notEqual(result.status, 404,
        `"${feature}" is advertised by /api/v1/bootstrap but its route answered 404 — the claim is not honoured`);
      assert.notEqual(result.status, 501,
        `"${feature}" is advertised by /api/v1/bootstrap but its route is not implemented`);
    });
  }
});
