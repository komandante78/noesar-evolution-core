#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CLI: verify a signed release artifact against an Ed25519 public key. Exits non-zero
// and names the reason on failure; prints one PASS line on success. Node counterpart of
// tools/verify-compliance-pack.mjs, generic instead of pack-specific — see the module
// comment in sign-release-artifact.mjs for why reuse rather than a second signer.
//
// Usage: node tools/verify-release-artifact.mjs --artifact <file> --public-key <pem>
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyCompliancePackSignature } from '../services/reference-control-plane/src/compliance-packs.mjs';

const { values } = parseArgs({
  options: {
    artifact: { type:'string' },
    'public-key': { type:'string' },
  },
});

if (!values.artifact || !values['public-key']) {
  process.stderr.write('usage: verify-release-artifact.mjs --artifact <file> --public-key <pem>\n');
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(resolve(values.artifact), 'utf8'));
const publicKeyPem = readFileSync(resolve(values['public-key']), 'utf8');

try {
  const ok = verifyCompliancePackSignature(artifact, publicKeyPem);
  if (ok) {
    process.stdout.write(`PASS documentType=${artifact.documentType ?? 'unknown'} fingerprint=${artifact.signature.publicKeyFingerprint}\n`);
    process.exit(0);
  }
  process.stderr.write('FAIL signature does not verify against the given public key\n');
  process.exit(1);
} catch (error) {
  process.stderr.write(`FAIL ${error.reason ?? error.message}\n`);
  process.exit(1);
}
