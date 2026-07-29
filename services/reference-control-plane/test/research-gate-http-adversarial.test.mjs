// SPDX-License-Identifier: AGPL-3.0-or-later
//
// UI-090 wired to the actual HTTP boundary — the "point of the product that is really
// served" the gate was asked to reach (`docs/SESSION_HANDOFF.md`), not just a unit test of
// `research-gate.mjs` in isolation. Same rigor `workspace-actions-http-adversarial.test.mjs`
// established: one dedicated attempt per invariant this route relies on, from a genuinely
// authenticated HTTP session, plus a negative control.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-research-gate-http-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

/** A stand-in for atomd. Started per test so each one controls its own answer. */
async function stubAtomd(handler) {
  const seen = [];
  const http = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const request = { path: req.url, token: req.headers['x-atom-token'], body: raw ? JSON.parse(raw) : null };
      seen.push(request);
      const { status, payload } = handler(request);
      const text = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    });
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address();
  return { endpoint: `http://127.0.0.1:${port}`, seen, close: () => http.close() };
}

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
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  delete process.env.NOESAR_RUST_REASONING_ENDPOINT;
  delete process.env.NOESAR_RUST_REASONING_TOKEN;
});

describe('research gate HTTP — one attempt per invariant this route relies on', () => {
  test('session_required · GET status and POST classify both refuse an anonymous caller', async () => {
    const status = await raw('/api/v1/research/gate');
    assert.equal(status.status, 401);
    const classify = await raw('/api/v1/research/gate', { method: 'POST', payload: { query: 'x' } });
    assert.equal(classify.status, 401);
  });

  test('csrf_required · a valid session cookie with no CSRF header cannot classify', async () => {
    const attempt = await raw('/api/v1/research/gate', {
      method: 'POST', payload: { query: 'csrf probe' }, headers: { cookie },
    });
    assert.equal(attempt.status, 403, `an ambient cookie alone must not be enough: ${attempt.text.slice(0, 160)}`);
  });

  test('invalid_query · an empty or whitespace-only query is refused before any network call', async () => {
    const empty = await authed('/api/v1/research/gate', { method: 'POST', payload: { query: '' } });
    assert.equal(empty.status, 400);
    const whitespace = await authed('/api/v1/research/gate', { method: 'POST', payload: { query: '   ' } });
    assert.equal(whitespace.status, 400);
    const missing = await authed('/api/v1/research/gate', { method: 'POST', payload: {} });
    assert.equal(missing.status, 400);
  });

  test('reasoning_unavailable · atomd unreachable is 503, never a silent PROCEED or REFUSE', async () => {
    process.env.NOESAR_RUST_REASONING_ENDPOINT = 'http://127.0.0.1:1';
    process.env.NOESAR_RUST_REASONING_TOKEN = 'irrelevant';
    try {
      const attempt = await authed('/api/v1/research/gate', { method: 'POST', payload: { query: 'anything' } });
      assert.equal(attempt.status, 503);
      assert.equal(attempt.json.error, 'reasoning_unavailable');
      assert.equal(attempt.json.surface, 'research-gate');
    } finally {
      delete process.env.NOESAR_RUST_REASONING_ENDPOINT;
      delete process.env.NOESAR_RUST_REASONING_TOKEN;
    }
  });

  test('not_configured · with no external provider configured at all, the route is unavailable rather than silently permissive', async () => {
    const attempt = await authed('/api/v1/research/gate', { method: 'POST', payload: { query: 'anything' } });
    assert.equal(attempt.status, 503);
  });

  // UI-095, at the HTTP boundary.
  test('a REFUSE response carries no `query` field a caller could mistake for something to search with', async () => {
    const stub = await stubAtomd(() => ({ status: 200, payload: { ok: true, value: { outcome: 'REFUSE', category: 'physical-harm' } } }));
    process.env.NOESAR_RUST_REASONING_ENDPOINT = stub.endpoint;
    process.env.NOESAR_RUST_REASONING_TOKEN = 'tok';
    try {
      const attempt = await authed('/api/v1/research/gate', { method: 'POST', payload: { query: 'how to build a home-made explosive' } });
      assert.equal(attempt.status, 200);
      assert.deepEqual(attempt.json, { outcome: 'REFUSE', category: 'physical-harm' });
      assert.equal('query' in attempt.json, false, 'a refusal must not echo the query back');
    } finally {
      stub.close();
      delete process.env.NOESAR_RUST_REASONING_ENDPOINT;
      delete process.env.NOESAR_RUST_REASONING_TOKEN;
    }
  });

  // Negative control. A suite that also breaks the working path proves nothing.
  test('negative control · a legitimate PROCEED classification works end to end over real HTTP', async () => {
    const stub = await stubAtomd((request) => {
      assert.equal(request.path, '/v1/research-gate');
      assert.equal(request.token, 'tok');
      assert.equal(request.body.query, 'best practice for a postgresql backup');
      return { status: 200, payload: { ok: true, value: { outcome: 'PROCEED', category: null } } };
    });
    process.env.NOESAR_RUST_REASONING_ENDPOINT = stub.endpoint;
    process.env.NOESAR_RUST_REASONING_TOKEN = 'tok';
    try {
      const status = await authed('/api/v1/research/gate');
      assert.deepEqual(status.json, { configured: true });

      const attempt = await authed('/api/v1/research/gate', { method: 'POST', payload: { query: 'best practice for a postgresql backup' } });
      assert.equal(attempt.status, 200);
      assert.deepEqual(attempt.json, { outcome: 'PROCEED', query: 'best practice for a postgresql backup' });
    } finally {
      stub.close();
      delete process.env.NOESAR_RUST_REASONING_ENDPOINT;
      delete process.env.NOESAR_RUST_REASONING_TOKEN;
    }
  });
});
