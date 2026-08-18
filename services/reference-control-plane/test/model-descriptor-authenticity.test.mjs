// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0521` — the descriptor chain, as tests.
//
// Every assertion here is about a REFUSAL, because that is where this file earns its keep: a
// verifier that accepts a genuine signature and also accepts a forged one passes the happy path
// perfectly. So each test alters exactly one thing — a byte of the document, the fingerprint,
// the publisher, the key's state — and requires the answer to change.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublisherRegistry } from '../src/publisher-registry.mjs';
import {
  DescriptorAuthenticity, signModelDescriptor, verifyModelDescriptor,
  authenticitySummary, publicKeyFingerprint, canonicalDescriptorBytes,
} from '../src/model-descriptor-authenticity.mjs';

const NOW = 1_760_000_000;
const roots = [];
function registryWithKey({ publisherId = 'acme', trustLevel = 'community' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'noesar-desc-auth-'));
  roots.push(root);
  const registry = new PublisherRegistry({ root });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  registry.registerKey({
    publisherId, trustLevel,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    actorId: 'test', nowUnix: NOW,
  });
  return {
    registry,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: publicKeyFingerprint(publicKey),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
test.after(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

const descriptor = (extra = {}) => ({
  id: 'acme/tiny-1b', version: '1', publisher: 'acme', license: 'apache-2.0',
  source: 'https://models.example/tiny.gguf', hashes: { sha256: 'a'.repeat(64) },
  formats: ['gguf'], workloads: ['text'], resource_profiles: [], ...extra,
});

describe('a descriptor its publisher really signed', () => {
  test('verifies, and names the key it verified under', () => {
    const { registry, privateKeyPem, fingerprint } = registryWithKey();
    const result = verifyModelDescriptor({ descriptor: signModelDescriptor(descriptor(), privateKeyPem), registry });
    assert.equal(result.verified, true);
    assert.equal(result.publisherId, 'acme');
    assert.equal(result.fingerprint, fingerprint);
    assert.equal(result.trustLevel, 'community');
  });

  test('the signature covers the fields the rest of the product trusts', () => {
    // The point of the whole file: `source` and `hashes.sha256` are inside the signed bytes.
    const { privateKeyPem } = registryWithKey();
    const signed = signModelDescriptor(descriptor(), privateKeyPem);
    const bytes = canonicalDescriptorBytes(signed).toString('utf8');
    assert.match(bytes, /models\.example/);
    assert.match(bytes, /"sha256":"a{64}"/);
    assert.doesNotMatch(bytes, /"signature"/, 'the signature must not be inside its own input');
  });
});

describe('every way a descriptor can fail to be authentic', () => {
  test('one altered byte of the SOURCE breaks it — the field that decides where bytes come from', () => {
    const { registry, privateKeyPem } = registryWithKey();
    const signed = signModelDescriptor(descriptor(), privateKeyPem);
    const tampered = { ...signed, source: 'https://attacker.example/tiny.gguf' };
    const result = verifyModelDescriptor({ descriptor: tampered, registry });
    assert.equal(result.verified, false);
    assert.equal(result.kind, DescriptorAuthenticity.SIGNATURE_INVALID);
  });

  test('one altered byte of the DIGEST breaks it — the field every later guarantee rests on', () => {
    const { registry, privateKeyPem } = registryWithKey();
    const signed = signModelDescriptor(descriptor(), privateKeyPem);
    const tampered = { ...signed, hashes: { sha256: 'b'.repeat(64) } };
    assert.equal(verifyModelDescriptor({ descriptor: tampered, registry }).kind, DescriptorAuthenticity.SIGNATURE_INVALID);
  });

  test('an unsigned descriptor is refused as unsigned, not as invalid', () => {
    const { registry } = registryWithKey();
    assert.equal(verifyModelDescriptor({ descriptor: descriptor(), registry }).kind, DescriptorAuthenticity.NO_SIGNATURE);
  });

  test('a signature by a key this installation never registered is not trusted', () => {
    const { registry } = registryWithKey();
    const stranger = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const result = verifyModelDescriptor({ descriptor: signModelDescriptor(descriptor(), stranger), registry });
    assert.equal(result.kind, DescriptorAuthenticity.KEY_NOT_TRUSTED);
  });

  test('a REVOKED key stops verifying documents it already signed', () => {
    // The reason the registry is consulted on every read rather than cached at import: a
    // revocation that only applies to future imports is not a revocation.
    const { registry, privateKeyPem, fingerprint } = registryWithKey();
    const signed = signModelDescriptor(descriptor(), privateKeyPem);
    assert.equal(verifyModelDescriptor({ descriptor: signed, registry }).verified, true);
    registry.revoke({ publisherId: 'acme', fingerprint, actorId: 'owner', nowUnix: NOW + 1, reason: 'compromised' });
    assert.equal(verifyModelDescriptor({ descriptor: signed, registry }).kind, DescriptorAuthenticity.KEY_NOT_TRUSTED);
  });

  test('a signature attributed to a different publisher than the one that holds the key', () => {
    const { registry, privateKeyPem } = registryWithKey();
    const signed = signModelDescriptor(descriptor(), privateKeyPem);
    const reattributed = { ...signed, publisher: 'someone-else' };
    assert.equal(verifyModelDescriptor({ descriptor: reattributed, registry }).kind, DescriptorAuthenticity.KEY_NOT_TRUSTED);
  });

  test('no registry at all is refused, never treated as "nothing to check"', () => {
    const { privateKeyPem } = registryWithKey();
    const result = verifyModelDescriptor({ descriptor: signModelDescriptor(descriptor(), privateKeyPem), registry: null });
    assert.equal(result.kind, DescriptorAuthenticity.NO_REGISTRY);
  });

  test('an algorithm this installation does not verify is refused rather than assumed', () => {
    const { registry, privateKeyPem } = registryWithKey();
    const signed = signModelDescriptor(descriptor(), privateKeyPem);
    signed.signature.algorithm = 'rsa-pkcs1';
    assert.equal(verifyModelDescriptor({ descriptor: signed, registry }).kind, DescriptorAuthenticity.SIGNATURE_INVALID);
  });
});

describe('the summary the page and the catalogue carry', () => {
  test('an unverified descriptor gets a summary that SAYS so — never an absent field', () => {
    const summary = authenticitySummary(verifyModelDescriptor({ descriptor: descriptor(), registry: null }));
    assert.equal(summary.verified, false);
    assert.equal(summary.signedBy, null);
    assert.ok(summary.reason.length > 0, 'a refusal must carry its reason to the surface');
  });

  test('a verified one names the publisher, so a person reads WHO rather than a tick', () => {
    const { registry, privateKeyPem } = registryWithKey();
    const summary = authenticitySummary(verifyModelDescriptor({ descriptor: signModelDescriptor(descriptor(), privateKeyPem), registry }));
    assert.equal(summary.verified, true);
    assert.equal(summary.signedBy, 'acme');
    assert.equal(summary.trustLevel, 'community');
  });
});
