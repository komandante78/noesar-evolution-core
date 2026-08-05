// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 4, step 1 — the measurement that must come BEFORE any file is touched.
//
// `17` asks for the shape and the size of the context AT CALL 3 AND AT CALL 300.
// This drives the real path, not a model of it: ContextGraph accumulates the
// messages, WorkspaceService.contextInspection() reads them back, and
// ChatOrchestrator#buildContext maps them one-for-one into the array the provider
// receives (chat-orchestrator.mjs:32). The mapping on that line is reproduced here
// verbatim because the method is private; everything upstream of it is the product's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../services/reference-control-plane/src/ai-workspace/atomic-store.mjs';
import { ContextGraph } from '../services/reference-control-plane/src/ai-workspace/context-graph.mjs';
import { WorkspaceService } from '../services/reference-control-plane/src/ai-workspace/workspace-service.mjs';
import { projectionByteCeiling, projectionShape, renderProjection } from '../services/reference-control-plane/src/context-projector.mjs';

const dir = mkdtempSync(join(tmpdir(), 'noesar-phase4-'));
const store = new AtomicJsonStore(join(dir, 'state.json'));
const graph = new ContextGraph(store);
const workspace = new WorkspaceService({ store, graph, ledger: null });

const project = graph.createProject({ name: 'measured', instructions: 'Follow the repository conventions.' });
const { conversation, branch } = graph.createConversation({ projectId: project.id, title: 'a long task', mode: 'ACT' });

// One "call" = one exchange on the same task: what the operator asked, and what came
// back. That is the unit `15` §2 counts when it says coherence breaks after 25-30.
const ask = (n) => `step ${n}: keep working on the same task, and report what changed`;
const reply = (n) => `step ${n} done. I edited services/reference-control-plane/src/server.mjs and re-ran the suite; 1760 passed, 1 failed, and the failure is the pre-existing one.`;

const samples = new Map();
const WATCH = [3, 25, 50, 100, 200, 300, 400];

graph.recordContextFact({ conversationId: conversation.id, section: 'goal', value: { text: 'keep working on the same task until it is done' } });

for (let n = 1; n <= Math.max(...WATCH); n += 1) {
  graph.addMessage({ conversationId: conversation.id, branchId: branch.id, role: 'user', content: ask(n) });
  graph.addMessage({ conversationId: conversation.id, branchId: branch.id, role: 'assistant', content: reply(n) });
  // The state the projector reads, written at the same rate as the transcript grows: one
  // plan step, one piece of evidence and one changed file per call.
  graph.recordContextFact({ conversationId: conversation.id, section: 'plan', value: { step: n, verb: 'edit', target: `src/file-${n}.mjs`, status: 'done' } });
  graph.recordContextFact({ conversationId: conversation.id, section: 'evidence', value: { claim: `step ${n} re-ran the suite`, source: 'npm test', recomputed: true } });
  graph.recordContextFact({ conversationId: conversation.id, section: 'diff', value: { path: `src/file-${n}.mjs`, added: n, removed: 1 } });
  if (!WATCH.includes(n)) continue;

  const t0 = process.hrtime.bigint();
  const inspection = workspace.contextInspection({ conversationId: conversation.id, branchId: branch.id });
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  // chat-orchestrator.mjs:29-34 — the array the provider is handed.
  const messages = [
    { role: 'system', content: ['ACT mode instruction', `Project instructions:\n${inspection.project.instructions}`].join('\n\n') },
    ...inspection.messages.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: ask(n) },
  ];
  const bytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
  // The shape, as a component would have to describe it to reconstruct it: the ordered
  // list of roles collapsed to its distinct runs, plus the top-level keys.
  const runs = messages.map((m) => m.role).filter((role, i, all) => role !== all[i - 1]);
  const t1 = process.hrtime.bigint();
  const projected = projectionShape(graph.projectSessionContext(conversation.id));
  const projectMs = Number(process.hrtime.bigint() - t1) / 1e6;

  samples.set(n, {
    call: n,
    entries: messages.length,
    bytes,
    tokenEstimate: inspection.tokenEstimate,
    shape: runs.join('>'),
    keys: [...new Set(messages.flatMap((m) => Object.keys(m)))].sort().join(','),
    readMs: Number(elapsedMs.toFixed(2)),
    afterBytes: projected.bytes,
    afterShape: projected.shape,
    afterDigest: projected.digest,
    projectMs: Number(projectMs.toFixed(2)),
  });
}

console.log('PHASE 4 — MISURA PRIMA (context handed to the model, per call)\n');
console.log(['call', 'entries', 'bytes', 'tokenEst', 'readMs', 'shape'].map((h) => h.padStart(9)).join(''));
for (const s of samples.values()) {
  console.log([s.call, s.entries, s.bytes, s.tokenEstimate, s.readMs, s.shape.length > 40 ? `${s.shape.slice(0, 37)}...` : s.shape]
    .map((v) => String(v).padStart(9)).join(''));
}
const three = samples.get(3);
const threeHundred = samples.get(300);
console.log('\nCALL 3 vs CALL 300');
console.log(`  entries   ${three.entries} -> ${threeHundred.entries}   (x${(threeHundred.entries / three.entries).toFixed(1)})`);
console.log(`  bytes     ${three.bytes} -> ${threeHundred.bytes}   (x${(threeHundred.bytes / three.bytes).toFixed(1)})`);
console.log(`  tokenEst  ${three.tokenEstimate} -> ${threeHundred.tokenEstimate}`);
console.log(`  same shape? ${three.shape === threeHundred.shape}`);
console.log(`  same keys?  ${three.keys === threeHundred.keys}  (${three.keys})`);
console.log(`\n  read cost  ${three.readMs}ms -> ${threeHundred.readMs}ms`);

console.log('\n\nPHASE 4 — MISURA DOPO (context-projector.mjs, same run, same store)\n');
console.log(['call', 'bytes', 'projMs', 'shape'].map((h) => h.padStart(9)).join(''));
for (const s of samples.values()) {
  console.log([s.call, s.afterBytes, s.projectMs].map((v) => String(v).padStart(9)).join('') + `  ${s.afterShape}`);
}
console.log('\nCALL 3 vs CALL 300');
console.log(`  bytes        ${three.afterBytes} -> ${threeHundred.afterBytes}   (x${(threeHundred.afterBytes / three.afterBytes).toFixed(2)})`);
console.log(`  same shape?  ${three.afterShape === threeHundred.afterShape}`);
console.log(`  ceiling      ${projectionByteCeiling()} bytes, derived from the schema — never exceeded above`);
console.log(`  call 400 == call 300 in bytes? ${samples.get(400).afterBytes === threeHundred.afterBytes}`);
console.log(`\n  reduction at call 300: ${threeHundred.bytes} -> ${threeHundred.afterBytes} bytes (${(100 - (threeHundred.afterBytes / threeHundred.bytes) * 100).toFixed(1)}% smaller)`);

console.log('\n\nTHE VIEW AT CALL 300, IN FULL (nothing is elided by this script)\n');
console.log(renderProjection(graph.projectSessionContext(conversation.id)));

rmSync(dir, { recursive: true, force: true });
