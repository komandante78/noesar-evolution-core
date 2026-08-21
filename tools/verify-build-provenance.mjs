#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Verifies a Rust build provenance document's PUBLIC signature — `D-0589`.
//
//   node tools/verify-build-provenance.mjs --provenance <file> --public-key <pem>
//
// This is the half that matters, and the half that did not exist. `tools/verify-rust-build-
// provenance.py` needs `--signing-key-file`: the shared secret. An independent auditor does not
// have it and must not be given it, because holding it is indistinguishable from being able to
// forge the document. This verifier takes a **public** key and nothing else — which is the whole
// difference `PKG-001` position 5 is asking about.
//
// Exit codes: 0 verified · 1 signature invalid or absent · 2 usage error.
//
// A refusal is never a quiet `false`: "this document carries no public signature" and "this
// document carries a signature that does not check out" are different facts about the world, and
// an auditor must not have to infer which one from a boolean (`compliance-packs.mjs` already
// makes that distinction for packs; this keeps it).

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { canonicalBytes } from '../services/reference-control-plane/src/compliance-packs.mjs';
import { signedPayload, ENVELOPE_KEYS } from './sign-build-provenance.mjs';

export class ProvenanceVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Returns `{ verified, fingerprint, algorithm }` or throws ProvenanceVerificationError.
 *
 * The payload is rebuilt from the document itself, never taken from a field the document
 * supplies — a signature over a payload the signed object gets to name is a signature over
 * nothing. `envelopeKeys` IS recorded in the document, and is compared against this tool's own
 * constant rather than obeyed: a document that claims a different envelope is telling us it was
 * signed under a different rule, which is a mismatch to report, not an instruction to follow.
 */
export function verifyBuildProvenance(document, publicKeyPem) {
  const sig = document.publicSignature;
  if (!sig || typeof sig.value !== 'string' || sig.value === '') {
    throw new ProvenanceVerificationError(
      'NO_PUBLIC_SIGNATURE',
      'document carries no public signature — it has not been through tools/sign-build-provenance.mjs',
    );
  }
  if (sig.algorithm !== 'ed25519') {
    throw new ProvenanceVerificationError(
      'UNSUPPORTED_ALGORITHM',
      `unsupported public signature algorithm: ${String(sig.algorithm)}`,
    );
  }
  if (Array.isArray(sig.envelopeKeys)) {
    const declared = [...sig.envelopeKeys].sort().join(',');
    const known = [...ENVELOPE_KEYS].sort().join(',');
    if (declared !== known) {
      throw new ProvenanceVerificationError(
        'ENVELOPE_MISMATCH',
        `document was signed under a different signature envelope (${declared}) than this verifier applies (${known})`,
      );
    }
  }
  const bytes = canonicalBytes(signedPayload(document));
  const verified = cryptoVerify(
    null,
    bytes,
    createPublicKey(publicKeyPem),
    Buffer.from(sig.value, 'base64'),
  );
  if (!verified) {
    throw new ProvenanceVerificationError(
      'SIGNATURE_MISMATCH',
      'public signature does not verify against this key over the document as it stands',
    );
  }
  return { verified: true, fingerprint: sig.publicKeyFingerprint, algorithm: sig.algorithm };
}

function main() {
  const { values } = parseArgs({
    options: { provenance: { type: 'string' }, 'public-key': { type: 'string' } },
  });
  if (!values.provenance || !values['public-key']) {
    process.stderr.write('usage: verify-build-provenance.mjs --provenance <file> --public-key <pem>\n');
    return 2;
  }
  let document;
  try {
    document = JSON.parse(readFileSync(resolve(values.provenance), 'utf8'));
  } catch (error) {
    process.stderr.write(`PROVENANCE_PUBLIC_VERIFY=FAIL unreadable: ${error.message}\n`);
    return 1;
  }
  try {
    const result = verifyBuildProvenance(document, readFileSync(resolve(values['public-key']), 'utf8'));
    process.stdout.write(
      `PROVENANCE_PUBLIC_VERIFY=PASS algorithm=${result.algorithm} fingerprint=${result.fingerprint}\n`,
    );
    return 0;
  } catch (error) {
    const code = error instanceof ProvenanceVerificationError ? error.code : 'ERROR';
    process.stderr.write(`PROVENANCE_PUBLIC_VERIFY=FAIL ${code}: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
