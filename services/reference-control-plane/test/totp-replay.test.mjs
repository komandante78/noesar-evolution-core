// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression tests for F4-002 (Phase 4 acceptance).
//
// The delivered TOTP verification checked only whether a code was arithmetically valid
// for the current +/-1-step window. A code is therefore valid for up to 90 seconds, and
// nothing recorded that it had already been spent — so a code observed once could be
// replayed on a second, independent login and the second factor stopped being a second
// factor. RFC 6238 section 5.2 is explicit: "the verifier MUST NOT accept the second
// attempt of the OTP generated for the same time-step".
//
// The Phase 3 security matrix listed MFA as IMPLEMENTED with residual risk "none" and
// named "replayed code rejection" as Phase 4 acceptance work. This is that work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService } from '../src/auth.mjs';
import { createTotpSecret, totpCode, verifyTotp, verifyTotpStep } from '../src/auth-crypto.mjs';

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-totp-'));
  const ledger = { entries: [], append(entry) { this.entries.push(entry); } };
  return { workspace, ledger, auth: new AuthService({ workspace, setupToken: 'setup-token-for-tests-only', ledger }) };
}

const PASSWORD = 'a-sufficiently-long-test-passphrase';

const STEP_MS = 30_000;

/**
 * Block until there is at least `headroomMs` left in the current TOTP step.
 *
 * Why this exists: several tests below generate a code, run a login, and then assert that
 * the code is still arithmetically valid. That holds only while the wall clock stays
 * inside the same step. Crossing a boundary mid-test pushes the previous step's code two
 * steps behind "now", outside the +/-1 acceptance window, and the assertion fails for a
 * reason the test was never about.
 *
 * Observed, not hypothesised: 1 failure in 50 isolated runs of this file, reproduced by
 * tools/flake-stress.mjs, with exactly this signature. Phase 4 saw the same failure once,
 * could not reproduce it, and recorded it as an unexplained flake.
 *
 * A synchronous spin is used rather than an async sleep because these tests are
 * synchronous, and the wait is bounded by one step and only happens when a test would
 * otherwise start in the last few seconds of one.
 */
function anchorInsideStep(headroomMs = 10_000) {
  for (;;) {
    const now = Date.now();
    if (STEP_MS - (now % STEP_MS) >= headroomMs) return now;
    // Busy-wait to the boundary. Bounded by headroomMs, in practice a few seconds.
    const until = now + (STEP_MS - (now % STEP_MS)) + 5;
    while (Date.now() < until) { /* spin to the next step boundary */ }
  }
}

/**
 * Bootstrap an owner, deliberately spending the PREVIOUS time step.
 *
 * Setup consumes a step like any other flow, so a bootstrap that spends the current step
 * would make the very next login with a current-step code fail — correctly, but for the
 * wrong reason, hiding whatever the test meant to check. Using the previous step (still
 * inside the acceptance window) leaves the current step unspent.
 */
function bootstrap(f) {
  const begun = f.auth.beginSetup({ suppliedSetupToken: 'setup-token-for-tests-only', username: 'owner', displayName: 'Owner', password: PASSWORD });
  const session = f.auth.confirmSetup({ challenge: begun.challenge, totpCode: totpCode(begun.totpSecret, Date.now() - 30_000) });
  return { secret: begun.totpSecret, session };
}

test('verifyTotpStep reports the step that matched, and it moves with time', () => {
  const secret = createTotpSecret();
  const at = 1_700_000_000_000;
  const a = verifyTotpStep(secret, totpCode(secret, at), at);
  const b = verifyTotpStep(secret, totpCode(secret, at + 60_000), at + 60_000);
  assert.equal(a.valid, true);
  assert.equal(b.valid, true);
  assert.equal(b.step, a.step + 2, 'two 30-second steps apart');
  assert.equal(verifyTotpStep(secret, '000000', at).valid, false);
  assert.equal(verifyTotpStep(secret, 'abcdef', at).step, null);
});

test('verifyTotp still behaves as before for callers that only need validity', () => {
  const secret = createTotpSecret();
  assert.equal(verifyTotp(secret, totpCode(secret)), true);
  assert.equal(verifyTotp(secret, '000000'), false);
  // The +/-1 step window is unchanged: a code from the adjacent step is still arithmetically valid.
  assert.equal(verifyTotp(secret, totpCode(secret, Date.now() - 30_000)), true);
});

test('a code accepted at login cannot be replayed on a second login', () => {
  const f = fixture();
  try {
    const { secret } = bootstrap(f);
    const code = totpCode(secret);

    const first = f.auth.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    const ok = f.auth.completeLogin({ challenge: first.challenge, totpCode: code, ip: '127.0.0.1' });
    assert.equal(ok.user.username, 'owner', 'the first use must succeed');

    const second = f.auth.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    assert.throws(
      () => f.auth.completeLogin({ challenge: second.challenge, totpCode: code, ip: '127.0.0.1' }),
      (error) => {
        assert.equal(error.status, 401);
        assert.match(error.message, /already been used/);
        return true;
      },
      'the same code must not authenticate a second session',
    );
    assert.ok(f.ledger.entries.some((e) => e.action === 'auth.mfa-replayed'), 'the replay attempt must be audited distinctly');
  } finally { rmSync(f.workspace, { recursive: true, force: true }); }
});

test('the code used to complete setup cannot then be used to log in', () => {
  const f = fixture();
  try {
    const begun = f.auth.beginSetup({ suppliedSetupToken: 'setup-token-for-tests-only', username: 'owner', displayName: 'Owner', password: PASSWORD });
    const code = totpCode(begun.totpSecret);
    f.auth.confirmSetup({ challenge: begun.challenge, totpCode: code });
    const login = f.auth.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    assert.throws(() => f.auth.completeLogin({ challenge: login.challenge, totpCode: code, ip: '127.0.0.1' }), /already been used/);
  } finally { rmSync(f.workspace, { recursive: true, force: true }); }
});

test('a code used for login cannot then be used for step-up reauthentication', () => {
  const f = fixture();
  try {
    const { secret } = bootstrap(f);
    const code = totpCode(secret);
    const login = f.auth.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    const session = f.auth.completeLogin({ challenge: login.challenge, totpCode: code, ip: '127.0.0.1' });
    assert.throws(
      () => f.auth.reauthenticate({ sessionId: session.session.id, password: PASSWORD, totpCode: code }),
      (error) => { assert.equal(error.status, 403); assert.match(error.message, /already been used/); return true; },
    );
    assert.ok(f.ledger.entries.some((e) => e.action === 'auth.reauth-replayed'));
  } finally { rmSync(f.workspace, { recursive: true, force: true }); }
});

test('an older code from within the window is refused once a newer one has been spent', () => {
  // Start with a whole step of headroom, so the sequence below cannot cross a boundary.
  const anchor = anchorInsideStep();
  const f = fixture();
  try {
    const { secret } = bootstrap(f);
    // Spend the current step, then present the previous step's code — still
    // arithmetically valid inside the window, but strictly older.
    const current = totpCode(secret, anchor);
    const previous = totpCode(secret, anchor - STEP_MS);
    // bootstrap already spent step-1, so this is the same step it spent: still valid
    // arithmetically, strictly older than the step just consumed by the login below.
    const a = f.auth.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    f.auth.completeLogin({ challenge: a.challenge, totpCode: current, ip: '127.0.0.1' });
    const b = f.auth.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    // Two adjacent steps can produce the same six digits by coincidence (about one time
    // in a million); there is then no "older" code to present and nothing to assert.
    if (previous === current) return;
    // Verified against the anchor, not against a freshly sampled clock: re-sampling is
    // precisely what made this assertion depend on when it happened to run.
    assert.equal(verifyTotp(secret, previous, anchor), true,
      'the older code is still arithmetically valid, which is the point');
    assert.throws(() => f.auth.completeLogin({ challenge: b.challenge, totpCode: previous, ip: '127.0.0.1' }), /already been used/);
  } finally { rmSync(f.workspace, { recursive: true, force: true }); }
});

test('a fresh code from the next step is still accepted, so the fix does not lock the owner out', () => {
  const f = fixture();
  try {
    const { secret } = bootstrap(f);
    const first = f.auth.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    f.auth.completeLogin({ challenge: first.challenge, totpCode: totpCode(secret), ip: '127.0.0.1' });

    // A genuinely newer code, as an authenticator would produce 30 seconds later.
    const later = totpCode(secret, Date.now() + 30_000);
    const second = f.auth.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    const ok = f.auth.completeLogin({ challenge: second.challenge, totpCode: later, ip: '127.0.0.1' });
    assert.equal(ok.user.username, 'owner', 'a newer code must still work; single-use must not become no-use');
  } finally { rmSync(f.workspace, { recursive: true, force: true }); }
});

test('the spent step survives a restart of the service', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-totp-persist-'));
  const ledger = { entries: [], append(entry) { this.entries.push(entry); } };
  try {
    const first = new AuthService({ workspace, setupToken: 'setup-token-for-tests-only', ledger });
    const begun = first.beginSetup({ suppliedSetupToken: 'setup-token-for-tests-only', username: 'owner', displayName: 'Owner', password: PASSWORD });
    first.confirmSetup({ challenge: begun.challenge, totpCode: totpCode(begun.totpSecret, Date.now() - 30_000) });
    const code = totpCode(begun.totpSecret);
    const login = first.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    first.completeLogin({ challenge: login.challenge, totpCode: code, ip: '127.0.0.1' });

    // A new AuthService over the same workspace is exactly what a restart looks like.
    const restarted = new AuthService({ workspace, setupToken: 'setup-token-for-tests-only', ledger });
    const again = restarted.beginLogin({ username: 'owner', password: PASSWORD, ip: '127.0.0.1' });
    assert.throws(() => restarted.completeLogin({ challenge: again.challenge, totpCode: code, ip: '127.0.0.1' }), /already been used/,
      'replay protection that lives only in memory is defeated by a restart');
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
