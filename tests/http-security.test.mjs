// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders, validHostHeader } from '../src/http-security.mjs';

test('security headers deny framing and scope multimedia capture to self', () => {
  const headers = securityHeaders({ contentSecurityPolicy:true });
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(headers['permissions-policy'], /camera=\(self\)/);
  assert.match(headers['permissions-policy'], /geolocation=\(\)/);
});

test('Host allowlist blocks unknown DNS rebinding host', () => {
  const allowed = new Set(['localhost','127.0.0.1']);
  assert.equal(validHostHeader('localhost:8088', allowed), true);
  assert.equal(validHostHeader('attacker.example:8088', allowed), false);
});
