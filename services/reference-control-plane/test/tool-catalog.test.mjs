// SPDX-License-Identifier: AGPL-3.0-or-later
// CodeN Evolution construction order, step 10: the zero-load tool catalog. No Rust twin
// — see the module comment in src/tool-catalog.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import {
  ToolCatalogError, loadToolCatalogSchema, validateToolEntry, searchCatalog,
  verifyToolProvenance, scopeRequestToTool, ActiveToolRegistry, toolCatalogStatus,
} from '../src/tool-catalog.mjs';
import { signCompliancePack } from '../src/compliance-packs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function sampleTool(overrides = {}) {
  return {
    id:'formatter-x', name:'Formatter X', version:'1.0.0', publisher:'noesar-official',
    declaredEffects:[{ operations:['READ', 'WRITE'], pathPrefix:'src/' }],
    ...overrides,
  };
}

test('loadToolCatalogSchema reads the tracked schema', () => {
  const schema = loadToolCatalogSchema(repoRoot);
  assert.ok(schema.required.includes('declaredEffects'));
  assert.equal(schema.additionalProperties, false);
});

test('loadToolCatalogSchema refuses a productRoot with no schema file', () => {
  const empty = tmpDir('noesar-tools-empty-');
  try {
    assert.throws(() => loadToolCatalogSchema(empty), ToolCatalogError);
  } finally { rmSync(empty, { recursive:true, force:true }); }
});

test('validateToolEntry: a well-formed tool passes', () => {
  const schema = loadToolCatalogSchema(repoRoot);
  assert.deepEqual(validateToolEntry(sampleTool(), schema), { valid:true, errors:[] });
});

test('validateToolEntry: an unknown operation is rejected — reuses capability.mjs\'s own vocabulary', () => {
  const schema = loadToolCatalogSchema(repoRoot);
  const result = validateToolEntry(sampleTool({ declaredEffects:[{ operations:['FLY'], pathPrefix:'src/' }] }), schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('FLY')));
});

test('validateToolEntry: an effect naming neither paths nor pathPrefix is rejected', () => {
  const schema = loadToolCatalogSchema(repoRoot);
  const result = validateToolEntry(sampleTool({ declaredEffects:[{ operations:['READ'] }] }), schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('paths') || e.includes('pathPrefix')));
});

test('validateToolEntry: a pathPrefix not ending in "/" is rejected', () => {
  const schema = loadToolCatalogSchema(repoRoot);
  const result = validateToolEntry(sampleTool({ declaredEffects:[{ operations:['READ'], pathPrefix:'src' }] }), schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('pathPrefix must end with')));
});

test('validateToolEntry: an empty operations array is rejected', () => {
  const schema = loadToolCatalogSchema(repoRoot);
  const result = validateToolEntry(sampleTool({ declaredEffects:[{ operations:[], paths:['x.txt'] }] }), schema);
  assert.equal(result.valid, false);
});

test('searchCatalog: an empty or absent directory scans to zero, does not throw', () => {
  const absent = join(tmpDir('noesar-tools-parent-'), 'does-not-exist');
  const result = searchCatalog(repoRoot, absent);
  assert.deepEqual(result, { scanned:0, truncated:false, matches:[], invalid:[] });
});

test('searchCatalog: finds a tool by name substring and by declared operation', () => {
  const dir = tmpDir('noesar-tools-search-');
  try {
    const toolDir = join(dir, 'formatter-x');
    mkdirSync(toolDir, { recursive:true });
    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify(sampleTool()));

    const byName = searchCatalog(repoRoot, dir, { name:'formatter' });
    assert.equal(byName.matches.length, 1);

    const byOp = searchCatalog(repoRoot, dir, { operation:'WRITE' });
    assert.equal(byOp.matches.length, 1);

    const noMatch = searchCatalog(repoRoot, dir, { operation:'DELETE' });
    assert.equal(noMatch.matches.length, 0);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('searchCatalog: an invalid entry is reported invalid, not silently dropped', () => {
  const dir = tmpDir('noesar-tools-invalid-');
  try {
    const toolDir = join(dir, 'broken');
    mkdirSync(toolDir, { recursive:true });
    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({ id:'broken' }));
    const result = searchCatalog(repoRoot, dir);
    assert.equal(result.invalid.length, 1);
    assert.equal(result.matches.length, 0);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('verifyToolProvenance: reuses compliance-packs.mjs signing as-is, round-trips', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signed = signCompliancePack(sampleTool(), privateKey.export({ type:'pkcs8', format:'pem' }));
  assert.equal(verifyToolProvenance(signed, publicKey.export({ type:'spki', format:'pem' })), true);
});

test('scopeRequestToTool: an undeclared path is excluded from the request, not merely flagged', () => {
  const tool = sampleTool({ declaredEffects:[{ operations:['WRITE'], pathPrefix:'src/' }] });
  const result = scopeRequestToTool(tool, ['src/a.js', 'secrets/key.pem'], ['WRITE']);
  assert.deepEqual(result.paths, ['src/a.js']);
  assert.deepEqual(result.refusedPaths, ['secrets/key.pem']);
});

test('scopeRequestToTool: an undeclared operation is excluded from the request', () => {
  const tool = sampleTool({ declaredEffects:[{ operations:['READ'], pathPrefix:'src/' }] });
  const result = scopeRequestToTool(tool, ['src/a.js'], ['READ', 'DELETE']);
  assert.deepEqual(result.operations, ['READ']);
  assert.deepEqual(result.refusedOperations, ['DELETE']);
});

test('scopeRequestToTool: exact `paths` entries work alongside pathPrefix', () => {
  const tool = sampleTool({ declaredEffects:[{ operations:['READ'], paths:['config/app.json'] }] });
  const result = scopeRequestToTool(tool, ['config/app.json', 'config/other.json'], ['READ']);
  assert.deepEqual(result.paths, ['config/app.json']);
  assert.deepEqual(result.refusedPaths, ['config/other.json']);
});

test('scopeRequestToTool: a tool with two declared effects unions both', () => {
  const tool = sampleTool({
    declaredEffects:[
      { operations:['READ'], pathPrefix:'src/' },
      { operations:['WRITE'], pathPrefix:'reports/' },
    ],
  });
  const result = scopeRequestToTool(tool, ['src/a.js', 'reports/out.txt'], ['READ', 'WRITE']);
  assert.deepEqual(result.paths.sort(), ['reports/out.txt', 'src/a.js']);
  assert.deepEqual(result.operations.sort(), ['READ', 'WRITE']);
});

test('ActiveToolRegistry: install then list shows it, uninstall removes it', () => {
  const registry = new ActiveToolRegistry();
  registry.install(sampleTool(), { sessionId:'s1' });
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get('formatter-x').name, 'Formatter X');
  const { uninstalled } = registry.uninstall('formatter-x');
  assert.equal(uninstalled, true);
  assert.equal(registry.list().length, 0);
});

test('ActiveToolRegistry: install refuses a bad signature when a public key is configured', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const registry = new ActiveToolRegistry();
  assert.throws(
    () => registry.install(sampleTool(), { publicKeyPem: publicKey.export({ type:'spki', format:'pem' }) }),
    ToolCatalogError,
  );
  assert.equal(registry.list().length, 0);
});

test('ActiveToolRegistry: install accepts a validly signed tool when a public key is configured', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signed = signCompliancePack(sampleTool(), privateKey.export({ type:'pkcs8', format:'pem' }));
  const registry = new ActiveToolRegistry();
  registry.install(signed, { publicKeyPem: publicKey.export({ type:'spki', format:'pem' }) });
  assert.equal(registry.list().length, 1);
});

test('ActiveToolRegistry: uninstallAll removes everything not permanent, scoped by session', () => {
  const registry = new ActiveToolRegistry();
  registry.install(sampleTool({ id:'a' }), { sessionId:'s1' });
  registry.install(sampleTool({ id:'b' }), { sessionId:'s1', permanent:true });
  registry.install(sampleTool({ id:'c' }), { sessionId:'s2' });
  const removed = registry.uninstallAll({ sessionId:'s1' });
  assert.deepEqual(removed, ['a']);
  assert.equal(registry.list().length, 2); // b (permanent) and c (other session) survive
});

test('toolCatalogStatus: at rest with an empty registry, declares zero tools loaded and the honest limits', () => {
  const registry = new ActiveToolRegistry();
  const status = toolCatalogStatus(registry);
  assert.equal(status.atRest, true);
  assert.equal(status.activeToolCount, 0);
  assert.equal(status.denylist, false);
  assert.equal(status.installRunsCode, false);
  assert.equal(status.enforced, false);
  assert.equal(status.rustTwin, false);
});

test('toolCatalogStatus: after installing a tool, atRest is false and it is named', () => {
  const registry = new ActiveToolRegistry();
  registry.install(sampleTool(), { sessionId:'s1' });
  const status = toolCatalogStatus(registry);
  assert.equal(status.atRest, false);
  assert.equal(status.activeToolCount, 1);
  assert.equal(status.activeTools[0].id, 'formatter-x');
});
