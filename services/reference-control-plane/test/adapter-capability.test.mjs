// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-005 (03_ARCHITETTURA.md §4): "no adapter may grant itself a permission — a
// manifest is a request, the engine issues the tokens." These are the orchestrator-level
// tests; local-model-runtime.test.mjs covers the adapter side (what happens to launch()
// itself), and adapter-capability-http-adversarial.test.mjs covers the same claim through
// real HTTP routes with a real session.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenMinter } from '../src/capability.mjs';
import {
  AdapterGrantOrchestrator, AdapterCapabilityError, ADAPTER_MANIFESTS, adapterCapabilityStatus,
} from '../src/adapter-capability.mjs';

function fresh() {
  const minter = new TokenMinter(Buffer.alloc(32, 3));
  return { minter, grants: new AdapterGrantOrchestrator({ minter }) };
}

// What `noesar-sandbox --detect` reports on a real host, shape and all — the ceiling
// server.mjs hands the minter when NOESAR_EXECUTE_SANDBOX is enabled. Two dimensions are
// `null` (unconstrained by the container) and one is `0`, which is a real and very
// restrictive limit: a fixture that tidied either away would not be this ceiling.
const CONTAINER_CEILING = Object.freeze({
  memoryBytes: 12884901888, cpuSeconds: null, openFiles: 40960,
  processes: 127784, fileSizeBytes: null, coreDumpBytes: 0,
});

// ARCH-008 / D-0248, the half that only meets on an installation with the sandbox ON.
// Measured before the fix: with no ceiling the grant is minted, with one it is refused —
// so enabling the execute sandbox made every model impossible to start, and the refusal
// named capability limits rather than the switch that had caused it. The two assertions are
// one test on purpose: the property is that the ANSWER IS THE SAME either way, and a test
// that only checked the enforcing installation would pass on a build that had stopped
// enforcing anything.
test('a model launch can be granted on an installation that enforces isolation limits, and on one that does not', () => {
  const now = Math.floor(Date.now() / 1000);
  for (const ceiling of [null, CONTAINER_CEILING]) {
    const minter = new TokenMinter(Buffer.alloc(32, 3), { ceiling });
    const grants = new AdapterGrantOrchestrator({ minter, executeLimits: ceiling });
    const requested = grants.request({
      resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'owner', nowUnix: now,
    });
    const approved = grants.approve({ runId: requested.runId, approverId: 'owner', nowUnix: now });
    assert.equal(approved.operation, 'EXECUTE');
    assert.ok(approved.token.id, `no token minted with ceiling=${Boolean(ceiling)}`);
    // The envelope travels inside the token's MAC, so nothing between minting and spending
    // can widen it — and it is absent exactly where nothing enforces one.
    if (ceiling) assert.deepEqual(approved.token.limits, ceiling);
    else assert.ok(!approved.token.limits);
  }
});

// The other direction, and the one that keeps this from becoming a way to widen a grant: an
// envelope the approved plan never granted must not reach a token. `withinGrant` is the rule
// doing the refusing, and this proves it is still in the path after the change above.
test('a token may not carry an envelope wider than the plan granted', () => {
  const now = Math.floor(Date.now() / 1000);
  const minter = new TokenMinter(Buffer.alloc(32, 3), { ceiling: CONTAINER_CEILING });
  const grants = new AdapterGrantOrchestrator({ minter, executeLimits: { memoryBytes: 64 * 1024 * 1024, cpuSeconds: 5 } });
  const requested = grants.request({
    resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'owner', nowUnix: now,
  });
  // The plan granted 64 MiB; the minter is asked for the container's 12 GiB by hand.
  const step = requested.plan.steps[0];
  assert.deepEqual(step.blastRadius.limits, { memoryBytes: 64 * 1024 * 1024, cpuSeconds: 5 });
  assert.throws(
    () => minter.mint(
      { plan: requested.plan, digest: 'x', approval: { approverId: 'o', grantedAtUnix: now, expiresAtUnix: now + 60 } },
      { stepId: step.id, paths: step.files, operations: ['EXECUTE'], uses: 1,
        expiresAtUnix: now + 60, limits: CONTAINER_CEILING },
      now,
    ),
    (error) => error.kind === 'OUT_OF_SCOPE' || error.kind === 'INVALID',
  );
});

test('the manifest lists four adapters today, and two may ask for something (D-0252, D-0274)', () => {
  assert.deepEqual(
    Object.keys(ADAPTER_MANIFESTS).sort(),
    ['compliance-packs', 'hardware-probe', 'local-model-runtime', 'sector-modules'],
  );
  assert.deepEqual(ADAPTER_MANIFESTS['local-model-runtime'].operations, ['EXECUTE']);
  assert.deepEqual(ADAPTER_MANIFESTS['hardware-probe'].operations, []);
  // D-0274: sector-modules gained a real write surface (install/activate/deactivate),
  // all three sharing one WRITE gate — see adapter-capability.mjs's manifest comment.
  assert.deepEqual(ADAPTER_MANIFESTS['sector-modules'].operations, ['WRITE']);
  assert.deepEqual(ADAPTER_MANIFESTS['compliance-packs'].operations, []);
});

test('an empty-operations adapter refuses any request — an empty manifest, not an implicit grant', () => {
  const { grants } = fresh();
  for (const resource of ['hardware-probe', 'compliance-packs']) {
    for (const operation of ['EXECUTE', 'READ', 'WRITE', 'DELETE']) {
      assert.throws(
        () => grants.request({ resource, operation, actor: 'a', nowUnix: 1000 }),
        (error) => error instanceof AdapterCapabilityError && error.kind === 'OUT_OF_SCOPE',
        `${resource}/${operation} should be refused OUT_OF_SCOPE`,
      );
    }
  }
});

test('sector-modules refuses every operation except WRITE, and WRITE alone is not a token', () => {
  const { grants } = fresh();
  for (const operation of ['EXECUTE', 'READ', 'DELETE']) {
    assert.throws(
      () => grants.request({ resource: 'sector-modules', operation, actor: 'a', nowUnix: 1000 }),
      (error) => error instanceof AdapterCapabilityError && error.kind === 'OUT_OF_SCOPE',
    );
  }
  const granted = grants.request({ resource: 'sector-modules', operation: 'WRITE', actor: 'a', nowUnix: 1000 });
  assert.equal(granted.plan.steps[0].files[0], 'adapter://sector-modules/write');
  assert.equal(granted.plan.steps[0].blastRadius.destructive, false);
});

test('VectorStoreAdapter/ObjectStoreAdapter/HostBridgeAdapter have no manifest entry — not built as adapters, not silently trusted', () => {
  for (const resource of ['vector-store', 'object-store', 'host-bridge']) {
    assert.throws(
      () => grants().request({ resource, operation: 'EXECUTE', actor: 'a', nowUnix: 1000 }),
      (error) => error instanceof AdapterCapabilityError && error.kind === 'UNKNOWN_ADAPTER',
    );
  }
});
function grants() { return fresh().grants; }

test('a request for an operation outside the manifest is refused before any human is asked', () => {
  const { grants } = fresh();
  assert.throws(
    () => grants.request({ resource: 'local-model-runtime', operation: 'DELETE', actor: 'a', nowUnix: 1000 }),
    (error) => error instanceof AdapterCapabilityError && error.kind === 'OUT_OF_SCOPE',
  );
});

test('a request naming an adapter that does not exist is refused, not silently granted', () => {
  const { grants } = fresh();
  assert.throws(
    () => grants.request({ resource: 'vector-store', operation: 'EXECUTE', actor: 'a', nowUnix: 1000 }),
    (error) => error instanceof AdapterCapabilityError && error.kind === 'UNKNOWN_ADAPTER',
  );
});

test('request() alone mints nothing — only approve() does', () => {
  const { grants, minter } = fresh();
  grants.request({ resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'a', nowUnix: 1000 });
  assert.equal(minter.outstanding(), 0);
});

test('the end-to-end grant: request -> approve -> a token the SAME minter accepts', () => {
  const { grants, minter } = fresh();
  const { runId, plan } = grants.request({
    resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'operator', nowUnix: 1000,
  });
  const { token } = grants.approve({ runId, approverId: 'owner', nowUnix: 1000 });
  assert.equal(minter.outstanding(), 1);
  const spent = minter.spend(token, { path: plan.steps[0].files[0], operation: 'EXECUTE' }, 1000);
  assert.equal(spent.spent, true);
  assert.equal(spent.usesRemaining, 0);
});

test('approving twice is refused — a grant is decided once', () => {
  const { grants } = fresh();
  const { runId } = grants.request({ resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'a', nowUnix: 1000 });
  grants.approve({ runId, approverId: 'owner', nowUnix: 1000 });
  assert.throws(
    () => grants.approve({ runId, approverId: 'owner', nowUnix: 1000 }),
    (error) => error instanceof AdapterCapabilityError && error.kind === 'ALREADY_DECIDED',
  );
});

test('approving an unknown run is refused', () => {
  const { grants } = fresh();
  assert.throws(
    () => grants.approve({ runId: 'no-such-run', approverId: 'owner', nowUnix: 1000 }),
    (error) => error instanceof AdapterCapabilityError && error.kind === 'NOT_FOUND',
  );
});

test('approving with no approver named is refused — an approval nobody is accountable for authorises nothing', () => {
  const { grants } = fresh();
  const { runId } = grants.request({ resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'a', nowUnix: 1000 });
  assert.throws(
    () => grants.approve({ runId, approverId: '', nowUnix: 1000 }),
    (error) => error instanceof AdapterCapabilityError && error.kind === 'NO_APPROVER',
  );
});

test('reject() marks the run decided without ever minting', () => {
  const { grants, minter } = fresh();
  const { runId } = grants.request({ resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'a', nowUnix: 1000 });
  const rejected = grants.reject({ runId, approverId: 'owner', reason: 'not now', nowUnix: 1000 });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(minter.outstanding(), 0);
  assert.throws(() => grants.approve({ runId, approverId: 'owner', nowUnix: 1000 }));
});

test('a token approved for one resource cannot be spent against a different path', () => {
  const { grants, minter } = fresh();
  const { runId } = grants.request({ resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'a', nowUnix: 1000 });
  const { token } = grants.approve({ runId, approverId: 'owner', nowUnix: 1000 });
  assert.throws(
    () => minter.spend(token, { path: 'adapter://some-other-resource/launch', operation: 'EXECUTE' }, 1000),
    /not granted by this token/,
  );
});

test('constructing an orchestrator with no minter refuses — it could not issue a token if it wanted to', () => {
  assert.throws(
    () => new AdapterGrantOrchestrator({ minter: null }),
    (error) => error instanceof AdapterCapabilityError && error.kind === 'INVALID',
  );
});

test('status reports the manifest and states plainly that self-grant is not possible', () => {
  const status = adapterCapabilityStatus();
  assert.equal(status.adaptersMaySelfGrant, false);
  assert.deepEqual(status.manifests['local-model-runtime'].operations, ['EXECUTE']);
});
