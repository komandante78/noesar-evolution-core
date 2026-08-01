// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0286: the SSH half of Debug Evolution's Phase 3. Two operations, both real subprocess
// calls to `openssh-client` binaries (`ssh-keyscan`, `ssh-keygen`, `scp`) plus `tar` — no
// third-party SSH library, following the one convention this codebase already has for
// running an external program (`sandbox-runner.mjs`'s own words: "spawn(command, argv),
// never a shell string. A command built as text and handed to a shell is a command an
// operator-supplied value can extend"). `argv` form throughout; no user-supplied value is
// ever concatenated into a command string.
//
// `keyscanHost()` runs at REGISTRATION time and captures the host's own public key — not a
// secret, this is what `remote-target-registry.mjs`'s `pinnedHostKey` stores and what
// `fetchRemoteTarget()` later verifies every connection against. Capturing a fingerprint
// alone and not the full key would be security theatre: `ssh`/`scp` verify a connection
// against the actual public key via `known_hosts`, not against a hash of it — the fingerprint
// is what a human reads to confirm, the full key is what the machine checks.
//
// `fetchRemoteTarget()` writes the decrypted private key and the pinned host key to a
// temporary directory for the duration of one `scp` call — `openssh-client`'s tools take a
// key by file path, not by argument or stdin. Unlike `sandbox-runner.mjs`'s own temp spec
// file ("never contains a secret... a leaked temp file is a cleanliness defect, not a
// security one"), THIS temp directory does hold a secret, so cleanup here is unconditional
// (`finally`) and the directory is created with `0700` before anything is written into it —
// belt and braces on top of `/tmp` already being this process's own `tmpfs` (RAM, not
// persistent disk; server.mjs's own container config mounts it that way).

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class RemoteTargetFetchError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'RemoteTargetFetchError';
    this.kind = kind;
    this.reason = reason;
  }
}

const KEY_PREFERENCE = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa'];

function runCapture(command, argv, { timeoutMs = 30_000, input } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new RemoteTargetFetchError('UNAVAILABLE', `cannot start ${command}: ${error.message}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { clearTimeout(timer); reject(new RemoteTargetFetchError('UNAVAILABLE', `${command} process error: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Captures the host's own SSH public key and its human-readable fingerprint, for the Owner
 * to confirm before a target is ever active. `ssh-keyscan` already emits the bracketed
 * `[host]:port` form for a non-default port on its own, which is the exact form `ssh`/`scp`
 * expect to find in `known_hosts` later — nothing here needs to special-case the port.
 */
export async function keyscanHost({ host, port = 22 }) {
  const scan = await runCapture('ssh-keyscan', ['-T', '10', '-p', String(port), String(host)]);
  if (scan.timedOut) throw new RemoteTargetFetchError('UNREACHABLE', `timed out reaching ${host}:${port} for a host key`);
  const lines = scan.stdout.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (!lines.length) throw new RemoteTargetFetchError('UNREACHABLE', `no host key offered by ${host}:${port} — is it reachable and running sshd?`);

  const byType = new Map();
  for (const line of lines) {
    const parts = line.split(' ');
    const keyType = parts[1];
    if (keyType) byType.set(keyType, line);
  }
  const chosenType = KEY_PREFERENCE.find((type) => byType.has(type));
  const pinnedHostKey = chosenType ? byType.get(chosenType) : lines[0];

  const workDir = await mkdtemp(join(tmpdir(), 'noesar-remote-target-'));
  try {
    const keyFile = join(workDir, 'host_key');
    await writeFile(keyFile, `${pinnedHostKey}\n`, { mode: 0o600 });
    const fingerprinted = await runCapture('ssh-keygen', ['-lf', keyFile]);
    if (fingerprinted.code !== 0) throw new RemoteTargetFetchError('INVALID', `could not compute a fingerprint for the host key offered by ${host}:${port}`);
    // "256 SHA256:xxxxxxxx host (ED25519)" -- the fingerprint token is the one field an
    // Owner actually compares against what they already know about this host.
    const fingerprint = fingerprinted.stdout.trim().split(/\s+/).find((token) => token.startsWith('SHA256:')) ?? fingerprinted.stdout.trim();
    return { pinnedHostKey, fingerprint };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Fetches `target.remotePath` over `scp -r`, verified against `target.pinnedHostKey`
 * (`StrictHostKeyChecking=yes` — never disabled; a mismatch fails the connection instead of
 * silently trusting an identity that changed since registration), then packs the result as a
 * `.tar.gz` buffer — `debug-evolution-bridge.mjs` is the one place that then uploads it to
 * Debug Evolution's own `POST /api/v2/projects/import`. This function never sees Debug
 * Evolution at all, the same separation `debug-evolution-triage.mjs`'s pure functions keep
 * from `debug-evolution-bridge.mjs`'s I/O.
 */
export async function fetchRemoteTarget({ target, privateKeyPem, connectTimeoutSec = 15, scpTimeoutMs = 120_000 }) {
  const workDir = await mkdtemp(join(tmpdir(), 'noesar-remote-target-'));
  try {
    const keyFile = join(workDir, 'id_key');
    const knownHostsFile = join(workDir, 'known_hosts');
    const fetchedDir = join(workDir, 'fetched');
    await writeFile(keyFile, privateKeyPem.endsWith('\n') ? privateKeyPem : `${privateKeyPem}\n`, { mode: 0o600 });
    await writeFile(knownHostsFile, `${target.pinnedHostKey}\n`, { mode: 0o600 });
    await mkdir(fetchedDir, { recursive: true, mode: 0o700 });

    // Trailing `/.` copies the CONTENTS of remotePath into fetchedDir, not remotePath itself
    // as a subdirectory of it -- the same convention `cp -r src/. dest` uses.
    const remoteSource = `${target.username}@${target.host}:${target.remotePath.replace(/\/$/, '')}/.`;
    const scpArgs = [
      '-r', '-P', String(target.port),
      '-i', keyFile,
      '-o', `UserKnownHostsFile=${knownHostsFile}`,
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${connectTimeoutSec}`,
      remoteSource, fetchedDir,
    ];
    const copied = await runCapture('scp', scpArgs, { timeoutMs: scpTimeoutMs });
    if (copied.timedOut) throw new RemoteTargetFetchError('TIMEOUT', `fetching ${target.host}:${target.remotePath} did not finish in time`);
    if (copied.code !== 0) {
      const reason = copied.stderr.trim() || `scp exited ${copied.code}`;
      if (/Host key verification failed/i.test(reason)) throw new RemoteTargetFetchError('HOST_KEY_MISMATCH', `the host key offered by ${target.host}:${target.port} no longer matches the one pinned at registration — this must be investigated before retrying, not retried blindly`);
      if (/Permission denied|Authentication failed/i.test(reason)) throw new RemoteTargetFetchError('AUTH_FAILED', `${target.username}@${target.host} refused the configured key: ${reason}`);
      throw new RemoteTargetFetchError('FETCH_FAILED', reason);
    }

    const tarPath = join(workDir, 'target.tar.gz');
    const tarred = await runCapture('tar', ['-czf', tarPath, '-C', fetchedDir, '.']);
    if (tarred.code !== 0) throw new RemoteTargetFetchError('FETCH_FAILED', `packing the fetched files failed: ${tarred.stderr.trim() || tarred.code}`);

    return await readFile(tarPath);
  } finally {
    // Unconditional, unlike sandbox-runner.mjs's spec-file cleanup: this directory held a
    // private key, not six integers. `.catch()` only swallows a failure to remove an
    // already-ephemeral tmpfs directory, never the key material itself, which is gone the
    // moment the container's tmpfs reclaims it regardless.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
