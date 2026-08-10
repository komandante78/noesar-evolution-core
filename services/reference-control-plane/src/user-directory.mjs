// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Multi-user account lifecycle: invitation, acceptance, roles, disabling, revocation,
// service accounts, per-user export and erasure, and the administrative audit trail.
//
// Where the identity actually lives, stated plainly because there are two stores:
//
//   * Credentials — password verifier, encrypted TOTP envelope, replay high-water mark —
//     stay in the auth store (state/auth.json, mode 0600). They are NOT moved into
//     PostgreSQL. That is a deliberate choice, not an omission: the database is dumped
//     for backup and restored into probe databases, and a dump that cannot contain a
//     password verifier is a dump that cannot leak one. Phase 4 finding F4-013 recorded
//     that a workspace backup is unencrypted; keeping verifiers out of the SQL side
//     narrows what that finding is about.
//
//   * Identity facts the data plane must join against — id, username, role, status —
//     are projected into noesar_identity.users so that Row Level Security has a subject
//     to reason about. The projection carries no credential material: password_scheme is
//     'external-auth-store' and the salt and hash columns hold a single zero byte.
//
// The projection is written after the authoritative store, and a projection failure is
// reported rather than swallowed, because an account that exists to the login path but
// not to RLS would be an account that can authenticate and then see nothing.

import { randomUUID } from 'node:crypto';
import {
  createTotpSecret,
  encryptSecret,
  hashPassword,
  passwordPolicy,
  randomToken,
  tokenDigest,
} from './auth-crypto.mjs';
import {
  MFA_REQUIRED_ROLES,
  NON_INTERACTIVE_ROLES,
  ROLES,
  normalizeUsername,
} from './auth.mjs';

const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const MFA_ENROLMENT_TTL_MS = 15 * 60 * 1000;

// Which roles an actor may grant. An administrator may not mint another administrator or
// an owner: privilege escalation by self-service is the failure mode this closes, and it
// costs nothing because the owner can still do it.
const GRANTABLE = Object.freeze({
  owner: Object.freeze(['owner', 'admin', 'developer', 'user', 'client_restricted', 'service_account']),
  admin: Object.freeze(['developer', 'user', 'client_restricted', 'service_account']),
});

function nowIso() { return new Date().toISOString(); }

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

export function publicAccount(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status ?? 'active',
    mfaEnabled: Boolean(user.totp),
    mfaRequired: MFA_REQUIRED_ROLES.has(user.role),
    createdAt: user.createdAt,
    createdBy: user.createdBy ?? null,
    disabledAt: user.disabledAt ?? null,
    disabledReason: user.disabledReason ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function publicInvitation(invitation) {
  return {
    id: invitation.id,
    username: invitation.username,
    displayName: invitation.displayName,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt ?? null,
    revokedAt: invitation.revokedAt ?? null,
    state: invitation.acceptedAt ? 'accepted'
      : invitation.revokedAt ? 'revoked'
        : Date.parse(invitation.expiresAt) < Date.now() ? 'expired' : 'open',
  };
}

export class UserDirectory {
  /**
   * @param {object} options
   * @param {import('./auth.mjs').AuthService} options.auth  credential authority
   * @param {object} options.ledger                          audit ledger
   * @param {() => (object|null)} [options.dataPlane]        resolves the live Postgres
   *        supervisor, or null when the reference data plane is active. A function
   *        rather than a value because the database becomes available after this object
   *        is constructed.
   */
  constructor({ auth, ledger, dataPlane = () => null }) {
    this.auth = auth;
    this.store = auth.store;
    this.ledger = ledger;
    this.dataPlane = dataPlane;
  }

  #adminEvent({ actorId, subjectId = null, action, result, details = {} }) {
    this.ledger.append({
      actor: actorId ?? 'anonymous',
      action,
      result,
      details: { ...details, subject: subjectId },
    });
    this.store.update((next) => {
      next.administrativeEvents = (next.administrativeEvents ?? []).concat([{
        id: randomUUID(),
        occurredAt: nowIso(),
        actorUserId: actorId ?? null,
        subjectUserId: subjectId,
        action,
        result,
        details,
      }]).slice(-2000);
    });
  }

  administrativeEvents({ limit = 100, subjectUserId = null } = {}) {
    const events = this.store.read().administrativeEvents ?? [];
    const filtered = subjectUserId
      ? events.filter((event) => event.subjectUserId === subjectUserId)
      : events;
    return filtered.slice(-Math.max(1, Math.min(1000, Number(limit) || 100))).reverse();
  }

  list() {
    return (this.store.read().users ?? []).map(publicAccount);
  }

  find(userId) {
    return (this.store.read().users ?? []).find((user) => user.id === userId) ?? null;
  }

  #activeOwners(users) {
    return users.filter((user) => user.role === 'owner' && (user.status ?? 'active') === 'active');
  }

  #requireGrantable(actor, role) {
    if (!ROLES.includes(role)) throw fail(`Unknown role: ${role}`, 400);
    const allowed = GRANTABLE[actor.role] ?? [];
    if (!allowed.includes(role)) {
      throw fail(`A ${actor.role} may not grant the ${role} role.`, 403);
    }
  }

  #requireActor(actorId) {
    const actor = this.find(actorId);
    if (!actor) throw fail('The acting account no longer exists.', 403);
    if ((actor.status ?? 'active') !== 'active') throw fail('The acting account is not active.', 403);
    if (!GRANTABLE[actor.role]) throw fail('This account may not administer users.', 403);
    return actor;
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  createInvitation({ actorId, username, displayName, role }) {
    const actor = this.#requireActor(actorId);
    this.#requireGrantable(actor, role);
    if (NON_INTERACTIVE_ROLES.has(role)) {
      throw fail('A service account is created directly, not by invitation.', 400);
    }
    const normalized = normalizeUsername(username);
    const state = this.store.read();
    if ((state.users ?? []).some((user) => user.username === normalized)) {
      throw fail('That username is already in use.', 409);
    }
    const open = (state.invitations ?? []).find((invitation) => invitation.username === normalized
      && !invitation.acceptedAt && !invitation.revokedAt
      && Date.parse(invitation.expiresAt) > Date.now());
    if (open) throw fail('An open invitation for that username already exists.', 409);

    // The token is returned exactly once. Only its digest is stored, so an operator
    // reading state/auth.json — or a backup of it — cannot replay an invitation.
    const token = randomToken(32);
    const invitation = {
      id: randomUUID(),
      username: normalized,
      displayName: String(displayName ?? normalized).trim().slice(0, 100),
      role,
      tokenDigest: tokenDigest(token),
      invitedBy: actor.id,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
      acceptedAt: null,
      revokedAt: null,
    };
    this.store.update((next) => {
      next.invitations = (next.invitations ?? []).concat([invitation]);
    });
    this.#adminEvent({
      actorId: actor.id, action: 'user.invited', result: 'allowed',
      details: { username: normalized, role },
    });
    return { invitation: publicInvitation(invitation), token };
  }

  listInvitations() {
    return (this.store.read().invitations ?? []).map(publicInvitation);
  }

  revokeInvitation({ actorId, invitationId }) {
    const actor = this.#requireActor(actorId);
    const state = this.store.read();
    const invitation = (state.invitations ?? []).find((item) => item.id === invitationId);
    if (!invitation) throw fail('No such invitation.', 404);
    if (invitation.acceptedAt) throw fail('That invitation has already been accepted.', 409);
    this.store.update((next) => {
      const target = next.invitations.find((item) => item.id === invitationId);
      target.revokedAt = nowIso();
    });
    this.#adminEvent({
      actorId: actor.id, action: 'user.invitation-revoked', result: 'allowed',
      details: { invitationId, username: invitation.username },
    });
    return publicInvitation({ ...invitation, revokedAt: nowIso() });
  }

  #resolveInvitation(token) {
    const digest = tokenDigest(String(token ?? ''));
    const state = this.store.read();
    const invitation = (state.invitations ?? []).find((item) => item.tokenDigest === digest);
    if (!invitation) throw fail('Invalid invitation token.', 403);
    if (invitation.revokedAt) throw fail('That invitation was revoked.', 403);
    if (invitation.acceptedAt) throw fail('That invitation has already been used.', 409);
    if (Date.parse(invitation.expiresAt) < Date.now()) throw fail('That invitation has expired.', 403);
    // A claimed invitation is in the middle of MFA enrolment. Letting the token start a
    // second enrolment would let whoever holds it race the intended recipient, with the
    // last confirmation winning. The claim lapses when the enrolment window does, so a
    // fumbled authenticator setup is recoverable rather than permanently locking the
    // invitation.
    if (invitation.claimedAt
      && Date.parse(invitation.claimedAt) + MFA_ENROLMENT_TTL_MS > Date.now()) {
      throw fail('That invitation is already being used to set up an account.', 409);
    }
    return invitation;
  }

  /**
   * Accept an invitation. The invited person chooses their own password here — an
   * administrator never types it, and therefore never knows it.
   */
  acceptInvitation({ token, password, displayName = null }) {
    const invitation = this.#resolveInvitation(token);
    const policy = passwordPolicy(password);
    if (!policy.valid) throw fail(policy.reasons.join(' '), 400);

    const record = {
      id: randomUUID(),
      username: invitation.username,
      displayName: String(displayName ?? invitation.displayName).trim().slice(0, 100),
      role: invitation.role,
      status: 'active',
      password: hashPassword(password),
      totp: null,
      createdAt: nowIso(),
      createdBy: invitation.invitedBy,
      failedLoginCount: 0,
      lockedUntil: 0,
    };

    if (!NON_INTERACTIVE_ROLES.has(invitation.role)) {
      // EVERY interactive account enrols MFA before it exists, not only owner and admin.
      //
      // The requirement names owner and admin as a floor. Going further is deliberate and
      // was forced by the code rather than chosen for neatness: AuthService.completeLogin
      // decrypts user.totp unconditionally, because until multi-user existed there was
      // exactly one account and it always had a secret. An account created without one
      // could therefore never log in at all — a defect this flow would have shipped.
      //
      // Of the two ways out, this is the safer: the alternative adds a branch to the login
      // path that issues a session after the password step alone, and a code path that can
      // skip a factor is a code path that can be reached by mistake.
      //
      // Creating the account first and asking for MFA afterwards would leave a window in
      // which the account has a single factor, so the account does not exist until the
      // enrolment code has been verified.
      const secret = createTotpSecret();
      const challenge = randomToken(24);
      const pending = {
        challengeDigest: tokenDigest(challenge),
        invitationId: invitation.id,
        expiresAt: Date.now() + MFA_ENROLMENT_TTL_MS,
        user: { ...record, totp: encryptSecret(secret, this.auth.masterKey) },
      };
      this.store.update((next) => {
        next.pendingInvitees = (next.pendingInvitees ?? [])
          .filter((item) => item.expiresAt > Date.now() && item.invitationId !== invitation.id)
          .concat([pending]);
        const claimed = (next.invitations ?? []).find((item) => item.id === invitation.id);
        if (claimed) claimed.claimedAt = nowIso();
      });
      return {
        mfaRequired: true,
        challenge,
        username: invitation.username,
        totpSecret: secret,
        otpauthUri: `otpauth://totp/NOESAR%20Evolution:${encodeURIComponent(invitation.username)}`
          + `?secret=${secret}&issuer=NOESAR%20Evolution&algorithm=SHA1&digits=6&period=30`,
        expiresAt: new Date(pending.expiresAt).toISOString(),
      };
    }

    this.#commitUser(record, invitation.id);
    return { mfaRequired: false, user: publicAccount(record) };
  }

  confirmInvitationMfa({ challenge, totpCode }) {
    const digest = tokenDigest(String(challenge ?? ''));
    const state = this.store.read();
    const pending = (state.pendingInvitees ?? []).find((item) => item.challengeDigest === digest);
    if (!pending || pending.expiresAt < Date.now()) throw fail('MFA enrolment expired.', 400);
    const consumed = this.auth.consumeEnrolmentCode(pending.user, totpCode);
    if (!consumed.accepted) {
      throw fail(consumed.reason === 'replayed'
        ? 'This authentication code has already been used.'
        : 'Invalid TOTP code.', 403);
    }
    const record = { ...pending.user, lastTotpStep: consumed.step };
    this.#commitUser(record, pending.invitationId);
    this.store.update((next) => {
      next.pendingInvitees = (next.pendingInvitees ?? [])
        .filter((item) => item.challengeDigest !== digest);
    });
    return { user: publicAccount(record) };
  }

  #commitUser(record, invitationId = null) {
    this.store.update((next) => {
      next.users = (next.users ?? []).concat([record]);
      if (invitationId) {
        const invitation = (next.invitations ?? []).find((item) => item.id === invitationId);
        if (invitation) {
          invitation.acceptedAt = nowIso();
          invitation.acceptedUserId = record.id;
        }
      }
    });
    this.#adminEvent({
      actorId: record.createdBy, subjectId: record.id,
      action: 'user.created', result: 'allowed',
      details: { username: record.username, role: record.role },
    });
    return record;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  setRole({ actorId, userId, role }) {
    const actor = this.#requireActor(actorId);
    this.#requireGrantable(actor, role);
    const state = this.store.read();
    const target = (state.users ?? []).find((user) => user.id === userId);
    if (!target) throw fail('No such account.', 404);
    if (target.role === role) return publicAccount(target);
    if (target.role === 'owner' && this.#activeOwners(state.users).length <= 1) {
      throw fail('The last active owner cannot be demoted.', 409);
    }
    if (actor.role === 'admin' && (target.role === 'owner' || target.role === 'admin')) {
      throw fail('An administrator may not change an owner or another administrator.', 403);
    }
    if (MFA_REQUIRED_ROLES.has(role) && !target.totp) {
      // Promoting into a role that requires MFA, from an account that has none, would
      // create exactly the single-factor privileged account the enrolment flow exists to
      // prevent.
      throw fail('That account must enrol MFA before it can hold this role.', 409);
    }
    this.store.update((next) => {
      const record = next.users.find((user) => user.id === userId);
      record.role = role;
      record.updatedAt = nowIso();
    });
    this.#adminEvent({
      actorId: actor.id, subjectId: userId, action: 'user.role-changed', result: 'allowed',
      details: { from: target.role, to: role },
    });
    return publicAccount({ ...target, role });
  }

  #setStatus({ actorId, userId, status, reason }) {
    const actor = this.#requireActor(actorId);
    const state = this.store.read();
    const target = (state.users ?? []).find((user) => user.id === userId);
    if (!target) throw fail('No such account.', 404);
    if (actor.id === userId && status !== 'active') {
      // Self-disabling is how an installation ends up with nobody who can administer it.
      throw fail('An account cannot disable or revoke itself.', 409);
    }
    if (actor.role === 'admin' && (target.role === 'owner' || target.role === 'admin')) {
      throw fail('An administrator may not disable an owner or another administrator.', 403);
    }
    if (status !== 'active' && target.role === 'owner'
      && this.#activeOwners(state.users).length <= 1) {
      throw fail('The last active owner cannot be disabled or revoked.', 409);
    }
    if (target.status === 'revoked' && status === 'active') {
      throw fail('A revoked account cannot be reinstated.', 409);
    }

    const stamp = nowIso();
    this.store.update((next) => {
      const record = next.users.find((user) => user.id === userId);
      record.status = status;
      record.disabledAt = status === 'active' ? null : stamp;
      record.disabledReason = status === 'active' ? null : (reason ?? null);
      // Every live session of the account goes with it. Leaving them would mean a
      // disabled account keeps working until its cookie expires.
      next.sessions = (next.sessions ?? []).filter((session) => session.userId !== userId
        || status === 'active');
      if (status !== 'active') {
        next.serviceTokens = (next.serviceTokens ?? []).map((item) => (
          item.userId === userId && !item.revokedAt ? { ...item, revokedAt: stamp } : item
        ));
      }
    });
    this.#adminEvent({
      actorId: actor.id, subjectId: userId,
      action: status === 'active' ? 'user.reinstated' : `user.${status}`,
      result: 'allowed', details: { reason: reason ?? null },
    });
    return publicAccount({ ...target, status, disabledAt: status === 'active' ? null : stamp });
  }

  disableUser({ actorId, userId, reason = null }) {
    return this.#setStatus({ actorId, userId, status: 'disabled', reason });
  }

  revokeUser({ actorId, userId, reason = null }) {
    return this.#setStatus({ actorId, userId, status: 'revoked', reason });
  }

  reinstateUser({ actorId, userId }) {
    return this.#setStatus({ actorId, userId, status: 'active', reason: null });
  }

  // ---------------------------------------------------------------------------
  // Service accounts
  // ---------------------------------------------------------------------------

  createServiceAccount({ actorId, username, displayName }) {
    const actor = this.#requireActor(actorId);
    this.#requireGrantable(actor, 'service_account');
    const normalized = normalizeUsername(username);
    const state = this.store.read();
    if ((state.users ?? []).some((user) => user.username === normalized)) {
      throw fail('That username is already in use.', 409);
    }
    const record = {
      id: randomUUID(),
      username: normalized,
      displayName: String(displayName ?? normalized).trim().slice(0, 100),
      role: 'service_account',
      status: 'active',
      // No password verifier and no TOTP envelope exist for a service account. The login
      // path refuses the role outright, so there is nothing for a password to unlock.
      password: null,
      totp: null,
      createdAt: nowIso(),
      createdBy: actor.id,
      failedLoginCount: 0,
      lockedUntil: 0,
    };
    this.#commitUser(record);
    const issued = this.issueServiceToken({ actorId: actor.id, userId: record.id, name: 'initial' });
    return { user: publicAccount(record), token: issued.token, tokenId: issued.tokenId };
  }

  issueServiceToken({ actorId, userId, name = 'token', ttlDays = null }) {
    const actor = this.#requireActor(actorId);
    const target = this.find(userId);
    if (!target) throw fail('No such account.', 404);
    if (target.role !== 'service_account') throw fail('Only a service account can hold a token.', 400);
    if ((target.status ?? 'active') !== 'active') throw fail('That account is not active.', 409);

    const token = randomToken(32);
    const record = {
      id: randomUUID(),
      userId,
      name: String(name).slice(0, 64),
      tokenDigest: tokenDigest(token),
      createdBy: actor.id,
      createdAt: nowIso(),
      expiresAt: ttlDays ? new Date(Date.now() + Number(ttlDays) * 86400_000).toISOString() : null,
      lastUsedAt: null,
      revokedAt: null,
    };
    this.store.update((next) => {
      next.serviceTokens = (next.serviceTokens ?? []).concat([record]);
    });
    this.#adminEvent({
      actorId: actor.id, subjectId: userId, action: 'user.service-token-issued',
      result: 'allowed', details: { tokenId: record.id, name: record.name },
    });
    return { tokenId: record.id, token, expiresAt: record.expiresAt };
  }

  revokeServiceToken({ actorId, tokenId }) {
    const actor = this.#requireActor(actorId);
    const state = this.store.read();
    const record = (state.serviceTokens ?? []).find((item) => item.id === tokenId);
    if (!record) throw fail('No such token.', 404);
    this.store.update((next) => {
      const target = next.serviceTokens.find((item) => item.id === tokenId);
      target.revokedAt = nowIso();
    });
    this.#adminEvent({
      actorId: actor.id, subjectId: record.userId, action: 'user.service-token-revoked',
      result: 'allowed', details: { tokenId },
    });
    return { tokenId, revoked: true };
  }

  /**
   * Resolve a bearer token to a service account. Returns null for anything that is not a
   * live token belonging to a live account — never a reason, so a caller cannot use the
   * distinction between "unknown", "expired" and "revoked" as an oracle.
   */
  authenticateServiceToken(token) {
    if (!token) return null;
    const digest = tokenDigest(String(token));
    const state = this.store.read();
    const record = (state.serviceTokens ?? []).find((item) => item.tokenDigest === digest);
    if (!record || record.revokedAt) return null;
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return null;
    const user = (state.users ?? []).find((item) => item.id === record.userId);
    if (!user || (user.status ?? 'active') !== 'active' || user.role !== 'service_account') return null;
    this.store.update((next) => {
      const target = next.serviceTokens.find((item) => item.id === record.id);
      if (target) target.lastUsedAt = nowIso();
    });
    return { user: publicAccount(user), tokenId: record.id };
  }

  // ---------------------------------------------------------------------------
  // Export and erasure
  // ---------------------------------------------------------------------------

  /**
   * Everything the installation holds about one account, minus the credential material,
   * which is deliberately excluded: an export is a file a person carries away, and a
   * password verifier in it is a password verifier in their downloads folder.
   */
  exportUser({ userId }) {
    const user = this.find(userId);
    if (!user) throw fail('No such account.', 404);
    const state = this.store.read();
    return {
      exportedAtUtc: nowIso(),
      account: publicAccount(user),
      sessions: (state.sessions ?? [])
        .filter((session) => session.userId === userId)
        .map((session) => ({
          id: session.id, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt, mfa: session.mfa,
        })),
      serviceTokens: (state.serviceTokens ?? [])
        .filter((item) => item.userId === userId)
        .map((item) => ({
          id: item.id, name: item.name, createdAt: item.createdAt,
          expiresAt: item.expiresAt, lastUsedAt: item.lastUsedAt, revokedAt: item.revokedAt,
        })),
      administrativeEvents: (state.administrativeEvents ?? [])
        .filter((event) => event.subjectUserId === userId || event.actorUserId === userId),
      credentialsIncluded: false,
    };
  }

  /**
   * Erase an account. The row is anonymised in place rather than deleted, because audit
   * events reference the actor by id and a dangling reference would silently break the
   * hash chain's readability. What is destroyed is everything that identifies the person
   * and everything that could authenticate as them.
   */
  eraseUser({ actorId, userId, reason = null }) {
    const actor = this.#requireActor(actorId);
    const state = this.store.read();
    const target = (state.users ?? []).find((user) => user.id === userId);
    if (!target) throw fail('No such account.', 404);
    if (actor.id === userId) throw fail('An account cannot erase itself.', 409);
    if (target.role === 'owner' && this.#activeOwners(state.users).length <= 1) {
      throw fail('The last active owner cannot be erased.', 409);
    }
    if (actor.role === 'admin' && (target.role === 'owner' || target.role === 'admin')) {
      throw fail('An administrator may not erase an owner or another administrator.', 403);
    }

    const stamp = nowIso();
    this.store.update((next) => {
      const record = next.users.find((user) => user.id === userId);
      record.username = `erased-${userId.slice(0, 8)}`;
      record.displayName = 'Erased account';
      record.status = 'revoked';
      record.password = null;
      record.totp = null;
      record.lastTotpStep = 0;
      record.disabledAt = stamp;
      record.disabledReason = 'erased';
      record.erasedAt = stamp;
      next.sessions = (next.sessions ?? []).filter((session) => session.userId !== userId);
      next.serviceTokens = (next.serviceTokens ?? []).filter((item) => item.userId !== userId);
      next.invitations = (next.invitations ?? []).filter((item) => item.acceptedUserId !== userId);
    });
    this.#adminEvent({
      actorId: actor.id, subjectId: userId, action: 'user.erased', result: 'allowed',
      details: { reason },
    });
    return { userId, erased: true, erasedAt: stamp, anonymisedInPlace: true };
  }

  // ---------------------------------------------------------------------------
  // Data-plane projection
  // ---------------------------------------------------------------------------

  /**
   * Mirror the account list into noesar_identity.users so Row Level Security has a
   * subject to join against. No credential material crosses this boundary.
   */
  async projectToDataPlane() {
    const supervisor = this.dataPlane();
    if (!supervisor?.pool) return { projected: 0, skipped: 'no active postgresql data plane' };
    const users = this.store.read().users ?? [];
    let projected = 0;
    // Written on an administrative connection, not the application pool: RLS on
    // noesar_identity.users restricts every row to the acting user, and the projection
    // by definition acts for all of them.
    return supervisor.withAdmin(async (admin) => {
      for (const user of users) {
        // A projection must CONVERGE, and this one could not.
        //
        // `ON CONFLICT (id)` below handles the same account projected twice. It does not handle
        // the other unique key this table has: `username`. So a row carrying a name that now
        // belongs to a DIFFERENT account raised `users_username_key`, the projection threw, the
        // data plane refused to serve against a substitute, and the product would not start —
        // measured in s340 on the real installation, where the s339 owner reset emptied
        // `state/auth.json` while this table kept the old `koma78` row. The authoritative store
        // had one owner, this table had another with the same name, and every restart from then
        // on failed. Nothing said so until a restart actually happened.
        //
        // The stale row is RENAMED, never deleted: many tables reference `users(id)`, several
        // `NOT NULL` and without `ON DELETE CASCADE`, so deleting either fails or cascades
        // through the audit ledger. Renaming keeps every reference valid and keeps the record of
        // who did what, which is the one thing an identity table must not lose. Lower case
        // because the column checks it.
        await admin.query(
          `UPDATE noesar_identity.users
              SET username = 'superseded-' || left(id::text, 8), updated_at = now()
            WHERE username = $2 AND id <> $1`,
          [user.id, user.username],
        );
        await admin.query(
        `INSERT INTO noesar_identity.users
           (id, username, display_name, role, password_scheme, password_salt,
            password_hash, password_parameters, status, mfa_required, created_at)
         VALUES ($1,$2,$3,$4,'external-auth-store','\\x00'::bytea,'\\x00'::bytea,
                 '{"note":"credentials live in the auth store, never in SQL"}'::jsonb,
                 $5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           role = EXCLUDED.role,
           status = EXCLUDED.status,
           mfa_required = EXCLUDED.mfa_required,
           updated_at = now()`,
        [
          user.id, user.username, user.displayName, user.role,
            user.status ?? 'active', MFA_REQUIRED_ROLES.has(user.role),
            user.createdAt ?? nowIso(),
          ],
        );
        projected += 1;
      }
      return { projected };
    });
  }
}

export const UserDirectoryInternals = Object.freeze({
  GRANTABLE,
  INVITATION_TTL_MS,
  MFA_ENROLMENT_TTL_MS,
});
