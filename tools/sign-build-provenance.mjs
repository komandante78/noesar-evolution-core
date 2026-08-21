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
import { signCompliancePack, canonicalBytes } from '../services/reference-control-plane/src/compliance-packs.mjs';

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

export function signBuildProvenance(document, privateKeyPem) {
  const payload = signedPayload(document);
  assertCrossLanguageStable(payload);
  // Reuses the vetted primitive as-is. signCompliancePack strips a `signature` key before
  // hashing; the payload has none, so what it signs is exactly `payload`.
  const { signature } = signCompliancePack(payload, privateKeyPem);
  return {
    ...document,
    // Computed here, never asserted by the document about itself. Before this tool ran, the
    // field said `false` and was right; it says `true` because a public signature now exists.
    publiclyVerifiable: true,
    publicSignature: {
      algorithm: signature.algorithm,
      value: signature.value,
      publicKeyFingerprint: signature.publicKeyFingerprint,
      signedAt: signature.signedAt,
      covers: 'the document with every key of the signature envelope removed, canonical JSON',
      envelopeKeys: [...ENVELOPE_KEYS],
    },
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      provenance: { type: 'string' },
      'private-key': { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (!values.provenance || !values['private-key'] || !values.output) {
    process.stderr.write(
      'usage: sign-build-provenance.mjs --provenance <file> --private-key <pem> --output <file>\n',
    );
    return 2;
  }
  const document = JSON.parse(readFileSync(resolve(values.provenance), 'utf8'));
  const privateKeyPem = readFileSync(resolve(values['private-key']), 'utf8');
  const signed = signBuildProvenance(document, privateKeyPem);
  writeFileSync(resolve(values.output), `${JSON.stringify(signed, null, 2)}\n`);
  process.stdout.write(
    `PROVENANCE_PUBLIC_SIGNED ${values.output} algorithm=${signed.publicSignature.algorithm} ` +
      `fingerprint=${signed.publicSignature.publicKeyFingerprint}\n`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
