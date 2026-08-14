// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-020 — "ogni capacità ha una forma da tastiera completa", proved the way the matrix asks
// for it ("ogni capacità esercitata dal TUI, senza mouse"): the full-screen surface is driven
// by KEYSTROKES against a REAL engine, and the frames it paints are read back and asserted.
//
//   node tools/acceptance/ce-020-tui-fullscreen.mjs [port]
//
// Why this exists next to the layout unit tests: those prove the renderer draws §4's shape
// from a state object, which is necessary and not sufficient. The claim that matters is that
// the shape gets filled with what the ENGINE says — a frame full of plausible placeholders
// would satisfy every unit test in the file and still be a picture of a terminal rather than
// a terminal. So this boots the product, logs a real socket in with a real second factor,
// and presses real keys.
//
// Self-contained, for the same reason ce-021 is: it needs one process serving the socket, and
// it removes everything after.
//
// The only thing faked here is the TTY itself — `process.stdin` in a CI run is not a
// terminal, and there is no pty in a zero-dependency repo. The fake is a pair of streams that
// answer `isTTY`; every byte written to it is the renderer's real output, and every key it
// injects goes through the same `keypress` path a terminal produces.

import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';
import { runFullScreen } from '../tui-fullscreen.mjs';
import { visibleWidth } from '../../apps/shared/coden/tui-screen.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.argv[2] ?? 8198);
const workspace = mkdtempSync(join(tmpdir(), 'ce020-ws-'));
const socketPath = join(workspace, 'tui.sock');
const setupTokenFile = join(workspace, 'setup.token');
const setupToken = `ce020-${randomBytes(24).toString('base64url')}`;
const PASSWORD = `ce020-${randomBytes(18).toString('base64url')}`;

let failures = 0;
function check(ok, name, detail) {
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

class TerminalShell {
  constructor(socket) {
    this.socket = socket; this.buffer = ''; this.pending = new Map(); this.nextId = 1;
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
    socket.on('error', () => { /* teardown races are not the experiment */ });
  }

  call(method, params) {
    const id = String(this.nextId++);
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
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

/** A terminal, as far as the renderer can tell: it answers `isTTY`, it has a size, and it
 *  keeps every byte written to it so the frames can be read back and asserted. */
function fakeTerminal({ columns = 110, rows = 30 } = {}) {
  const out = new EventEmitter();
  out.isTTY = true; out.columns = columns; out.rows = rows;
  out.frames = [];
  out.write = (text) => { out.frames.push(text); return true; };

  const input = new EventEmitter();
  input.isTTY = true; input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  // `emitKeypressEvents` attaches its own listener; this probe bypasses it and emits the
  // same event shape directly, so a key is delivered exactly as the driver expects it.
  input.press = (chunk, key = {}) => input.emit('keypress', chunk, { name: key.name ?? chunk, ...key });
  return { out, input };
}

const settle = () => new Promise((r) => setTimeout(r, 120));
const lastFrame = (out) => out.frames.at(-1) ?? '';
// Frames are painted with colour. Every assertion about WORDS strips the escapes first —
// otherwise `> /map` never matches, because what is really there is `>` ESC[0m ` /map`.
const plain = (text) => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

writeFileSync(setupTokenFile, setupToken);

// The workspace is made a REAL git repository, because `remote` is read from git and a
// throwaway directory that is not one would report `available:false` — which is a correct
// answer about an environment nobody ships, and would let a broken wiring pass as an honest
// dash. One commit, so HEAD resolves and the branch has a name.
const git = (...args) => spawnSync('git', ['-C', workspace, ...args], { encoding: 'utf8' });
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'ce020@example.invalid');
git('config', 'user.name', 'CE-020 probe');
writeFileSync(join(workspace, 'README.md'), 'CE-020 probe workspace\n');
git('add', 'README.md');
git('commit', '-q', '-m', 'CE-020 probe baseline');

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

function stopServer() {
  server.kill('SIGTERM');
  rmSync(workspace, { recursive: true, force: true });
}

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

try {
  if (!await waitForServer()) {
    process.stdout.write(`the product did not come up:\n${serverLog}\n`);
    stopServer();
    process.exit(2);
  }

  const begun = await http('POST', '/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': setupToken });
  const totpSecret = begun.json?.totpSecret;
  const confirmed = await http('POST', '/api/v1/auth/setup/confirm',
    { challenge: begun.json?.challenge, totpCode: await freshTotp(totpSecret) });
  if (confirmed.status !== 201) {
    process.stdout.write(`owner bootstrap failed: ${begun.status}/${confirmed.status}\n${serverLog}\n`);
    stopServer();
    process.exit(2);
  }

  const socket = connect(socketPath);
  await new Promise((resolvePromise, reject) => { socket.once('connect', resolvePromise); socket.once('error', reject); });
  await new Promise((resolvePromise) => socket.once('data', resolvePromise));
  const shell = new TerminalShell(socket);
  const login = await shell.call('auth.login', { username: 'owner', password: PASSWORD });
  await shell.call('auth.mfa', { challenge: login.challenge, totpCode: await freshTotp(totpSecret) });

  const status = await shell.call('status', {});

  const { out, input } = fakeTerminal();
  const finished = runFullScreen({ session: shell, status, out, input });
  await settle();

  // 1 — the surface is an agent shell: a prompt you type into, not a scrolling log and not a
  //     dashboard of panels. The prompt box is the thing that makes it one.
  const first = lastFrame(out);
  check(first.includes('╭') && first.includes('╰') && first.includes('>'),
    'the surface opens on a prompt box');
  check(out.frames[0].includes('?1049h'),
    'it takes the alternate screen buffer, so it cannot eat the user\'s scrollback');

  // 2 — every row fits the terminal it was told about. A framed prompt that overflows by one
  //     column wraps and destroys itself, and only at some widths.
  check(first.split('\n').every((row) => visibleWidth(row) <= out.columns),
    'no row overflows the terminal width', `${out.rows} rows at ${out.columns} cols`);

  // 3 — `/` in the PROMPT opens the command menu. This is the gesture the shell is for, and
  //     it is not the address box: that one is navigation and lives in the browser's top bar.
  input.press('/');
  await settle();
  const menu = lastFrame(out);
  // Flattened 2026-08-14 on direct Owner instruction: the two-level design (bare `/` lists
  // GROUPS, a key enters one) read as a menu under a menu. This check used to require the
  // group headings and a group key to reach `/plan`/`/approve` — now a bare `/` shows the
  // ranked flat list directly, `matchCommands` already ranks it, and both are reachable with
  // no extra keystroke naming a category first.
  check(menu.includes('/plan') || menu.includes('/approve'),
    'typing / in the prompt opens the command menu, on real commands');
  check(menu.includes('▸'), 'the menu marks its selection with a glyph, not colour alone');
  check(!menu.includes('⏎ enter'), 'the menu no longer offers a group level to enter');

  // 4 — typing filters the SAME flat list (`/map`), and Tab completes WITHOUT running.
  //     Choosing and committing are two acts: a keystroke must never become an action nobody
  //     selected.
  for (const character of 'map') input.press(character);
  await settle();
  check(lastFrame(out).includes('/map'), 'typing filters the menu to the command typed');

  input.press('\t', { name: 'tab' });
  await settle();
  const completed = lastFrame(out);
  check(plain(completed).includes('> /map'), 'Tab completes the command into the prompt');
  check(!completed.includes('rootDir'), 'and does NOT run it');

  // 5 — Enter runs it, against the real engine, and the answer lands in the transcript. A
  //     placeholder would satisfy every layout assertion above and still be a picture.
  input.press('\r', { name: 'return' });
  await settle(); await settle();
  const ran = lastFrame(out);
  const scanned = await shell.call('repoMap.scan', {});
  const marker = Object.keys(scanned ?? {})[0];
  check(Boolean(marker) && ran.includes(marker),
    'Enter runs the command and the engine\'s own answer enters the transcript', `key: ${marker}`);
  check(plain(ran).includes('repoMap.scan'), 'the tool call is shown, not only its result');

  // 6 — the footer carries session state on one line, sourced.
  check(/main|no upstream|detached/.test(ran), 'the footer shows the branch, read from git');
  check(ran.includes('EXECUTE refused'),
    'a capability the engine declares impossible is stated, not left blank');

  // 6b — and the git fact is the SAME fact the browser shows, gated the same way.
  const overHttp = await http('GET', '/api/v1/coden/git-status');
  const overSocket = await shell.call('coden.gitStatus', {});
  check(JSON.stringify(overHttp.json) === JSON.stringify(overSocket),
    'both transports report one git state, not two readings that can disagree');

  // 7 — prose is refused honestly. The reference provider has no model, so this shell cannot
  //     answer a sentence; running the nearest command instead would be an action nobody chose.
  for (const character of 'rewrite everything') input.press(character);
  input.press('\r', { name: 'return' });
  await settle();
  const prose = lastFrame(out);
  check(prose.includes('no model wired for prose') || prose.includes('every capability is a command'),
    'prose is declined with the reason, not silently mapped onto a command');

  // 7b — and a slash word that names nothing is refused rather than guessed at.
  for (const character of '/nope') input.press(character);
  input.press('\r', { name: 'return' });
  await settle();
  check(lastFrame(out).includes('Nothing named'),
    'an unknown command says so instead of running the closest match');

  // 8 — leaving restores the terminal. A full-screen program that exits without putting the
  //     screen back has taken something that was not its to keep.
  input.press('c', { name: 'c', ctrl: true });
  await finished;
  check(lastFrame(out).includes('?1049l'), 'leaving restores the screen it borrowed');
  check(input.isRaw === false, 'leaving restores the terminal mode it changed');

  socket.destroy();
} finally {
  process.stdout.write(`\nCE020_FAIL=${failures}\n`);
  stopServer();
  process.exit(failures ? 1 : 0);
}
