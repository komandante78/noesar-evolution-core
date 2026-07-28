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
// Read-only and declarative: validates and lists candidate manifests, does not load,
// execute, or activate a module, and nothing yet mints a capability token on the strength
// of one being valid. See sectorModulesStatus().enforced. No Rust twin, same reason as
// repo-map.mjs (D-0188): this does not decide or confine anything a caller can reach yet.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
    if (!(permission in permissionCatalog)) {
      errors.push(`permission "${permission}" is not defined in permission-catalog.json`);
    }
  }
  return { valid: errors.length === 0, errors };
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
 * and the two policy files. `sectorModulesRoot` is a runtime location, not baked into the
 * image -- same posture as `.workspace` in server.mjs -- so this is empty on every
 * deployment so far: no real sector module has ever been installed. Nothing here loads,
 * executes, or activates what it finds; see sectorModulesStatus().enforced.
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
    if (errors.length === 0) valid.push({ id, path, manifest:candidate });
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
  if (schemaLoaded) {
    try {
      const scan = loadSectorModules(productRoot, sectorModulesRoot);
      installedModules = scan.valid.length;
      invalidManifests = scan.invalid.length;
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
    enforced: false,
    wiredToCapabilityMinting: false,
    reason: 'Validates and lists candidate sector module manifests against schema and policy. It does not load, execute, or activate anything, and nothing yet mints a capability token on the strength of a module being valid -- that wiring is future work, named here rather than implied.',
    rustTwin: false,
    rustTwinReason: 'Read-only validation against static policy files, same posture as repo-map.mjs (D-0188): it does not decide or confine anything a caller can reach yet, so there is no shared conformance oracle for a second implementation to match.',
    validatorMethod: 'hand-rolled subset of JSON Schema (required/type/enum/additionalProperties/array items) -- not a general engine, see validateManifest().',
  };
}
