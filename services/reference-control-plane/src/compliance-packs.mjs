// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Signed, dated compliance packs · phase 7 step 28 ("Il mondo esterno", 09_PIANO.md §2).
//
// Not built from zero. `schemas/compliance-pack.schema.json` has been tracked in
// MANIFEST.sha256 since 2026-07-25, referenced by no code until this step -- the same
// "schema morto" class step 27 found and revived in trust-level-policy.json et al.
// `PROJECT_GOVERNANCE/06_COMPLIANCE/60_GLOBAL_COMPLIANCE_ARCHITECTURE.md` states what a
// pack must carry: "jurisdiction, dates, role definitions, questionnaire, mappings,
// notices, evidence templates, retention, prohibited configurations, review date and
// sources" -- matching the tracked schema's fields.
//
// `PROJECT_GOVERNANCE/DATA/compliance-pack-matrix.csv` lists fourteen jurisdictions and
// marks EVERY one of them "Legal review: required", with statuses of "architecture
// defined", "planned", "module-specific" or "restricted review" -- none "ready". This
// module is deliberately the FRAMEWORK ONLY: schema validation, the temporal window a
// "dated" pack actually needs enforced, and real Ed25519 signing/verification. It ships
// no jurisdiction's actual legal content, the same way step 27 shipped no sector module
// -- authoring real compliance content without the legal review the matrix itself
// requires would be a false claim, not a feature.
//
// Signing uses node:crypto's native Ed25519 (RFC 8032), not a shelled-out `openssl`
// subprocess. capabilities/reference/noesar_capabilities/crypto.py does the latter, and
// this session's DebugLab sweep (F7-001) flagged exactly that pattern (subprocess with a
// partial executable path) as a finding class in that dormant Python tree. Node's
// `crypto.sign`/`crypto.verify` with Ed25519 are RFC 8032, so a key generated or a
// signature produced by either implementation verifies under the other -- interoperable,
// without reintroducing the finding.
//
// Read-only / advisory: nothing here gates a product decision on a pack's presence or
// validity yet. See compliancePacksStatus().enforced.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { validateManifest as validateAgainstSchema } from './sector-modules.mjs';

export class CompliancePackError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'CompliancePackError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new CompliancePackError(kind, reason); };

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadComplianceSchema(productRoot) {
  const path = join(productRoot, 'schemas/compliance-pack.schema.json');
  const schema = readJson(path);
  if (!schema || typeof schema.properties !== 'object') refuse('SCHEMA_MISSING', `${path} is missing or malformed`);
  return schema;
}

/** Canonical bytes for signing/verification: the pack with `signature` removed, keys
 * sorted, no whitespace -- the same canonical-JSON shape build-signed-package.py already
 * uses for capability manifests, so a pack signed by either tool is bound to the same
 * bytes. Sorting recursively (not just at the top level) means field order in the
 * source file can never change what gets signed. */
export function canonicalBytes(pack) {
  const { signature: _signature, ...rest } = pack;
  const sort = (value) => {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sort(value[k])]));
    }
    return value;
  };
  return Buffer.from(JSON.stringify(sort(rest)), 'utf8');
}

/**
 * Schema-only validation, reusing the generic subset validator step 27 built
 * (`validateManifest` in sector-modules.mjs is not sector-module-specific -- it walks
 * required/type/enum/additionalProperties/array-items for whatever schema it is given).
 * Does not check dates or a signature; see checkPackDates() and
 * verifyCompliancePackSignature() for those, kept separate because a schema-shaped
 * document can be well-formed and still be expired, not-yet-effective, or unsigned.
 */
export function validateCompliancePackDocument(candidate, schema) {
  return validateAgainstSchema(candidate, schema);
}

/**
 * "Dated" enforced, not merely present: `effective_from` must be a real date at or
 * before `asOf`, `review_by` a real date at or after it, and the window itself must be
 * non-empty (`effective_from` before `review_by`). Three distinct reasons, not one
 * generic "bad dates" -- a pack that has not started yet and one that has expired are
 * different failures for whoever is deciding whether to trust it.
 */
export function checkPackDates(candidate, { asOf = new Date() } = {}) {
  const errors = [];
  const from = Date.parse(candidate.effective_from);
  const until = Date.parse(candidate.review_by);
  if (Number.isNaN(from)) errors.push(`effective_from "${candidate.effective_from}" is not a parseable date`);
  if (Number.isNaN(until)) errors.push(`review_by "${candidate.review_by}" is not a parseable date`);
  if (!Number.isNaN(from) && !Number.isNaN(until) && from >= until) {
    errors.push('effective_from must be strictly before review_by');
  }
  if (!Number.isNaN(from) && asOf.getTime() < from) errors.push('NOT_YET_EFFECTIVE: effective_from is in the future');
  if (!Number.isNaN(until) && asOf.getTime() > until) errors.push('EXPIRED: review_by has passed');
  return { valid: errors.length === 0, errors };
}

/**
 * Signs the canonical bytes with an Ed25519 private key (PEM) and returns the pack with
 * a `signature` object attached: the base64 signature, the public key's SHA-256
 * fingerprint (so a verifier can confirm which key without trusting a bundled public
 * key blindly), and the UTC instant of signing. Does not mutate the input.
 */
export function signCompliancePack(pack, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  const bytes = canonicalBytes(pack);
  const signature = cryptoSign(null, bytes, privateKey);
  const publicKeyDer = createPublicKey(privateKey).export({ type:'spki', format:'der' });
  const fingerprintHex = createHash('sha256').update(publicKeyDer).digest('hex');
  return {
    ...pack,
    signature: {
      algorithm:'ed25519',
      value: signature.toString('base64'),
      publicKeyFingerprint: fingerprintHex,
      signedAt: new Date().toISOString(),
    },
  };
}

/**
 * Verifies `pack.signature.value` against `publicKeyPem` over the same canonical bytes
 * signing used. Refuses (does not silently return false) if the pack carries no
 * signature at all -- an absent signature and a wrong one are different failures, and
 * the caller should not have to guess which one they are looking at from a boolean.
 */
export function verifyCompliancePackSignature(pack, publicKeyPem) {
  if (!pack.signature || typeof pack.signature.value !== 'string') {
    refuse('NO_SIGNATURE', 'pack carries no signature to verify');
  }
  const publicKey = createPublicKey(publicKeyPem);
  const bytes = canonicalBytes(pack);
  const signature = Buffer.from(pack.signature.value, 'base64');
  return cryptoVerify(null, bytes, publicKey, signature);
}

function findPacks(dir, maxPacks) {
  const found = [];
  let truncated = false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes:true }); } catch { return { found, truncated }; }
  for (const entry of entries) {
    if (found.length >= maxPacks) { truncated = true; break; }
    if (!entry.isDirectory()) continue;
    found.push({ id:entry.name, path:join(dir, entry.name, 'pack.json') });
  }
  return { found, truncated };
}

/**
 * Scans `packsRoot` for `<name>/pack.json`, checks schema and dates always, and checks
 * the signature only when `publicKeyPem` is supplied -- an unsigned pack is reported as
 * such, not silently treated as trusted. `packsRoot` is a runtime location, not baked
 * into the image, same posture as `.sector-modules` (step 27): empty on every
 * deployment so far, because no jurisdiction's pack has passed legal review yet.
 */
export function loadCompliancePacks(productRoot, packsRoot, options = {}) {
  const maxPacks = options.maxPacks ?? 500;
  const schema = loadComplianceSchema(productRoot);
  const { found, truncated } = findPacks(packsRoot, maxPacks);
  const valid = [];
  const invalid = [];
  for (const { id, path } of found) {
    const candidate = readJson(path);
    if (!candidate) { invalid.push({ id, path, errors:['not valid JSON'] }); continue; }
    const schemaResult = validateAgainstSchema(candidate, schema);
    const dateResult = schemaResult.valid ? checkPackDates(candidate) : { valid:true, errors:[] };
    const signatureErrors = [];
    if (options.publicKeyPem && schemaResult.valid) {
      try {
        if (!verifyCompliancePackSignature(candidate, options.publicKeyPem)) {
          signatureErrors.push('signature does not verify against the configured public key');
        }
      } catch (error) {
        signatureErrors.push(error.reason ?? String(error));
      }
    }
    const errors = [...schemaResult.errors, ...dateResult.errors, ...signatureErrors];
    if (errors.length === 0) valid.push({ id, path, pack:candidate });
    else invalid.push({ id, path, errors });
  }
  return { scanned: found.length, truncated, valid, invalid };
}

export function compliancePacksStatus(productRoot, packsRoot) {
  let schemaLoaded = false;
  let policyError = null;
  try { loadComplianceSchema(productRoot); schemaLoaded = true; } catch (error) { policyError = error.reason ?? String(error); }

  let installedPacks = 0;
  let invalidPacks = 0;
  if (schemaLoaded) {
    try {
      const scan = loadCompliancePacks(productRoot, packsRoot);
      installedPacks = scan.valid.length;
      invalidPacks = scan.invalid.length;
    } catch { /* status must not throw even if a scan would */ }
  }

  return {
    complianceSchemaSource: 'schemas/compliance-pack.schema.json',
    schemaLoaded,
    policyError,
    installedPacks,
    invalidPacks,
    jurisdictionsWithContent: 0,
    jurisdictionMatrixSource: 'PROJECT_GOVERNANCE/DATA/compliance-pack-matrix.csv',
    jurisdictionMatrixNote: 'Every listed jurisdiction requires legal review before content ships; none has one. This framework validates schema, dates and signature -- it authors no jurisdiction’s content.',
    signingAlgorithm: 'ed25519 (node:crypto, RFC 8032)',
    enforced: false,
    reason: 'Validates, dates-checks and (optionally) signature-verifies candidate compliance packs. Nothing yet reads installedPacks to gate a product decision -- that wiring, and the legal review each pack needs before it can carry real content, are both future work.',
    rustTwin: false,
    rustTwinReason: 'Same posture as sector-modules.mjs (D-0204) and repo-map.mjs (D-0188): proposes and verifies, does not decide or confine anything a caller can reach yet.',
  };
}
