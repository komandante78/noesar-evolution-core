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

test('the manifest lists four adapters today, and only one may ever ask for anything (D-0252)', () => {
  assert.deepEqual(
    Object.keys(ADAPTER_MANIFESTS).sort(),
    ['compliance-packs', 'hardware-probe', 'local-model-runtime', 'sector-modules'],
  );
  assert.deepEqual(ADAPTER_MANIFESTS['local-model-runtime'].operations, ['EXECUTE']);
  assert.deepEqual(ADAPTER_MANIFESTS['hardware-probe'].operations, []);
  assert.deepEqual(ADAPTER_MANIFESTS['sector-modules'].operations, []);
  assert.deepEqual(ADAPTER_MANIFESTS['compliance-packs'].operations, []);
});

test('an empty-operations adapter refuses any request — an empty manifest, not an implicit grant', () => {
  const { grants } = fresh();
  for (const resource of ['hardware-probe', 'sector-modules', 'compliance-packs']) {
    for (const operation of ['EXECUTE', 'READ', 'WRITE', 'DELETE']) {
      assert.throws(
        () => grants.request({ resource, operation, actor: 'a', nowUnix: 1000 }),
        (error) => error instanceof AdapterCapabilityError && error.kind === 'OUT_OF_SCOPE',
        `${resource}/${operation} should be refused OUT_OF_SCOPE`,
      );
    }
  }
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
