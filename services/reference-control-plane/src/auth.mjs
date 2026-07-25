// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
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
