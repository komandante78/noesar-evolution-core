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
import { createInterface, emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runFullScreen } from './tui-fullscreen.mjs';
import { accountFromUser } from '../apps/webui-static/agent-commands.js';
import { matchAddresses } from '../apps/webui-static/coden-view-model.js';
import { printJson, runSessionsList, showAddress } from './coden-address-views.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultSocketPath = resolve(here, '..', '.workspace', 'tui.sock');
const socketPath = process.argv[2] ?? process.env.NOESAR_TUI_SOCKET_PATH ?? defaultSocketPath;

const HELP = `Commands:
  plan <what you want> plan it — say it in prose; the repository finds the files
  plan                  same, but asks for the goal, then lets you name files yourself
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

  /                     every address in the product, listed. The same jump-to-address the
                         browser's own box answers to on \`/\` — same list, same ranking,
                         same names, because both shells read one list off the same markup.
  /<query> [arg]        jump to the best-matching address, exactly as typing in that box and
                         pressing Enter does: /diff, /coden/bench/diff and a path pasted out
                         of the browser's address bar all reach the same panel. Addresses
                         that need one still take a runId: \`/diff <runId>\`.

  panel <name> [arg]    the same jump by bare panel name (UI-054) — 'panel' alone lists them
                         with their hotkeys. On a real terminal F1…F9 jump straight to the
                         first nine bench panels, in the order the workbench itself lists
                         them; a panel that needs a runId still asks for one.
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

/**
 * Sign in — by attach code if the operator already has NOESAR open, by credentials otherwise.
 *
 * The code path is offered FIRST because it is the one that makes this a single
 * authentication (D-0337), but it is offered, never imposed: an empty line falls through to
 * username/password/second factor, which stays the way in for an installation with no browser
 * open, a fresh machine, or an operator who simply prefers it. Removing the credential path
 * would have traded two authentications for one that sometimes cannot happen at all.
 */
export async function login(reader, session) {
  // A mistyped code does NOT burn the real one — a code that does not match is never found,
  // so nothing is consumed and the one on screen is still live for the rest of its window.
  // That is what makes retrying here worth offering, and it is the opposite of the password
  // path, where a second attempt is a second attempt at the same secret. After three tries
  // this falls through to credentials rather than exiting, so a terminal is never left with
  // no way in because a code expired mid-typing.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = await question(reader, 'Attach code (from NOESAR in your browser), or Enter to sign in here: ');
    if (!code.trim()) break;
    try {
      const attached = await session.call('auth.attach', { code });
      return { ...attached.user, permissions: attached.permissions ?? null };
    } catch (error) {
      console.error(`Attach failed: ${error.message}`);
    }
  }
  const username = await question(reader, 'Username: ');
  // Not masked: doing that correctly needs raw mode, which only exists on a real TTY and
  // would have to be a no-op on anything else (a pipe, a test harness, some SSH clients'
  // non-interactive mode) — worth doing properly later, not as an undocumented readline
  // internal hooked in without knowing it holds across Node versions.
  const password = await question(reader, 'Password: ');
  const begun = await session.call('auth.login', { username, password });
  const totpCode = await question(reader, 'Authenticator code: ');
  const confirmed = await session.call('auth.mfa', { challenge: begun.challenge, totpCode });
  // The permission set travels with the user since phase 3a, so this shell can hide the menu
  // entries the account cannot use — `CE-036`, in BOTH shells rather than only the browser.
  // A deployment that predates the field leaves `permissions` undefined, and `menuFor(null)`
  // then declares the list UNFILTERED rather than quietly showing everything as if checked.
  return { ...confirmed.user, permissions: confirmed.permissions ?? null };
}

// `plan <prose>` — the request is the sentence, and which files it touches is the engine's
// business.
//
// This refused, client-side, whenever no file had been named: *"the reference reasoning has no
// model and cannot invent a target from prose alone"*. That sentence was true when it was
// written, and the engine outgrew it (`D-0303`): `files` is optional, and an empty list is a
// request to LOOK — `#runDecisionLayer` asks the repository which files the interpreted goal
// points at (`request-grounding.mjs`). The browser was updated and this shell was not, so the
// line shell could not plan at all while the full-screen shell had been sending `files: []`
// since s319. Two shells, one of them wired — exactly what `06_CODEN_EVOLUTION.md` §1 forbids,
// and invisible because nothing compared them.
//
// Naming files by hand stays possible: it is a SUPERSET of what the engine now does for
// itself, and a caller who already knows the target should not be made to guess along with it.
// It is only offered when no prose came with the verb, so `plan <prose>` stays ONE gesture
// instead of a sentence followed by an interrogation.
async function runPlanFlow(reader, session, request = '') {
  const typed = String(request ?? '').trim();
  const goal = typed || (await question(reader, 'Goal: ')).trim();
  if (!goal) { console.log('No request — nothing to plan.'); return; }

  const files = [];
  if (!typed) {
    for (;;) {
      const path = await question(reader, 'File path (blank to let the repository choose): ');
      if (!path.trim()) break;
      const contents = await readMultiline(reader, `Contents of ${path}:`);
      files.push({ path: path.trim(), contents });
    }
  }

  const planned = await session.call('workspace.plan', { request: goal, files });
  console.log(`\nrunId: ${planned.runId}`);
  // The engine's word for the state, not this client's. This line printed the constant
  // `PENDING_APPROVAL` until phase 5 — true of every plan this build makes, and still a state
  // nobody had been told. Found by asking the engine what it had actually answered.
  console.log(`status: ${planned.status ?? '—'}`);
  console.log(`risk: ${planned.risk.overall}`);
  console.log(`confidence: ${planned.confidence.value.toFixed(2)}`);

  // Which files, and WHO chose them. The engine returns `grounding` precisely so that a shell
  // cannot show a derived list as though a person had named it — `null` means the caller named
  // them, which is the honest value: nothing was derived.
  const grounding = planned.grounding ?? null;
  const chosen = grounding?.derived ? (grounding.selected ?? []) : files.map((file) => file.path);
  console.log(`files: ${chosen.join(', ') || '(none)'}`);
  if (grounding?.derived) {
    console.log(`  chosen by the repository from ${grounding.considered} candidate(s), on: ${(grounding.terms ?? []).join(', ') || '—'}`);
    // An empty overlap is true of a hallucination AND of a good paraphrase, so it is reported
    // as a signal for whoever approves — never resolved here into a verdict this shell has no
    // standing to reach.
    if (grounding.goalRelatedToRequest === false) {
      console.log('  ⚠ the interpreted goal shares no searchable word with what you asked — read the plan before approving');
    }
  }
  console.log('');
}


/** Fresh per connection, carried through every `dispatchCommand` call: the last sessions
 *  page shown (so `<n>` in `session-show`/`session-archive`/… means "row n of that page",
 *  matching the browser's own numbered rows) and the refusals from the last batch action
 *  (UI-009), since a terminal has no toast to show them in as they happen — plus the served
 *  address list once something has asked for it, cached for the connection's lifetime. */
export function createTuiState() { return { lastList: null, lastRefused: [], connectedAt: Date.now(), addresses: null }; }

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

// --- the address space, and the one place it comes from ---------------------------------
//
// Phase 4. Until now this file carried its own list of panels — fourteen names, written out
// here, against the twenty-five the workbench's markup declares, with the bench's and the
// agent column's namespaces flattened into one. It had drifted without anyone noticing,
// because a list only ever compared to itself always agrees. That is the exact shape of the
// defect phases 1–3 spent their time unwinding, so the fix is not to correct the list: it
// is to stop keeping one. `coden.addresses` serves the list off the same markup the browser
// reads its own from (services/reference-control-plane/src/coden-address-book.mjs), so both
// shells answer to one vocabulary and a client from a stale checkout still shows the
// SERVER's address space — which is what "the same live session as the workbench" has to
// mean.
//
// Fetched once per connection: the markup cannot change under a running server without a
// redeploy, and a round trip per keystroke would make `/` slower than the thing it replaced.

async function addressBook(session, state) {
  if (!state.addresses) state.addresses = (await session.call('coden.addresses', {})).addresses ?? [];
  return state.addresses;
}

/** Phase 3c. The ranking used to live HERE, in full, with a comment saying it was "the
 *  browser's own ranking, in the same three ranks (app.js::matchAddresses)" — a documented
 *  duplicate, which is still a duplicate: the note explains the drift, it does not stop it.
 *  Both copies now come from the shared view model, so the two shells cannot rank the same
 *  query two ways. Re-exported rather than have callers reach past this module, since this is
 *  where the address verbs of this shell live. */
export { matchAddresses };

/** Re-exported for the same reason: `showAddress` moved to `coden-address-views.mjs` in phase
 *  3c because two shells render it, but jumping to an address is a verb of THIS shell and its
 *  callers should not have to know where the table went. */
export { showAddress };

/** D3b, UI-054's other half: `F1`…`F9` reach the first nine BENCH addresses, in the order
 *  the workbench itself lists them — derived from the served list, not from a mapping typed
 *  here, so a panel added to the markup shifts the hotkeys the same way it shifts the bench.
 *  Kept pure (it takes the list) so the mapping stays testable without a real TTY; see
 *  `wireFunctionKeys` below for why the raw-mode plumbing itself is not. */
export function functionKeyAddresses(addresses) {
  return addresses.filter((entry) => entry.region === 'bench').slice(0, 9);
}

export function addressForFunctionKey(addresses, keyName) {
  const match = /^f([1-9])$/.exec(keyName ?? '');
  return match ? (functionKeyAddresses(addresses)[Number(match[1]) - 1] ?? null) : null;
}

/** What THIS transport can show for an address, and nothing about what any other can. Each
 *  entry routes to the same engine call the browser's own panel is drawn from — Editor and
 *  Diff are two angles on one run, so both reach `workspace.get`, exactly as the browser
 *  renders both out of one in-session run. A panel absent from this table is not a panel
 *  this file has forgotten: it is one this socket has no method for, and the code below says
 *  so in those words rather than printing an empty result that would read as "there are
 *  none". */
// Each view labels its own output with the panel's label from the served list, so even the
// heading a reader sees is the workbench's word for that panel rather than a second one
// chosen here.
// The address views moved to `tools/coden-address-views.mjs` in phase 3c — they are
// rendered by BOTH terminal shells now, so they belong to neither of them.
/** `/` — the jump. Empty query lists every address, grouped; anything else goes straight to
 *  the best match, which is what typing into the browser's box and pressing Enter does. A
 *  terminal has no highlighted row to arrow through before committing, so the runners-up are
 *  named after the jump instead of before it: the same outcome, still correctable. */
export async function jumpToAddress(session, state, query, arg) {
  const addresses = await addressBook(session, state);
  const matches = matchAddresses(addresses, query);
  if (!String(query ?? '').replace(/^\/+/, '').trim()) {
    let kind = null;
    for (const entry of matches) {
      if (entry.kind !== kind) { kind = entry.kind; console.log(`\n${kind}`); }
      console.log(`  /${entry.address}${' '.repeat(Math.max(1, 30 - entry.address.length))}${entry.label}`);
    }
    console.log(`\n${matches.length} addresses. This list is not filtered by what this account may open — the browser filters its own by what the sidebar shows, which is a fact of that shell.\n`);
    return;
  }
  if (!matches.length) { console.log('Nothing matches that.'); return; }
  const [best, ...rest] = matches;
  console.log(`→ ${best.label} (/${best.address})${rest.length ? `   [${rest.length} other match${rest.length === 1 ? '' : 'es'}: ${rest.slice(0, 3).map((entry) => `/${entry.address}`).join(', ')}${rest.length > 3 ? ', …' : ''}]` : ''}`);
  await showAddress(session, state, best, arg);
}

/** `panel <name>` — the same jump by bare panel name, kept because it is the vocabulary the
 *  interface documents and a shortcut must never be the only path. Resolved against the
 *  served list, so it cannot name a panel the product does not have; a name carried by both
 *  regions would be ambiguous and is refused rather than guessed at (none is today, and this
 *  is what makes adding one safe). */
export async function runPanel(session, state, name, arg) {
  const addresses = await addressBook(session, state);
  const panels = addresses.filter((entry) => entry.region);
  if (!name) {
    const hotkeys = functionKeyAddresses(addresses);
    console.log(`Panels: ${panels.map((entry) => entry.panel).join(', ')}`);
    console.log(`Hotkeys: ${hotkeys.map((entry, index) => `F${index + 1} ${entry.panel}`).join(', ')}`);
    return;
  }
  const found = panels.filter((entry) => entry.panel === name);
  if (!found.length) { console.log(`Unknown panel \`${name}\`. Panels: ${panels.map((entry) => entry.panel).join(', ')}`); return; }
  if (found.length > 1) { console.log(`\`${name}\` is a panel in ${found.length} regions. Name the address: ${found.map((entry) => `/${entry.address}`).join(', ')}`); return; }
  await showAddress(session, state, found[0], arg);
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
  // `/` is a prefix, not a word: `/`, `/diff` and `/coden/bench/diff <runId>` are one
  // mechanism, and it is checked before the switch so no verb can ever shadow an address.
  if (command.startsWith('/')) { await jumpToAddress(session, state, command, rest[0]); return true; }
  switch (command) {
    case '': return true;
    case 'help': console.log(HELP); return true;
    case 'plan': await runPlanFlow(reader, session, arg); return true;
    case 'simulate': printJson(console.log, 'simulation', await session.call('workspace.simulate', { runId: arg })); return true;
    case 'approve': printJson(console.log, 'result', await session.call('workspace.approve', { runId: arg })); return true;
    case 'reject': {
      const [runId, ...reasonParts] = rest;
      printJson(console.log, 'result', await session.call('workspace.reject', { runId, reason: reasonParts.join(' ') || null }));
      return true;
    }
    case 'restore': printJson(console.log, 'result', await session.call('workspace.restore', { runId: arg })); return true;
    case 'get': printJson(console.log, 'run', await session.call('workspace.get', { runId: arg })); return true;
    case 'events': printJson(console.log, 'events', await session.call('events.correlation', { correlationId: arg })); return true;
    case 'map': printJson(console.log, 'map', await session.call('repoMap.scan', { path: arg || undefined })); return true;
    case 'search': printJson(console.log, 'matches', await session.call('repoMap.search', { q: arg })); return true;
    case 'panel': await runPanel(session, state, rest[0], rest[1]); return true;
    case 'status': {
      const result = await session.call('status', {});
      printJson(console.log, 'status', result);
      console.log(formatStatusLine(state, result));
      return true;
    }
    case 'sessions': await runSessionsList(session, state, rest); return true;
    case 'session-show': {
      const resolved = resolveSessionSelection(state, rest.length ? [rest[0]] : []);
      if (resolved.error) { console.log(resolved.error); return true; }
      printJson(console.log, 'session', await session.call('sessions.get', { id: resolved.ids[0] }));
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

const PROMPT = 'coden-evolution> ';

/** D3b: the raw-mode half of `F1`…`F9`. Only wired for a real TTY — a piped/non-TTY stdin
 *  (this file's own tests, CI, `| node`) never emits `'keypress'` at all, so the fallback
 *  is silence, not a crash or a hang; every panel stays reachable by typing `panel <name>`
 *  regardless. `readline.createInterface` already puts a TTY's stdin into raw mode and
 *  calls `emitKeypressEvents` internally for its own line editing (arrows, backspace);
 *  `emitKeypressEvents` no-ops a second call on the same stream (guarded by a symbol Node
 *  sets on the stream itself), so calling it again here is redundant-but-safe, not a
 *  duplicate-listener bug. `iface.prompt(true)` after the panel output redraws the prompt
 *  and whatever the user had typed so far from `iface`'s own line buffer, which this
 *  handler never touches — the same technique any Node CLI uses to print asynchronous
 *  output above a live prompt. Not exercised by the test suite: it needs a real TTY to mean
 *  anything, the same class of gap `login()`'s own comment discloses for password masking.
 */
function wireFunctionKeys(iface, session, state) {
  if (!process.stdin.isTTY) return;
  emitKeypressEvents(process.stdin);
  process.stdin.on('keypress', (_char, key) => {
    if (!/^f[1-9]$/.test(key?.name ?? '')) return;
    // The mapping comes from the served list, so the first keypress may have to fetch it —
    // hence the whole handler is a promise chain rather than a lookup. Every subsequent
    // press reads the connection's cached copy.
    addressBook(session, state)
      .then((addresses) => {
        const entry = addressForFunctionKey(addresses, key.name);
        if (!entry) return null;
        process.stdout.write(`\n[${key.name.toUpperCase()}] /${entry.address}\n`);
        return showAddress(session, state, entry, undefined);
      })
      .catch((error) => console.error(`Error${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`))
      .finally(() => iface.prompt(true));
  });
}

async function main() {
  const socket = await connectSocket();
  const session = new Session(socket);
  const iface = createInterface({ input: process.stdin, output: process.stdout });
  iface.setPrompt(PROMPT);
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
  console.log(`Signed in as ${user.username} (${user.role}). Type \`help\` for commands, or \`/\` for every address in the product.\n`);

  // The state carries the address cache the hotkeys read, so it is created before they are
  // wired — a handler holding a state object nothing else uses would fetch the list a second
  // time and cache it where no typed command could see it.
  const state = createTuiState();

  // The full-screen surface (`07_INTERFACCIA.md` §4, `CE-020`) — but only on a real terminal.
  //
  // The gate is `isTTY`, not a flag with a TTY default, and that is load-bearing: the
  // acceptance run that proves `CE-021` drives this client with a PIPED stdin, and so does
  // every scripted use. Raw mode and the alternate screen buffer are meaningless there, and
  // taking them anyway would turn a passing proof into a hang with no output to explain it.
  // `NOESAR_TUI_LINE_MODE=1` forces the line shell on a terminal too, for anyone debugging
  // one command at a time.
  if (process.stdout.isTTY && process.stdin.isTTY && process.env.NOESAR_TUI_LINE_MODE !== '1') {
    // `status` only — the agent shell's commands come from the shared registry
    // (apps/webui-static/agent-commands.js), not from a list the engine has to serve. The
    // address book is a different gesture and belongs to the browser's top bar.
    const engineStatus = await session.call('status', {}).catch(() => null);
    iface.pause();
    // `account` is what the menu is filtered by (`CE-036`). `permissions: null` — a server
    // that does not send the set — travels straight through to `menuFor`, which then says the
    // list is unfiltered instead of implying it was checked.
    await runFullScreen({
      session,
      status: engineStatus,
      account: accountFromUser(user),
      onLeave: () => { socket.end(); },
    });
    iface.close();
    socket.end();
    return;
  }

  wireFunctionKeys(iface, session, state);
  for (;;) {
    const line = await question(reader, PROMPT);
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
