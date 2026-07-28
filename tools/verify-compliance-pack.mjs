// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CLI: verify a signed compliance pack -- schema, the dated validity window, and (if a
// public key is given) the Ed25519 signature. Exits non-zero and prints every reason on
// any failure; prints a single PASS line on success. Node counterpart of
// capabilities/tools/verify-package.py for capability packages.
//
// Usage: node tools/verify-compliance-pack.mjs --pack <file> [--public-key <pem>]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadComplianceSchema, validateCompliancePackDocument, checkPackDates,
  verifyCompliancePackSignature,
} from '../services/reference-control-plane/src/compliance-packs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    pack: { type:'string' },
    'public-key': { type:'string' },
  },
});

if (!values.pack) {
  process.stderr.write('usage: verify-compliance-pack.mjs --pack <file> [--public-key <pem>]\n');
  process.exit(2);
}

const pack = JSON.parse(readFileSync(resolve(values.pack), 'utf8'));
const schema = loadComplianceSchema(repoRoot);
const schemaResult = validateCompliancePackDocument(pack, schema);
const dateResult = schemaResult.valid ? checkPackDates(pack) : { valid:true, errors:[] };
const errors = [...schemaResult.errors, ...dateResult.errors];

let signatureChecked = false;
if (values['public-key']) {
  signatureChecked = true;
  const publicKeyPem = readFileSync(resolve(values['public-key']), 'utf8');
  try {
    if (!verifyCompliancePackSignature(pack, publicKeyPem)) errors.push('signature does not verify against the given public key');
  } catch (error) {
    errors.push(error.reason ?? String(error));
  }
}

if (errors.length === 0) {
  process.stdout.write(`PASS id=${pack.id} jurisdiction=${pack.jurisdiction} signatureChecked=${signatureChecked}\n`);
  process.exit(0);
}
process.stderr.write(`FAIL ${errors.length} problem(s):\n`);
for (const error of errors) process.stderr.write(`  - ${error}\n`);
process.exit(1);
