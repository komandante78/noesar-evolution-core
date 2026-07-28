// SPDX-License-Identifier: AGPL-3.0-or-later
// Phase 7 step 29: technology radar. No Rust twin (see the module comment in
// src/technology-radar.mjs), so this is a plain test suite, not a shared-vectors run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import {
  TechnologyRadarError, loadRadarSchema, loadRadarSeed, validateRadarEntry,
  checkRingTransition, signRadarEntry, verifyRadarEntrySignature,
  loadTechnologyRadar, technologyRadarStatus,
} from '../src/technology-radar.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function sampleEntry(overrides = {}) {
  return { name:'Example runtime', ring:'trial', domain:'runtime', ...overrides };
}

test('loadRadarSchema reads the tracked schema and its rings enum', () => {
  const schema = loadRadarSchema(repoRoot);
  assert.deepEqual(schema.properties.ring.enum, ['adopt', 'trial', 'assess', 'hold', 'deprecated', 'revoked']);
});

test('loadRadarSchema refuses a productRoot with no schema file', () => {
  const empty = tmpDir('noesar-radar-empty-');
  try {
    assert.throws(() => loadRadarSchema(empty), TechnologyRadarError);
  } finally { rmSync(empty, { recursive:true, force:true }); }
});

test('loadRadarSeed reads the tracked 15 real entries', () => {
  const seed = loadRadarSeed(repoRoot);
  assert.equal(seed.items.length, 15);
  assert.ok(seed.items.some((item) => item.name === 'Rust security authority' && item.ring === 'adopt'));
  assert.ok(seed.items.every((item) => ['adopt', 'trial', 'assess', 'hold', 'deprecated', 'revoked'].includes(item.ring)));
});

test('validateRadarEntry: a well-formed entry passes', () => {
  const schema = loadRadarSchema(repoRoot);
  assert.deepEqual(validateRadarEntry(sampleEntry(), schema), { valid:true, errors:[] });
});

test('validateRadarEntry: an unknown ring value is rejected', () => {
  const schema = loadRadarSchema(repoRoot);
  const result = validateRadarEntry(sampleEntry({ ring:'not-a-real-ring' }), schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('ring')));
});

test('validateRadarEntry: every seed item validates against the new schema', () => {
  const schema = loadRadarSchema(repoRoot);
  const seed = loadRadarSeed(repoRoot);
  for (const item of seed.items) {
    const result = validateRadarEntry(item, schema);
    assert.deepEqual(result, { valid:true, errors:[] }, `seed item "${item.name}" should validate`);
  }
});

test('checkRingTransition: revoked is terminal', () => {
  const result = checkRingTransition('revoked', 'adopt');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('terminal')));
});

test('checkRingTransition: revoked to revoked (no-op) is allowed', () => {
  assert.deepEqual(checkRingTransition('revoked', 'revoked'), { valid:true, errors:[] });
});

test('checkRingTransition: an ordinary transition between known rings is allowed', () => {
  assert.deepEqual(checkRingTransition('assess', 'trial'), { valid:true, errors:[] });
  assert.deepEqual(checkRingTransition('adopt', 'deprecated'), { valid:true, errors:[] });
});

test('checkRingTransition: an unknown ring name on either side is named', () => {
  const result = checkRingTransition('assess', 'not-a-ring');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('not-a-ring')));
});

test('sign then verify round-trips, reusing compliance-packs.mjs canonicalization', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signed = signRadarEntry(sampleEntry(), privateKey.export({ type:'pkcs8', format:'pem' }));
  assert.equal(signed.signature.algorithm, 'ed25519');
  assert.equal(verifyRadarEntrySignature(signed, publicKey.export({ type:'spki', format:'pem' })), true);
});

test('verify rejects a tampered entry', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signed = signRadarEntry(sampleEntry(), privateKey.export({ type:'pkcs8', format:'pem' }));
  const tampered = { ...signed, ring:'adopt' };
  assert.equal(verifyRadarEntrySignature(tampered, publicKey.export({ type:'spki', format:'pem' })), false);
});

test('verify refuses when the entry carries no signature', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  assert.throws(
    () => verifyRadarEntrySignature(sampleEntry(), publicKey.export({ type:'spki', format:'pem' })),
    TechnologyRadarError,
  );
});

test('loadTechnologyRadar: an empty or absent directory scans to zero, does not throw', () => {
  const absent = join(tmpDir('noesar-radar-parent-'), 'does-not-exist');
  const scan = loadTechnologyRadar(repoRoot, absent);
  assert.deepEqual(scan, { scanned:0, truncated:false, valid:[], invalid:[] });
});

test('loadTechnologyRadar: an unsigned entry is valid without a configured key, invalid with one', () => {
  const dir = tmpDir('noesar-radar-entries-');
  try {
    const entryDir = join(dir, 'example-runtime');
    mkdirSync(entryDir, { recursive:true });
    writeFileSync(join(entryDir, 'entry.json'), JSON.stringify(sampleEntry()));

    const unkeyed = loadTechnologyRadar(repoRoot, dir);
    assert.equal(unkeyed.valid.length, 1);

    const { publicKey } = generateKeyPairSync('ed25519');
    const keyed = loadTechnologyRadar(repoRoot, dir, { publicKeyPem: publicKey.export({ type:'spki', format:'pem' }) });
    assert.equal(keyed.invalid.length, 1);
    assert.ok(keyed.invalid[0].errors.some((e) => e.includes('NO_SIGNATURE') || e.includes('no signature')));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('loadTechnologyRadar: maxEntries truncates and says so', () => {
  const dir = tmpDir('noesar-radar-truncate-');
  try {
    for (let i = 0; i < 3; i += 1) {
      const entryDir = join(dir, `entry-${i}`);
      mkdirSync(entryDir, { recursive:true });
      writeFileSync(join(entryDir, 'entry.json'), '{}');
    }
    const scan = loadTechnologyRadar(repoRoot, dir, { maxEntries:2 });
    assert.equal(scan.scanned, 2);
    assert.equal(scan.truncated, true);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('technologyRadarStatus reports the seed summary by ring and declares nothing is enforced', () => {
  const status = technologyRadarStatus(repoRoot, join(repoRoot, '.technology-radar'));
  assert.equal(status.schemaLoaded, true);
  assert.equal(status.seedCount, 15);
  assert.equal(status.seedByRing.adopt, 5);
  assert.equal(status.seedByRing.trial, 6);
  assert.equal(status.seedByRing.assess, 4);
  assert.equal(status.enforced, false);
  assert.equal(status.rustTwin, false);
});

test('technologyRadarStatus does not throw when nothing is readable, and says why', () => {
  const empty = tmpDir('noesar-radar-status-empty-');
  try {
    const status = technologyRadarStatus(empty, join(empty, '.technology-radar'));
    assert.equal(status.schemaLoaded, false);
    assert.ok(status.policyError);
    assert.equal(status.seedCount, 0);
    assert.equal(status.liveEntries, 0);
  } finally { rmSync(empty, { recursive:true, force:true }); }
});
