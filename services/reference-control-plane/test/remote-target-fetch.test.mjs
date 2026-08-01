// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0286, the SSH half proven against a REAL sshd — not mocked. `remote-target-fetch.mjs`
// spawns real `ssh-keyscan`/`ssh-keygen`/`scp`/`tar` binaries; a test that mocked
// `child_process.spawn` would prove this module calls `spawn` with plausible-looking
// arguments, not that a real fetch over SSH actually works, is actually verified against
// the pinned host key, and actually refuses on a wrong key or a changed host identity. This
// host carries a full OpenSSH client AND server (confirmed before writing this file), so
// the real thing is what gets tested.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { keyscanHost, fetchRemoteTarget, RemoteTargetFetchError } from '../src/remote-target-fetch.mjs';

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
    probe.on('error', reject);
  });
}

const workDir = mkdtempSync(join(tmpdir(), 'noesar-remote-target-test-'));
const hostKeyPath = join(workDir, 'ssh_host_ed25519_key');
const clientKeyPath = join(workDir, 'client_key');
const authorizedKeysPath = join(workDir, 'authorized_keys');
const remoteContentDir = join(workDir, 'remote_content');
const sshdConfigPath = join(workDir, 'sshd_config');
let sshdProcess = null;
let port = null;
let realPinnedHostKey = null;
let realFingerprint = null;
let clientPrivateKeyPem = null;

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

before(async () => {
  mkdirSync(remoteContentDir, { recursive: true });
  writeFileSync(join(remoteContentDir, 'db.py'), 'def raw_query(s):\n    return f"SELECT * FROM t WHERE x={s}"\n');
  mkdirSync(join(remoteContentDir, 'nested'), { recursive: true });
  writeFileSync(join(remoteContentDir, 'nested', 'util.py'), 'x = 1\n');

  run('ssh-keygen', ['-t', 'ed25519', '-f', hostKeyPath, '-N', '', '-q']);
  run('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q']);
  writeFileSync(authorizedKeysPath, await readFile(`${clientKeyPath}.pub`));
  clientPrivateKeyPem = await readFile(clientKeyPath, 'utf8');

  port = await freePort();
  writeFileSync(sshdConfigPath, [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${hostKeyPath}`,
    `AuthorizedKeysFile ${authorizedKeysPath}`,
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PubkeyAuthentication yes',
    'UsePAM no',
    'StrictModes no',
    'PidFile none',
    'Subsystem sftp /usr/libexec/sftp-server',
    'LogLevel ERROR',
  ].join('\n'));

  await new Promise((resolve, reject) => {
    sshdProcess = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', sshdConfigPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let started = false;
    const onReady = () => { if (!started) { started = true; resolve(); } };
    sshdProcess.stderr.on('data', (chunk) => { if (/Server listening/.test(chunk.toString())) onReady(); });
    sshdProcess.on('error', reject);
    sshdProcess.on('exit', (code) => { if (!started) reject(new Error(`sshd exited early with code ${code}`)); });
    // sshd normally logs "Server listening" immediately; a short fallback in case this
    // build's log wording differs, rather than hanging the suite forever.
    setTimeout(onReady, 1500);
  });

  const scanned = await keyscanHost({ host: '127.0.0.1', port });
  realPinnedHostKey = scanned.pinnedHostKey;
  realFingerprint = scanned.fingerprint;
});

after(() => {
  sshdProcess?.kill('SIGKILL');
  rmSync(workDir, { recursive: true, force: true });
});

describe('D-0286 — keyscanHost against a real sshd', () => {
  test('captures the real host key and a matching SHA256 fingerprint', () => {
    assert.match(realPinnedHostKey, /^\[127\.0\.0\.1\]:\d+ ssh-ed25519 /);
    assert.match(realFingerprint, /^SHA256:/);
    const localFingerprint = run('ssh-keygen', ['-lf', `${hostKeyPath}.pub`]);
    assert.ok(localFingerprint.includes(realFingerprint), `keyscan fingerprint must match the real host key's own: ${localFingerprint}`);
  });

  test('an unreachable host is reported as UNREACHABLE, not thrown as an unrecognised error', async () => {
    await assert.rejects(
      keyscanHost({ host: '127.0.0.1', port: 1 }),
      (error) => error instanceof RemoteTargetFetchError && error.kind === 'UNREACHABLE',
    );
  });
});

describe('D-0286 — fetchRemoteTarget against a real sshd, real scp, real files', () => {
  test('fetches the real remote directory tree, nested files included, packed as a real tar.gz', async () => {
    const target = {
      host: '127.0.0.1', port, username: process.env.USER || 'root',
      remotePath: remoteContentDir, pinnedHostKey: realPinnedHostKey,
    };
    const tarball = await fetchRemoteTarget({ target, privateKeyPem: clientPrivateKeyPem });
    assert.ok(Buffer.isBuffer(tarball));
    assert.ok(tarball.length > 0);

    const extractDir = mkdtempSync(join(tmpdir(), 'noesar-remote-target-extract-'));
    const tarPath = join(extractDir, 'fetched.tar.gz');
    writeFileSync(tarPath, tarball);
    run('tar', ['-xzf', tarPath, '-C', extractDir]);
    const dbPy = await readFile(join(extractDir, 'db.py'), 'utf8');
    assert.match(dbPy, /raw_query/);
    const nested = await readFile(join(extractDir, 'nested', 'util.py'), 'utf8');
    assert.equal(nested, 'x = 1\n');
    rmSync(extractDir, { recursive: true, force: true });
  });

  test('a host key that no longer matches the pinned one refuses the connection — HOST_KEY_MISMATCH, not a silent trust', async () => {
    const wrongPinnedHostKey = realPinnedHostKey.replace(/ssh-ed25519 \S+/, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINtotherealkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const target = { host: '127.0.0.1', port, username: process.env.USER || 'root', remotePath: remoteContentDir, pinnedHostKey: wrongPinnedHostKey };
    await assert.rejects(
      fetchRemoteTarget({ target, privateKeyPem: clientPrivateKeyPem, connectTimeoutSec: 5 }),
      (error) => error instanceof RemoteTargetFetchError && error.kind === 'HOST_KEY_MISMATCH',
    );
  });

  test('a key the server does not authorise is refused as AUTH_FAILED, not a hang', async () => {
    const strangerKeyPath = join(workDir, 'stranger_key');
    run('ssh-keygen', ['-t', 'ed25519', '-f', strangerKeyPath, '-N', '', '-q']);
    const strangerPrivateKeyPem = await readFile(strangerKeyPath, 'utf8');
    const target = { host: '127.0.0.1', port, username: process.env.USER || 'root', remotePath: remoteContentDir, pinnedHostKey: realPinnedHostKey };
    await assert.rejects(
      fetchRemoteTarget({ target, privateKeyPem: strangerPrivateKeyPem, connectTimeoutSec: 5 }),
      (error) => error instanceof RemoteTargetFetchError && error.kind === 'AUTH_FAILED',
    );
  });
});
