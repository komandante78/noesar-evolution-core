// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-021, the half a probe cannot prove by running: not "the two shells reached the same run
// this time", but "the two shells cannot come to offer, or gate, different things".
//
// tools/acceptance/ce-021-two-shells.mjs drives the live proof — start in one shell, kill it,
// finish from the other, both directions, plus a command whose shell dies mid-flight. What it
// measures is a moment. This file guards the shape.
//
// History worth keeping, because it is what these assertions are for: phase 5 (`D-0301`)
// measured that the HTTP bridge checked a permission per method and the unix socket checked
// none, and that the two shells nevertheless agreed — because every role that can authenticate
// holds `workspace.read` and `workspace.write`, the only two permissions the table named. They
// agreed by coincidence. `D-0302` replaced the coincidence with one table, enforced inside the
// dispatch, so the guarantee no longer depends on which transport remembered to check.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RolePermissions, ROLES } from '../src/auth.mjs';
import { SESSION_METHOD_POLICY, bridgedMethodPermissions, createSessionDispatch } from '../src/session-protocol.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const protocolSource = readFileSync(join(root, 'src/session-protocol.mjs'), 'utf8');
const serverSource = readFileSync(join(root, 'src/server.mjs'), 'utf8');

/** The methods the dispatch actually implements: the keys of `createSessionDispatch`'s own
 *  `methods` object, read from the source that owns them rather than restated here. */
function implementedMethods() {
  const block = protocolSource.slice(protocolSource.indexOf('const methods = {'), protocolSource.indexOf('  /**\n   * `can(permission)'));
  assert.ok(block.length > 200, 'the dispatch table moved; this test cannot see it');
  return new Set([...block.matchAll(/^\s{4}'?([a-zA-Z.]+)'?:\s/gm)].map((match) => match[1]));
}

/** A dispatch with every dependency stubbed: this file is about the gate in front of the
 *  handlers, not the handlers. Each stub returns something recognisable so a method that runs
 *  when it should have been refused is visible rather than silently empty. */
function gatedDispatch(methodPolicy) {
  const ran = [];
  const mark = (name) => (...args) => { ran.push(name); return { ran: name, args }; };
  const dispatch = createSessionDispatch({
    ...(methodPolicy ? { methodPolicy } : {}),
    workspaceActions: { plan: mark('plan'), simulate: mark('simulate'), approve: mark('approve'), reject: mark('reject'), restore: mark('restore'), get: () => ({ runId: 'r' }) },
    buildRepositoryMap: mark('map'), literalSearch: mark('search'),
    resolveWorkspaceSubpath: (rootPath) => rootPath, workspaceRoot: '/tmp',
    engineEvents: { correlation: () => [] }, workspaceActionsStatus: () => ({}),
    getShadowSnapshot: () => ({}), capabilityStatus: () => ({}), capabilityMinter: {},
    contextGraph: { listSessions: mark('sessions.list'), getConversation: mark('sessions.get'), purgeSession: mark('purge') },
    ledger: { append: () => {} }, invariantEnforcement: [],
    codenAddressBook: () => [],
  });
  return { dispatch, ran };
}

describe('CE-021 — the two shells cannot drift apart unnoticed', () => {
  test('every method the dispatch implements has a declared permission policy', () => {
    // The fallback for "not listed" must be REFUSE, never ALLOW — and the way to keep that
    // true is for an unlisted method to be impossible rather than merely refused.
    for (const method of implementedMethods()) {
      assert.ok(SESSION_METHOD_POLICY[method], `\`${method}\` is implemented with no declared permission policy`);
    }
  });

  test('every declared policy names a method that exists', () => {
    // The other direction: an entry left behind after a method is removed is a rule nobody
    // enforces, and the next reader would take it for a live one.
    const implemented = implementedMethods();
    for (const method of Object.keys(SESSION_METHOD_POLICY)) {
      assert.ok(implemented.has(method), `the policy names \`${method}\`, which the dispatch does not implement`);
    }
  });

  test('the browser bridge derives its table from the same policy, and keeps no second copy', () => {
    assert.match(serverSource, /const TUI_METHOD_PERMISSION = bridgedMethodPermissions\(\);/,
      'server.mjs has gone back to writing out its own method/permission table');
    const bridged = bridgedMethodPermissions();
    assert.deepEqual(
      Object.keys(bridged).sort(),
      Object.entries(SESSION_METHOD_POLICY).filter(([, policy]) => policy.bridged).map(([method]) => method).sort(),
    );
    assert.ok(Object.keys(bridged).length >= 10, 'the bridged surface shrank unexpectedly');
  });

  test('what only the terminal carries is a declared list, and it is gated like its own routes', () => {
    // These five are socket-only on purpose: the browser reaches each through a surface of its
    // own, so bridging them would add a second way in rather than a missing one. The
    // permission each one costs is what that surface's own route already asks — measured
    // against server.mjs above: GET /api/v1/sessions asks workspace.read, POST
    // /api/v1/sessions/actions asks workspace.write. A NEW socket-only method fails here until
    // someone decides which it is.
    const socketOnly = Object.entries(SESSION_METHOD_POLICY).filter(([, policy]) => !policy.bridged);
    assert.deepEqual(Object.fromEntries(socketOnly.map(([method, policy]) => [method, policy.permission])), {
      'sessions.list': 'workspace.read',
      'sessions.get': 'workspace.read',
      'sessions.action': 'workspace.write',
      'product.invariants': null,
      'coden.addresses': null,
    });
  });

  test('the dispatch refuses a caller that lacks the permission — whichever shell it came from', async () => {
    const { dispatch, ran } = gatedDispatch();
    await assert.rejects(
      dispatch('workspace.plan', { request: 'x', files: [] }, 'someone', () => false),
      (error) => error.kind === 'FORBIDDEN' && /workspace\.write/.test(error.message),
    );
    await assert.rejects(
      dispatch('sessions.action', { action: 'purge', ids: ['1'] }, 'someone', () => false),
      (error) => error.kind === 'FORBIDDEN',
    );
    assert.deepEqual(ran, [], 'a refused method still reached its handler');
  });

  test('a transport that says nothing about the caller is refused, not trusted', async () => {
    // This is the exact shape the socket transport had until D-0302: it passed no authority
    // and the dispatch asked for none. An optional gate is one new transport away from being
    // no gate, so the missing argument fails closed.
    const { dispatch, ran } = gatedDispatch();
    await assert.rejects(
      dispatch('workspace.approve', { runId: 'r' }, 'someone'),
      (error) => error.kind === 'FORBIDDEN' && /did not say what the caller may do/.test(error.message),
    );
    assert.deepEqual(ran, []);
    // Session-only methods stay reachable without one: they ask for a session and nothing more.
    const invariants = await dispatch('product.invariants', {}, 'someone');
    assert.deepEqual(invariants, { invariants: [] });
  });

  test('a method with no policy entry is refused, not run under no permission', async () => {
    // The fail-closed branch that matters most, and the one the real configuration can never
    // reach — every implemented method is listed, so mutating this guard away left every test
    // green. Exercised here through the policy seam, with a caller that would be allowed
    // anything: what refuses it is the missing entry, nothing else.
    const { dispatch, ran } = gatedDispatch({});
    for (const method of ['workspace.approve', 'sessions.action', 'status']) {
      await assert.rejects(
        dispatch(method, {}, 'someone', () => true),
        (error) => error.kind === 'UNKNOWN_METHOD' && /no declared permission policy/.test(error.message),
        `\`${method}\` ran with no declared policy`,
      );
    }
    assert.deepEqual(ran, [], 'an unlisted method still reached its handler');
  });

  test('both transports pass the caller\'s authority into the dispatch', () => {
    assert.match(protocolSource, /dispatch\(method, params, authenticated\.user\.id,\s*\n?\s*\(permission\) => auth\.hasPermission\(authenticated\.user, permission\)\)/,
      'the unix socket transport no longer tells the dispatch what the caller may do');
    assert.match(serverSource, /sessionDispatch\(method, payload\?\.params, authenticated\.user\.id,\s*\n?\s*\(permission\) => auth\.hasPermission\(authenticated\.user, permission\)\)/,
      'the HTTP bridge no longer tells the dispatch what the caller may do');
  });

  test('the socket transport still refuses everything before authentication', () => {
    // The gate in front of the gate. If this line goes, the permission model above starts
    // applying to whoever can reach the socket file rather than to whoever signed in.
    assert.match(protocolSource, /if \(!authenticated\) throw new ProtocolError\('UNAUTHENTICATED'/);
  });

  test('no role is currently locked out of the terminal shell', () => {
    // Not a rule — a measurement, kept because it is the thing that made the old gap
    // invisible: every role that can authenticate holds both permissions the policy names, so
    // the enforcement added in D-0302 refuses nobody today. If this fails, someone narrowed a
    // role, and the terminal shell just became less capable for that role than it was. That is
    // then a product decision to take deliberately, which is the point.
    const required = new Set(Object.values(SESSION_METHOD_POLICY).map((policy) => policy.permission).filter(Boolean));
    assert.deepEqual([...required].sort(), ['workspace.read', 'workspace.write']);
    for (const role of ROLES) {
      for (const permission of required) {
        assert.ok(RolePermissions[role]?.has(permission), `role \`${role}\` no longer holds \`${permission}\``);
      }
    }
  });
});
