// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0348 — the second gesture disappears. The Owner asked for one word: open ssh, type
// `coden_evolution`, be in. `D-0337` had already removed the second AUTHENTICATION; what
// stayed was a second GESTURE, the attach code read off a browser and retyped.
//
// What these tests defend, and it is a different perimeter from an attach code's. A
// remembered terminal is a NINETY-DAY bearer token, so "time and single use" — the entire
// perimeter of a 60-second attach code — is exactly what it does not have. What it has
// instead is: it is never displayed, it is stored only as a digest, it cannot be created by
// a session that did not pass a second factor, it never carries elevation, it is revocable
// from both ends, and it dies with the account. Every test below is one of those.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLedger } from '../src/audit.mjs';
import { AuthService } from '../src/auth.mjs';
import { totpCode } from '../src/auth-crypto.mjs';
import { freshTempDir } from './support/workspace.mjs';

const PASSWORD = 'correct horse battery staple';

function setup() {
  const workspace = freshTempDir('noesar-terminal-');
  const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
  const auth = new AuthService({ workspace, setupToken: 'setup-secret-value', ledger });
  const pending = auth.beginSetup({ suppliedSetupToken: 'setup-secret-value', username: 'owner', displayName: 'Owner', password: PASSWORD });
  const session = auth.confirmSetup({ challenge: pending.challenge, totpCode: totpCode(pending.totpSecret, Date.now() - 30_000) });
  return { workspace, ledger, auth, session };
}

function readState(workspace) {
  return JSON.parse(readFileSync(join(workspace, 'state/auth.json'), 'utf8'));
}

describe('remembered terminals — a possession factor, not a shortcut past one', () => {
  test('a remembered terminal opens a session for the SAME account, with nothing typed', () => {
    const { auth, session } = setup();
    const issued = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id, label: 'owner@box' });
    assert.ok(issued.token, 'no token came back');

    const opened = auth.resumeTerminal({ token: issued.token, ip: 'unix-socket' });
    assert.equal(opened.user.id, session.user.id);
    assert.equal(opened.session.mfa, true, 'the second factor the enrolment rested on is not carried');
  });

  test('the token is never stored in a form that can be spent', () => {
    const { auth, session, workspace } = setup();
    const issued = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id });
    const raw = readFileSync(join(workspace, 'state/auth.json'), 'utf8');
    assert.equal(raw.includes(issued.token), false, 'the plaintext token is in the state file');
    const [record] = readState(workspace).terminals;
    assert.ok(record.tokenDigest, 'no digest was stored');
    assert.notEqual(record.tokenDigest, issued.token);
  });

  test('elevation is NOT inherited — a remembered terminal still steps up', () => {
    const { auth, session } = setup();
    // The originating session is really elevated first. Without this the assertion below is
    // vacuous: `createSession` writes `elevatedUntil: 0` on every path, so a session that was
    // never elevated proves nothing about inheritance. What is being tested is that elevation
    // held HERE does not travel through the token.
    auth.store.update((next) => {
      next.sessions.find((item) => item.id === session.session.id).elevatedUntil = Date.now() + 5 * 60_000;
    });
    const issued = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id });
    const opened = auth.resumeTerminal({ token: issued.token, ip: 'unix-socket' });
    assert.ok(!(opened.session.elevatedUntil > Date.now()), 'elevation travelled through the remembered terminal');
  });

  test('a session that never passed a second factor cannot remember a terminal', () => {
    const { auth, session } = setup();
    auth.store.update((next) => {
      const record = next.sessions.find((item) => item.id === session.session.id);
      record.mfa = false;
    });
    assert.throws(
      () => auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id }),
      /cannot remember a terminal/,
      'a weaker session was laundered into a ninety-day credential',
    );
  });

  test('remembering on behalf of ANOTHER account is refused', () => {
    const { auth, session } = setup();
    assert.throws(
      () => auth.rememberTerminal({ userId: 'somebody-else', sessionId: session.session.id }),
      /No live session/,
    );
  });

  test('a revoked terminal stops opening, and says the same thing an unknown one says', () => {
    const { auth, session } = setup();
    const issued = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id });
    auth.revokeRememberedTerminal({ userId: session.user.id, id: issued.id });

    let revokedMessage;
    try { auth.resumeTerminal({ token: issued.token, ip: 'unix-socket' }); }
    catch (error) { revokedMessage = error.message; }
    let unknownMessage;
    try { auth.resumeTerminal({ token: 'not-a-real-token', ip: 'unix-socket' }); }
    catch (error) { unknownMessage = error.message; }

    assert.ok(revokedMessage, 'a revoked terminal still opened');
    // The oracle test: four different refusals would tell a caller which tokens once existed.
    assert.equal(revokedMessage, unknownMessage, 'refusals distinguish revoked from unknown');
  });

  test('an expired terminal is refused, and use slides the expiry so a daily one never expires', () => {
    const { auth, session } = setup();
    const issued = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id });

    // Pushed to the edge of expiry first. Comparing two timestamps taken milliseconds apart
    // would pass whether the expiry slid or was simply left alone — the assertion has to be
    // that a nearly-dead terminal comes back with months on it, not that a number grew.
    auth.store.update((next) => { next.terminals[0].expiresAt = Date.now() + 1_000; });
    auth.resumeTerminal({ token: issued.token, ip: 'unix-socket' });
    const after = readState(auth.workspace).terminals[0].expiresAt;
    assert.ok(after - Date.now() > 80 * 24 * 60 * 60_000, 'using a terminal did not slide its expiry');

    auth.store.update((next) => { next.terminals[0].expiresAt = Date.now() - 1; });
    assert.throws(() => auth.resumeTerminal({ token: issued.token, ip: 'unix-socket' }), /not remembered here/);
  });

  test('disabling the account kills its remembered terminals', () => {
    const { auth, session } = setup();
    const issued = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id });
    auth.store.update((next) => { next.users[0].status = 'disabled'; });
    assert.throws(() => auth.resumeTerminal({ token: issued.token, ip: 'unix-socket' }), /not remembered here/);
  });

  test('`forget` spends possession, not identity, and answers the same either way', () => {
    const { auth, session } = setup();
    const issued = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id });

    assert.deepEqual(auth.forgetTerminalToken({ token: issued.token }), { forgotten: true });
    assert.throws(() => auth.resumeTerminal({ token: issued.token, ip: 'unix-socket' }), /not remembered here/);
    // A token that was never real gets the identical answer — no confirmation that some
    // other token is still live.
    assert.deepEqual(auth.forgetTerminalToken({ token: 'never-existed' }), { forgotten: true });
  });

  test('the list shows only this account\'s live terminals, and never a token', () => {
    const { auth, session } = setup();
    const kept = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id, label: 'kept' });
    const gone = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id, label: 'gone' });
    auth.revokeRememberedTerminal({ userId: session.user.id, id: gone.id });

    const listed = auth.listRememberedTerminals(session.user.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, kept.id);
    assert.equal(listed[0].label, 'kept');
    assert.equal(JSON.stringify(listed).includes(kept.token), false, 'the list leaks the token');
  });

  test('a label is data, not markup: it is trimmed and capped before it is stored', () => {
    const { auth, session, workspace } = setup();
    auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id, label: `  ${'x'.repeat(200)}  ` });
    assert.equal(readState(workspace).terminals[0].label.length, 64);
  });

  test('revoking another account\'s terminal is refused', () => {
    const { auth, session } = setup();
    const issued = auth.rememberTerminal({ userId: session.user.id, sessionId: session.session.id });
    assert.throws(() => auth.revokeRememberedTerminal({ userId: 'someone-else', id: issued.id }), /No such remembered terminal/);
  });
});
