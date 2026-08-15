// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0337 — one authentication, not two. A browser session already inside NOESAR mints a
// short single-use code; the terminal spends it at the unix socket instead of asking the
// same operator for username, password and second factor a second time.
//
// What these tests are defending. The code cannot be bound to the caller's address — it is
// born at a browser and spent on a socket that calls itself `unix-socket` — so the two
// bounds that remain, TIME and SINGLE USE, are the entire perimeter. Every test below
// exists because one of them failing silently would turn a claim ticket into a bearer
// credential with an eight-hour life, which is precisely the trade `16` §4.3 forbids:
// "access conveniences are not paid for with authority".

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLedger } from '../src/audit.mjs';
import { AuthService, normalizeAttachCode } from '../src/auth.mjs';
import { totpCode } from '../src/auth-crypto.mjs';
import { freshTempDir } from './support/workspace.mjs';

const PASSWORD = 'correct horse battery staple';

function setup() {
  const workspace = freshTempDir('noesar-attach-');
  const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
  const auth = new AuthService({ workspace, setupToken:'setup-secret-value', ledger });
  const pending = auth.beginSetup({ suppliedSetupToken:'setup-secret-value', username:'owner', displayName:'Owner', password:PASSWORD });
  // Setup spends the PREVIOUS step, leaving the current one unspent — the same fixture
  // reasoning auth.test.mjs documents: a TOTP code is single-use since F4-002.
  const session = auth.confirmSetup({ challenge:pending.challenge, totpCode:totpCode(pending.totpSecret, Date.now() - 30_000) });
  return { workspace, ledger, auth, session, secret:pending.totpSecret };
}

/** A second real account in the same store, so cross-account tests have a genuine other. */
function addSecondUser(auth) {
  return auth.store.update((next) => {
    const clone = { ...next.users[0], id:'second-user-id', username:'second', displayName:'Second' };
    next.users.push(clone);
    return clone.id;
  });
}

function readState(workspace) {
  return JSON.parse(readFileSync(join(workspace, 'state/auth.json'), 'utf8'));
}

describe('terminal attach codes — the two bounds that are the whole perimeter', () => {
  test('a minted code opens a session for the SAME account, over the socket transport', () => {
    const { auth, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    assert.match(minted.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, 'the code is not in the transcription-safe alphabet');

    const issued = auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' });
    assert.equal(issued.user.id, session.user.id);
    assert.equal(issued.user.username, 'owner');
    // The second factor is carried, not waived: minting already refused any session that
    // lacked it, so this flag rests on a real one the browser passed.
    assert.equal(issued.session.mfa, true);
    // Elevation is re-earned, never inherited. A code that carried elevation forward would
    // let a browser hand a terminal more authority than the terminal ever proved.
    assert.equal(issued.session.elevatedUntil, 0);
    // It is a NEW session, not a share of the old one: revoking one must not revoke the other.
    assert.notEqual(issued.session.id, session.session.id);
  });

  test('SINGLE USE · a code spent twice fails the second time', () => {
    const { auth, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' });
    assert.throws(
      () => auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' }),
      /Invalid or expired attach code/,
      'the same code opened a second session',
    );
  });

  test('SINGLE USE · the guarantee survives a find and a delete that are not one step apart', () => {
    // The property is structural, not incidental: `redeemAttachCode` finds and removes the
    // record inside ONE `store.update` mutator. `AuthStore.update` is a synchronous
    // read-modify-write, so nothing can interleave inside it — but a `read()` followed by a
    // separate `update()`, the idiom used elsewhere in auth.mjs, would leave a window where
    // two callers both saw the same live code. This asserts the observable consequence: the
    // record is gone from the persisted state the instant the first redemption returns.
    const { auth, workspace, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    assert.equal(readState(workspace).attachCodes.length, 1);
    auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' });
    assert.equal(readState(workspace).attachCodes.length, 0, 'a spent code was left in the store');
  });

  test('TIME · an expired code fails, and is not merely hidden', () => {
    const { auth, workspace, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    // Age the record rather than sleeping sixty seconds: the branch under test is the
    // expiry comparison, and a test that waits for real time to pass would test the clock.
    auth.store.update((next) => { next.attachCodes[0].expiresAt = Date.now() - 1; });
    assert.throws(
      () => auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' }),
      /Invalid or expired attach code/,
    );
    assert.equal(readState(workspace).attachCodes.length, 0, 'an expired code was left in the store');
  });

  test('TIME · the declared window is sixty seconds, and the caller is told when it ends', () => {
    const { auth, session } = setup();
    const before = Date.now();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    assert.equal(minted.expiresInMs, 60_000);
    const expiresAt = Date.parse(minted.expiresAt);
    assert.ok(expiresAt >= before + 60_000 && expiresAt <= Date.now() + 60_000,
      `expiry ${minted.expiresAt} is not one minute out`);
  });

  test('AUTHORITY · a code minted by one account never opens a session for another', () => {
    const { auth, session } = setup();
    const otherId = addSecondUser(auth);

    // The claimed userId is checked against the session, never taken on trust. Without this
    // an authenticated caller could name someone else's account on a request they control.
    assert.throws(
      () => auth.mintAttachCode({ userId:otherId, sessionId:session.session.id }),
      /No live session to attach from/,
      'a session minted a code in another account name',
    );

    // And the happy path, with a second account present, still resolves to the minter.
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    const issued = auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' });
    assert.equal(issued.user.id, session.user.id);
    assert.notEqual(issued.user.id, otherId);
  });

  test('AUTHORITY · a session that has been logged out cannot mint', () => {
    const { auth, session } = setup();
    auth.logout(session.session.id, session.user.id);
    assert.throws(
      () => auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id }),
      /No live session to attach from/,
    );
  });

  test('AUTHORITY · an EXPIRED session cannot mint, and that is a separate branch', () => {
    // Found by mutation, and it was a real gap. The test above passed for a reason it did
    // not intend: `logout` REMOVES the record, so it only ever exercised "no such session".
    // Deleting the expiry comparison from `mintAttachCode` left every test green.
    //
    // The branch is reachable, not theoretical: `next.sessions` is pruned of expired
    // records only when a NEW session is created, so an expired record sits in the store
    // until someone logs in again. In the assembled server `requireSession` would reject
    // the caller first — but that makes this defence in depth, and defence in depth that
    // nothing measures is a comment, not a defence.
    for (const field of ['expiresAt', 'idleExpiresAt']) {
      const { auth, session } = setup();
      auth.store.update((next) => {
        next.sessions.find((item) => item.id === session.session.id)[field] = Date.now() - 1;
      });
      assert.throws(
        () => auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id }),
        /No live session to attach from/,
        `an expired session minted a code (${field})`,
      );
    }
  });

  test('AUTHORITY · a session without a second factor cannot mint one', () => {
    // Fail-closed, and it matters because `createSession`'s `mfa` parameter DEFAULTS to
    // false. Any future call site that forgets to pass it would otherwise gain a path to a
    // terminal session that never saw a second factor.
    const { auth, session } = setup();
    auth.store.update((next) => {
      next.sessions.find((item) => item.id === session.session.id).mfa = false;
    });
    assert.throws(
      () => auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id }),
      /cannot mint a terminal attach code/,
    );
  });

  test('a code whose minting session is gone is refused, and consumed by the attempt', () => {
    const { auth, workspace, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    auth.logout(session.session.id, session.user.id);
    assert.throws(() => auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' }), /Invalid or expired attach code/);
    // Burned by the attempt, not by success: leaving it live would mean a code already sent
    // over a wire outlives the intent that produced it.
    assert.equal(readState(workspace).attachCodes.length, 0);
  });

  test('a code for a disabled account is refused even though the code itself was valid', () => {
    const { auth, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    auth.store.update((next) => { next.users.find((item) => item.id === session.user.id).status = 'disabled'; });
    assert.throws(() => auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' }), /Invalid or expired attach code/);
  });

  test('minting again cancels the previous unspent code from the same session', () => {
    const { auth, workspace, session } = setup();
    const first = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    const second = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    assert.notEqual(first.code, second.code);
    assert.equal(readState(workspace).attachCodes.length, 1, 'two live codes exist for one session');
    assert.throws(() => auth.redeemAttachCode({ code:first.code, ip:'unix-socket' }), /Invalid or expired attach code/);
    assert.equal(auth.redeemAttachCode({ code:second.code, ip:'unix-socket' }).user.id, session.user.id);
  });

  test('the code is never stored in plaintext, only its digest', () => {
    const { auth, workspace, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    const text = readFileSync(join(workspace, 'state/auth.json'), 'utf8');
    assert.equal(text.includes(minted.code), false, 'a readable code sits in the state file');
    assert.equal(text.includes(normalizeAttachCode(minted.code)), false);
  });

  test('a typed code is read forgivingly, but only in ways that cannot change it', () => {
    const { auth, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    // Case and surrounding whitespace are transport noise, not content. The alphabet
    // deliberately excludes I, L, O and U so no slip a human makes maps one valid code onto
    // a different valid code — which is why normalising case is safe here and would not be
    // safe over an alphabet that contained both O and 0.
    const typed = ` ${minted.code.toLowerCase()} `;
    assert.equal(auth.redeemAttachCode({ code:typed, ip:'unix-socket' }).user.id, session.user.id);
  });

  test('a wrong code does not consume the right one', () => {
    // This is what makes the terminal client offer a retry at all. If a miss burned the
    // live code, retrying would be theatre — the operator would have to go back to the
    // browser after a single typo.
    const { auth, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    assert.throws(() => auth.redeemAttachCode({ code:'ZZZZ-ZZZZ', ip:'unix-socket' }), /Invalid or expired attach code/);
    assert.equal(auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' }).user.id, session.user.id);
  });

  test('repeated misses are rate limited, on a budget of their own', () => {
    const { auth } = setup();
    // Counted separately from password failures — the key is distinct — and set high enough
    // that a human mistyping an eight-character code read off another screen is not locked
    // out of their own terminal. Entropy and the sixty-second window are what make guessing
    // hopeless; this only stops a loop.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.throws(() => auth.redeemAttachCode({ code:'ZZZZ-ZZZZ', ip:'unix-socket' }), /Invalid or expired attach code/);
    }
    assert.throws(() => auth.redeemAttachCode({ code:'ZZZZ-ZZZZ', ip:'unix-socket' }), /Too many attach attempts/);
  });

  test('a state file written before this feature existed still reads', () => {
    // `attachCodes` is defaulted in `emptyState()` and spread UNDER the parsed file, so an
    // installation upgrading into this build has an empty array rather than `undefined`,
    // which every `.filter` on it depends on. No migration, and therefore no schemaVersion
    // bump: a version number that moves with nothing behind it is a claim, not a fact.
    const { auth, workspace, session } = setup();
    auth.store.update((next) => { delete next.attachCodes; });
    assert.equal('attachCodes' in readState(workspace), false, 'the fixture did not actually remove the field');
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    assert.equal(auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' }).user.id, session.user.id);
  });

  test('the audit ledger records the mint, the spend and the refusal', () => {
    const { auth, workspace, session } = setup();
    const minted = auth.mintAttachCode({ userId:session.user.id, sessionId:session.session.id });
    auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' });
    assert.throws(() => auth.redeemAttachCode({ code:minted.code, ip:'unix-socket' }), /Invalid or expired/);
    const actions = readFileSync(join(workspace, 'audit/events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line).action);
    for (const expected of ['auth.attach-code-minted', 'auth.attach-succeeded', 'auth.attach-failed']) {
      assert.ok(actions.includes(expected), `the ledger never recorded ${expected}`);
    }
  });
});
