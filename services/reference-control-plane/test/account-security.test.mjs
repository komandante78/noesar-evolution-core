// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Account security: password change, authenticator replacement, recovery codes and
// session revocation. None of this existed before — the Owner could see a Base32
// string once at setup and had no way to change it, rotate it, or discover what
// sessions were open. The TOTP secret shown during the original bootstrap therefore
// had no revocation path at all, which is why replacement is the centrepiece here.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AuthService } from '../src/auth.mjs';
import { totpCode, base32Decode } from '../src/auth-crypto.mjs';
import { freshTempDir } from './support/workspace.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

function ledgerStub() {
  const entries = [];
  return { entries, append(entry) { entries.push(entry); } };
}

/** Bring up an initialised installation with an owner, and return the pieces. */
function bootstrap() {
  const workspace = freshTempDir('noesar-security-');
  const ledger = ledgerStub();
  const auth = new AuthService({ workspace, setupToken: SETUP_TOKEN, ledger });
  const begun = auth.beginSetup({
    suppliedSetupToken: SETUP_TOKEN, username: 'owner', displayName: 'Owner', password: PASSWORD,
  });
  // Confirm setup with the code from the PREVIOUS step, so the replay guard leaves
  // steps 0 and +1 free for the test body. Confirming with the current step consumes
  // it, and every later assertion then fails as a legitimate replay.
  const session = auth.confirmSetup({ challenge: begun.challenge, totpCode: totpCode(begun.totpSecret, stepStart(-1)) });
  return { auth, ledger, workspace, secret: begun.totpSecret, session };
}

// verifyTotpStep accepts only steps within +/-1 of NOW, and consumeTotp additionally
// demands a strictly increasing step. So a test gets exactly three usable codes per
// authenticator — steps now-1, now, now+1 — and must spend them in order. Reaching for
// 'now + 5 minutes' produces a code the server correctly refuses, which reads as a
// product bug and is not one.
const STEP_MS = 30_000;
function stepStart(offset = 0) {
  return (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;
}
/** A code for the step `offset` away from the current one. Offset must be -1, 0 or 1. */
function codeAt(secret, offset = 0) {
  return totpCode(secret, stepStart(offset));
}
/** Presence codes, spent in increasing step order: first call 0, then +1. */
function presence(secret, nth = 0) {
  return codeAt(secret, nth);
}

describe('security overview', () => {
  test('reports MFA, sessions and lock state without ever exposing the secret', () => {
    const { auth, session } = bootstrap();
    const overview = auth.securityOverview(session.user.id, session.session.id);
    assert.equal(overview.username, 'owner');
    assert.equal(overview.role, 'owner');
    assert.equal(overview.mfaEnabled, true);
    assert.equal(overview.sessionCount, 1);
    assert.equal(overview.sessions[0].current, true);
    assert.equal(overview.locked, false);
    assert.equal(overview.passkeySupported, true, 'passkeys are implemented as of the WebAuthn ES256/none-attestation build');
    assert.deepEqual(overview.passkeys, [], 'a fresh account has no passkeys enrolled yet');
    // The whole serialised overview must not carry secret material.
    const serialised = JSON.stringify(overview);
    assert.ok(!/[A-Z2-7]{32}/.test(serialised), 'a base32 TOTP secret must never appear in the overview');
    assert.equal(serialised.includes('totp'), false);
  });
});

describe('password change', () => {
  test('requires the current password AND a current authenticator code', () => {
    const { auth, secret, session } = bootstrap();
    assert.throws(() => auth.changePassword({
      userId: session.user.id, sessionId: session.session.id,
      currentPassword: 'wrong password entirely', totpCode: presence(secret, 0),
      newPassword: 'a brand new passphrase here',
    }), /incorrect/i);
    assert.throws(() => auth.changePassword({
      userId: session.user.id, sessionId: session.session.id,
      currentPassword: PASSWORD, totpCode: '000000',
      newPassword: 'a brand new passphrase here',
    }), /incorrect/i);
  });

  test('enforces the password policy — the wrong result shape would accept anything', () => {
    const { auth, secret, session } = bootstrap();
    // passwordPolicy returns { valid, reasons }. Reading { ok, reason } instead makes
    // every password pass, including this one. That mistake was made and caught here.
    assert.throws(() => auth.changePassword({
      userId: session.user.id, sessionId: session.session.id,
      currentPassword: PASSWORD, totpCode: presence(secret, 0), newPassword: 'short',
    }), /at least 14 characters/i);
  });

  test('refuses to set the same password again', () => {
    const { auth, secret, session } = bootstrap();
    assert.throws(() => auth.changePassword({
      userId: session.user.id, sessionId: session.session.id,
      currentPassword: PASSWORD, totpCode: presence(secret, 0), newPassword: PASSWORD,
    }), /must differ/i);
  });

  test('changes the password, revokes other sessions and keeps the current one', () => {
    const { auth, secret, session, ledger } = bootstrap();
    const other = auth.createSession(session.user, { mfa: true });
    assert.equal(auth.securityOverview(session.user.id).sessionCount, 2);
    const result = auth.changePassword({
      userId: session.user.id, sessionId: session.session.id,
      currentPassword: PASSWORD, totpCode: presence(secret, 0),
      newPassword: 'an entirely different passphrase',
    });
    assert.equal(result.changed, true);
    assert.equal(result.revokedSessions, 1);
    const after = auth.securityOverview(session.user.id, session.session.id);
    assert.equal(after.sessionCount, 1);
    assert.equal(after.sessions[0].id, session.session.id, 'the caller keeps their own session');
    assert.ok(ledger.entries.some((e) => e.action === 'auth.password-changed'));
    // The new password works and the old one does not.
    assert.ok(auth.beginLogin({ username: 'owner', password: 'an entirely different passphrase' }));
    assert.throws(() => auth.beginLogin({ username: 'owner', password: PASSWORD }));
    assert.ok(other);
  });
});

describe('authenticator replacement', () => {
  test('the old secret keeps working until the new one is confirmed', () => {
    const { auth, secret, session } = bootstrap();
    const begun = auth.beginMfaReplacement({
      userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 0),
    });
    assert.ok(begun.challenge);
    assert.match(begun.otpauthUri, /^otpauth:\/\/totp\//);
    assert.match(begun.otpauthUri, /issuer=NOESAR%20Evolution/);
    assert.equal(begun.totpAlgorithm, 'SHA1');
    assert.equal(begun.totpDigits, 6);
    assert.equal(begun.totpPeriodSeconds, 30);
    assert.notEqual(begun.secret, secret, 'a replacement must not reissue the same secret');
    // An abandoned rotation must not lock the account: the live secret still logs in.
    const overview = auth.securityOverview(session.user.id);
    assert.equal(overview.mfaEnabled, true);
    assert.equal(overview.mfaUpdatedAt, null, 'nothing has been replaced yet');
  });

  test('demands two CONSECUTIVE codes', () => {
    const { auth, secret, session } = bootstrap();
    const begun = auth.beginMfaReplacement({
      userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 0),
    });
    // Same code twice is not two consecutive steps.
    assert.throws(() => auth.confirmMfaReplacement({
      userId: session.user.id, sessionId: session.session.id, challenge: begun.challenge,
      firstCode: totpCode(begun.secret, stepStart(0)), secondCode: totpCode(begun.secret, stepStart(0)),
    }), /consecutive/i);
    // Two steps apart is not consecutive either.
    assert.throws(() => auth.confirmMfaReplacement({
      userId: session.user.id, sessionId: session.session.id, challenge: begun.challenge,
      firstCode: totpCode(begun.secret, stepStart(-1)), secondCode: totpCode(begun.secret, stepStart(1)),
    }), /consecutive/i);
  });

  test('rejects a forged challenge', () => {
    const { auth, secret, session } = bootstrap();
    const begun = auth.beginMfaReplacement({
      userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 0),
    });
    assert.throws(() => auth.confirmMfaReplacement({
      userId: session.user.id, sessionId: session.session.id, challenge: 'not-the-challenge',
      firstCode: totpCode(begun.secret, stepStart(0)), secondCode: totpCode(begun.secret, stepStart(1)),
    }), /challenge/i);
  });

  test('swaps the secret atomically: the OLD authenticator stops working', () => {
    const { auth, secret, session, ledger } = bootstrap();
    const begun = auth.beginMfaReplacement({
      userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 0),
    });
    const result = auth.confirmMfaReplacement({
      userId: session.user.id, sessionId: session.session.id, challenge: begun.challenge,
      // Steps -1 and 0: consecutive, both inside the acceptance window, and they leave
      // step +1 unconsumed so the login below is not refused as a replay.
      firstCode: totpCode(begun.secret, stepStart(-1)), secondCode: totpCode(begun.secret, stepStart(0)),
    });
    assert.equal(result.replaced, true);
    assert.equal(result.recoveryCodes.length, 10, 'replacement reissues recovery codes');

    // The compromised secret must now be worthless. Prove it through a real login.
    const challenge = auth.beginLogin({ username: 'owner', password: PASSWORD });
    assert.throws(
      () => auth.completeLogin({ challenge: challenge.challenge, totpCode: codeAt(secret, 0) }),
      /invalid|incorrect/i,
      'the previous TOTP secret must be refused after replacement');

    // ...and the new one must work.
    const challenge2 = auth.beginLogin({ username: 'owner', password: PASSWORD });
    const session2 = auth.completeLogin({
      challenge: challenge2.challenge, totpCode: codeAt(begun.secret, 1),
    });
    assert.equal(session2.user.role, 'owner');

    // The ledger records the event and never the secret.
    const entry = ledger.entries.find((e) => e.action === 'auth.mfa-replaced');
    assert.ok(entry);
    assert.equal(JSON.stringify(entry).includes(begun.secret), false, 'the secret must never reach the ledger');
  });

  test('a cancelled replacement leaves the live authenticator untouched', () => {
    const { auth, secret, session } = bootstrap();
    auth.beginMfaReplacement({ userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 0) });
    auth.cancelMfaReplacement(session.user.id);
    assert.throws(() => auth.confirmMfaReplacement({
      userId: session.user.id, sessionId: session.session.id, challenge: 'anything',
      firstCode: '000000', secondCode: '000000',
    }), /no authenticator replacement/i);
    const challenge = auth.beginLogin({ username: 'owner', password: PASSWORD });
    assert.ok(auth.completeLogin({ challenge: challenge.challenge, totpCode: codeAt(secret, 1) }));
  });
});

describe('recovery codes', () => {
  test('are issued once, counted, and never recoverable from stored state', () => {
    const { auth, secret, session, workspace } = bootstrap();
    const result = auth.regenerateRecoveryCodes({
      userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 0),
    });
    assert.equal(result.codes.length, 10);
    for (const code of result.codes) assert.match(code, /^[0-9A-HJ-NP-TV-Z]{5}-[0-9A-HJ-NP-TV-Z]{5}$/);
    assert.equal(new Set(result.codes).size, 10, 'codes must be distinct');
    assert.equal(auth.securityOverview(session.user.id).recoveryCodesRemaining, 10);
    // Only digests are persisted: the plaintext must not be in the state file.
    const raw = readFileSync(`${workspace}/state/auth.json`, 'utf8');
    for (const code of result.codes) assert.equal(raw.includes(code), false, 'a recovery code reached disk in plaintext');
  });

  test('regenerating invalidates the previous set', () => {
    const { auth, secret, session } = bootstrap();
    const first = auth.regenerateRecoveryCodes({ userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 0) });
    const second = auth.regenerateRecoveryCodes({ userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 1) });
    assert.equal(first.codes.some((code) => second.codes.includes(code)), false);
    assert.equal(auth.securityOverview(session.user.id).recoveryCodesRemaining, 10);
  });
});

describe('sessions', () => {
  test('other sessions can be revoked, the current one cannot be revoked that way', () => {
    const { auth, session } = bootstrap();
    const other = auth.createSession(session.user, { mfa: true });
    assert.equal(auth.securityOverview(session.user.id).sessionCount, 2);
    assert.throws(() => auth.revokeSession({
      userId: session.user.id, sessionId: session.session.id, targetSessionId: session.session.id,
    }), /sign out/i);
    const result = auth.revokeSession({
      userId: session.user.id, sessionId: session.session.id, targetSessionId: other.session.id,
    });
    assert.equal(result.revoked, 1);
    assert.equal(auth.securityOverview(session.user.id).sessionCount, 1);
  });

  test('revoke-others keeps exactly the calling session', () => {
    const { auth, session } = bootstrap();
    auth.createSession(session.user, { mfa: true });
    auth.createSession(session.user, { mfa: true });
    const result = auth.revokeOtherSessions({ userId: session.user.id, sessionId: session.session.id });
    assert.equal(result.revoked, 2);
    const after = auth.securityOverview(session.user.id, session.session.id);
    assert.equal(after.sessionCount, 1);
    assert.equal(after.sessions[0].current, true);
  });
});

describe('replay protection carries across the new operations', () => {
  test('one code cannot drive two sensitive changes', () => {
    const { auth, secret, session } = bootstrap();
    const code = codeAt(secret, 0);
    auth.changePassword({
      userId: session.user.id, sessionId: session.session.id,
      currentPassword: PASSWORD, totpCode: code, newPassword: 'first replacement passphrase',
    });
    assert.throws(() => auth.regenerateRecoveryCodes({
      userId: session.user.id, password: 'first replacement passphrase', totpCode: code,
    }), /already been used/i);
  });
});

test('base32 round-trip sanity for the secrets these flows mint', () => {
  const { auth, secret, session } = bootstrap();
  const begun = auth.beginMfaReplacement({ userId: session.user.id, password: PASSWORD, totpCode: presence(secret, 0) });
  assert.equal(base32Decode(begun.secret).length, 20, 'a 160-bit secret, as RFC 4226 recommends');
});
