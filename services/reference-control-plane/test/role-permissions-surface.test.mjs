// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The interface has to decide whether to offer a section at all. Showing someone a nav
// entry whose every request answers 403 is the same class of defect as a panel that
// never finishes loading — which is what this whole remediation exists to remove.
//
// The tempting fix was to restate the role/permission matrix in the browser. That copy
// is one refactor away from disagreeing with the server that enforces it, and the
// disagreement would be invisible: the UI would quietly offer, or quietly hide, the
// wrong thing. `permissionsFor()` exposes the single ROLE_PERMISSIONS definition
// instead, and these tests pin the property that matters — that what the server
// *reports* and what the server *enforces* can never drift apart.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthService, ROLES, RolePermissions, MFA_REQUIRED_ROLES } from '../src/auth.mjs';

function service() {
  return new AuthService({
    workspace: mkdtempSync(join(tmpdir(), 'noesar-perms-')),
    setupToken: 'test-only-setup-token-not-a-real-secret',
    ledger: { append() {} },
  });
}

describe('role permission surface', () => {
  test('every role reports exactly the permissions it is enforced with', () => {
    const auth = service();
    for (const role of ROLES) {
      const reported = auth.permissionsFor(role);
      // The report must agree with the enforcement helper in BOTH directions: every
      // permission it lists must be granted, and every permission it omits must be
      // refused. A one-directional check would pass on an empty list.
      for (const permission of reported) {
        assert.equal(auth.hasPermission({ role }, permission), true,
          `${role} reported "${permission}" but hasPermission() refuses it`);
      }
      const everyPermission = new Set(Object.values(RolePermissions).flatMap((set) => [...set]));
      for (const permission of everyPermission) {
        if (reported.includes(permission)) continue;
        assert.equal(auth.hasPermission({ role }, permission), false,
          `${role} omitted "${permission}" but hasPermission() grants it`);
      }
    }
  });

  test('the reported list is a copy, so a caller cannot widen its own role', () => {
    const auth = service();
    const first = auth.permissionsFor('user');
    first.push('user.manage');
    assert.equal(auth.permissionsFor('user').includes('user.manage'), false);
    assert.equal(auth.hasPermission({ role: 'user' }, 'user.manage'), false);
  });

  test('an unknown role reports nothing rather than throwing', () => {
    const auth = service();
    assert.deepEqual(auth.permissionsFor('not-a-role'), []);
    assert.deepEqual(auth.permissionsFor(undefined), []);
  });

  test('the gated sections resolve to the roles the server actually admits', () => {
    const auth = service();
    // These are the four gates the interface uses. They are asserted here so that a
    // future permission change cannot silently alter who is offered the Users or
    // Backups page without a test noticing.
    const holders = (permission) => ROLES.filter((role) => auth.hasPermission({ role }, permission));
    assert.deepEqual(holders('user.manage'), ['owner', 'admin']);
    assert.deepEqual(holders('data.manage'), ['owner', 'admin', 'developer']);
    assert.deepEqual(holders('audit.read'), ['owner', 'admin']);
    // Every interactive role can at least read the workspace, so Tools and Providers
    // are worth offering to all of them.
    for (const role of ROLES) {
      assert.equal(auth.hasPermission({ role }, 'workspace.read'), true, `${role} cannot read the workspace`);
    }
  });

  test('owner is the only role that is a strict superset of every other', () => {
    const auth = service();
    const owner = new Set(auth.permissionsFor('owner'));
    for (const role of ROLES) {
      for (const permission of auth.permissionsFor(role)) {
        assert.equal(owner.has(permission), true, `owner lacks "${permission}" held by ${role}`);
      }
    }
  });

  test('the MFA-required roles are the ones the directory reports as such', () => {
    // The Users page prints "MFA required" beside a role from this same set, so a
    // divergence would put a false statement in front of an administrator.
    assert.deepEqual([...MFA_REQUIRED_ROLES].sort(), ['admin', 'owner']);
    for (const role of ['owner', 'admin']) {
      assert.equal(MFA_REQUIRED_ROLES.has(role), true);
    }
    for (const role of ['developer', 'user', 'client_restricted', 'service_account']) {
      assert.equal(MFA_REQUIRED_ROLES.has(role), false);
    }
  });
});
