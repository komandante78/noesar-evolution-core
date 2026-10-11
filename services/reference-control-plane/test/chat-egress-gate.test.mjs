// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The egress gate inside the chat — Owner, 2026-10-10: «internet entra, i dati del cliente non escono mai».
//
// Before this suite, `ChatOrchestrator` handed a web search the model's own words verbatim: a model that had just quoted
// a contract could search for the tenant's name or tax code, and nothing stood between the two. These tests drive the
// REAL orchestrator against a scripted upstream (the shape `chat-tool-loop.test.mjs` established), with a contract in
// the conversation so far, and look at what actually reaches the tool — the executor here records every input it gets.
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
import { freshTempDir } from './support/workspace.mjs';

const startedServers = [];
after(() => { for (const server of startedServers) { server.closeAllConnections?.(); server.close(); } });

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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}
const textFrame = (text) => ({ choices: [{ delta: { content: text } }] });
const callFrame = (name, args, id = 'call_1') => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const callsFrame = (name, list) => ({ choices: [{ delta: { tool_calls: list.map((args, index) => ({ index, id: `call_${index + 1}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] });
function recordingResponse() {
  return {
    chunks: [], writeHead() { return this; }, write(chunk) { this.chunks.push(String(chunk)); return true; }, end() {},
    events() { return this.chunks.join('').split('\n\n').filter(Boolean).map((f) => ({ event: f.match(/^event:\s*(.+)$/m)?.[1], data: JSON.parse(f.match(/^data:\s*(.+)$/m)?.[1] ?? 'null') })); },
    eventsNamed(name) { return this.events().filter((item) => item.event === name); },
  };
}

// A contract the conversation has already seen (an earlier answer quoted it): private for every later search.
const CONTRACT = 'Il conduttore Mario Rossi, codice fiscale RSSMRA80A01F205X, abita in Corso Vittorio Emanuele 88, Milano. Canone 1.150 euro, IBAN IT60X0542811101000000123456.';
const WEB = { name: 'engine_research_search', transport: 'builtin', config: { method: 'research.search' }, external: false };

function fixture(port, { executor, extraProfiles = false, historyMetadata = {} } = {}) {
  const dir = freshTempDir('noesar-egress-');
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  const graph = new ContextGraph(store);
  const workspace = new WorkspaceService({ store, graph });
  const vault = new CredentialVault({ keyPath: join(dir, 'p.key') });
  const ledger = { entries: [], append(entry) { this.entries.push(entry); } };
  const providers = new ProviderGateway({ store, vault, ledger });
  const files = { id: 'tool-files', name: 'engine_files_read', transport: 'builtin', config: { method: 'files.read' }, permissions: ['workspace.read'] };
  const records = [WEB, files].map((tool) => {
    const record = { id: tool.id ?? `tool-${tool.name}`, description: '', inputSchema: { type: 'object' }, disabled: false, external: false, timeoutMs: 5000, ...tool };
    store.transact((state) => { state.tools.push(record); return {}; });
    return record;
  });
  const project = graph.createProject({ name: 'P', instructions: '', toolIds: records.map((t) => t.id) });
  const { conversation, branch } = graph.createConversation({ projectId: project.id, title: 'c', mode: 'ASK' });
  graph.addMessage({ conversationId: conversation.id, branchId: branch?.id ?? conversation.activeBranchId, role: 'assistant', content: CONTRACT, metadata: historyMetadata });
  const profile = providers.create({ type: 'custom-openai-compatible', name: 'scripted', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'x' });
  providers.update(profile.id, { enabled: true });
  if (extraProfiles) {
    const outside = providers.create({ type: 'custom-openai-compatible', name: 'outside', external: true, apiStyle: 'openai-chat', baseUrl: 'https://api.example.com/v1', defaultModel: 'y' });
    providers.update(profile.id, { fallbackProviderIds: [outside.id] });
  }
  const orchestrator = new ChatOrchestrator({ graph, workspace, providers, store, ledger, toolExecutor: executor, installationSnapshot: () => ({}) });
  return { ledger, conversation, profileId: profile.id, orchestrator };
}
const recorder = () => { const inputs = []; return { inputs, async execute(tool, input) { inputs.push({ name: tool.name, input }); return { results: [] }; } }; };
const run = (fx, res, content) => fx.orchestrator.streamToResponse({ res, actorId: 'owner-001', can: () => true, conversationId: fx.conversation.id, content, providerId: fx.profileId });

test('a search that carries names and numbers from the documents reaches the tool without them', async () => {
  // (A search that copies five words in a row of the contract — "Corso Vittorio Emanuele 88 Milano" — is not cleaned but
  // blocked: found when this test was first written that way and failed. It is in the next test.)
  const upstream = await scriptedModel([[callFrame(WEB.name, { objective: 'disdetta contratto Mario Rossi Milano preavviso', criteria: ['quanti mesi'] })], [textFrame('ok')]]);
  const exec = recorder();
  const fx = fixture(upstream.port, { executor: exec });
  const res = recordingResponse();
  await run(fx, res, 'cerca su internet come si disdice il contratto');
  assert.equal(exec.inputs.length, 1, 'the search ran');
  const sent = JSON.stringify(exec.inputs[0].input);
  assert.ok(!/rossi|mario/i.test(sent), `nothing of the contract left: ${sent}`);
  assert.match(sent, /disdetta contratto Milano preavviso/);
  assert.equal(res.eventsNamed('egress')[0].data.outcome, 'CLEAN');
  // layer 1: the call that wrote the search saw the request and nothing of the contract
  const writer = JSON.stringify(upstream.seen[0].messages);
  assert.ok(!/RSSMRA|Vittorio|IT60X|1\.150/.test(writer), 'the search writer never saw the contract');
  assert.equal(upstream.seen[0].messages.length, 2, 'its whole input: one instruction and the request');
  const logged = fx.ledger.entries.filter((e) => e.action === 'chat.egress');
  assert.equal(logged[0].result, 'sent-cleaned');
  assert.ok(!/rossi/i.test(JSON.stringify(logged)), 'the ledger records the kinds removed, never the values');
});

test('a search that is only a datum, or copies a passage of the documents, is not sent at all, and the model is told why', async () => {
  // both searches written in the one round of the search writer; neither leaves
  const upstream = await scriptedModel([[callsFrame(WEB.name, [{ objective: 'IT60X0542811101000000123456' }, { objective: 'disdetta Corso Vittorio Emanuele 88 Milano' }])], [textFrame('ok')]]);
  const exec = recorder();
  const fx = fixture(upstream.port, { executor: exec });
  const res = recordingResponse();
  await run(fx, res, 'cerca online di che banca è il conto');
  assert.equal(exec.inputs.length, 0, 'the tool never ran');
  assert.deepEqual(res.eventsNamed('egress').map((e) => e.data.outcome), ['BLOCK', 'BLOCK']);
  const blocked = fx.ledger.entries.filter((e) => e.action === 'chat.egress' && e.result === 'blocked');
  assert.equal(blocked.length, 2);
  assert.ok(!/IT60X054/.test(JSON.stringify(fx.ledger.entries.filter((e) => e.action === 'chat.egress'))));
});

test('the model that writes the answer sees the documents and is offered no web search; if it tries, it is refused', async () => {
  const upstream = await scriptedModel([[textFrame('none')], [callFrame(WEB.name, { objective: 'aliquota iva ristrutturazione' })], [textFrame('ok')]]);
  const exec = recorder();
  const fx = fixture(upstream.port, { executor: exec });
  const res = recordingResponse();
  await run(fx, res, 'cerca su internet le regole e poi riassumi il contratto');
  const answerWriter = upstream.seen[1];
  assert.ok(JSON.stringify(answerWriter.messages).includes('RSSMRA'), 'the answer writer does see the conversation');
  assert.ok(!(answerWriter.tools ?? []).some((t) => t.function.name === WEB.name), 'and is offered no web search');
  assert.equal(exec.inputs.length, 0, 'its attempt never reached the tool');
  assert.ok(fx.ledger.entries.some((e) => e.action === 'chat.tool-call' && e.result === 'refused' && e.details.reason === 'out-of-scope'));
});

test('the worst search writer — it copies its input and translates any surname it sees — still sends no datum: it never saw one', async () => {
  // The scripted model plays the worst case: as the search it sends back exactly the request it was shown, and if it
  // sees the surname it also "translates" it (Rossi → Red), which no rule of the gate can recognise. Only layer 1 —
  // the writer never sees the surname — stops that. (Without the translation this test could not tell layer 1 from
  // the gate behind it: a mutation that showed the writer the real message survived, 2026-10-11.)
  const seenRequest = [];
  const server = createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[]}'); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      seenRequest.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const first = seenRequest.length === 1;
      const shown = String(body.messages.at(-1).content);
      const frame = first ? callsFrame(WEB.name, [{ objective: shown }, ...(/rossi/i.test(shown) ? [{ objective: 'Red family contract notice' }] : [])]) : textFrame('ok');
      res.write(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`); res.end();
    });
  });
  startedServers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const exec = recorder();
  const fx = fixture(server.address().port, { executor: exec });
  await run(fx, recordingResponse(), 'Trova su internet sentenze sulla disdetta di Mario Rossi, codice RSSMRA80A01F205X');
  assert.ok(!/rossi|RSSMRA/i.test(JSON.stringify(seenRequest[0].messages)), 'the writer was shown placeholders, not the data');
  const sent = JSON.stringify(exec.inputs.map((item) => item.input));
  assert.ok(!/rossi|mario|RSSMRA|DATO|\bred\b/i.test(sent), `what left: ${sent}`);
});

test('with an outside provider in the route, an earlier answer that used the documents is not sent to it', async () => {
  const upstream = await scriptedModel([[textFrame('ok')]]);
  const fx = fixture(upstream.port, { executor: recorder(), extraProfiles: true, historyMetadata: { privateData: true } });
  await run(fx, recordingResponse(), 'continua');
  for (const request of upstream.seen) assert.ok(!/RSSMRA|Vittorio|IT60X/.test(JSON.stringify(request.messages)), 'the contract stayed here');
});

test('an answer written in front of the documents is marked, and the mark is inherited by the next answer', async () => {
  const upstream = await scriptedModel([[textFrame('ok')]]);
  const fx = fixture(upstream.port, { executor: recorder(), historyMetadata: { privateData: true } });
  const res = recordingResponse();
  await run(fx, res, 'e quindi?');
  assert.equal(res.eventsNamed('complete')[0].data.message.metadata.privateData, true);
});

test('a datum the person typed themselves waits for their approval, and leaves only after it', async () => {
  const upstream = await scriptedModel([[callFrame(WEB.name, { objective: 'Mario Rossi' })], [textFrame('ok')]]);
  const exec = recorder();
  const fx = fixture(upstream.port, { executor: exec });
  const res = recordingResponse();
  const turn = run(fx, res, 'cerca Mario Rossi su internet');
  let approval = null;
  for (let i = 0; i < 200 && !approval; i++) { await new Promise((r) => setTimeout(r, 10)); approval = res.eventsNamed('tool-approval')[0]; }
  assert.ok(approval, 'the person is asked');
  assert.equal(exec.inputs.length, 0, 'nothing left before the answer');
  const runId = res.eventsNamed('run')[0].data.runId;
  assert.ok(fx.orchestrator.approve(runId, approval.data.id, true, 'owner-001'));
  await turn;
  assert.equal(exec.inputs.length, 1, 'it left after the approval');
  assert.equal(res.eventsNamed('egress')[0].data.outcome, 'ASK');
});

test('with an outside provider anywhere in the route, no tool that reads the workspace is offered, and that is recorded', async () => {
  const upstream = await scriptedModel([[textFrame('ok')]]);
  const fx = fixture(upstream.port, { executor: recorder(), extraProfiles: true });
  await run(fx, recordingResponse(), 'leggi il contratto');
  for (const request of upstream.seen) {
    const offered = (request.tools ?? []).map((t) => t.function.name);
    assert.ok(!offered.includes('engine_files_read'), `offered: ${offered.join(', ')}`);
  }
  assert.ok(fx.ledger.entries.some((e) => e.action === 'chat.private-data' && e.result === 'withheld'));
});

test('every other caller of a tool that leaves the computer gets the strict gate: any personal datum and nothing is sent', async () => {
  const dispatched = [];
  const ledger = { entries: [], append(e) { this.entries.push(e); } };
  const executor = new ToolExecutor({ ledger, engineDispatch: async (method, input) => { dispatched.push({ method, input }); return { results: [] }; } });
  const tool = { id: 'builtin:research.search', ...WEB };
  await assert.rejects(executor.execute(tool, { objective: 'codice fiscale RSSMRA80A01F205X' }, { can: () => true }), (e) => e.kind === 'EGRESS_BLOCKED' && e.status === 422);
  assert.equal(dispatched.length, 0, 'the search never reached the engine');
  await executor.execute(tool, { objective: 'aliquota iva ristrutturazione 2026' }, { can: () => true });
  assert.equal(dispatched.length, 1, 'a search with no personal datum goes through');
  assert.ok(ledger.entries.some((e) => e.action === 'tool.egress' && e.result === 'blocked'));
});

test('in a turn that has the documents in front of it, no internet asked for means no search at all', async () => {
  // Measured 2026-10-11 on the real 7B: a search writer allowed to answer "none" searched 0 times in 3 inside the
  // product, so whether to search is decided by the person's words, and then the writer always searches.
  const upstream = await scriptedModel([[callFrame(WEB.name, { objective: 'aliquota iva' })], [textFrame('ok')]]);
  const exec = recorder();
  const fx = fixture(upstream.port, { executor: exec });
  await run(fx, recordingResponse(), 'riassumi il contratto in tre righe');
  assert.equal(exec.inputs.length, 0, 'nothing was searched');
  assert.ok(!(upstream.seen[0].tools ?? []).some((t) => t.function.name === WEB.name), 'the answer writer was offered no web search');
  assert.ok(fx.ledger.entries.some((e) => e.action === 'chat.search-writer' && e.result === 'not-asked'));
});

// The web switch in the box (2026-10-11, one interface): the page always says whether this message may search. These drive
// what the page sends — `web` and the everyday register, where no tool is otherwise on offer.
const runFromPage = (fx, res, content, web) => fx.orchestrator.streamToResponse({ res, actorId: 'owner-001', can: () => true, conversationId: fx.conversation.id, content, providerId: fx.profileId, audience: 'everyday', mode: 'ASK', web });

test('the web switch on: a question with no word about the internet is searched, by the writer that never sees the data', async () => {
  const upstream = await scriptedModel([[callFrame(WEB.name, { objective: 'preavviso disdetta conduttore' })], [textFrame('sei mesi')]]);
  const found = []; const exec = { async execute(tool, input) { found.push(input); return { results: [{ url: 'https://www.example.org/disdetta', title: 'Disdetta' }] }; } };
  const fx = fixture(upstream.port, { executor: exec });
  const res = recordingResponse();
  await runFromPage(fx, res, 'con quanto preavviso può disdire Mario Rossi?', true);
  assert.equal(found.length, 1, 'the search ran');
  assert.equal(upstream.seen[0].messages.length, 2, 'written by the search writer: one instruction and the request');
  assert.ok(!/rossi/i.test(JSON.stringify(upstream.seen[0].messages)), 'which saw a placeholder, not the name');
  assert.deepEqual((upstream.seen[1].tools ?? []).map((t) => t.function.name), [], 'the answer writer is offered no search (and, in the everyday register, nothing else)');
  // what the person is shown above the answer, live and kept with it
  const searched = res.eventsNamed('searched')[0].data;
  assert.deepEqual([searched.outcome, searched.sent, searched.guarded, searched.removed], ['PROCEED', 'preavviso disdetta conduttore', true, false]);
  const kept = res.eventsNamed('complete')[0].data.message.metadata;
  assert.deepEqual(kept.web, [{ outcome: 'PROCEED', sent: 'preavviso disdetta conduttore', guarded: true, removed: false }]);
  assert.deepEqual(kept.webSources, ['https://www.example.org/disdetta'], 'the pages found, for the chips under the answer');
});

test('the web switch off: no search, even when the model writing the answer tries one', async () => {
  const upstream = await scriptedModel([[callFrame(WEB.name, { objective: 'aliquota iva' })], [textFrame('ok')]]);
  const exec = recorder();
  const fx = fixture(upstream.port, { executor: exec });
  const res = recordingResponse();
  await fx.orchestrator.streamToResponse({ res, actorId: 'owner-001', can: () => true, conversationId: fx.conversation.id, content: 'che aliquota iva si applica?', providerId: fx.profileId, web: false });
  assert.equal(exec.inputs.length, 0, 'nothing was searched');
  assert.ok(!(upstream.seen[0].tools ?? []).some((t) => t.function.name === WEB.name), 'no web search on offer');
  assert.equal(res.eventsNamed('searched').length, 0);
  assert.equal(res.eventsNamed('complete')[0].data.message.metadata.web, undefined, 'and nothing to show above the answer');
});

test('the words still count with the switch off: "cerca su internet" asks for the internet as surely as the switch', async () => {
  const upstream = await scriptedModel([[callFrame(WEB.name, { objective: 'preavviso disdetta' })], [textFrame('ok')]]);
  const exec = recorder();
  const fx = fixture(upstream.port, { executor: exec });
  await runFromPage(fx, recordingResponse(), 'cerca su internet il preavviso per la disdetta', false);
  assert.equal(exec.inputs.length, 1);
});

test('a stopped search is said too, and kept: nothing left this computer', async () => {
  const upstream = await scriptedModel([[callFrame(WEB.name, { objective: 'IT60X0542811101000000123456' })], [textFrame('ok')]]);
  const exec = recorder();
  const fx = fixture(upstream.port, { executor: exec });
  const res = recordingResponse();
  await runFromPage(fx, res, 'di che banca è il conto?', true);
  assert.equal(exec.inputs.length, 0);
  assert.deepEqual(res.eventsNamed('searched').map((e) => [e.data.outcome, e.data.sent]), [['BLOCK', null]]);
  assert.equal(res.eventsNamed('complete')[0].data.message.metadata.web[0].outcome, 'BLOCK');
});
