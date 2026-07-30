// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-007 / INST-008 (03_ARCHITETTURA.md §8, 08_INSTALLAZIONE.md §9): "an update that
// requests more authority than before declares it explicitly (a permission diff) and is
// authorised again." This is the Update Trust Verifier the architecture names — not a
// second capability engine, a comparison over what the previous install and the candidate
// each declare they need, gated by the same approver/expiry discipline capability.mjs
// already uses for everything else.
//
// A release's "permission surface" is two things, both statically declared, neither
// executed to find out: (1) every RBAC permission string server.mjs's own routes gate on
// (requireSession(req, res, '...') / auth.hasPermission(user, '...')), and (2) every
// adapter capability ADAPTER_MANIFESTS lists an adapter as allowed to ask for. Extracted
// from source text rather than by importing and running the server, matching
// generate-inventory.mjs's own posture: declared and PARTIAL rather than executed and
// assumed complete — a permission string built dynamically at runtime (there are none
// today; grep confirms every call site uses a literal) would not be caught, and that gap
// is named rather than hidden.

const REQUIRE_SESSION_PATTERN = /requireSession\(req,\s*res,\s*'([a-zA-Z0-9_.-]+)'\)/g;
const HAS_PERMISSION_PATTERN = /hasPermission\([^,]+,\s*'([a-zA-Z0-9_.-]+)'\)/g;

export function extractRbacPermissions(serverSourceText) {
  const found = new Set();
  for (const match of serverSourceText.matchAll(REQUIRE_SESSION_PATTERN)) found.add(match[1]);
  for (const match of serverSourceText.matchAll(HAS_PERMISSION_PATTERN)) found.add(match[1]);
  return [...found].sort();
}

export function adapterCapabilityList(adapterManifests) {
  const list = [];
  for (const [resource, manifest] of Object.entries(adapterManifests)) {
    for (const operation of manifest.operations) list.push({ resource, operation });
  }
  return list.sort((a, b) => (a.resource + a.operation).localeCompare(b.resource + b.operation));
}

/** The normalised, comparable identity of one grant of authority — RBAC or adapter alike. */
function tokenOf(entry) {
  return entry.kind === 'rbac' ? `rbac:${entry.value}` : `adapter:${entry.resource}:${entry.operation}`;
}

function tokensOf(surface) {
  const tokens = surface.rbacPermissions.map((value) => ({ kind: 'rbac', value }));
  for (const capability of surface.adapterCapabilities) {
    tokens.push({ kind: 'adapter', resource: capability.resource, operation: capability.operation });
  }
  return new Set(tokens.map(tokenOf));
}

export function buildPermissionSurface({ rbacPermissions, adapterCapabilities, label = null }) {
  return {
    documentType: 'permission-surface',
    label,
    rbacPermissions: [...rbacPermissions].sort(),
    adapterCapabilities: [...adapterCapabilities].sort((a, b) => (a.resource + a.operation).localeCompare(b.resource + b.operation)),
  };
}

/** What changed between two surfaces — token strings, so a caller sees exactly which grant moved. */
export function diffPermissionSurfaces(baseline, candidate) {
  const before = tokensOf(baseline);
  const after = tokensOf(candidate);
  const added = [...after].filter((token) => !before.has(token)).sort();
  const removed = [...before].filter((token) => !after.has(token)).sort();
  return { added, removed };
}

export class PermissionDiffError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'PermissionDiffError';
    this.kind = kind;
  }
}
const refuse = (kind, reason) => { throw new PermissionDiffError(kind, reason); };

/**
 * The enforcement point. Shrinking authority (`removed` non-empty, `added` empty) never
 * needs a fresh authorisation — a candidate that asks for less is not the case this
 * criterion is about. Widening (`added` non-empty) does, and the authorisation must name
 * EXACTLY the tokens being added — a blanket "yes" that happens to cover more than what
 * changed is not a description of what is happening, the same reasoning capability.mjs's
 * mint() applies to a step's declared files ("widening is the whole attack").
 */
export function verifyUpdateAuthorized({ baseline, candidate, authorization = null, nowUnix }) {
  const { added, removed } = diffPermissionSurfaces(baseline, candidate);
  if (added.length === 0) {
    return { authorized: true, added, removed, reason: 'no new authority requested' };
  }
  if (!authorization) {
    refuse('AUTHORIZATION_REQUIRED',
      `the candidate asks for ${added.length} new permission(s) not held by the installed release (${added.join(', ')}) and no authorisation was supplied`);
  }
  if (!String(authorization.approverId ?? '').trim()) {
    refuse('NO_APPROVER', 'an authorisation with no approver names nobody accountable for widening authority');
  }
  if (!(authorization.expiresAtUnix > authorization.grantedAtUnix)) {
    refuse('INVALID', 'an authorisation that expires before it is granted authorises nothing');
  }
  if (nowUnix >= authorization.expiresAtUnix) refuse('EXPIRED', 'the authorisation has lapsed');

  const authorized = [...new Set(authorization.permissions ?? [])].sort();
  const addedSorted = [...added].sort();
  const authorizedSet = new Set(authorized);
  const addedSet = new Set(addedSorted);
  const missing = addedSorted.filter((token) => !authorizedSet.has(token));
  const extra = authorized.filter((token) => !addedSet.has(token));
  if (missing.length > 0) {
    refuse('SCOPE_MISMATCH', `the authorisation does not cover ${missing.join(', ')}, which the candidate newly requests`);
  }
  if (extra.length > 0) {
    refuse('SCOPE_MISMATCH', `the authorisation names ${extra.join(', ')}, which the candidate does not actually add — an authorisation must name exactly what is changing, not a superset`);
  }
  return {
    authorized: true, added, removed,
    approverId: authorization.approverId,
    reason: `authorised by ${authorization.approverId} for exactly the ${added.length} permission(s) added`,
  };
}
