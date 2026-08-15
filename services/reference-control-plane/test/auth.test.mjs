// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLedger } from '../src/audit.mjs';
import { AuthService } from '../src/auth.mjs';
import { totpCode } from '../src/auth-crypto.mjs';
import { freshTempDir } from './support/workspace.mjs';

function setup() {
  const workspace = freshTempDir('noesar-auth-');
  const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
  const auth = new AuthService({ workspace, setupToken:'setup-secret-value', ledger });
  const pending = auth.beginSetup({ suppliedSetupToken:'setup-secret-value', username:'owner', displayName:'Owner', password:'correct horse battery staple' });
  // Setup spends the PREVIOUS time step, leaving the current one unspent for the tests
  // below. Since F4-002 a TOTP code is single-use (RFC 6238 section 5.2), so a fixture
  // that bootstraps with the current code would make every following login fail as a
  // replay — correctly, but for a reason the test did not intend to exercise.
  const session = auth.confirmSetup({ challenge:pending.challenge, totpCode:totpCode(pending.totpSecret, Date.now() - 30_000) });
  return { workspace, ledger, auth, session, secret:pending.totpSecret };
}

test('first Owner requires setup token and TOTP confirmation', () => {
  const workspace = freshTempDir('noesar-auth-');
  const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
  const auth = new AuthService({ workspace, setupToken:'secret', ledger });
  assert.throws(() => auth.beginSetup({ suppliedSetupToken:'wrong', username:'owner', password:'correct horse battery staple' }), /Invalid setup token/);
  const pending = auth.beginSetup({ suppliedSetupToken:'secret', username:'owner', password:'correct horse battery staple' });
  assert.equal(auth.status().pendingSetup, true);
  const result = auth.confirmSetup({ challenge:pending.challenge, totpCode:totpCode(pending.totpSecret) });
  assert.equal(result.user.role, 'owner');
  assert.equal(auth.status().initialized, true);
});

test('password hashes and session tokens are not stored in plaintext', () => {
  const { workspace, session } = setup();
  const text = readFileSync(join(workspace, 'state/auth.json'), 'utf8');
  assert.equal(text.includes('correct horse battery staple'), false);
  assert.equal(text.includes(session.token), false);
});

test('login requires a valid MFA challenge', () => {
  const { auth, secret } = setup();
  const challenge = auth.beginLogin({ username:'owner', password:'correct horse battery staple', ip:'127.0.0.1' });
  assert.equal(challenge.mfaRequired, true);
  assert.throws(() => auth.completeLogin({ challenge:challenge.challenge, totpCode:'000000', ip:'127.0.0.1' }), /Invalid TOTP/);
  const result = auth.completeLogin({ challenge:challenge.challenge, totpCode:totpCode(secret), ip:'127.0.0.1' });
  assert.equal(result.user.username, 'owner');
});

test('CSRF token is bound to the session', () => {
  const { auth, session } = setup();
  const authenticated = auth.authenticate(session.token);
  assert.equal(auth.verifyCsrf(authenticated.session, session.csrf), true);
  assert.equal(auth.verifyCsrf(authenticated.session, 'wrong'), false);
});

test('Owner reauthentication requires password and TOTP', () => {
  const { auth, session, secret } = setup();
  const authenticated = auth.authenticate(session.token);
  // A wrong password with a valid code must fail on the password. The code is not spent by
  // a failed attempt, but use distinct steps anyway so the two assertions stay independent.
  assert.throws(() => auth.reauthenticate({ sessionId:authenticated.session.id, password:'wrong', totpCode:totpCode(secret) }), /failed/);
  const elevated = auth.reauthenticate({ sessionId:authenticated.session.id, password:'correct horse battery staple', totpCode:totpCode(secret, Date.now() + 30_000) });
  assert.ok(elevated.elevatedUntil > Date.now());
});

test('login throttling activates after repeated failures', () => {
  const { auth } = setup();
  for (let index=0; index<8; index+=1) {
    assert.throws(() => auth.beginLogin({ username:'owner', password:'wrong-password-value', ip:'10.0.0.2' }));
  }
  assert.throws(() => auth.beginLogin({ username:'owner', password:'correct horse battery staple', ip:'10.0.0.2' }), /Too many login attempts/);
});

test('audit chain remains valid across auth events', () => {
  const { ledger } = setup();
  assert.equal(ledger.verify(), true);
});
