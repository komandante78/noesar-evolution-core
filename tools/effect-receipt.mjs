#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs any command against a disposable copy of a directory and writes a signed receipt of what
// it did, judged against what it declared (`effect-receipt.mjs`). The real directory is never
// written: the command runs in a throwaway container that sees only the copy.
//
//   node tools/effect-receipt.mjs keygen --out ./receipt-key
//   node tools/effect-receipt.mjs run --workspace ./app --declare node_modules/ \
//        --declare package.json --declare package-lock.json --declare ~/.npm/ \
//        --key ./receipt-key.pem --out receipt.json -- npm install ./left-pad-1.3.0.tgz
//   node tools/effect-receipt.mjs verify --in receipt.json --pub ./receipt-key.pub.pem
//
// `run` exits 0 only on CLEAN, so it can gate a pipeline; `verify` exits 0 only on a valid CLEAN.
// `~/` in a declaration means the HOME the command saw, which lives inside the copy.
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SRC = new URL('../services/reference-control-plane/src/', import.meta.url);
const { ShadowWorkspace } = await import(new URL('shadow.mjs', SRC));
const { receiptStatement, signReceipt, verifyReceipt, Verdict } = await import(new URL('effect-receipt.mjs', SRC));

// Pinned by digest, the same image the linter already runs: a runner that moves under the
// receipt would make two receipts of one command disagree for a reason neither records.
const IMAGE = process.env.NOESAR_RECEIPT_IMAGE
  ?? 'node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
const HOME_IN_COPY = '.receipt-home';

function parse(argv) {
  const dash = argv.indexOf('--');
  const flags = dash === -1 ? argv : argv.slice(0, dash);
  const options = { declare: [], command: dash === -1 ? [] : argv.slice(dash + 1) };
  for (let i = 0; i < flags.length; i += 1) {
    const name = flags[i].replace(/^--/, '');
    if (name === 'declare') options.declare.push(flags[++i]);
    else options[name] = flags[++i];
  }
  return options;
}

const fail = (message) => { process.stderr.write(`effect-receipt: ${message}\n`); process.exit(64); };

function keygen({ out }) {
  if (!out) fail('keygen needs --out <prefix>');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(`${out}.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(`${out}.pub.pem`, publicKey.export({ type: 'spki', format: 'pem' }));
  process.stdout.write(`wrote ${out}.pem (keep it) and ${out}.pub.pem (give it to verifiers)\n`);
}

function run(options) {
  if (options.command.length === 0) fail('run needs a command after --');
  if (!options.key) fail('run needs --key <private key pem>');
  const workspace = resolve(options.workspace ?? '.');
  const network = options.network ?? 'none';
  const scratch = mkdtempSync(join(tmpdir(), 'noesar-receipt-'));
  const startedAt = new Date().toISOString();
  let observation = null;
  let exitCode = null;
  let error = null;
  try {
    const shadow = ShadowWorkspace.ofWorkspace(workspace, join(scratch, 'copy'));
    mkdirSync(join(shadow.root, HOME_IN_COPY), { recursive: true });
    // As the person running it, not as root: files the command writes into the copy must be
    // removable by the same person afterwards, or the cleanup below fails on any machine where
    // the operator is not root (found writing the one-minute demo, 2026-09-22).
    const asCaller = typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
    const result = spawnSync('docker', ['run', '--rm', `--network=${network}`, ...asCaller,
      '-v', `${shadow.root}:/work`, '-w', '/work', '-e', `HOME=/work/${HOME_IN_COPY}`,
      IMAGE, ...options.command], { stdio: ['ignore', 'inherit', 'inherit'] });
    exitCode = result.error ? null : result.status;
    if (result.error) error = `the runner could not start: ${result.error.message}`;
    else {
      const seen = shadow.observe([{ name: options.command.join(' '), passed: result.status === 0 }]);
      const changed = {};
      for (const [path, change] of Object.entries(seen.changed)) {
        changed[path.startsWith(`${HOME_IN_COPY}/`) ? `~/${path.slice(HOME_IN_COPY.length + 1)}` : path] = change;
      }
      observation = { changed, tests: seen.tests };
    }
  } catch (caught) {
    // A copy that could not be made is a run that could not be measured — a receipt says so.
    error = caught.message;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const statement = receiptStatement({
    command: options.command,
    declared: options.declare,
    observation,
    runner: { kind: 'docker', image: IMAGE, network, exitCode, error },
    coverage: ['files in the workspace copy', 'files in the HOME the command saw', 'exit status of the declared command'],
    notMeasured: [
      ...(network === 'none' ? [] : ['network traffic (the network was reachable and was not recorded)']),
      'files written elsewhere in the container (discarded with it, not observed)',
      'processes started and system calls made',
    ],
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  const envelope = signReceipt(statement, createPrivateKey(readFileSync(options.key)));
  writeFileSync(options.out ?? 'receipt.json', `${JSON.stringify(envelope, null, 2)}\n`);
  const p = statement.predicate;
  process.stdout.write(`\nVERDICT ${p.verdict}\n`);
  if (error) process.stdout.write(`  not measured because: ${error}\n`);
  for (const path of p.surprise?.unexpected ?? []) process.stdout.write(`  undeclared: ${path} (${p.observed[path]})\n`);
  for (const name of p.surprise?.declaredCommandsThatFailed ?? []) process.stdout.write(`  failed: ${name}\n`);
  process.stdout.write(`  observed ${Object.keys(p.observed ?? {}).length} changed files; not measured: ${p.notMeasured.join('; ')}\n`);
  process.stdout.write(`  receipt: ${options.out ?? 'receipt.json'}\n`);
  process.exit(p.verdict === Verdict.CLEAN ? 0 : 2);
}

function check(options) {
  if (!options.in || !options.pub) fail('verify needs --in <receipt> and --pub <public key pem>');
  const result = verifyReceipt(JSON.parse(readFileSync(options.in, 'utf8')), createPublicKey(readFileSync(options.pub)));
  if (!result.valid) { process.stdout.write(`INVALID: ${result.reason}\n`); process.exit(3); }
  process.stdout.write(`VALID receipt, verdict ${result.verdict}; not measured: ${result.notMeasured.join('; ')}\n`);
  process.exit(result.verdict === Verdict.CLEAN ? 0 : 2);
}

const [verb, ...rest] = process.argv.slice(2);
const options = parse(rest);
if (verb === 'keygen') keygen(options);
else if (verb === 'run') run(options);
else if (verb === 'verify') check(options);
else fail('usage: effect-receipt keygen|run|verify (see the header of this file)');
