// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-021 — "the two shells show the same live session, and detaching does not stop the
// work", proved the way the matrix asks for it: start in one shell, detach, attach from the
// other. Not asserted from the architecture; driven.
//
//   node tools/acceptance/ce-021-two-shells.mjs [port]
//
// Self-contained on purpose, unlike a1…a3 which are pointed at a server someone else
// started: this probe needs ONE process serving BOTH transports, and it needs to kill
// connections at moments of its own choosing. So it starts a real server from source
// against a throwaway workspace, drives the real HTTP bridge with a real cookie/CSRF
// session and the real unix socket with a real MFA login, and removes everything after.
//
// What "the two shells" means here is exact:
//   - the BROWSER shell reaches the engine over POST /api/v1/tui/command (server.mjs),
//   - the TERMINAL shell reaches it over the unix socket (session-protocol.mjs),
//   - and both are the same running instances, which is the claim under test.
//
// Detaching is done the way a shell really dies — `socket.destroy()`, a dropped TCP/unix
// connection with no goodbye — not `exit`, which would prove only that a clean shutdown is
// clean.
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.argv[2] ?? 8199);
const workspace = mkdtempSync(join(tmpdir(), 'ce021-ws-'));
const socketPath = join(workspace, 'tui.sock');
const setupTokenFile = join(workspace, 'setup.token');
const setupToken = `ce021-${randomBytes(24).toString('base64url')}`;
const PASSWORD = `ce021-${randomBytes(18).toString('base64url')}`;

let failures = 0;
function check(ok, name, detail) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
  if (!ok) failures += 1;
}

// --- the browser shell: real cookies, real CSRF, real route ------------------------------
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
/** One command through the browser's own bridge — the route its Terminal tab posts to. */
const browserCommand = (method, params) => http('POST', '/api/v1/tui/command', { method, params });

// --- the terminal shell: real unix socket, real MFA login --------------------------------
class TerminalShell {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let index = this.buffer.indexOf('\n');
      while (index !== -1) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        index = this.buffer.indexOf('\n');
        if (!line) continue;
        const frame = JSON.parse(line);
        if (frame.protocol) continue;
        const waiting = this.pending.get(frame.id);
        if (!waiting) continue;
        this.pending.delete(frame.id);
        frame.ok ? waiting.resolve(frame.result) : waiting.reject(Object.assign(new Error(frame.error.reason), { kind: frame.error.kind }));
      }
    });
    socket.on('error', () => { /* a killed shell is not an error here; it is the experiment */ });
  }

  call(method, params) {
    const id = String(this.nextId++);
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  /** Write a request and kill the connection in the same tick — a shell that dies with its
   *  command in flight, which is the interesting half of "detaching does not stop the work". */
  fireAndDie(method, params) {
    this.socket.write(`${JSON.stringify({ id: String(this.nextId++), method, params })}\n`);
    this.socket.destroy();
  }

  detach() { this.socket.destroy(); }
}

/** A second-factor code nobody has used yet.
 *
 *  The server accepts a ±1-step window (auth-crypto.mjs) and consumes each code, so three
 *  logins can happen back to back and the fourth has to wait for the window to move. This
 *  probe signs in four times on purpose — the shells it kills have to come back — so the
 *  wait is real rather than something to design around: a code replayed to save 30 seconds
 *  would be testing the authenticator, not the shells. */
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

async function attachTerminal(totpSecret) {
  const socket = connect(socketPath);
  await new Promise((resolvePromise, reject) => {
    socket.once('connect', resolvePromise);
    socket.once('error', reject);
  });
  await new Promise((resolvePromise) => socket.once('data', resolvePromise)); // the handshake
  const shell = new TerminalShell(socket);
  const begun = await shell.call('auth.login', { username: 'owner', password: PASSWORD });
  await shell.call('auth.mfa', { challenge: begun.challenge, totpCode: await freshTotp(totpSecret) });
  return shell;
}

// --- the product, started for real -------------------------------------------------------
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

function stopServer() {
  server.kill('SIGTERM');
  rmSync(workspace, { recursive: true, force: true });
}

try {
  if (!await waitForServer()) {
    process.stdout.write(`the product did not come up:\n${serverLog}\n`);
    stopServer();
    process.exit(2);
  }

  // One owner, reached by both shells — the same account, because CE-021 is about one
  // session being visible from two places, not about two identities.
  const begun = await http('POST', '/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': setupToken });
  const totpSecret = begun.json?.totpSecret;
  const confirmed = await http('POST', '/api/v1/auth/setup/confirm', { challenge: begun.json?.challenge, totpCode: await freshTotp(totpSecret) });
  if (confirmed.status !== 201) {
    process.stdout.write(`owner bootstrap failed: ${begun.status}/${confirmed.status} ${confirmed.text}\n${serverLog}\n`);
    stopServer();
    process.exit(2);
  }

  // 1 — the terminal starts a piece of work, then dies without warning.
  const terminal = await attachTerminal(totpSecret);
  const started = await terminal.call('workspace.plan', {
    request: 'CE-021: started in the terminal shell', files: [{ path: 'from-terminal.txt', contents: 'one engine\n' }],
  });
  // The status is asserted against what the ENGINE answered, not against what a shell chose
  // to display. That distinction found a defect the first time this probe ran: `plan()`
  // returned no status at all, and both shells were printing the constant they expected.
  check(Boolean(started.runId) && started.status === 'PENDING_APPROVAL',
    'the terminal shell starts a piece of work', `${started.runId} ${started.status}`);
  terminal.detach();

  // 2 — the browser, a different transport entirely, is looking at the same run.
  const seenByBrowser = await browserCommand('workspace.get', { runId: started.runId });
  check(seenByBrowser.status === 200 && seenByBrowser.json?.result?.runId === started.runId
    && seenByBrowser.json.result.status === 'PENDING_APPROVAL',
  'the browser shell sees it after the terminal is gone',
  `${seenByBrowser.status} ${seenByBrowser.json?.result?.status}`);

  // 3 — and can finish it. The work outlived the shell that created it.
  // `D-0567`/`CE-008` split what used to be one step into two: a run must be MEASURED —
  // executed in a shadow, its claims recomputed — before an approval against it means
  // anything. The browser does both here; the decision under test is still approve()'s.
  await browserCommand('workspace.measure', { runId: started.runId });
  const approvedByBrowser = await browserCommand('workspace.approve', { runId: started.runId });
  check(approvedByBrowser.status === 200 && approvedByBrowser.json?.result?.promoted === true,
    'the browser shell finishes what the terminal started', `promoted=${approvedByBrowser.json?.result?.promoted}`);

  // 4 — a NEW terminal attaches and sees the finished state, and one causal trail carries
  //     both halves. Two engines would have produced two trails, or one with a hole in it.
  const terminalAgain = await attachTerminal(totpSecret);
  const afterReattach = await terminalAgain.call('workspace.get', { runId: started.runId });
  check(afterReattach.status !== 'PENDING_APPROVAL',
    'a re-attached terminal sees the state the browser left', afterReattach.status);
  const trail = await terminalAgain.call('events.correlation', { correlationId: started.runId });
  const actions = trail.events.map((event) => event.action);
  check(actions.includes('workspace_action.planned') && actions.includes('workspace_action.promoted'),
    'one causal trail carries both shells\' halves of the work', actions.join(' → '));

  // 5 — what the two shells do NOT share, measured rather than assumed. This is not a
  //     failure: the socket carries methods the browser reaches through surfaces of its
  //     own (its Sessions page, its Invariants panel, its address box). It is measured so
  //     the difference stays a known one instead of becoming a surprise.
  const socketOnly = [];
  for (const method of ['sessions.list', 'product.invariants', 'coden.addresses']) {
    const overHttp = await browserCommand(method, {});
    let overSocket = true;
    try { await terminalAgain.call(method, {}); } catch { overSocket = false; }
    if (overSocket && overHttp.json?.error === 'unknown_method') socketOnly.push(method);
  }
  check(socketOnly.length === 3,
    'the asymmetry between the shells is exactly the known one', `socket-only: ${socketOnly.join(', ')}`);

  // 5b — phase 1 of `MASTER_PROJECT/17_CODEN_EVOLUTION_PIANO_DI_LAVORO.md`: the SAME SENTENCE,
  //      with no file named, planned from each shell, must reach the same files.
  //
  //      Every other check here names its files, so none of them ever exercised the path where
  //      the REPOSITORY chooses — which is exactly where the two shells had drifted. `D-0303`
  //      made `files` optional; the browser was updated and the line shell went on refusing
  //      client-side, before the request could reach the engine. A probe that always names its
  //      files cannot see that, and for two sessions it did not.
  //
  //      Placed before the logout below on purpose: this one needs both sessions alive.
  const prose = 'restore the session token when the workspace reloads';
  const fromTerminal = await terminalAgain.call('workspace.plan', { request: prose, files: [] });
  const fromBrowser = await browserCommand('workspace.plan', { request: prose, files: [] });
  const browserPlan = fromBrowser.json?.result ?? {};

  check(Boolean(fromTerminal.runId) && Boolean(browserPlan.runId),
    'a sentence with no file named is planned by both shells',
    `terminal ${fromTerminal.runId ? 'ok' : 'REFUSED'}, browser ${browserPlan.runId ? 'ok' : 'REFUSED'}`);

  const terminalFiles = [...(fromTerminal.grounding?.selected ?? [])].sort();
  const browserFiles = [...(browserPlan.grounding?.selected ?? [])].sort();
  check(terminalFiles.length > 0 && JSON.stringify(terminalFiles) === JSON.stringify(browserFiles),
    'the same sentence reaches the same files from either shell',
    `${terminalFiles.length} file(s): ${terminalFiles.join(', ') || '(none)'}`);

  // The provenance travels with them: a shell showing these paths without saying the engine
  // searched for them would invite approval under a false premise.
  check(fromTerminal.grounding?.derived === true && browserPlan.grounding?.derived === true,
    'both shells are told the file list was derived, not named',
    `terminal derived=${fromTerminal.grounding?.derived}, browser derived=${browserPlan.grounding?.derived}`);

  // 6 — the same thing in the other direction, with the browser SIGNED OUT rather than
  //     merely quiet: the terminal picks up work whose originating session no longer exists.
  const startedInBrowser = await browserCommand('workspace.plan', {
    request: 'CE-021: started in the browser shell', files: [{ path: 'from-browser.txt', contents: 'one engine\n' }],
  });
  const browserRunId = startedInBrowser.json?.result?.runId;
  const loggedOut = await http('POST', '/api/v1/auth/logout', {});
  cookies.clear();
  const afterLogout = await browserCommand('workspace.get', { runId: browserRunId });
  check([401, 403].includes(afterLogout.status),
    'the browser session really is gone before the terminal is asked', `logout ${loggedOut.status}, then ${afterLogout.status}`);
  const seenByTerminal = await terminalAgain.call('workspace.get', { runId: browserRunId });
  check(seenByTerminal.runId === browserRunId && seenByTerminal.status === 'PENDING_APPROVAL',
    'the terminal shell sees what the browser started, after the browser session is gone', seenByTerminal.status);
  await terminalAgain.call('workspace.measure', { runId: browserRunId });
  const approvedByTerminal = await terminalAgain.call('workspace.approve', { runId: browserRunId });
  check(approvedByTerminal.promoted === true,
    'the terminal shell finishes what the browser started', `promoted=${approvedByTerminal.promoted}`);

  // 7 — the sharper half of "detaching does not stop the work": a shell that dies with its
  //     command already on the wire. The answer is lost — nobody is left to receive it —
  //     and the work must not be. Verified from a DIFFERENT shell, which is the only way to
  //     ask the question at all once the asking shell is dead.
  const doomedShell = await attachTerminal(totpSecret);
  const doomedRun = await doomedShell.call('workspace.plan', {
    request: 'CE-021: approved by a shell that dies mid-command', files: [{ path: 'mid-flight.txt', contents: 'x\n' }],
  });
  // Measured normally first: the shadow this needs to promote has to exist. Only the
  // approval itself — the command actually under test — dies mid-flight.
  await doomedShell.call('workspace.measure', { runId: doomedRun.runId });
  doomedShell.fireAndDie('workspace.approve', { runId: doomedRun.runId });
  await new Promise((r) => setTimeout(r, 500));
  const midFlight = await terminalAgain.call('workspace.get', { runId: doomedRun.runId });
  check(midFlight.status !== 'PENDING_APPROVAL',
    'a command whose shell died mid-flight still completed', `status=${midFlight.status}`);

  terminalAgain.detach();
} catch (error) {
  check(false, 'the probe ran to the end', error.stack ?? String(error));
} finally {
  stopServer();
}

process.stdout.write(`\nCE021_FAIL=${failures}\n`);
process.exit(failures ? 1 : 0);
