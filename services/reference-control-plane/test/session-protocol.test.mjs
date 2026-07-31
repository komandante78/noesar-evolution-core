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
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ContextGraph } from '../src/ai-workspace/context-graph.mjs';
import { INVARIANT_ENFORCEMENT } from '../src/path-auth.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';
const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

function resolveWorkspaceSubpath(root, subpath) {
  if (!subpath) return root;
  const candidate = join(root, String(subpath));
  return candidate.startsWith(root) ? candidate : null;
}

let ws, shadows, socketPath, server, totpSecret, authenticatedSocket, contextGraph;

before(async () => {
  ws = mkdtempSync(join(tmpdir(), 'noesar-sp-ws-'));
  writeFileSync(join(ws, 'note.txt'), 'a real file the map can scan\n');
  shadows = mkdtempSync(join(tmpdir(), 'noesar-sp-shadows-'));
  const ledger = new AuditLedger(join(ws, 'audit.jsonl'));
  const auth = new AuthService({ workspace: ws, setupToken: SETUP_TOKEN, ledger });
  const begun = auth.beginSetup({ username: 'owner', displayName: 'Owner', password: PASSWORD, suppliedSetupToken: SETUP_TOKEN });
  totpSecret = begun.totpSecret;
  auth.confirmSetup({ challenge: begun.challenge, totpCode: totpCode(totpSecret, stepStart(0)) });

  const events = new EventLedger();
  const workspaceActions = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)), events,
  });
  contextGraph = new ContextGraph(new AtomicJsonStore(join(ws, 'ai-workspace.json')));
  const dispatch = createSessionDispatch({
    workspaceActions, buildRepositoryMap, literalSearch, resolveWorkspaceSubpath,
    workspaceRoot: ws, engineEvents: events, workspaceActionsStatus,
    getShadowSnapshot: () => shadowStatus(join(ws, 'shadows')),
    capabilityStatus, capabilityMinter: new TokenMinter(randomBytes(32)),
    contextGraph, ledger, invariantEnforcement: INVARIANT_ENFORCEMENT,
  });
  socketPath = join(ws, 'tui-test.sock');
  server = startUnixSocketServer({ socketPath, dispatch, auth, ledger });
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));

  // One connection, one login, reused by every test below that needs to be authenticated —
  // matching how a real terminal session behaves (one socket, many commands), and avoiding
  // a fresh TOTP code per test: a code is single-use (consumeTotp refuses a replay) and the
  // 30-second window makes cycling a real one per test needlessly slow.
  authenticatedSocket = connect(socketPath);
  await new Promise((resolve) => authenticatedSocket.once('data', resolve));
  const begunLogin = await call(authenticatedSocket, 'auth.login', { username: 'owner', password: PASSWORD });
  await call(authenticatedSocket, 'auth.mfa', { challenge: begunLogin.challenge, totpCode: totpCode(totpSecret, stepStart(1)) });
});

after(async () => {
  authenticatedSocket.end();
  await new Promise((resolve) => server.close(resolve));
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

  test('plan -> approve -> restore over the socket reaches the same orchestrator, and the causal trail is readable back', async () => {
    const planned = await call(authenticatedSocket, 'workspace.plan', { request: 'a socket-driven plan', files: [{ path: 'from-socket.txt', contents: 'x' }] });
    assert.equal(planned.risk.overall, 'LOW');

    const approved = await call(authenticatedSocket, 'workspace.approve', { runId: planned.runId });
    assert.equal(approved.promoted, true);

    const restored = await call(authenticatedSocket, 'workspace.restore', { runId: planned.runId });
    assert.equal(restored.status, 'RESTORED');

    const trail = await call(authenticatedSocket, 'events.correlation', { correlationId: planned.runId });
    assert.ok(trail.events.map((event) => event.action).includes('workspace_action.promoted'));
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
