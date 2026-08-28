#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Install ANY GGUF on this installation, in one command — Owner, 2026-08-28: «i modelli devono
// poter essere messi tutti, anche custom».
//
// # Why this is a wrapper and not a new trust model
//
// The instinct on being told "any model must be installable" is to remove the check that stops
// some of them starting. That would have been wrong twice over. The check is `MC-004` and
// `F-MODEL-AUTH-001`, it took real work, and it is not what was in the way.
//
// What was in the way is that installing a model by hand means knowing the descriptor schema,
// that the signature is computed over the document with its own `signature` field removed, that
// the fingerprint is a sha256 over the SPKI DER of the public key, and where the catalogue lives.
// `tools/sign-model-descriptor.mjs` already says this in its own header: *"a requirement nobody
// can meet is a requirement that will be worked around — by disabling the check"*. This file is
// the rest of that sentence: it makes the requirement meetable, so nobody has to disable it.
//
// Everything it needs already existed and none of it was written here:
//
//   - the owner's signing key            `publishers/noesar-signing-key.pem`, created by the
//                                        server on first use, 0600, and already registered —
//                                        its fingerprint matches the registry's active key
//   - the signature over the descriptor  `signModelDescriptor()` from verified-acquisition
//   - the schema                         `schemas/model-descriptor.schema.json`
//   - the layout                         `models/catalog/<id>.json` + a symlink in
//                                        `models/artefacts/<id>.bin`
//
// On this installation the OWNER IS THE PUBLISHER. That is not a loophole in the rule, it is what
// the rule means on a machine somebody runs themselves: the signature stops a descriptor that
// appeared in the catalogue from being believed merely because it is there, and it still does.
//
// # What it reads out of the file, and why that matters more than it sounds
//
// It parses the GGUF header for `general.architecture` and the block count. Two reasons, both
// measured on 2026-08-28 while installing Qwen3.8-27B:
//
//   1. The bundled llama.cpp knows a fixed list of architectures. A model whose architecture is
//      not on it does not start, and finding that out AFTER a 16 GB download and a signature is
//      finding it out three steps too late.
//   2. The block count is the number you need to split a model between the card and RAM. Nothing
//      else in this product knows it — the runtime only learns it when the model is already open
//      — so a person choosing a hybrid split was choosing blind.
//
// Usage:
//   node tools/model-install.mjs --gguf <file> --id <id> [--gpu-layers N] [--context N]
//                                [--port N] [--runtime-path P] [--license L] [--force]
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, openSync, readSync, closeSync, statSync,
  readFileSync, writeFileSync, symlinkSync, unlinkSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signModelDescriptor, validateAgainstSchema, formatSchemaErrors,
} from '../packages/verified-acquisition/src/index.mjs';
import { recommendPlacement } from '../services/reference-control-plane/src/local-model-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, '..', 'schemas', 'model-descriptor.schema.json');
const EXIT = { USAGE: 2, SCHEMA: 3, REFUSED: 4 };
const out = (line) => process.stdout.write(`${line}\n`);
const die = (message, code = EXIT.USAGE) => { process.stderr.write(`${message}\n`); process.exit(code); };

/**
 * The architectures the bundled runtime can actually open.
 *
 * Read out of `libllama.so` rather than hardcoded, because a hardcoded list is a claim that goes
 * stale the first time the runtime is rebuilt — and this product has already paid for one of
 * those. When the library cannot be found the check is SKIPPED and says so: an unavailable
 * measurement must never read as a pass.
 */
function architecturesTheRuntimeKnows(libraryPath) {
  if (!libraryPath || !existsSync(libraryPath)) return null;
  const text = readFileSync(libraryPath).toString('latin1');
  const found = new Set();
  for (const match of text.matchAll(/[a-z][a-z0-9._-]{2,30}/g)) {
    if (match[0].endsWith('.cpp')) found.add(match[0].slice(0, -4));
  }
  return found.size ? found : null;
}

/** GGUF v2/v3 header: magic, version, tensor count, kv count, then the key/value pairs. */
function readGgufHeader(path, budget = 4 * 1024 * 1024) {
  const fd = openSync(path, 'r');
  const size = statSync(path).size;
  const buf = Buffer.alloc(Math.min(budget, size));
  readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  if (buf.toString('latin1', 0, 4) !== 'GGUF') die(`${path} is not a GGUF file`, EXIT.REFUSED);

  const kvCount = Number(buf.readBigUInt64LE(16));
  const WIDTH = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  let at = 24;
  const str = () => { const n = Number(buf.readBigUInt64LE(at)); at += 8; const s = buf.toString('utf8', at, at + n); at += n; return s; };
  const kv = {};
  for (let i = 0; i < kvCount; i += 1) {
    // A header larger than the slice read is not an error — everything this tool needs is at the
    // front. It stops where the data stops rather than reading past it.
    if (at > buf.length - 32) break;
    const key = str();
    const type = buf.readUInt32LE(at); at += 4;
    if (type === 8) { kv[key] = str(); continue; }
    if (type === 9) {
      const itemType = buf.readUInt32LE(at); at += 4;
      const n = Number(buf.readBigUInt64LE(at)); at += 8;
      if (itemType === 8) { for (let j = 0; j < n && at < buf.length - 8; j += 1) str(); } else { at += n * (WIDTH[itemType] ?? 4); }
      kv[key] = `[${n} items]`;
      continue;
    }
    if (type === 6) { kv[key] = buf.readFloatLE(at); at += 4; continue; }
    if (type === 7) { kv[key] = Boolean(buf[at]); at += 1; continue; }
    if (type === 10 || type === 11) { kv[key] = Number(buf.readBigInt64LE(at)); at += 8; continue; }
    if (type === 4 || type === 5) { kv[key] = buf.readUInt32LE(at); at += 4; continue; }
    kv[key] = buf.readUInt32LE(at); at += WIDTH[type] ?? 4;
  }
  const architecture = kv['general.architecture'] ?? null;
  return {
    architecture,
    name: kv['general.name'] ?? null,
    blockCount: kv[`${architecture}.block_count`] ?? null,
    contextLength: kv[`${architecture}.context_length`] ?? null,
  };
}

/**
 * Free memory on the card, in MiB, asked of `nvidia-smi` — the same source the runtime's own
 * detection uses. No card, no driver, or no answer is `null`, which `recommendPlacement()` reports
 * as "not worked out" rather than turning into a recommendation nobody measured.
 */
function vram() {
  try {
    const answer = execFileSync('nvidia-smi', ['--query-gpu=memory.free,memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 });
    const [free, total] = String(answer).trim().split('\n')[0].split(',').map((part) => Number(part.trim()));
    return { free: Number.isFinite(free) ? free : null, total: Number.isFinite(total) ? total : null };
  } catch { return { free: null, total: null }; }
}

/** Streamed, because a model is bigger than `readFileSync` will hand back in one Buffer. */
function sha256OfFile(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(8 * 1024 * 1024);
  try {
    for (let at = 0; ;) {
      const read = readSync(fd, buf, 0, buf.length, at);
      if (read <= 0) break;
      hash.update(buf.subarray(0, read));
      at += read;
    }
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

const args = (() => {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: {
        gguf: { type: 'string' }, id: { type: 'string' },
        'gpu-layers': { type: 'string' }, context: { type: 'string' }, port: { type: 'string' },
        'runtime-path': { type: 'string' }, license: { type: 'string' }, workspace: { type: 'string' },
        'llama-lib': { type: 'string' }, force: { type: 'boolean' },
      },
    }).values;
  } catch (error) { return die(error.message); }
})();

if (!args.gguf || !args.id) {
  die('usage: model-install.mjs --gguf <file> --id <id> [--gpu-layers N] [--context N] [--port N] [--runtime-path P] [--license L] [--force]');
}
if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(args.id)) die('--id must be a short filesystem-safe name');

const ggufPath = resolve(args.gguf);
if (!existsSync(ggufPath)) die(`no such file: ${ggufPath}`);

const workspace = args.workspace ?? process.env.NOESAR_WORKSPACE ?? '/mnt/cachec/NOESAR_EVOLUTION_RUNTIME';
const keyPath = join(workspace, 'publishers', 'noesar-signing-key.pem');
if (!existsSync(keyPath)) {
  die(`the owner signing key is not at ${keyPath}. The server creates it the first time it signs something; start the product once, or pass --workspace.`, EXIT.REFUSED);
}

// The path as the RUNTIME sees it, which is not the path this tool reads: the model store is
// mounted read-only at /models inside the container. Explicit, with the default that is right
// here, because guessing a mount layout is how a descriptor comes to name a file nothing can open.
const runtimePath = args['runtime-path'] ?? `/models/${basename(ggufPath)}`;

const header = readGgufHeader(ggufPath);
const known = architecturesTheRuntimeKnows(args['llama-lib'] ?? null);

out(`file          ${ggufPath}`);
out(`size          ${(statSync(ggufPath).size / 1024 ** 3).toFixed(2)} GiB`);
out(`architecture  ${header.architecture ?? 'unknown'}`);
out(`layers        ${header.blockCount ?? 'unknown'}`);
out(`context       ${header.contextLength ?? 'unknown'}`);
if (known && header.architecture) {
  if (known.has(header.architecture)) {
    out(`runtime       knows "${header.architecture}" — it will open`);
  } else if (!args.force) {
    die(`REFUSED the bundled runtime does not know the architecture "${header.architecture}". It will not open this file, and signing it would only move the failure later. Rebuild the runtime, or pass --force to install it anyway.`, EXIT.REFUSED);
  } else {
    out(`runtime       does NOT know "${header.architecture}" — installing anyway (--force)`);
  }
} else {
  out('runtime       NOT CHECKED — pass --llama-lib <libllama.so> to have it checked');
}

// The split. `--gpu-layers` is the one knob that decides gpu / ram / hybrid, and it is written
// into the descriptor so the model has a sensible default of its own; the placement chosen on the
// Models page overrides it at any time without reinstalling anything.
//
// Owner, 2026-08-28: «quando si scarica un modello in automatico c'è la scelta di come usarlo e le
// raccomandazioni». So NOT specifying `--gpu-layers` no longer means 99 — a number that was a
// guess about somebody else's card. It means: work it out, from this card and this file, with
// `recommendPlacement()` — the same function the page calls, so the command line and the screen
// can never recommend two different things.
const sizeBytes = statSync(ggufPath).size;
const card = vram();

// TWO answers, and the difference between them matters. Measured while writing this: run against
// `memory.free` with the previous model still resident, the tool recommended SIX layers — because
// the 27B being placed was itself holding 9.5 GB of the card. The memory free right now is not
// the memory this model will have, since it releases its own before it restarts.
//
// So the default comes from the EMPTY card, which is the state a model actually starts in: a
// model is freed before another is used, and this product's own page makes you do that. The
// "as it is now" figure is still printed, because a person about to run two things at once needs
// to see it — but it is not what the recommendation is built on.
const onEmptyCard = recommendPlacement({ layers: header.blockCount ?? null, bytes: sizeBytes, freeVramMiB: card.total });
const rightNow = recommendPlacement({ layers: header.blockCount ?? null, bytes: sizeBytes, freeVramMiB: card.free });
if (onEmptyCard.known) {
  out(`card          ${card.total} MiB total · ${card.free} MiB free right now`);
  out(`recommended   ${onEmptyCard.reason}`);
  if (rightNow.known && rightNow.maxLayers !== onEmptyCard.maxLayers) {
    out(`              with the card as it is now, only ${rightNow.maxLayers} would fit — free the running model first`);
  }
} else {
  out(`recommended   NOT WORKED OUT — ${onEmptyCard.reason}`);
}

const layers = args['gpu-layers'] != null ? Number(args['gpu-layers'])
  : onEmptyCard.known ? onEmptyCard.recommended
    : 99;
if (!Number.isInteger(layers) || layers < 0) die('--gpu-layers must be an integer of 0 or more (0 = every layer in RAM)');
const context = Number(args.context ?? 16384);
if (!Number.isInteger(context) || context < 512) die('--context must be an integer of at least 512');
const port = Number(args.port ?? 8420);

const placement = layers === 0 ? 'RAM only'
  : (header.blockCount && layers < header.blockCount) ? `hybrid — ${layers} of ${header.blockCount} layers on the card, ${header.blockCount - layers} in RAM`
    : 'every layer on the card';
out(`placement     ${placement}${args['gpu-layers'] != null ? ' (you chose this)' : ' (recommended)'}`);

out('hashing…');
const digest = sha256OfFile(ggufPath);
out(`sha256        ${digest}`);

const descriptor = {
  id: args.id,
  version: String(header.name ?? args.id),
  publisher: 'noesar',
  source: 'local',
  license: args.license ?? 'unknown',
  hashes: { sha256: digest },
  formats: ['gguf'],
  quantizations: [/q\d[_a-z0-9]*/i.exec(basename(ggufPath))?.[0]?.toLowerCase() ?? 'unknown'],
  workloads: ['text'],
  runtime_adapters: ['llama.cpp'],
  resource_profiles: [{
    name: layers === 0 ? 'cpu' : 'gpu',
    // The two numbers the Models page needs to work out where this model fits, and the only
    // place in the product that ever has the file open to read them. Inside the SIGNED document,
    // which is where a fact about a file belongs — and `resource_profiles` items are an open
    // object in the schema, so this costs no schema change.
    layers: header.blockCount ?? null,
    bytes: sizeBytes,
    architecture: header.architecture ?? null,
    note: `${header.architecture ?? 'gguf'} · ${header.blockCount ?? '?'} layers · installed by the owner of this installation · ${placement}`,
  }],
  context: { window: context },
  launchCommand: [
    '/opt/noesar/llama-runtime/ld-linux-x86-64.so.2',
    '--library-path', '/opt/noesar/llama-runtime:/usr/lib64',
    '/opt/noesar/llama-runtime/llama-server',
    '-m', runtimePath,
    '--host', '127.0.0.1', '--port', String(port),
    '-ngl', String(layers),
    '-c', String(context),
    '-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0',
    '-np', '1', '--jinja',
  ],
  endpoint: `http://127.0.0.1:${port}/`,
};

// Schema first, signature second — the same order and the same reason as the signing tool: a
// valid signature over a malformed document fails downstream for an unrelated reason, and the
// two failures are indistinguishable to whoever has to fix them.
const { valid, errors } = validateAgainstSchema(descriptor, JSON.parse(readFileSync(SCHEMA, 'utf8')));
if (!valid) {
  process.stderr.write(`REFUSED the descriptor this tool built does not match the schema\n${formatSchemaErrors(errors)}\n`);
  process.exit(EXIT.SCHEMA);
}

// `signModelDescriptor` takes the PEM and derives the fingerprint itself — the tool does not get
// to state one, which is the right shape: a fingerprint a caller supplies is a fingerprint a
// caller can get wrong.
const signed = signModelDescriptor(descriptor, readFileSync(keyPath, 'utf8'));

const catalogDir = join(workspace, 'models', 'catalog');
const artefactDir = join(workspace, 'models', 'artefacts');
mkdirSync(catalogDir, { recursive: true });
mkdirSync(artefactDir, { recursive: true });
const catalogFile = join(catalogDir, `${args.id}.json`);
if (existsSync(catalogFile) && !args.force) die(`${catalogFile} already exists — pass --force to replace it`, EXIT.REFUSED);
writeFileSync(catalogFile, `${JSON.stringify(signed, null, 2)}\n`, { mode: 0o644 });

// The artefact entry is a symlink to the path THE RUNTIME sees, matching what is already in this
// directory. It is deliberately not a copy: a second sixteen-gigabyte file to keep in step with
// the first is a way to have two models that disagree.
const artefactFile = join(artefactDir, `${args.id}.bin`);
if (existsSync(artefactFile) || args.force) { try { unlinkSync(artefactFile); } catch { /* nothing there */ } }
symlinkSync(runtimePath, artefactFile);

out('');
out(`INSTALLED     ${catalogFile}`);
out(`              ${artefactFile} -> ${runtimePath}`);
out(`              signed by publisher "noesar" (${signed.signature.publicKeyFingerprint.slice(0, 16)}…)`);
out('');
out(`Start it from the Models page, or:  PUT /api/v1/runtime/local-model {"model":"${args.id}"}`);
out(`Move it between card and RAM without reinstalling:  PUT /api/v1/runtime/local-model {"gpuLayers":N}`);
