// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Success-path coverage for ProviderGateway — the rule behind F4-005 and F4-006.
//
// Both defects were an object-literal shorthand naming an identifier that did not exist
// in scope. Neither was a subtle logic error: each one throws a ReferenceError the very
// first time the line executes. They survived because every delivered test exercised a
// *failure* path (unreachable provider, missing consent, disabled profile) and never a
// success, so those lines had never run.
//
// This file therefore drives every public method of the gateway to completion against a
// local mock upstream. It is coverage as a guard rail: if a future edit introduces the
// same class of mistake anywhere in the happy path, a test here stops it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ProviderGateway } from '../src/ai-workspace/provider-gateway.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';

/** An OpenAI-compatible endpoint that answers /models, /chat/completions and a stream. */
function upstream() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let payload = {};
      try { payload = JSON.parse(body); } catch { /* /models has no body */ }
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      }
      if (payload.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'alpha ' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'beta' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'complete reply' } }], usage: { total_tokens: 9 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function fixture(port) {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-gateway-success-'));
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  const vault = new CredentialVault({ keyPath: join(dir, 'provider.key') });
  const ledger = { entries: [], append(entry) { this.entries.push(entry); } };
  const gateway = new ProviderGateway({ store, vault, ledger });
  const profile = gateway.create({ type: 'custom-openai-compatible', name: 'mock', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'mock-model' });
  gateway.update(profile.id, { enabled: true });
  return { dir, store, vault, ledger, gateway, profileId: profile.id };
}

const messages = [{ role: 'user', content: 'hello' }];

test('probe completes and names the profile it probed', async () => {
  const { server, port } = await upstream();
  const f = fixture(port);
  try {
    const result = await f.gateway.probe(f.profileId);
    assert.equal(result.status, 'healthy');
    assert.equal(result.providerId, f.profileId);
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('complete returns text and records the provider it used', async () => {
  const { server, port } = await upstream();
  const f = fixture(port);
  try {
    const result = await f.gateway.complete(f.profileId, { messages, actorId: 'tester' });
    assert.equal(result.text, 'complete reply');
    assert.ok(result.provider ?? result.providerId, 'the result must identify the provider');
    assert.ok(f.ledger.entries.some((e) => e.action === 'provider.complete'));
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('stream yields every delta to completion', async () => {
  const { server, port } = await upstream();
  const f = fixture(port);
  try {
    const deltas = [];
    for await (const delta of f.gateway.stream(f.profileId, { messages, actorId: 'tester' })) deltas.push(delta);
    assert.deepEqual(deltas.join(''), 'alpha beta');
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('streamWithFallback yields deltas tagged with the provider that produced them', async () => {
  const { server, port } = await upstream();
  const f = fixture(port);
  try {
    const events = [];
    for await (const event of f.gateway.streamWithFallback([f.profileId], { messages, actorId: 'tester' })) events.push(event);
    assert.ok(events.length >= 2, `expected several deltas, got ${events.length}`);
    assert.equal(events.map((e) => e.delta).join(''), 'alpha beta');
    for (const event of events) {
      assert.equal(event.providerId, f.profileId, 'each delta must carry the id of the provider that produced it');
    }
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('streamWithFallback falls through a dead provider to a working one and reports both', async () => {
  const { server, port } = await upstream();
  const f = fixture(port);
  try {
    const dead = f.gateway.create({ type: 'custom-openai-compatible', name: 'dead', external: false, apiStyle: 'openai-chat', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'x' });
    f.gateway.update(dead.id, { enabled: true });
    const events = [];
    for await (const event of f.gateway.streamWithFallback([dead.id, f.profileId], { messages, actorId: 'tester' })) events.push(event);
    assert.equal(events.map((e) => e.delta).join(''), 'alpha beta');
    assert.equal(new Set(events.map((e) => e.providerId)).size, 1, 'all deltas came from the surviving provider');
    assert.equal(events[0].providerId, f.profileId);
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('when every provider fails the error names each one', async () => {
  const f = fixture(1);
  try {
    const deadA = f.gateway.create({ type: 'custom-openai-compatible', name: 'dead-a', external: false, apiStyle: 'openai-chat', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'x' });
    const deadB = f.gateway.create({ type: 'custom-openai-compatible', name: 'dead-b', external: false, apiStyle: 'openai-chat', baseUrl: 'http://127.0.0.1:2/v1', defaultModel: 'x' });
    f.gateway.update(deadA.id, { enabled: true });
    f.gateway.update(deadB.id, { enabled: true });
    await assert.rejects(async () => {
      // eslint-disable-next-line no-empty
      for await (const _ of f.gateway.streamWithFallback([deadA.id, deadB.id], { messages })) { /* never reached */ }
    }, (error) => {
      // The failure summary interpolates each failed provider id; before the fix this
      // line threw a ReferenceError of its own instead of reporting anything.
      assert.match(error.message, /All streaming providers failed/);
      assert.ok(error.message.includes(deadA.id), 'the first failed provider must be named');
      assert.ok(error.message.includes(deadB.id), 'the second failed provider must be named');
      return true;
    });
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('compare returns one result per provider', async () => {
  const { server, port } = await upstream();
  const f = fixture(port);
  try {
    const second = f.gateway.create({ type: 'custom-openai-compatible', name: 'mock-2', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'mock-model' });
    f.gateway.update(second.id, { enabled: true });
    const result = await f.gateway.compare([f.profileId, second.id], { messages, actorId: 'tester' });
    assert.equal(result.results.length, 2);
    for (const item of result.results) {
      assert.equal(item.status, 'fulfilled', JSON.stringify(item));
      assert.ok(item.providerId, 'each comparison row must name its provider');
    }
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('catalog, list, get, route, credential and consent all complete', async () => {
  const { server, port } = await upstream();
  const f = fixture(port);
  try {
    assert.ok(f.gateway.catalog().length >= 4);
    assert.ok(f.gateway.list().length >= 1);
    assert.equal(f.gateway.get(f.profileId).id, f.profileId);
    assert.deepEqual(f.gateway.route({ requestedProviderId: f.profileId }), [f.profileId]);
    assert.ok(f.gateway.route({ mode: 'ASK' }).includes(f.profileId));
    const set = f.gateway.setCredential(f.profileId, 'synthetic-key-not-a-real-secret', { persistence: 'persistent' });
    assert.equal(set.credentialConfigured, true);
    assert.equal(Object.hasOwn(set, 'encryptedCredential') && set.encryptedCredential !== undefined, false, 'the ciphertext must never be returned');
    const cleared = f.gateway.clearCredential(f.profileId);
    assert.equal(cleared.credentialConfigured, false);
    assert.ok(f.gateway.ensureDefaults().length >= 1);
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a connection the upstream has already closed is retried once, not surfaced as an error', async () => {
  // Reproduces F4-009. The server accepts the first connection, answers, and then closes
  // its keep-alive socket aggressively — which is what every real provider does after its
  // idle timeout. Without the retry the next request fails with UND_ERR_SOCKET "other side
  // closed" and the operator sees an unexplained "fetch failed".
  const dir = mkdtempSync(join(tmpdir(), 'noesar-stale-'));
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push(req.url);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'reply' } }] }));
    });
  });
  server.keepAliveTimeout = 1;   // close the socket almost immediately after each response
  server.headersTimeout = 5_000;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const store = new AtomicJsonStore(join(dir, 'state.json'));
    const vault = new CredentialVault({ keyPath: join(dir, 'p.key') });
    const gateway = new ProviderGateway({ store, vault, ledger: { append() {} } });
    const profile = gateway.create({ type: 'custom-openai-compatible', name: 'flaky', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'x' });
    gateway.update(profile.id, { enabled: true });

    // Several sequential calls with a pause between them: each one is likely to pick up a
    // socket the server has just closed.
    for (let i = 0; i < 4; i += 1) {
      const result = await gateway.complete(profile.id, { messages: [{ role: 'user', content: `turn ${i}` }] });
      assert.equal(result.text, 'reply', `turn ${i} failed`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    assert.ok(seen.length >= 4, `the upstream should have been reached at least four times, saw ${seen.length}`);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});
