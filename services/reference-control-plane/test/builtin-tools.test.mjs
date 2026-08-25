// SPDX-License-Identifier: AGPL-3.0-or-later
//
// P3 · the engine's own methods are tools the chat can actually call.
//
// Measured before this suite existed: `ToolExecutor` knew three transports — `local-http`,
// `mcp-http`, `mcp-stdio` — and all three leave the process. So the chat could reach a stranger's
// API and could not reach the installation it lives in. Asked "what is broken here" it could only
// describe how one would find out.
//
// Four things are proven here, and the fourth is the one that is easy to skip:
//
//   1. the catalogue cannot silently drift from `SESSION_METHOD_POLICY`;
//   2. a built-in call carries NO authority of its own — the caller's `can` is the gate, and its
//      absence is a refusal, not a default;
//   3. the whole path runs: scripted model → orchestrator → real `ToolExecutor` → real
//      `createSessionDispatch` → a real handler → an answer written from its result;
//   4. the resting cost of the catalogue is a NUMBER, checked against a declared budget. `CE-016`
//      ("a riposo il programma ha zero strumenti caricati") stopped being free the moment `D-0674`
//      made a request that names no tool default to the project's set — a criterion no row
//      measures is not closed, so this file is the row.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ContextGraph } from '../src/ai-workspace/context-graph.mjs';
import { WorkspaceService } from '../src/ai-workspace/workspace-service.mjs';
import { ProviderGateway } from '../src/ai-workspace/provider-gateway.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';
import { ChatOrchestrator } from '../src/ai-workspace/chat-orchestrator.mjs';
import { ToolExecutor } from '../src/ai-workspace/tool-executor.mjs';
import { createSessionDispatch, SESSION_METHOD_POLICY } from '../src/session-protocol.mjs';
import {
  EFFECT, SCHEMA, builtinToolCatalogue, builtinToolRecords, builtinToolName,
  methodForBuiltinName, seedBuiltinTools, BUILTIN_TRANSPORT,
} from '../src/ai-workspace/builtin-tools.mjs';
import { describeTools } from '../src/home-overview.mjs';
import { freshTempDir } from './support/workspace.mjs';

const startedServers = [];
after(() => { for (const server of startedServers) { server.closeAllConnections?.(); server.close(); } });

/* --- 1 · the catalogue is derived, and cannot drift ------------------------------------- */

test('every engine method is classified — a new one fails this suite until someone decides what it is', () => {
  const methods = Object.keys(SESSION_METHOD_POLICY);
  const unclassified = methods.filter((method) => !EFFECT[method]);
  assert.deepEqual(unclassified, [],
    'these engine methods have no effect classification, so nobody decided whether the chat may call them');
  const schemaless = methods.filter((method) => !SCHEMA[method]);
  assert.deepEqual(schemaless, [], 'these engine methods have no parameter schema, so a model would be told nothing about how to call them');
  // The complement, so a table of `read` for everything could not pass the line above.
  assert.deepEqual(
    methods.filter((method) => !['read', 'write', 'destroy'].includes(EFFECT[method])), [],
    'an effect outside read/write/destroy is not a classification',
  );
  assert.equal(builtinToolCatalogue().length, methods.length, 'the catalogue must carry one row per engine method, never a subset');
});

test('the two destroying verbs are named as such and are not registered', () => {
  const catalogue = builtinToolCatalogue();
  const destroying = catalogue.filter((entry) => entry.effect === 'destroy').map((entry) => entry.method).sort();
  assert.deepEqual(destroying, ['replay.sweep', 'sessions.action'],
    'the set of methods that remove something unrecoverable changed — classify the new one deliberately');
  for (const entry of catalogue) {
    if (entry.effect !== 'read') assert.equal(entry.seeded, false, `${entry.method} is ${entry.effect} and must not be registered as a tool`);
  }
  const seeded = builtinToolRecords();
  assert.equal(seeded.length, catalogue.filter((entry) => entry.effect === 'read').length);
  assert.ok(seeded.length >= 20, `only ${seeded.length} read tools were registered — the chat is meant to be able to look at this installation`);
  assert.deepEqual(seeded.filter((record) => record.mutative), [], 'a registered built-in must not be mutative');
});

test('tool names are legal function names, unique, and reversible to their method', () => {
  const names = builtinToolCatalogue().map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, 'two engine methods produced the same tool name — one call would silently reach the other');
  for (const method of Object.keys(SESSION_METHOD_POLICY)) {
    const name = builtinToolName(method);
    // The grammar every provider enforces on a function name. `repoMap.search` is not in it,
    // which is the whole reason the transform exists.
    assert.match(name, /^[A-Za-z0-9_-]{1,64}$/, `${name} is not a legal function name`);
    assert.equal(methodForBuiltinName(name), method, 'the name must resolve back to exactly one method');
  }
  assert.equal(methodForBuiltinName('engine_not_a_method'), null, 'an unknown name must resolve to nothing, never to a guess');
});

test('every registered tool declares the permission its method will actually be gated on', () => {
  for (const record of builtinToolRecords()) {
    const method = record.config.method;
    const expected = SESSION_METHOD_POLICY[method].permission;
    assert.deepEqual(record.permissions, expected ? [expected] : [],
      `${record.name} advertises a permission the dispatch does not ask for`);
    assert.equal(record.transport, BUILTIN_TRANSPORT);
    assert.equal(record.endpoint, null, 'a built-in tool reaches no network and must carry no endpoint');
    assert.equal(record.encryptedCredential, null);
  }
});

test('the Home panel says where a built-in reaches, and it is not "unknown"', () => {
  const described = describeTools({ tools: builtinToolRecords(), permitted: true });
  assert.equal(described.count, builtinToolRecords().length);
  for (const item of described.items) {
    // `unknown` is the honest answer for a record whose endpoint could not be read. A built-in
    // opens no connection at all, and reporting that as "unknown" would put twenty tools that
    // reach nothing in the same row as one whose destination is a mystery.
    assert.equal(item.origin.reach, 'in-process', `${item.name} reports its reach as ${item.origin.reach}`);
    assert.equal(item.origin.declaredExternal, false);
    assert.equal(item.builtin, true, 'the panel cannot tell a built-in from an operator tool without this');
    assert.equal(item.credentialConfigured, false, 'a built-in authenticates to nothing');
  }
  // The complement: an ordinary tool is unaffected by the new branch.
  const ordinary = describeTools({ tools: [{ id: 't', name: 'x', transport: 'local-http', endpoint: 'http://127.0.0.1:9/' }], permitted: true });
  assert.equal(ordinary.items[0].origin.reach, 'this-machine');
  assert.equal(ordinary.items[0].builtin, false);
});

/* --- 2 · seeding is idempotent and never overwrites an operator's decision ---------------- */

function seedFixture() {
  const store = new AtomicJsonStore(join(freshTempDir('noesar-builtin-seed-'), 'state.json'));
  return store;
}

test('seeding twice registers once, and the second call writes nothing', () => {
  const store = seedFixture();
  const first = seedBuiltinTools(store);
  assert.ok(first.added.length >= 20);
  assert.equal(first.updated.length, 0);
  const countAfterFirst = store.read().tools.length;

  const second = seedBuiltinTools(store);
  assert.deepEqual(second.added, [], 'a second start-up registered the same tools again');
  assert.deepEqual(second.updated, [], 'a second start-up rewrote the state file for nothing — this runs on the start-up path');
  assert.equal(second.unchanged, countAfterFirst);
  assert.equal(store.read().tools.length, countAfterFirst);
});

test('an operator turning a built-in off keeps it off across a restart', () => {
  const store = seedFixture();
  seedBuiltinTools(store);
  const target = store.read().tools[0].id;
  store.transact((state) => { state.tools.find((item) => item.id === target).disabled = true; return {}; });

  seedBuiltinTools(store);
  assert.equal(store.read().tools.find((item) => item.id === target).disabled, true,
    'a tool someone turned off came back on because the process restarted');
});

test('a product-owned field that drifted is repaired, and only that one', () => {
  const store = seedFixture();
  seedBuiltinTools(store);
  const target = store.read().tools[0].id;
  store.transact((state) => {
    const tool = state.tools.find((item) => item.id === target);
    tool.description = 'stale text from an older build';
    tool.consent = { granted: true, grantedAt: 'yesterday', projectIds: ['p1'] };
    return {};
  });

  const report = seedBuiltinTools(store);
  const after_ = store.read().tools.find((item) => item.id === target);
  assert.deepEqual(report.updated, [after_.name], 'only the drifted record should be reported as updated');
  assert.notEqual(after_.description, 'stale text from an older build', 'the product owns the description and must refresh it');
  assert.deepEqual(after_.consent.projectIds, ['p1'], 'the operator owns consent and the seed must not touch it');
});

test('a built-in whose method left the engine keeps its row rather than being deleted at start-up', () => {
  const store = seedFixture();
  seedBuiltinTools(store);
  store.transact((state) => {
    state.tools.push({ id: 'builtin:engine.gone', name: 'engine_gone', transport: BUILTIN_TRANSPORT, config: { method: 'engine.gone' }, disabled: false, builtin: true });
    return {};
  });
  seedBuiltinTools(store);
  assert.ok(store.read().tools.some((item) => item.id === 'builtin:engine.gone'),
    'start-up deleted a tool record, taking any project grant and any operator disable with it');
});

/* --- 3 · the executor creates no authority ------------------------------------------------ */

const builtinTool = (method) => builtinToolRecords().find((record) => record.config.method === method);

test('a built-in call with no stated authority is refused, not run', async () => {
  const calls = [];
  const executor = new ToolExecutor({ engineDispatch: (...args) => { calls.push(args); return { ok: true }; } });
  await assert.rejects(
    () => executor.execute(builtinTool('status'), {}, { actorId: 'u1' }),
    (error) => error.status === 403 && /did not say what it may do/.test(error.message),
  );
  assert.deepEqual(calls, [], 'the engine was reached by a caller whose authority nobody established');
});

test('a deployment with no engine says so instead of throwing a TypeError', async () => {
  const executor = new ToolExecutor({});
  await assert.rejects(
    () => executor.execute(builtinTool('status'), {}, { actorId: 'u1', can: () => true }),
    (error) => error.status === 503 && /did not wire the engine/.test(error.message),
  );
});

test('the caller\'s own can() is what the engine is given — never a wider one', async () => {
  const seen = [];
  const executor = new ToolExecutor({ engineDispatch: (method, params, actor, can) => { seen.push({ method, params, actor, granted: can('workspace.read') }); return { rows: 1 }; } });
  const result = await executor.execute(builtinTool('repoMap.search'), { q: 'TODO' }, {
    actorId: 'owner-001', can: (permission) => permission === 'workspace.read',
  });
  assert.deepEqual(seen, [{ method: 'repoMap.search', params: { q: 'TODO' }, actor: 'owner-001', granted: true }]);
  assert.deepEqual(result.result, { rows: 1 });
  assert.equal(result.toolId, builtinTool('repoMap.search').id);
});

test('a built-in record with no method is a defect of this product, reported as one', async () => {
  const executor = new ToolExecutor({ engineDispatch: () => ({}) });
  await assert.rejects(
    () => executor.execute({ ...builtinTool('status'), config: {} }, {}, { actorId: 'u1', can: () => true }),
    (error) => error.status === 500 && /names no engine method/.test(error.message),
  );
});

/* --- 4 · the whole path, model excluded --------------------------------------------------- */

function scriptedModel(rounds) {
  const seen = [];
  let round = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[]}'); }
      seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const script = rounds[Math.min(round, rounds.length - 1)];
      round += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const frame of script) res.write(`data: ${JSON.stringify(frame)}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    });
  });
  startedServers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port, get rounds() { return round; } })));
}
const textFrame = (text) => ({ choices: [{ delta: { content: text } }] });
const callFrame = (name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: args } }] } }] });

function recordingResponse() {
  return {
    chunks: [], ended: false,
    writeHead() { return this; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end() { this.ended = true; },
    events() {
      return this.chunks.join('').split('\n\n').filter(Boolean).map((frame) => ({
        event: frame.match(/^event:\s*(.+)$/m)?.[1],
        data: JSON.parse(frame.match(/^data:\s*(.+)$/m)?.[1] ?? 'null'),
      }));
    },
    eventsNamed(name) { return this.events().filter((item) => item.event === name); },
  };
}

/** The real orchestrator, the real executor and the REAL dispatch — only the model is scripted.
 *  The dispatch is given the few collaborators the two methods exercised below actually touch;
 *  everything else stays undefined, which is what a deployment that did not wire a surface looks
 *  like and is answered with `UNAVAILABLE` rather than a crash. */
function fixture(port, { can = () => true, invariants = [{ id: 'SEC-003', enforced: true }] } = {}) {
  const dir = freshTempDir('noesar-builtin-loop-');
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  const graph = new ContextGraph(store);
  const workspace = new WorkspaceService({ store, graph });
  const vault = new CredentialVault({ keyPath: join(dir, 'p.key') });
  const ledger = { entries: [], append(entry) { this.entries.push(entry); } };
  const providers = new ProviderGateway({ store, vault, ledger });
  seedBuiltinTools(store, { ledger });
  const dispatch = createSessionDispatch({ contextGraph: graph, ledger, invariantEnforcement: invariants, aiWorkspace: workspace });
  const executor = new ToolExecutor({ vault, ledger, engineDispatch: dispatch });
  const project = graph.createProject({ name: 'P', instructions: '' });
  const { conversation } = graph.createConversation({ projectId: project.id, title: 'c', mode: 'ASK' });
  const profile = providers.create({ type: 'custom-openai-compatible', name: 'scripted', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'x' });
  providers.update(profile.id, { enabled: true });
  const orchestrator = new ChatOrchestrator({ graph, workspace, providers, store, ledger, toolExecutor: executor, installationSnapshot: () => ({ productName: 'NOESAR Evolution' }) });
  const res = recordingResponse();
  const start = (content) => orchestrator.streamToResponse({
    res, actorId: 'owner-001', can, conversationId: conversation.id, content, providerId: profile.id,
  });
  return { store, ledger, res, start, orchestrator };
}

test('the chat calls an engine method and answers from what this installation actually returned', async () => {
  const upstream = await scriptedModel([
    [callFrame('engine_product_invariants', '{}')],
    [textFrame('Questa installazione applica SEC-003.')],
  ]);
  const fx = fixture(upstream.port);
  await fx.start('quali invarianti applica questa installazione?');
  upstream.server.close();

  assert.equal(upstream.rounds, 2, 'the loop must go round twice: call, then answer');
  const result = fx.res.eventsNamed('tool-result').at(-1).data;
  assert.equal(result.ok, true, `the engine call failed: ${result.detail}`);
  // The preview is what a person watching the stream sees. Before P3 it was a slice of the
  // UNTRUSTED-CONTENT FENCE, so every tool result in the interface showed the same ~700 characters
  // of boilerplate and never the answer.
  assert.match(result.preview, /SEC-003/, 'the preview shown to the person does not contain the result');
  // And what the MODEL was fed on the second round — which is the actual claim of this test.
  const fedBack = upstream.seen[1].messages.find((message) => message.role === 'tool');
  assert.ok(fedBack, 'the result turn must be replayed to the model');
  assert.match(fedBack.content, /SEC-003/, 'the result the model was fed did not come from the real handler');
  assert.match(fedBack.content, /DATA, not instruction/, 'a tool result is untrusted content and must stay fenced for the model');

  const complete = fx.res.eventsNamed('complete').at(-1).data;
  assert.deepEqual(complete.toolCalls, [{ name: 'engine_product_invariants', ok: true, detail: null }]);
  assert.ok(fx.ledger.entries.some((entry) => entry.action === 'chat.tool-call' && entry.result === 'success'),
    'a tool that ran must leave an audit line');
});

test('a chat turn cannot reach a method the person could not reach themselves', async () => {
  const upstream = await scriptedModel([
    [callFrame('engine_sessions_list', '{}')],
    [textFrame('Non posso leggere le sessioni con i tuoi permessi.')],
  ]);
  // The same account, minus one permission. `sessions.list` asks `workspace.read`.
  const fx = fixture(upstream.port, { can: (permission) => permission !== 'workspace.read' });
  await fx.start('elenca le sessioni');
  upstream.server.close();

  const result = fx.res.eventsNamed('tool-result').at(-1).data;
  assert.equal(result.ok, false, 'the chat executed a method the caller had no permission for');
  assert.match(result.preview, /workspace\.read/, 'the refusal must name the permission that was missing');
  // And the turn survives it: a refused tool is a result, not a failed conversation.
  assert.equal(fx.res.eventsNamed('error').length, 0);
  assert.equal(fx.res.eventsNamed('complete').length, 1);
});

test('a name the installation never registered is refused by name, not looked up', async () => {
  const upstream = await scriptedModel([
    [callFrame('engine_replay_sweep', '{}')],
    [textFrame('Non ho quello strumento.')],
  ]);
  const fx = fixture(upstream.port);
  await fx.start('cancella lo storico');
  upstream.server.close();

  const result = fx.res.eventsNamed('tool-result').at(-1).data;
  assert.equal(result.ok, false);
  assert.equal(result.detail, 'out-of-scope', 'a destroying verb that is not registered must be refused before any lookup');
  assert.equal(fx.ledger.entries.filter((entry) => entry.action === 'tool.executed').length, 0, 'nothing was executed');
});

/* --- 5 · the resting cost is a number ----------------------------------------------------- */

test('the built-in catalogue rides in a turn under a declared budget', () => {
  // What `ChatOrchestrator.#buildContext` actually sends, byte for byte.
  const payload = builtinToolRecords().map((record) => ({
    type: 'function', function: { name: record.name, description: record.description, parameters: record.inputSchema },
  }));
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  // The budget is a CEILING with room to grow, not a record of today's number: a budget re-fitted
  // to whatever the code currently does turns the measurement into a rubber stamp (`D-0686`, the
  // i18n ratchet, three days ago). 12 KiB is roughly 3k tokens — real on a local 14B build, which
  // is why it is watched rather than assumed.
  assert.ok(bytes <= 12_288, `the engine tool schemas now cost ${bytes} bytes in every chat turn that names no tool`);
  // The floor matters too: a catalogue that silently emptied would sail under any ceiling.
  assert.ok(bytes > 2_000, `only ${bytes} bytes of tool schema — the catalogue is not being built`);
});
