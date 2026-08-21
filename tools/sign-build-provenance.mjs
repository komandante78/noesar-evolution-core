#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Adds a PUBLICLY VERIFIABLE Ed25519 signature to a Rust build provenance document — `D-0589`.
//
//   node tools/sign-build-provenance.mjs --provenance <file> --private-key <pem> --output <file>
//
// # The defect this closes, quoted rather than paraphrased
//
// `rust/BUILD_STATUS.md:11` declares `PROVENANCE_SIGNED=true`, and forty lines later the same
// document admits `publiclyVerifiable: false`, because the signature is HMAC-SHA256: "anyone who
// can verify this signature can also forge it". `PKG-001` position 5 asks for provenance that an
// **independent** audit can check, and an independent auditor by definition does not hold the
// build key — so that position could not close no matter how correct the existing signature was.
//
// The reason recorded on 2026-07-27 for not using Ed25519 was that "no vetted implementation is
// reachable from these tools, and hand-rolling the primitive is a risk this project has already
// paid for once". That was true **of the Python tools** — CPython's standard library has no
// Ed25519 and `cryptography` is not vendored — and it stopped being a reason once the repository
// grew one: `signCompliancePack()` signs canonical JSON bytes with Node's native `crypto`, and
// already signs the compliance packs, the technology-radar entries and the four SBOMs, with a
// verifier and a proven tamper rejection. This tool writes no crypto of its own; it calls that.
//
// # Why this ADDS a signature instead of replacing one
//
// The two signatures answer different questions and both are worth keeping:
//
//   HMAC-SHA256  — was this minted by a holder of the build key? (checkable only in-house)
//   Ed25519      — was this issued by this identifiable signer? (checkable by anyone)
//
// They cover the **same payload**: the document with the whole signature envelope removed. So
// neither invalidates the other, each verifies independently, and — asserted by a test rather
// than assumed — the bytes they cover are identical, because `canonicalBytes()` and Python's
// `json.dumps(sort_keys=True, separators=(",", ":"))` produce the same serialisation.
//
// That identity holds for ASCII content only: Python escapes non-ASCII by default and
// `JSON.stringify` does not. Rather than rely on provenance documents happening to be ASCII —
// they carry hashes, paths and versions, so in practice they are — this refuses a document that
// is not, and says why. A silent divergence between two signers is the failure mode worth
// spending five lines to make impossible.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// `canonicalBytes` only: since D-0622 the signing itself goes through a backend, so
// `signCompliancePack` is no longer called from here. The canonicalisation stays shared with the
// compliance packs and the SBOMs on purpose — one serialisation, one meaning of "these bytes".
import { canonicalBytes } from '../services/reference-control-plane/src/compliance-packs.mjs';
import { signBytes, localKeyBackend, detachedBackend, DetachedSignatureRequired } from './release-signing.mjs';

/**
 * The signature envelope: the keys that describe signatures rather than facts. Neither signature
 * covers these, which is what lets both live in one document. `publicSignature` joined the set
 * when this tool was written, and `tools/verify-rust-build-provenance.py` learned the same name
 * in the same change — one rule, two implementations, and a test that proves they agree.
 */
export const ENVELOPE_KEYS = Object.freeze([
  'signature',
  'signatureAlgorithm',
  'signingKeyId',
  'publiclyVerifiable',
  'publicSignature',
]);

/** The document stripped to its facts — the payload both signatures cover. */
export function signedPayload(document) {
  const out = {};
  for (const [k, v] of Object.entries(document)) {
    if (!ENVELOPE_KEYS.includes(k)) out[k] = v;
  }
  return out;
}

/**
 * Refuses a payload whose canonical bytes would differ between the Node and Python signers.
 * See the header: this is the one way the two could silently sign different things.
 */
export function assertCrossLanguageStable(payload) {
  const bytes = canonicalBytes(payload);
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new Error(
        'provenance document contains non-ASCII bytes: the Python HMAC signer escapes them and ' +
          'this one does not, so the two signatures would cover different bytes. Refusing rather ' +
          'than signing something the other verifier cannot reproduce.',
      );
    }
  }
  return bytes;
}

/**
 * Signs with a BACKEND rather than with key material — `D-0622`. The private key is not a
 * parameter here, and that absence is the whole point: an operator whose key lives in an HSM,
 * on a smartcard or on an air-gapped machine can satisfy this signature without the key ever
 * entering this process. `tools/release-signing.mjs` carries the two backends and the reasoning.
 */
export function signBuildProvenanceWith(document, backend) {
  const payload = signedPayload(document);
  const bytes = assertCrossLanguageStable(payload);
  const signature = signBytes(backend, bytes);
  return {
    ...document,
    publiclyVerifiable: true,
    publicSignature: {
      algorithm: signature.algorithm,
      value: signature.value,
      publicKeyFingerprint: signature.publicKeyFingerprint,
      signedAt: signature.signedAt,
      custody: signature.custody,
      covers: 'the document with every key of the signature envelope removed, canonical JSON',
      envelopeKeys: [...ENVELOPE_KEYS],
    },
  };
}

/**
 * Convenience for the common case: the key is a PEM this process may read.
 *
 * Delegates rather than duplicating. The first version of this function assembled the envelope
 * itself, so the two signing paths produced envelopes that differed by one field (`custody`) —
 * the same shape of defect as `D-0608` and `D-0616`, found by hunting this phase's own diff
 * before it shipped. One assembler, one envelope, no drift possible.
 */
export function signBuildProvenance(document, privateKeyPem) {
  return signBuildProvenanceWith(document, localKeyBackend(privateKeyPem));
}

const USAGE = `usage:
  local key    sign-build-provenance.mjs --provenance <f> --private-key <pem> --output <f>
  detached     sign-build-provenance.mjs --provenance <f> --public-key <pem> \\
                   --detached-request <f> [--detached-signature <f>] --output <f>

The detached form never reads a private key. Run it once to emit the bytes to sign, sign them
wherever the release key actually lives, then re-run with --detached-signature.
Exit 3 means "bytes emitted, signature awaited" — it is a step, not a failure.
`;

function main() {
  const { values } = parseArgs({
    options: {
      provenance: { type: 'string' },
      'private-key': { type: 'string' },
      'public-key': { type: 'string' },
      'detached-request': { type: 'string' },
      'detached-signature': { type: 'string' },
      output: { type: 'string' },
    },
  });
  const detached = Boolean(values['detached-request']);
  if (!values.provenance || !values.output || (!values['private-key'] && !detached)) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (detached && !values['public-key']) {
    process.stderr.write('REFUSED: --detached-request needs --public-key to check the operator signature against\n');
    return 2;
  }

  const document = JSON.parse(readFileSync(resolve(values.provenance), 'utf8'));
  const backend = detached
    ? detachedBackend({
        publicKeyPem: readFileSync(resolve(values['public-key']), 'utf8'),
        requestPath: resolve(values['detached-request']),
        signaturePath: values['detached-signature'] ? resolve(values['detached-signature']) : null,
      })
    : localKeyBackend(readFileSync(resolve(values['private-key']), 'utf8'));

  let signed;
  try {
    signed = signBuildProvenanceWith(document, backend);
  } catch (error) {
    if (error instanceof DetachedSignatureRequired) {
      // Not a failure: the first half of a two-phase signing ran exactly as designed. A distinct
      // exit code so a script can tell "sign these bytes now" from "something went wrong".
      process.stdout.write(`PROVENANCE_DETACHED_REQUEST ${error.requestPath} sha256=${error.digest}\n`);
      return 3;
    }
    process.stderr.write(`PROVENANCE_PUBLIC_SIGNED=FAIL ${error.code ?? 'ERROR'}: ${error.message}\n`);
    return 1;
  }

  writeFileSync(resolve(values.output), `${JSON.stringify(signed, null, 2)}\n`);
  process.stdout.write(
    `PROVENANCE_PUBLIC_SIGNED ${values.output} algorithm=${signed.publicSignature.algorithm} ` +
      `custody=${signed.publicSignature.custody} fingerprint=${signed.publicSignature.publicKeyFingerprint}\n`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
