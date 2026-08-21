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
import crypto, { generateKeyPairSync } from 'node:crypto';
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

// ── D-0622 · custody is the operator's choice, and both backends are real ──────────────────────
//
// The Owner was asked where the durable release key should live and answered "follow what the
// funding programmes require". Re-read 2026-08-21: none of them prescribes key custody. What they
// do require — no vendor lock-in, no dependency on closed technology, local-first — means the
// product must not IMPOSE a custody model. The defect was the opposite of the expected one: the
// signer demanded the private key in process, which locks out every operator whose key is in an
// HSM, on a smartcard, or offline. These rows prove the lock is gone.

import {
  localKeyBackend,
  detachedBackend,
  fingerprint,
  DetachedSignatureRequired,
  ReleaseSigningError,
} from '../../../tools/release-signing.mjs';
import { signBuildProvenanceWith } from '../../../tools/sign-build-provenance.mjs';
import os from 'node:os';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'noesar-signing-'));
}

test('local-key backend: the everywhere baseline still works', () => {
  const { privatePem, publicPem } = keypair();
  const signed = signBuildProvenanceWith(hmacSignedDocument(), localKeyBackend(privatePem));
  assert.equal(signed.publicSignature.custody, 'local-key');
  assert.equal(verifyBuildProvenance(signed, publicPem).verified, true);
});

test('detached backend: phase one emits the bytes and REFUSES to invent a signature', () => {
  const { publicPem } = keypair();
  const dir = tmpdir();
  try {
    const requestPath = path.join(dir, 'tosign.bin');
    const backend = detachedBackend({ publicKeyPem: publicPem, requestPath });
    assert.throws(
      () => signBuildProvenanceWith(hmacSignedDocument(), backend),
      (error) => error instanceof DetachedSignatureRequired && error.code === 'DETACHED_SIGNATURE_REQUIRED',
      'phase one must stop, not produce an unsigned or self-signed document',
    );
    assert.ok(fs.existsSync(requestPath), 'the bytes to sign must actually be written');
    assert.ok(fs.existsSync(`${requestPath}.sha256`), 'and their digest, so the operator can check what they signed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detached backend: the private key never enters this process, and the result still verifies', () => {
  const { privatePem, publicPem } = keypair();
  const dir = tmpdir();
  try {
    const requestPath = path.join(dir, 'tosign.bin');
    const signaturePath = path.join(dir, 'tosign.sig');
    const document = hmacSignedDocument();

    // Phase one: emit.
    assert.throws(() => signBuildProvenanceWith(document, detachedBackend({ publicKeyPem: publicPem, requestPath })));

    // The operator signs, somewhere this code has no part in. Only the bytes cross the boundary.
    const { sign: nodeSign, createPrivateKey } = crypto;
    fs.writeFileSync(
      signaturePath,
      nodeSign(null, fs.readFileSync(requestPath), createPrivateKey(privatePem)).toString('base64'),
    );

    // Phase two: attach. Note what is NOT passed anywhere in this call.
    const signed = signBuildProvenanceWith(
      document,
      detachedBackend({ publicKeyPem: publicPem, requestPath, signaturePath }),
    );
    assert.equal(signed.publicSignature.custody, 'detached');
    assert.equal(verifyBuildProvenance(signed, publicPem).verified, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ORACLE: a signature left over from a previous run is REFUSED, not attached', () => {
  // Without this check the second run would attach a signature over yesterday's bytes and the
  // document would verify against nothing anyone intended — the failure mode of every two-phase
  // signing scheme, and the reason the backend re-checks rather than trusting the filename.
  const { privatePem, publicPem } = keypair();
  const dir = tmpdir();
  try {
    const requestPath = path.join(dir, 'tosign.bin');
    const signaturePath = path.join(dir, 'tosign.sig');
    fs.writeFileSync(
      signaturePath,
      crypto.sign(null, Buffer.from('some other document entirely'), crypto.createPrivateKey(privatePem)).toString('base64'),
    );
    assert.throws(
      () => signBuildProvenanceWith(hmacSignedDocument(), detachedBackend({ publicKeyPem: publicPem, requestPath, signaturePath })),
      (error) => error instanceof ReleaseSigningError && error.code === 'DETACHED_SIGNATURE_MISMATCH',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ORACLE: a detached signature by the wrong key is refused', () => {
  const other = keypair();
  const { publicPem } = keypair();
  const dir = tmpdir();
  try {
    const requestPath = path.join(dir, 'tosign.bin');
    const signaturePath = path.join(dir, 'tosign.sig');
    assert.throws(() => signBuildProvenanceWith(hmacSignedDocument(), detachedBackend({ publicKeyPem: publicPem, requestPath })));
    fs.writeFileSync(
      signaturePath,
      crypto.sign(null, fs.readFileSync(requestPath), crypto.createPrivateKey(other.privatePem)).toString('base64'),
    );
    assert.throws(
      () => signBuildProvenanceWith(hmacSignedDocument(), detachedBackend({ publicKeyPem: publicPem, requestPath, signaturePath })),
      (error) => error instanceof ReleaseSigningError && error.code === 'DETACHED_SIGNATURE_MISMATCH',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('custody is invisible to the verifier — which is what makes it the operator\'s choice', () => {
  // The claim being asserted is the funding one: a downstream verifier needs the public key and
  // nothing else, so no custody backend can become a dependency of verification. If this row ever
  // fails, the product has started imposing a custody model on the people verifying it.
  const { privatePem, publicPem } = keypair();
  const dir = tmpdir();
  try {
    const requestPath = path.join(dir, 'tosign.bin');
    const signaturePath = path.join(dir, 'tosign.sig');
    const local = signBuildProvenanceWith(hmacSignedDocument(), localKeyBackend(privatePem));
    assert.throws(() => signBuildProvenanceWith(hmacSignedDocument(), detachedBackend({ publicKeyPem: publicPem, requestPath })));
    fs.writeFileSync(
      signaturePath,
      crypto.sign(null, fs.readFileSync(requestPath), crypto.createPrivateKey(privatePem)).toString('base64'),
    );
    const remote = signBuildProvenanceWith(hmacSignedDocument(), detachedBackend({ publicKeyPem: publicPem, requestPath, signaturePath }));

    assert.notEqual(local.publicSignature.custody, remote.publicSignature.custody);
    // Same key, same payload, same Ed25519: the signature bytes themselves are identical too.
    assert.equal(local.publicSignature.value, remote.publicSignature.value);
    for (const document of [local, remote]) {
      assert.equal(verifyBuildProvenance(document, publicPem).verified, true);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-Ed25519 release key is refused by name, not misused', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(
    () => localKeyBackend(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    (error) => error instanceof ReleaseSigningError && error.code === 'UNSUPPORTED_KEY_TYPE',
  );
});

test('detached signing refuses to start without the public key to check against', () => {
  assert.throws(
    () => detachedBackend({ requestPath: '/nowhere' }),
    (error) => error instanceof ReleaseSigningError && error.code === 'NO_PUBLIC_KEY',
  );
});

test('the fingerprint is the shape docs/SBOM_REPORT.md already publishes', () => {
  const { publicPem } = keypair();
  assert.match(fingerprint(publicPem), /^[0-9a-f]{64}$/);
});
