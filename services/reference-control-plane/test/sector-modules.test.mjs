// SPDX-License-Identifier: AGPL-3.0-or-later
// Phase 7 step 27: sector module framework and trust levels. No Rust twin (see the module
// comment in src/sector-modules.mjs), so this is a plain test suite, not a shared-vectors run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SectorModuleError, loadTrustLevelPolicy, loadPermissionCatalog, loadManifestSchema,
  validateManifest, checkPolicyConsistency, validateCandidateManifest, loadSectorModules,
  sectorModulesStatus,
} from '../src/sector-modules.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const templatePath = join(repoRoot, 'capabilities/templates/industry-module/module.template.json');

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('loadTrustLevelPolicy reads the four tracked trust levels', () => {
  const policy = loadTrustLevelPolicy(repoRoot);
  assert.deepEqual(
    Object.keys(policy).sort(),
    ['certified-partner', 'community', 'customer-private', 'noesar-official'],
  );
});

test('loadTrustLevelPolicy refuses a productRoot with no policy file', () => {
  const empty = tmpDir('noesar-sector-empty-');
  try {
    assert.throws(() => loadTrustLevelPolicy(empty), SectorModuleError);
  } finally { rmSync(empty, { recursive:true, force:true }); }
});

test('loadPermissionCatalog reads the tracked permission names', () => {
  const catalog = loadPermissionCatalog(repoRoot);
  assert.ok('filesystem.read.project' in catalog);
  assert.ok('shell.execute' in catalog);
});

test('loadManifestSchema reads the tracked schema and its required fields', () => {
  const schema = loadManifestSchema(repoRoot);
  assert.ok(schema.required.includes('trust_level'));
  assert.equal(schema.additionalProperties, false);
});

test('validateManifest: a minimal well-formed manifest passes', () => {
  const schema = loadManifestSchema(repoRoot);
  const candidate = {
    id:'x', version:'0.1.0', publisher:'x', trust_level:'community',
    sector:['other'], intended_use:['a'], excluded_use:[], evidence:[],
  };
  const result = validateManifest(candidate, schema);
  assert.deepEqual(result, { valid:true, errors:[] });
});

test('validateManifest: missing required fields are named', () => {
  const schema = loadManifestSchema(repoRoot);
  const result = validateManifest({}, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('"id"')));
  assert.ok(result.errors.some((e) => e.includes('"trust_level"')));
});

test('validateManifest: unknown trust_level value is rejected by the enum', () => {
  const schema = loadManifestSchema(repoRoot);
  const candidate = {
    id:'x', version:'0.1.0', publisher:'x', trust_level:'not-a-real-level',
    sector:['other'], intended_use:['a'], excluded_use:[], evidence:[],
  };
  const result = validateManifest(candidate, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('trust_level')));
});

test('validateManifest: additionalProperties:false rejects an unknown top-level field', () => {
  const schema = loadManifestSchema(repoRoot);
  const candidate = {
    id:'x', version:'0.1.0', publisher:'x', trust_level:'community',
    sector:['other'], intended_use:['a'], excluded_use:[], evidence:[],
    notInTheSchema:true,
  };
  const result = validateManifest(candidate, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('notInTheSchema')));
});

test('validateManifest: wrong type on an array-of-string field is caught', () => {
  const schema = loadManifestSchema(repoRoot);
  const candidate = {
    id:'x', version:'0.1.0', publisher:'x', trust_level:'community',
    sector:['other'], intended_use:'not-an-array', excluded_use:[], evidence:[],
  };
  const result = validateManifest(candidate, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('intended_use')));
});

test('checkPolicyConsistency: a permission absent from the catalog is caught', () => {
  const trustLevels = loadTrustLevelPolicy(repoRoot);
  const permissionCatalog = loadPermissionCatalog(repoRoot);
  const result = checkPolicyConsistency(
    { trust_level:'community', permissions:['filesystem.read.project', 'made.up.permission'] },
    { trustLevels, permissionCatalog },
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('made.up.permission')));
});

test('checkPolicyConsistency: known trust_level and permissions pass', () => {
  const trustLevels = loadTrustLevelPolicy(repoRoot);
  const permissionCatalog = loadPermissionCatalog(repoRoot);
  const result = checkPolicyConsistency(
    { trust_level:'customer-private', permissions:['filesystem.read.project'] },
    { trustLevels, permissionCatalog },
  );
  assert.deepEqual(result, { valid:true, errors:[] });
});

test('the tracked example manifest validates cleanly against the tracked schema (found broken, fixed)', () => {
  const candidate = JSON.parse(readFileSync(templatePath, 'utf8'));
  const result = validateCandidateManifest(repoRoot, candidate);
  assert.deepEqual(result, { valid:true, errors:[] });
});

test('the OLD (camelCase) shape of that same manifest fails against the tracked schema — proves the fix was needed', () => {
  const oldShape = {
    dataClasses:['research-confidential'], evidence:[],
    excludedUse:['clinical diagnosis', 'physical actuation'],
    humanOversight:{ decisionAuthority:'qualified researcher', overrideAvailable:true, required:true },
    id:'customer.private.research-module', intendedUse:['internal research workflow support'],
    jurisdictions:[], permissions:['filesystem.read.project'], publisher:'customer.private',
    riskClass:'elevated',
    safetyInterlock:{ emergencyStop:false, externalController:false, required:false },
    schemaVersion:'4.0', sector:['scientific-research'], trustLevel:'customer-private', version:'0.1.0',
  };
  const result = validateCandidateManifest(repoRoot, oldShape);
  assert.equal(result.valid, false);
  // every field is "unknown" under additionalProperties:false because the schema's names
  // are snake_case; the required fields also all read as missing under their real names.
  assert.ok(result.errors.some((e) => e.includes('missing required field "trust_level"')));
  assert.ok(result.errors.some((e) => e.includes('unknown field "trustLevel"')));
});

test('loadSectorModules: an empty or absent directory scans to zero, does not throw', () => {
  const absent = join(tmpDir('noesar-sector-parent-'), 'does-not-exist');
  const scan = loadSectorModules(repoRoot, absent);
  assert.deepEqual(scan, { scanned:0, truncated:false, valid:[], invalid:[] });
});

test('loadSectorModules: a valid manifest is listed valid, an invalid one is listed invalid with reasons', () => {
  const dir = tmpDir('noesar-sector-modules-');
  try {
    const validDir = join(dir, 'good-module');
    mkdirSync(validDir, { recursive:true });
    writeFileSync(join(validDir, 'manifest.json'), readFileSync(templatePath, 'utf8'));

    const invalidDir = join(dir, 'bad-module');
    mkdirSync(invalidDir, { recursive:true });
    writeFileSync(join(invalidDir, 'manifest.json'), JSON.stringify({ id:'bad' }));

    const noManifestDir = join(dir, 'no-manifest-here');
    mkdirSync(noManifestDir, { recursive:true });

    const scan = loadSectorModules(repoRoot, dir);
    assert.equal(scan.scanned, 2); // no-manifest-here is not counted: no manifest.json
    assert.equal(scan.valid.length, 1);
    assert.equal(scan.valid[0].id, 'good-module');
    assert.equal(scan.invalid.length, 1);
    assert.equal(scan.invalid[0].id, 'bad-module');
    assert.ok(scan.invalid[0].errors.length > 0);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('loadSectorModules: maxModules truncates and says so', () => {
  const dir = tmpDir('noesar-sector-truncate-');
  try {
    for (let i = 0; i < 3; i += 1) {
      const modDir = join(dir, `module-${i}`);
      mkdirSync(modDir, { recursive:true });
      writeFileSync(join(modDir, 'manifest.json'), '{}');
    }
    const scan = loadSectorModules(repoRoot, dir, { maxModules:2 });
    assert.equal(scan.scanned, 2);
    assert.equal(scan.truncated, true);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('sectorModulesStatus declares the trust levels, the sources, and that nothing is enforced yet', () => {
  const status = sectorModulesStatus(repoRoot, join(repoRoot, '.sector-modules'));
  assert.deepEqual(
    status.trustLevels.sort(),
    ['certified-partner', 'community', 'customer-private', 'noesar-official'],
  );
  assert.equal(status.schemaLoaded, true);
  assert.equal(status.enforced, false);
  assert.equal(status.wiredToCapabilityMinting, false);
  assert.equal(status.rustTwin, false);
});

test('sectorModulesStatus does not throw when the policy files are absent, and says why', () => {
  const empty = tmpDir('noesar-sector-status-empty-');
  try {
    const status = sectorModulesStatus(empty, join(empty, '.sector-modules'));
    assert.equal(status.schemaLoaded, false);
    assert.ok(status.policyError);
    assert.equal(status.installedModules, 0);
  } finally { rmSync(empty, { recursive:true, force:true }); }
});
