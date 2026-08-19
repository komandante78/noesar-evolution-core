#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0546`. Does the door actually open, and does it refuse what the product refuses?
//
// This drives `tools/sign-model-descriptor.mjs` as a publisher does — as a process, through its
// argv, reading its exit code — because that is the whole of its interface and none of it is
// exercised by importing a function. A CLI tested by calling its internals is a CLI nobody has
// run.
//
// The claim that matters most is the LAST one: the descriptor this tool produces is accepted by
// `verifyModelDescriptor()`, the same function the running installation calls. A signing tool
// that produces something only it accepts is worse than no tool at all — it manufactures files
// that fail on someone else's machine, after shipping.
//
// No network, no container, no host assumption: `node`, a temp directory, and the repository.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createPublicKey } from 'node:crypto';
import { verifyModelDescriptor, publicKeyFingerprint } from '../packages/verified-acquisition/src/index.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(REPO, 'tools', 'sign-model-descriptor.mjs');

const workspace = mkdtempSync(join(tmpdir(), 'noesar-sign-descriptor-'));
process.on('exit', () => rmSync(workspace, { recursive: true, force: true }));

const at = (...parts) => join(workspace, ...parts);

const run = (...args) => {
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const VALID = {
  id: 'demo/tiny',
  version: '1.0.0',
  publisher: 'demo-publisher',
  source: 'https://models.example.invalid/tiny.gguf',
  license: 'apache-2.0',
  hashes: { sha256: 'b'.repeat(64) },
  formats: ['gguf'],
  workloads: ['chat'],
  resource_profiles: [{ name: 'cpu-small', ram_gb: 8 }],
};

const writeJson = (name, value) => {
  const path = at(name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};

let failures = 0;
let checks = 0;
function check(condition, message) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

console.log('sign-model-descriptor CLI\n');

// ---------------------------------------------------------------------------------------------
console.log('- keygen');
// ---------------------------------------------------------------------------------------------
const keygen = run('keygen', '--publisher', 'demo-publisher', '--out-dir', at('keys'));
check(keygen.code === 0, `keygen must exit 0, got ${keygen.code}: ${keygen.stderr}`);
const privatePath = at('keys', 'demo-publisher.private.pem');
const publicPath = at('keys', 'demo-publisher.pub.pem');
check(existsSync(privatePath) && existsSync(publicPath), 'keygen must write both halves of the pair');
// Windows has no POSIX mode bits and Node reports a synthetic one, so asserting 0600 there would
// fail on a correct installation. Declared and skipped, never quietly asserted (platform law).
if (process.platform === 'win32') {
  console.log('  SKIPPED: private-key permission bits — this platform has no POSIX file mode');
} else {
  check((statSync(privatePath).mode & 0o777) === 0o600, 'the private key must be created 0600');
}
check(/KEYGEN publisher=demo-publisher fingerprint=[0-9a-f]{64}/.test(keygen.stdout),
  'keygen must print the fingerprint the operator will register');
check(keygen.stdout.includes('/api/v1/publishers/register'),
  'keygen must name the operator action that makes this key trusted — a key nobody registers signs nothing an installation accepts');

const publicKey = createPublicKey(readFileSync(publicPath, 'utf8'));
check(keygen.stdout.includes(publicKeyFingerprint(publicKey)),
  'the printed fingerprint must be the fingerprint of the key actually written');

// The defect this refusal exists for: a second keygen would have destroyed the only key that can
// sign as this publisher, and `writeFileSync`'s mode argument would not even have restored 0600
// on the existing file. Silence here costs a publisher every descriptor they ever signed.
const before = readFileSync(privatePath, 'utf8');
const again = run('keygen', '--publisher', 'demo-publisher', '--out-dir', at('keys'));
check(again.code === 4, `a keygen that would overwrite existing key material must exit 4, got ${again.code}`);
check(readFileSync(privatePath, 'utf8') === before, 'the existing private key must be left untouched');
check(/REFUSED/.test(again.stderr), 'the refusal must say REFUSED, not fail silently');

// ---------------------------------------------------------------------------------------------
console.log('- sign');
// ---------------------------------------------------------------------------------------------
const descriptorPath = writeJson('descriptor.json', VALID);
const signedPath = at('descriptor.signed.json');
const sign = run('sign', '--descriptor', descriptorPath, '--private-key', privatePath,
  '--output', signedPath, '--signed-at', '2026-08-19T00:00:00.000Z');
check(sign.code === 0, `sign must exit 0, got ${sign.code}: ${sign.stderr}`);

const signedDoc = existsSync(signedPath) ? JSON.parse(readFileSync(signedPath, 'utf8')) : null;
check(signedDoc?.signature?.algorithm === 'ed25519', 'the output must carry an ed25519 signature block');
check(signedDoc?.signature?.signedAt === '2026-08-19T00:00:00.000Z', '--signed-at must be honoured verbatim');
check(signedDoc?.signature?.publicKeyFingerprint === publicKeyFingerprint(publicKey),
  'the signature must name the fingerprint of the key that produced it');
check(signedDoc?.id === VALID.id && signedDoc?.hashes?.sha256 === VALID.hashes.sha256,
  'signing must not alter the document it signs');

// THE claim. A one-key registry, and the product's own verifier — not a second, more forgiving
// implementation kept in a test.
const registry = {
  findActiveKey: ({ publisherId, fingerprint }) => (
    publisherId === 'demo-publisher' && fingerprint === publicKeyFingerprint(publicKey)
      ? { publicKeyPem: readFileSync(publicPath, 'utf8'), trustLevel: 'community' }
      : null
  ),
};
const verdict = verifyModelDescriptor({ descriptor: signedDoc ?? {}, registry });
check(verdict.verified === true,
  `the product's own verifier must accept what this tool produced, got ${verdict.kind}: ${verdict.reason ?? ''}`);

// Determinism: the same input and the same --signed-at must produce the same bytes. Without a
// canonical encoding this would drift with key order, and two publishers would disagree about
// what they signed while both being "right".
const repeatPath = at('descriptor.signed.again.json');
run('sign', '--descriptor', descriptorPath, '--private-key', privatePath, '--output', repeatPath,
  '--signed-at', '2026-08-19T00:00:00.000Z');
check(existsSync(repeatPath) && readFileSync(repeatPath, 'utf8') === readFileSync(signedPath, 'utf8'),
  'signing the same descriptor at the same instant must be byte-identical');

// A malformed descriptor is refused BEFORE a signature exists over it.
const brokenPath = writeJson('broken.json', { ...VALID, hash: VALID.hashes, hashes: undefined, formats: 'gguf' });
const brokenOut = at('broken.signed.json');
const broken = run('sign', '--descriptor', brokenPath, '--private-key', privatePath, '--output', brokenOut);
check(broken.code === 3, `a descriptor that fails the schema must exit 3, got ${broken.code}`);
check(!existsSync(brokenOut), 'nothing may be written when the schema refuses the descriptor');
check(/\/hashes is required and missing/.test(broken.stderr) && /\/formats must be array/.test(broken.stderr),
  'the refusal must name every field that is wrong, in one pass');

// An already-signed descriptor is not silently re-signed.
const resign = run('sign', '--descriptor', signedPath, '--private-key', privatePath, '--output', at('resigned.json'));
check(resign.code === 2, `re-signing without --replace must exit 2, got ${resign.code}`);
const replaced = run('sign', '--descriptor', signedPath, '--private-key', privatePath,
  '--output', at('resigned.json'), '--replace');
check(replaced.code === 0, `--replace must be accepted, got ${replaced.code}: ${replaced.stderr}`);
check(JSON.parse(readFileSync(at('resigned.json'), 'utf8')).signature.value === signedDoc.signature.value,
  're-signing the same content with the same key must reproduce the same signature, not layer one');

// A key that is not a key.
writeFileSync(at('not-a-key.pem'), 'this is not a private key\n');
const badKey = run('sign', '--descriptor', descriptorPath, '--private-key', at('not-a-key.pem'), '--output', at('never.json'));
check(badKey.code === 4, `an unusable private key must exit 4, got ${badKey.code}`);
check(!existsSync(at('never.json')), 'no output may be written when the key cannot sign');

// ---------------------------------------------------------------------------------------------
console.log('- verify');
// ---------------------------------------------------------------------------------------------
const verify = run('verify', '--descriptor', signedPath, '--public-key', publicPath);
check(verify.code === 0, `verify must exit 0 on the tool's own output, got ${verify.code}: ${verify.stderr}`);
check(/^VERIFIED publisher=demo-publisher fingerprint=[0-9a-f]{64}/m.test(verify.stdout),
  'verify must state who the descriptor is attributed to');

// Tampering after signing — the case the whole chain exists for.
const tamperedPath = at('tampered.json');
writeFileSync(tamperedPath, JSON.stringify({ ...signedDoc, version: '9.9.9' }, null, 2));
const tampered = run('verify', '--descriptor', tamperedPath, '--public-key', publicPath);
check(tampered.code === 4, `a tampered descriptor must exit 4, got ${tampered.code}`);
check(/SIGNATURE_INVALID/.test(tampered.stderr), 'a tampered descriptor must be refused as SIGNATURE_INVALID');

// A different key must not verify — proven with a real second key, not by mutating a field.
run('keygen', '--publisher', 'other-publisher', '--out-dir', at('keys2'));
const wrongKey = run('verify', '--descriptor', signedPath, '--public-key', at('keys2', 'other-publisher.pub.pem'));
check(wrongKey.code === 4, `verifying against an unrelated key must exit 4, got ${wrongKey.code}`);
check(/KEY_NOT_TRUSTED/.test(wrongKey.stderr), 'an unrelated key must be refused as KEY_NOT_TRUSTED');

// An unsigned descriptor reaching verify is a different refusal, and says so.
const unsigned = run('verify', '--descriptor', descriptorPath, '--public-key', publicPath);
check(unsigned.code === 4 && /NO_SIGNATURE/.test(unsigned.stderr),
  'an unsigned descriptor must be refused as NO_SIGNATURE, not as a bad signature');

// ---------------------------------------------------------------------------------------------
console.log('- interface');
// ---------------------------------------------------------------------------------------------
const help = run('--help');
check(help.code === 0 && /usage:/.test(help.stdout), '--help must exit 0 and print the usage on stdout');
const unknownMode = run('frobnicate');
check(unknownMode.code === 2 && /unknown mode/.test(unknownMode.stderr), 'an unknown mode must exit 2');
const noMode = run();
check(noMode.code === 2, 'no arguments at all must exit 2 with the usage');

// A typo in a flag reaches the publisher as a usage error, never as a stack trace: `parseArgs`
// throws on an unknown option, and an unhandled throw would exit 1 — indistinguishable, to a
// script, from the tool crashing.
const typo = run('sign', '--descriptr', descriptorPath, '--private-key', privatePath, '--output', at('x.json'));
check(typo.code === 2, `an unknown flag must exit 2, got ${typo.code}`);
check(!/at file:|node:internal/.test(typo.stderr), 'an unknown flag must not print a stack trace');

const missingArgs = run('sign', '--descriptor', descriptorPath);
check(missingArgs.code === 2 && /requires/.test(missingArgs.stderr), 'missing required flags must exit 2 and say which');

const missingFile = run('verify', '--descriptor', at('nope.json'), '--public-key', publicPath);
check(missingFile.code === 2 && /could not read/.test(missingFile.stderr), 'an unreadable descriptor must exit 2 and name the path');

// The private key is never copied anywhere but where keygen was told to put it.
check(!readFileSync(signedPath, 'utf8').includes('PRIVATE KEY'),
  'no private key material may appear in the signed output');

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log('SIGN_MODEL_DESCRIPTOR: FAIL');
  process.exit(1);
}
console.log('SIGN_MODEL_DESCRIPTOR: PASS');
