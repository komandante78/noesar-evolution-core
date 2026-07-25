// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression tests for F4-004 and F4-003 (Phase 4 acceptance).
//
// F4-004: POST /api/v1/chat/stream was invoked as `return orchestrator.streamToResponse(...)`
//         without `await`, so a rejection escaped the request handler's try/catch and
//         became an unhandled rejection, which Node turns into process exit. One
//         malformed request from any session holding `provider.use` killed the service.
//
// F4-003: once the SSE headers were written the connection was torn down with no
//         terminating frame, so a client could not tell failure from a network glitch.
//
// These tests drive the real orchestrator, not a mock of it: the point is that a
// validation error inside the streaming path stays inside the streaming path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatOrchestrator } from '../src/ai-workspace/chat-orchestrator.mjs';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ContextGraph } from '../src/ai-workspace/context-graph.mjs';
import { WorkspaceService } from '../src/ai-workspace/workspace-service.mjs';
import { ProviderGateway } from '../src/ai-workspace/provider-gateway.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-stream-'));
  const store = new AtomicJsonStore(join(dir, 'ai.json'));
  const ledger = { entries: [], append(entry) { this.entries.push(entry); } };
  const graph = new ContextGraph(store);
  const workspace = new WorkspaceService({ store, graph, ledger });
  const vault = new CredentialVault({ keyPath: join(dir, 'provider.key') });
  const providers = new ProviderGateway({ store, vault, ledger });
  const orchestrator = new ChatOrchestrator({ graph, workspace, providers, store, ledger });
  return { dir, store, graph, workspace, providers, orchestrator, ledger };
}

/** Minimal ServerResponse stand-in that records what the orchestrator actually sent. */
function fakeResponse() {
  return {
    statusCode: null, headers: null, chunks: [], ended: false, headersSent: false,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; this.headersSent = true; return this; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end(chunk) { if (chunk) this.chunks.push(String(chunk)); this.ended = true; return this; },
    get body() { return this.chunks.join(''); },
  };
}

test('a missing message content rejects before any SSE header is written', async () => {
  const h = harness();
  try {
    const project = h.graph.createProject({ name: 'p' });
    const conversation = h.graph.createConversation({ projectId: project.id, title: 'c', mode: 'ASK' });
    // The provider must be ENABLED: with no route the call fails early and never
    // reaches the interesting path. The crash needed a usable route plus bad input.
    const profile = h.providers.create({ type: 'custom-openai-compatible', name: 'unreachable', external: false, baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'x' });
    h.providers.update(profile.id, { enabled: true });

    const res = fakeResponse();
    // `content` deliberately absent — this is the exact shape that killed the process.
    await assert.rejects(
      () => h.orchestrator.streamToResponse({ res, actorId: 'tester', conversationId: conversation.conversation.id }),
      (error) => {
        assert.ok(Number(error.status) >= 400 && Number(error.status) < 500, `a validation failure must carry a 4xx status, got ${error.status}`);
        return true;
      },
    );
    assert.equal(res.headersSent, false, 'no SSE headers may be written before validation passes');
    assert.equal(res.ended, false, 'the response must be left for the caller to answer with a JSON error');
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});

test('a provider failure after the headers are written ends the stream with an error frame', async () => {
  const h = harness();
  try {
    const project = h.graph.createProject({ name: 'p' });
    const conversation = h.graph.createConversation({ projectId: project.id, title: 'c', mode: 'ASK' });
    // Port 1 is not listening: the provider call fails after the stream has started.
    const profile = h.providers.create({ type: 'custom-openai-compatible', name: 'dead', external: false, baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'x' });
    h.providers.update(profile.id, { enabled: true });

    const res = fakeResponse();
    await h.orchestrator.streamToResponse({
      res, actorId: 'tester', conversationId: conversation.conversation.id, content: 'hello', providerId: profile.id,
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /^event: run\n/, 'the run frame is still sent first');
    assert.match(res.body, /event: error\ndata: /, 'the failure must arrive as an SSE error frame');
    assert.equal(res.ended, true, 'the stream must be closed cleanly, not aborted');
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});

test('no run is left registered as active after a failure', async () => {
  const h = harness();
  try {
    const project = h.graph.createProject({ name: 'p' });
    const conversation = h.graph.createConversation({ projectId: project.id, title: 'c', mode: 'ASK' });
    const profile = h.providers.create({ type: 'custom-openai-compatible', name: 'dead', external: false, baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'x' });
    h.providers.update(profile.id, { enabled: true });
    const res = fakeResponse();
    await h.orchestrator.streamToResponse({ res, actorId: 'tester', conversationId: conversation.conversation.id, content: 'hello', providerId: profile.id });
    assert.equal(h.orchestrator.active.size, 0, 'the active-run map must not leak entries');
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});

test('a validation failure does not persist a half-written user message', async () => {
  const h = harness();
  try {
    const project = h.graph.createProject({ name: 'p' });
    const conversation = h.graph.createConversation({ projectId: project.id, title: 'c', mode: 'ASK' });
    h.providers.create({ type: 'custom-openai-compatible', name: 'unreachable', external: false, baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'x' });
    const before = h.store.read().messages.length;
    await assert.rejects(() => h.orchestrator.streamToResponse({ res: fakeResponse(), actorId: 'tester', conversationId: conversation.conversation.id }));
    assert.equal(h.store.read().messages.length, before, 'a rejected run must not leave a message behind');
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});
