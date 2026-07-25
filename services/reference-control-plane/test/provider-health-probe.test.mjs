// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression test for F4-005 (Phase 4 acceptance).
//
// ProviderGateway.probe() built its success value from an identifier that was never
// declared (`providerId` instead of the parameter `profileId`). In an ES module that is
// a ReferenceError, so the health check answered 500 for every provider that was
// actually reachable, while an unreachable provider answered a well-formed 502. The
// delivered tests only ever exercised the failure path, which is why it survived.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ProviderGateway } from '../src/ai-workspace/provider-gateway.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-probe-'));
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  const vault = new CredentialVault({ keyPath: join(dir, 'provider.key') });
  return { dir, store, gateway: new ProviderGateway({ store, vault }) };
}

/** A minimal endpoint that answers the /models call a health probe makes. */
function upstream(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('a reachable provider reports healthy and echoes its own profile id', async () => {
  const f = fixture();
  const { server, port } = await upstream((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'model-one' }, { id: 'model-two' }] }));
  });
  try {
    const profile = f.gateway.create({ type: 'custom-openai-compatible', name: 'reachable', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1` });
    f.gateway.update(profile.id, { enabled: true });
    const result = await f.gateway.probe(profile.id);
    assert.equal(result.status, 'healthy');
    assert.equal(result.providerId, profile.id, 'the probe must report which profile it probed');
    assert.deepEqual(result.models, ['model-one', 'model-two']);
    assert.ok(Number.isFinite(result.latencyMs));
  } finally {
    server.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('an upstream error is still reported as a 502, not as an internal failure', async () => {
  const f = fixture();
  const { server, port } = await upstream((req, res) => { res.writeHead(503); res.end('{}'); });
  try {
    const profile = f.gateway.create({ type: 'custom-openai-compatible', name: 'sick', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1` });
    f.gateway.update(profile.id, { enabled: true });
    await assert.rejects(() => f.gateway.probe(profile.id), (error) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /health check failed \(503\)/);
      return true;
    });
  } finally {
    server.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a disabled provider is refused before any network call', async () => {
  const f = fixture();
  try {
    // Port 1 is not listening: if the gate were skipped the failure would be a
    // connection error, not a 403.
    const profile = f.gateway.create({ type: 'custom-openai-compatible', name: 'off', external: false, apiStyle: 'openai-chat', baseUrl: 'http://127.0.0.1:1/v1' });
    await assert.rejects(() => f.gateway.probe(profile.id), (error) => {
      assert.equal(error.status, 403);
      assert.match(error.message, /disabled/);
      return true;
    });
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
