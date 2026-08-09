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
import { COSE_ALG_ES256, verifyAssertion, verifyRegistration } from './webauthn.mjs';

const AI_USER = ['workspace.read','workspace.write','provider.use','memory.manage','artifact.manage','knowledge.manage'];
const AI_ADMIN = [...AI_USER,'provider.manage','agent.manage','data.manage'];
// A restricted client may hold a conversation and read what it is given. It may not
// register a provider, define an agent or a tool, or promote anything into shared
// memory — every capability that would let one account change what another account's
// session executes.
const AI_CLIENT_RESTRICTED = ['workspace.read','workspace.write','provider.use'];
// A service account is non-interactive: it authenticates with a bearer token, has no
// password and no TOTP, and therefore must not hold a permission whose blast radius
// depends on a human noticing in time. It reads, it holds a conversation, and it uses a
// provider — the same three the restricted client holds, and no more.
//
// D-0279 widened this from ['workspace.read','provider.use'] on purpose, and the reason
// is worth stating because the narrower set LOOKED safer than it was: `provider.use`
// already writes. `POST /api/v1/chat/stream` calls graph.addMessage twice per turn, so an
// account holding only `provider.use` was already appending content to the workspace; what
// it could not do was create the conversation to append into, which made the permission
// self-contradictory rather than restrictive. `workspace.write` closes that gap and adds
// nothing a `client_restricted` human account does not already have: it still cannot
// register a provider, define an agent or a tool, or promote anything into shared memory —
// the three capabilities that would let one account change what another account executes.
const AI_SERVICE_ACCOUNT = ['workspace.read','workspace.write','provider.use'];

export const ROLES = Object.freeze([
  'owner', 'admin', 'developer', 'user', 'client_restricted', 'service_account',
]);

// Owner and admin carry MFA. Enforced here and again as a CHECK constraint in migration
// 0013: a rule that lives in exactly one layer is one refactor away from gone.
export const MFA_REQUIRED_ROLES = Object.freeze(new Set(['owner', 'admin']));

// Roles that authenticate with a bearer token instead of a password.
export const NON_INTERACTIVE_ROLES = Object.freeze(new Set(['service_account']));

const ROLE_PERMISSIONS = Object.freeze({
  owner: new Set(['user.read','hardware.read','model.read','runtime.plan','coden.plan','coden.authorize','coden.owner-bypass','audit.read','auth.manage','user.manage','model.manage',...AI_ADMIN]),
  admin: new Set(['user.read','hardware.read','model.read','runtime.plan','coden.plan','coden.authorize','audit.read','auth.manage','user.manage','model.manage',...AI_ADMIN]),
  developer: new Set(['user.read','hardware.read','model.read','runtime.plan','coden.plan','coden.authorize',...AI_ADMIN]),
  user: new Set(['user.read','hardware.read','model.read','runtime.plan',...AI_USER]),
  client_restricted: new Set(['user.read','model.read',...AI_CLIENT_RESTRICTED]),
  // `model.read` — s336. Owner, s335: «1 modello che viene caricato lo vedano tutti, anche i
  // moduli devono vedere il modello caricato». Stage 1 built `/api/v1/models/active` and chose
  // `model.read` for it precisely so a module could ask; the permission table was never widened
  // to match, and `service_account` was the ONE role in this object without it. So the single
  // caller the requirement names was the single caller refused — 403, not 401: the module's
  // token authenticated and then failed authorisation, which is why nothing about it looked
  // like a credential problem. Found by asking as a module, not by reading the table.
  //
  // It is a read of an identity, not authority over it: `model.manage` stays where it was, and
  // an installation's answer to "which model is loaded" is the same answer for everyone who can
  // already run a turn on that model — which this role can.
  service_account: new Set(['user.read','model.read',...AI_SERVICE_ACCOUNT]),
});

export const RolePermissions = ROLE_PERMISSIONS;

/**
 * Who may read service-health *detail* — one definition, for every surface that
 * decides it.
 *
 * Owner role AND audit.read, not either alone. `admin` also carries audit.read, so a
 * permission-only test would disclose to admins what the owner-only Health section
 * withholds from them; and a role-only test would ignore the permission model
 * entirely. Both conditions, stated once, because an endpoint that disagrees with the
 * others becomes the way around the gate the others are enforcing — which is exactly
 * what /healthz was until it started asking this question.
 *
 * Pure, and exported, so the rule can be tested without starting a listener.
 */
export function mayReadHealthDetail(user) {
  return user?.role === 'owner' && Boolean(ROLE_PERMISSIONS[user.role]?.has('audit.read'));
}

/**
 * The enrolment URI a QR encodes, kept SHORT on purpose.
 *
 * `algorithm=SHA1&digits=6&period=30` are the RFC 6238 defaults that every authenticator
 * assumes, and spelling them out cost 38 bytes; the issuer was written twice, in full, for
 * another 20. That mattered because this product ships its own encoder, verified only for QR
 * versions 1-6 — 106 bytes at level M (`F4W-005`). The old string was **140 bytes**, so the QR
 * on the setup screen never drew at all, on any installation, and the client swallowed the
 * error. Reported by the Owner mid-setup: «non mostra nessun qrcode».
 *
 * At 82 bytes for a short username this leaves room for about 24 more characters. A username
 * longer than that still overflows, and the interface says so rather than showing an empty box:
 * a limit that is stated is a limit; one that is silent is a defect.
 */
export function otpauthUriFor(username, secret) {
  return `otpauth://totp/NOESAR:${encodeURIComponent(username)}?secret=${secret}&issuer=NOESAR`;
}

export function normalizeUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    // 400, not a bare Error. Without the status the request handler falls back to 500, and a
    // 5xx also has its message REPLACED by "Internal request failure." — so a rejected input
    // was reported to the person as a broken product, with the reason removed on the way out.
    // Found in production (D-0368): the Owner typed an email address into the sign-in form and
    // got a 500 and a blank screen.
    throw Object.assign(new Error('Username must contain 3-64 lowercase-safe characters.'), { status:400 });
  }
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
// Exactly 32 symbols, which also makes `byte % length` uniform over 0..255 — no modulo
// bias, so the entropy claimed below is the entropy delivered.
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// --- Terminal attach codes (D-0337) -----------------------------------------------------
//
// One authentication, not two: a browser session that is already inside NOESAR mints a
// short code, and the terminal spends it at the socket instead of asking for username,
// password and second factor a second time.
//
// The code is NOT authority. It is a claim ticket: it carries no permission of its own,
// it opens a session for the account that minted it and never for another, and spending
// it destroys it. That distinction is the whole design — `16` §4.3's first trap is that
// "access conveniences are not paid for with authority", and a bearer credential with an
// eight-hour life handed to a human to retype would have been exactly that payment.
//
// Why the window is this short. The HTTP login challenge is pinned to the caller's IP
// (`completeLogin`: `item.ip !== ip`), and an attach code CANNOT be — it is born at a
// browser and spent on a unix socket, which reports itself as `unix-socket`. Provenance
// is therefore unavailable as a bound, and the only two bounds left are time and single
// use. They are not decoration; they are the entire perimeter, which is why the window is
// sixty seconds rather than a comfortable ten minutes.
const ATTACH_CODE_TTL_MS = 60_000;
// 8 symbols over a 32-symbol alphabet = 40 bits, printed as two groups of four. Against a
// 60-second window and the shared login rate limiter (8 failures per 15 minutes), guessing
// is not a threat model this size has to survive on entropy alone — but it costs nothing to
// make brute force absurd rather than merely impractical.
const ATTACH_CODE_SYMBOLS = 8;
// Failed redemptions tolerated in the limiter's 15-minute window, counted separately from
// password failures because the key is distinct.
//
// Why this is not the login limiter's 8. Against 40 bits inside a 60-second window, a
// grinder managing a thousand guesses a second gets 6e4 attempts against 1.1e12
// possibilities — about five chances in a hundred million. The rate limit is therefore not
// what makes guessing hopeless; entropy and the window already did that. Its remaining job
// is to stop a client burning the process on a loop. Set at 8, the real effect would have
// been to lock a human out of their terminal after a few typos on an eight-character code
// read off another screen — a limit paid for entirely by the legitimate operator.
const ATTACH_FAILURE_BUDGET = 20;

// --- Remembered terminals (D-0348) ------------------------------------------------------
//
// The Owner's requirement, in their words: *"apro ssh e digito solo `coden_evolution` e si
// apre"*. `D-0337` had already removed the second AUTHENTICATION; what it left behind was a
// second GESTURE — the attach code, read off a browser and retyped at the socket. One word
// plus one code is two things to do, and the requirement is one.
//
// What is NOT possible, measured in s330 rather than assumed: the session cannot ask the
// operating system who is calling. A unix socket at 0600 answers "may this uid knock", never
// "who are you", and Node exposes no `SO_PEERCRED`. So a terminal that opens with nothing
// typed must present SOMETHING, and the only honest something is a secret the operator's
// machine already holds.
//
// Hence enrolment, the same shape ssh keys and `gh auth login` use: the FIRST run
// authenticates exactly as today and, on success, the terminal is issued a token it stores
// itself. Every later run presents that token and opens. The one-time cost is stated out
// loud instead of engineered away, because engineering it away means trusting the transport
// to name the caller — the thing that cannot be done.
//
// What the token is, and what it deliberately is not:
//  - it is a POSSESSION factor, held at 0600 by the account that will spend it;
//  - it carries no permission of its own — it opens a session for the account that enrolled
//    it and never for another, exactly like an attach code;
//  - it does NOT carry elevation. `elevatedUntil` is re-earned, never inherited, so a
//    remembered terminal still faces step-up on a sensitive action;
//  - it is revocable by the account that owns it, and every use is dated, so "which
//    terminals can open my session" is a question with an answer.
//
// Why the life is long where an attach code's is sixty seconds. They are opposite objects.
// An attach code is read aloud off a screen and retyped, so its perimeter must be time and
// single use. A terminal token is never displayed, never retyped, and never leaves the file
// it was written to; its perimeter is the filesystem permission and the operator's ability
// to revoke it. Making it expire in a minute would defeat the entire requirement.
const TERMINAL_TOKEN_BYTES = 32;
// Sliding, not fixed: a terminal in daily use never expires, and one abandoned for ninety
// days stops working on its own. A fixed life would log the operator out on a date they
// cannot predict — the exact failure this requirement exists to remove.
const TERMINAL_ENROLMENT_IDLE_MS = 90 * 24 * 60 * 60_000;
// Same reasoning as `ATTACH_FAILURE_BUDGET`, and the same number: against a 256-bit token
// the limiter is not what makes guessing hopeless, so its only job is to stop a broken
// client spinning. Set low, it would lock out the legitimate operator instead.
const TERMINAL_FAILURE_BUDGET = 20;

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

/** Mint the plaintext of one attach code. Never stored in this form — only its digest is. */
function buildAttachCode() {
  let text = '';
  for (const byte of randomBytes(ATTACH_CODE_SYMBOLS)) text += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

/** The one place that decides what a typed attach code means, so both ends agree. */
export function normalizeAttachCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
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
      otpauthUri: otpauthUriFor(normalized, secret),
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
    // Issued HERE, and that is the whole of D-0369's first half: before it, the first owner
    // finished setup with NO recovery codes, and `regenerateRecoveryCodes` — the only thing
    // that made any — demands the password and a TOTP code, which is precisely what somebody
    // locked out does not have. The product carried the shape of a recovery mechanism with no
    // way in, and the Owner met that on 2026-08-09.
    const { codes, digests } = buildRecoveryCodes();
    const user = {
      ...pending.user, lastTotpStep: consumed.step,
      recoveryCodes: digests, recoveryCodesGeneratedAt: Date.now(),
    };
    this.store.update((next) => {
      // Non-owner accounts survive first-run. On a genuinely fresh installation there are none,
      // so this is a no-op; on one an operator has returned to first-run it preserves the
      // service account a module authenticates with, which `next.users = [user]` deleted
      // silently — detaching the module through an act nobody would connect to it.
      next.users = [...(next.users ?? []).filter((item) => item.role !== 'owner'), user];
      next.pendingOwner = null;
      next.initialized = true;
    });
    this.ledger.append({ actor:user.id, action:'auth.setup-completed', result:'success', details:{ username:user.username, recoveryCodesIssued:codes.length } });
    return { ...this.createSession(user, { mfa:true }), recoveryCodes: codes };
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
    let normalized;
    try {
      normalized = normalizeUsername(username);
    } catch {
      // A string this product could never have issued as a username cannot name an account, so
      // it is a failed credential and not a bad request: it leaves down the SAME branch as a
      // wrong password, with the same status and the same sentence. Answering 400 "your
      // username is malformed" here would confirm to an unauthenticated caller which strings
      // are candidate accounts and which are not — the sign-in form is the one place the
      // format rule is not theirs to learn. Setup answers 400 WITH the rule, because there the
      // caller holds the setup token and is choosing the name.
      //
      // The attempt still counts against the rate limiter, keyed on the raw string so that
      // hammering the form with junk cannot dodge the count. The value is deliberately NOT
      // written to the ledger: what arrives here is whatever somebody typed, and in the case
      // that produced this fix it was an email address.
      this.#recordFailure(ip, String(username ?? '').trim().toLowerCase().slice(0, 64));
      this.ledger.append({
        actor:'anonymous', action:'auth.login-failed', result:'denied', details:{ reason:'malformed-username' },
      });
      throw Object.assign(new Error('Invalid credentials or account temporarily locked.'), { status:401 });
    }
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

  /**
   * Stage 2 of login, passkey branch. The password step (`beginLogin`) already ran and
   * left the SAME `loginChallenges` record that `completeLogin` consumes for TOTP — a
   * passkey assertion is bound to that one challenge rather than a second, parallel
   * one, so a passkey response cannot be replayed onto a different login attempt.
   */
  passkeyLoginOptions({ challenge, rpId }) {
    const state = this.store.read();
    const digest = tokenDigest(String(challenge ?? ''));
    const item = state.loginChallenges.find((candidate) => candidate.challengeDigest === digest);
    if (!item || item.expiresAt < Date.now()) throw Object.assign(new Error('Invalid or expired login challenge.'), { status:401 });
    const user = state.users.find((candidate) => candidate.id === item.userId);
    if (!user || !(user.passkeys ?? []).length) throw Object.assign(new Error('No passkey is registered for this account.'), { status:404 });
    return {
      rpId,
      challenge,
      userVerification: 'required',
      timeoutMs: 60_000,
      allowCredentials: user.passkeys.map((entry) => ({ type:'public-key', id:entry.id })),
    };
  }

  completeLoginWithPasskey({ challenge, credentialId, clientDataJSON, authenticatorData, signature, ip, rpId, origin }) {
    const state = this.store.read();
    const digest = tokenDigest(String(challenge ?? ''));
    const item = state.loginChallenges.find((candidate) => candidate.challengeDigest === digest);
    if (!item || item.expiresAt < Date.now() || item.ip !== ip) throw Object.assign(new Error('Invalid or expired login challenge.'), { status:401 });
    const user = state.users.find((candidate) => candidate.id === item.userId);
    if (!user) throw Object.assign(new Error('User no longer exists.'), { status:401 });
    const passkey = (user.passkeys ?? []).find((entry) => entry.id === credentialId);
    if (!passkey) {
      this.#recordFailure(ip, user.username);
      this.ledger.append({ actor:user.id, action:'auth.passkey-login-failed', result:'denied', details:{ reason:'unknown-credential' } });
      throw Object.assign(new Error('Unrecognized passkey.'), { status:401 });
    }
    let verified;
    try {
      verified = verifyAssertion({
        clientDataJSON, authenticatorData, signature,
        expectedChallenge:challenge, expectedOrigin:origin, rpId,
        publicKeyJwk:passkey.publicKeyJwk, lastSignCount:Number(passkey.signCount ?? 0),
      });
    } catch (error) {
      this.#recordFailure(ip, user.username);
      this.ledger.append({ actor:user.id, action:'auth.passkey-login-failed', result:'denied', details:{ reason:error.message } });
      throw Object.assign(new Error('Passkey verification failed.'), { status:401 });
    }
    this.store.update((next) => {
      next.loginChallenges = next.loginChallenges.filter((candidate) => candidate.id !== item.id);
      const target = next.users.find((candidate) => candidate.id === user.id);
      const targetPasskey = target.passkeys.find((entry) => entry.id === credentialId);
      if (targetPasskey) { targetPasskey.signCount = verified.signCount; targetPasskey.lastUsedAt = nowIso(); }
      target.failedLoginCount = 0;
      target.lockedUntil = 0;
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

  /**
   * Mint a terminal attach code on behalf of a session that is ALREADY authenticated.
   *
   * Who may mint, and it is deliberately not a new permission: any live, MFA-backed
   * session, for its own account only. Adding a `terminal.attach` permission was
   * considered and rejected — the code grants nothing the minting session cannot already
   * do through the browser, so gating it would create a role that can drive the product
   * but not reach its own terminal, which is a support burden rather than a boundary.
   *
   * Three refusals, all fail-closed:
   *  - the session must exist and be live (a revoked session cannot mint on its way out);
   *  - it must belong to the account it claims (`userId` is never taken on trust);
   *  - it must be MFA-backed, so a code can never be a way to launder a weaker session
   *    into a terminal one.
   *
   * Minting also drops this session's previous unspent code. One outstanding code per
   * session, so a user who clicks twice cannot leave a live credential behind on screen.
   */
  mintAttachCode({ userId, sessionId }) {
    const now = Date.now();
    const state = this.store.read();
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session || session.expiresAt < now || session.idleExpiresAt < now || session.userId !== userId) {
      throw Object.assign(new Error('No live session to attach from.'), { status:401 });
    }
    if (!session.mfa) {
      this.ledger.append({ actor:userId, action:'auth.attach-code-denied', result:'denied', details:{ reason:'session-not-mfa' } });
      throw Object.assign(new Error('This session cannot mint a terminal attach code.'), { status:403 });
    }
    const user = state.users.find((item) => item.id === userId);
    if (!user || !isActive(user)) throw Object.assign(new Error('No live session to attach from.'), { status:401 });

    const code = buildAttachCode();
    const record = {
      id: randomUUID(),
      codeDigest: tokenDigest(code),
      userId,
      sessionId,
      createdAt: now,
      expiresAt: now + ATTACH_CODE_TTL_MS,
    };
    this.store.update((next) => {
      next.attachCodes = (next.attachCodes ?? [])
        .filter((item) => item.expiresAt > now && item.sessionId !== sessionId);
      next.attachCodes.push(record);
    });
    this.ledger.append({ actor:userId, action:'auth.attach-code-minted', result:'success', details:{ expiresInMs:ATTACH_CODE_TTL_MS } });
    return { code, expiresAt:new Date(record.expiresAt).toISOString(), expiresInMs:ATTACH_CODE_TTL_MS };
  }

  /**
   * Spend an attach code and get the session it was a ticket for.
   *
   * The single-use guarantee lives in the shape of ONE `store.update` call, not in two.
   * `AuthStore.update` is a synchronous read-modify-write, so a find and a delete inside
   * the same mutator cannot be interleaved by anything; a `read()` followed by a separate
   * `update()` — the idiom the rest of this file uses, safely, because nothing awaits in
   * between — would leave a window where two callers both saw the same live code. Here
   * that window would be the whole property, so it is closed structurally.
   *
   * The code is burned by the ATTEMPT, not by the success. A code whose account was
   * disabled between minting and spending is consumed and refused, because the alternative
   * leaves a live code lying around after it has already been sent over a wire.
   *
   * @param {string} code   the typed code, in any casing or spacing
   * @param {string} ip     the transport's own name for the caller — `unix-socket` in practice
   */
  redeemAttachCode({ code, ip }) {
    const limiter = this.#rateState(ip, '@attach-code');
    if (limiter.entries.length >= ATTACH_FAILURE_BUDGET) throw Object.assign(new Error('Too many attach attempts. Try again later.'), { status:429 });

    const normalized = normalizeAttachCode(code);
    const digest = tokenDigest(normalized);
    const now = Date.now();

    const claimed = this.store.update((next) => {
      next.attachCodes = (next.attachCodes ?? []).filter((item) => item.expiresAt > now);
      const index = next.attachCodes.findIndex((item) => item.codeDigest === digest);
      if (index === -1) return null;
      const [found] = next.attachCodes.splice(index, 1);
      // A code outlives its minting session only in the sense that it is a separate record.
      // If that session was revoked or logged out inside the window, the intent behind the
      // code is gone with it, and the code goes too.
      const minting = next.sessions.find((item) => item.id === found.sessionId);
      if (!minting || minting.expiresAt < now || minting.idleExpiresAt < now) return { found, reason:'minting-session-gone' };
      return { found, reason:null };
    });

    if (!claimed) {
      this.#recordFailure(ip, '@attach-code');
      this.ledger.append({ actor:'anonymous', action:'auth.attach-failed', result:'denied', details:{ reason:'unknown-or-expired', transport:ip } });
      throw Object.assign(new Error('Invalid or expired attach code.'), { status:401 });
    }
    if (claimed.reason) {
      this.ledger.append({ actor:claimed.found.userId, action:'auth.attach-failed', result:'denied', details:{ reason:claimed.reason, transport:ip } });
      throw Object.assign(new Error('Invalid or expired attach code.'), { status:401 });
    }

    const user = this.store.read().users.find((item) => item.id === claimed.found.userId);
    if (!user || !isActive(user)) {
      this.ledger.append({ actor:claimed.found.userId, action:'auth.attach-failed', result:'denied', details:{ reason:'account-not-active', transport:ip } });
      throw Object.assign(new Error('Invalid or expired attach code.'), { status:401 });
    }
    // `mfa:true` is carried, not assumed: minting already refused any session that lacked
    // it, so the second factor this session rests on is the one the browser really passed.
    // `elevatedUntil` is deliberately NOT carried — elevation is re-earned, never inherited.
    const issued = this.createSession(user, { mfa:true });
    this.ledger.append({ actor:user.id, action:'auth.attach-succeeded', result:'success', details:{ transport:ip, fromSessionId:claimed.found.sessionId } });
    return issued;
  }

  /**
   * Remember this terminal, so the next run opens with nothing typed (D-0348).
   *
   * Who may ask: a session that is ALREADY live and MFA-backed — the same three refusals as
   * `mintAttachCode`, and for the same reason. A remembered terminal must never be a way to
   * launder a weaker session into a durable one, so the strength of what is being persisted
   * is checked against the session doing the persisting, not against the caller's word.
   *
   * The plaintext is returned ONCE and never stored. A copy of `auth.json` therefore yields
   * no working terminal, exactly as it yields no working recovery code.
   *
   * @param {string} userId     the account the terminal will open
   * @param {string} sessionId  the live session vouching for it
   * @param {string} [label]    free text for the browser's list, never authority
   */
  rememberTerminal({ userId, sessionId, label }) {
    const now = Date.now();
    const state = this.store.read();
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session || session.expiresAt < now || session.idleExpiresAt < now || session.userId !== userId) {
      throw Object.assign(new Error('No live session to remember this terminal from.'), { status:401 });
    }
    if (!session.mfa) {
      this.ledger.append({ actor:userId, action:'auth.terminal-remember-denied', result:'denied', details:{ reason:'session-not-mfa' } });
      throw Object.assign(new Error('This session cannot remember a terminal.'), { status:403 });
    }
    const user = state.users.find((item) => item.id === userId);
    if (!user || !isActive(user)) throw Object.assign(new Error('No live session to remember this terminal from.'), { status:401 });

    const token = randomBytes(TERMINAL_TOKEN_BYTES).toString('base64url');
    const record = {
      id: randomUUID(),
      tokenDigest: tokenDigest(token),
      userId,
      // Trimmed and capped: this string is written by a client and displayed in the browser's
      // list, so it is treated as data from the start rather than after someone reports it.
      label: String(label ?? 'terminal').trim().slice(0, 64) || 'terminal',
      createdAt: now,
      lastUsedAt: null,
      expiresAt: now + TERMINAL_ENROLMENT_IDLE_MS,
      revokedAt: null,
    };
    this.store.update((next) => {
      next.terminals = (next.terminals ?? []).filter((item) => !item.revokedAt && item.expiresAt > now);
      next.terminals.push(record);
    });
    this.ledger.append({ actor:userId, action:'auth.terminal-remembered', result:'success', details:{ id:record.id, label:record.label } });
    return { token, id:record.id, expiresAt:new Date(record.expiresAt).toISOString() };
  }

  /**
   * Open a session from a remembered terminal — the call that makes the one word enough.
   *
   * Every refusal returns the SAME message. A caller holding a wrong token learns only that
   * it did not work, never whether it was unknown, expired, revoked, or attached to a
   * disabled account: four different sentences would turn this into an oracle for probing
   * which tokens once existed.
   *
   * The expiry slides on use, in the same `store.update` that reads the record, so a
   * terminal opened every day never expires and one left for ninety days stops on its own.
   */
  resumeTerminal({ token, ip }) {
    const limiter = this.#rateState(ip, '@terminal-token');
    if (limiter.entries.length >= TERMINAL_FAILURE_BUDGET) throw Object.assign(new Error('Too many attempts. Try again later.'), { status:429 });

    const now = Date.now();
    const digest = tokenDigest(String(token ?? ''));
    const refuse = (reason, actor = 'anonymous') => {
      this.#recordFailure(ip, '@terminal-token');
      this.ledger.append({ actor, action:'auth.terminal-resume-failed', result:'denied', details:{ reason, transport:ip } });
      return Object.assign(new Error('This terminal is not remembered here. Sign in once to remember it again.'), { status:401 });
    };

    // One `store.update` for find-and-slide, the shape `redeemAttachCode` documents: a
    // `read()` then a separate `update()` would leave a window where a revocation landing in
    // between is read as still-valid.
    const claimed = this.store.update((next) => {
      const found = (next.terminals ?? []).find((item) => item.tokenDigest === digest);
      if (!found) return null;
      if (found.revokedAt) return { found, reason:'revoked' };
      if (found.expiresAt <= now) return { found, reason:'expired' };
      found.lastUsedAt = now;
      found.expiresAt = now + TERMINAL_ENROLMENT_IDLE_MS;
      return { found, reason:null };
    });

    if (!claimed) throw refuse('unknown');
    if (claimed.reason) throw refuse(claimed.reason, claimed.found.userId);

    const user = this.store.read().users.find((item) => item.id === claimed.found.userId);
    if (!user || !isActive(user)) throw refuse('account-not-active', claimed.found.userId);

    // `mfa:true` is carried for the same reason `redeemAttachCode` carries it: remembering
    // already refused any session that lacked a second factor, so the factor this session
    // rests on is one the operator really passed. `elevatedUntil` is NOT carried — a
    // remembered terminal still has to step up for a sensitive action.
    const issued = this.createSession(user, { mfa:true });
    this.ledger.append({ actor:user.id, action:'auth.terminal-resumed', result:'success', details:{ id:claimed.found.id, transport:ip } });
    return issued;
  }

  /** The remembered terminals of ONE account — what the browser needs to be able to revoke. */
  listRememberedTerminals(userId) {
    const now = Date.now();
    return (this.store.read().terminals ?? [])
      .filter((item) => item.userId === userId && !item.revokedAt && item.expiresAt > now)
      .map((item) => ({
        id: item.id,
        label: item.label,
        createdAt: new Date(item.createdAt).toISOString(),
        lastUsedAt: item.lastUsedAt ? new Date(item.lastUsedAt).toISOString() : null,
        expiresAt: new Date(item.expiresAt).toISOString(),
      }));
  }

  /** Revoke by id, from the browser. Never crosses accounts: `userId` is part of the match. */
  revokeRememberedTerminal({ userId, id }) {
    const revoked = this.store.update((next) => {
      const found = (next.terminals ?? []).find((item) => item.id === id && item.userId === userId && !item.revokedAt);
      if (!found) return false;
      found.revokedAt = Date.now();
      return true;
    });
    if (!revoked) throw Object.assign(new Error('No such remembered terminal.'), { status:404 });
    this.ledger.append({ actor:userId, action:'auth.terminal-revoked', result:'success', details:{ id } });
    return { id };
  }

  /**
   * Forget the terminal holding THIS token — the undo, spendable by whoever possesses it.
   *
   * Deliberately answers the same way whether or not the token matched. Possession is the
   * only claim being made, and a truthful "there was nothing to forget" would confirm to a
   * caller that some other token they hold is still live.
   */
  forgetTerminalToken({ token }) {
    const digest = tokenDigest(String(token ?? ''));
    const found = this.store.update((next) => {
      const record = (next.terminals ?? []).find((item) => item.tokenDigest === digest && !item.revokedAt);
      if (!record) return null;
      record.revokedAt = Date.now();
      return { id:record.id, userId:record.userId };
    });
    if (found) this.ledger.append({ actor:found.userId, action:'auth.terminal-forgotten', result:'success', details:{ id:found.id } });
    return { forgotten:true };
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

  // --- passkeys ---------------------------------------------------------------------
  //
  // Enrolling or removing a passkey is gated by #assertPresence — password AND a live
  // TOTP code — exactly like replacing the authenticator. TOTP is mandatory at setup
  // for every MFA-required role and is never removed by adding a passkey, so that
  // stronger, already-established proof is always available to manage what a passkey
  // can do. A passkey is therefore additive at login (TOTP or passkey, the user's
  // choice) and never the sole gate on its own management.

  /** Step 1: prove presence, then hand the browser what it needs to call `create()`. */
  beginPasskeyRegistration({ userId, password, totpCode, rpId }) {
    const user = this.#requireUser(userId);
    const step = this.#assertPresence(user, password, totpCode, 'auth.passkey-register');
    const challenge = randomToken(24);
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === userId);
      target.lastTotpStep = step;
      target.pendingPasskey = {
        challengeDigest: tokenDigest(challenge),
        createdAt: Date.now(), expiresAt: Date.now() + 5 * 60_000,
      };
    });
    this.ledger.append({ actor:userId, action:'auth.passkey-register-started', result:'success' });
    return {
      challenge,
      rpId,
      rpName: 'NOESAR Evolution',
      userHandle: Buffer.from(userId, 'utf8').toString('base64url'),
      username: user.username,
      displayName: user.displayName,
      pubKeyCredParams: [{ type:'public-key', alg:COSE_ALG_ES256 }],
      attestation: 'none',
      userVerification: 'required',
      excludeCredentials: (user.passkeys ?? []).map((item) => ({ type:'public-key', id:item.id })),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  /** Step 2: verify what `create()` returned and store the credential. */
  confirmPasskeyRegistration({ userId, challenge, credentialId, clientDataJSON, attestationObject, name, rpId, origin }) {
    const user = this.#requireUser(userId);
    const pending = user.pendingPasskey;
    if (!pending || pending.expiresAt < Date.now()) throw Object.assign(new Error('Passkey registration expired. Start again.'), { status:410 });
    if (tokenDigest(String(challenge ?? '')) !== pending.challengeDigest) throw Object.assign(new Error('Invalid passkey registration challenge.'), { status:403 });
    let verified;
    try {
      verified = verifyRegistration({ clientDataJSON, attestationObject, expectedChallenge:challenge, expectedOrigin:origin, rpId });
    } catch (error) {
      this.ledger.append({ actor:userId, action:'auth.passkey-register-denied', result:'denied', details:{ reason:error.message } });
      throw Object.assign(new Error('Passkey registration could not be verified.'), { status:403 });
    }
    if (verified.credentialId !== credentialId) {
      throw Object.assign(new Error('Credential ID does not match the attested data.'), { status:403 });
    }
    if ((user.passkeys ?? []).some((item) => item.id === verified.credentialId)) {
      throw Object.assign(new Error('This passkey is already registered.'), { status:409 });
    }
    const record = {
      id: verified.credentialId,
      publicKeyJwk: verified.publicKeyJwk,
      signCount: verified.signCount,
      name: String(name ?? 'Passkey').trim().slice(0, 60) || 'Passkey',
      createdAt: nowIso(),
      lastUsedAt: null,
    };
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === userId);
      target.passkeys = [...(target.passkeys ?? []), record];
      delete target.pendingPasskey;
    });
    this.ledger.append({ actor:userId, action:'auth.passkey-registered', result:'success', details:{ credentialId:record.id } });
    return { registered:true, passkey:{ id:record.id, name:record.name, createdAt:record.createdAt } };
  }

  listPasskeys(userId) {
    const user = this.#requireUser(userId);
    return (user.passkeys ?? []).map((item) => ({
      id:item.id, name:item.name, createdAt:item.createdAt, lastUsedAt:item.lastUsedAt,
    }));
  }

  removePasskey({ userId, password, totpCode, credentialId }) {
    const user = this.#requireUser(userId);
    const step = this.#assertPresence(user, password, totpCode, 'auth.passkey-remove');
    let removed = false;
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === userId);
      target.lastTotpStep = step;
      const before = (target.passkeys ?? []).length;
      target.passkeys = (target.passkeys ?? []).filter((item) => item.id !== credentialId);
      removed = target.passkeys.length < before;
    });
    if (!removed) throw Object.assign(new Error('That passkey no longer exists.'), { status:404 });
    this.ledger.append({ actor:userId, action:'auth.passkey-removed', result:'success', details:{ credentialId } });
    return { removed:true };
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
      passkeySupported:true,
      passkeys:(user.passkeys ?? []).map((item) => ({
        id:item.id, name:item.name, createdAt:item.createdAt, lastUsedAt:item.lastUsedAt,
      })),
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

  /**
   * Stage 1 of getting back in without the passphrase (`D-0369`).
   *
   * Two ways to be believed, and no third: a recovery code issued at setup, or proof that the
   * caller controls the installation's filesystem — the same authority the FIRST owner was
   * created with, so this adds no root of trust the product did not already have. There is no
   * email path, because a product whose argument is that no vendor sees your data does not
   * acquire a mail server in order to let you back in.
   *
   * `viaProof` is decided by the caller, which is what owns the file. Keeping the filesystem out
   * of this class is why the same method serves both routes.
   *
   * What it grants is deliberately NARROW: not a session, but permission to set a new passphrase
   * and enrol a new authenticator. A recovery code that opened a session would make one leaked
   * code equal to full access, which is a worse bargain than the lockout it fixes.
   */
  beginRecovery({ username, recoveryCode, viaProof = false, ip = 'unknown' }) {
    let normalized;
    try { normalized = normalizeUsername(username); } catch { normalized = ''; }
    const limiter = this.#rateState(ip, `recovery|${normalized}`);
    if (limiter.entries.length >= 5) throw Object.assign(new Error('Too many recovery attempts. Try again later.'), { status:429 });

    const state = this.store.read();
    const user = state.users.find((item) => item.username === normalized && item.role === 'owner');
    // One sentence for every failure — unknown account, wrong code, spent code, no proof. The
    // sign-in form already refuses to be an account oracle (see beginLogin); a recovery form
    // that answered "no such user" would be the same oracle with a friendlier name.
    const refuse = () => {
      this.#recordFailure(ip, `recovery|${normalized}`);
      this.ledger.append({ actor:user?.id ?? 'anonymous', action:'auth.recovery-denied', result:'denied', details:{ viaProof } });
      return Object.assign(new Error('That recovery attempt was not accepted.'), { status:401 });
    };
    if (!user) throw refuse();

    if (!viaProof) {
      const supplied = String(recoveryCode ?? '').trim().toUpperCase();
      const digest = tokenDigest(supplied);
      const match = (user.recoveryCodes ?? []).find((item) => item.digest === digest && !item.usedAt);
      if (!supplied || !match) throw refuse();
    }

    // A fresh authenticator secret is minted now and only committed if stage 2 proves the person
    // holds it. Recovering a passphrase while leaving the old TOTP in place would leave half the
    // credential in the hands of whoever the person is recovering FROM.
    const secret = createTotpSecret();
    const challenge = randomToken(24);
    const pending = {
      challengeDigest: tokenDigest(challenge),
      userId: user.id,
      viaProof,
      recoveryDigest: viaProof ? null : tokenDigest(String(recoveryCode ?? '').trim().toUpperCase()),
      totp: encryptSecret(secret, this.masterKey),
      expiresAt: Date.now() + 10 * 60_000,
    };
    this.store.update((next) => { next.pendingRecovery = pending; });
    this.ledger.append({ actor:user.id, action:'auth.recovery-started', result:'pending', details:{ viaProof } });
    return {
      challenge,
      username: normalized,
      totpSecret: secret,
      otpauthUri: otpauthUriFor(normalized, secret),
      expiresAt: new Date(pending.expiresAt).toISOString(),
    };
  }

  /**
   * Stage 2: the new passphrase, proved against the new authenticator.
   *
   * Everything the old credential could reach is cut at the same moment — every session is
   * revoked and a fresh set of recovery codes replaces the old ones, spent or not. A recovery
   * that left the previous holder signed in somewhere would not be a recovery.
   */
  completeRecovery({ challenge, password, totpCode }) {
    const state = this.store.read();
    const pending = state.pendingRecovery;
    if (!pending || pending.expiresAt < Date.now()) throw Object.assign(new Error('Recovery challenge expired.'), { status:400 });
    if (tokenDigest(String(challenge ?? '')) !== pending.challengeDigest) throw Object.assign(new Error('Invalid recovery challenge.'), { status:403 });
    const user = state.users.find((item) => item.id === pending.userId);
    if (!user) throw Object.assign(new Error('Recovery challenge expired.'), { status:400 });

    const policy = passwordPolicy(password);
    if (!policy.valid) throw Object.assign(new Error(policy.reasons.join(' ')), { status:400 });

    const secret = decryptSecret(pending.totp, this.masterKey);
    const consumed = consumeTotp(secret, totpCode, { lastTotpStep: 0 });
    if (!consumed.accepted) {
      throw Object.assign(new Error(consumed.reason === 'replayed' ? 'This authentication code has already been used.' : 'Invalid TOTP code.'), { status:403 });
    }

    const { codes, digests } = buildRecoveryCodes();
    let updated;
    this.store.update((next) => {
      const target = next.users.find((item) => item.id === pending.userId);
      target.password = hashPassword(password);
      target.totp = pending.totp;
      target.lastTotpStep = consumed.step;
      target.failedLoginCount = 0;
      target.lockedUntil = 0;
      target.recoveryCodes = digests;
      target.recoveryCodesGeneratedAt = Date.now();
      next.pendingRecovery = null;
      // Every session, not only this user's: on a single-owner installation they are the same
      // set, and on any other the safe reading of "the owner had to recover" is that nothing
      // currently signed in should be trusted.
      next.sessions = [];
      updated = target;
    });
    this.ledger.append({
      actor:pending.userId, action:'auth.recovery-completed', result:'success',
      details:{ viaProof:pending.viaProof, recoveryCodesIssued:codes.length },
    });
    return { ...this.createSession(updated, { mfa:true }), recoveryCodes: codes };
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
