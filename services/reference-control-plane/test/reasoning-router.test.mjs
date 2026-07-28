// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Selecting a provider per surface, and the three outcomes an external one can produce.
//
// The case that matters most is the third: an external provider that is unavailable must not
// be answered by quietly using the reference one. A test suite that only proves the happy
// path would let that regress without a single red line.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { ReasoningRouter, routingFrom, DEFAULT_EXTERNAL_SURFACES } from '../src/reasoning-router.mjs';
import { ReasoningUnavailable } from '../src/atom-client.mjs';
import { ReasoningRefused } from '../src/reasoning.mjs';

/** A stand-in for any provider that satisfies the boundary. Records what it was asked. */
async function stubProvider(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const request = { path: req.url, token: req.headers['x-atom-token'], body: body ? JSON.parse(body) : null };
      seen.push(request);
      const { status, payload } = handler(request);
      const text = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { endpoint: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

function envFor(endpoint, extra = {}) {
  return {
    NOESAR_REASONING_MODE: 'rust-external',
    NOESAR_RUST_REASONING_ENDPOINT: endpoint,
    NOESAR_RUST_REASONING_TOKEN: 'a-token-long-enough-for-the-daemon',
    ...extra,
  };
}

test('with no configuration every surface is the reference provider', async () => {
  const routing = routingFrom({});
  assert.equal(routing.externalSelected, false);
  assert.deepEqual(routing.externalSurfaces, []);

  const router = new ReasoningRouter({ env: {} });
  const intent = await router.interpret('Repair the parser', []);
  assert.ok(intent.goal);
  assert.deepEqual(router.provenance(), [{ surface: 'interpret', provider: 'reference' }]);
});

test('the default routing is the two surfaces the design names, and nothing else', async () => {
  const routing = routingFrom(envFor('http://127.0.0.1:1'));
  assert.deepEqual([...routing.externalSurfaces], [...DEFAULT_EXTERNAL_SURFACES]);
  assert.deepEqual([...routing.externalSurfaces], ['decompose', 'expect']);
});

test('an external provider is selected only for its surfaces, and provenance says so', async () => {
  const stub = await stubProvider(() => ({
    status: 200,
    payload: { ok: true, value: { testsExpectedToPass: ['cargo test'], testsExpectedToFail: [], pathsTheDiffMustTouch: ['src/a.rs'] } },
  }));
  try {
    const router = new ReasoningRouter({ env: envFor(stub.endpoint) });
    const intent = await router.interpret('Repair src/a.rs', []);
    const plan = router.buildPlan(
      [{ id: 'step-1', description: 'd', files: ['src/a.rs'], commands: ['cargo test'], dependsOn: [], blastRadius: router.blastRadius(['src/a.rs'], false) }],
      [], 'safe',
    );
    const expectation = await router.expect(plan);

    assert.ok(intent.goal);
    assert.deepEqual(expectation.pathsTheDiffMustTouch, ['src/a.rs']);
    assert.deepEqual(router.provenance(), [
      { surface: 'interpret', provider: 'reference' },
      { surface: 'expect', provider: 'atom' },
    ]);
    assert.equal(stub.seen.length, 1, 'only the routed surface leaves this process');
    assert.equal(stub.seen[0].path, '/v1/expect');
    assert.equal(stub.seen[0].token, 'a-token-long-enough-for-the-daemon');
  } finally {
    stub.close();
  }
});

test('an unreachable external provider is reported, never replaced by the reference one', async () => {
  // Port 1 on loopback refuses immediately: unreachable without waiting for a timeout.
  const router = new ReasoningRouter({ env: envFor('http://127.0.0.1:1') });
  const plan = router.buildPlan(
    [{ id: 'step-1', description: 'd', files: ['src/a.rs'], commands: ['cargo test'], dependsOn: [], blastRadius: router.blastRadius(['src/a.rs'], false) }],
    [], 'safe',
  );
  await assert.rejects(
    () => router.expect(plan),
    (error) => {
      assert.ok(error instanceof ReasoningUnavailable, `expected unavailable, got ${error?.name}`);
      assert.ok(!(error instanceof ReasoningRefused), 'unreachable is not a refusal');
      assert.equal(error.surface, 'expect');
      return true;
    },
  );
  assert.deepEqual(router.provenance(), [], 'a provider that did not answer did not answer');
});

test('a refusal from the external provider stays a refusal, and is attributed to it', async () => {
  const stub = await stubProvider(() => ({
    status: 200,
    payload: { ok: false, error: { kind: 'REFUSED', reason: 'step(s) a would produce nothing observable' } },
  }));
  try {
    const router = new ReasoningRouter({ env: envFor(stub.endpoint) });
    const plan = router.buildPlan(
      [{ id: 'a', description: 'd', files: [], commands: [], dependsOn: [], blastRadius: router.blastRadius([], false) }],
      [], 'safe',
    );
    await assert.rejects(() => router.expect(plan), ReasoningRefused);
    assert.deepEqual(router.provenance(), [{ surface: 'expect', provider: 'atom' }]);
  } finally {
    stub.close();
  }
});

test('a provider that fails is not a provider that refused', async () => {
  for (const payload of [
    { ok: false, error: { kind: 'INTERNAL', reason: 'it broke' } },
    { ok: true },
    { value: 'no ok field' },
  ]) {
    const stub = await stubProvider(() => ({ status: 200, payload }));
    try {
      const router = new ReasoningRouter({ env: envFor(stub.endpoint) });
      const plan = router.buildPlan(
        [{ id: 'a', description: 'd', files: ['x'], commands: [], dependsOn: [], blastRadius: router.blastRadius(['x'], false) }],
        [], 'safe',
      );
      await assert.rejects(() => router.expect(plan), ReasoningUnavailable, JSON.stringify(payload));
    } finally {
      stub.close();
    }
  }
});

test('a non-200 means the request never reached the contract, so it is unavailable not refused', async () => {
  for (const status of [401, 404, 500]) {
    const stub = await stubProvider(() => ({
      status,
      payload: { ok: false, error: { kind: 'BAD_REQUEST', reason: `status ${status}` } },
    }));
    try {
      const router = new ReasoningRouter({ env: envFor(stub.endpoint) });
      await assert.rejects(
        () => router.decompose({ id: 'a', files: ['x'], commands: [], blastRadius: router.blastRadius(['x'], false) }),
        ReasoningUnavailable,
        `status ${status}`,
      );
    } finally {
      stub.close();
    }
  }
});

test('a surface named in the environment that the contract does not have is reported', () => {
  const routing = routingFrom(envFor('http://127.0.0.1:1', { NOESAR_EXTERNAL_SURFACES: 'expect,imagine' }));
  assert.deepEqual([...routing.externalSurfaces], ['expect']);
  assert.deepEqual([...routing.unknownSurfaces], ['imagine'], 'a typo must not vanish');
});

test('selecting an external provider without an endpoint routes nothing and says why', () => {
  const routing = routingFrom({ NOESAR_REASONING_MODE: 'rust-external' });
  assert.equal(routing.externalSelected, true);
  assert.equal(routing.endpointMissing, true);
  assert.deepEqual([...routing.externalSurfaces], [], 'nothing is routed to an endpoint that is not there');
});

test('the boundary vectors are present and name only surfaces the client knows', async () => {
  const { readFileSync } = await import('node:fs');
  const url = new URL('../../../conformance/reasoning-wire-vectors.json', import.meta.url);
  const file = JSON.parse(readFileSync(url, 'utf8'));
  assert.ok(file.cases.length >= 18, 'the oracle must not quietly shrink');
  const { EXTERNAL_SURFACES } = await import('../src/atom-client.mjs');
  for (const item of file.cases) {
    if (item.method !== 'POST' || !item.path.startsWith('/v1/')) continue;
    const surface = item.path.slice('/v1/'.length);
    if (surface === 'imagine') continue; // the deliberate unknown-surface case
    assert.ok(EXTERNAL_SURFACES.includes(surface), `${item.id}: unknown surface \`${surface}\``);
  }
});
