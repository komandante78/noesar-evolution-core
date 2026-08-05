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
      const request = {
        path: req.url,
        token: req.headers['x-atom-token'],
        session: req.headers['x-atom-session'],
        body: body ? JSON.parse(body) : null,
      };
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

/**
 * The same installation, with phase 6's declared fallback turned off.
 *
 * Four tests below draw a distinction that is still exactly right and still worth guarding —
 * unreachable is NOT a refusal, and a non-200 is the transport rather than the contract — but
 * they were written when an unavailable provider always ended the call, so they measured the
 * classification THROUGH the raise. Since `D-0312` the default is to carry on and declare it,
 * which would make them fail for the one reason that is not a defect: the product doing what
 * the Owner asked. They keep asserting the classification here, where the raise still happens;
 * the default-configuration behaviour is measured by the test that follows the `simulate` one
 * and by `atom-fallback-declared.test.mjs`, so both the old distinction and the new behaviour
 * have something that fails when they break.
 */
const strict = (endpoint, extra = {}) => envFor(endpoint, { NOESAR_ATOM_FALLBACK: 'off', ...extra });

test('with no configuration every surface is the reference provider', async () => {
  const routing = routingFrom({});
  assert.equal(routing.externalSelected, false);
  assert.deepEqual(routing.externalSurfaces, []);

  const router = new ReasoningRouter({ env: {} });
  const intent = await router.interpret('Repair the parser', []);
  assert.ok(intent.goal);
  assert.deepEqual(router.provenance(), [{ surface: 'interpret', provider: 'reference' }]);
});

// The literal list is repeated on purpose: comparing the routing only against the constant it
// is built from would pass whatever that constant became. This test exists so that changing
// the default has to be a decision somebody took — and it did exactly that when `simulate`
// was added to it.
test('the default routing is the surfaces the design names, and nothing else', async () => {
  const routing = routingFrom(envFor('http://127.0.0.1:1'));
  assert.deepEqual([...routing.externalSurfaces], [...DEFAULT_EXTERNAL_SURFACES]);
  assert.deepEqual([...routing.externalSurfaces], ['decompose', 'expect', 'simulate']);
});

test('the reference provider answers simulate with the shape a real one uses', async () => {
  const router = new ReasoningRouter({ workspaceRoot: '/workspace', env: {} });
  const outcome = await router.simulate({ steps: [], constraints: [], mode: 'safe' }, '/nowhere');
  // `supported: false` is the answer. What matters is that a caller reads one shape either
  // way: the earlier `{ supported, surface }` meant a consumer written against a real
  // provider's `predictedDiff` would have read `undefined` and reported it as empty.
  assert.equal(outcome.supported, false);
  assert.deepEqual(outcome.predictedDiff, []);
  assert.equal(outcome.executed, false);
  assert.deepEqual(router.provenance(), [{ surface: 'simulate', provider: 'reference' }]);
});

test('simulate is routed to the external provider, with the shadow path it must read', async () => {
  const stub = await stubProvider(() => ({
    status: 200,
    payload: { ok: true, value: { supported: true, predictedDiff: ['M src/x.rs'], predictedResult: 'one file modified', executed: false } },
  }));
  try {
    const router = new ReasoningRouter({ workspaceRoot: '/workspace', env: envFor(stub.endpoint) });
    const outcome = await router.simulate({ steps: [], constraints: [], mode: 'safe' }, '/shadows/run-1');
    assert.equal(outcome.supported, true);
    assert.deepEqual(outcome.predictedDiff, ['M src/x.rs']);
    // A provider predicts by reading a directory, so the path is the payload's whole point:
    // sending the plan without it would be a request nobody could answer.
    assert.equal(stub.seen.at(-1).path, '/v1/simulate');
    assert.equal(stub.seen.at(-1).body.shadowWorkspace, '/shadows/run-1');
    assert.deepEqual(router.provenance(), [{ surface: 'simulate', provider: 'atom' }]);
  } finally { stub.close(); }
});

test('a provider that cannot read the shadow refuses, and a refusal is not a prediction', async () => {
  const stub = await stubProvider(() => ({
    status: 200,
    payload: { ok: false, error: { kind: 'REFUSED', reason: 'the shadow workspace could not be read' } },
  }));
  try {
    const router = new ReasoningRouter({ workspaceRoot: '/workspace', env: envFor(stub.endpoint) });
    await assert.rejects(
      () => router.simulate({ steps: [], constraints: [], mode: 'safe' }, '/definitely/not/here'),
      (error) => error instanceof ReasoningRefused,
    );
    // The refusal is still an answer and its author is still the one who answered, otherwise
    // a refused simulation would read as though nobody had been asked.
    assert.deepEqual(router.provenance(), [{ surface: 'simulate', provider: 'atom' }]);
  } finally { stub.close(); }
});

test('an unreachable provider makes simulate unavailable, never `supported: false`', async () => {
  const router = new ReasoningRouter({ workspaceRoot: '/workspace', env: strict('http://127.0.0.1:1') });
  // The dangerous confusion: reporting the reference provider's honest "I cannot simulate"
  // for a selected provider that was simply not there. They are indistinguishable to a reader
  // and mean opposite things about whether simulation is possible at all.
  await assert.rejects(
    () => router.simulate({ steps: [], constraints: [], mode: 'safe' }, '/shadows/run-1'),
    (error) => error instanceof ReasoningUnavailable,
  );
});

test('a DEGRADED simulate is still distinguishable from the reference provider\'s honest answer', async () => {
  // The same dangerous confusion the strict test above names, in the configuration that is now
  // the default. Since phase 6 the reference provider DOES answer when ATOM is unreachable, so
  // `supported:false` genuinely comes back — and the fact that must survive is that a reader
  // can still tell "nothing can simulate" from "the thing that could was not there".
  const router = new ReasoningRouter({ workspaceRoot: '/workspace', env: envFor('http://127.0.0.1:1') });
  const outcome = await router.simulate({ steps: [], constraints: [], mode: 'safe' }, '/shadows/run-1');

  assert.equal(outcome.supported, false, 'the work did not carry on');
  assert.equal(router.degraded, true, 'this reads exactly like an installation that never selected a provider');
  const [record] = router.degradations();
  assert.equal(record.surface, 'simulate');
  assert.equal(record.requestedProvider, 'atom');
  assert.match(record.reason, /could not be reached/);
  assert.equal(router.provenance()[0].degraded, true);
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
  const router = new ReasoningRouter({ env: strict('http://127.0.0.1:1') });
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
      const router = new ReasoningRouter({ env: strict(stub.endpoint) });
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
      const router = new ReasoningRouter({ env: strict(stub.endpoint) });
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

// Sessions. `fixtures` is the surface that cannot work without one: an external provider
// asked with no session has no recording to hand back, and before the session header
// existed that was every request atomd ever saw. Measured live 2026-07-29: 11/12 surfaces
// answered and only `fixtures` refused; with a session it is 12/12.
test('a session id travels as a transport header, never in the body', async () => {
  const stub = await stubProvider(() => ({ status: 200, payload: { ok: true, value: { kind: 'UNSUPPORTED_INFERENCE', rationale: 'x', sources: [] } } }));
  try {
    const router = new ReasoningRouter({ env: envFor(stub.endpoint, { NOESAR_EXTERNAL_SURFACES: 'evidence' }), sessionId: 'run-42' });
    assert.equal(router.sessionId, 'run-42');
    await router.evidence('a claim');
    const seen = stub.seen.at(-1);
    assert.equal(seen.session, 'run-42', 'the daemon selects the recorder by this header');
    // The bodies are the frozen contract's shapes and are checked by the shared wire
    // vectors; smuggling a session into one would make the oracle express something the
    // reasoning contract does not have.
    assert.equal('sessionId' in seen.body, false, 'the session must not appear in the body');
  } finally { stub.close(); }
});

test('with no session named, no session header is sent at all', async () => {
  const stub = await stubProvider(() => ({ status: 200, payload: { ok: true, value: { kind: 'UNSUPPORTED_INFERENCE', rationale: 'x', sources: [] } } }));
  try {
    const router = new ReasoningRouter({ env: envFor(stub.endpoint, { NOESAR_EXTERNAL_SURFACES: 'evidence' }) });
    assert.equal(router.sessionId, null);
    await router.evidence('a claim');
    assert.equal(stub.seen.at(-1).session, undefined,
      'a blank header would name a session called "", which is not the same as naming none');
  } finally { stub.close(); }
});
