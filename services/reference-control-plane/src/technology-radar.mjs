// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Technology Radar · phase 7 step 29 ("Il mondo esterno", 09_PIANO.md §2).
//
// `PROJECT_GOVERNANCE/04_AI_PLATFORM/48_TECHNOLOGY_RADAR.md`: "Lifecycle rings: Adopt,
// Trial, Assess, Hold, Deprecated and Revoked... The Radar consumes signed compatibility/
// advisory metadata and never automatically executes third-party code." 03_ARCHITETTURA.md
// §9 calls it "the mechanism that makes [handling new hardware/standards without a
// rewrite] true, and it does not exist today" -- and step 28 (D-0205) is literally one of
// the entries the architecture doc names as arriving through it ("Nuovi standard di
// conformità -> un CompliancePackProvider firmato e datato").
//
// `docs/governance/technology-radar-seed.json` -- tracked in MANIFEST.sha256 since
// 2026-07-25, never read by any code until this step -- is fifteen REAL, already-adopted
// tracking entries (Rust security authority: adopt/core, Qdrant: trial/data, MCP gateway:
// assess/agents, ...). Unlike step 27/28, this seed is not a legal claim or an executable
// module: it is a record of technology choices already made elsewhere in this repository,
// so it ships as real content here rather than as an empty framework.
//
// `schemas/technology-radar-entry.schema.json` is new -- no tracked schema existed for a
// radar entry, unlike step 27/28's revived schemas. Its fields are the ones the governance
// doc names by name ("evidence, compatibility, license, security, migration and rollback
// impact"), nothing invented beyond that text.
//
// Signing reuses canonicalBytes() from compliance-packs.mjs (D-0205) rather than
// reimplementing canonicalization -- it is generic (sorts and strips `signature`, not
// compliance-pack-specific) and its Ed25519/openssl interoperability is already proven by
// that step's dedicated test.
//
// Read-only / advisory: nothing here gates a product decision on ring membership, and
// nothing executes what a "trial" or "assess" entry names -- the governance doc's own
// "never automatically executes third-party code" is upheld by this module simply never
// calling anything the entries describe. See technologyRadarStatus().enforced.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { validateManifest as validateAgainstSchema } from './sector-modules.mjs';
import { canonicalBytes } from './compliance-packs.mjs';

export class TechnologyRadarError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'TechnologyRadarError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new TechnologyRadarError(kind, reason); };

const RINGS = Object.freeze(['adopt', 'trial', 'assess', 'hold', 'deprecated', 'revoked']);
const TERMINAL_RINGS = Object.freeze(['revoked']);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadRadarSchema(productRoot) {
  const path = join(productRoot, 'schemas/technology-radar-entry.schema.json');
  const schema = readJson(path);
  if (!schema || typeof schema.properties !== 'object') refuse('SCHEMA_MISSING', `${path} is missing or malformed`);
  return schema;
}

export function loadRadarSeed(productRoot) {
  const path = join(productRoot, 'docs/governance/technology-radar-seed.json');
  const seed = readJson(path);
  if (!seed || !Array.isArray(seed.items)) refuse('SEED_MISSING', `${path} is missing or malformed`);
  return seed;
}

export function validateRadarEntry(candidate, schema) {
  return validateAgainstSchema(candidate, schema);
}

/**
 * The one lifecycle rule the governance doc's own ordering ("Adopt, Trial, Assess, Hold,
 * Deprecated and Revoked" -- a lifecycle, its last member named as such) supports without
 * inventing a transition graph the source text does not state: "revoked" is terminal.
 * Nothing else is asserted about which ring may follow which -- a full adjacency matrix
 * would be this module authoring governance policy, the exact overreach steps 27/28
 * refused for sector-module and compliance-pack content.
 */
export function checkRingTransition(fromRing, toRing) {
  const errors = [];
  if (!RINGS.includes(fromRing)) errors.push(`"${fromRing}" is not a known ring`);
  if (!RINGS.includes(toRing)) errors.push(`"${toRing}" is not a known ring`);
  if (errors.length === 0 && TERMINAL_RINGS.includes(fromRing) && fromRing !== toRing) {
    errors.push(`"${fromRing}" is terminal -- nothing transitions out of it`);
  }
  return { valid: errors.length === 0, errors };
}

export function signRadarEntry(entry, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  const bytes = canonicalBytes(entry);
  const signature = cryptoSign(null, bytes, privateKey);
  const publicKeyDer = createPublicKey(privateKey).export({ type:'spki', format:'der' });
  const fingerprintHex = createHash('sha256').update(publicKeyDer).digest('hex');
  return {
    ...entry,
    signature: {
      algorithm:'ed25519',
      value: signature.toString('base64'),
      publicKeyFingerprint: fingerprintHex,
      signedAt: new Date().toISOString(),
    },
  };
}

export function verifyRadarEntrySignature(entry, publicKeyPem) {
  if (!entry.signature || typeof entry.signature.value !== 'string') {
    refuse('NO_SIGNATURE', 'entry carries no signature to verify');
  }
  const publicKey = createPublicKey(publicKeyPem);
  const bytes = canonicalBytes(entry);
  const signature = Buffer.from(entry.signature.value, 'base64');
  return cryptoVerify(null, bytes, publicKey, signature);
}

function findEntries(dir, maxEntries) {
  const found = [];
  let truncated = false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes:true }); } catch { return { found, truncated }; }
  for (const entry of entries) {
    if (found.length >= maxEntries) { truncated = true; break; }
    if (!entry.isDirectory()) continue;
    found.push({ id:entry.name, path:join(dir, entry.name, 'entry.json') });
  }
  return { found, truncated };
}

/**
 * Scans `radarRoot` for `<name>/entry.json` -- live, individually-signed entries added
 * after the seed. `radarRoot` is a runtime location, not baked into the image, same
 * posture as `.sector-modules` / `.compliance-packs`: empty on every deployment so far.
 * The seed (loadRadarSeed) is separate and is NOT rescanned here -- it is fifteen fixed,
 * already-adopted entries recorded in the repository, not a directory of live additions.
 */
export function loadTechnologyRadar(productRoot, radarRoot, options = {}) {
  const maxEntries = options.maxEntries ?? 500;
  const schema = loadRadarSchema(productRoot);
  const { found, truncated } = findEntries(radarRoot, maxEntries);
  const valid = [];
  const invalid = [];
  for (const { id, path } of found) {
    const candidate = readJson(path);
    if (!candidate) { invalid.push({ id, path, errors:['not valid JSON'] }); continue; }
    const schemaResult = validateAgainstSchema(candidate, schema);
    const signatureErrors = [];
    if (options.publicKeyPem && schemaResult.valid) {
      try {
        if (!verifyRadarEntrySignature(candidate, options.publicKeyPem)) {
          signatureErrors.push('signature does not verify against the configured public key');
        }
      } catch (error) {
        signatureErrors.push(error.reason ?? String(error));
      }
    }
    const errors = [...schemaResult.errors, ...signatureErrors];
    if (errors.length === 0) valid.push({ id, path, entry:candidate });
    else invalid.push({ id, path, errors });
  }
  return { scanned: found.length, truncated, valid, invalid };
}

export function technologyRadarStatus(productRoot, radarRoot) {
  let schemaLoaded = false;
  let policyError = null;
  let seedByRing = {};
  let seedCount = 0;
  let seedUpdatedAt = null;
  try {
    loadRadarSchema(productRoot);
    schemaLoaded = true;
  } catch (error) { policyError = error.reason ?? String(error); }
  try {
    const seed = loadRadarSeed(productRoot);
    seedCount = seed.items.length;
    seedUpdatedAt = seed.updated_at ?? null;
    seedByRing = seed.items.reduce((acc, item) => {
      acc[item.ring] = (acc[item.ring] ?? 0) + 1;
      return acc;
    }, {});
  } catch { /* status must not throw even if the seed is unreadable */ }

  let liveEntries = 0;
  let invalidEntries = 0;
  if (schemaLoaded) {
    try {
      const scan = loadTechnologyRadar(productRoot, radarRoot);
      liveEntries = scan.valid.length;
      invalidEntries = scan.invalid.length;
    } catch { /* status must not throw even if a scan would */ }
  }

  return {
    rings: RINGS,
    terminalRings: TERMINAL_RINGS,
    radarSchemaSource: 'schemas/technology-radar-entry.schema.json',
    radarSeedSource: 'docs/governance/technology-radar-seed.json',
    schemaLoaded,
    policyError,
    seedCount,
    seedUpdatedAt,
    seedByRing,
    liveEntries,
    invalidEntries,
    signingAlgorithm: 'ed25519 (node:crypto, RFC 8032) — shared canonicalization with compliance-packs.mjs (D-0205)',
    enforced: false,
    reason: 'Tracks ring membership and validates schema/signature for live entries. Nothing yet gates a product decision on an entry\'s ring, and this module never executes anything an entry describes — the governance doc\'s own "never automatically executes third-party code" is upheld by omission, not by a check.',
    rustTwin: false,
    rustTwinReason: 'Same posture as sector-modules.mjs (D-0204) and compliance-packs.mjs (D-0205): proposes and verifies, does not decide or confine anything a caller can reach yet.',
  };
}
