// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Release signing backends — `D-0622`. Where the private key lives is the OPERATOR's decision,
// and this file is what makes that true rather than a slogan.
//
// # Why this exists, and why it is not a security preference
//
// The Owner was asked where the durable release key should live — HSM, secrets manager, cold
// storage — and answered: follow what the funding programmes require. Re-read on 2026-08-21:
//
//   · Restack <https://nlnet.nl/restack/> funds "middleware **without a vendor lock-in**" and
//     "local-first infrastructure", and requires results "under a recognised free or open
//     source license". The call is still "coming soon".
//   · The Sovereign Tech Agency requires code and documentation "licensed in a way that allows
//     free reuse, modification, and redistribution", and funds the Reproducible Builds project
//     for 2025-2027 — reproducibility is what this ecosystem actually pays for.
//
// **None of them prescribes key custody.** No HSM, no KMS, no cold storage. That measured
// absence is the real answer: choosing one on their behalf would be inventing a requirement.
//
// What they DO require constrains the design anyway, and this is the inference, stated as one:
// "no vendor lock-in" plus "must not depend on closed technology" plus "local-first" means the
// product must not IMPOSE a custody backend, and verification must work offline with no service
// call. A release that can only be verified by trusting one company's KMS carries a mandatory
// proprietary dependency at the most security-critical point there is.
//
// # The defect this repairs, which is the opposite of the one people expect
//
// `signCompliancePack(pack, privateKeyPem)` requires the private key **in this process's
// memory**. That is precisely what an HSM or an offline key exists to prevent — so the project
// had already chosen a custody model ("a file on disk") and locked every other one OUT. The
// repair is not to add a vendor; it is to stop requiring the key at all.
//
// # Two backends, both real
//
// An interface with one implementation is an interface nobody has tested (rule 73 — no
// placeholders, no extension points that are promises). So there are two, and both work:
//
//   localKey    the key is a PEM this process reads. Works everywhere, needs no vendor, and is
//               the baseline CLAUDE10.md §63 requires to exist on every host.
//   detached    the key NEVER enters this process. The signer emits the canonical bytes and
//               their digest; the operator signs them wherever the key actually lives — an
//               air-gapped machine, a smartcard, an HSM, `ssh-keygen -Y sign`, anything that
//               produces an Ed25519 signature — and the signature is attached afterwards.
//
// `detached` is the one that answers the Owner's question without naming a supplier: cold
// storage and every HSM are the same workflow from here, and this project does not have to
// know which one was used.

import fs from 'node:fs';
import crypto from 'node:crypto';

/** Raised when a detached signature has been requested but is not available yet. */
export class DetachedSignatureRequired extends Error {
  constructor(requestPath, digest) {
    super(
      `detached signing requested: sign the bytes in ${requestPath} (sha256 ${digest}) with the ` +
        'release key, wherever it lives, and re-run with --detached-signature pointing at the result',
    );
    this.code = 'DETACHED_SIGNATURE_REQUIRED';
    this.requestPath = requestPath;
    this.digest = digest;
  }
}

export class ReleaseSigningError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * The backend contract, written down because "any implementation may satisfy it" is
 * `CLAUDE10.md` rule 55 and needs a shape someone can actually implement:
 *
 *   name          string — recorded in the signature envelope, so a verifier can see HOW a
 *                 document was signed even though it never needs to care.
 *   publicKeyPem  () => string (SPKI PEM). The verifier's whole input.
 *   sign          (Buffer) => Buffer. May throw DetachedSignatureRequired.
 *
 * Nothing here takes a private key as a parameter. That absence is the feature.
 */

/** Backend 1 — the key is a PEM this process holds. The everywhere-baseline. */
export function localKeyBackend(privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new ReleaseSigningError(
      'UNSUPPORTED_KEY_TYPE',
      `release signing key must be ed25519, got ${String(privateKey.asymmetricKeyType)}`,
    );
  }
  return {
    name: 'local-key',
    publicKeyPem: () => crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString(),
    sign: (bytes) => crypto.sign(null, bytes, privateKey),
  };
}

/**
 * Backend 2 — the private key never enters this process.
 *
 * Two-phase by construction: the first call writes what must be signed and refuses to continue;
 * the second call, given the operator's signature, checks it is a signature over THESE bytes
 * before using it. That check is not ceremony — without it, a stale signature file from an
 * earlier run would be attached to a new document and the result would verify against nothing
 * anyone intended.
 */
export function detachedBackend({ publicKeyPem, requestPath, signaturePath = null }) {
  if (!publicKeyPem) {
    throw new ReleaseSigningError('NO_PUBLIC_KEY', 'detached signing needs the public key to check the operator signature against');
  }
  return {
    name: 'detached',
    publicKeyPem: () => publicKeyPem,
    sign(bytes) {
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (!signaturePath || !fs.existsSync(signaturePath)) {
        fs.writeFileSync(requestPath, bytes);
        fs.writeFileSync(`${requestPath}.sha256`, `${digest}  ${requestPath}\n`);
        throw new DetachedSignatureRequired(requestPath, digest);
      }
      const raw = fs.readFileSync(signaturePath, 'utf8').trim();
      const signature = Buffer.from(raw, 'base64');
      const publicKey = crypto.createPublicKey(publicKeyPem);
      if (!crypto.verify(null, bytes, publicKey, signature)) {
        throw new ReleaseSigningError(
          'DETACHED_SIGNATURE_MISMATCH',
          `the signature in ${signaturePath} is not a signature over these bytes (sha256 ${digest}) ` +
            'by this key — a signature left over from a previous run would otherwise be attached silently',
        );
      }
      return signature;
    },
  };
}

/** sha256 of the SPKI DER — the same fingerprint shape the SBOM report already publishes. */
export function fingerprint(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

/**
 * Signs canonical bytes with a backend and returns the signature envelope fields. Deliberately
 * does not know what document the bytes came from: the payload rule lives in
 * `tools/sign-build-provenance.mjs`, and one rule in one place is the lesson `D-0608` and
 * `D-0616` both left behind.
 */
export function signBytes(backend, bytes) {
  const value = backend.sign(bytes).toString('base64');
  const publicKeyPem = backend.publicKeyPem();
  return {
    algorithm: 'ed25519',
    value,
    publicKeyFingerprint: fingerprint(publicKeyPem),
    signedAt: new Date().toISOString(),
    custody: backend.name,
  };
}
