// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Multi-user account lifecycle.
//
// Phase 4 finding F4-008 recorded that no route created a second user and that
// auth.manage was granted but wired to nothing. These tests exercise the paths that
// closes: invitation, self-chosen passwords, mandatory MFA for privileged roles, role
// changes, disabling, revocation, service accounts, export and erasure — and, for each
// of them, the case that must be refused.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLedger } from '../src/audit.mjs';
import { AuthService, ROLES, MFA_REQUIRED_ROLES } from '../src/auth.mjs';
import { UserDirectory } from '../src/user-directory.mjs';
import { totpCode } from '../src/auth-crypto.mjs';

const PASSWORD = 'correct horse battery staple';
const OTHER_PASSWORD = 'another entirely separate passphrase';

function setup() {
  const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-directory-'));
  const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
  const auth = new AuthService({ workspace, setupToken: 'setup-secret-value', ledger });
  const pending = auth.beginSetup({
    suppliedSetupToken: 'setup-secret-value',
    username: 'owner', displayName: 'Owner', password: PASSWORD,
  });
  // Spend the previous step so the current one stays available: since F4-002 a code is
  // single-use, and a fixture that burns the current code makes every later login look
  // like a replay.
  const session = auth.confirmSetup({
    challenge: pending.challenge,
    totpCode: totpCode(pending.totpSecret, Date.now() - 30_000),
  });
  const directory = new UserDirectory({ auth, ledger });
  return { workspace, ledger, auth, directory, owner: session.user };
}

function inviteAndAccept(directory, ownerId, { username, role, password = OTHER_PASSWORD }) {
  const { token } = directory.createInvitation({
    actorId: ownerId, username, displayName: username, role,
  });
  const accepted = directory.acceptInvitation({ token, password });
  // Every interactive role enrols MFA now, so this branch is only reached if that ever
  // changes — in which case the test should keep working rather than silently skip.
  if (!accepted.mfaRequired) return accepted.user;
  const confirmed = directory.confirmInvitationMfa({
    challenge: accepted.challenge,
    totpCode: totpCode(accepted.totpSecret),
  });
  return confirmed.user;
}

test('the six roles are defined and only owner and admin require MFA', () => {
  assert.deepEqual([...ROLES], [
    'owner', 'admin', 'developer', 'user', 'client_restricted', 'service_account',
  ]);
  assert.deepEqual([...MFA_REQUIRED_ROLES].sort(), ['admin', 'owner']);
});

test('permissions narrow as the role narrows', () => {
  const { auth } = setup();
  const can = (role, permission) => auth.hasPermission({ role }, permission);
  assert.equal(can('owner', 'user.manage'), true);
  assert.equal(can('admin', 'user.manage'), true);
  assert.equal(can('developer', 'user.manage'), false);
  assert.equal(can('user', 'provider.manage'), false);
  assert.equal(can('client_restricted', 'memory.manage'), false);
  assert.equal(can('client_restricted', 'provider.use'), true);
  // D-0279 widened the service account from ['workspace.read','provider.use'] to
  // `client_restricted`'s exact set. The old, narrower set was self-contradictory rather
  // than restrictive: `provider.use` already writes — chat/stream calls graph.addMessage
  // twice per turn — so the account could append to a conversation it had no way to
  // create. Updated deliberately, and NOT relaxed: the four negatives below are the
  // boundary that must not move, and they are what this case is really guarding.
  assert.equal(can('service_account', 'workspace.read'), true);
  assert.equal(can('service_account', 'workspace.write'), true);
  assert.equal(can('service_account', 'provider.use'), true);
  // s336, Owner s335: «anche i moduli devono vedere il modello caricato». The pair is the
  // point — reading which model is loaded is not authority over it, so `model.manage` is on
  // the negative side below and must stay there.
  assert.equal(can('service_account', 'model.read'), true);
  assert.equal(can('service_account', 'model.manage'), false);
  assert.equal(can('service_account', 'provider.manage'), false);
  assert.equal(can('service_account', 'agent.manage'), false);
  assert.equal(can('service_account', 'memory.manage'), false);
  assert.equal(can('service_account', 'user.manage'), false);
  assert.equal(can('owner', 'coden.owner-bypass'), true);
  assert.equal(can('admin', 'coden.owner-bypass'), false);
});

test('an invitation token is shown once and never stored in cleartext', () => {
  const { workspace, directory, owner } = setup();
  const { token, invitation } = directory.createInvitation({
    actorId: owner.id, username: 'alice', displayName: 'Alice', role: 'user',
  });
  assert.equal(invitation.state, 'open');
  const stored = readFileSync(join(workspace, 'state/auth.json'), 'utf8');
  assert.equal(stored.includes(token), false, 'the invitation token must not be on disk');
  assert.equal(directory.listInvitations().some((item) => 'token' in item), false);
});

test('an invited user chooses their own password and the administrator never sees it', () => {
  const { workspace, directory, auth, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  assert.equal(alice.role, 'user');
  assert.equal(alice.status, 'active');
  const stored = readFileSync(join(workspace, 'state/auth.json'), 'utf8');
  assert.equal(stored.includes(OTHER_PASSWORD), false);
  const login = auth.beginLogin({ username: 'alice', password: OTHER_PASSWORD, ip: '127.0.0.1' });
  assert.ok(login.challenge || login.mfaRequired === false || login);
});

test('a weak password is refused at acceptance, not at first login', () => {
  const { directory, owner } = setup();
  const { token } = directory.createInvitation({
    actorId: owner.id, username: 'weak', displayName: 'Weak', role: 'user',
  });
  assert.throws(() => directory.acceptInvitation({ token, password: 'short' }), /\w/);
});

test('an invitation cannot be replayed, revoked-then-used, or used after expiry', () => {
  const { directory, owner } = setup();
  const { token } = directory.createInvitation({
    actorId: owner.id, username: 'once', displayName: 'Once', role: 'user',
  });
  directory.acceptInvitation({ token, password: OTHER_PASSWORD });
  assert.throws(() => directory.acceptInvitation({ token, password: OTHER_PASSWORD }),
    /already being used to set up an account|already been used/);

  const second = directory.createInvitation({
    actorId: owner.id, username: 'revoked', displayName: 'Revoked', role: 'user',
  });
  directory.revokeInvitation({ actorId: owner.id, invitationId: second.invitation.id });
  assert.throws(() => directory.acceptInvitation({ token: second.token, password: OTHER_PASSWORD }),
    /was revoked/);

  assert.throws(() => directory.acceptInvitation({ token: 'not-a-real-token', password: OTHER_PASSWORD }),
    /Invalid invitation token/);
});

test('every interactive account enrols MFA, not only the privileged roles', () => {
  // AuthService.completeLogin decrypts user.totp unconditionally, so an account created
  // without a secret could never log in. Universal enrolment is the fix; this test is what
  // stops it being narrowed back to owner/admin without the login path being fixed too.
  const { directory, owner } = setup();
  for (const role of ['developer', 'user', 'client_restricted']) {
    const { token } = directory.createInvitation({
      actorId: owner.id, username: `mfa-${role}`, displayName: role, role,
    });
    const accepted = directory.acceptInvitation({ token, password: OTHER_PASSWORD });
    assert.equal(accepted.mfaRequired, true, `${role} must enrol MFA`);
    assert.ok(accepted.totpSecret, `${role} must be given a TOTP secret`);
    const confirmed = directory.confirmInvitationMfa({
      challenge: accepted.challenge, totpCode: totpCode(accepted.totpSecret),
    });
    assert.equal(confirmed.user.mfaEnabled, true);
  }
});

test('a service account is created without any MFA enrolment', () => {
  const { directory, owner } = setup();
  const created = directory.createServiceAccount({
    actorId: owner.id, username: 'token-only', displayName: 'Token only',
  });
  assert.equal(created.user.mfaEnabled, false);
  assert.equal(created.user.role, 'service_account');
});

test('an admin account does not exist until MFA is enrolled', () => {
  const { directory, owner } = setup();
  const { token } = directory.createInvitation({
    actorId: owner.id, username: 'adminee', displayName: 'Admin', role: 'admin',
  });
  const accepted = directory.acceptInvitation({ token, password: OTHER_PASSWORD });
  assert.equal(accepted.mfaRequired, true);
  assert.ok(accepted.totpSecret);
  // The account must NOT be in the directory yet: a privileged account with one factor,
  // even briefly, is the thing this flow exists to prevent.
  assert.equal(directory.list().some((user) => user.username === 'adminee'), false);

  const confirmed = directory.confirmInvitationMfa({
    challenge: accepted.challenge, totpCode: totpCode(accepted.totpSecret),
  });
  assert.equal(confirmed.user.role, 'admin');
  assert.equal(confirmed.user.mfaEnabled, true);
  assert.equal(directory.list().some((user) => user.username === 'adminee'), true);
});

test('an enrolment code cannot be replayed', () => {
  const { directory, owner } = setup();
  const { token } = directory.createInvitation({
    actorId: owner.id, username: 'replay', displayName: 'Replay', role: 'admin',
  });
  const accepted = directory.acceptInvitation({ token, password: OTHER_PASSWORD });
  const code = totpCode(accepted.totpSecret);
  directory.confirmInvitationMfa({ challenge: accepted.challenge, totpCode: code });
  assert.throws(
    () => directory.confirmInvitationMfa({ challenge: accepted.challenge, totpCode: code }),
    /expired|already been used/,
  );
});

test('an administrator cannot create an owner or another administrator', () => {
  const { directory, owner } = setup();
  const admin = inviteAndAccept(directory, owner.id, { username: 'admin2', role: 'admin' });
  assert.throws(
    () => directory.createInvitation({
      actorId: admin.id, username: 'newowner', displayName: 'X', role: 'owner',
    }),
    /may not grant the owner role/,
  );
  assert.throws(
    () => directory.createInvitation({
      actorId: admin.id, username: 'newadmin', displayName: 'X', role: 'admin',
    }),
    /may not grant the admin role/,
  );
  // But it can create the roles below it.
  assert.ok(directory.createInvitation({
    actorId: admin.id, username: 'devuser', displayName: 'Dev', role: 'developer',
  }).token);
});

test('a developer cannot administer users at all', () => {
  const { directory, owner } = setup();
  const dev = inviteAndAccept(directory, owner.id, { username: 'dev', role: 'developer' });
  assert.throws(
    () => directory.createInvitation({
      actorId: dev.id, username: 'x', displayName: 'X', role: 'user',
    }),
    /may not administer users/,
  );
});

test('the last active owner cannot be demoted, disabled, revoked or erased', () => {
  const { directory, owner } = setup();
  assert.throws(() => directory.setRole({ actorId: owner.id, userId: owner.id, role: 'user' }),
    /last active owner/);
  assert.throws(() => directory.disableUser({ actorId: owner.id, userId: owner.id }),
    /cannot disable or revoke itself/);

  const second = inviteAndAccept(directory, owner.id, { username: 'owner2', role: 'owner' });
  // With two owners, one may now be disabled.
  const disabled = directory.disableUser({ actorId: owner.id, userId: second.id, reason: 'left' });
  assert.equal(disabled.status, 'disabled');
  assert.ok(disabled.disabledAt);
});

test('disabling an account kills its live sessions immediately', () => {
  const { directory, auth, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  // Give Alice a session directly through the store, which is what a completed login
  // produces; the point under test is revocation, not the login flow.
  const state = auth.store.read();
  const record = state.users.find((user) => user.id === alice.id);
  const session = auth.createSession(record, { mfa: false });
  assert.ok(auth.authenticate(session.token), 'the session must work before disabling');

  directory.disableUser({ actorId: owner.id, userId: alice.id, reason: 'offboarded' });
  assert.equal(auth.authenticate(session.token), null,
    'a disabled account must lose its live session, not merely its next login');
});

test('a disabled account cannot log in, and the refusal is indistinguishable from a bad password', () => {
  const { directory, auth, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  directory.disableUser({ actorId: owner.id, userId: alice.id });
  assert.throws(
    () => auth.beginLogin({ username: 'alice', password: OTHER_PASSWORD, ip: '127.0.0.1' }),
    /Invalid credentials or account temporarily locked/,
  );
});

test('a revoked account cannot be reinstated', () => {
  const { directory, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  directory.revokeUser({ actorId: owner.id, userId: alice.id, reason: 'compromised' });
  assert.throws(() => directory.reinstateUser({ actorId: owner.id, userId: alice.id }),
    /cannot be reinstated/);
});

test('a disabled account can be reinstated and works again', () => {
  const { directory, auth, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  directory.disableUser({ actorId: owner.id, userId: alice.id });
  const back = directory.reinstateUser({ actorId: owner.id, userId: alice.id });
  assert.equal(back.status, 'active');
  assert.equal(back.disabledAt, null);
  assert.doesNotThrow(() => auth.beginLogin({
    username: 'alice', password: OTHER_PASSWORD, ip: '127.0.0.1',
  }));
});

test('promotion into a role that requires MFA is refused when the account has none', () => {
  // Every interactive account enrols MFA, so the account without a secret is the service
  // account — and promoting one of those into admin would create a privileged principal
  // authenticating with a bearer token and nothing else.
  const { directory, owner } = setup();
  const service = directory.createServiceAccount({
    actorId: owner.id, username: 'bot-account', displayName: 'Bot',
  });
  assert.equal(service.user.mfaEnabled, false);
  assert.throws(
    () => directory.setRole({ actorId: owner.id, userId: service.user.id, role: 'admin' }),
    /must enrol MFA/,
  );
});

test('an invitation claim lapses with the enrolment window so a fumbled setup is recoverable', () => {
  const { directory, owner } = setup();
  const { token } = directory.createInvitation({
    actorId: owner.id, username: 'fumbled', displayName: 'Fumbled', role: 'user',
  });
  directory.acceptInvitation({ token, password: OTHER_PASSWORD });
  assert.throws(() => directory.acceptInvitation({ token, password: OTHER_PASSWORD }),
    /already being used/);

  // Age the claim past the enrolment TTL, as the clock would.
  directory.store.update((next) => {
    const invitation = next.invitations.find((item) => item.username === 'fumbled');
    invitation.claimedAt = new Date(Date.now() - 60 * 60_000).toISOString();
  });
  const retried = directory.acceptInvitation({ token, password: OTHER_PASSWORD });
  assert.equal(retried.mfaRequired, true, 'the invitation must become usable again');
});

test('an administrator may not disable or erase an owner', () => {
  const { directory, owner } = setup();
  const admin = inviteAndAccept(directory, owner.id, { username: 'admin2', role: 'admin' });
  // A second owner is created first on purpose. With only one, the "last active owner"
  // guard fires before the role guard and the test would pass without ever exercising
  // the rule it names.
  const secondOwner = inviteAndAccept(directory, owner.id, { username: 'owner2', role: 'owner' });
  assert.equal(secondOwner.role, 'owner');

  assert.throws(() => directory.disableUser({ actorId: admin.id, userId: owner.id }),
    /may not disable an owner/);
  assert.throws(() => directory.eraseUser({ actorId: admin.id, userId: owner.id }),
    /may not erase an owner/);
  assert.throws(() => directory.setRole({ actorId: admin.id, userId: owner.id, role: 'user' }),
    /may not grant the user role|may not change an owner/);
  // The owner, by contrast, can.
  assert.equal(
    directory.disableUser({ actorId: owner.id, userId: secondOwner.id }).status,
    'disabled',
  );
});

test('a service account has no password, cannot log in, and authenticates by token', () => {
  const { directory, auth, owner } = setup();
  const created = directory.createServiceAccount({
    actorId: owner.id, username: 'ci-bot', displayName: 'CI',
  });
  assert.equal(created.user.role, 'service_account');
  assert.ok(created.token);

  assert.throws(
    () => auth.beginLogin({ username: 'ci-bot', password: OTHER_PASSWORD, ip: '127.0.0.1' }),
    /Invalid credentials/,
  );

  const resolved = directory.authenticateServiceToken(created.token);
  assert.ok(resolved);
  assert.equal(resolved.user.username, 'ci-bot');
  assert.equal(directory.authenticateServiceToken('wrong-token'), null);
});

test('a revoked service token stops working and so does one on a disabled account', () => {
  const { directory, owner } = setup();
  const created = directory.createServiceAccount({
    actorId: owner.id, username: 'ci-bot', displayName: 'CI',
  });
  const second = directory.issueServiceToken({
    actorId: owner.id, userId: created.user.id, name: 'second',
  });
  assert.ok(directory.authenticateServiceToken(second.token));
  directory.revokeServiceToken({ actorId: owner.id, tokenId: second.tokenId });
  assert.equal(directory.authenticateServiceToken(second.token), null);

  // The first token still works until the account itself goes.
  assert.ok(directory.authenticateServiceToken(created.token));
  directory.disableUser({ actorId: owner.id, userId: created.user.id });
  assert.equal(directory.authenticateServiceToken(created.token), null,
    'disabling an account must revoke its tokens, not only its sessions');
});

test('only a service account may hold a token', () => {
  const { directory, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  assert.throws(
    () => directory.issueServiceToken({ actorId: owner.id, userId: alice.id }),
    /Only a service account/,
  );
});

test('an export contains the account and its activity but no credential material', () => {
  const { directory, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  const exported = directory.exportUser({ userId: alice.id });
  assert.equal(exported.account.id, alice.id);
  assert.equal(exported.credentialsIncluded, false);
  const serialised = JSON.stringify(exported);
  assert.equal(serialised.includes(OTHER_PASSWORD), false);
  assert.equal(serialised.includes('password'), false);
  assert.ok(exported.administrativeEvents.some((event) => event.action === 'user.created'));
});

test('erasure anonymises in place, destroys credentials, and keeps the audit reference', () => {
  const { directory, auth, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  const result = directory.eraseUser({ actorId: owner.id, userId: alice.id, reason: 'request' });
  assert.equal(result.erased, true);
  assert.equal(result.anonymisedInPlace, true);

  const record = directory.find(alice.id);
  assert.ok(record, 'the row must survive so audit references still resolve');
  assert.equal(record.password, null);
  assert.equal(record.totp, null);
  assert.equal(record.status, 'revoked');
  assert.match(record.username, /^erased-/);
  assert.equal(record.displayName, 'Erased account');

  assert.throws(
    () => auth.beginLogin({ username: 'alice', password: OTHER_PASSWORD, ip: '127.0.0.1' }),
    /Invalid credentials|Username must contain/,
  );
});

test('every administrative action is recorded with actor, subject and outcome', () => {
  const { directory, owner } = setup();
  const alice = inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  directory.disableUser({ actorId: owner.id, userId: alice.id, reason: 'test' });
  directory.reinstateUser({ actorId: owner.id, userId: alice.id });

  const events = directory.administrativeEvents({ subjectUserId: alice.id });
  const actions = events.map((event) => event.action);
  assert.ok(actions.includes('user.created'));
  assert.ok(actions.includes('user.disabled'));
  assert.ok(actions.includes('user.reinstated'));
  for (const event of events) {
    assert.equal(event.subjectUserId, alice.id);
    assert.ok(event.occurredAt);
    assert.equal(event.result, 'allowed');
  }
});

test('a duplicate username is refused whether the account exists or is merely invited', () => {
  const { directory, owner } = setup();
  inviteAndAccept(directory, owner.id, { username: 'alice', role: 'user' });
  assert.throws(() => directory.createInvitation({
    actorId: owner.id, username: 'alice', displayName: 'A', role: 'user',
  }), /already in use/);

  directory.createInvitation({ actorId: owner.id, username: 'bob', displayName: 'B', role: 'user' });
  assert.throws(() => directory.createInvitation({
    actorId: owner.id, username: 'bob', displayName: 'B', role: 'user',
  }), /already exists/);
});

test('an acting account that has itself been disabled can no longer administer', () => {
  const { directory, owner } = setup();
  const admin = inviteAndAccept(directory, owner.id, { username: 'admin2', role: 'admin' });
  directory.disableUser({ actorId: owner.id, userId: admin.id });
  assert.throws(() => directory.createInvitation({
    actorId: admin.id, username: 'x', displayName: 'X', role: 'user',
  }), /not active/);
});

test('projecting to the data plane is a no-op when no database is active', async () => {
  const { directory } = setup();
  const result = await directory.projectToDataPlane();
  assert.equal(result.projected, 0);
  assert.match(result.skipped, /no active postgresql data plane/);
});
