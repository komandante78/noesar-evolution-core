// SPDX-License-Identifier: AGPL-3.0-or-later
// D-0275: trusted publisher registry — docs/capabilities/PUBLISHER_REVOCATION.md's exact
// schema (publisher ID, trust level, public-key path, SHA-256 fingerprint, active/revoked
// state, registering Owner, registration timestamp), plus rotation and both revocation
// grains (a single key, or every key a publisher holds).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { PublisherRegistry, PublisherRegistryError } from '../src/publisher-registry.mjs';

function tmpDir(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }
function keyPem() { return generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }); }

test('registerKey creates a publisher on first call, and status() reports every field the spec names', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const registry = new PublisherRegistry({ root });
    const pem = keyPem();
    const result = registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: pem, actorId: 'owner-1', nowUnix: 1000 });
    assert.equal(result.publisherId, 'noesar');
    assert.equal(result.trustLevel, 'noesar-official');
    assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
    assert.ok(result.keyPath.includes('noesar'));
    assert.equal(readFileSync(result.keyPath, 'utf8'), pem);

    const status = registry.status();
    assert.equal(status.publisherCount, 1);
    assert.equal(status.activeKeyCount, 1);
    assert.equal(status.revokedKeyCount, 0);
    const [publisher] = status.publishers;
    assert.equal(publisher.publisherId, 'noesar');
    assert.equal(publisher.trustLevel, 'noesar-official');
    assert.equal(publisher.registeredBy, 'owner-1');
    assert.equal(publisher.registeredAtUnix, 1000);
    assert.equal(publisher.keys[0].fingerprint, result.fingerprint);
    assert.equal(publisher.keys[0].state, 'active');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a second registerKey for the same publisher is a rotation — the old key stays active until an explicit revoke', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const registry = new PublisherRegistry({ root });
    const first = registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 1 });
    const second = registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 2 });
    assert.notEqual(first.fingerprint, second.fingerprint);
    const status = registry.status();
    assert.equal(status.publisherCount, 1);
    assert.equal(status.activeKeyCount, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('registerKey refuses the same fingerprint twice, an invalid publisher id, a private key, and a rotation at a different trust level without setTrustLevel', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const registry = new PublisherRegistry({ root });
    const pem = keyPem();
    registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: pem, actorId: 'o', nowUnix: 1 });
    assert.throws(
      () => registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: pem, actorId: 'o', nowUnix: 2 }),
      (error) => error instanceof PublisherRegistryError && error.kind === 'KEY_ALREADY_REGISTERED',
    );
    assert.throws(
      () => registry.registerKey({ publisherId: 'N', trustLevel: 'noesar-official', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 1 }),
      (error) => error instanceof PublisherRegistryError && error.kind === 'INVALID_PUBLISHER_ID',
    );
    const { privateKey } = generateKeyPairSync('ed25519');
    assert.throws(
      () => registry.registerKey({ publisherId: 'other', trustLevel: 'noesar-official', publicKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), actorId: 'o', nowUnix: 1 }),
      (error) => error instanceof PublisherRegistryError && error.kind === 'PRIVATE_KEY_REFUSED',
    );
    assert.throws(
      () => registry.registerKey({ publisherId: 'noesar', trustLevel: 'community', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 3 }),
      (error) => error instanceof PublisherRegistryError && error.kind === 'TRUST_LEVEL_MISMATCH',
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('revoke(fingerprint) revokes one key; revoke() with no fingerprint revokes every active key; both are idempotent', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const registry = new PublisherRegistry({ root });
    const a = registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 1 });
    const b = registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 2 });

    const oneKey = registry.revoke({ publisherId: 'noesar', fingerprint: a.fingerprint, actorId: 'o', nowUnix: 3, reason: 'rotated out' });
    assert.equal(oneKey.revokedCount, 1);
    assert.equal(registry.status().activeKeyCount, 1);

    const again = registry.revoke({ publisherId: 'noesar', fingerprint: a.fingerprint, actorId: 'o', nowUnix: 4 });
    assert.equal(again.revokedCount, 0, 'revoking an already-revoked key is a no-op, not an error');

    const all = registry.revoke({ publisherId: 'noesar', actorId: 'o', nowUnix: 5, reason: 'publisher compromised' });
    assert.equal(all.revokedCount, 1);
    assert.equal(registry.status().activeKeyCount, 0);
    assert.equal(registry.status().revokedKeyCount, 2);
    void b;
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('revoke refuses an unknown publisher or an unknown fingerprint', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const registry = new PublisherRegistry({ root });
    assert.throws(
      () => registry.revoke({ publisherId: 'ghost', actorId: 'o', nowUnix: 1 }),
      (error) => error instanceof PublisherRegistryError && error.kind === 'UNKNOWN_PUBLISHER',
    );
    registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 1 });
    assert.throws(
      () => registry.revoke({ publisherId: 'noesar', fingerprint: 'deadbeef', actorId: 'o', nowUnix: 2 }),
      (error) => error instanceof PublisherRegistryError && error.kind === 'UNKNOWN_KEY',
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('findActiveKey checks fingerprint, active state, AND the declared trust level — a self-declared level cannot ride on a key registered at another', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const registry = new PublisherRegistry({ root });
    const key = registry.registerKey({ publisherId: 'noesar', trustLevel: 'certified-partner', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 1 });

    assert.equal(registry.findActiveKey({ publisherId: 'ghost', fingerprint: key.fingerprint }), null);
    assert.equal(registry.findActiveKey({ publisherId: 'noesar', fingerprint: 'deadbeef' }), null);
    assert.equal(registry.findActiveKey({ publisherId: 'noesar', fingerprint: key.fingerprint, declaredTrustLevel: 'noesar-official' }), null);
    const found = registry.findActiveKey({ publisherId: 'noesar', fingerprint: key.fingerprint, declaredTrustLevel: 'certified-partner' });
    assert.ok(found);
    assert.equal(found.trustLevel, 'certified-partner');

    registry.revoke({ publisherId: 'noesar', fingerprint: key.fingerprint, actorId: 'o', nowUnix: 2 });
    assert.equal(registry.findActiveKey({ publisherId: 'noesar', fingerprint: key.fingerprint, declaredTrustLevel: 'certified-partner' }), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setTrustLevel changes what a rotation must match, and is its own explicit call — never a side effect of registerKey', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const registry = new PublisherRegistry({ root });
    registry.registerKey({ publisherId: 'noesar', trustLevel: 'certified-partner', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 1 });
    assert.throws(() => registry.setTrustLevel({ publisherId: 'ghost', trustLevel: 'noesar-official', actorId: 'o', nowUnix: 1 }), PublisherRegistryError);
    registry.setTrustLevel({ publisherId: 'noesar', trustLevel: 'noesar-official', actorId: 'o', nowUnix: 2 });
    assert.equal(registry.status().publishers[0].trustLevel, 'noesar-official');
    // Now a rotation at the NEW level succeeds — it would have refused before the change.
    const rotated = registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: keyPem(), actorId: 'o', nowUnix: 3 });
    assert.equal(rotated.trustLevel, 'noesar-official');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('state survives across instances — a fresh PublisherRegistry over the same root reads back what a prior one wrote', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const pem = keyPem();
    const first = new PublisherRegistry({ root });
    const registered = first.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: pem, actorId: 'o', nowUnix: 1 });
    const second = new PublisherRegistry({ root });
    const found = second.findActiveKey({ publisherId: 'noesar', fingerprint: registered.fingerprint, declaredTrustLevel: 'noesar-official' });
    assert.ok(found);
    assert.equal(found.publicKeyPem, pem);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('registerKey rejects a malformed public key up front, before writing any file', () => {
  const root = tmpDir('noesar-publisher-registry-');
  try {
    const registry = new PublisherRegistry({ root });
    assert.throws(
      () => registry.registerKey({ publisherId: 'noesar', trustLevel: 'noesar-official', publicKeyPem: 'not a key', actorId: 'o', nowUnix: 1 }),
      (error) => error instanceof PublisherRegistryError && error.kind === 'BAD_PUBLIC_KEY',
    );
    assert.equal(registry.status().publisherCount, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
