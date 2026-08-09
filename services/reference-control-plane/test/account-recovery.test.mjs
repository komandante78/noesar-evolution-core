// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Before D-0369 this product had the SHAPE of a recovery mechanism and no way in:
// `recoveryCodes` was written and counted, nothing ever consumed one, and `confirmSetup` issued
// none at all — so the first owner finished setup with zero codes and the only thing that could
// mint any demanded the password and a TOTP code, which is exactly what a locked-out person
// lacks. The Owner met that on 2026-08-09 and could not get back in.
//
// What is asserted here is that the way in exists, that it is NARROW, and that it closes the
// door behind it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLedger } from '../src/audit.mjs';
import { AuthService } from '../src/auth.mjs';
import { totpCode } from '../src/auth-crypto.mjs';

const PASSPHRASE = 'correct horse battery staple';
const NEW_PASSPHRASE = 'a different passphrase entirely, long enough';

function install({ extraUsers = [] } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-recovery-'));
  const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
  const auth = new AuthService({ workspace, setupToken: 'setup-secret-value', ledger });
  if (extraUsers.length) {
    auth.store.update((next) => { next.users = [...(next.users ?? []), ...extraUsers]; });
  }
  const pending = auth.beginSetup({
    suppliedSetupToken: 'setup-secret-value', username: 'koma78',
    displayName: 'Owner', password: PASSPHRASE,
  });
  const done = auth.confirmSetup({
    challenge: pending.challenge, totpCode: totpCode(pending.totpSecret, Date.now() - 30_000),
  });
  return { auth, setup: done, secret: pending.totpSecret };
}

describe('setup hands over the codes it never used to', () => {
  test('a brand-new owner leaves setup holding recovery codes', () => {
    const { setup } = install();
    assert.equal(Array.isArray(setup.recoveryCodes), true, 'the codes must reach the caller once, at the only moment they can be shown');
    assert.equal(setup.recoveryCodes.length, 10);
    for (const code of setup.recoveryCodes) assert.match(code, /^[0-9A-HJ-NP-TV-Z]{5}-[0-9A-HJ-NP-TV-Z]{5}$/);
  });

  test('a non-owner account survives first-run', () => {
    // `next.users = [user]` deleted every other account, including the service account a module
    // authenticates with — detaching the module through an act nobody would connect to it.
    const service = { id: 'svc-1', username: 'debug-evolution', role: 'service_account', status: 'active' };
    const { auth } = install({ extraUsers: [service] });
    const usernames = auth.store.read().users.map((u) => u.username).sort();
    assert.deepEqual(usernames, ['debug-evolution', 'koma78']);
  });
});

describe('getting back in with a recovery code', () => {
  test('the passphrase is replaced and the old one stops working', () => {
    const { auth, setup } = install();
    const started = auth.beginRecovery({ username: 'koma78', recoveryCode: setup.recoveryCodes[0], ip: '10.0.0.1' });
    assert.ok(started.challenge && started.totpSecret, 'stage 1 must hand over a NEW authenticator to enrol');

    const finished = auth.completeRecovery({
      challenge: started.challenge, password: NEW_PASSPHRASE,
      totpCode: totpCode(started.totpSecret, Date.now()),
    });
    assert.ok(finished.user, 'stage 2 signs the person in');

    assert.throws(() => auth.beginLogin({ username: 'koma78', password: PASSPHRASE, ip: '10.0.0.2' }),
      (error) => error.status === 401, 'the passphrase that was recovered FROM must stop working');
    assert.ok(auth.beginLogin({ username: 'koma78', password: NEW_PASSPHRASE, ip: '10.0.0.2' }).challenge,
      'and the new one must work');
  });

  test('the old authenticator is replaced too, not left beside the new passphrase', () => {
    const { auth, setup, secret } = install();
    const started = auth.beginRecovery({ username: 'koma78', recoveryCode: setup.recoveryCodes[1], ip: '10.0.0.1' });
    auth.completeRecovery({ challenge: started.challenge, password: NEW_PASSPHRASE, totpCode: totpCode(started.totpSecret, Date.now()) });
    const login = auth.beginLogin({ username: 'koma78', password: NEW_PASSPHRASE, ip: '10.0.0.3' });
    // `completeLogin`, and the name matters: an earlier draft called a method that does not
    // exist, so `assert.throws` was satisfied by the TypeError and the assertion never touched
    // the product. The check below both refuses the old code AND proves the new one works, so a
    // wrong method name cannot fake it — the second call would throw as well.
    // 401 and not 403: `completeLogin` refuses a bad code as a failed credential, which is a
    // different door from `confirmSetup`'s 403. Asserted from a probe of the real behaviour
    // rather than from what the neighbouring method happens to do.
    assert.throws(() => auth.completeLogin({ challenge: login.challenge, totpCode: totpCode(secret, Date.now()), ip: '10.0.0.3' }),
      (error) => error.status === 401, 'a code from the OLD authenticator must not open the recovered account');
    // The NEXT time step, deliberately: `completeRecovery` just consumed the current one, and a
    // TOTP code is single-use since F4-002. Reusing it here would fail as a replay — correctly,
    // and for a reason this test does not intend to exercise.
    const fresh = auth.beginLogin({ username: 'koma78', password: NEW_PASSPHRASE, ip: '10.0.0.3' });
    assert.ok(auth.completeLogin({ challenge: fresh.challenge, totpCode: totpCode(started.totpSecret, Date.now() + 30_000), ip: '10.0.0.3' }).user,
      'while a code from the NEW authenticator does');
  });

  test('a spent code cannot be spent again, and the whole set is replaced', () => {
    const { auth, setup } = install();
    const first = setup.recoveryCodes[0];
    const started = auth.beginRecovery({ username: 'koma78', recoveryCode: first, ip: '10.0.0.1' });
    const finished = auth.completeRecovery({ challenge: started.challenge, password: NEW_PASSPHRASE, totpCode: totpCode(started.totpSecret, Date.now()) });

    assert.equal(finished.recoveryCodes.length, 10, 'recovery hands over a fresh set, or the next lockout has nothing');
    assert.ok(!finished.recoveryCodes.includes(first), 'and it is genuinely a new set');
    assert.throws(() => auth.beginRecovery({ username: 'koma78', recoveryCode: first, ip: '10.0.0.4' }),
      (error) => error.status === 401, 'the code just used must be dead');
  });

  test('every sign-in that existed before is cut', () => {
    const { auth, setup } = install();
    assert.ok(auth.store.read().sessions.length >= 1, 'setup left a session behind, which is the one being cut');
    const started = auth.beginRecovery({ username: 'koma78', recoveryCode: setup.recoveryCodes[2], ip: '10.0.0.1' });
    auth.completeRecovery({ challenge: started.challenge, password: NEW_PASSPHRASE, totpCode: totpCode(started.totpSecret, Date.now()) });
    // Exactly one: the session recovery itself just issued.
    assert.equal(auth.store.read().sessions.length, 1, 'a recovery that leaves the previous holder signed in is not a recovery');
  });
});

describe('what it refuses, and how it refuses', () => {
  const cases = [
    ['an unknown account', { username: 'somebodyelse', recoveryCode: 'AAAAA-BBBBB' }],
    ['a wrong code', { username: 'koma78', recoveryCode: 'AAAAA-BBBBB' }],
    ['an empty code', { username: 'koma78', recoveryCode: '' }],
    ['a malformed username', { username: 'not an account', recoveryCode: 'AAAAA-BBBBB' }],
  ];
  for (const [name, payload] of cases) {
    test(`${name} gets the same sentence as everything else`, () => {
      const { auth } = install();
      assert.throws(() => auth.beginRecovery({ ...payload, ip: '10.0.0.9' }), (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.message, 'That recovery attempt was not accepted.');
        assert.doesNotMatch(error.message, /user|account exists|unknown/i, 'a recovery form must not become the account oracle the sign-in form refuses to be');
        return true;
      });
    });
  }

  test('proof of controlling the installation needs no code at all', () => {
    // The authority the FIRST owner was created with. It adds no new root of trust — it names
    // the one the product already had.
    const { auth } = install();
    const started = auth.beginRecovery({ username: 'koma78', viaProof: true, ip: '10.0.0.1' });
    assert.ok(started.challenge);
    const finished = auth.completeRecovery({ challenge: started.challenge, password: NEW_PASSPHRASE, totpCode: totpCode(started.totpSecret, Date.now()) });
    assert.ok(finished.user);
  });

  test('a short passphrase is refused at stage 2, with the reason, and the challenge survives', () => {
    const { auth, setup } = install();
    const started = auth.beginRecovery({ username: 'koma78', recoveryCode: setup.recoveryCodes[3], ip: '10.0.0.1' });
    assert.throws(() => auth.completeRecovery({ challenge: started.challenge, password: 'short', totpCode: totpCode(started.totpSecret, Date.now()) }),
      (error) => error.status === 400, 'here the caller IS choosing the passphrase, so the rule is theirs to know');
    // Being told the passphrase is too short must not cost the attempt.
    const finished = auth.completeRecovery({ challenge: started.challenge, password: NEW_PASSPHRASE, totpCode: totpCode(started.totpSecret, Date.now()) });
    assert.ok(finished.user);
  });

  test('guessing is rate limited', () => {
    const { auth } = install();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.throws(() => auth.beginRecovery({ username: 'koma78', recoveryCode: 'AAAAA-BBBBB', ip: '10.0.0.7' }));
    }
    assert.throws(() => auth.beginRecovery({ username: 'koma78', recoveryCode: 'AAAAA-BBBBB', ip: '10.0.0.7' }),
      (error) => error.status === 429, 'ten codes of ten characters are guessable if nothing counts the guesses');
  });

  test('a stale challenge is refused', () => {
    const { auth, setup } = install();
    const started = auth.beginRecovery({ username: 'koma78', recoveryCode: setup.recoveryCodes[4], ip: '10.0.0.1' });
    auth.store.update((next) => { next.pendingRecovery.expiresAt = Date.now() - 1; });
    assert.throws(() => auth.completeRecovery({ challenge: started.challenge, password: NEW_PASSPHRASE, totpCode: totpCode(started.totpSecret, Date.now()) }),
      (error) => error.status === 400);
  });
});
