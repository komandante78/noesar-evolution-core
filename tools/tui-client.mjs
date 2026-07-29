#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The CodeN Evolution TUI — the "Terminal shell (TTY / SSH)" peer of docs/
// CODEN_EVOLUTION_DESIGN_V1.md §17's architecture diagram, a real keyboard-driven client
// for the session protocol (services/reference-control-plane/src/session-protocol.mjs).
//
// This is a terminal, not a picture of one: it drives an actual connection (a unix domain
// socket) with real request/response round trips, over the exact same engine instances the
// WebUI's own Terminal tab reaches through the HTTP bridge — "the same live session as the
// workbench", not a second client with its own state.
//
// It is NOT a shell. Every command below maps to one of the product's own already-guarded
// operations (plan/simulate/approve/reject/restore, repo-map scan/search, a run's own
// event trail). There is no `exec`, and there will not be one here: workspace-actions.mjs
// refuses EXECUTE and DELETE permanently and on purpose, and this client does not try to
// route around that from the other side of the socket.
//
// Zero dependencies, matching this project's policy: readline and net are both node:core.
//
// One `readline.Interface` for the whole process, created once in main() and reused for
// every prompt via repeated `.question()` calls — not a fresh Interface per prompt, which
// loses buffered input the moment a piped (non-TTY) stdin's data arrives faster than a new
// Interface can attach its listener. Every prompt in this file, including the multi-line
// file-content reader, is built on the one shared `question()` helper for exactly that
// reason.
//
// Usage: node tools/tui-client.mjs [socketPath]
//   socketPath defaults to $NOESAR_TUI_SOCKET_PATH, then <repo>/.workspace/tui.sock.

import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const defaultSocketPath = resolve(here, '..', '.workspace', 'tui.sock');
const socketPath = process.argv[2] ?? process.env.NOESAR_TUI_SOCKET_PATH ?? defaultSocketPath;

const HELP = `Commands:
  plan                  start a new plan — prompts for a goal, then files (path + contents)
  simulate <runId>      ask what a pending plan would do, without executing it
  approve <runId>       approve a pending plan (executes into the shadow, promotes if clean)
  reject <runId> [why]  reject a pending plan
  restore <runId>       undo a promoted run
  get <runId>           show a run's current state
  events <runId>        show a run's own causal event trail
  map [path]            scan the workspace (or a subdirectory) — languages, entry points, symbols
  search <query>        literal search across the workspace
  status                engine status (workspace-actions, shadow, capability)
  help                  this text
  exit                  close the connection and quit
`;

class Session {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    socket.on('data', (chunk) => this.#onData(chunk));
  }

  #onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf('\n');
      if (!line) continue;
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }
      if (frame.protocol) continue; // the handshake; main() waits for it separately
      const waiting = this.pending.get(frame.id);
      if (!waiting) continue;
      this.pending.delete(frame.id);
      frame.ok ? waiting.resolve(frame.result) : waiting.reject(Object.assign(new Error(frame.error.reason), { kind: frame.error.kind }));
    }
  }

  call(method, params) {
    const id = String(this.nextId++);
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
}

// readline's own `.question()` re-registers a fresh one-shot 'line' listener on every call.
// That loses input on a piped (non-TTY) stdin: when the whole script arrives in one chunk,
// readline emits every 'line' event synchronously in one pass, before this file's own code
// ever gets back to the event loop to call `.question()` again — so the second prompt's
// listener attaches after the second line already fired, and it waits forever for a line
// that will never come a second time. A live human typing at a real TTY never hits this
// (each line arrives as its own chunk, in time), but a scripted or piped session — exactly
// how this file's own tests and any future CI use of this client would drive it — does.
// The fix: one persistent 'line' listener for the whole process, queuing what arrives ahead
// of whoever asks for it, so a prompt asked for late still gets the line it was owed.
class LineReader {
  constructor(iface) {
    this.queue = [];
    this.waiters = [];
    iface.on('line', (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line); else this.queue.push(line);
    });
  }
  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolvePromise) => this.waiters.push(resolvePromise));
  }
}

function question(reader, prompt) {
  process.stdout.write(prompt);
  return reader.next();
}

/** Multi-line content for one file, terminated by a line containing only `.` — the same
 * convention old mail composers used, chosen because it needs no escaping rules of its own. */
async function readMultiline(reader, label) {
  process.stdout.write(`${label}\n(end with a single '.' on its own line)\n`);
  const lines = [];
  for (;;) {
    const line = await reader.next();
    if (line === '.') return lines.join('\n');
    lines.push(line);
  }
}

async function login(reader, session) {
  const username = await question(reader, 'Username: ');
  // Not masked: doing that correctly needs raw mode, which only exists on a real TTY and
  // would have to be a no-op on anything else (a pipe, a test harness, some SSH clients'
  // non-interactive mode) — worth doing properly later, not as an undocumented readline
  // internal hooked in without knowing it holds across Node versions.
  const password = await question(reader, 'Password: ');
  const begun = await session.call('auth.login', { username, password });
  const totpCode = await question(reader, 'Authenticator code: ');
  const confirmed = await session.call('auth.mfa', { challenge: begun.challenge, totpCode });
  return confirmed.user;
}

async function runPlanFlow(reader, session) {
  const goal = await question(reader, 'Goal: ');
  const files = [];
  for (;;) {
    const path = await question(reader, 'File path (blank to finish): ');
    if (!path.trim()) break;
    const contents = await readMultiline(reader, `Contents of ${path}:`);
    files.push({ path: path.trim(), contents });
  }
  if (!files.length) { console.log('No files named — nothing to plan. The reference reasoning has no model and cannot invent a target from prose alone.'); return; }
  const planned = await session.call('workspace.plan', { request: goal, files });
  console.log(`\nrunId: ${planned.runId}`);
  console.log('status: PENDING_APPROVAL');
  console.log(`risk: ${planned.risk.overall}`);
  console.log(`confidence: ${planned.confidence.value.toFixed(2)}`);
  console.log(`files: ${files.map((file) => file.path).join(', ')}\n`);
}

function printJson(label, value) {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(value, null, 2));
  console.log('');
}

async function dispatchCommand(reader, session, line) {
  const [command, ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(' ');
  switch (command) {
    case '': return true;
    case 'help': console.log(HELP); return true;
    case 'plan': await runPlanFlow(reader, session); return true;
    case 'simulate': printJson('simulation', await session.call('workspace.simulate', { runId: arg })); return true;
    case 'approve': printJson('result', await session.call('workspace.approve', { runId: arg })); return true;
    case 'reject': {
      const [runId, ...reasonParts] = rest;
      printJson('result', await session.call('workspace.reject', { runId, reason: reasonParts.join(' ') || null }));
      return true;
    }
    case 'restore': printJson('result', await session.call('workspace.restore', { runId: arg })); return true;
    case 'get': printJson('run', await session.call('workspace.get', { runId: arg })); return true;
    case 'events': printJson('events', await session.call('events.correlation', { correlationId: arg })); return true;
    case 'map': printJson('map', await session.call('repoMap.scan', { path: arg || undefined })); return true;
    case 'search': printJson('matches', await session.call('repoMap.search', { q: arg })); return true;
    case 'status': printJson('status', await session.call('status', {})); return true;
    case 'exit': case 'quit': return false;
    default: console.log(`Unknown command \`${command}\`. Type \`help\` for the list.`); return true;
  }
}

async function connectSocket() {
  const socket = connect(socketPath);
  try {
    await new Promise((resolvePromise, reject) => {
      socket.once('error', reject);
      socket.once('connect', resolvePromise);
    });
  } catch (error) {
    throw new Error(`could not reach ${socketPath}: ${error.message} — is the product running, and is this the same host (or a mount of the same /workspace)?`);
  }
  const hello = await new Promise((resolvePromise) => socket.once('data', (chunk) => resolvePromise(JSON.parse(chunk.toString('utf8').split('\n')[0]))));
  console.log(`Connected — protocol ${hello.protocol}`);
  return socket;
}

async function main() {
  const socket = await connectSocket();
  const session = new Session(socket);
  const iface = createInterface({ input: process.stdin, output: process.stdout });
  const reader = new LineReader(iface);

  let user;
  try {
    user = await login(reader, session);
  } catch (error) {
    console.error(`Sign-in failed${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`);
    iface.close();
    socket.end();
    process.exitCode = 1;
    return;
  }
  console.log(`Signed in as ${user.username} (${user.role}). Type \`help\` for commands.\n`);

  for (;;) {
    const line = await question(reader, 'coden-evolution> ');
    let keepGoing = true;
    try { keepGoing = await dispatchCommand(reader, session, line); }
    catch (error) { console.error(`Error${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`); }
    if (!keepGoing) break;
  }
  iface.close();
  socket.end();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
