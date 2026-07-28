// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CLI: sign a compliance pack JSON document with an Ed25519 private key (PEM).
// Node counterpart of capabilities/tools/build-signed-package.py for capability
// packages -- same idea, different artefact. Signing is deliberately a command someone
// runs, not an HTTP endpoint: a private key never reaches services/reference-control-plane/
// src/server.mjs (see the module comment in src/compliance-packs.mjs).
//
// Usage: node tools/sign-compliance-pack.mjs --pack <file> --private-key <pem> --output <file>
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signCompliancePack } from '../services/reference-control-plane/src/compliance-packs.mjs';

const { values } = parseArgs({
  options: {
    pack: { type:'string' },
    'private-key': { type:'string' },
    output: { type:'string' },
  },
});

if (!values.pack || !values['private-key'] || !values.output) {
  process.stderr.write('usage: sign-compliance-pack.mjs --pack <file> --private-key <pem> --output <file>\n');
  process.exit(2);
}

const pack = JSON.parse(readFileSync(resolve(values.pack), 'utf8'));
const privateKeyPem = readFileSync(resolve(values['private-key']), 'utf8');
const signed = signCompliancePack(pack, privateKeyPem);
writeFileSync(resolve(values.output), JSON.stringify(signed, null, 2) + '\n');
process.stdout.write(`SIGNED ${values.output} fingerprint=${signed.signature.publicKeyFingerprint}\n`);
