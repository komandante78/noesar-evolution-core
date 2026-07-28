#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CLI: sign any JSON release artifact (component inventory, CBOM, ML-BOM) with an
// Ed25519 private key — phase 7 step 31, closing the gap
// tools/generate-inventory.mjs's own conformanceNote names: "no signature over this
// document". Reuses signCompliancePack()/verifyCompliancePackSignature() from
// compliance-packs.mjs (D-0205) as-is: that function signs the canonical bytes of
// whatever object it is given — it validates nothing pack-specific, so it is already a
// generic JSON-document signer, and writing a second signing implementation here would
// be exactly the duplication step 29 (D-0206) already avoided by reusing the same
// primitive for radar entries. Same as tools/sign-compliance-pack.mjs: a private key
// never reaches services/reference-control-plane/src/server.mjs.
//
// Usage: node tools/sign-release-artifact.mjs --artifact <file> --private-key <pem> --output <file>
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signCompliancePack } from '../services/reference-control-plane/src/compliance-packs.mjs';

const { values } = parseArgs({
  options: {
    artifact: { type:'string' },
    'private-key': { type:'string' },
    output: { type:'string' },
  },
});

if (!values.artifact || !values['private-key'] || !values.output) {
  process.stderr.write('usage: sign-release-artifact.mjs --artifact <file> --private-key <pem> --output <file>\n');
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(resolve(values.artifact), 'utf8'));
const privateKeyPem = readFileSync(resolve(values['private-key']), 'utf8');
const signed = signCompliancePack(artifact, privateKeyPem);
writeFileSync(resolve(values.output), JSON.stringify(signed, null, 2) + '\n');
process.stdout.write(`SIGNED ${values.output} fingerprint=${signed.signature.publicKeyFingerprint}\n`);
