// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-021, the half a probe cannot prove by running: not "the two shells reached the same
// run this time", but "the two shells cannot come to offer different things without someone
// saying so".
//
// tools/acceptance/ce-021-two-shells.mjs drives the live proof — start in one shell, kill it,
// finish from the other, both directions, plus a command whose shell dies mid-flight. What
// it measures is a moment. This file guards the shape: which methods each transport carries,
// and the one thing that keeps their permission models agreeing today.
//
// Both facts are read out of the sources that own them rather than restated here, for the
// same reason phase 4 stopped the client keeping its own list of panels.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RolePermissions, ROLES } from '../src/auth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const protocolSource = readFileSync(join(root, 'src/session-protocol.mjs'), 'utf8');
const serverSource = readFileSync(join(root, 'src/server.mjs'), 'utf8');

/** The methods the terminal transport answers to: the keys of `createSessionDispatch`'s own
 *  `methods` object, plus the two the socket handles before authentication. */
function socketMethods() {
  const block = protocolSource.slice(protocolSource.indexOf('const methods = {'), protocolSource.indexOf('return async function dispatch'));
  assert.ok(block.length > 200, 'the dispatch table moved; this test cannot see it');
  return new Set([...block.matchAll(/^\s{4}'?([a-zA-Z.]+)'?:\s/gm)].map((match) => match[1]));
}

/** The methods the browser transport answers to, and the permission each needs: the keys of
 *  server.mjs's own TUI_METHOD_PERMISSION. */
function bridgeMethods() {
  const block = serverSource.slice(serverSource.indexOf('const TUI_METHOD_PERMISSION = {'), serverSource.indexOf('function clientIp(req)'));
  assert.ok(block.length > 100, 'the bridge permission table moved; this test cannot see it');
  const table = new Map();
  for (const match of block.matchAll(/'?([a-zA-Z.]+)'?:\s*(null|'[a-z.]+')/g)) {
    table.set(match[1], match[2] === 'null' ? null : match[2].slice(1, -1));
  }
  return table;
}

describe('CE-021 — the two shells cannot drift apart unnoticed', () => {
  test('the browser bridge offers nothing the terminal transport does not have', () => {
    // One dispatch is the whole design claim (D-0230). A method the bridge routes and the
    // dispatch does not implement would answer UNKNOWN_METHOD to the browser only — the two
    // shells disagreeing about what the product can do.
    const socket = socketMethods();
    for (const method of bridgeMethods().keys()) {
      assert.ok(socket.has(method), `the browser bridge routes \`${method}\`, which the dispatch does not implement`);
    }
  });

  test('what only the terminal carries is a declared list, not a leftover', () => {
    // These four are socket-only on purpose: the browser reaches each through a surface of
    // its own (its Sessions page, its Invariants panel, its address box), so putting them in
    // the bridge would add a second way in rather than a missing one. Measured live by
    // tools/acceptance/ce-021-two-shells.mjs, which asks both transports and records exactly
    // this difference. A NEW socket-only method fails here until someone decides which it is.
    const declaredSocketOnly = new Set(['sessions.list', 'sessions.get', 'sessions.action', 'product.invariants', 'coden.addresses']);
    const bridge = bridgeMethods();
    const undeclared = [...socketMethods()].filter((method) => !bridge.has(method) && !declaredSocketOnly.has(method));
    assert.deepEqual(undeclared, [], `socket-only methods nobody has declared: ${undeclared.join(', ')}`);
  });

  test('every role holds every permission the bridge demands — which is WHY the shells agree today', () => {
    // The asymmetry worth writing down: the browser bridge checks a permission per method;
    // the socket transport checks none beyond authentication. Today that difference changes
    // nothing, because every role that can authenticate holds `workspace.read` and
    // `workspace.write` — the only two permissions the table names. The shells agree by
    // coincidence, not by construction.
    //
    // So this test does not assert the coincidence is fine. It asserts the coincidence still
    // holds, and fails the day it stops — the day a role is added, or narrowed, that the
    // browser would refuse and the socket would not. At that point the fix is a real one:
    // check the same table on the socket side, or say in writing why a shell that requires
    // filesystem access to a 0600 socket owned by the product's uid is trusted differently.
    const required = new Set([...bridgeMethods().values()].filter(Boolean));
    assert.ok(required.size > 0, 'the bridge table names no permissions; it moved or emptied');
    for (const role of ROLES) {
      for (const permission of required) {
        assert.ok(
          RolePermissions[role]?.has(permission),
          `role \`${role}\` lacks \`${permission}\`: the browser would refuse it and the unix socket would not. `
          + 'The socket transport checks no per-method permission — see session-protocol.mjs.',
        );
      }
    }
  });

  test('the socket transport still refuses everything before authentication', () => {
    // The one gate the socket does apply. If this line goes, the paragraph above stops being
    // about roles and starts being about anyone who can reach the socket file.
    assert.match(protocolSource, /if \(!authenticated\) throw new ProtocolError\('UNAUTHENTICATED'/);
  });
});
