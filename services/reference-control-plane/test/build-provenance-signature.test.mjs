// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0589 — build provenance an independent auditor can actually verify.
//
// The existing signature is HMAC-SHA256, and `rust/BUILD_STATUS.md` said so honestly: anyone who
// can verify it can also forge it. `PKG-001` position 5 asks for provenance an INDEPENDENT audit
// can check, and an independent auditor does not hold the build key — so that position could not
// close however correct the signature was. This suite covers the Ed25519 layer that closes it.
//
// What is asserted here, and why each row exists rather than being assumed:
//
//   · the public signature verifies with the PUBLIC key alone — the whole point;
//   · every way it can be wrong is reproduced and asserted to FAIL (the oracle);
//   · the two signatures cover BYTE-IDENTICAL payloads across the language boundary, which is
//     the property that lets both live in one document — proved against Python's own
//     serialisation rule, not against a belief about it;
//   · the envelope rule is spelled three times in two languages, so the three are compared
//     against each other HERE, because nothing else can bind them (D-0608's lesson).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  signBuildProvenance,
  signedPayload,
  assertCrossLanguageStable,
  ENVELOPE_KEYS,
} from '../../../tools/sign-build-provenance.mjs';
import {
  verifyBuildProvenance,
  ProvenanceVerificationError,
} from '../../../tools/verify-build-provenance.mjs';
import { canonicalBytes } from '../src/compliance-packs.mjs';

const toolsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tools');

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** The shape `create-rust-build-provenance.py` emits, HMAC envelope included. */
function hmacSignedDocument(overrides = {}) {
  return {
    kind: 'rust-build-provenance',
    schemaVersion: '1.0',
    release: '0.6.0',
    createdUtc: '2026-08-21T04:00:00Z',
    binaryPath: 'rust/target/release/noesar-authority-daemon',
    binarySha256: 'a'.repeat(64),
    cargoLockSha256: 'b'.repeat(64),
    sourceTreeSha256: 'c'.repeat(64),
    rustcVersion: 'rustc 1.90.0',
    cargoVersion: 'cargo 1.90.0',
    targetTriple: 'x86_64-unknown-linux-gnu',
    testsPassed: true,
    authorityConformancePassed: true,
    signatureAlgorithm: 'HMAC-SHA256',
    signingKeyId: '0123456789abcdef',
    publiclyVerifiable: false,
    signature: 'd'.repeat(64),
    ...overrides,
  };
}

test('the public signature verifies with the public key alone', () => {
  const { privatePem, publicPem } = keypair();
  const signed = signBuildProvenance(hmacSignedDocument(), privatePem);
  const result = verifyBuildProvenance(signed, publicPem);
  assert.equal(result.verified, true);
  assert.equal(result.algorithm, 'ed25519');
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
});

test('publiclyVerifiable stops being a claim the document makes about itself', () => {
  const { privatePem, publicPem } = keypair();
  const before = hmacSignedDocument();
  assert.equal(before.publiclyVerifiable, false, 'the HMAC-only document is honest that it is not');
  const after = signBuildProvenance(before, privatePem);
  assert.equal(after.publiclyVerifiable, true);

  // And the verifier never consults the field — it recomputes. Both directions, because a field
  // that is merely ignored when false and believed when true is not ignored at all.
  const lying = { ...after, publiclyVerifiable: false };
  assert.equal(verifyBuildProvenance(lying, publicPem).verified, true, 'a valid signature verifies whatever the field says');
  const boasting = { ...hmacSignedDocument(), publiclyVerifiable: true };
  assert.throws(
    () => verifyBuildProvenance(boasting, publicPem),
    (error) => error instanceof ProvenanceVerificationError && error.code === 'NO_PUBLIC_SIGNATURE',
    'claiming to be publicly verifiable must not make an unsigned document verify',
  );
});

test('ORACLE: a tampered fact makes verification fail', () => {
  const { privatePem, publicPem } = keypair();
  const signed = signBuildProvenance(hmacSignedDocument(), privatePem);
  const tampered = { ...signed, binarySha256: 'f'.repeat(64) };
  assert.throws(
    () => verifyBuildProvenance(tampered, publicPem),
    (error) => error instanceof ProvenanceVerificationError && error.code === 'SIGNATURE_MISMATCH',
    'the verifier accepted a document whose binary hash had been changed',
  );
});

test('ORACLE: a different key makes verification fail', () => {
  const { privatePem } = keypair();
  const other = keypair();
  const signed = signBuildProvenance(hmacSignedDocument(), privatePem);
  assert.throws(
    () => verifyBuildProvenance(signed, other.publicPem),
    (error) => error instanceof ProvenanceVerificationError && error.code === 'SIGNATURE_MISMATCH',
  );
});

test('ORACLE: an unsigned document is REFUSED, not quietly reported false', () => {
  const { publicPem } = keypair();
  assert.throws(
    () => verifyBuildProvenance(hmacSignedDocument(), publicPem),
    (error) => error instanceof ProvenanceVerificationError && error.code === 'NO_PUBLIC_SIGNATURE',
    'an absent signature and a wrong one must be distinguishable',
  );
});

test('ORACLE: a document signed under a different envelope is reported, not obeyed', () => {
  const { privatePem, publicPem } = keypair();
  const signed = signBuildProvenance(hmacSignedDocument(), privatePem);
  signed.publicSignature.envelopeKeys = ['signature'];
  assert.throws(
    () => verifyBuildProvenance(signed, publicPem),
    (error) => error instanceof ProvenanceVerificationError && error.code === 'ENVELOPE_MISMATCH',
  );
});

test('the signature covers facts, not the other signature: the HMAC envelope is excluded', () => {
  const { privatePem, publicPem } = keypair();
  const signed = signBuildProvenance(hmacSignedDocument(), privatePem);
  // Rewriting the symmetric envelope must not disturb the asymmetric signature — that
  // independence is what lets one document carry both.
  const rekeyed = { ...signed, signature: 'e'.repeat(64), signingKeyId: 'ffffffffffffffff' };
  assert.equal(verifyBuildProvenance(rekeyed, publicPem).verified, true);
});

test('the two signers cover byte-identical payloads across the language boundary', () => {
  // Python: json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode("utf-8")
  // Node:   canonicalBytes(signedPayload(document))  — recursive key sort, no whitespace.
  // Asserted rather than believed, because a silent divergence would mean two signatures over
  // two different documents, each verifying, neither meaning what it appears to mean.
  const payload = signedPayload(hmacSignedDocument());
  const nodeBytes = canonicalBytes(payload).toString('utf8');
  const pythonEquivalent = JSON.stringify(
    Object.fromEntries(Object.keys(payload).sort().map((k) => [k, payload[k]])),
  );
  assert.equal(nodeBytes, pythonEquivalent);
  // separators=(",", ":") means no space AFTER a separator. Values legitimately contain spaces
  // ("rustc 1.90.0"), so the assertion is about the separators, not about the whole string —
  // the first version of this row said `includes(' ')` and failed on the rustc version, which
  // is the row catching a mistake in itself rather than in the code.
  assert.equal(/[,:] /.test(nodeBytes), false, 'no space follows a separator');
  // And nesting is sorted too, not only the top level.
  const nested = canonicalBytes({ b: 1, a: { z: 1, y: 2 } }).toString('utf8');
  assert.equal(nested, '{"a":{"y":2,"z":1},"b":1}');
});

test('a non-ASCII document is refused rather than signed into a silent divergence', () => {
  // Python's json.dumps escapes non-ASCII by default; JSON.stringify does not. That is the one
  // way the two canonicalisations differ, so it is refused at the door.
  assert.throws(
    () => assertCrossLanguageStable({ note: 'provenienza — costruzione' }),
    /non-ASCII/,
  );
  assert.doesNotThrow(() => assertCrossLanguageStable({ note: 'provenance build' }));
});

test('the envelope rule agrees across all three programs that spell it', () => {
  // There is no import path between a .mjs file and two hyphenated .py scripts, so the three
  // copies are compared here. Without this row, D-0589's own repair would be a fresh instance
  // of D-0608: one rule, several spellings, nothing checking that they still agree.
  const expected = [...ENVELOPE_KEYS].sort();
  for (const file of ['create-rust-build-provenance.py', 'verify-rust-build-provenance.py']) {
    const text = fs.readFileSync(path.join(toolsDir, file), 'utf8');
    const match = text.match(/ENVELOPE_KEYS = frozenset\(\s*\{([^}]*)\}\s*\)/);
    assert.ok(match, `${file} must declare ENVELOPE_KEYS as a frozenset literal`);
    const declared = [...match[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(declared, expected, `${file} disagrees with tools/sign-build-provenance.mjs`);
  }
});

test('the envelope contains publicSignature, or the HMAC breaks the moment we counter-sign', () => {
  // The concrete failure this prevents: adding publicSignature to a document whose HMAC payload
  // rule did not exclude it changes the HMAC payload, so the symmetric signature stops verifying
  // and the document arrives carrying one valid signature and one broken one.
  assert.ok(ENVELOPE_KEYS.includes('publicSignature'));
  const { privatePem } = keypair();
  const signed = signBuildProvenance(hmacSignedDocument(), privatePem);
  assert.deepEqual(signedPayload(signed), signedPayload(hmacSignedDocument()));
});
