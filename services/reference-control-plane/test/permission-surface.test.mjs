// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-007 / INST-008: "an update that requests more authority than before declares it
// explicitly (a permission diff) and is authorised again." These prove the enforcement
// logic adversarially — an update that widens scope must be refused without a matching
// authorisation, and an authorisation for the wrong scope must not rescue it either.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractRbacPermissions, adapterCapabilityList, buildPermissionSurface,
  diffPermissionSurfaces, verifyUpdateAuthorized, PermissionDiffError,
} from '../src/permission-surface.mjs';
import { ADAPTER_MANIFESTS } from '../src/adapter-capability.mjs';

const NOW = 1_800_000_000;
function authFor(permissions, { approverId = 'owner', grantedAtUnix = NOW, expiresAtUnix = NOW + 900 } = {}) {
  return { approverId, grantedAtUnix, expiresAtUnix, permissions };
}

test('extraction finds requireSession and hasPermission literals, nothing invented', () => {
  const source = `
    if (a) { const authenticated = requireSession(req, res, 'hardware.read'); }
    if (b) { if (!auth.hasPermission(authenticated.user, 'workspace.write')) {} }
    if (c) { requireSession(req, res, 'hardware.read'); } // duplicate, deduped
  `;
  assert.deepEqual(extractRbacPermissions(source), ['hardware.read', 'workspace.write']);
});

test('extraction against the REAL server.mjs finds a real, non-trivial permission set', () => {
  const source = readFileSync(join(import.meta.dirname, '../src/server.mjs'), 'utf8');
  const permissions = extractRbacPermissions(source);
  assert.ok(permissions.length >= 10, `expected a real permission set, got ${permissions.length}`);
  assert.ok(permissions.includes('model.manage'));
  assert.ok(permissions.includes('workspace.write'));
});

test('adapterCapabilityList flattens the real manifest, today two adapter/operation pairs (D-0274)', () => {
  const list = adapterCapabilityList(ADAPTER_MANIFESTS);
  assert.deepEqual(list, [
    { resource: 'local-model-runtime', operation: 'EXECUTE' },
    { resource: 'sector-modules', operation: 'WRITE' },
  ]);
});

test('an empty diff (identical surfaces) needs no authorisation at all', () => {
  const surface = buildPermissionSurface({ rbacPermissions: ['a', 'b'], adapterCapabilities: [] });
  const outcome = verifyUpdateAuthorized({ baseline: surface, candidate: surface, nowUnix: NOW });
  assert.equal(outcome.authorized, true);
  assert.deepEqual(outcome.added, []);
  assert.match(outcome.reason, /no new authority/);
});

test('removing a permission (shrinking authority) never requires authorisation', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: ['a', 'b'], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({ rbacPermissions: ['a'], adapterCapabilities: [] });
  const outcome = verifyUpdateAuthorized({ baseline, candidate, nowUnix: NOW });
  assert.equal(outcome.authorized, true);
  assert.deepEqual(outcome.removed, ['rbac:b']);
  assert.deepEqual(outcome.added, []);
});

test('widening RBAC scope with no authorisation supplied is refused', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: ['a'], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({ rbacPermissions: ['a', 'audit.read'], adapterCapabilities: [] });
  assert.throws(
    () => verifyUpdateAuthorized({ baseline, candidate, nowUnix: NOW }),
    (error) => error instanceof PermissionDiffError && error.kind === 'AUTHORIZATION_REQUIRED'
      && /audit\.read/.test(error.message),
  );
});

test('widening adapter capability scope is caught the same way as RBAC', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: [], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({
    rbacPermissions: [], adapterCapabilities: [{ resource: 'local-model-runtime', operation: 'EXECUTE' }],
  });
  assert.throws(
    () => verifyUpdateAuthorized({ baseline, candidate, nowUnix: NOW }),
    (error) => error instanceof PermissionDiffError
      && /adapter:local-model-runtime:EXECUTE/.test(error.message),
  );
});

test('an authorisation naming exactly the added permission is accepted', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: ['a'], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({ rbacPermissions: ['a', 'audit.read'], adapterCapabilities: [] });
  const outcome = verifyUpdateAuthorized({
    baseline, candidate, authorization: authFor(['rbac:audit.read']), nowUnix: NOW,
  });
  assert.equal(outcome.authorized, true);
  assert.equal(outcome.approverId, 'owner');
});

test('an authorisation for a DIFFERENT permission than what was added does not rescue the update', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: ['a'], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({ rbacPermissions: ['a', 'audit.read'], adapterCapabilities: [] });
  assert.throws(
    () => verifyUpdateAuthorized({
      baseline, candidate, authorization: authFor(['rbac:user.manage']), nowUnix: NOW,
    }),
    (error) => error instanceof PermissionDiffError && error.kind === 'SCOPE_MISMATCH',
  );
});

test('an authorisation broader than what changed (a superset) is refused, not silently accepted', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: ['a'], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({ rbacPermissions: ['a', 'audit.read'], adapterCapabilities: [] });
  assert.throws(
    () => verifyUpdateAuthorized({
      baseline, candidate, authorization: authFor(['rbac:audit.read', 'rbac:user.manage']), nowUnix: NOW,
    }),
    (error) => error instanceof PermissionDiffError && error.kind === 'SCOPE_MISMATCH'
      && /does not actually add/.test(error.message),
  );
});

test('an expired authorisation does not authorise anything', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: ['a'], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({ rbacPermissions: ['a', 'audit.read'], adapterCapabilities: [] });
  assert.throws(
    () => verifyUpdateAuthorized({
      baseline, candidate,
      authorization: authFor(['rbac:audit.read'], { grantedAtUnix: NOW - 2000, expiresAtUnix: NOW - 1000 }),
      nowUnix: NOW,
    }),
    (error) => error instanceof PermissionDiffError && error.kind === 'EXPIRED',
  );
});

test('an authorisation with no approver named authorises nothing', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: ['a'], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({ rbacPermissions: ['a', 'audit.read'], adapterCapabilities: [] });
  assert.throws(
    () => verifyUpdateAuthorized({
      baseline, candidate, authorization: authFor(['rbac:audit.read'], { approverId: '' }), nowUnix: NOW,
    }),
    (error) => error instanceof PermissionDiffError && error.kind === 'NO_APPROVER',
  );
});

test('diffPermissionSurfaces reports both sides independently, not just a boolean', () => {
  const baseline = buildPermissionSurface({ rbacPermissions: ['a', 'b'], adapterCapabilities: [] });
  const candidate = buildPermissionSurface({ rbacPermissions: ['a', 'c'], adapterCapabilities: [] });
  const { added, removed } = diffPermissionSurfaces(baseline, candidate);
  assert.deepEqual(added, ['rbac:c']);
  assert.deepEqual(removed, ['rbac:b']);
});
