#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The operator-side "signing side" of the update system — the half of deferred_items[2]
// ("update signing side and portal not implemented") that is in scope here. The other
// half, the noesar.com portal, stays out of scope by prior explicit decision
// (docs/LICENSING_AND_PORTAL_INTERFACE.md B7: "Not in scope for Phase 3 or Phase 4" —
// the offline channel is deliberately the whole product without it).
//
// services/reference-control-plane/src/update-manager.mjs already verifies channel
// metadata and package manifests, but nothing in the repository could ever produce an
// artefact it would accept: there was a verifier with no matching signer, and no way to
// pin a channel's public key (D-0272 also adds the missing HTTP route for that). This
// tool produces exactly the two signed shapes update-manager.mjs checks:
//   - channel metadata: signed over canonicalJsonBytes(metadata-without-signature),
//     embedded as metadata.signature = "ed25519:<base64>"      (verifyMetadata)
//   - package manifest.json: signed over the exact file bytes, detached to
//     manifest.sig as "ed25519:<base64>"                        (verifyBundle)
// Reusing services/reference-control-plane/src/compliance-packs.mjs's signer was
// considered and rejected: it signs into a `signature: {value, publicKeyFingerprint,...}`
// object shape, not the flat `"ed25519:..."` string update-manager.mjs actually parses —
// producing that shape here would not be a duplicate, it would be an artefact nothing
// downstream could verify. A private key never reaches server.mjs.
//
// Usage:
//   node tools/sign-update-artifact.mjs keygen --channel <name> --out-dir <dir>
//   node tools/sign-update-artifact.mjs sign-metadata --metadata <file> --private-key <pem> --output <file>
//   node tools/sign-update-artifact.mjs sign-package --manifest <file> --private-key <pem> --output <file>
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createHash, createPrivateKey, generateKeyPairSync, sign as cryptoSign,
} from 'node:crypto';
import { canonicalJsonBytes } from '../services/reference-control-plane/src/canonical-json.mjs';

const [mode, ...rest] = process.argv.slice(2);

function usageAndExit(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write([
    'usage:',
    '  sign-update-artifact.mjs keygen --channel <name> --out-dir <dir>',
    '  sign-update-artifact.mjs sign-metadata --metadata <file> --private-key <pem> --output <file>',
    '  sign-update-artifact.mjs sign-package --manifest <file> --private-key <pem> --output <file>',
    '',
  ].join('\n'));
  process.exit(2);
}

function fingerprintOf(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

if (mode === 'keygen') {
  const { values } = parseArgs({ args: rest, options: { channel: { type: 'string' }, 'out-dir': { type: 'string' } } });
  if (!values.channel || !values['out-dir']) usageAndExit('keygen requires --channel and --out-dir');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const dir = resolve(values['out-dir']);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privatePath = join(dir, `${values.channel}.private.pem`);
  const publicPath = join(dir, `${values.channel}.pub.pem`);
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  process.stdout.write(`KEYGEN channel=${values.channel} fingerprint=${fingerprintOf(publicKey)}\n`);
  process.stdout.write(`  private: ${privatePath}  (keep offline; never commit; never install as a channel key)\n`);
  process.stdout.write(`  public:  ${publicPath}   (install with POST /api/v1/updates/channel-key)\n`);
} else if (mode === 'sign-metadata') {
  const { values } = parseArgs({ args: rest, options: { metadata: { type: 'string' }, 'private-key': { type: 'string' }, output: { type: 'string' } } });
  if (!values.metadata || !values['private-key'] || !values.output) usageAndExit('sign-metadata requires --metadata, --private-key and --output');
  const metadata = JSON.parse(readFileSync(resolve(values.metadata), 'utf8'));
  if ('signature' in metadata) usageAndExit('--metadata must not already carry a signature field');
  const privateKey = createPrivateKey(readFileSync(resolve(values['private-key']), 'utf8'));
  const signature = cryptoSign(null, canonicalJsonBytes(metadata), privateKey);
  const signed = { ...metadata, signature: `ed25519:${signature.toString('base64')}` };
  writeFileSync(resolve(values.output), `${JSON.stringify(signed, null, 2)}\n`);
  process.stdout.write(`SIGNED metadata channel=${metadata.channel ?? 'unknown'} -> ${values.output}\n`);
} else if (mode === 'sign-package') {
  const { values } = parseArgs({ args: rest, options: { manifest: { type: 'string' }, 'private-key': { type: 'string' }, output: { type: 'string' } } });
  if (!values.manifest || !values['private-key'] || !values.output) usageAndExit('sign-package requires --manifest, --private-key and --output');
  const manifestBytes = readFileSync(resolve(values.manifest));
  const privateKey = createPrivateKey(readFileSync(resolve(values['private-key']), 'utf8'));
  const signature = cryptoSign(null, manifestBytes, privateKey);
  writeFileSync(resolve(values.output), `ed25519:${signature.toString('base64')}\n`);
  process.stdout.write(`SIGNED package manifest=${values.manifest} -> ${values.output}\n`);
} else {
  usageAndExit(mode ? `unknown mode: ${mode}` : undefined);
}
