// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sector module framework and trust levels · phase 7 step 27 ("Il mondo esterno",
// 09_PIANO.md §2) -- the first step of the phase, chosen for the same reason step 1 of
// phase 1 was the ReasoningProvider contract: it is the vocabulary everything after it
// names, not a feature on top of one.
//
// Not built from zero. `capabilities/security/trust-level-policy.json`,
// `capabilities/security/permission-catalog.json` and
// `schemas/industry-module-manifest.schema.json` have been tracked in MANIFEST.sha256
// since 2026-07-25 (the canonical repository construction, commit f6140d8) -- present the
// whole time this project has existed, never copied into any deployed image, never read
// by any line of code until this step. Exactly the "schema morto" class 09_PIANO.md §1
// names as worse than absence: a file that looks like coverage and is not. Revived here
// instead of duplicated, per the same principle §1 states for `memory_items.provenance`.
//
// Found reviving it: the tracked schema (snake_case: trust_level, intended_use,
// excluded_use) and the tracked example manifest
// (`capabilities/templates/industry-module/module.template.json`, camelCase: trustLevel,
// intendedUse, schemaVersion:"4.0") disagree on field names -- the example does not
// validate against the schema it is meant to exemplify, and `additionalProperties: false`
// on the schema means every one of its fields reads as unknown. Fixed at the template
// (the schema is what the validator below reads; the template is what a publisher copies),
// verified failing before the fix and passing after -- see sector-modules.test.mjs.
//
// D-0274: activation added. install()/activate()/deactivate() below turn a validated
// candidate into a real, persisted lifecycle state (installed -> active -> installed
// again), gated the same way ARCH-005 gates every other adapter: the caller must present
// a capability token minted by AdapterGrantOrchestrator (see adapter-capability.mjs's
// `sector-modules` manifest, now carrying a real WRITE operation) -- this module still
// mints nothing itself, it only spends what the engine already granted. Discovery and
// validation (everything above this comment) are unchanged. What is still NOT here:
// no code in this control plane loads or executes a module's own logic -- "active" means
// "the manifest is the trusted, current statement of what this module is and needs",
// consumed by whatever future surface lists installed modules (e.g. a WebUI panel), not
// a sandboxed runtime. See sectorModulesStatus().moduleRuntimeExecutionExists.

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { CapabilityError } from './capability.mjs';
import { canonicalJsonBytes } from './canonical-json.mjs';

export class SectorModuleError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'SectorModuleError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new SectorModuleError(kind, reason); };

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadTrustLevelPolicy(productRoot) {
  const path = join(productRoot, 'capabilities/security/trust-level-policy.json');
  const policy = readJson(path);
  if (!policy || typeof policy !== 'object') refuse('TRUST_POLICY_MISSING', `${path} is missing or not valid JSON`);
  return policy;
}

export function loadPermissionCatalog(productRoot) {
  const path = join(productRoot, 'capabilities/security/permission-catalog.json');
  const catalog = readJson(path);
  if (!catalog || typeof catalog.permissions !== 'object') refuse('PERMISSION_CATALOG_MISSING', `${path} is missing or malformed`);
  return catalog.permissions;
}

export function loadManifestSchema(productRoot) {
  const path = join(productRoot, 'schemas/industry-module-manifest.schema.json');
  const schema = readJson(path);
  if (!schema || typeof schema.properties !== 'object') refuse('SCHEMA_MISSING', `${path} is missing or malformed`);
  return schema;
}

/**
 * Validates one candidate object against a JSON Schema document, for the subset of shapes
 * `industry-module-manifest.schema.json` actually uses: required, type (string/object/
 * array), enum, additionalProperties, and array items typed string or object. Not a
 * general JSON Schema engine -- a dependency the size of ajv for one flat schema is exactly
 * the "while we are here" the budget skill forbids. Declared, not implied: an unsupported
 * schema keyword is simply not checked, rather than silently reported as passing more than
 * it verified.
 */
export function validateManifest(candidate, schema) {
  const errors = [];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid:false, errors:['manifest must be a JSON object'] };
  }
  for (const field of schema.required ?? []) {
    if (!(field in candidate)) errors.push(`missing required field "${field}"`);
  }
  const props = schema.properties ?? {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(candidate)) {
      if (!(key in props)) errors.push(`unknown field "${key}" (not defined by the schema)`);
    }
  }
  for (const [key, spec] of Object.entries(props)) {
    if (!(key in candidate)) continue;
    const value = candidate[key];
    if (spec.enum && !spec.enum.includes(value)) {
      errors.push(`field "${key}" must be one of ${JSON.stringify(spec.enum)}, got ${JSON.stringify(value)}`);
    } else if (spec.type === 'string' && typeof value !== 'string') {
      errors.push(`field "${key}" must be a string`);
    } else if (spec.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      errors.push(`field "${key}" must be an object`);
    } else if (spec.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`field "${key}" must be an array`);
      } else if (spec.items?.type === 'string') {
        value.forEach((item, i) => { if (typeof item !== 'string') errors.push(`field "${key}[${i}]" must be a string`); });
      } else if (spec.items?.type === 'object') {
        value.forEach((item, i) => { if (typeof item !== 'object' || item === null || Array.isArray(item)) errors.push(`field "${key}[${i}]" must be an object`); });
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Cross-checks fields the schema can only see as strings against the two policy files
 * that give those strings meaning: `trust_level` must be a level trust-level-policy.json
 * defines, and every entry in `permissions` must be a name permission-catalog.json defines.
 * A schema keyed on "is this a string" cannot catch a permission that was renamed or never
 * existed; this can. Skipped when schema validation already failed, so one manifest does
 * not get scored on a field the schema check already rejected.
 */
export function checkPolicyConsistency(candidate, { trustLevels, permissionCatalog }) {
  const errors = [];
  if (candidate.trust_level && !(candidate.trust_level in trustLevels)) {
    errors.push(`trust_level "${candidate.trust_level}" is not defined in trust-level-policy.json`);
  }
  for (const permission of candidate.permissions ?? []) {
    const entry = permissionCatalog[permission];
    if (!entry) {
      errors.push(`permission "${permission}" is not defined in permission-catalog.json`);
      continue;
    }
    // "physical.actuate" is the only catalog entry with this approval value today, but the
    // check reads the catalog rather than naming the permission, so a future core-excluded
    // permission is refused the same way without a code change here.
    if (entry.approval === 'not-available-in-core') {
      errors.push(`permission "${permission}" is not available in the core (declared "not-available-in-core" in permission-catalog.json)`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// The one permission a module can hold that this framework treats as carrying no
// elevated risk: read-only, scoped to the project the module was installed for. Anything
// else -- a write, host filesystem access, network egress, a secret, a shell -- is
// "elevated" for classifyModuleRisk() below, independent of what the module says about
// itself. Declared as one named set so the rule is visible and auditable, not implied by
// which branch of an if/else a permission happens to fall into.
export const SAFE_PERMISSIONS = Object.freeze(new Set(['filesystem.read.project']));

/**
 * A module is high-risk if it asks for any permission beyond SAFE_PERMISSIONS -- the
 * `trust_level`'s own `highRiskEligible` flag then decides whether that request can ever
 * be granted (see activateSectorModule()). This is a property of what a specific manifest
 * asks for, not of its trust level: two noesar-official modules can differ here.
 */
export function classifyModuleRisk(candidate) {
  const permissions = candidate.permissions ?? [];
  const elevatedPermissions = permissions.filter((permission) => !SAFE_PERMISSIONS.has(permission));
  return { highRisk: elevatedPermissions.length > 0, elevatedPermissions };
}

const MODULE_ID_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

function resolveModuleId(id) {
  if (typeof id !== 'string' || !MODULE_ID_PATTERN.test(id)) {
    refuse('INVALID_ID', `module id "${id}" must match ${MODULE_ID_PATTERN} (lowercase, starts with a letter, 3-64 chars)`);
  }
  return id;
}

/** The manifest with `signature` removed, over the SAME canonical-JSON encoder
 * `update-manager.mjs` already signs channel metadata and packages with
 * (`canonical-json.mjs`) — D-0275 found this module and `compliance-packs.mjs` had each
 * grown their own hand-rolled recursive-sort copy of exactly this function; fixed here by
 * using the shared one instead of adding a third. `compliance-packs.mjs`'s own copy is
 * untouched (pre-existing, out of this phase's scope). */
function canonicalManifestBytes(manifest) {
  const { signature: _signature, ...rest } = manifest;
  return canonicalJsonBytes(rest);
}

/** D-0275: the fingerprint identifies WHICH publisher key signed this manifest, so
 * activateSectorModule() can look one up in the trusted publisher registry instead of
 * trusting whatever single key an operator happened to configure globally. Same shape
 * `compliance-packs.mjs::signCompliancePack` already uses for its own packs. */
function publicKeyFingerprint(privateOrPublicKey) {
  const publicKey = privateOrPublicKey.type === 'private' ? createPublicKey(privateOrPublicKey) : privateOrPublicKey;
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

export function signSectorModuleManifest(manifest, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  const bytes = canonicalManifestBytes(manifest);
  const signatureValue = cryptoSign(null, bytes, privateKey);
  return {
    ...manifest,
    signature: {
      algorithm: 'ed25519', value: signatureValue.toString('base64'),
      publicKeyFingerprint: publicKeyFingerprint(privateKey), signedAt: new Date().toISOString(),
    },
  };
}

/** Refuses (does not silently return false) when the manifest carries no signature at
 * all -- absent and wrong are different failures, same posture as
 * verifyCompliancePackSignature() in compliance-packs.mjs. */
export function verifySectorModuleManifestSignature(manifest, publicKeyPem) {
  if (!manifest.signature || typeof manifest.signature.value !== 'string') {
    refuse('NO_SIGNATURE', 'manifest carries no signature to verify');
  }
  const publicKey = createPublicKey(publicKeyPem);
  const bytes = canonicalManifestBytes(manifest);
  const signatureValue = Buffer.from(manifest.signature.value, 'base64');
  return cryptoVerify(null, bytes, publicKey, signatureValue);
}

function moduleDir(sectorModulesRoot, id) { return join(sectorModulesRoot, id); }
function manifestPathFor(sectorModulesRoot, id) { return join(moduleDir(sectorModulesRoot, id), 'manifest.json'); }
function statePathFor(sectorModulesRoot, id) { return join(moduleDir(sectorModulesRoot, id), 'state.json'); }

function atomicWriteJson(path, value) {
  const tmp = `${path}.tmp-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}

/** `state.json` does not exist for a manifest installed before this step, or for one
 * whose state file was never written for some other reason -- treated as freshly
 * `installed`, never `active`, which is the safe default (a module is never silently
 * treated as already approved). */
function defaultModuleState() {
  return { status: 'installed', installedAtUnix: null, activatedAtUnix: null, deactivatedAtUnix: null, history: [] };
}

export function loadModuleState(sectorModulesRoot, id) {
  return readJson(statePathFor(sectorModulesRoot, id)) ?? defaultModuleState();
}

/** Reads an installed manifest without validating or activating it — used by the HTTP
 * layer to decide, before calling activateSectorModule(), whether this specific request
 * needs the route's own strong-reauthentication check (a session-scoped concern this pure
 * module has no access to). Returns null rather than throwing when nothing is installed
 * under `id`, since "peek to decide" should not itself be able to refuse. */
export function readInstalledManifest(sectorModulesRoot, id) {
  resolveModuleId(id);
  return readJson(manifestPathFor(sectorModulesRoot, id));
}

function spendAdapterWriteToken({ minter, capabilityToken, nowUnix }) {
  if (!minter) refuse('NO_CAPABILITY_ENGINE', 'no capability engine is wired to this provider; refusing to self-authorize');
  try {
    minter.spend(capabilityToken, { path: 'adapter://sector-modules/write', operation: 'WRITE' }, nowUnix);
  } catch (error) {
    // Same posture as local-model-runtime.mjs's launch(): a missing/malformed
    // capabilityToken (e.g. `null`, the value every caller sends before ever requesting a
    // grant) throws a plain TypeError inside TokenMinter#spend, not a CapabilityError --
    // caught here too, not just the one class, so a caller with no token gets a clean
    // refusal instead of an unhandled exception reaching the HTTP layer.
    if (error instanceof CapabilityError) refuse('NOT_AUTHORIZED', error.reason);
    refuse('NOT_AUTHORIZED', `no valid capability token was supplied (${error.message})`);
  }
}

/**
 * Writes a validated candidate to `<sectorModulesRoot>/<id>/manifest.json` plus a fresh
 * `state.json`. Requires a capability token already approved through
 * `POST /api/v1/adapters/sector-modules/grants` -> `.../approve` (ARCH-005: this function
 * mints nothing, it only spends). Refuses to overwrite an existing installation -- an
 * update is an explicit deactivate + reinstall, not an implicit replace.
 */
export function installSectorModule({ productRoot, sectorModulesRoot, id, candidate, minter, capabilityToken, nowUnix }) {
  resolveModuleId(id);
  if (candidate?.id !== id) refuse('ID_MISMATCH', `the manifest's own "id" ("${candidate?.id}") must equal the install target ("${id}")`);
  const result = validateCandidateManifest(productRoot, candidate);
  if (!result.valid) refuse('INVALID_MANIFEST', result.errors.join('; '));
  spendAdapterWriteToken({ minter, capabilityToken, nowUnix });
  const dir = moduleDir(sectorModulesRoot, id);
  if (existsSync(manifestPathFor(sectorModulesRoot, id))) refuse('ALREADY_INSTALLED', `a module named "${id}" is already installed; deactivate and reinstall to replace it`);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(manifestPathFor(sectorModulesRoot, id), candidate);
  atomicWriteJson(statePathFor(sectorModulesRoot, id), {
    status: 'installed', installedAtUnix: nowUnix, activatedAtUnix: null, deactivatedAtUnix: null,
    history: [{ event: 'installed', atUnix: nowUnix }],
  });
  return { id, path: manifestPathFor(sectorModulesRoot, id), manifest: candidate };
}

/**
 * Turns an installed module `active`. Re-validates the manifest fresh from disk (never
 * trusts a validity result from install time) and re-derives risk, so a manifest edited
 * on disk after install cannot ride on a stale approval. For a module whose risk is
 * elevated (see classifyModuleRisk): the trust level must be `highRiskEligible`, the
 * manifest must carry non-empty `evidence` and `human_oversight.required: true`, and a
 * valid Ed25519 signature from a key `publisherRegistry` (D-0275) says is currently ACTIVE
 * for the manifest's OWN `publisher`, registered at the manifest's OWN `trust_level` --
 * the four things `docs/capabilities/INDUSTRY_MODULE_ACTIVATION.md` names for high-risk
 * activation, minus "recent strong reauthentication", which is an HTTP-layer,
 * session-scoped concern checked by the route handler, not something this pure function
 * can see. Checking the registry's OWN trust-level record (not just that some key
 * verifies) matters: without it a manifest could self-declare "noesar-official" and pass
 * as long as any registered key signed it, whatever level that key was actually
 * registered at.
 */
export function activateSectorModule({ productRoot, sectorModulesRoot, id, minter, capabilityToken, approverId, nowUnix, publisherRegistry }) {
  resolveModuleId(id);
  const candidate = readJson(manifestPathFor(sectorModulesRoot, id));
  if (!candidate) refuse('NOT_FOUND', `no installed module named "${id}"`);
  const result = validateCandidateManifest(productRoot, candidate);
  if (!result.valid) refuse('INVALID_MANIFEST', result.errors.join('; '));
  const state = loadModuleState(sectorModulesRoot, id);
  if (state.status === 'active') refuse('ALREADY_ACTIVE', `module "${id}" is already active`);

  const trustLevels = loadTrustLevelPolicy(productRoot);
  const levelPolicy = trustLevels[candidate.trust_level];
  const risk = classifyModuleRisk(candidate);
  if (risk.highRisk) {
    if (!levelPolicy?.highRiskEligible) {
      refuse('INELIGIBLE_TRUST_LEVEL', `trust_level "${candidate.trust_level}" is not eligible for the elevated permissions this manifest requests (${risk.elevatedPermissions.join(', ')})`);
    }
    if (!(candidate.evidence?.length > 0)) refuse('MISSING_EVIDENCE', 'a high-risk module needs a non-empty evidence array to activate');
    if (candidate.human_oversight?.required !== true) refuse('MISSING_HUMAN_OVERSIGHT', 'a high-risk module needs human_oversight.required:true to activate');
    if (!candidate.signature?.publicKeyFingerprint) refuse('SIGNATURE_INVALID', 'a high-risk manifest signature must carry a publicKeyFingerprint (sign with signSectorModuleManifest)');
    if (!publisherRegistry) refuse('NO_PUBLISHER_REGISTRY', 'no publisher registry is wired to this deployment; a high-risk module cannot be activated unverified');
    const keyRecord = publisherRegistry.findActiveKey({
      publisherId: candidate.publisher, fingerprint: candidate.signature.publicKeyFingerprint, declaredTrustLevel: candidate.trust_level,
    });
    if (!keyRecord) {
      refuse('PUBLISHER_KEY_NOT_TRUSTED', `no active key for publisher "${candidate.publisher}" registered at trust level "${candidate.trust_level}" matches this manifest's signature`);
    }
    let verified;
    try { verified = verifySectorModuleManifestSignature(candidate, keyRecord.publicKeyPem); }
    catch (error) { refuse('SIGNATURE_INVALID', error.reason ?? String(error)); }
    if (!verified) refuse('SIGNATURE_INVALID', 'the manifest signature does not verify against the registered publisher key');
  }

  spendAdapterWriteToken({ minter, capabilityToken, nowUnix });
  atomicWriteJson(statePathFor(sectorModulesRoot, id), {
    status: 'active',
    installedAtUnix: state.installedAtUnix,
    activatedAtUnix: nowUnix,
    deactivatedAtUnix: null,
    history: [...state.history, { event: 'activated', atUnix: nowUnix, approverId, highRisk: risk.highRisk }],
  });
  return { id, status: 'active', trustLevel: candidate.trust_level, highRisk: risk.highRisk, elevatedPermissions: risk.elevatedPermissions, activatedAtUnix: nowUnix };
}

/** The "disable" verb from PROJECT_GOVERNANCE/07_INDUSTRY_MODULES/70 -- returns the
 * module to `installed`, does not delete its files. Uninstall (deleting the directory
 * entirely) is out of scope for this step, named rather than silently absent. */
export function deactivateSectorModule({ sectorModulesRoot, id, minter, capabilityToken, approverId, nowUnix, reason }) {
  resolveModuleId(id);
  if (!existsSync(manifestPathFor(sectorModulesRoot, id))) refuse('NOT_FOUND', `no installed module named "${id}"`);
  const state = loadModuleState(sectorModulesRoot, id);
  if (state.status !== 'active') refuse('NOT_ACTIVE', `module "${id}" is not active`);
  spendAdapterWriteToken({ minter, capabilityToken, nowUnix });
  atomicWriteJson(statePathFor(sectorModulesRoot, id), {
    status: 'installed',
    installedAtUnix: state.installedAtUnix,
    activatedAtUnix: state.activatedAtUnix,
    deactivatedAtUnix: nowUnix,
    history: [...state.history, { event: 'deactivated', atUnix: nowUnix, approverId, reason: reason ?? null }],
  });
  return { id, status: 'installed', deactivatedAtUnix: nowUnix };
}

/** Schema + policy in one call, each reloaded fresh -- same posture as buildRepositoryMap
 * in repo-map.mjs: no cache, rebuilt on every call, cheap because the three files are
 * small and this is not called in a loop (loadSectorModules loads them once and reuses
 * validateManifest/checkPolicyConsistency directly instead). */
export function validateCandidateManifest(productRoot, candidate) {
  const schema = loadManifestSchema(productRoot);
  const trustLevels = loadTrustLevelPolicy(productRoot);
  const permissionCatalog = loadPermissionCatalog(productRoot);
  const schemaResult = validateManifest(candidate, schema);
  const policyResult = schemaResult.valid
    ? checkPolicyConsistency(candidate, { trustLevels, permissionCatalog })
    : { valid:true, errors:[] };
  return { valid: schemaResult.valid && policyResult.valid, errors:[...schemaResult.errors, ...policyResult.errors] };
}

function findManifests(dir, maxModules) {
  const found = [];
  let truncated = false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes:true }); } catch { return { found, truncated }; }
  for (const entry of entries) {
    if (found.length >= maxModules) { truncated = true; break; }
    if (!entry.isDirectory()) continue;
    const manifestPath = join(dir, entry.name, 'manifest.json');
    if (existsSync(manifestPath)) found.push({ id:entry.name, path:manifestPath });
  }
  return { found, truncated };
}

/**
 * Scans `sectorModulesRoot` for `<name>/manifest.json`, validates each against the schema
 * and the two policy files, and attaches each valid entry's lifecycle `state` (see
 * loadModuleState() -- defaults to `installed` if `state.json` is absent, e.g. for a
 * manifest that predates D-0274). `sectorModulesRoot` is a runtime location, not baked
 * into the image -- same posture as `.workspace` in server.mjs.
 */
export function loadSectorModules(productRoot, sectorModulesRoot, options = {}) {
  const maxModules = options.maxModules ?? 500;
  const schema = loadManifestSchema(productRoot);
  const trustLevels = loadTrustLevelPolicy(productRoot);
  const permissionCatalog = loadPermissionCatalog(productRoot);
  const { found, truncated } = findManifests(sectorModulesRoot, maxModules);
  const valid = [];
  const invalid = [];
  for (const { id, path } of found) {
    const candidate = readJson(path);
    if (!candidate) { invalid.push({ id, path, errors:['not valid JSON'] }); continue; }
    const schemaResult = validateManifest(candidate, schema);
    const policyResult = schemaResult.valid
      ? checkPolicyConsistency(candidate, { trustLevels, permissionCatalog })
      : { valid:true, errors:[] };
    const errors = [...schemaResult.errors, ...policyResult.errors];
    if (errors.length === 0) valid.push({ id, path, manifest:candidate, state: loadModuleState(sectorModulesRoot, id) });
    else invalid.push({ id, path, errors });
  }
  return { scanned: found.length, truncated, valid, invalid };
}

export function sectorModulesStatus(productRoot, sectorModulesRoot) {
  let trustLevels = null;
  let permissionCatalog = null;
  let schemaLoaded = false;
  let policyError = null;
  try {
    trustLevels = loadTrustLevelPolicy(productRoot);
    permissionCatalog = loadPermissionCatalog(productRoot);
    loadManifestSchema(productRoot);
    schemaLoaded = true;
  } catch (error) { policyError = error.reason ?? String(error); }

  let installedModules = 0;
  let invalidManifests = 0;
  let activeModules = 0;
  if (schemaLoaded) {
    try {
      const scan = loadSectorModules(productRoot, sectorModulesRoot);
      installedModules = scan.valid.length;
      invalidManifests = scan.invalid.length;
      activeModules = scan.valid.filter((entry) => entry.state?.status === 'active').length;
    } catch { /* status must not throw even if a scan would */ }
  }

  return {
    trustLevels: trustLevels ? Object.keys(trustLevels) : [],
    trustLevelPolicySource: 'capabilities/security/trust-level-policy.json',
    permissionCatalogSize: permissionCatalog ? Object.keys(permissionCatalog).length : 0,
    permissionCatalogSource: 'capabilities/security/permission-catalog.json',
    manifestSchemaSource: 'schemas/industry-module-manifest.schema.json',
    schemaLoaded,
    policyError,
    installedModules,
    invalidManifests,
    activeModules,
    // D-0274: install/activate/deactivate exist now (see the three exported functions
    // above), each spending a capability token minted through AdapterGrantOrchestrator --
    // the same "engine mints, adapter spends" rule ARCH-005 states for every other
    // adapter. `enforced` describes exactly that: a module cannot become active without
    // an owner-approved grant, and a high-risk one additionally needs trust-level
    // eligibility, non-empty evidence, human_oversight.required:true and a verified
    // Ed25519 signature. `moduleRuntimeExecutionExists` is the thing this does NOT claim:
    // no code in this control plane loads or runs a module's own logic -- "active" is a
    // trusted-and-current flag other surfaces (a future module list, a future
    // marketplace) can read, not a sandbox that executes anything.
    enforced: true,
    wiredToCapabilityMinting: true,
    moduleRuntimeExecutionExists: false,
    reason: 'Validates and lists candidate sector module manifests, and now gates install/activate/deactivate through the same capability engine every other adapter spends through (ARCH-005). High-risk activation additionally requires trust-level eligibility, non-empty evidence, explicit human oversight and a verified Ed25519 signature. Nothing here loads or executes a module\'s own code -- see moduleRuntimeExecutionExists.',
    rustTwin: false,
    rustTwinReason: 'Read-only validation against static policy files, same posture as repo-map.mjs (D-0188): it does not decide or confine anything a caller can reach yet, so there is no shared conformance oracle for a second implementation to match. The mutating functions (install/activate/deactivate) spend a token minted by capability.mjs, which does have a Rust twin (noesar-capability) -- the shared oracle there is the token format, not this provider\'s own logic.',
    validatorMethod: 'hand-rolled subset of JSON Schema (required/type/enum/additionalProperties/array items) -- not a general engine, see validateManifest().',
  };
}
