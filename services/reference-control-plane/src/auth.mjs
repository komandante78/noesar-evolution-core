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
  verifyTotp,
} from './auth-crypto.mjs';
import { AuthStore } from './auth-store.mjs';

const AI_USER = ['workspace.read','workspace.write','provider.use','memory.manage','artifact.manage','knowledge.manage'];
const AI_ADMIN = [...AI_USER,'provider.manage','agent.manage','data.manage'];
const ROLE_PERMISSIONS = Object.freeze({
  owner: new Set(['user.read','hardware.read','runtime.plan','coden.plan','coden.authorize','coden.owner-bypass','audit.read','auth.manage',...AI_ADMIN]),
  admin: new Set(['user.read','hardware.read','runtime.plan','coden.plan','coden.authorize','audit.read','auth.manage',...AI_ADMIN]),
  developer: new Set(['user.read','hardware.read','runtime.plan','coden.plan','coden.authorize',...AI_ADMIN]),
  user: new Set(['user.read','hardware.read','runtime.plan',...AI_USER]),
});

function normalizeUsername(value) {
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
    mfaEnabled: Boolean(user.totp),
    createdAt: user.createdAt,
  };
}

function nowIso() { return new Date().toISOString(); }

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
    if (!verifyTotp(secret, totpCode)) throw Object.assign(new Error('Invalid TOTP code.'), { status:403 });
    const user = pending.user;
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
    const secret = decryptSecret(user.totp, this.masterKey);
    if (!verifyTotp(secret, totpCode)) {
      this.#recordFailure(ip, user.username);
      this.ledger.append({ actor:user.id, action:'auth.mfa-failed', result:'denied' });
      throw Object.assign(new Error('Invalid TOTP code.'), { status:401 });
    }
    this.store.update((next) => {
      next.loginChallenges = next.loginChallenges.filter((candidate) => candidate.id !== item.id);
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

  reauthenticate({ sessionId, password, totpCode }) {
    const state = this.store.read();
    const session = state.sessions.find((item) => item.id === sessionId);
    const user = state.users.find((item) => item.id === session?.userId);
    if (!session || !user || user.role !== 'owner') throw Object.assign(new Error('Owner session required.'), { status:403 });
    const secret = decryptSecret(user.totp, this.masterKey);
    if (!verifyPassword(password, user.password) || !verifyTotp(secret, totpCode)) {
      this.ledger.append({ actor:user.id, action:'auth.reauth-failed', result:'denied' });
      throw Object.assign(new Error('Strong reauthentication failed.'), { status:403 });
    }
    const elevatedUntil = Date.now() + 5 * 60_000;
    this.store.update((next) => {
      const current = next.sessions.find((item) => item.id === session.id);
      current.elevatedUntil = elevatedUntil;
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
