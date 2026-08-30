// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The chat calls a tool and answers from its result — against the REAL model, not a script.
//
// `chat-tool-loop.test.mjs` proves the loop against a scripted upstream. `B-016` said the half
// below it could never be proven here, because the configured model emitted no tool calls. That
// premise died when the 27B was relaunched with --jinja (persisted in the runtime
// `launchCommand`, so it survives a restart). This drives the SAME real ChatOrchestrator, the
// same scope gate and the same SSE contract, against llama-server itself.
//
//   docker exec noesar-evolution node /opt/noesar/tools/acceptance/live-model-tool-loop.mjs
//
// Exits 0 only when the model asked for the tool, the tool ran, and the final answer carries the
// tool's own number back. Anything else is a FAIL with the evidence printed.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Resolved at run time so the same file runs from a checkout and inside the container, where the
// deployed source is mounted at /opt/noesar and the rootfs is read-only.
const SRC = process.env.NOESAR_SRC ?? new URL('../../services/reference-control-plane/src/', import.meta.url).href;
const [{ AtomicJsonStore }, { ContextGraph }, { WorkspaceService }, { ProviderGateway }, { CredentialVault }, { ChatOrchestrator }] =
  await Promise.all(['atomic-store', 'context-graph', 'workspace-service', 'provider-gateway', 'credential-vault', 'chat-orchestrator']
    .map((name) => import(new URL('ai-workspace/' + name + '.mjs', SRC).href)));

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8420/v1';
const model = process.argv[3] ?? 'qwen3.8-27b-q4_k_m';
const PROJECTS = 3;

// Same recording response the suite uses: the orchestrator writes SSE, we decode it back.
function recordingResponse() {
  return {
    chunks: [], writeHead() { return this; }, write(c) { this.chunks.push(String(c)); return true; }, end() {},
    events() {
      return this.chunks.join('').split('\n\n').filter(Boolean).map((frame) => ({
        event: frame.match(/^event:\s*(.+)$/m)?.[1],
        data: JSON.parse(frame.match(/^data:\s*(.+)$/m)?.[1] ?? 'null'),
      }));
    },
    eventsNamed(name) { return this.events().filter((i) => i.event === name); },
  };
}

const dir = mkdtempSync(join(tmpdir(), 'noesar-live-tool-loop-'));
const store = new AtomicJsonStore(join(dir, 'state.json'));
const graph = new ContextGraph(store);
const workspace = new WorkspaceService({ store, graph });
const vault = new CredentialVault({ keyPath: join(dir, 'p.key') });
const ledger = { entries: [], append(e) { this.entries.push(e); } };
const providers = new ProviderGateway({ store, vault, ledger });

const tool = { id: 'tool-listProjects', name: 'listProjects', description: 'Count the projects in this installation.', inputSchema: { type: 'object', properties: {}, required: [] }, disabled: false, external: false, transport: 'http', endpoint: 'http://127.0.0.1:1/', timeoutMs: 5000 };
store.transact((state) => { state.tools.push(tool); return {}; });

const project = graph.createProject({ name: 'P', instructions: '', toolIds: [tool.id] });
const { conversation } = graph.createConversation({ projectId: project.id, title: 'live', mode: 'ASK' });
const profile = providers.create({ type: 'custom-openai-compatible', name: 'live-local', external: false, apiStyle: 'openai-chat', baseUrl, defaultModel: model });
providers.update(profile.id, { enabled: true });

const executed = [];
const executor = { async execute(t, input) { executed.push({ name: t.name, input }); return { count: PROJECTS }; } };
const orchestrator = new ChatOrchestrator({ graph, workspace, providers, store, ledger, toolExecutor: executor, installationSnapshot: () => ({ productName: 'NOESAR Evolution' }) });

const res = recordingResponse();
const started = Date.now();
await orchestrator.streamToResponse({
  res, actorId: 'owner-001', conversationId: conversation.id, providerId: profile.id,
  content: 'How many projects are there? Use the listProjects tool and answer with the number it returns.',
});
const elapsed = Date.now() - started;

const calls = res.eventsNamed('tool-call');
const results = res.eventsNamed('tool-result');
const complete = res.eventsNamed('complete').at(-1)?.data;
const answer = complete?.message?.content ?? '';

const checks = [
  ['the model asked for the tool', calls.length >= 1 && calls[0].data.name === 'listProjects', JSON.stringify(calls.map((c) => c.data.name))],
  ['the tool actually ran', executed.length === 1 && executed[0].name === 'listProjects', JSON.stringify(executed)],
  ['the result was streamed and accepted', results.length >= 1 && results[0].data.ok === true, JSON.stringify(results.map((r) => r.data))],
  ['the call is announced before its result', res.events().map((e) => e.event).indexOf('tool-call') < res.events().map((e) => e.event).indexOf('tool-result'), 'order'],
  ['the answer carries the tool own number', new RegExp(String(PROJECTS)).test(answer), JSON.stringify(answer.slice(0, 200))],
  ['the call is auditable', ledger.entries.some((e) => e.action === 'chat.tool-call'), JSON.stringify(ledger.entries.filter((e) => e.action === 'chat.tool-call').map((e) => e.result))],
];

let failed = 0;
for (const [name, ok, evidence] of checks) {
  if (!ok) failed += 1;
  process.stdout.write((ok ? 'PASS  ' : 'FAIL  ') + name + '  ::  ' + evidence + '\n');
}
process.stdout.write('\nmodel ' + model + ' at ' + baseUrl + ' — ' + elapsed + ' ms, ' + (checks.length - failed) + '/' + checks.length + ' checks\n');
process.exit(failed === 0 ? 0 : 1);
