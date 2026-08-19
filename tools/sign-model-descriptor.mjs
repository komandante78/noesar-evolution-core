#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The door in the wall — `D-0546`, executing the `D-0537` proposal.
//
// `D-0521` made a descriptor's signature the thing that says who published it. `D-0523` made a
// signed descriptor **required**, and `D-0536` made an unsigned one **unstartable**. Between
// them they closed the gap where an operator dropped a JSON file into `models/catalog/` and the
// product believed it because it was there.
//
// What none of them shipped is a way for anyone outside this repository to satisfy that
// requirement. `signModelDescriptor()` is exported as a function, used only by this project's
// own tests and its e2e; producing a descriptor by hand means knowing the exact canonical-JSON
// encoding, that the signature is computed over the document with its own `signature` field
// removed, and that the fingerprint is a sha256 over the SPKI DER of the public key. A
// requirement nobody can meet is a requirement that will be worked around — by disabling the
// check, which is the outcome this tool exists to prevent.
//
// # The three modes, and why the third is not optional
//
//   keygen   an ed25519 key pair, private 0600, and the exact next step for the OPERATOR —
//            registering the public half, which is a separate act by a different person.
//   sign     schema first, signature second. Signing a malformed descriptor produces a valid
//            signature over a document that will be refused downstream for an unrelated reason,
//            and a publisher would have no way to tell those two failures apart.
//   verify   the publisher checks their OWN output before shipping it. Without this, the first
//            time anyone learns whether the file is right is on someone else's installation.
//
// `verify` does not re-implement verification. It builds a one-key registry in memory and calls
// `verifyModelDescriptor()` — the same function the server calls — so this tool can never drift
// into accepting something the product rejects. That is the whole point of it being a door:
// a door that opens onto a different building is worse than a wall.
//
// **No network, and no key ever leaves the machine it was made on.** The private key is read,
// used, and never written anywhere but the path the publisher gave `keygen`.
//
// Usage:
//   node tools/sign-model-descriptor.mjs keygen --publisher <id> --out-dir <dir>
//   node tools/sign-model-descriptor.mjs sign   --descriptor <file> --private-key <pem> --output <file> [--signed-at <iso>] [--replace] [--schema <file>]
//   node tools/sign-model-descriptor.mjs verify --descriptor <file> --public-key <pem> [--publisher <id>] [--schema <file>]
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import {
  signModelDescriptor, verifyModelDescriptor, publicKeyFingerprint,
  validateAgainstSchema, formatSchemaErrors,
} from '../packages/verified-acquisition/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA = join(HERE, '..', 'schemas', 'model-descriptor.schema.json');

const out = (line) => process.stdout.write(`${line}\n`);

/** Exit codes are part of the interface: a publisher scripts against them. */
const EXIT = { USAGE: 2, SCHEMA: 3, REFUSED: 4 };

const USAGE = [
  'usage:',
  '  sign-model-descriptor.mjs keygen --publisher <id> --out-dir <dir>',
  '  sign-model-descriptor.mjs sign   --descriptor <file> --private-key <pem> --output <file> [--signed-at <iso>] [--replace] [--schema <file>]',
  '  sign-model-descriptor.mjs verify --descriptor <file> --public-key <pem> [--publisher <id>] [--schema <file>]',
  '',
  'exit: 0 ok · 2 usage · 3 the descriptor does not match the schema · 4 refused',
  '',
].join('\n');

function usageAndExit(message, code = EXIT.USAGE) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(USAGE);
  process.exit(code);
}

/**
 * `parseArgs` throws on an unknown flag, and an unhandled throw here would reach the publisher
 * as a stack trace and exit code 1 — indistinguishable, to a script, from the tool crashing.
 * A typo in a flag name is a usage error and says so, with the usage text and exit 2.
 */
function parse(args, options) {
  try {
    return parseArgs({ args, options }).values;
  } catch (error) {
    return usageAndExit(error.message);
  }
}

const readJson = (path, what) => {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    usageAndExit(`could not read ${what} at ${path}: ${error.message}`);
  }
};

/**
 * Refuse a malformed descriptor before it is signed, and say every reason at once — a
 * publisher fixing one field per run learns the shape one round trip at a time.
 */
function requireSchema(descriptor, schemaPath) {
  const schema = readJson(schemaPath, 'the schema');
  const { valid, errors } = validateAgainstSchema(descriptor, schema);
  if (valid) return;
  process.stderr.write(`REFUSED this descriptor does not match ${schemaPath}\n${formatSchemaErrors(errors)}\n`);
  process.stderr.write('nothing was signed: a valid signature over a malformed descriptor is refused downstream for a reason that has nothing to do with the signature.\n');
  process.exit(EXIT.SCHEMA);
}

const [mode, ...rest] = process.argv.slice(2);

if (mode === 'help' || mode === '--help' || mode === '-h') {
  process.stdout.write(USAGE);
  process.exit(0);
} else if (mode === 'keygen') {
  const values = parse(rest, { publisher: { type: 'string' }, 'out-dir': { type: 'string' } });
  if (!values.publisher || !values['out-dir']) usageAndExit('keygen requires --publisher and --out-dir');
  const dir = resolve(values['out-dir']);
  const privatePath = join(dir, `${values.publisher}.private.pem`);
  const publicPath = join(dir, `${values.publisher}.pub.pem`);
  // Overwriting a private key destroys the only thing that can sign as this publisher, and every
  // descriptor already signed with it becomes unverifiable against the newly registered key. The
  // mode argument to `writeFileSync` would not even have restored 0600 on an existing file — it
  // applies at creation only — so a re-run would have left a world-readable key behind as well.
  for (const [path, what] of [[privatePath, 'private key'], [publicPath, 'public key']]) {
    if (existsSync(path)) {
      process.stderr.write(`REFUSED a ${what} for "${values.publisher}" already exists at ${path}\n`);
      process.stderr.write('  nothing was written. Choose another --publisher or another --out-dir; this tool never overwrites key material.\n');
      process.exit(EXIT.REFUSED);
    }
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  out(`KEYGEN publisher=${values.publisher} fingerprint=${publicKeyFingerprint(publicKey)}`);
  out(`  private: ${privatePath}  (0600 — keep offline, never commit, never send to an installation)`);
  out(`  public:  ${publicPath}`);
  out('  the OPERATOR installs the public half, as an Owner with recent strong reauthentication:');
  out(`    POST /api/v1/publishers/register  {"publisherId":"${values.publisher}","trustLevel":"<level>","publicKeyPem":"<contents of ${values.publisher}.pub.pem>"}`);
  out('  until that is done, a descriptor signed with this key verifies as KEY_NOT_TRUSTED — correctly: the installation has never been told who you are.');
} else if (mode === 'sign') {
  const values = parse(rest, {
    descriptor: { type: 'string' }, 'private-key': { type: 'string' }, output: { type: 'string' },
    'signed-at': { type: 'string' }, schema: { type: 'string' }, replace: { type: 'boolean' },
  });
  if (!values.descriptor || !values['private-key'] || !values.output) usageAndExit('sign requires --descriptor, --private-key and --output');
  const descriptor = readJson(values.descriptor, 'the descriptor');
  if (descriptor?.signature && !values.replace) {
    usageAndExit('this descriptor already carries a signature; pass --replace to sign it again (the previous signature is discarded, not layered)');
  }
  const { signature: _previous, ...unsigned } = descriptor ?? {};
  const schemaPath = resolve(values.schema ?? DEFAULT_SCHEMA);
  requireSchema(unsigned, schemaPath);

  let privateKeyPem;
  try {
    privateKeyPem = readFileSync(resolve(values['private-key']), 'utf8');
  } catch (error) {
    usageAndExit(`could not read the private key at ${values['private-key']}: ${error.message}`);
  }
  let signed;
  try {
    signed = signModelDescriptor(unsigned, privateKeyPem, { signedAt: values['signed-at'] ?? null });
  } catch (error) {
    usageAndExit(`the private key could not be used to sign: ${error.message}`, EXIT.REFUSED);
  }
  // The signed document must itself satisfy the schema — `signature` is a defined field with a
  // closed shape, so a schema and a signer that disagree would be caught here and not by a user.
  requireSchema(signed, schemaPath);
  writeFileSync(resolve(values.output), `${JSON.stringify(signed, null, 2)}\n`);
  out(`SIGNED id=${signed.id} publisher=${signed.publisher} fingerprint=${signed.signature.publicKeyFingerprint}`);
  out(`  signedAt: ${signed.signature.signedAt}`);
  out(`  output:   ${values.output}`);
  out('  verify it before shipping:  sign-model-descriptor.mjs verify --descriptor <output> --public-key <your .pub.pem>');
} else if (mode === 'verify') {
  const values = parse(rest, {
    descriptor: { type: 'string' }, 'public-key': { type: 'string' }, publisher: { type: 'string' }, schema: { type: 'string' },
  });
  if (!values.descriptor || !values['public-key']) usageAndExit('verify requires --descriptor and --public-key');
  const descriptor = readJson(values.descriptor, 'the descriptor');
  requireSchema(descriptor, resolve(values.schema ?? DEFAULT_SCHEMA));

  let publicKeyPem;
  try {
    publicKeyPem = readFileSync(resolve(values['public-key']), 'utf8');
    createPublicKey(publicKeyPem);
  } catch (error) {
    usageAndExit(`could not read the public key at ${values['public-key']}: ${error.message}`);
  }
  const publisherId = values.publisher ?? descriptor?.publisher;
  // A registry of exactly one key, so this asks the product's own verifier the same question an
  // installation asks it — never a second, more forgiving implementation kept in a tool.
  const registry = {
    findActiveKey: ({ publisherId: asked, fingerprint }) => (
      asked === publisherId && fingerprint === publicKeyFingerprint(createPublicKey(publicKeyPem))
        ? { publicKeyPem, trustLevel: null }
        : null
    ),
  };
  const result = verifyModelDescriptor({ descriptor, registry });
  if (result.verified) {
    out(`VERIFIED publisher=${result.publisherId} fingerprint=${result.fingerprint} signedAt=${result.signedAt ?? 'not stated'}`);
    out('  an installation that has registered this public key under this publisher id will accept this descriptor.');
  } else {
    process.stderr.write(`REFUSED ${result.kind}: ${result.reason}\n`);
    if (result.kind === 'KEY_NOT_TRUSTED') {
      process.stderr.write(`  --public-key does not match the key this descriptor was signed with, or the descriptor names a publisher other than "${publisherId}".\n`);
    }
    process.exit(EXIT.REFUSED);
  }
} else {
  usageAndExit(mode ? `unknown mode: ${mode}` : undefined);
}
