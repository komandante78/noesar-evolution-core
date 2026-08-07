// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-037 — "open ssh, type one word, be in", driven rather than asserted.
//
//   node tools/acceptance/ce-037-one-word.mjs [port]
//
// The Owner's requirement for `D-0348` is about a GESTURE, and a gesture is only ever proved
// by performing it. So this probe starts the real product from source, then runs the real
// `tools/coden-evolution` launcher — the same file the image installs and `ssh` reaches — as
// a child process, three times, and reads what the operator would have seen:
//
//   run 1  a fresh machine: the terminal asks, an attach code minted in the browser is typed,
//          and the terminal is remembered.
//   run 2  the requirement itself: NOTHING is typed except the command to leave, and the
//          session opens anyway.
//   run 3  `--forget`, and then a fourth run that has to ask again — because an undo that
//          does not undo is worse than no undo.
//
// Why the launcher and not the client. Phase 8 already paid for this distinction once: the
// client was fine and the launcher resolved `$0` to the symlink, so the shipped gesture was
// broken while every test of the client passed (s331). What the Owner types is the launcher.
//
// HOME is a throwaway directory, and the probe asserts the credential file appears UNDER it
// with mode 0600. That is not tidiness: the token is the whole authentication once the first
// run is done, so where it lands and who can read it is the security property.

import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.argv[2] ?? 8198);
const workspace = mkdtempSync(join(tmpdir(), 'ce037-ws-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'ce037-home-'));
const socketPath = join(workspace, 'tui.sock');
const setupTokenFile = join(workspace, 'setup.token');
const setupToken = `ce037-${randomBytes(24).toString('base64url')}`;
const PASSWORD = `ce037-${randomBytes(18).toString('base64url')}`;
const credentialFile = join(fakeHome, '.config', 'coden-evolution', 'terminals.json');

let failures = 0;
let checks = 0;
function check(ok, name, detail) {
  checks += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
  if (!ok) failures += 1;
}

const cookies = new Map();
function http(method, path, body, extraHeaders = {}) {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { host: `127.0.0.1:${port}`, ...extraHeaders };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    if (cookies.size) headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookies.has('noesar_csrf') && method !== 'GET') headers['x-noesar-csrf'] = cookies.get('noesar_csrf');
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        for (const line of res.headers['set-cookie'] ?? []) {
          const [pair] = String(line).split(';');
          const index = pair.indexOf('=');
          if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
        let json = null;
        try { json = JSON.parse(text); } catch { /* not every response is JSON */ }
        resolvePromise({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const STEP_MS = 30_000;
const usedSteps = new Set();
async function freshTotp(secret) {
  for (;;) {
    const now = Date.now();
    for (const offset of [-1, 0, 1]) {
      const step = (Math.floor(now / STEP_MS) + offset) * STEP_MS;
      if (usedSteps.has(step)) continue;
      usedSteps.add(step);
      return totpCode(secret, step);
    }
    await new Promise((r) => setTimeout(r, STEP_MS - (now % STEP_MS) + 250));
  }
}

/**
 * One run of the real launcher, with a scripted stdin and a throwaway HOME.
 *
 * `NOESAR_TUI_SOCKET_PATH` is how rung 1 finds the session — the same variable the product
 * sets for itself. Nothing else about the environment is inherited that would let the run
 * find a session by accident: this is the lesson of the `PATH` that still had `/usr/bin` on
 * it and quietly attached to the LIVE installation (s332).
 */
function runLauncher(input, args = []) {
  return new Promise((resolvePromise) => {
    const child = spawn(join(repoRoot, 'tools/coden-evolution'), args, {
      env: {
        PATH: process.env.PATH,
        HOME: fakeHome,
        NOESAR_TUI_SOCKET_PATH: socketPath,
        // No configuration file, so the launcher cannot be steered by one that happens to
        // exist on the machine running this probe.
        NOESAR_EVOLUTION_LAUNCHER_CONF: join(workspace, 'no-such-launcher.conf'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolvePromise({ code, out }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

writeFileSync(setupTokenFile, setupToken);
const server = spawn('node', [join(repoRoot, 'services/reference-control-plane/src/server.mjs')], {
  env: {
    ...process.env,
    NOESAR_WORKSPACE: workspace,
    NOESAR_PORT: String(port),
    NOESAR_HOST: '127.0.0.1',
    NOESAR_CODEV_PEER_SOCKET_PATH: socketPath,
    NOESAR_SETUP_TOKEN_FILE: setupTokenFile,
    NOESAR_LOCAL_MODEL_RUNTIME: 'disabled',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const alive = await http('GET', '/livez');
      if (alive.status === 200 && existsSync(socketPath)) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function stop() {
  server.kill('SIGTERM');
  rmSync(workspace, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
}

try {
  if (!await waitForServer()) {
    process.stdout.write(`the product did not come up:\n${serverLog}\n`);
    stop();
    process.exit(2);
  }

  const begun = await http('POST', '/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': setupToken });
  const totpSecret = begun.json?.totpSecret;
  const confirmed = await http('POST', '/api/v1/auth/setup/confirm', { challenge: begun.json?.challenge, totpCode: await freshTotp(totpSecret) });
  if (confirmed.status !== 201) {
    process.stdout.write(`owner bootstrap failed: ${begun.status}/${confirmed.status} ${confirmed.text}\n${serverLog}\n`);
    stop();
    process.exit(2);
  }

  // --- run 1: a fresh machine. The browser mints, the terminal spends, and is remembered.
  const minted = await http('POST', '/api/v1/auth/attach-code');
  // 201, not 200: minting CREATES a code. Written down because the first version of this
  // probe asserted 200 and went red against a product that was right — the same mistake
  // `D-0334` catalogued, a check asserting the prober's expectation rather than the contract.
  check(minted.status === 201 && Boolean(minted.json?.code), 'the browser can mint an attach code', `status ${minted.status}`);

  const first = await runLauncher(`${minted.json.code}\nexit\n`);
  check(/attaching via socket/.test(first.out), 'run 1 · the launcher declares which rung it used');
  check(/Signed in as owner/.test(first.out), 'run 1 · the attach code signed the terminal in', first.out.slice(-160).trim());
  check(/now remembered/.test(first.out), 'run 1 · the terminal says it has been remembered');
  check(existsSync(credentialFile), 'run 1 · the credential landed under HOME', credentialFile);
  check(existsSync(credentialFile) && (statSync(credentialFile).mode & 0o777) === 0o600,
    'run 1 · and nobody but its owner can read it');
  const stored = existsSync(credentialFile) ? JSON.parse(readFileSync(credentialFile, 'utf8')) : {};
  check(Boolean(stored.terminals?.[socketPath]?.token), 'run 1 · the token is keyed by the endpoint it opens');

  // --- run 2: THE REQUIREMENT. Nothing typed but the word that leaves.
  const second = await runLauncher('exit\n');
  check(/Opened from this remembered terminal/.test(second.out), 'run 2 · ONE WORD: the session opened with nothing typed',
    second.out.split('\n').filter(Boolean).slice(0, 3).join(' | '));
  check(!/Attach code/.test(second.out), 'run 2 · and it never asked for a code');
  check(!/Username:/.test(second.out), 'run 2 · nor for credentials');
  check(/Signed in as owner/.test(second.out), 'run 2 · as the same account that enrolled it');

  // --- run 3: the undo, and the proof that it really undid something.
  const forgotten = await runLauncher('', ['--forget']);
  check(/no longer remembered/.test(forgotten.out), 'run 3 · --forget says the terminal was forgotten', forgotten.out.trim().slice(0, 120));
  const afterForget = existsSync(credentialFile) ? JSON.parse(readFileSync(credentialFile, 'utf8')) : { terminals: {} };
  check(!afterForget.terminals?.[socketPath], 'run 3 · and the local copy is gone');

  const fourth = await runLauncher('\n\n\n');
  check(/Attach code/.test(fourth.out), 'run 4 · a forgotten terminal asks again — the undo is real',
    fourth.out.split('\n').filter(Boolean).slice(-2).join(' | '));

  // --- and the server side of the undo: the token itself must be dead, not merely deleted
  // locally. A revocation that only removes the client's copy leaves a live credential in the
  // store for anyone who kept one.
  const revived = await runLauncher('exit\n');
  check(!/Opened from this remembered terminal/.test(revived.out),
    'run 5 · the forgotten token cannot open a session even if a copy survives');

  process.stdout.write(`\nCE037_CHECKS=${checks}  CE037_FAILURES=${failures}\n`);
} catch (error) {
  process.stdout.write(`the probe itself failed: ${error.stack}\n${serverLog}\n`);
  failures += 1;
} finally {
  stop();
}

process.exit(failures === 0 ? 0 : 1);
