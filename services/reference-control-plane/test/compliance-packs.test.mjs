// SPDX-License-Identifier: AGPL-3.0-or-later
// Phase 7 step 28: signed, dated compliance packs. No Rust twin (see the module comment
// in src/compliance-packs.mjs), so this is a plain test suite, not a shared-vectors run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  CompliancePackError, loadComplianceSchema, validateCompliancePackDocument,
  checkPackDates, signCompliancePack, verifyCompliancePackSignature, canonicalBytes,
  loadCompliancePacks, compliancePacksStatus,
} from '../src/compliance-packs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const opensslAvailable = spawnSync('openssl', ['version']).status === 0;

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function samplePack(overrides = {}) {
  return {
    id:'eu-core-draft', version:'0.0.1-draft', jurisdiction:'EU',
    effective_from:'2026-01-01T00:00:00Z', review_by:'2027-01-01T00:00:00Z',
    roles:['controller'], sources:[], controls:[],
    ...overrides,
  };
}

test('loadComplianceSchema reads the tracked schema and its required fields', () => {
  const schema = loadComplianceSchema(repoRoot);
  assert.ok(schema.required.includes('jurisdiction'));
  assert.ok(schema.required.includes('review_by'));
  assert.equal(schema.additionalProperties, false);
});

test('loadComplianceSchema refuses a productRoot with no schema file', () => {
  const empty = tmpDir('noesar-compliance-empty-');
  try {
    assert.throws(() => loadComplianceSchema(empty), CompliancePackError);
  } finally { rmSync(empty, { recursive:true, force:true }); }
});

test('validateCompliancePackDocument: a well-formed pack passes', () => {
  const schema = loadComplianceSchema(repoRoot);
  const result = validateCompliancePackDocument(samplePack(), schema);
  assert.deepEqual(result, { valid:true, errors:[] });
});

test('validateCompliancePackDocument: missing required fields are named', () => {
  const schema = loadComplianceSchema(repoRoot);
  const result = validateCompliancePackDocument({}, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('"jurisdiction"')));
  assert.ok(result.errors.some((e) => e.includes('"review_by"')));
});

test('checkPackDates: a window that has not started yet is NOT_YET_EFFECTIVE', () => {
  const pack = samplePack({ effective_from:'2099-01-01T00:00:00Z', review_by:'2100-01-01T00:00:00Z' });
  const result = checkPackDates(pack, { asOf:new Date('2026-07-28T00:00:00Z') });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('NOT_YET_EFFECTIVE')));
});

test('checkPackDates: a window that has passed is EXPIRED', () => {
  const pack = samplePack({ effective_from:'2020-01-01T00:00:00Z', review_by:'2021-01-01T00:00:00Z' });
  const result = checkPackDates(pack, { asOf:new Date('2026-07-28T00:00:00Z') });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('EXPIRED')));
});

test('checkPackDates: effective_from at or after review_by is rejected even if both parse', () => {
  const pack = samplePack({ effective_from:'2026-06-01T00:00:00Z', review_by:'2026-01-01T00:00:00Z' });
  const result = checkPackDates(pack, { asOf:new Date('2026-07-28T00:00:00Z') });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('strictly before')));
});

test('checkPackDates: unparseable dates are named, not silently coerced', () => {
  const pack = samplePack({ effective_from:'not-a-date', review_by:'also-not-a-date' });
  const result = checkPackDates(pack, { asOf:new Date('2026-07-28T00:00:00Z') });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('effective_from') && e.includes('not a parseable date')));
  assert.ok(result.errors.some((e) => e.includes('review_by') && e.includes('not a parseable date')));
});

test('checkPackDates: a pack presently inside its window passes', () => {
  const pack = samplePack({ effective_from:'2026-01-01T00:00:00Z', review_by:'2027-01-01T00:00:00Z' });
  const result = checkPackDates(pack, { asOf:new Date('2026-07-28T00:00:00Z') });
  assert.deepEqual(result, { valid:true, errors:[] });
});

test('canonicalBytes excludes the signature field and sorts keys recursively', () => {
  const a = { b:1, a:{ d:2, c:3 }, signature:{ value:'x' } };
  const b = { a:{ c:3, d:2 }, b:1 };
  assert.deepEqual(canonicalBytes(a), canonicalBytes(b));
});

test('sign then verify round-trips with the matching key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type:'pkcs8', format:'pem' });
  const publicPem = publicKey.export({ type:'spki', format:'pem' });
  const signed = signCompliancePack(samplePack(), privatePem);
  assert.equal(signed.signature.algorithm, 'ed25519');
  assert.equal(typeof signed.signature.publicKeyFingerprint, 'string');
  assert.equal(verifyCompliancePackSignature(signed, publicPem), true);
});

test('verify rejects a signature made with a different key', () => {
  const pair1 = generateKeyPairSync('ed25519');
  const pair2 = generateKeyPairSync('ed25519');
  const signed = signCompliancePack(samplePack(), pair1.privateKey.export({ type:'pkcs8', format:'pem' }));
  const wrongPublicPem = pair2.publicKey.export({ type:'spki', format:'pem' });
  assert.equal(verifyCompliancePackSignature(signed, wrongPublicPem), false);
});

test('verify rejects a pack tampered with after signing', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signed = signCompliancePack(samplePack(), privateKey.export({ type:'pkcs8', format:'pem' }));
  const tampered = { ...signed, jurisdiction:'US' };
  assert.equal(
    verifyCompliancePackSignature(tampered, publicKey.export({ type:'spki', format:'pem' })),
    false,
  );
});

test('verify refuses (does not just return false) when the pack carries no signature', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  assert.throws(
    () => verifyCompliancePackSignature(samplePack(), publicKey.export({ type:'spki', format:'pem' })),
    CompliancePackError,
  );
});

test(
  'interop: a signature made by openssl pkeyutl verifies under node:crypto — same RFC 8032 scheme',
  { skip: opensslAvailable ? false : 'openssl is not on this host' },
  () => {
    const dir = tmpDir('noesar-compliance-interop-');
    try {
      const privatePath = join(dir, 'priv.pem');
      const publicPath = join(dir, 'pub.pem');
      execFileSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', privatePath]);
      execFileSync('openssl', ['pkey', '-in', privatePath, '-pubout', '-out', publicPath]);

      const pack = samplePack();
      const messagePath = join(dir, 'message.bin');
      const signaturePath = join(dir, 'signature.bin');
      writeFileSync(messagePath, canonicalBytes(pack));
      execFileSync('openssl', [
        'pkeyutl', '-sign', '-inkey', privatePath, '-rawin', '-in', messagePath, '-out', signaturePath,
      ]);

      const signedByOpenssl = {
        ...pack,
        signature: {
          algorithm:'ed25519',
          value: readFileSync(signaturePath).toString('base64'),
          publicKeyFingerprint:'n/a-interop-test',
          signedAt: new Date().toISOString(),
        },
      };
      const publicPem = readFileSync(publicPath, 'utf8');
      assert.equal(verifyCompliancePackSignature(signedByOpenssl, publicPem), true);

      // and the reverse direction: node-signed verifies via openssl pkeyutl -verify
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const nodeSigned = signCompliancePack(pack, privateKey.export({ type:'pkcs8', format:'pem' }));
      const nodePublicPath = join(dir, 'node-pub.pem');
      const nodeMessagePath = join(dir, 'node-message.bin');
      const nodeSignaturePath = join(dir, 'node-signature.bin');
      writeFileSync(nodePublicPath, publicKey.export({ type:'spki', format:'pem' }));
      writeFileSync(nodeMessagePath, canonicalBytes(pack));
      writeFileSync(nodeSignaturePath, Buffer.from(nodeSigned.signature.value, 'base64'));
      execFileSync('openssl', [
        'pkeyutl', '-verify', '-pubin', '-inkey', nodePublicPath, '-rawin',
        '-in', nodeMessagePath, '-sigfile', nodeSignaturePath,
      ]);
    } finally {
      rmSync(dir, { recursive:true, force:true });
    }
  },
);

test('loadCompliancePacks: an empty or absent directory scans to zero, does not throw', () => {
  const absent = join(tmpDir('noesar-compliance-parent-'), 'does-not-exist');
  const scan = loadCompliancePacks(repoRoot, absent);
  assert.deepEqual(scan, { scanned:0, truncated:false, valid:[], invalid:[] });
});

test('loadCompliancePacks: a valid current pack is listed valid, an expired one invalid', () => {
  const dir = tmpDir('noesar-compliance-packs-');
  try {
    const goodDir = join(dir, 'eu-core');
    mkdirSync(goodDir, { recursive:true });
    writeFileSync(join(goodDir, 'pack.json'), JSON.stringify(samplePack()));

    const expiredDir = join(dir, 'expired-pack');
    mkdirSync(expiredDir, { recursive:true });
    writeFileSync(join(expiredDir, 'pack.json'), JSON.stringify(
      samplePack({ id:'expired-pack', effective_from:'2020-01-01T00:00:00Z', review_by:'2021-01-01T00:00:00Z' }),
    ));

    const scan = loadCompliancePacks(repoRoot, dir);
    assert.equal(scan.scanned, 2);
    assert.equal(scan.valid.length, 1);
    assert.equal(scan.valid[0].id, 'eu-core');
    assert.equal(scan.invalid.length, 1);
    assert.equal(scan.invalid[0].id, 'expired-pack');
    assert.ok(scan.invalid[0].errors.some((e) => e.includes('EXPIRED')));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('loadCompliancePacks: with a public key configured, an unsigned pack is flagged', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const dir = tmpDir('noesar-compliance-unsigned-');
  try {
    const packDir = join(dir, 'unsigned');
    mkdirSync(packDir, { recursive:true });
    writeFileSync(join(packDir, 'pack.json'), JSON.stringify(samplePack()));
    const scan = loadCompliancePacks(repoRoot, dir, { publicKeyPem: publicKey.export({ type:'spki', format:'pem' }) });
    assert.equal(scan.invalid.length, 1);
    assert.ok(scan.invalid[0].errors.some((e) => e.includes('NO_SIGNATURE') || e.includes('no signature')));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('loadCompliancePacks: with a public key configured, a validly signed current pack passes', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const dir = tmpDir('noesar-compliance-signed-');
  try {
    const packDir = join(dir, 'signed');
    mkdirSync(packDir, { recursive:true });
    const signed = signCompliancePack(samplePack(), privateKey.export({ type:'pkcs8', format:'pem' }));
    writeFileSync(join(packDir, 'pack.json'), JSON.stringify(signed));
    const scan = loadCompliancePacks(repoRoot, dir, { publicKeyPem: publicKey.export({ type:'spki', format:'pem' }) });
    assert.equal(scan.valid.length, 1);
    assert.equal(scan.invalid.length, 0);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('loadCompliancePacks: maxPacks truncates and says so', () => {
  const dir = tmpDir('noesar-compliance-truncate-');
  try {
    for (let i = 0; i < 3; i += 1) {
      const packDir = join(dir, `pack-${i}`);
      mkdirSync(packDir, { recursive:true });
      writeFileSync(join(packDir, 'pack.json'), '{}');
    }
    const scan = loadCompliancePacks(repoRoot, dir, { maxPacks:2 });
    assert.equal(scan.scanned, 2);
    assert.equal(scan.truncated, true);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('compliancePacksStatus declares the schema source, the jurisdiction-matrix caveat, and that nothing is enforced', () => {
  const status = compliancePacksStatus(repoRoot, join(repoRoot, '.compliance-packs'));
  assert.equal(status.schemaLoaded, true);
  assert.equal(status.jurisdictionsWithContent, 0);
  assert.equal(status.enforced, false);
  assert.equal(status.rustTwin, false);
  assert.equal(status.signingAlgorithm, 'ed25519 (node:crypto, RFC 8032)');
});

test('compliancePacksStatus does not throw when the schema is absent, and says why', () => {
  const empty = tmpDir('noesar-compliance-status-empty-');
  try {
    const status = compliancePacksStatus(empty, join(empty, '.compliance-packs'));
    assert.equal(status.schemaLoaded, false);
    assert.ok(status.policyError);
    assert.equal(status.installedPacks, 0);
  } finally { rmSync(empty, { recursive:true, force:true }); }
});
