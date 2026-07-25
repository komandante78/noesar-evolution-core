// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Readiness must distinguish "alive" from "able to serve".
//
// With an in-container database this matters more than it did: a cluster still replaying
// WAL is a perfectly live process that cannot answer a single workspace query. /livez
// must stay 200 throughout — otherwise the container health check kills a database
// mid-recovery — while /readyz must say no.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadiness } from '../src/observability.mjs';

const watchdog = { report:() => ({ safeMode:{ active:false }, essentialFailures:[], subjects:[] }) };
const auth = { status:() => ({ initialized:true }) };

test('a declared PostgreSQL data plane that is not connected withholds readiness', () => {
  const notConnected = buildReadiness({
    watchdog, auth, dataPlane:{ mode:'postgresql', connected:false },
  });
  assert.equal(notConnected.ready, false);
  assert.ok(notConnected.reasons.includes('data-plane-not-connected'));
});

test('a connected PostgreSQL data plane is ready', () => {
  const connected = buildReadiness({
    watchdog, auth, dataPlane:{ mode:'postgresql', connected:true },
  });
  assert.equal(connected.ready, true);
  assert.deepEqual(connected.reasons, []);
});

test('reference-json never carries the not-connected reason', () => {
  // It has no connection to make, so treating connected:false as a failure there would
  // make every reference installation permanently not-ready.
  const reference = buildReadiness({
    watchdog, auth, dataPlane:{ mode:'reference-json', connected:false },
  });
  assert.equal(reference.ready, true);
});

test('safe mode still dominates readiness regardless of the data plane', () => {
  const inSafeMode = buildReadiness({
    watchdog:{ report:() => ({ safeMode:{ active:true }, essentialFailures:[], subjects:[] }) },
    auth, dataPlane:{ mode:'postgresql', connected:true },
  });
  assert.equal(inSafeMode.ready, false);
  assert.ok(inSafeMode.reasons.includes('safe-mode'));
});
