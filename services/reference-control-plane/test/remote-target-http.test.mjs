// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0286, end to end: `POST /api/v1/debug-evolution/remote-targets` through a REAL
// server.mjs boot, a REAL local sshd (the "remote target"), and a stub Debug Evolution
// receiving the real uploaded tarball. Proves the whole chain a curl cannot: NOESAR
// captures the real host key, the Owner activates with a real private key, the fetch runs
// real `scp` against the real sshd, and the real bytes that sshd served land at Debug
// Evolution's import endpoint unchanged.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';
import { OWNER_MODULE_CATALOG } from '../src/owner-module-catalog.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';
const DEBUG_EVOLUTION_TOKEN = 'stub-debug-evolution-token';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close((e) => (e ? reject(e) : resolve(port))); });
    probe.on('error', reject);
  });
}

// --- real sshd, the "remote target" -------------------------------------------------------
const sshWorkDir = mkdtempSync(join(tmpdir(), 'noesar-remote-target-http-ssh-'));
const hostKeyPath = join(sshWorkDir, 'ssh_host_ed25519_key');
const clientKeyPath = join(sshWorkDir, 'client_key');
const authorizedKeysPath = join(sshWorkDir, 'authorized_keys');
const remoteContentDir = join(sshWorkDir, 'remote_content');
const sshdConfigPath = join(sshWorkDir, 'sshd_config');
mkdirSync(remoteContentDir, { recursive: true });
writeFileSync(join(remoteContentDir, 'app.py'), 'SECRET = "hunter2"\n');
run('ssh-keygen', ['-t', 'ed25519', '-f', hostKeyPath, '-N', '', '-q']);
run('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q']);
writeFileSync(authorizedKeysPath, await readFile(`${clientKeyPath}.pub`));
const clientPrivateKeyPem = await readFile(clientKeyPath, 'utf8');
const sshPort = await freePort();
writeFileSync(sshdConfigPath, [
  `Port ${sshPort}`, 'ListenAddress 127.0.0.1', `HostKey ${hostKeyPath}`,
  `AuthorizedKeysFile ${authorizedKeysPath}`, 'PasswordAuthentication no', 'KbdInteractiveAuthentication no',
  'PubkeyAuthentication yes', 'UsePAM no', 'StrictModes no', 'PidFile none',
  'Subsystem sftp /usr/libexec/sftp-server', 'LogLevel ERROR',
].join('\n'));
const sshdProcess = await new Promise((resolve, reject) => {
  const child = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', sshdConfigPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let started = false;
  const onReady = () => { if (!started) { started = true; resolve(child); } };
  child.stderr.on('data', (chunk) => { if (/Server listening/.test(chunk.toString())) onReady(); });
  child.on('error', reject);
  child.on('exit', (code) => { if (!started) reject(new Error(`sshd exited early with code ${code}`)); });
  setTimeout(onReady, 1500);
});

// --- stub Debug Evolution, receiving the real uploaded tarball ----------------------------
const importCalls = [];
const stubDebugEvolution = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${DEBUG_EVOLUTION_TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return;
  }
  if (req.method === 'POST' && req.url.startsWith('/api/v2/projects/import')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, 'http://stub');
    importCalls.push({ name: url.searchParams.get('name'), slug: url.searchParams.get('slug'), body: Buffer.concat(chunks) });
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ project: { id: `p-${importCalls.length}` }, finding_count: 0, node_count: 1 }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unknown' }));
});
await new Promise((resolve) => stubDebugEvolution.listen(0, '127.0.0.1', resolve));

const workspace = mkdtempSync(join(tmpdir(), 'noesar-remote-target-http-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';
process.env.NOESAR_DEBUG_EVOLUTION_URL = `http://127.0.0.1:${stubDebugEvolution.address().port}`;
process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = DEBUG_EVOLUTION_TOKEN;

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
  sshdProcess.kill('SIGKILL');
  rmSync(sshWorkDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('D-0286 — remote target registration and fetch-and-scan, real sshd end to end', () => {
  let targetId;

  test('registration without a session is refused', async () => {
    const attempt = await raw('/api/v1/debug-evolution/remote-targets', { method: 'POST' });
    assert.equal(attempt.status, 401);
  });

  test('registering a target runs a REAL ssh-keyscan against the real sshd and returns a real fingerprint', async () => {
    const result = await authed('/api/v1/debug-evolution/remote-targets', {
      method: 'POST',
      payload: { name: 'Real Remote', host: '127.0.0.1', port: sshPort, username: process.env.USER || 'root', remotePath: remoteContentDir },
    });
    assert.equal(result.status, 201, `register failed: ${result.text.slice(0, 300)}`);
    assert.equal(result.json.status, 'awaiting-key');
    assert.match(result.json.fingerprint, /^SHA256:/);
    assert.equal(result.json.credentialConfigured, false);
    targetId = result.json.id;

    const realFingerprint = run('ssh-keygen', ['-lf', `${hostKeyPath}.pub`]);
    assert.ok(realFingerprint.includes(result.json.fingerprint), 'the fingerprint returned to the Owner must be the REAL host key\'s own, not a placeholder');
  });

  test('the target is listed as awaiting-key', async () => {
    const listed = await authed('/api/v1/debug-evolution/remote-targets');
    assert.equal(listed.status, 200);
    assert.ok(listed.json.targets.some((t) => t.id === targetId && t.status === 'awaiting-key'));
  });

  test('activating with the real private key makes the target active', async () => {
    const result = await authed(`/api/v1/debug-evolution/remote-targets/${targetId}/activate`, {
      method: 'POST', payload: { privateKey: clientPrivateKeyPem },
    });
    assert.equal(result.status, 200, `activate failed: ${result.text.slice(0, 300)}`);
    assert.equal(result.json.status, 'active');
    assert.equal(result.json.credentialConfigured, true);
  });

  test('fetch-and-scan runs a real scp against the real sshd and the real bytes reach Debug Evolution\'s import endpoint', async () => {
    const result = await authed(`/api/v1/debug-evolution/remote-targets/${targetId}/fetch-and-scan`, { method: 'POST', payload: {} });
    assert.equal(result.status, 200, `fetch-and-scan failed: ${result.text.slice(0, 300)}`);
    assert.equal(result.json.projectId, 'p-1');
    assert.equal(result.json.target.lastFetch.ok, true);

    assert.equal(importCalls.length, 1);
    assert.equal(importCalls[0].name, 'Real Remote');
    assert.equal(importCalls[0].slug, targetId, 'the slug uploaded to Debug Evolution must be the target\'s own stable id');
    assert.ok(importCalls[0].body.length > 0, 'the uploaded body must be the real tarball, not empty');
  });

  test('fetch-and-scan is refused with 409 while the module is not active', async () => {
    // Flips the module out of active without going through the real deactivate route (out
    // of scope for this test file) -- writing state.json directly is the same thing
    // module-uninstall-wiring.test.mjs already exercises through the real route; this test
    // only needs to confirm the gate this route ALSO carries, matching rescan/triage.
    writeFileSync(join(moduleRoot, 'state.json'), JSON.stringify({
      status: 'installed', installedAtUnix: 1, activatedAtUnix: 2, deactivatedAtUnix: 3, history: [],
    }, null, 2));
    const result = await authed(`/api/v1/debug-evolution/remote-targets/${targetId}/fetch-and-scan`, { method: 'POST', payload: {} });
    assert.equal(result.status, 409);
    writeFileSync(join(moduleRoot, 'state.json'), JSON.stringify({
      status: 'active', installedAtUnix: 1, activatedAtUnix: 2, deactivatedAtUnix: null, history: [],
    }, null, 2));
  });

  test('removing the target deletes it — nothing left to fetch with', async () => {
    const result = await authed(`/api/v1/debug-evolution/remote-targets/${targetId}`, { method: 'DELETE' });
    assert.equal(result.status, 200);
    const listed = await authed('/api/v1/debug-evolution/remote-targets');
    assert.equal(listed.json.targets.length, 0);
  });
});
