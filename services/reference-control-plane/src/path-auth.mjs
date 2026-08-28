// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, normalize, parse, resolve, sep } from 'node:path';

const protectedRoots = process.platform === 'win32'
  ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)']
  : ['/boot', '/dev', '/etc', '/proc', '/root', '/sys', '/usr'];

function within(child, parent) {
  const c = normalize(resolve(child));
  const p = normalize(resolve(parent));
  return c === p || c.startsWith(`${p}${sep}`);
}

function inspectExistingSegments(target) {
  const findings = [];
  let current = parse(target).root;
  for (const part of target.slice(current.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) findings.push({ type: 'symlink', path: current });
  }
  return findings;
}

// SEC-003. These seven are the product's declared non-bypassable invariants. Until the
// adversarial suite was written, the list was seven strings and nothing else: the names
// appeared in exactly one place in the codebase — here — and no code read them, enforced
// them or tested them. A name in an array is a claim, not a mechanism.
//
// Each entry now names where it is enforced, and whether this layer is the one enforcing
// it. Three of the seven are commitments about what gets *executed* or *produced*, not
// about a filesystem path, and the path authorizer cannot enforce them. The honest form
// of that is to say so here rather than to advertise protection this code does not
// perform. The alternative — a keyword denylist over `commands` — was rejected on
// evidence: this project's round-3 experiment showed textual denylists are defeated by
// any indirection (`psql -f x.sql` never contains the forbidden verb), so one would
// convert an honest gap into a false assurance.
//
// `status` is one of:
//   ACTIVE                     enforced by the named point, on every request through it
//   NOT_ENFORCED_AT_THIS_LAYER the named layer owns it; this layer must not imply it does
export const INVARIANT_ENFORCEMENT = Object.freeze([
  Object.freeze({
    id: 'credential_theft_prevention',
    status: 'ACTIVE',
    enforcedBy: 'path-auth.createPathPlan — protected roots and the owner secret directories are blocked before any mode is considered',
  }),
  Object.freeze({
    id: 'signed_update_verification',
    status: 'ACTIVE',
    enforcedBy: 'update-manager.verifyBundle / verifyMetadata — Ed25519 over the exact manifest bytes, with anti-rollback',
  }),
  Object.freeze({
    id: 'audit_integrity',
    status: 'ACTIVE',
    enforcedBy: 'audit.AuditLedger.append / verify — SHA-256 hash chain, append-only, 0600',
  }),
  Object.freeze({
    id: 'destructive_action_confirmation',
    status: 'ACTIVE',
    enforcedBy: 'server /api/v1/coden/authorize — the consent scope must be one the plan offered, and a destructive operation may only be granted a per-operation or per-file scope',
  }),
  Object.freeze({
    id: 'malware_prevention',
    status: 'NOT_ENFORCED_AT_THIS_LAYER',
    enforcedBy: 'Execution layer. This authorization plans paths and issues scoped approvals; it has no execution surface (executionEnabled:false) and does not inspect command content.',
  }),
  Object.freeze({
    id: 'illegal_cyberattack_prevention',
    status: 'NOT_ENFORCED_AT_THIS_LAYER',
    enforcedBy: 'Execution layer and model policy. Not a property of a filesystem path; the path authorizer cannot observe intent or network target.',
  }),
  Object.freeze({
    id: 'physical_harm_prevention',
    status: 'NOT_ENFORCED_AT_THIS_LAYER',
    enforcedBy: 'Model policy layer. A content commitment, unobservable to path authorization.',
  }),
]);

/** Consent scopes that leave a destructive operation reusable without a further decision. */
const UNATTENDED_SCOPES = Object.freeze(['FOLDER_FOR_SESSION', 'PERSISTENT_FOLDER']);

/**
 * The five operations a plan may name — an enum on the wire, enforced here because here is
 * where every caller passes.
 *
 * n.4, Owner 2026-08-27. `isDestructive` asks whether the operation IS the string `delete`,
 * and until now nothing checked that the operation was one of five strings at all: anything
 * else — a typo, another product's vocabulary, a word in another language — sailed through as
 * a plan with `risk: LOW` and `isDestructive: false`, and could then be granted the standing,
 * unattended scope `checkConsentScope` exists to refuse. What FOUND it was the browser sending
 * `cancellazione`, because the Italian `<option>` had no `value` and a `<select>` hands back
 * its label when it has none; but the browser was one way in, not the hole. The hole was a
 * comparison against a bare string with no vocabulary behind it, and it is closed here rather
 * than in the page, so a terminal, a script or a future client cannot re-open it.
 *
 * REFUSED, never normalised: mapping an unknown operation onto `write` would let a caller who
 * meant `delete` get a plan for something else and never learn it. This throws the way
 * `createPathPlan` already throws for a missing path.
 */
export const OPERATIONS = Object.freeze(['read', 'write', 'delete', 'execute', 'install']);

export function isDestructive(plan) {
  return plan.operation === 'delete' || plan.recursive === true;
}

/**
 * SEC-003 · destructive_action_confirmation.
 * Returns null when the scope may be granted for this plan, or a refusal describing why.
 * The consent scope was previously copied from the request onto the stored approval with
 * no validation at all, so the plan's own refusal option (`DENY`) minted an approval, an
 * invented scope was stored verbatim, and a recursive delete could be granted a standing,
 * unattended licence to destroy.
 */
export function checkConsentScope(plan, consentScope) {
  const scope = String(consentScope ?? '');
  if (!plan.consentOptions.includes(scope)) {
    return { status: 400, error: `Consent scope must be one of: ${plan.consentOptions.join(', ')}.` };
  }
  if (scope === 'DENY') {
    return { status: 403, error: 'The request was denied. A denial does not produce an approval.' };
  }
  if (isDestructive(plan) && UNATTENDED_SCOPES.includes(scope)) {
    return {
      status: 403,
      error: 'A destructive operation requires a per-operation or per-file consent scope; it cannot be granted an unattended, reusable scope.',
    };
  }
  return null;
}

export function createPathPlan(request, workspaceRoot) {
  const rawPath = String(request.path ?? '').trim();
  if (!rawPath) throw new Error('Path is required');
  const candidate = isAbsolute(rawPath) ? normalize(rawPath) : resolve(workspaceRoot, rawPath);
  const canonical = existsSync(candidate) ? realpathSync.native(candidate) : resolve(candidate);
  const operation = request.operation ?? 'write';
  if (!OPERATIONS.includes(operation)) throw new Error(`Operation must be one of: ${OPERATIONS.join(', ')}.`);
  const findings = inspectExistingSegments(candidate);
  const protectedMatch = protectedRoots.find((root) => within(canonical, root));
  const ownerHomeSecrets = within(canonical, resolve(homedir(), '.ssh')) || within(canonical, resolve(homedir(), '.config'));
  const insideWorkspace = within(canonical, workspaceRoot);
  let risk = 'LOW';
  if (!insideWorkspace) risk = 'HIGH';
  if (operation === 'delete' || request.recursive) risk = 'HIGH';
  if (protectedMatch || ownerHomeSecrets || findings.length) risk = 'CRITICAL';

  const blocked = Boolean(protectedMatch || ownerHomeSecrets);
  return {
    mode: request.mode ?? 'NORMAL',
    requestedPath: rawPath,
    canonicalPath: canonical,
    workspaceRoot: resolve(workspaceRoot),
    insideWorkspace,
    operation,
    recursive: Boolean(request.recursive),
    commands: Array.isArray(request.commands) ? request.commands : [],
    dependencies: Array.isArray(request.dependencies) ? request.dependencies : [],
    networkRequested: Boolean(request.networkRequested),
    secretsRequested: Boolean(request.secretsRequested),
    symlinkFindings: findings,
    protectedMatch: protectedMatch ?? null,
    risk,
    blocked,
    requiresStrongReauthentication: risk === 'CRITICAL' || request.mode === 'OWNER_BYPASS',
    consentOptions: ['ONE_OPERATION', 'LISTED_FILES', 'FOLDER_FOR_SESSION', 'PERSISTENT_FOLDER', 'DENY'],
    backup: { required: operation !== 'read', strategy: 'content-addressed safety copy before mutation' },
    verification: ['confirm expected files', 'run bounded tests', 'review diff', 'append audit event'],
    rollback: ['restore safety copy', 'remove only newly-created listed files', 'verify integrity'],
    nonBypassableInvariants: INVARIANT_ENFORCEMENT.map((entry) => entry.id),
    invariantEnforcement: INVARIANT_ENFORCEMENT,
  };
}
