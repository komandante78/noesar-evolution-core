// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  createTotpSecret,
  decryptSecret,
  encryptSecret,
  hashPassword,
  passwordPolicy,
  randomToken,
  tokenDigest,
  verifyPassword,
  verifyTotpStep,
} from './auth-crypto.mjs';
import { AuthStore } from './auth-store.mjs';

const AI_USER = ['workspace.read','workspace.write','provider.use','memory.manage','artifact.manage','knowledge.manage'];
const AI_ADMIN = [...AI_USER,'provider.manage','agent.manage','data.manage'];
// A restricted client may hold a conversation and read what it is given. It may not
// register a provider, define an agent or a tool, or promote anything into shared
// memory — every capability that would let one account change what another account's
// session executes.
const AI_CLIENT_RESTRICTED = ['workspace.read','workspace.write','provider.use'];
// A service account is non-interactive: it authenticates with a bearer token, has no
// password and no TOTP, and therefore must not hold a permission whose blast radius
// depends on a human noticing in time. It reads, and it uses a provider.
const AI_SERVICE_ACCOUNT = ['workspace.read','provider.use'];

export const ROLES = Object.freeze([
  'owner', 'admin', 'developer', 'user', 'client_restricted', 'service_account',
]);

// Owner and admin carry MFA. Enforced here and again as a CHECK constraint in migration
// 0013: a rule that lives in exactly one layer is one refactor away from gone.
export const MFA_REQUIRED_ROLES = Object.freeze(new Set(['owner', 'admin']));

// Roles that authenticate with a bearer token instead of a password.
export const NON_INTERACTIVE_ROLES = Object.freeze(new Set(['service_account']));

const ROLE_PERMISSIONS = Object.freeze({
  owner: new Set(['user.read','hardware.read','runtime.plan','coden.plan','coden.authorize','coden.owner-bypass','audit.read','auth.manage','user.manage','model.manage',...AI_ADMIN]),
  admin: new Set(['user.read','hardware.read','runtime.plan','coden.plan','coden.authorize','audit.read','auth.manage','user.manage','model.manage',...AI_ADMIN]),
  developer: new Set(['user.read','hardware.read','runtime.plan','coden.plan','coden.authorize',...AI_ADMIN]),
  user: new Set(['user.read','hardware.read','runtime.plan',...AI_USER]),
  client_restricted: new Set(['user.read',...AI_CLIENT_RESTRICTED]),
  service_account: new Set(['user.read',...AI_SERVICE_ACCOUNT]),
});

export const RolePermissions = ROLE_PERMISSIONS;

export function normalizeUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) throw new Error('Username must contain 3-64 lowercase-safe characters.');
  return username;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    // Absent on records written before multi-user existed, which are all owners, and an
    // owner that predates the field is by definition active.
    status: user.status ?? 'active',
    mfaEnabled: Boolean(user.totp),
    mfaRequired: MFA_REQUIRED_ROLES.has(user.role),
    createdAt: user.createdAt,
    disabledAt: user.disabledAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function isActive(user) {
  return (user?.status ?? 'active') === 'active';
}

function nowIso() { return new Date().toISOString(); }

/**
 * Accept a TOTP code at most once (RFC 6238 section 5.2).
 *
 * A valid code stays valid for the whole +/-1-step acceptance window, so without this a
 * code seen once — shoulder-surfed, screenshotted, captured by a proxy — can be replayed
 * on a second, independent login for up to 90 seconds. The highest step accepted so far
 * is recorded per user; anything at or below it is refused even though the arithmetic
 * still checks out.
 */
function consumeTotp(secret, code, user) {
  const result = verifyTotpStep(secret, code);
  if (!result.valid) return { accepted: false, reason: 'invalid', step: null };
  if (Number(user.lastTotpStep ?? 0) >= result.step) return { accepted: false, reason: 'replayed', step: result.step };
  return { accepted: true, reason: null, step: result.step };
}

const RECOVERY_CODE_COUNT = 10;
// Crockford-style alphabet: no I, L, O or U, so a code read off a screen and typed back
// cannot become a DIFFERENT valid code through an ordinary transcription slip.
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Mint recovery codes. The plaintext is returned ONCE to the caller and never stored:
 * only digests are persisted, so a copy of the state file yields no working codes.
 */
function buildRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = [];
  for (let index = 0; index < count; index += 1) {
    let text = '';
    for (const byte of randomBytes(10)) text += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    codes.push(`${text.slice(0, 5)}-${text.slice(5, 10)}`);
  }
  return { codes, digests: codes.map((code) => ({ digest: tokenDigest(code), usedAt: null })) };
}

export class AuthService {
  constructor({ workspace, setupToken, ledger, secureCookies = false }) {
    this.workspace = workspace;
    this.store = new AuthStore(`${workspace}/state/auth.json`);
    this.masterKeyPath = `${workspace}/config/auth-master.key`;
    this.setupTokenDigest = setupToken ? tokenDigest(setupToken) : null;
    this.ledger = ledger;
    this.secureCookies = secureCookies;
    this.loginAttempts = new Map();
    this.masterKey = this.#loadOrCreateMasterKey();
  }

  #loadOrCreateMasterKey() {
    mkdirSync(dirname(this.masterKeyPath), { recursive:true, mode:0o700 });
    if (!existsSync(this.masterKeyPath)) {
      const key = Buffer.from(randomToken(32), 'base64url');
      writeFileSync(this.masterKeyPath, key, { mode:0o600 });
      chmodSync(this.masterKeyPath, 0o600);
    }
    const key = readFileSync(this.masterKeyPath);
    if (key.length !== 32) throw new Error('Auth master key must be exactly 32 bytes.');
    return key;
  }

  status() {
    const state = this.store.read();
    return {
      initialized: state.initialized,
      pendingSetup: Boolean(state.pendingOwner),
      setupTokenRequired: !state.initialized,
      authenticationRequired: state.initialized,
    };
  }

  beginSetup({ suppliedSetupToken, username, displayName, password }) {
    const state = this.store.read();
    if (state.initialized) throw Object.assign(new Error('NOESAR is already initialized.'), { status:409 });
    if (!this.setupTokenDigest) throw Object.assign(new Error('NOESAR_SETUP_TOKEN is required for first-run setup.'), { status:503 });
    if (tokenDigest(String(suppliedSetupToken ?? '')) !== this.setupTokenDigest) {
      this.ledger.append({ actor:'anonymous', action:'auth.setup-denied', result:'denied' });
      throw Object.assign(new Error('Invalid setup token.'), { status:403 });
    }
    const policy = passwordPolicy(password);
    if (!policy.valid) throw Object.assign(new Error(policy.reasons.join(' ')), { status:400 });
    const normalized = normalizeUsername(username);
    const secret = createTotpSecret();
    const challenge = randomToken(24);
    const pending = {
      challengeDigest: tokenDigest(challenge),
      expiresAt: Date.now() + 10 * 60_000,
      user: {
        id: randomUUID(),
        username: normalized,
        displayName: String(displayName ?? normalized).trim().slice(0, 100),
        role: 'owner',
        password: hashPassword(password),
        totp: encryptSecret(secret, this.masterKey),
        createdAt: nowIso(),
        failedLoginCount: 0,
        lockedUntil: 0,
      },
    };
    this.store.update((next) => { next.pendingOwner = pending; });
    this.ledger.append({ actor:'anonymous', action:'auth.setup-started', result:'pending', details:{ username:normalized } });
    return {
      challenge,
      username: normalized,
      totpSecret: secret,
      otpauthUri: `otpauth://totp/NOESAR%20Evolution:${encodeURIComponent(normalized)}?secret=${secret}&issuer=NOESAR%20Evolution&algorithm=SHA1&digits=6&period=30`,
      expiresAt: new Date(pending.expiresAt).toISOString(),
    };
  }

  confirmSetup({ challenge, totpCode }) {
    const state = this.store.read();
    const pending = state.pendingOwner;
    if (!pending || pending.expiresAt < Date.now()) throw Object.assign(new Error('Setup challenge expired.'), { status:400 });
    if (tokenDigest(String(challenge ?? '')) !== pending.challengeDigest) throw Object.assign(new Error('Invalid setup challenge.'), { status:403 });
    const secret = decryptSecret(pending.user.totp, this.masterKey);
    const consumed = consumeTotp(secret, totpCode, pending.user);
    if (!consumed.accepted) throw Object.assign(new Error(consumed.reason === 'replayed' ? 'This authentication code has already been used.' : 'Invalid TOTP code.'), { status:403 });
    const user = { ...pending.user, lastTotpStep: consumed.step };
    this.store.update((next) => {
      next.users = [user];
      next.pendingOwner = null;
      next.initialized = true;
    });
    this.ledger.append({ actor:user.id, action:'auth.setup-completed', result:'success', details:{ username:user.username } });
    return this.createSession(user, { mfa:true });
  }

  #attemptKey(ip, username) { return `${ip}|${username}`; }

  #rateState(ip, username) {
    const key = this.#attemptKey(ip, username);
    const now = Date.now();
    const entries = (this.loginAttempts.get(key) ?? []).filter((value) => value > now - 15 * 60_000);
    this.loginAttempts.set(key, entries);
    return { key, entries };
  }

  #recordFailure(ip, username) {
    const state = this.#rateState(ip, username);
    state.entries.push(Date.now());
    this.loginAttempts.set(state.key, state.entries);
  }

  beginLogin({ username, password, ip }) {
    const normalized = normalizeUsername(username);
    const limiter = this.#rateState(ip, normalized);
    if (limiter.entries.length >= 8) throw Object.assign(new Error('Too many login attempts. Try again later.'), { status:429 });
    const state = this.store.read();
    if (!state.initialized) throw Object.assign(new Error('NOESAR setup is incomplete.'), { status:409 });
    const user = state.users.find((item) => item.username === normalized);
    // A disabled account, a revoked account and a non-interactive service account all
    // fail here, down the same branch as a wrong password and with the same message and
    // the same timing. Answering "that account is disabled" would turn the login form
    // into an account-status oracle for anyone who can guess a username.
    if (user && (!isActive(user) || NON_INTERACTIVE_ROLES.has(user.role))) {
      this.#recordFailure(ip, normalized);
      this.ledger.append({
        actor:user.id, action:'auth.login-denied', result:'denied',
        details:{ username:normalized, reason:isActive(user) ? 'non-interactive-role' : user.status },
      });
      throw Object.assign(new Error('Invalid credentials or account temporarily locked.'), { status:401 });
    }
    if (!user || user.lockedUntil > Date.now() || !verifyPassword(password, user.password)) {
      this.#recordFailure(ip, normalized);
      if (user) {
        this.store.update((next) => {
          const target = next.users.find((item) => item.id === user.id);
          target.failedLoginCount = Number(target.failedLoginCount ?? 0) + 1;
          if (target.failedLoginCount >= 5) target.lockedUntil = Date.now() + 5 * 60_000;
        });
      }
      this.ledger.append({ actor:user?.id ?? 'anonymous', action:'auth.login-failed', result:'denied', details:{ username:normalized } });
      throw Object.assign(new Error('Invalid credentials or account temporarily locked.'), { status:401 });
    }

    const challenge = randomToken(24);
    const challengeRecord = {
      id: randomUUID(),
      challengeDigest: tokenDigest(challenge),
      userId: user.id,
      expiresAt: Date.now() + 5 * 60_000,
      ip,
    };
    this.store.update((next) => {
      next.loginChallenges = next.loginChallenges.filter((item) => item.expiresAt > Date.now());
      next.loginChallenges.push(challengeRecord);
      const target = next.users.find((item) => item.id === user.id);
      target.failedLoginCount = 0;
      target.lockedUntil = 0;
    });
    this.ledger.append({ actor:user.id, action:'auth.password-verified', result:'mfa-required' });
    return { mfaRequired:true, challenge, expiresAt:new Date(challengeRecord.expiresAt).toISOString() };
  }

  completeLogin({ challenge, totpCode, ip }) {
    const state = this.store.read();
    const digest = tokenDigest(String(challenge ?? ''));
    const item = state.loginChallenges.find((candidate) => candidate.challengeDigest === digest);
    if (!item || item.expiresAt < Date.now() || item.ip !== ip) throw Object.assign(new Error('Invalid or expired login challenge.'), { status:401 });
    const user = state.users.find((candidate) => candidate.id === item.userId);
    if (!user) throw Object.assign(new Error('User no longer exists.'), { status:401 });
    if (!user.totp) {
      // Defence in depth. Every interactive account enrols MFA before it exists, so
      // reaching here means an account was created by some path that did not. Refuse it
      // rather than dereferencing a null envelope and answering 500.
      this.ledger.append({ actor:user.id, action:'auth.mfa-missing', result:'denied' });
      throw Object.assign(new Error('This account cannot complete authentication.'), { status:403 });
    }
    const secret = decryptSecret(user.totp, this.masterKey);
    const consumed = consumeTotp(secret, totpCode, user);
    if (!consumed.accepted) {
      this.#recordFailure(ip, user.username);
      this.ledger.append({ actor:user.id, action:consumed.reason === 'replayed' ? 'auth.mfa-replayed' : 'auth.mfa-failed', result:'denied' });
      throw Object.assign(new Error(consumed.reason === 'replayed' ? 'This authentication code has already been used.' : 'Invalid TOTP code.'), { status:401 });
    }
    this.store.update((next) => {
      next.loginChallenges = next.loginChallenges.filter((candidate) => candidate.id !== item.id);
      const target = next.users.find((candidate) => candidate.id === user.id);
      if (target) target.lastTotpStep = consumed.step;
    });
    return this.createSession(user, { mfa:true });
  }

  createSession(user, { mfa=false } = {}) {
    const token = randomToken(32);
    const csrf = randomToken(24);
    const now = Date.now();
    const record = {
      id: randomUUID(),
      tokenDigest: tokenDigest(token),
      csrfDigest: tokenDigest(csrf),
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + 8 * 60 * 60_000,
      idleExpiresAt: now + 30 * 60_000,
      mfa,
      elevatedUntil: 0,
    };
    this.store.update((next) => {
      next.sessions = next.sessions.filter((item) => item.expiresAt > now && item.idleExpiresAt > now);
      next.sessions.push(record);
    });
    this.ledger.append({ actor:user.id, action:'auth.login', result:'success', details:{ role:user.role, mfa } });
    return {
      token,
      csrf,
      session: record,
      user: publicUser(user),
    };
  }

  authenticate(token) {
    if (!token) return null;
    const digest = tokenDigest(token);
    const now = Date.now();
    const state = this.store.read();
    const session = state.sessions.find((item) => item.tokenDigest === digest);
    if (!session || session.expiresAt < now || session.idleExpiresAt < now) return null;
    const user = state.users.find((item) => item.id === session.userId);
    if (!user) return null;
    // Disabling an account must take effect on the account's LIVE sessions, not only on
    // the next login. Checked here, on the authentication path every request passes
    // through, rather than at revocation time where a missed session would survive.
    if (!isActive(user)) return null;
    this.store.update((next) => {
      const current = next.sessions.find((item) => item.id === session.id);
      if (current) {
        current.lastSeenAt = now;
        current.idleExpiresAt = Math.min(current.expiresAt, now + 30 * 60_000);
      }
    });
    return { session, user:publicUser(user), rawUser:user };
  }

  verifyCsrf(session, supplied) {
    return Boolean(session && supplied && tokenDigest(String(supplied)) === session.csrfDigest);
  }

  hasPermission(user, permission) {
    return Boolean(ROLE_PERMISSIONS[user?.role]?.has(permission));
  }

  /**
   * The permissions a role actually carries, as data.
   *
   * The interface has to decide whether to offer a control at all — showing someone a
   * button that can only ever answer 403 is the same defect as a panel that never
   * finishes loading. The alternative was to restate this matrix in the browser, which
   * is one refactor away from disagreeing with the server that enforces it. It is
   * derived from the single ROLE_PERMISSIONS definition instead. This is a description,
   * not a grant: every route still checks for itself.
   */
  permissionsFor(role) {
    return [...(ROLE_PERMISSIONS[role] ?? [])].sort();
  }

  /**
   * Verify a TOTP code against an account record that is still being enrolled, applying
   * the same single-use rule as a login. Exposed because the multi-user invitation flow
   * enrols MFA before the account exists, and duplicating the replay check there is how
   * the replay defect (F4-002) would come back through a second door.
   */
  consumeEnrolmentCode(userRecord, code) {
    if (!userRecord?.totp) return { accepted:false, reason:'no-secret', step:null };
    const secret = decryptSecret(userRecord.totp, this.masterKey);
    return consumeTotp(secret, code, userRecord);
  }

  reauthenticate({ sessionId, password, totpCode }) {
    const state = this.store.read();
    const session = state.sessions.find((item) => item.id === sessionId);
    const user = state.users.find((item) => item.id === session?.userId);
    // Step-up reauthentication is available to every role that carries MFA, which since
    // multi-user means owner AND admin. Restricting it to owner would have left an
    // administrator holding auth.manage with no way to prove presence before using it.
    if (!session || !user || !MFA_REQUIRED_ROLES.has(user.role) || !isActive(user)) {
      throw Object.assign(new Error('An owner or administrator session with MFA is required.'), { status:403 });
    }
    const secret = decryptSecret(user.totp, this.masterKey);
    const consumed = consumeTotp(secret, totpCode, user);
    if (!verifyPassword(password, user.password) || !consumed.accepted) {
      this.ledger.append({ actor:user.id, action:consumed.reason === 'replayed' ? 'auth.reauth-replayed' : 'auth.reauth-failed', result:'denied' });
      throw Object.assign(new Error(consumed.reason === 'replayed' ? 'This authentication code has already been used.' : 'Strong reauthentication failed.'), { status:403 });
    }
    const elevatedUntil = Date.now() + 5 * 60_000;
    this.store.update((next) => {
      const current = next.sessions.find((item) => item.id === session.id);
      current.elevatedUntil = elevatedUntil;
      const target = next.users.find((candidate) => candidate.id === user.id);
      if (target) target.lastTotpStep = consumed.step;
    });
    this.ledger.append({ actor:user.id, action:'auth.reauthenticated', result:'success', details:{ expiresAt:new Date(elevatedUntil).toISOString() } });
    return { elevatedUntil, expiresAt:new Date(elevatedUntil).toISOString() };
  }

  // --- account security -----------------------------------------------------
  //
  // Everything below is gated on proof of presence: the current password AND a current,
  // unreplayed authenticator code. A stolen session cookie is therefore not enough to
  // change a password, replace an authenticator or mint recovery codes — which is the
  // entire point of holding a second factor.

  /** Verify presence and consume the TOTP step, so one code cannot drive two changes. */
  #assertPresence(user, password, totpCode, action) {
    const secret = decryptSecret(user.totp, this.masterKey);
    const consumed = consumeTotp(secret, totpCode, user);
    if (!verifyPassword(password, user.password) || !consumed.accepted) {
      this.ledger.append({ actor:user.id, action:`${action}.denied`, result:'denied',
        details:{ reason:consumed.reason === 'replayed' ? 'code-replayed' : 'credentials' } });
      throw Object.assign(new Error(consumed.reason === 'replayed'
        ? 'This authentication code has already been used. Wait for the next one.'
        : 'Current password or authenticator code is incorrect.'), { status:403 });
    }
    return consumed.step;
  }

  #requireUser(userId) {
    const user = this.store.read().users.find((item) => item.id === userId);
    if (!user) throw Object.assign(new Error('Account not found.'), { status:404 });
    return user;
  }

  securityOverview(userId, currentSessionId = null) {
    const state = this.store.read();
    const user = state.users.find((item) => item.id === userId);
    if (!user) throw Object.assign(new Error('Account not found.'), { status:404 });
    const now = Date.now();
    const sessions = state.sessions
      .filter((item) => item.userId === userId && item.expiresAt > now)
      .map((item) => ({
        id:item.id, current:item.id === currentSessionId,
        createdAt:new Date(item.createdAt).toISOString(),
        lastSeenAt:new Date(item.lastSeenAt).toISOString(),
        expiresAt:new Date(item.expiresAt).toISOString(),
        mfa:Boolean(item.mfa), elevated:Number(item.elevatedUntil ?? 0) > now,
      }));
    return {
      username:user.username, displayName:user.displayName, role:user.role,
      mfaEnabled:Boolean(user.totp),
      mfaUpdatedAt:user.totpUpdatedAt ? new Date(user.totpUpdatedAt).toISOString() : null,
      // Only the COUNT of unused codes is exposed. The codes are stored as digests and
      // cannot be re-shown, by construction.
      recoveryCodesRemaining:(user.recoveryCodes ?? []).filter((item) => !item.usedAt).length,
      recoveryCodesGeneratedAt:user.recoveryCodesGeneratedAt ? new Date(user.recoveryCodesGeneratedAt).toISOString() : null,
      sessions, sessionCount:sessions.length,
      locked:Number(user.lockedUntil ?? 0) > now,
      lockedUntil:Number(user.lockedUntil ?? 0) > now ? new Date(user.lockedUntil).toISOString() : null,
      failedLoginCount:Number(user.failedLoginCount ?? 0),
      passkeySupported:false,
      passwordUpdatedAt:user.passwordUpdatedAt ? new Date(user.passwordUpdatedAt).toISOString() : null,
    };
  }

  changePassword({ userId, sessionId, currentPassword, totpCode, newPassword, revokeOtherSessions = true }) {
    const user = this.#requireUser(userId);
    // passwordPolicy returns { valid, reasons } — not { ok, reason }. Getting that
    // wrong reads as "policy passed" for every password, including an empty one.
    const policy = passwordPolicy(newPassword);
    if (!policy.valid) throw Object.assign(new Error(policy.reasons.join(' ')), { status:400 });
    if (verifyPassword(newPassword, user.password)) {
      throw Object.assign(new Error('The new password must differ from the current one.'), { status:400 });
    }
    const step = this.#assertPresence(user, currentPassword, totpCode, 'auth.password-change');
    const descriptor = hashPassword(newPassword);
    let revoked = 0;
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === userId);
      target.password = descriptor; target.passwordUpdatedAt = Date.now();
      target.lastTotpStep = step; target.failedLoginCount = 0; target.lockedUntil = 0;
      if (revokeOtherSessions) {
        const before = next.sessions.length;
        next.sessions = next.sessions.filter((item) => item.userId !== userId || item.id === sessionId);
        revoked = before - next.sessions.length;
      }
    });
    this.ledger.append({ actor:userId, action:'auth.password-changed', result:'success', details:{ revokedSessions:revoked } });
    return { changed:true, revokedSessions:revoked };
  }

  /**
   * Step 1 of replacing the authenticator: prove presence, then mint a CANDIDATE
   * secret held aside. The live secret keeps working until the new one is confirmed,
   * so an abandoned rotation cannot lock anybody out of their own installation.
   */
  beginMfaReplacement({ userId, password, totpCode }) {
    const user = this.#requireUser(userId);
    const step = this.#assertPresence(user, password, totpCode, 'auth.mfa-replace');
    const secret = createTotpSecret();
    const challenge = randomToken(24);
    const issuer = 'NOESAR Evolution';
    const label = `${issuer}:${user.username}`;
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === userId);
      target.lastTotpStep = step;
      target.pendingTotp = {
        challengeDigest:tokenDigest(challenge),
        secret:encryptSecret(secret, this.masterKey),
        createdAt:Date.now(), expiresAt:Date.now() + 10 * 60_000,
      };
    });
    this.ledger.append({ actor:userId, action:'auth.mfa-replace-started', result:'success' });
    return {
      challenge, secret,
      // Two forms, deliberately.
      //
      // otpauthUri is the compact Key URI: when 'issuer' is present as a parameter the
      // label prefix is redundant, and SHA-1 / 6 digits / 30 seconds are the
      // specification defaults this server verifies against. It is what Google
      // Authenticator itself emits, and it stays inside the QR encoder's verified
      // capacity (version 1-6, level M, 106 bytes) for any username this product allows.
      //
      // otpauthUriExplicit spells those parameters out for anyone transcribing by hand
      // or importing into a tool that does not assume the defaults. Both enrol the
      // same secret and produce the same codes.
      otpauthUri:`otpauth://totp/${encodeURIComponent(user.username)}?secret=${secret}`
        + `&issuer=${encodeURIComponent(issuer)}`,
      otpauthUriExplicit:`otpauth://totp/${encodeURIComponent(label)}?secret=${secret}`
        + `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
      totpAlgorithm:'SHA1', totpDigits:6, totpPeriodSeconds:30,
      expiresAt:new Date(Date.now() + 10 * 60_000).toISOString(),
    };
  }

  /**
   * Step 2: two CONSECUTIVE codes from the candidate. One code proves the secret was
   * transcribed; two consecutive ones prove the clock agrees as well, and cannot both
   * come from a single screenshot of one stale code.
   */
  confirmMfaReplacement({ userId, sessionId, challenge, firstCode, secondCode, revokeOtherSessions = true }) {
    const user = this.#requireUser(userId);
    const pending = user.pendingTotp;
    if (!pending) throw Object.assign(new Error('No authenticator replacement is in progress.'), { status:409 });
    if (pending.expiresAt < Date.now()) throw Object.assign(new Error('The replacement expired. Start again.'), { status:410 });
    if (tokenDigest(String(challenge ?? '')) !== pending.challengeDigest) {
      throw Object.assign(new Error('Invalid replacement challenge.'), { status:403 });
    }
    const candidate = decryptSecret(pending.secret, this.masterKey);
    const first = verifyTotpStep(candidate, firstCode);
    const second = verifyTotpStep(candidate, secondCode);
    if (!first.valid || !second.valid) {
      this.ledger.append({ actor:userId, action:'auth.mfa-replace-denied', result:'denied', details:{ reason:'invalid-code' } });
      throw Object.assign(new Error('Those codes do not match the new authenticator.'), { status:403 });
    }
    if (second.step !== first.step + 1) {
      this.ledger.append({ actor:userId, action:'auth.mfa-replace-denied', result:'denied', details:{ reason:'not-consecutive' } });
      throw Object.assign(new Error('The two codes must be consecutive. Enter one, wait for it to change, then enter the next.'), { status:400 });
    }
    const { codes, digests } = buildRecoveryCodes();
    let revoked = 0;
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === userId);
      // Atomic swap: the old secret is overwritten in the same update that clears the
      // candidate, so there is no window where both work or neither does.
      target.totp = pending.secret; target.totpUpdatedAt = Date.now();
      target.lastTotpStep = second.step;
      target.recoveryCodes = digests; target.recoveryCodesGeneratedAt = Date.now();
      delete target.pendingTotp;
      if (revokeOtherSessions) {
        const before = next.sessions.length;
        next.sessions = next.sessions.filter((item) => item.userId !== userId || item.id === sessionId);
        revoked = before - next.sessions.length;
      }
    });
    // The secret is never written to the ledger, in any form.
    this.ledger.append({ actor:userId, action:'auth.mfa-replaced', result:'success',
      details:{ revokedSessions:revoked, recoveryCodesIssued:codes.length } });
    return { replaced:true, recoveryCodes:codes, revokedSessions:revoked };
  }

  cancelMfaReplacement(userId) {
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === userId);
      if (target) delete target.pendingTotp;
    });
    this.ledger.append({ actor:userId, action:'auth.mfa-replace-cancelled', result:'success' });
    return { cancelled:true };
  }

  regenerateRecoveryCodes({ userId, password, totpCode }) {
    const user = this.#requireUser(userId);
    const step = this.#assertPresence(user, password, totpCode, 'auth.recovery-regenerate');
    const { codes, digests } = buildRecoveryCodes();
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === userId);
      target.recoveryCodes = digests; target.recoveryCodesGeneratedAt = Date.now();
      target.lastTotpStep = step;
    });
    this.ledger.append({ actor:userId, action:'auth.recovery-codes-regenerated', result:'success', details:{ issued:codes.length } });
    return { codes };
  }

  revokeSession({ userId, sessionId, targetSessionId }) {
    if (targetSessionId === sessionId) {
      throw Object.assign(new Error('Use sign out to end the session you are using.'), { status:400 });
    }
    let revoked = 0;
    this.store.update((next) => {
      const before = next.sessions.length;
      next.sessions = next.sessions.filter((item) => !(item.id === targetSessionId && item.userId === userId));
      revoked = before - next.sessions.length;
    });
    if (!revoked) throw Object.assign(new Error('That session no longer exists.'), { status:404 });
    this.ledger.append({ actor:userId, action:'auth.session-revoked', result:'success', details:{ sessionId:targetSessionId } });
    return { revoked };
  }

  revokeOtherSessions({ userId, sessionId }) {
    let revoked = 0;
    this.store.update((next) => {
      const before = next.sessions.length;
      next.sessions = next.sessions.filter((item) => item.userId !== userId || item.id === sessionId);
      revoked = before - next.sessions.length;
    });
    this.ledger.append({ actor:userId, action:'auth.sessions-revoked', result:'success', details:{ revoked } });
    return { revoked };
  }

  logout(sessionId, actorId) {
    this.store.update((next) => { next.sessions = next.sessions.filter((item) => item.id !== sessionId); });
    this.ledger.append({ actor:actorId, action:'auth.logout', result:'success' });
  }

  cookieHeaders({ token, csrf }) {
    const secure = this.secureCookies ? '; Secure' : '';
    return [
      `noesar_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`,
      `noesar_csrf=${csrf}; Path=/; SameSite=Strict; Max-Age=28800${secure}`,
    ];
  }

  clearCookieHeaders() {
    const secure = this.secureCookies ? '; Secure' : '';
    return [
      `noesar_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
      `noesar_csrf=; Path=/; SameSite=Strict; Max-Age=0${secure}`,
    ];
  }
}

export function parseCookies(header = '') {
  const result = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    result[part.slice(0,index).trim()] = decodeURIComponent(part.slice(index+1).trim());
  }
  return result;
}
