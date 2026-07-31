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

  sessions [active|archived|bin] [page]   list sessions (UI-001…UI-012); default: active, page 1
  session-show <n>                        show session <n> from the last list shown
  session-archive <n…|all>                archive session(s) — moves, never destroys
  session-delete <n…|all>                 delete to the 30-day bin — or for good, if the last
                                           list shown was the bin itself (same rule as the
                                           browser's Delete key)
  session-restore <n…|all>                restore session(s) out of the archive or the bin
  session-undone                          what the last session action could not do

  panel <name> [arg]    a workbench panel's own view, full-screen, as text (UI-054) — one of:
                         plan, map, logs <runId>, shadow, invariants, authority,
                         editor <runId>, diff <runId>, tests, documentation, preview,
                         closure, conversation, activity. 'panel' alone lists the names.
  status                engine status, plus the bench's own status line (Elapsed/Authority
                         sourced; the rest read "—", exactly as honestly as the browser's)

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

/** Fresh per connection, carried through every `dispatchCommand` call: the last sessions
 *  page shown (so `<n>` in `session-show`/`session-archive`/… means "row n of that page",
 *  matching the browser's own numbered rows) and the refusals from the last batch action
 *  (UI-009), since a terminal has no toast to show them in as they happen. */
export function createTuiState() { return { lastList: null, lastRefused: [], connectedAt: Date.now() }; }

function humanDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

/** UI-054/UI-035: the SAME twelve labels the workbench's own status line declares, honestly
 *  — a field this transport cannot source reads "—", exactly like a field the browser
 *  cannot source. Elapsed and Authority are the two this transport genuinely has (the
 *  browser sources two more of its own — Network and Sandbox — from HTTP-only privacy and
 *  UI-toggle state this socket does not carry; that gap is disclosed, not silently narrowed
 *  away). A status line that invents a number it does not have is worse than one that says
 *  "—" (same principle as `apps/webui-static/index.html`'s own comment on this line). */
function formatStatusLine(state, statusResult) {
  const elapsed = humanDuration((Date.now() - state.connectedAt) / 1000);
  const authority = String(statusResult.capability?.outstandingTokens ?? '—');
  const fields = [
    ['Stage', '—/16'], ['Files', '—'], ['Tests', '—'], ['Warnings', '—'],
    ['Processes', '—'], ['Remote', '—'], ['Tokens', '—'], ['Cost', '—'],
    ['Elapsed', elapsed], ['Network', '—'], ['Sandbox', '—'], ['Authority', authority],
  ];
  const sourced = fields.filter(([, value]) => value !== '—' && !value.startsWith('—/')).length;
  return `${fields.map(([label, value]) => `${label} ${value}`).join('  ·  ')}\n(${sourced} of 12 fields have a source from this transport)`;
}

/** UI-054: the same panels the workbench's agent column and bench tabs show, reached full
 *  screen as text instead of a docked/floating pane. Names with a real source route to the
 *  same call the browser makes for that view; names the browser itself only ever shows a
 *  declared-empty placeholder for (no run has produced one, or the data belongs to a
 *  different transport, e.g. Conversation shares state with Chat) answer with that same
 *  honest placeholder here — never a guess. `F1…F9` raw-keypress binding is deliberately
 *  not built in this phase: this client reads whole lines (see the header comment on
 *  `LineReader`), and binding function keys needs a raw-mode input loop with its own
 *  piped-input fallback, a separate, larger change from adding a named command. */
const DECLARED_EMPTY_PANELS = {
  tests: 'No run, and this stays true on purpose: the executor is passed an empty test list on this path, so nothing has ever run a plan-declared command.',
  documentation: 'No documentation is attached to this piece of work.',
  preview: 'Nothing to preview. A preview renders an artefact the work produced.',
  closure: 'No run has reached closure in this session yet.',
  conversation: 'The bench conversation shares the session with Chat and the terminal shell. It is not a second chat with its own state — there is nothing transport-specific to show here.',
  activity: 'No hypothesis. Evidence is what was recalculated, not what was asserted. No tool has run in this session.',
};
const PANEL_NAMES = ['plan', 'map', 'logs', 'shadow', 'invariants', 'authority', 'editor', 'diff', ...Object.keys(DECLARED_EMPTY_PANELS)];

async function runPanel(session, name, arg) {
  if (!name) { console.log(`Panels: ${PANEL_NAMES.join(', ')}`); return; }
  if (DECLARED_EMPTY_PANELS[name]) { console.log(DECLARED_EMPTY_PANELS[name]); return; }
  switch (name) {
    case 'plan': console.log('Use `plan` to start one, or `get <runId>` for an existing run\'s state.'); return;
    case 'map': printJson('map', await session.call('repoMap.scan', { path: arg || undefined })); return;
    case 'logs': if (!arg) { console.log('Usage: panel logs <runId>'); return; } printJson('events', await session.call('events.correlation', { correlationId: arg })); return;
    case 'shadow': { const status = await session.call('status', {}); printJson('shadow', status.shadow); return; }
    case 'invariants': {
      const { invariants } = await session.call('product.invariants', {});
      for (const entry of invariants) console.log(`  ${String(entry.id ?? '').replace(/_/g, ' ')} — ${entry.status === 'ACTIVE' ? `enforced here (${entry.enforcedBy})` : `enforced elsewhere (${entry.enforcedBy})`}`);
      return;
    }
    case 'authority': { const status = await session.call('status', {}); printJson('authority', status.capability); return; }
    case 'editor': case 'diff':
      if (!arg) { console.log(`Usage: panel ${name} <runId>`); return; }
      printJson(name, await session.call('workspace.get', { runId: arg }));
      return;
    default: console.log(`Unknown panel \`${name}\`. Panels: ${PANEL_NAMES.join(', ')}`);
  }
}

/** `all` means every row of the last list shown — the terminal equivalent of the browser's
 *  `Ctrl+A` (UI-050), which selects everything on the current page, not every session that
 *  exists. Anything else must be one or more 1-based row numbers from that same list. */
export function resolveSessionSelection(state, tokens) {
  if (!state.lastList) return { error: 'No session list loaded — run `sessions` first.' };
  const items = state.lastList.items;
  if (tokens.length === 1 && tokens[0].toLowerCase() === 'all') {
    if (!items.length) return { error: 'The current list is empty.' };
    return { ids: items.map((item) => item.id), items };
  }
  const ids = []; const selected = [];
  for (const token of tokens) {
    const index = Number(token);
    if (!Number.isInteger(index) || index < 1 || index > items.length) {
      return { error: `\`${token}\` is not a session number on the current list (1-${items.length}).` };
    }
    ids.push(items[index - 1].id);
    selected.push(items[index - 1]);
  }
  if (!ids.length) return { error: 'Specify one or more session numbers, or `all`.' };
  return { ids, items: selected };
}

/** UI-008/UI-051/UI-052 in a terminal: every destructive-or-moving action names what and
 *  how many before it happens, and a bare Enter — the equivalent of the dangerous button
 *  never being preselected — cancels rather than confirms. */
async function confirmPrompt(reader, message) {
  const answer = await question(reader, `${message} [y/N] `);
  return /^y(es)?$/i.test(answer.trim());
}

async function runSessionsList(session, state, rest) {
  let place = 'active'; let page;
  for (const token of rest) {
    if (['active', 'archived', 'bin'].includes(token)) place = token;
    else if (/^\d+$/.test(token)) page = Number(token);
    else { console.log(`Unrecognized argument \`${token}\`. Usage: sessions [active|archived|bin] [page]`); return; }
  }
  const result = await session.call('sessions.list', { place, page: page ?? 1 });
  state.lastList = { place: result.place, items: result.items };
  console.log(`\n${result.place} — ${result.from}-${result.to} of ${result.total} (page ${result.page}/${result.pageCount})`);
  if (!result.items.length) { console.log('  (none)\n'); return; }
  result.items.forEach((item, index) => {
    const flags = [item.archived ? 'archived' : null, item.deletedAt ? 'in bin' : null].filter(Boolean).join(', ');
    console.log(`  ${index + 1}. ${item.title}  [${item.messageCount} msgs, last ${item.lastActivityAt}]${flags ? ` (${flags})` : ''}`);
  });
  console.log('');
}

const SESSION_ACTION_WORDS = {
  archive: { verb: 'Archive', consequence: 'Archiving moves the session. Nothing is deleted and it comes back whole.' },
  bin: { verb: 'Delete', consequence: 'It goes to the bin and stays recoverable for 30 days.' },
  purge: { verb: 'Delete for good', consequence: 'This cannot be undone. The session, its branches and its messages are destroyed.' },
  restore: { verb: 'Restore', consequence: 'The session returns to the working list.' },
};

async function runSessionAction(reader, session, state, action, rest) {
  const resolved = resolveSessionSelection(state, rest);
  if (resolved.error) { console.log(resolved.error); return; }
  const words = SESSION_ACTION_WORDS[action];
  const titles = resolved.items.map((item) => item.title);
  console.log(`${words.verb} ${resolved.ids.length} session${resolved.ids.length === 1 ? '' : 's'}:`);
  for (const title of titles.slice(0, 5)) console.log(`  - ${title}`);
  if (titles.length > 5) console.log(`  ...and ${titles.length - 5} more`);
  console.log(words.consequence);
  if (!(await confirmPrompt(reader, 'Confirm?'))) { console.log('Cancelled.'); return; }
  const result = await session.call('sessions.action', { action, ids: resolved.ids });
  state.lastRefused = result.refused ?? [];
  const refusedNote = result.refused.length ? `, ${result.refused.length} refused (see \`session-undone\`)` : '';
  console.log(`${words.verb}: ${result.applied.length} applied${refusedNote}.\n`);
}

export async function dispatchCommand(reader, session, line, state) {
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
    case 'panel': await runPanel(session, rest[0], rest[1]); return true;
    case 'status': {
      const result = await session.call('status', {});
      printJson('status', result);
      console.log(formatStatusLine(state, result));
      return true;
    }
    case 'sessions': await runSessionsList(session, state, rest); return true;
    case 'session-show': {
      const resolved = resolveSessionSelection(state, rest.length ? [rest[0]] : []);
      if (resolved.error) { console.log(resolved.error); return true; }
      printJson('session', await session.call('sessions.get', { id: resolved.ids[0] }));
      return true;
    }
    case 'session-archive': await runSessionAction(reader, session, state, 'archive', rest); return true;
    case 'session-delete': await runSessionAction(reader, session, state, state.lastList?.place === 'bin' ? 'purge' : 'bin', rest); return true;
    case 'session-restore': await runSessionAction(reader, session, state, 'restore', rest); return true;
    case 'session-undone':
      if (!state.lastRefused.length) console.log('Nothing refused.');
      else for (const item of state.lastRefused) console.log(`  ${item.id} — ${item.reason}`);
      return true;
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

  const state = createTuiState();
  for (;;) {
    const line = await question(reader, 'coden-evolution> ');
    let keepGoing = true;
    try { keepGoing = await dispatchCommand(reader, session, line, state); }
    catch (error) { console.error(`Error${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`); }
    if (!keepGoing) break;
  }
  iface.close();
  socket.end();
}

// Guarded like server.mjs's own entrypoint: a test importing this module for
// `dispatchCommand`/`resolveSessionSelection` coverage must not also open a real socket and
// block on stdin — nothing else would ever call `main()`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
