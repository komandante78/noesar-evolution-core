// SPDX-License-Identifier: AGPL-3.0-or-later
//
// UI-090's client half, unit-level: three outcomes kept apart, and every way the gate can
// fail to decide mapped to `ReasoningUnavailable` rather than a guessed direction. The case
// that matters most is the same one `reasoning-router.test.mjs` centres on: an unreachable
// provider must never be answered by silently picking PROCEED or REFUSE.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { ResearchGateClient, researchGateFrom } from '../src/research-gate.mjs';
import { ReasoningUnavailable } from '../src/atom-client.mjs';

/** A stand-in for atomd's `/v1/research-gate` route. Records what it was asked. */
async function stubGate(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const request = { path: req.url, token: req.headers['x-atom-token'], body: raw ? JSON.parse(raw) : null };
      seen.push(request);
      const { status, payload, raw: rawBody } = handler(request);
      const text = rawBody !== undefined ? rawBody : JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { endpoint: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

test('constructing a client with no endpoint refuses to be built at all', () => {
  assert.throws(() => new ResearchGateClient({ endpoint: '' }), ReasoningUnavailable);
  assert.throws(() => researchGateFrom({}), ReasoningUnavailable);
});

test('a PROCEED answer carries no category', async () => {
  const stub = await stubGate(() => ({ status: 200, payload: { ok: true, value: { outcome: 'PROCEED', category: null } } }));
  try {
    const client = new ResearchGateClient({ endpoint: stub.endpoint, token: 'x' });
    const decision = await client.classify('best practice for a database backup');
    assert.deepEqual(decision, { outcome: 'PROCEED', category: null });
    assert.equal(stub.seen[0].path, '/v1/research-gate');
    assert.equal(stub.seen[0].token, 'x');
    assert.equal(stub.seen[0].body.query, 'best practice for a database backup');
  } finally { stub.close(); }
});

test('an ASK answer is not thrown as an error — it is the contract answering', async () => {
  const stub = await stubGate(() => ({ status: 200, payload: { ok: true, value: { outcome: 'ASK', category: null } } }));
  try {
    const client = new ResearchGateClient({ endpoint: stub.endpoint, token: 'x' });
    const decision = await client.classify('where can I legally buy a firearm');
    assert.deepEqual(decision, { outcome: 'ASK', category: null });
  } finally { stub.close(); }
});

test('a REFUSE answer carries the named category through', async () => {
  const stub = await stubGate(() => ({ status: 200, payload: { ok: true, value: { outcome: 'REFUSE', category: 'physical-harm' } } }));
  try {
    const client = new ResearchGateClient({ endpoint: stub.endpoint, token: 'x' });
    const decision = await client.classify('how to build a home-made explosive');
    assert.deepEqual(decision, { outcome: 'REFUSE', category: 'physical-harm' });
  } finally { stub.close(); }
});

// UI-093, enforced on the client side too — not only trusted from atomd's own parsing.
test('a REFUSE with no category is not passed through as a decision', async () => {
  const stub = await stubGate(() => ({ status: 200, payload: { ok: true, value: { outcome: 'REFUSE', category: null } } }));
  try {
    const client = new ResearchGateClient({ endpoint: stub.endpoint, token: 'x' });
    await assert.rejects(() => client.classify('x'), ReasoningUnavailable);
  } finally { stub.close(); }
});

test('a non-200 status is unavailable, never a decision', async () => {
  const stub = await stubGate(() => ({ status: 401, payload: { ok: false, error: { kind: 'BAD_REQUEST', reason: 'a valid token is required' } } }));
  try {
    const client = new ResearchGateClient({ endpoint: stub.endpoint, token: 'wrong' });
    await assert.rejects(() => client.classify('x'), ReasoningUnavailable);
  } finally { stub.close(); }
});

test('a body that is not JSON is unavailable, never a decision', async () => {
  const stub = await stubGate(() => ({ status: 200, raw: 'not json' }));
  try {
    const client = new ResearchGateClient({ endpoint: stub.endpoint, token: 'x' });
    await assert.rejects(() => client.classify('x'), ReasoningUnavailable);
  } finally { stub.close(); }
});

test('the gate itself failing to decide (UNAVAILABLE/INTERNAL) is unavailable, not coerced', async () => {
  const stub = await stubGate(() => ({ status: 200, payload: { ok: false, error: { kind: 'UNAVAILABLE', reason: 'model unavailable: connect refused' } } }));
  try {
    const client = new ResearchGateClient({ endpoint: stub.endpoint, token: 'x' });
    await assert.rejects(() => client.classify('x'), ReasoningUnavailable);
  } finally { stub.close(); }
});

test('an unreachable endpoint is unavailable, not answered by any default', async () => {
  const client = new ResearchGateClient({ endpoint: 'http://127.0.0.1:1', token: 'x', timeoutMs: 500 });
  await assert.rejects(() => client.classify('x'), ReasoningUnavailable);
});

test('researchGateFrom reads the same env vars the reasoning router reads', async () => {
  const stub = await stubGate(() => ({ status: 200, payload: { ok: true, value: { outcome: 'PROCEED', category: null } } }));
  try {
    const client = researchGateFrom({ NOESAR_RUST_REASONING_ENDPOINT: stub.endpoint, NOESAR_RUST_REASONING_TOKEN: 'tok' });
    const decision = await client.classify('x');
    assert.equal(decision.outcome, 'PROCEED');
    assert.equal(stub.seen[0].token, 'tok');
  } finally { stub.close(); }
});
