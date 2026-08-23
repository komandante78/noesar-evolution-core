// SPDX-License-Identifier: AGPL-3.0-or-later
// D-0231: the session protocol (docs/CODEN_EVOLUTION_DESIGN_V1.md §17) — one dispatch shared
// by the unix socket transport (a real terminal) and the HTTP bridge (server.mjs's own
// /api/v1/tui/command, covered separately by workspace-actions-http-adversarial.test.mjs).
// This file exercises the socket transport directly, since importing server.mjs for tests
// never runs the entrypoint guard that starts it — nothing else would ever call this code.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { WorkspaceActionOrchestrator, workspaceActionsStatus } from '../src/workspace-actions.mjs';
import { TokenMinter, capabilityStatus } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { shadowStatus } from '../src/shadow.mjs';
import { buildRepositoryMap, literalSearch } from '../src/repo-map.mjs';
import { AuthService } from '../src/auth.mjs';
import { AuditLedger } from '../src/audit.mjs';
import { totpCode } from '../src/auth-crypto.mjs';
import { createSessionDispatch, startUnixSocketServer, PROTOCOL_VERSION } from '../src/session-protocol.mjs';
import { LocalModelRuntime, activateModel } from '../src/local-model-runtime.mjs';
import { AdapterGrantOrchestrator } from '../src/adapter-capability.mjs';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ContextGraph } from '../src/ai-workspace/context-graph.mjs';
import { INVARIANT_ENFORCEMENT } from '../src/path-auth.mjs';
import { buildCodenAddressBook } from '../src/coden-address-book.mjs';
import { gitStatus } from '../src/git-status.mjs';

const WEB_ROOT = new URL('../../../apps/webui-static/', import.meta.url).pathname;

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';
const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

function resolveWorkspaceSubpath(root, subpath) {
  if (!subpath) return root;
  const candidate = join(root, String(subpath));
  return candidate.startsWith(root) ? candidate : null;
}

let ws, shadows, socketPath, server, totpSecret, authenticatedSocket, contextGraph, handshake, authService, localModelRuntime;

before(async () => {
  ws = mkdtempSync(join(tmpdir(), 'noesar-sp-ws-'));
  writeFileSync(join(ws, 'note.txt'), 'a real file the map can scan\n');
  shadows = mkdtempSync(join(tmpdir(), 'noesar-sp-shadows-'));
  const ledger = new AuditLedger(join(ws, 'audit.jsonl'));
  const auth = new AuthService({ workspace: ws, setupToken: SETUP_TOKEN, ledger });
  authService = auth;
  const begun = auth.beginSetup({ username: 'owner', displayName: 'Owner', password: PASSWORD, suppliedSetupToken: SETUP_TOKEN });
  totpSecret = begun.totpSecret;
  auth.confirmSetup({ challenge: begun.challenge, totpCode: totpCode(totpSecret, stepStart(0)) });

  const events = new EventLedger();
  const workspaceActions = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)), events,
  });
  contextGraph = new ContextGraph(new AtomicJsonStore(join(ws, 'ai-workspace.json')));
  // `D-0444`. A real runtime and a real grant orchestrator, not a mock of either: the test
  // below proves `model.activate` end to end (socket -> policy -> dispatch -> the thunk ->
  // `activateModel` -> configure/release/launch), the same real chain a live session drives.
  const localModelMinter = new TokenMinter(randomBytes(32));
  localModelRuntime = new LocalModelRuntime({ workspace: ws, minter: localModelMinter });
  const modelGrants = new AdapterGrantOrchestrator({ minter: localModelMinter });
  const fakeDescriptors = new Map([
    ['test-model', { id: 'test-model', launchCommand: ['/bin/sleep', '30'] }],
    ['no-launch-command', { id: 'no-launch-command' }],
  ]);
  const dispatch = createSessionDispatch({
    workspaceActions, buildRepositoryMap, literalSearch, resolveWorkspaceSubpath,
    workspaceRoot: ws, engineEvents: events, workspaceActionsStatus,
    getShadowSnapshot: () => shadowStatus(join(ws, 'shadows')),
    capabilityStatus, capabilityMinter: new TokenMinter(randomBytes(32)),
    contextGraph, ledger, invariantEnforcement: INVARIANT_ENFORCEMENT,
    // Phase 4: the real WebUI directory, not a fixture — the point of the method is that a
    // terminal is told about the address space the browser is actually served.
    codenAddressBook: () => buildCodenAddressBook(WEB_ROOT),
    // Phase 3b: a snapshot with MORE than the six the panels show, so the cap is exercised
    // rather than merely present. Nine projects, one agent.
    aiWorkspace: { snapshot: () => ({
      projects: Array.from({ length: 9 }, (unused, index) => ({ id: String(index), name: `p${index}` })),
      agents: [{ id: 'a', name: 'the-agent' }],
      artifacts: [], conversations: [], tasks: [], tools: [], agentRuns: [],
    }) },
    activateInstalledModel: (id, actor) => activateModel({
      descriptor: fakeDescriptors.get(id) ?? null,
      present: new Map([['test-model', { verified: true }], ['no-launch-command', { verified: true }]]),
      runtime: localModelRuntime, grants: modelGrants, actor,
      // D-0535: the wiring must state what it checked; an unchecked model is not started.
      descriptorAuthenticity: { verified: true, kind: 'VERIFIED', signedBy: 'test-publisher' },
    }),
    // Owner, 2026-08-15: `/model` with no id used to be a dead end. A tiny stand-in is
    // enough here — `server.mjs`'s own `listInstalledModels` (built on `buildCatalog`) is
    // proved separately by the catalogue's own tests; what THIS test proves is the wiring:
    // an empty id reaches this thunk at all, through the real socket and dispatch.
    listInstalledModels: () => ({ models: [{ id: 'test-model', lane: 'downloaded' }] }),
    // F-TOOLS2-001 (D-0663): the real production reader (services/reference-control-plane's
    // own server.mjs wires this exact function), not a stub — coden.gitStatus's dispatch route
    // had never been driven by a test the way sibling methods are, only the underlying reader.
    gitStatus,
  });
  socketPath = join(ws, 'tui-test.sock');
  // The await IS the readiness wait since s326: the promise resolves only once the socket
  // accepts connections, so the `if (!server.listening)` line that used to follow was
  // removed rather than left as a condition that can no longer be true.
  server = await startUnixSocketServer({ socketPath, dispatch, auth, ledger });

  // One connection, one login, reused by every test below that needs to be authenticated —
  // matching how a real terminal session behaves (one socket, many commands), and avoiding
  // a fresh TOTP code per test: a code is single-use (consumeTotp refuses a replay) and the
  // 30-second window makes cycling a real one per test needlessly slow.
  authenticatedSocket = connect(socketPath);
  await new Promise((resolve) => authenticatedSocket.once('data', resolve));
  const begunLogin = await call(authenticatedSocket, 'auth.login', { username: 'owner', password: PASSWORD });
  handshake = await call(authenticatedSocket, 'auth.mfa', { challenge: begunLogin.challenge, totpCode: totpCode(totpSecret, stepStart(1)) });
});

after(async () => {
  authenticatedSocket.end();
  await new Promise((resolve) => server.close(resolve));
  await localModelRuntime.release();
  rmSync(ws, { recursive: true, force: true });
  rmSync(shadows, { recursive: true, force: true });
});

/** One request/response round trip over the socket, matching the client's own newline framing. */
function call(socket, method, params) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const onData = (chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        if (frame.id !== id) continue;
        socket.off('data', onData);
        return frame.ok ? resolve(frame.result) : reject(Object.assign(new Error(frame.error.reason), { kind: frame.error.kind }));
      }
    };
    socket.on('data', onData);
    socket.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

describe('session protocol — unix socket transport', () => {
  // These two use their OWN throwaway connection, before any login — the shared
  // `authenticatedSocket` from `before()` exists exactly so the tests after them do not
  // each need a fresh TOTP code (single-use, and the 30-second window makes cycling a real
  // one per test needlessly slow).
  test('the first line the server sends is the protocol handshake', async () => {
    const socket = connect(socketPath);
    const hello = await new Promise((resolve) => socket.once('data', (chunk) => resolve(JSON.parse(chunk.toString('utf8').split('\n')[0]))));
    assert.equal(hello.protocol, PROTOCOL_VERSION);
    socket.end();
  });

  test('CE-036 · the handshake tells the terminal what the account may do', async () => {
    // Found by mutation, not by reading. Deleting `permissions` from the `auth.mfa` reply
    // killed no test: the terminal would fall back to `menuFor(null)` and quietly show an
    // UNFILTERED menu, so `CE-036` — "an entry the account cannot use does not appear, in both
    // shells" — would be false for one of the two with nothing failing. That is the exact
    // shape rule 5 of the phase skill describes: a criterion no row measures is not closed.
    //
    // The browser has had this since `GET /api/v1/auth/me`; the socket is the transport that
    // was never given it, which is also how `D-0302` found the socket enforcing no permissions
    // at all. A description, not a grant: the dispatch still checks `can` on every call.
    assert.ok(Array.isArray(handshake.permissions), 'the socket sent no permission set');
    assert.ok(handshake.permissions.includes('workspace.write'), JSON.stringify(handshake.permissions));
    // Derived from the one ROLE_PERMISSIONS definition rather than a second matrix — asserted
    // against the AuthService itself, so a hand-written list here would fail.
    assert.deepEqual(handshake.permissions, authService.permissionsFor(handshake.user.role));
  });

  // D-0337 — the second way in. These use their own throwaway connections because the point
  // is what an UNAUTHENTICATED socket can do with a code, which the shared authenticated
  // connection cannot demonstrate.
  test('D-0337 · an attach code signs a terminal in without asking for credentials again', async () => {
    const live = authService.store.read().sessions.find((item) => item.userId === handshake.user.id);
    assert.ok(live, 'the browser-side fixture has no live session to mint from');
    const minted = authService.mintAttachCode({ userId: handshake.user.id, sessionId: live.id });

    const socket = connect(socketPath);
    await new Promise((resolve) => socket.once('data', resolve));
    const attached = await call(socket, 'auth.attach', { code: minted.code });

    assert.equal(attached.user.id, handshake.user.id, 'the code opened a session for a different account');
    // The two ways in must be indistinguishable AFTER the door: a caller that arrived by
    // code gets the same permission set from the same derivation, so nothing downstream has
    // to learn that a session can arrive two ways.
    assert.deepEqual(attached.permissions, authService.permissionsFor(attached.user.role));
    // And it is really authenticated — a method that would have been refused a moment ago,
    // and one the dispatch gates on a permission, so this proves the `can` closure was wired
    // too and not just that the connection stopped saying UNAUTHENTICATED.
    const invariants = await call(socket, 'product.invariants', {});
    assert.ok(invariants, 'the attached session could not call an authenticated method');
    socket.end();
  });

  // D-0348 — the socket half of "one word is enough". These drive the real transport rather
  // than the AuthService, because what is being claimed is about a CONNECTION: that a fresh
  // socket presenting a stored token ends up in exactly the state a signed-in one is in, and
  // that a socket which only forgets is left exactly where it started. Neither of those is
  // visible from the service's own unit tests.
  test('D-0348 · a remembered terminal opens a fresh socket with nothing typed', async () => {
    const remembered = await call(authenticatedSocket, 'auth.remember', { label: 'owner@test' });
    assert.ok(remembered.token, 'the socket did not issue a terminal token');

    const socket = connect(socketPath);
    await new Promise((resolve) => socket.once('data', resolve));
    const resumed = await call(socket, 'auth.resume', { token: remembered.token });

    assert.equal(resumed.user.id, handshake.user.id, 'the token opened a session for a different account');
    assert.deepEqual(resumed.permissions, authService.permissionsFor(resumed.user.role));
    // Really authenticated, proved by a method the dispatch gates — the same standard the
    // attach-code test above holds itself to.
    assert.ok(await call(socket, 'product.invariants', {}), 'the resumed session could not call an authenticated method');
    socket.end();
  });

  test('D-0348 · remembering is refused BEFORE a session exists', async () => {
    const socket = connect(socketPath);
    await new Promise((resolve) => socket.once('data', resolve));
    // The order matters: `auth.remember` sits after the UNAUTHENTICATED gate, so an anonymous
    // caller must not be able to mint itself a ninety-day credential at the door.
    await assert.rejects(call(socket, 'auth.remember', { label: 'nobody' }), /auth\.login/);
    socket.end();
  });

  test('D-0348 · a forgotten terminal stops opening, and forgetting authenticates nobody', async () => {
    const remembered = await call(authenticatedSocket, 'auth.remember', { label: 'to-be-forgotten' });
    // Answerable without authenticating: the claim being made is possession of the token.
    const anonymous = connect(socketPath);
    await new Promise((resolve) => anonymous.once('data', resolve));
    assert.deepEqual(await call(anonymous, 'auth.forget', { token: remembered.token }), { forgotten: true });
    await assert.rejects(call(anonymous, 'product.invariants', {}), /auth\.login/,
      'forgetting a terminal left the connection authenticated');
    await assert.rejects(call(anonymous, 'auth.resume', { token: remembered.token }), /not remembered here/);
    anonymous.end();
  });

  test('D-0337 · a socket that presents a bad code stays unauthenticated', async () => {
    const socket = connect(socketPath);
    await new Promise((resolve) => socket.once('data', resolve));
    await assert.rejects(call(socket, 'auth.attach', { code: 'ZZZZ-ZZZZ' }), /Invalid or expired attach code/);
    // The refusal must leave the connection where it was, not half-open. A failed attach
    // that left `authenticated` set would be the whole feature inverted.
    await assert.rejects(call(socket, 'product.invariants', {}), /auth\.login/);
    socket.end();
  });

  test('phase 3b · coden.benchLists caps at six and says how many there really are', async () => {
    // The cap is not a transport preference: `renderBenchNavigator` slices to six in the
    // browser, so a terminal printing all nine would be the two shells disagreeing about what
    // the panel IS. Found by mutation — removing the slice killed no test, because every other
    // assertion happened to use a list shorter than the cap.
    const { lists, cappedAt } = await call(authenticatedSocket, 'coden.benchLists', {});
    assert.equal(cappedAt, 6);
    assert.equal(lists.projects.total, 9, 'the fixture no longer exceeds the cap; this proves nothing');
    assert.equal(lists.projects.shown.length, 6, 'the list was not capped');
    // The total travels alongside so "6 of 9" can be SAID rather than implied: six rows and
    // silence would read as all of them.
    assert.equal(lists.agents.shown.length, 1);
    assert.equal(lists.agents.total, 1);
    // All seven panels answer, including the empty ones — a missing key makes the terminal say
    // "this deployment served no list", which is a different claim from "none".
    assert.deepEqual(Object.keys(lists).sort(),
      ['agents', 'history', 'projects', 'recent', 'sessions', 'tasks', 'tools']);
  });

  test('no method beyond auth.login/auth.mfa is answered before the socket authenticates', async () => {
    const socket = connect(socketPath);
    await new Promise((resolve) => socket.once('data', resolve));
    await assert.rejects(call(socket, 'status', {}), (error) => error.kind === 'UNAUTHENTICATED');
    socket.end();
  });

  test('status reflects the same instances the HTTP surface reports on', async () => {
    const status = await call(authenticatedSocket, 'status', {});
    assert.equal(status.protocol, PROTOCOL_VERSION);
    assert.deepEqual(status.workspaceActions.operationsSupported, ['WRITE']);
  });

  test('plan -> measure -> approve -> restore over the socket reaches the same orchestrator, and the causal trail is readable back', async () => {
    const planned = await call(authenticatedSocket, 'workspace.plan', { request: 'a socket-driven plan', files: [{ path: 'from-socket.txt', contents: 'x' }] });
    assert.equal(planned.risk.overall, 'LOW');

    // `D-0567`, `CE-008`: the terminal walks the same two steps the browser does. A shell that
    // could approve in one call would be a shell where the criterion does not hold.
    const measured = await call(authenticatedSocket, 'workspace.measure', { runId: planned.runId });
    assert.equal(measured.status, 'MEASURED');
    assert.equal(measured.clean, true);

    const approved = await call(authenticatedSocket, 'workspace.approve', { runId: planned.runId });
    assert.equal(approved.promoted, true);

    const restored = await call(authenticatedSocket, 'workspace.restore', { runId: planned.runId });
    assert.equal(restored.status, 'RESTORED');

    const trail = await call(authenticatedSocket, 'events.correlation', { correlationId: planned.runId });
    assert.ok(trail.events.map((event) => event.action).includes('workspace_action.promoted'));
  });

  // F-TOOLS2-001 (D-0663): workspace.reject's engine method (orch.reject()) was already
  // unit-tested in workspace-actions.test.mjs, but the socket dispatch route that a real
  // `/reject` keystroke actually goes through had never been called by any test.
  test('workspace.reject over the socket reaches the same orchestrator as approve/restore', async () => {
    const planned = await call(authenticatedSocket, 'workspace.plan', {
      request: 'a plan the socket will reject', files: [{ path: 'reject-me.txt', contents: 'x' }],
    });
    const rejected = await call(authenticatedSocket, 'workspace.reject', { runId: planned.runId, reason: 'not needed' });
    assert.deepEqual(rejected, { runId: planned.runId, status: 'REJECTED' });

    const trail = await call(authenticatedSocket, 'events.correlation', { correlationId: planned.runId });
    assert.ok(trail.events.map((event) => event.action).includes('workspace_action.rejected'));
  });

  // F-TOOLS2-001 (D-0663): same gap, for /simulate. orch.simulate() was unit-tested; the
  // dispatch route was not.
  test('workspace.simulate over the socket reaches the same orchestrator, and carries the reference provider\'s honest unsupported answer through unchanged', async () => {
    const planned = await call(authenticatedSocket, 'workspace.plan', {
      request: 'a plan the socket will simulate', files: [{ path: 'simulate-me.txt', contents: 'x' }],
    });
    const simulated = await call(authenticatedSocket, 'workspace.simulate', { runId: planned.runId });
    assert.equal(simulated.runId, planned.runId);
    assert.equal(simulated.executed, false, 'simulate() must never execute, whatever the provider answers');
    assert.equal(simulated.simulation.supported, false, 'the reference provider declares simulate unsupported rather than faking a prediction');
  });

  // F-TOOLS2-001 (D-0663): same gap, for /git. gitStatus() itself was unit-tested in
  // git-status.test.mjs; the coden.gitStatus dispatch route was not, and this is the real
  // reader (see the `gitStatus` import above), not a stub — proving the socket reaches the
  // actual production function, over a real (non-git) temp workspace.
  test('coden.gitStatus over the socket reaches the real reader', async () => {
    const status = await call(authenticatedSocket, 'coden.gitStatus', {});
    assert.deepEqual(status, { available: false, reason: 'not_a_git_repository' });
  });

  // Point 4b, the half of the Owner's decision that has to be enforced rather than displayed:
  // a terminal session has no conversation to speak for, so it cannot file work under one.
  test('a run planned over the socket belongs to no chat, even when the caller sends one', async () => {
    const planned = await call(authenticatedSocket, 'workspace.plan', {
      request: 'a terminal plan', files: [{ path: 'terminal-run.txt', contents: 'x' }],
      // Sent on purpose. The socket must IGNORE it rather than refuse: what this asserts is
      // that the shell cannot attribute work to a conversation, not that a stray field breaks.
      conversationId: 'conv-the-terminal-was-never-part-of',
    });
    assert.equal(planned.conversationId, null);

    const listing = await call(authenticatedSocket, 'workspace.runs', { scope: 'unattached' });
    assert.ok(listing.runs.some((run) => run.runId === planned.runId));
    // And absent from the chat it tried to name — asked of the same orchestrator the browser
    // reads, so this is the grouping the Work column shows, not a parallel one.
    const chat = await call(authenticatedSocket, 'workspace.runs', {
      scope: 'conversation', conversationId: 'conv-the-terminal-was-never-part-of',
    });
    assert.deepEqual(chat.runs, []);
  });

  test('repoMap.scan and repoMap.search reach the real workspace over the socket', async () => {
    const map = await call(authenticatedSocket, 'repoMap.scan', {});
    assert.ok(map.filesScanned >= 1);
    const found = await call(authenticatedSocket, 'repoMap.search', { q: 'real file' });
    assert.equal(found.matches[0]?.path, 'note.txt');
  });

  test('an unknown method is refused rather than silently ignored', async () => {
    await assert.rejects(call(authenticatedSocket, 'no.such.method', {}), (error) => error.kind === 'UNKNOWN_METHOD');
  });

  test('a malformed line is answered with an error frame, not a dropped connection', async () => {
    const response = await new Promise((resolve) => {
      authenticatedSocket.once('data', (chunk) => resolve(JSON.parse(chunk.toString('utf8').split('\n').find(Boolean))));
      authenticatedSocket.write('not json at all\n');
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.kind, 'INVALID_JSON');
  });
});

// UI-050 (D-0267): the same three `contextGraph` methods the HTTP bridge's
// `/api/v1/sessions*` routes call, reached over the socket instead — proof that a session
// archived/binned/restored from the terminal is the same fact the browser would see, not a
// second copy of it.
describe('session protocol — sessions.* (UI-050, the TUI half of UI-001…UI-012)', () => {
  test('sessions.list reflects a conversation created directly on contextGraph', async () => {
    const { conversation } = contextGraph.createConversation({ title: 'From the socket test' });
    const listed = await call(authenticatedSocket, 'sessions.list', { place: 'active' });
    assert.ok(listed.items.some((item) => item.id === conversation.id));
    assert.equal(listed.place, 'active');
  });

  test('sessions.get returns the same conversation contextGraph itself would', async () => {
    const { conversation } = contextGraph.createConversation({ title: 'Fetched by id' });
    const fetched = await call(authenticatedSocket, 'sessions.get', { id: conversation.id });
    assert.equal(fetched.conversation.id, conversation.id);
  });

  test('sessions.action archives one session and it moves place on the next list', async () => {
    const { conversation } = contextGraph.createConversation({ title: 'To be archived' });
    const result = await call(authenticatedSocket, 'sessions.action', { action: 'archive', ids: [conversation.id] });
    assert.equal(result.applied.length, 1);
    assert.equal(result.refused.length, 0);
    const archived = await call(authenticatedSocket, 'sessions.list', { place: 'archived' });
    assert.ok(archived.items.some((item) => item.id === conversation.id));
  });

  test('sessions.action reports a mixed batch as partial — one applied, one refused, not an all-or-nothing failure', async () => {
    const { conversation } = contextGraph.createConversation({ title: 'Real one in the same batch' });
    const result = await call(authenticatedSocket, 'sessions.action', { action: 'bin', ids: [conversation.id, 'no-such-id'] });
    assert.equal(result.applied.length, 1);
    assert.equal(result.refused.length, 1);
    assert.equal(result.refused[0].id, 'no-such-id');
  });

  test('sessions.action rejects an action outside the five contextGraph verbs before ever touching a session', async () => {
    await assert.rejects(
      call(authenticatedSocket, 'sessions.action', { action: 'delete-forever', ids: ['x'] }),
      (error) => error.kind === 'INVALID_ACTION',
    );
  });

  test('sessions.action with no ids is refused rather than silently a no-op', async () => {
    await assert.rejects(
      call(authenticatedSocket, 'sessions.action', { action: 'archive', ids: [] }),
      (error) => error.kind === 'INVALID_REQUEST',
    );
  });
});

// UI-054 (D-0268): the same enforcement declaration `/api/v1/bootstrap` sends the WebUI's
// Invariants panel, reached over the socket for the TUI's `panel invariants`.
describe('session protocol — product.invariants (UI-054)', () => {
  test('returns the exact same record path-auth.mjs exports, not a second copy of it', async () => {
    const result = await call(authenticatedSocket, 'product.invariants', {});
    assert.deepEqual(result.invariants, INVARIANT_ENFORCEMENT);
    assert.ok(result.invariants.length > 0);
  });
});

// Phase 4 (D-0300): `/` in a terminal means what `/` in the browser means, because the list
// behind both is one list. This is the method that carries it across.
describe('session protocol — coden.addresses (phase 4)', () => {
  test('serves the address space read off the WebUI the browser is served, panels included', async () => {
    const result = await call(authenticatedSocket, 'coden.addresses', {});
    const byAddress = new Map(result.addresses.map((entry) => [entry.address, entry]));
    // Not a fixed count: the assertion is that every panel the markup declares is here,
    // which is the property that broke when the client kept its own list.
    assert.deepEqual(
      result.addresses.filter((entry) => entry.region === 'bench').map((entry) => entry.panel),
      buildCodenAddressBook(WEB_ROOT).filter((entry) => entry.region === 'bench').map((entry) => entry.panel),
    );
    assert.ok(byAddress.has('coden/bench/diff'));
    assert.ok(byAddress.has('coden/agent/plan'));
    assert.equal(byAddress.get('coden/bench/diff').kind, 'Bench');
    assert.match(byAddress.get('coden/bench/tests').declaredEmpty.join(' '), /plan-declared command/);
  });

  test('the answer states that it is not filtered by what this account may open', async () => {
    // The browser's box filters by what the sidebar shows for this account; this transport
    // has no such fact. Saying so is the difference between a disclosed gap and a claim.
    const result = await call(authenticatedSocket, 'coden.addresses', {});
    assert.equal(result.accessFiltered, false);
  });

  // `D-0444`. The full chain, over the real socket, with the real owner session `before()`
  // established — not `activateModel()` called directly, which `local-model-runtime.test.mjs`
  // already covers. What is proven here is the WIRING: `SESSION_METHOD_POLICY`, the dispatch
  // entry, and the thunk `activateInstalledModel` server.mjs builds for it all connect.
  test('model.activate launches a present, described model over the real socket', async () => {
    const result = await call(authenticatedSocket, 'model.activate', { id: 'test-model' });
    assert.equal(result.activated, true);
    assert.equal(result.id, 'test-model');
    assert.ok(Number.isInteger(result.pid));
    await localModelRuntime.release();
  });

  // Owner, 2026-08-15: `/model` with no id used to answer "needs an id" and name none —
  // the same dead end already fixed for `/diff` and friends, just not yet for this one.
  test('model.activate with no id lists what is loadable, instead of refusing', async () => {
    const result = await call(authenticatedSocket, 'model.activate', {});
    assert.deepEqual(result, { models: [{ id: 'test-model', lane: 'downloaded' }] });
  });

  test('model.activate refuses a descriptor with no launchCommand, with the real reason', async () => {
    await assert.rejects(
      call(authenticatedSocket, 'model.activate', { id: 'no-launch-command' }),
      (error) => error.kind === 'MODEL_ACTIVATION_REFUSED' && /declares no launchCommand/.test(error.message),
    );
  });

  test('model.activate refuses a model this installation does not know about', async () => {
    await assert.rejects(
      call(authenticatedSocket, 'model.activate', { id: 'no-such-model' }),
      (error) => error.kind === 'MODEL_ACTIVATION_REFUSED' && /no such model is known/.test(error.message),
    );
  });

  test('a deployment whose interface cannot be read answers UNAVAILABLE, never an empty list', async () => {
    // An empty list would send a shell looking for a product with no panels. This dispatch
    // is built the same way the real one is, with a reader that fails the way a missing
    // static directory fails.
    const broken = createSessionDispatch({
      workspaceActions: {}, buildRepositoryMap, literalSearch, resolveWorkspaceSubpath,
      workspaceRoot: ws, engineEvents: new EventLedger(), workspaceActionsStatus,
      getShadowSnapshot: () => ({}), capabilityStatus, capabilityMinter: new TokenMinter(randomBytes(32)),
      contextGraph, ledger: new AuditLedger(join(ws, 'audit.jsonl')), invariantEnforcement: INVARIANT_ENFORCEMENT,
      codenAddressBook: () => buildCodenAddressBook(join(ws, 'no-such-webui')),
    });
    await assert.rejects(broken('coden.addresses', {}, 'owner'), (error) => error.kind === 'UNAVAILABLE');

    const unwired = createSessionDispatch({
      workspaceActions: {}, buildRepositoryMap, literalSearch, resolveWorkspaceSubpath,
      workspaceRoot: ws, engineEvents: new EventLedger(), workspaceActionsStatus,
      getShadowSnapshot: () => ({}), capabilityStatus, capabilityMinter: new TokenMinter(randomBytes(32)),
      contextGraph, ledger: new AuditLedger(join(ws, 'audit.jsonl')), invariantEnforcement: INVARIANT_ENFORCEMENT,
    });
    await assert.rejects(unwired('coden.addresses', {}, 'owner'), (error) => error.kind === 'UNAVAILABLE');
  });
});
