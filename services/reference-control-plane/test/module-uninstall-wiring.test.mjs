// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0283, end to end. Owner instruction (s302), verbatim: "disinstallare debug evolution
// deve lasciare noesar intatto". Before this there was no uninstall at all, and the three
// things that made the module usable -- its Agents/Workflows tools, its service credential,
// and the console proxy port -- were decided by NOESAR's own container environment, which
// survives any module operation. This drives the real HTTP surface through
// install -> activate -> uninstall -> re-install and asserts each of the three actually
// goes away and comes back.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';
const PROXY_PORT = 18791;
const BIND_ADDRESS = '127.0.0.1';

const stubDebugEvolution = createServer((req, res) => {
  if (req.url === '/styles.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end('body{color:blue}'); return; }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ projects: [] }));
});
await new Promise((resolve) => stubDebugEvolution.listen(0, '127.0.0.1', resolve));

const workspace = mkdtempSync(join(tmpdir(), 'noesar-module-uninstall-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';
process.env.NOESAR_DEBUG_EVOLUTION_URL = `http://127.0.0.1:${stubDebugEvolution.address().port}`;
process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = 'stub-debug-evolution-token';
process.env.NOESAR_MODULE_PROXY_PORT = String(PROXY_PORT);
process.env.NOESAR_BIND_ADDRESS = BIND_ADDRESS;
process.env.NOESAR_BIND_SCOPE = 'lan';

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
function owner(path, opts = {}) {
  return raw(path, { ...opts, headers: { cookie, 'x-noesar-csrf': csrf, ...(opts.headers ?? {}) } });
}
function aiState() {
  return JSON.parse(readFileSync(join(workspace, 'state/ai-workspace.json'), 'utf8'));
}
function debugEvolutionTools() {
  return aiState().tools.filter((tool) => tool.name.startsWith('Debug Evolution'));
}
function moduleToken() {
  const path = join(workspace, 'module-credentials/debug-evolution.token');
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}
/** The credential is only real if it authenticates. `workspace.read` is what a service
 * account carries (auth.mjs), and the catalog route is a `workspace.read` route. */
async function moduleTokenAuthenticates() {
  const token = moduleToken();
  if (!token) return false;
  const response = await raw('/api/v1/sector-modules/catalog', { headers: { authorization: `Bearer ${token}` } });
  return response.status === 200;
}
async function catalogEntry() {
  const listed = await owner('/api/v1/sector-modules/catalog');
  return listed.json.modules.find((module) => module.id === 'debug-evolution');
}
async function settle() { await new Promise((resolve) => setTimeout(resolve, 60)); }

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
  cookie = (response.headers.getSetCookie?.() ?? []).find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = (await response.json()).csrfToken;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  stopModuleConsoleProxy();
  await new Promise((resolve) => stubDebugEvolution.close(resolve));
});

describe('D-0283 — uninstalling a module leaves NOESAR intact', () => {
  test('before any install: no tools are wired, no proxy listens, and the rescan bridge refuses', async () => {
    assert.equal(debugEvolutionTools().length, 0, 'a configured environment must NOT be enough to seed the tools');
    assert.equal(isModuleConsoleProxyListening(), false);
    const rescan = await owner('/api/v1/debug-evolution/rescan', { method: 'POST', payload: {} });
    assert.equal(rescan.status, 409, 'the bridge must refuse while the module is not active');
    assert.equal((await catalogEntry()).status, 'not-installed');
  });

  test('install + activate wires all three surfaces', async () => {
    const installed = await owner('/api/v1/sector-modules/catalog/debug-evolution/install', { method: 'POST', payload: {} });
    assert.equal(installed.status, 201, `install failed: ${installed.text.slice(0, 200)}`);
    const activated = await owner('/api/v1/sector-modules/catalog/debug-evolution/activate', { method: 'POST', payload: {} });
    assert.equal(activated.status, 200, `activate failed: ${activated.text.slice(0, 200)}`);
    startModuleConsoleProxy();
    await settle();

    const tools = debugEvolutionTools();
    assert.equal(tools.length, 3, 'the three read-only tools come up on activation');
    assert.ok(tools.every((tool) => tool.disabled === false && tool.encryptedCredential), 'each tool is enabled and credentialled');
    assert.equal(isModuleConsoleProxyListening(), true, 'the console port opens on activation');
    assert.equal(await moduleTokenAuthenticates(), true, 'the module service credential authenticates');
    assert.equal((await catalogEntry()).status, 'active');
  });

  test('uninstall removes every one of them, in one Owner action', async () => {
    const uninstalled = await owner('/api/v1/sector-modules/catalog/debug-evolution/uninstall', { method: 'POST', payload: {} });
    assert.equal(uninstalled.status, 200, `uninstall failed: ${uninstalled.text.slice(0, 200)}`);
    assert.equal(uninstalled.json.wasActive, true);
    assert.equal(uninstalled.json.toolsDetached.length, 3);
    await settle();

    const tools = debugEvolutionTools();
    assert.equal(tools.length, 3, 'the rows survive — an agent that references one still resolves');
    assert.ok(tools.every((tool) => tool.disabled === true), 'every tool is disabled');
    assert.ok(tools.every((tool) => tool.encryptedCredential === null), 'no tool keeps the module credential');
    assert.equal(isModuleConsoleProxyListening(), false, 'the console port closes');
    assert.equal(await moduleTokenAuthenticates(), false, 'the module service token no longer authenticates');
    assert.equal((await catalogEntry()).status, 'not-installed', 'the card offers Install again');

    const rescan = await owner('/api/v1/debug-evolution/rescan', { method: 'POST', payload: {} });
    assert.equal(rescan.status, 409, 'the bridge refuses again, even though the environment still names the module');
  });

  test('the environment variables are untouched — they are configuration, not installation', () => {
    assert.ok(process.env.NOESAR_DEBUG_EVOLUTION_URL, 'the URL still points at the module');
    assert.ok(process.env.NOESAR_DEBUG_EVOLUTION_TOKEN, 'the module token is still configured');
  });

  test('activate is refused on an uninstalled module — the manifest on disk is evidence, not an installation', async () => {
    const activated = await owner('/api/v1/sector-modules/catalog/debug-evolution/activate', { method: 'POST', payload: {} });
    assert.equal(activated.status, 422);
    assert.equal(activated.json.kind, 'NOT_INSTALLED');
  });

  test('re-install + activate brings the same three tools back, credentialled, with no duplicates', async () => {
    const installed = await owner('/api/v1/sector-modules/catalog/debug-evolution/install', { method: 'POST', payload: {} });
    assert.equal(installed.status, 201, `re-install failed: ${installed.text.slice(0, 200)}`);
    const activated = await owner('/api/v1/sector-modules/catalog/debug-evolution/activate', { method: 'POST', payload: {} });
    assert.equal(activated.status, 200, `re-activate failed: ${activated.text.slice(0, 200)}`);
    startModuleConsoleProxy();
    await settle();

    const tools = debugEvolutionTools();
    assert.equal(tools.length, 3, 'no second copy of each tool');
    assert.ok(tools.every((tool) => tool.disabled === false && tool.encryptedCredential), 'each tool is armed again');
    assert.equal(await moduleTokenAuthenticates(), true, 'a fresh credential was issued to the reinstated account');
    assert.equal(isModuleConsoleProxyListening(), true, 'the console port opens again');

    // The install history is cumulative: the record of what this installation once trusted
    // is not erased by removing and re-adding the module.
    const state = JSON.parse(readFileSync(join(workspace, 'sector-modules/debug-evolution/state.json'), 'utf8'));
    const events = state.history.map((entry) => entry.event);
    assert.deepEqual(events, ['installed', 'activated', 'deactivated', 'uninstalled', 'installed', 'activated']);
  });
});
