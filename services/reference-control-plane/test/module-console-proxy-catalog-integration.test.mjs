// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0281 follow-up, end to end: with NOESAR_DEBUG_EVOLUTION_URL and a bind address
// configured, GET /api/v1/sector-modules/catalog must report the module's externalUrl
// as NOESAR's own publish address on the proxy port -- not the module's own (now
// LAN-closed) address -- and that proxy port must actually gate on a real NOESAR
// session and forward to a real stub Debug Evolution.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';
const DEBUG_EVOLUTION_TOKEN = 'stub-debug-evolution-token';
const PROXY_PORT = 18789;
const BIND_ADDRESS = '127.0.0.1';

const stubDebugEvolution = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/styles.css') {
    res.writeHead(200, { 'content-type': 'text/css' }); res.end('body{color:blue}'); return;
  }
  res.writeHead(404); res.end('not found');
});
await new Promise((resolve) => stubDebugEvolution.listen(0, '127.0.0.1', resolve));
process.env.NOESAR_DEBUG_EVOLUTION_URL = `http://127.0.0.1:${stubDebugEvolution.address().port}`;
process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = DEBUG_EVOLUTION_TOKEN;
process.env.NOESAR_MODULE_PROXY_PORT = String(PROXY_PORT);
process.env.NOESAR_BIND_ADDRESS = BIND_ADDRESS;
process.env.NOESAR_BIND_SCOPE = 'lan';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-module-proxy-catalog-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server, startModuleConsoleProxy, stopModuleConsoleProxy, isModuleConsoleProxyListening } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;

async function raw(path, { method = 'GET', payload, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, json, text };
}
function authed(path, opts = {}) { return raw(path, { ...opts, headers: { cookie, ...(csrf ? { 'x-noesar-csrf': csrf } : {}), ...(opts.headers ?? {}) } }); }

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const begun = await raw('/api/v1/auth/setup', {
    method: 'POST', payload: { username: 'owner', displayName: 'Owner', password: PASSWORD },
    headers: { 'x-noesar-setup-token': SETUP_TOKEN },
  });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);
  const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: begun.json.challenge, totpCode: totpCode(begun.json.totpSecret, stepStart()) }),
  });
  assert.equal(response.status, 201, 'setup confirm failed');
  const setCookie = response.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = (await response.json()).csrfToken;
  assert.ok(csrf, 'setup confirm must return a csrf token');

  // D-0283: the proxy no longer listens because an environment variable is set — it comes
  // up when the module is ACTIVE. Installing and activating through the real catalog routes
  // is now part of what this test proves.
  const installed = await authed('/api/v1/sector-modules/catalog/debug-evolution/install', { method: 'POST', payload: {} });
  assert.equal(installed.status, 201, `install failed: ${installed.text.slice(0, 200)}`);
  const activated = await authed('/api/v1/sector-modules/catalog/debug-evolution/activate', { method: 'POST', payload: {} });
  assert.equal(activated.status, 200, `activate failed: ${activated.text.slice(0, 200)}`);
  startModuleConsoleProxy();
  // listen() is asynchronous; wait for the port to answer rather than racing it.
  for (let attempt = 0; attempt < 50 && !isModuleConsoleProxyListening(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 50));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  stopModuleConsoleProxy();
  await new Promise((resolve) => stubDebugEvolution.close(resolve));
});

describe('D-0281 — the catalog reports a NOESAR-proxied externalUrl, and the proxy port actually works', () => {
  test('GET /api/v1/sector-modules/catalog reports externalUrl on the bind address and proxy port, not the module\'s own address', async () => {
    const listed = await authed('/api/v1/sector-modules/catalog');
    assert.equal(listed.status, 200, `catalog failed: ${listed.text.slice(0, 200)}`);
    const debugEvolution = listed.json.modules.find((module) => module.id === 'debug-evolution');
    assert.ok(debugEvolution, 'debug-evolution must be in the catalog');
    assert.equal(debugEvolution.externalUrl, `http://${BIND_ADDRESS}:${PROXY_PORT}`);
  });

  test('the proxy port refuses an unauthenticated browser request', async () => {
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/styles.css`);
    assert.equal(response.status, 401);
  });

  test('the proxy port serves the real module content for a request carrying a real NOESAR session cookie', async () => {
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/styles.css`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'body{color:blue}');
  });
});
