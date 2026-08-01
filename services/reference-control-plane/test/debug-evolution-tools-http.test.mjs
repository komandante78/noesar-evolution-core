// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0278: proves the seeding + rescan route end to end over real HTTP, against a stub
// Debug Evolution. NOESAR_DEBUG_EVOLUTION_TOKEN/_URL must be set BEFORE server.mjs is
// imported — reconcileModuleWiring() runs once, at module load, the same way every
// other startup-time bootstrap step in server.mjs does.
//
// D-0283 added the second precondition this test now writes: the environment alone no
// longer seeds anything, because it survives an uninstall. The module has to be INSTALLED
// AND ACTIVE, set up below exactly as the live installation has it. What D-0278 proved is
// unchanged; what entitles it to be true is now explicit.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';
import { OWNER_MODULE_CATALOG } from '../src/owner-module-catalog.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';
const DEBUG_EVOLUTION_TOKEN = 'stub-debug-evolution-token';

const stubDebugEvolution = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${DEBUG_EVOLUTION_TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return;
  }
  if (req.method === 'GET' && req.url === '/api/v2/projects') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ projects: [{ id: 'p1', name: 'NOESAR EVOLUTION - apps' }] }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/v2/findings') {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ findings: [] })); return;
  }
  if (req.url === '/api/v2/projects/p1/genome/rebuild') {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ finding_count: 2, node_count: 10 })); return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unknown' }));
});
await new Promise((resolve) => stubDebugEvolution.listen(0, '127.0.0.1', resolve));
process.env.NOESAR_DEBUG_EVOLUTION_URL = `http://127.0.0.1:${stubDebugEvolution.address().port}`;
process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = DEBUG_EVOLUTION_TOKEN;

const workspace = mkdtempSync(join(tmpdir(), 'noesar-de-tools-http-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

// D-0283: the module is installed and active here, which is what entitles the tools to be
// seeded at boot at all.
const moduleRoot = join(workspace, 'sector-modules', 'debug-evolution');
mkdirSync(moduleRoot, { recursive: true });
writeFileSync(join(moduleRoot, 'manifest.json'), JSON.stringify(OWNER_MODULE_CATALOG[0].buildManifest(), null, 2));
writeFileSync(join(moduleRoot, 'state.json'), JSON.stringify({
  status: 'active', installedAtUnix: 1, activatedAtUnix: 2, deactivatedAtUnix: null,
  history: [{ event: 'installed', atUnix: 1 }, { event: 'activated', atUnix: 2 }],
}, null, 2));

const { server } = await import('../src/server.mjs');

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
function authed(path, opts = {}) { return raw(path, { ...opts, headers: { cookie, 'x-noesar-csrf': csrf, ...(opts.headers ?? {}) } }); }

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
  const confirmed = await response.json();
  const setCookie = response.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = confirmed.csrfToken;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => stubDebugEvolution.close(resolve));
});

describe('D-0278 — Debug Evolution tools are seeded, and the rescan bridge works end to end', () => {
  test('the three Debug Evolution tools are seeded, visible in GET /api/v1/tools', async () => {
    const listed = await authed('/api/v1/tools');
    assert.equal(listed.status, 200);
    const names = listed.json.tools.map((tool) => tool.name);
    assert.ok(names.includes('Debug Evolution — List Projects'), JSON.stringify(names));
    assert.ok(names.includes('Debug Evolution — All Findings'), JSON.stringify(names));
    assert.ok(names.includes('Debug Evolution — SARIF Report'), JSON.stringify(names));
  });

  test('an Agents run actually calls the seeded tool and gets the real (stub) Debug Evolution response back', async () => {
    const listed = await authed('/api/v1/tools');
    const listProjectsTool = listed.json.tools.find((tool) => tool.name === 'Debug Evolution — List Projects');
    assert.ok(listProjectsTool, 'the List Projects tool must be seeded');
    assert.equal(listProjectsTool.mutative, false);

    const agent = await authed('/api/v1/agents', { method: 'POST', payload: { name: 'Scanner', toolIds: [listProjectsTool.id] } });
    assert.equal(agent.status, 201, `agent create failed: ${agent.text.slice(0, 200)}`);

    const run = await authed('/api/v1/agent-runs', {
      method: 'POST',
      payload: { agentId: agent.json.id, goal: 'List Debug Evolution projects', steps: [{ title: 'List projects', toolId: listProjectsTool.id, mutative: false }] },
    });
    assert.equal(run.status, 201, `run create failed: ${run.text.slice(0, 200)}`);
    assert.equal(run.json.steps[0].status, 'pending', 'a non-mutative step must not need approval');

    const executed = await authed(`/api/v1/agent-runs/${run.json.id}/steps/${run.json.steps[0].id}/execute`, { method: 'POST', payload: {} });
    assert.equal(executed.status, 200, `execute failed: ${executed.text.slice(0, 200)}`);
    assert.equal(executed.json.steps[0].status, 'completed');
    assert.deepEqual(executed.json.steps[0].output.result.projects, [{ id: 'p1', name: 'NOESAR EVOLUTION - apps' }]);
  });

  test('rescan without a session is refused', async () => {
    const attempt = await raw('/api/v1/debug-evolution/rescan', { method: 'POST' });
    assert.equal(attempt.status, 401);
  });

  test('rescan without CSRF is refused', async () => {
    const attempt = await raw('/api/v1/debug-evolution/rescan', { method: 'POST', headers: { cookie } });
    assert.equal(attempt.status, 403);
  });

  test('rescan succeeds for an owner session and reaches the stub Debug Evolution for real', async () => {
    const result = await authed('/api/v1/debug-evolution/rescan', { method: 'POST', payload: {} });
    assert.equal(result.status, 200, `rescan failed: ${result.text.slice(0, 200)}`);
    assert.equal(result.json.rescanned, 1);
    assert.equal(result.json.succeeded, 1);
    assert.equal(result.json.results[0].findingCount, 2);
  });
});
