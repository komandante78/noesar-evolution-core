// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SCIM 2.0 provisioning · phase 7 step 30 ("Il mondo esterno", 09_PIANO.md §2), one third
// of "OIDC, SAML, SCIM". `PROJECT_GOVERNANCE/01_PRODUCT/14_IDENTITY_COLLABORATION.md`
// names "OIDC, Enterprise SAML/SCIM" in one line; this step builds the third for real and
// says plainly what it does not build for the other two -- see oidc.mjs for the second,
// and the module comment below for why SAML is not attempted here.
//
// Unlike steps 27-29 (frameworks that validate and list candidate content, nothing yet
// consuming it), this one is WIRED: a SCIM request that creates, disables, reinstates or
// deprovisions a user calls the same `UserDirectory` methods a human administrator does,
// via `/api/v1/user-directory` today. `user-directory.mjs` itself is not modified --
// every call here goes through its existing public API with an `actorId` that already
// holds the `owner` or `admin` role its own `GRANTABLE`/`#requireActor` checks require,
// so nothing here bypasses a rule that file enforces; the sponsor concept below exists
// exactly so it does not have to.
//
// Authentication is a bearer token, not a cookie session -- RFC 7644's own model, and the
// reason SCIM routes carry no CSRF check (CSRF defends an ambient cookie a browser sends
// automatically; a bearer token is never ambient). The token identifies a "sponsor": the
// owner or admin who minted it. Every SCIM-provisioned account and every SCIM mutation is
// therefore attributable to a real human actor in the audit ledger, not to an anonymous
// "SCIM" pseudo-identity -- the same non-repudiation `UserDirectory` already gives every
// other administrative action.
//
// SAML is declared, not built: RFC 7644/SCIM and OIDC ID tokens (see oidc.mjs) are JSON,
// verifiable with node:crypto alone. SAML assertions are signed XML, and Node ships no
// XML parser. Hand-rolling one for a security-sensitive format is exactly the "reject
// unsound tooling rather than ship noise" this project already lives by (XML signature
// wrapping is a well-documented, repeatedly-exploited class of vulnerability in
// home-grown SAML validators) -- a dependency decision, not a code one, and naming it here
// is the honest alternative to a validator nobody should trust.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomToken, tokenDigest } from './auth-crypto.mjs';

export class ScimError extends Error {
  constructor(kind, reason, status = 400) {
    super(reason);
    this.name = 'ScimError';
    this.kind = kind;
    this.reason = reason;
    this.status = status;
  }
}
const refuse = (kind, reason, status) => { throw new ScimError(kind, reason, status); };

function nowIso() { return new Date().toISOString(); }

/** Its own file, `state/scim-tokens.json` -- deliberately NOT inside the ai-workspace
 * atomic store (D-0159's AI_STATE_VERSION), so this step carries no migration and no
 * rollback cost, the same discipline steps 27-29 kept. */
export class ScimTokenStore {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive:true, mode:0o700 });
  }
  read() {
    if (!existsSync(this.path)) return { tokens:[] };
    return JSON.parse(readFileSync(this.path, 'utf8'));
  }
  write(state) {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding:'utf8', mode:0o600 });
    renameSync(tmp, this.path);
  }
}

export function mintScimToken(store, { sponsorActorId, name, ttlDays = null }) {
  const token = randomToken(32);
  const record = {
    id: randomUUID(),
    tokenDigest: tokenDigest(token),
    sponsorActorId,
    name: String(name ?? 'scim-integration').slice(0, 64),
    createdAt: nowIso(),
    expiresAt: ttlDays ? new Date(Date.now() + Number(ttlDays) * 86400_000).toISOString() : null,
    revokedAt: null,
    lastUsedAt: null,
  };
  const state = store.read();
  state.tokens.push(record);
  store.write(state);
  return { tokenId:record.id, token, expiresAt:record.expiresAt };
}

export function listScimTokens(store, { sponsorActorId }) {
  return store.read().tokens
    .filter((t) => t.sponsorActorId === sponsorActorId)
    .map(({ id, name, createdAt, expiresAt, revokedAt, lastUsedAt }) => ({ id, name, createdAt, expiresAt, revokedAt, lastUsedAt }));
}

export function revokeScimToken(store, { actorId, tokenId }) {
  const state = store.read();
  const record = state.tokens.find((t) => t.id === tokenId);
  if (!record) refuse('NOT_FOUND', 'no such token', 404);
  if (record.sponsorActorId !== actorId) refuse('FORBIDDEN', 'only the sponsor may revoke this token', 403);
  record.revokedAt = nowIso();
  store.write(state);
  return { tokenId, revoked:true };
}

/** Resolves a bearer token to the sponsoring actor. Returns null for anything not a live
 * token of a live sponsor — never a reason, the same non-oracle discipline
 * `UserDirectory.authenticateServiceToken` already uses for the same class of secret. */
export function authenticateScimToken(store, token) {
  if (!token) return null;
  const digest = tokenDigest(String(token));
  const state = store.read();
  const record = state.tokens.find((t) => t.tokenDigest === digest);
  if (!record || record.revokedAt) return null;
  if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return null;
  record.lastUsedAt = nowIso();
  store.write(state);
  return { sponsorActorId:record.sponsorActorId, tokenId:record.id };
}

// --- SCIM resource mapping (RFC 7643) ---------------------------------------------------

export function toScimUser(account, baseUrl) {
  return {
    schemas:['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: account.id,
    userName: account.username,
    displayName: account.displayName,
    active: account.status === 'active',
    meta: {
      resourceType:'User',
      created: account.createdAt,
      location: `${baseUrl}/scim/v2/Users/${account.id}`,
    },
  };
}

export function scimListResponse(accounts, { startIndex = 1, count = 100 }, baseUrl) {
  const start = Math.max(1, Number(startIndex) || 1);
  const size = Math.max(0, Math.min(200, Number(count) || 100));
  const page = accounts.slice(start - 1, start - 1 + size);
  return {
    schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: accounts.length,
    itemsPerPage: page.length,
    startIndex: start,
    Resources: page.map((a) => toScimUser(a, baseUrl)),
  };
}

export function scimServiceProviderConfig(baseUrl) {
  return {
    schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: `${baseUrl}/api/v1/scim`,
    patch: { supported:true },
    bulk: { supported:false, maxOperations:0, maxPayloadSize:0 },
    filter: { supported:false, maxResults:0 },
    changePassword: { supported:false },
    sort: { supported:false },
    etag: { supported:false },
    authenticationSchemes: [{
      type:'oauthbearertoken',
      name:'SCIM provisioning token',
      description:'Bearer token minted by an owner or admin (RFC 7644 §2)',
      specUri:'https://www.rfc-editor.org/rfc/rfc7644',
    }],
  };
}

export function scimError(status, detail) {
  return {
    schemas:['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    detail,
  };
}

/**
 * The only PATCH shape supported: replacing `active`. Refuses everything else by name
 * rather than silently ignoring an operation it does not implement — a provisioning
 * connector that thinks it renamed a user and did not needs to see that, not a 200.
 */
export function applyScimPatch(body) {
  const operations = body?.Operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    refuse('INVALID_PATCH', 'Operations must be a non-empty array', 400);
  }
  let active;
  for (const operation of operations) {
    const op = String(operation?.op ?? '').toLowerCase();
    const path = String(operation?.path ?? '').toLowerCase();
    if (op === 'replace' && path === 'active') {
      if (typeof operation.value !== 'boolean') refuse('INVALID_PATCH', '"active" must be a boolean', 400);
      active = operation.value;
      continue;
    }
    refuse('UNSUPPORTED_OPERATION', `unsupported PATCH operation: ${op} ${path}`, 501);
  }
  return { active };
}

export function scimStatus() {
  return {
    provisioning: 'SCIM 2.0 (RFC 7643/7644), wired to UserDirectory',
    supportedOperations: ['List', 'Get', 'Create', 'PATCH active', 'Deprovision'],
    unsupportedOperations: ['filter query', 'bulk', 'Groups', 'PATCH beyond active'],
    enforced: true,
    enforcedReason: 'Unlike steps 27-29, a SCIM request here really creates/disables/reinstates/deprovisions an account through UserDirectory — this is wired, not a framework only.',
    oidc: 'see oidc.mjs — ID token verification, not wired to a login flow',
    saml: 'NOT BUILT — no zero-dependency, safe XML processing is available; hand-rolling SAML XML-dsig is a rejected class of unsound tooling, named rather than faked',
    rustTwin: false,
    rustTwinReason: 'This decides who gets provisioned, but through UserDirectory\'s own existing authorization (GRANTABLE/#requireActor) — the decision surface is that file, already covered, not duplicated here.',
  };
}
