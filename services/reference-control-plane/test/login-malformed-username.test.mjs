// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An email address typed into the sign-in form answered **500**, and a 5xx has its message
// replaced by "Internal request failure." on the way out — so a rejected input reached the
// person as a broken product with the reason deleted. Found in production, D-0368.
//
// The two entry points want OPPOSITE answers and that is the property under test:
//   · sign-in  -> 401, the standard sentence, no format rule disclosed. An unauthenticated
//                 caller must not learn which strings can name an account.
//   · setup    -> 400, WITH the rule, because the caller holds the setup token and is
//                 choosing the name; refusing without saying why is unusable there.
// Neither is ever 500.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLedger } from '../src/audit.mjs';
import { AuthService, normalizeUsername } from '../src/auth.mjs';
import { totpCode } from '../src/auth-crypto.mjs';
import { freshTempDir } from './support/workspace.mjs';

const MALFORMED = [
  ['an email address', 'probe-value@example.invalid'],
  ['an address with a plus tag', 'someone+tag@example.org'],
  ['too short', 'ab'],
  ['a leading dot', '.owner'],
  ['a space inside', 'my name'],
  ['65 characters', 'a'.repeat(65)],
  ['empty', ''],
  ['only whitespace', '   '],
  ['undefined', undefined],
];

describe('a username the product could never have issued', () => {
  for (const [name, value] of MALFORMED) {
    test(`${name} is refused as a 400, never an unmarked error`, () => {
      // An unmarked Error is what made this a 500: the request handler defaults to that status
      // when no `status` is carried, and then replaces the message.
      assert.throws(() => normalizeUsername(value), (error) => {
        assert.equal(error.status, 400, 'an input the caller can fix is not a server fault');
        assert.match(error.message, /3-64/, 'setup needs the rule, so the rule must survive the throw');
        return true;
      });
    });
  }

  test('a valid username still normalises, so the guard did not close the door on everyone', () => {
    assert.equal(normalizeUsername('  KOMA78 '), 'koma78');
    assert.equal(normalizeUsername('a.b-c_1'), 'a.b-c_1');
  });
});

describe('sign-in refuses without teaching the format', () => {
  // A real service against a temporary workspace. An earlier version of this test built a
  // stand-in with Object.create(AuthService.prototype) and every case failed for the wrong
  // reason: private methods are installed on instances by the CONSTRUCTOR, so `this.#…` threw
  // before the branch under test could run. The double could not hold the state the branch
  // needs, so it could not guard it.
  function realService() {
    const workspace = freshTempDir('noesar-login-');
    const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
    const auth = new AuthService({ workspace, setupToken: 'setup-secret-value', ledger });
    const pending = auth.beginSetup({
      suppliedSetupToken: 'setup-secret-value', username: 'koma78',
      displayName: 'Owner', password: 'correct horse battery staple',
    });
    auth.confirmSetup({ challenge: pending.challenge, totpCode: totpCode(pending.totpSecret, Date.now() - 30_000) });
    return { auth, ledgerPath: join(workspace, 'audit/events.jsonl') };
  }

  test('an email address is refused as a credential, not as a bad request', () => {
    const { auth, ledgerPath } = realService();
    let error;
    try {
      auth.beginLogin({ username: 'probe-value@example.invalid', password: 'whatever', ip: '10.0.0.9' });
    } catch (thrown) { error = thrown; }

    assert.ok(error, 'a malformed username must still be refused');
    assert.equal(error.status, 401, 'not 500, and not 400: the sign-in form is not where the rule is taught');
    assert.doesNotMatch(error.message, /3-64/, 'the format rule must not leak to an unauthenticated caller');

    // What somebody typed into a sign-in box is not ours to keep: here it was an email address.
    const written = readFileSync(ledgerPath, 'utf8');
    assert.ok(!written.includes('probe-value'), 'the attempted value must not be written to the ledger');
    assert.match(written, /malformed-username/, 'but the attempt itself must be recorded');
  });

  test('the refusal is the SAME sentence a wrong password gets', () => {
    // Otherwise the two are distinguishable, and the form becomes an oracle for which strings
    // could name an account — the property the surrounding branches already protect.
    const { auth } = realService();
    const say = (username) => {
      try { auth.beginLogin({ username, password: 'wrong', ip: '10.0.0.10' }); return null; }
      catch (error) { return error.message; }
    };
    assert.equal(say('probe-value@example.invalid'), say('koma78'));
    assert.equal(say('probe-value@example.invalid'), say('nosuchaccount'));
  });
});
