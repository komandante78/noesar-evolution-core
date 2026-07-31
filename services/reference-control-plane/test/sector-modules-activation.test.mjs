// SPDX-License-Identifier: AGPL-3.0-or-later
// D-0274: activation. install()/activate()/deactivate() turn a validated candidate into a
// persisted lifecycle state, gated the same way ARCH-005 gates every other adapter (a
// spent capability token, not a self-granted one). These tests exercise that gate plus
// the risk classification and signature checks a high-risk activation additionally needs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { TokenMinter } from '../src/capability.mjs';
import { AdapterGrantOrchestrator } from '../src/adapter-capability.mjs';
import { PublisherRegistry } from '../src/publisher-registry.mjs';
import {
  SectorModuleError, classifyModuleRisk, checkPolicyConsistency, loadPermissionCatalog,
  loadTrustLevelPolicy, installSectorModule, activateSectorModule, deactivateSectorModule,
  loadModuleState, readInstalledManifest, signSectorModuleManifest,
  verifySectorModuleManifestSignature,
} from '../src/sector-modules.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function tmpDir(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }

function fresh() {
  const minter = new TokenMinter(Buffer.alloc(32, 5));
  const grants = new AdapterGrantOrchestrator({ minter });
  const sectorModulesRoot = tmpDir('noesar-sector-activation-');
  return { minter, grants, sectorModulesRoot };
}

/** ARCH-005: the same request()->approve() flow a real operator session would drive. */
function grantWrite(grants, nowUnix = 1_000_000) {
  const { runId } = grants.request({ resource: 'sector-modules', operation: 'WRITE', actor: 'test-operator', nowUnix });
  const { token } = grants.approve({ runId, approverId: 'test-owner', nowUnix });
  return token;
}

function lowRiskManifest(id = 'customer.private.test-module') {
  return {
    id, version: '0.1.0', publisher: 'customer.private', trust_level: 'customer-private',
    sector: ['scientific-research'], intended_use: ['internal research workflow support'],
    excluded_use: ['clinical diagnosis'], permissions: ['filesystem.read.project'], evidence: [],
  };
}

function highRiskManifest(id = 'noesar.official.test-module', overrides = {}) {
  return {
    id, version: '0.1.0', publisher: 'noesar', trust_level: 'noesar-official',
    sector: ['scientific-research'], intended_use: ['internal validation'],
    excluded_use: ['physical actuation'], permissions: ['filesystem.write.project'],
    evidence: [{ kind: 'internal-review', ref: 'REVIEW-1' }],
    human_oversight: { required: true, decisionAuthority: 'owner', overrideAvailable: true },
    ...overrides,
  };
}

test('classifyModuleRisk: filesystem.read.project alone is not elevated, anything else is', () => {
  assert.equal(classifyModuleRisk(lowRiskManifest()).highRisk, false);
  const risk = classifyModuleRisk(highRiskManifest());
  assert.equal(risk.highRisk, true);
  assert.deepEqual(risk.elevatedPermissions, ['filesystem.write.project']);
});

test('checkPolicyConsistency refuses physical.actuate for any trust level, by catalog not by name', () => {
  const trustLevels = loadTrustLevelPolicy(repoRoot);
  const permissionCatalog = loadPermissionCatalog(repoRoot);
  const result = checkPolicyConsistency(
    { trust_level: 'noesar-official', permissions: ['physical.actuate'] },
    { trustLevels, permissionCatalog },
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join(';'), /not available in the core/);
});

test('install -> activate -> deactivate, low-risk module, full lifecycle', () => {
  const { minter, grants, sectorModulesRoot } = fresh();
  try {
    const manifest = lowRiskManifest();
    const installed = installSectorModule({
      productRoot: repoRoot, sectorModulesRoot, id: manifest.id, candidate: manifest,
      minter, capabilityToken: grantWrite(grants), nowUnix: 1_000_000,
    });
    assert.equal(installed.id, manifest.id);
    assert.equal(loadModuleState(sectorModulesRoot, manifest.id).status, 'installed');

    const activated = activateSectorModule({
      productRoot: repoRoot, sectorModulesRoot, id: manifest.id,
      minter, capabilityToken: grantWrite(grants), approverId: 'owner-1', nowUnix: 1_000_100,
    });
    assert.equal(activated.status, 'active');
    assert.equal(activated.highRisk, false);
    assert.equal(loadModuleState(sectorModulesRoot, manifest.id).status, 'active');

    const deactivated = deactivateSectorModule({
      sectorModulesRoot, id: manifest.id, minter, capabilityToken: grantWrite(grants),
      approverId: 'owner-1', nowUnix: 1_000_200, reason: 'test teardown',
    });
    assert.equal(deactivated.status, 'installed');
    const finalState = loadModuleState(sectorModulesRoot, manifest.id);
    assert.equal(finalState.status, 'installed');
    assert.equal(finalState.history.length, 3);
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('install refuses without a valid capability token — the provider does not self-authorize', () => {
  const { sectorModulesRoot } = fresh();
  try {
    assert.throws(
      () => installSectorModule({
        productRoot: repoRoot, sectorModulesRoot, id: 'x.y', candidate: lowRiskManifest('x.y'),
        minter: null, capabilityToken: null, nowUnix: 1,
      }),
      (error) => error instanceof SectorModuleError && error.kind === 'NO_CAPABILITY_ENGINE',
    );
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('install with a real minter but a null token (the value every unauthenticated/ungranted caller sends) refuses cleanly, not a raw TypeError', () => {
  const { minter, sectorModulesRoot } = fresh();
  try {
    assert.throws(
      () => installSectorModule({
        productRoot: repoRoot, sectorModulesRoot, id: 'x.y', candidate: lowRiskManifest('x.y'),
        minter, capabilityToken: null, nowUnix: 1_000_000,
      }),
      (error) => error instanceof SectorModuleError && error.kind === 'NOT_AUTHORIZED',
    );
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('install refuses a forged/unspendable token the same way capability.mjs refuses it elsewhere', () => {
  const { minter, sectorModulesRoot } = fresh();
  try {
    const forged = { id: 'nope', mac: 'not-a-real-mac', paths: ['adapter://sector-modules/write'], operations: ['WRITE'], expiresAtUnix: 9_999_999_999, usesGranted: 1 };
    assert.throws(
      () => installSectorModule({
        productRoot: repoRoot, sectorModulesRoot, id: 'x.y', candidate: lowRiskManifest('x.y'),
        minter, capabilityToken: forged, nowUnix: 1_000_000,
      }),
      (error) => error instanceof SectorModuleError && error.kind === 'NOT_AUTHORIZED',
    );
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('install refuses id/manifest mismatch, an invalid manifest, and a repeat install', () => {
  const { minter, grants, sectorModulesRoot } = fresh();
  try {
    const manifest = lowRiskManifest();
    assert.throws(
      () => installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: 'different-id', candidate: manifest, minter, capabilityToken: grantWrite(grants), nowUnix: 1 }),
      (error) => error instanceof SectorModuleError && error.kind === 'ID_MISMATCH',
    );
    assert.throws(
      () => installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, candidate: { ...manifest, trust_level: 'not-a-real-level' }, minter, capabilityToken: grantWrite(grants), nowUnix: 1 }),
      (error) => error instanceof SectorModuleError && error.kind === 'INVALID_MANIFEST',
    );
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, candidate: manifest, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, candidate: manifest, minter, capabilityToken: grantWrite(grants), nowUnix: 2 }),
      (error) => error instanceof SectorModuleError && error.kind === 'ALREADY_INSTALLED',
    );
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('activate refuses a module that was never installed, and one already active', () => {
  const { minter, grants, sectorModulesRoot } = fresh();
  try {
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: 'ghost', minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 1 }),
      (error) => error instanceof SectorModuleError && error.kind === 'NOT_FOUND',
    );
    const manifest = lowRiskManifest();
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, candidate: manifest, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 3 }),
      (error) => error instanceof SectorModuleError && error.kind === 'ALREADY_ACTIVE',
    );
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('deactivate refuses a module that is not active', () => {
  const { minter, grants, sectorModulesRoot } = fresh();
  try {
    const manifest = lowRiskManifest();
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, candidate: manifest, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => deactivateSectorModule({ sectorModulesRoot, id: manifest.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2 }),
      (error) => error instanceof SectorModuleError && error.kind === 'NOT_ACTIVE',
    );
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('a customer-private module can never activate an elevated permission — trust level ineligible', () => {
  const { minter, grants, sectorModulesRoot } = fresh();
  try {
    const manifest = { ...lowRiskManifest('customer.private.elevated'), permissions: ['filesystem.write.project'], evidence: [{ kind: 'x' }], human_oversight: { required: true } };
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, candidate: manifest, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2 }),
      (error) => error instanceof SectorModuleError && error.kind === 'INELIGIBLE_TRUST_LEVEL',
    );
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('a high-risk module refuses activation missing evidence, oversight, an unsigned manifest, an unwired registry, an untrusted key, or a wrong trust level — each named distinctly, then succeeds with a registered key', () => {
  const { minter, grants, sectorModulesRoot } = fresh();
  const registryRoot = tmpDir('noesar-publisher-registry-');
  let liveRegistryRoot = null;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const otherKeyPem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  try {
    const noEvidence = highRiskManifest('noesar.official.no-evidence', { evidence: [] });
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: noEvidence.id, candidate: noEvidence, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: noEvidence.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2 }),
      (error) => error instanceof SectorModuleError && error.kind === 'MISSING_EVIDENCE',
    );

    const noOversight = highRiskManifest('noesar.official.no-oversight', { human_oversight: { required: false } });
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: noOversight.id, candidate: noOversight, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: noOversight.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2 }),
      (error) => error instanceof SectorModuleError && error.kind === 'MISSING_HUMAN_OVERSIGHT',
    );

    const unsigned = highRiskManifest('noesar.official.unsigned');
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: unsigned.id, candidate: unsigned, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: unsigned.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2 }),
      (error) => error instanceof SectorModuleError && error.kind === 'SIGNATURE_INVALID',
    );

    const signedNoRegistry = signSectorModuleManifest(highRiskManifest('noesar.official.no-registry'), privateKeyPem);
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: signedNoRegistry.id, candidate: signedNoRegistry, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: signedNoRegistry.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2, publisherRegistry: null }),
      (error) => error instanceof SectorModuleError && error.kind === 'NO_PUBLISHER_REGISTRY',
    );

    const registry = new PublisherRegistry({ root: registryRoot });
    const untrusted = signSectorModuleManifest(highRiskManifest('noesar.official.untrusted-key'), privateKeyPem);
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: untrusted.id, candidate: untrusted, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: untrusted.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2, publisherRegistry: registry }),
      (error) => error instanceof SectorModuleError && error.kind === 'PUBLISHER_KEY_NOT_TRUSTED',
      'a key nobody registered must not verify anything, however well-formed the signature is',
    );

    // otherKeyPem stays unused as a signing key on purpose: registering it and then
    // signing with privateKeyPem proves the registry is actually consulted by
    // fingerprint, not merely "is some key on file".
    registry.registerKey({ publisherId: 'other-publisher', trustLevel: 'noesar-official', publicKeyPem: otherKeyPem, actorId: 'owner-1', nowUnix: 1 });
    registry.registerKey({ publisherId: 'noesar', trustLevel: 'certified-partner', publicKeyPem, actorId: 'owner-1', nowUnix: 1 });
    const wrongLevel = signSectorModuleManifest(highRiskManifest('noesar.official.wrong-registered-level'), privateKeyPem);
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: wrongLevel.id, candidate: wrongLevel, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: wrongLevel.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2, publisherRegistry: registry }),
      (error) => error instanceof SectorModuleError && error.kind === 'PUBLISHER_KEY_NOT_TRUSTED',
      'noesar is registered at certified-partner, not noesar-official — the manifest\'s own declared level must match',
    );

    registry.setTrustLevel({ publisherId: 'noesar', trustLevel: 'noesar-official', actorId: 'owner-1', nowUnix: 1 });
    const revoked = signSectorModuleManifest(highRiskManifest('noesar.official.revoked-key'), privateKeyPem);
    const fingerprint = revoked.signature.publicKeyFingerprint;
    registry.revoke({ publisherId: 'noesar', fingerprint, actorId: 'owner-1', nowUnix: 1 });
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: revoked.id, candidate: revoked, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.throws(
      () => activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: revoked.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2, publisherRegistry: registry }),
      (error) => error instanceof SectorModuleError && error.kind === 'PUBLISHER_KEY_NOT_TRUSTED',
      'a revoked key must not verify anything, even though it was active a moment ago',
    );

    // Re-register the same key fresh (a new registry instance, clean state) for the
    // success path, so this assertion is not order-dependent on the revoke() above.
    liveRegistryRoot = tmpDir('noesar-publisher-registry-live-');
    const liveRegistry = new PublisherRegistry({ root: liveRegistryRoot });
    liveRegistry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem, actorId: 'owner-1', nowUnix: 1 });
    const signed = signSectorModuleManifest(highRiskManifest('noesar.official.signed'), privateKeyPem);
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: signed.id, candidate: signed, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    const activated = activateSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: signed.id, minter, capabilityToken: grantWrite(grants), approverId: 'o', nowUnix: 2, publisherRegistry: liveRegistry });
    assert.equal(activated.status, 'active');
    assert.equal(activated.highRisk, true);
  } finally {
    rmSync(sectorModulesRoot, { recursive:true, force:true });
    rmSync(registryRoot, { recursive:true, force:true });
    if (liveRegistryRoot) rmSync(liveRegistryRoot, { recursive:true, force:true });
  }
});

test('signSectorModuleManifest/verifySectorModuleManifestSignature round-trip, and reject tampering', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const signed = signSectorModuleManifest(highRiskManifest(), privateKeyPem);
  assert.equal(verifySectorModuleManifestSignature(signed, publicKeyPem), true);
  const tampered = { ...signed, permissions: [...signed.permissions, 'shell.execute'] };
  assert.equal(verifySectorModuleManifestSignature(tampered, publicKeyPem), false);
  assert.throws(
    () => verifySectorModuleManifestSignature(highRiskManifest(), publicKeyPem),
    (error) => error instanceof SectorModuleError && error.kind === 'NO_SIGNATURE',
  );
});

test('readInstalledManifest peeks without validating or throwing on absence', () => {
  const { minter, grants, sectorModulesRoot } = fresh();
  try {
    assert.equal(readInstalledManifest(sectorModulesRoot, 'nothing.here'), null);
    const manifest = lowRiskManifest();
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifest.id, candidate: manifest, minter, capabilityToken: grantWrite(grants), nowUnix: 1 });
    assert.deepEqual(readInstalledManifest(sectorModulesRoot, manifest.id), manifest);
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});

test('a CapabilityError from a reused (already-spent) token surfaces as NOT_AUTHORIZED, not a crash', () => {
  const { minter, grants, sectorModulesRoot } = fresh();
  try {
    const token = grantWrite(grants);
    const manifestA = lowRiskManifest('a.one');
    installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifestA.id, candidate: manifestA, minter, capabilityToken: token, nowUnix: 1 });
    const manifestB = lowRiskManifest('a.two');
    assert.throws(
      () => installSectorModule({ productRoot: repoRoot, sectorModulesRoot, id: manifestB.id, candidate: manifestB, minter, capabilityToken: token, nowUnix: 2 }),
      (error) => error instanceof SectorModuleError && error.kind === 'NOT_AUTHORIZED',
    );
  } finally { rmSync(sectorModulesRoot, { recursive:true, force:true }); }
});
