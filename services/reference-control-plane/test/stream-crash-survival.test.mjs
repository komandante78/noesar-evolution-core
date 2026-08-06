// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression test for F4-004 at the level that actually matters: the process must
// still be there afterwards.
//
// Before the fix, one authenticated POST /api/v1/chat/stream with the `content` field
// missing terminated the whole service. The unit tests next door prove the ordering
// inside the orchestrator; this one proves the observable consequence by driving a
// real server in a child process and checking it is still answering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../src/auth-crypto.mjs';

const serverPath = resolve(fileURLToPath(new URL('../src/server.mjs', import.meta.url)));

function call(port, method, path, { body, cookie, csrf, headers = {} } = {}) {
  return new Promise((res, rej) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const out = { ...headers };
    if (payload) { out['content-type'] = 'application/json'; out['content-length'] = String(payload.length); }
    if (cookie) out.cookie = cookie;
    if (csrf) out['x-noesar-csrf'] = csrf;
    const req = request({ host: '127.0.0.1', port, method, path, headers: out }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        res({ status: r.statusCode, headers: r.headers, text, json });
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
    req.on('error', rej);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForLive(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await call(port, 'GET', '/livez');
      if (res.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('a malformed chat stream request does not take the service down', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-survive-'));
  const port = 8200 + Number(process.hrtime.bigint() % 300n);
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      NOESAR_WORKSPACE: workspace,
      NOESAR_PORT: String(port),
      NOESAR_HOST: '127.0.0.1',
      NOESAR_SETUP_TOKEN_FILE: join(workspace, 'config', 'setup.token'),
      NOESAR_LOG_LEVEL: 'ERROR',
      NOESAR_WATCHDOG_INTERVAL_MS: '600000',
      // Inside this test's own temp workspace, like every other path here. Without it the
      // spawned server binds the PRODUCTION default (/run/codev-peer.sock) on the machine
      // running the suite — measured in s326, inode 588147 → 588957 on this host. Harmless
      // in a container, where /run is private; on a native install that path is the running
      // product's terminal transport. Guarded by socket-path-isolation.test.mjs.
      NOESAR_CODEV_PEER_SOCKET_PATH: join(workspace, 'codev-peer.sock'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

  try {
    assert.equal(await waitForLive(port), true, 'the child server never became live');

    // Bootstrap an owner so the request is authenticated exactly as a real one is.
    const token = readFileSync(join(workspace, 'config', 'setup.token'), 'utf8').trim();
    const begun = await call(port, 'POST', '/api/v1/auth/setup', {
      body: { username: 'survival-owner', password: 'survival-passphrase-long-enough' },
      headers: { 'x-noesar-setup-token': token },
    });
    assert.equal(begun.status, 201, begun.text);
    const confirmed = await call(port, 'POST', '/api/v1/auth/setup/confirm', {
      body: { challenge: begun.json.challenge, totpCode: totpCode(begun.json.totpSecret) },
    });
    assert.equal(confirmed.status, 201, confirmed.text);
    const cookies = (confirmed.headers['set-cookie'] ?? []).map((line) => line.split(';')[0]);
    const cookie = cookies.join('; ');
    const csrf = cookies.find((c) => c.startsWith('noesar_csrf='))?.split('=')[1];

    const project = await call(port, 'POST', '/api/v1/projects', { body: { name: 'survival' }, cookie, csrf });
    const conversation = await call(port, 'POST', '/api/v1/conversations', { body: { projectId: project.json.id, title: 'c', mode: 'ASK' }, cookie, csrf });
    const conversationId = conversation.json.conversation.id;
    const provider = await call(port, 'POST', '/api/v1/providers', {
      body: { type: 'custom-openai-compatible', name: 'dead', external: false, baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'x' }, cookie, csrf,
    });
    await call(port, 'PATCH', `/api/v1/providers/${provider.json.id}`, { body: { enabled: true }, cookie, csrf });

    // The exact shape that used to be fatal: no `content` field.
    const bad = await call(port, 'POST', '/api/v1/chat/stream', { body: { conversationId, providerId: provider.json.id, mode: 'ASK' }, cookie, csrf });
    assert.ok(bad.status >= 400 && bad.status < 500, `expected a 4xx for malformed input, got ${bad.status} ${bad.text.slice(0, 200)}`);

    // The point of the test.
    assert.equal(child.exitCode, null, `the server process exited (code ${child.exitCode}); stderr: ${stderr.join('').slice(0, 600)}`);
    const alive = await call(port, 'GET', '/livez');
    assert.equal(alive.status, 200, 'the server stopped answering after the malformed request');

    // And a well-formed request still works afterwards.
    const good = await call(port, 'POST', '/api/v1/chat/stream', { body: { conversationId, providerId: provider.json.id, mode: 'ASK', content: 'hello' }, cookie, csrf });
    assert.equal(good.status, 200, 'a valid stream request must still be served');
    assert.match(good.text, /event: (run|error)/, 'the stream must carry SSE frames');
    assert.equal(child.exitCode, null, 'the server must survive a failing provider too');
  } finally {
    child.kill('SIGKILL');
    rmSync(workspace, { recursive: true, force: true });
  }
});
