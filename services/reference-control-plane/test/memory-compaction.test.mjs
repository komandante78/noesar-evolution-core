import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLedger } from '../src/events.mjs';
import { compactRun } from '../src/memory-compaction.mjs';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const RUN = 'run-1';

function fakeMemoryService() {
  const written = [];
  return {
    written,
    write: async (args) => { written.push(args); return { ...args, id: `mem-${written.length}` }; },
  };
}

test('compactRun() skips an event whose action nobody has taught this file (fail closed, the strong way)', async () => {
  const ledger = new EventLedger();
  ledger.append({
    id: 'e1', correlationId: RUN, actor: ACTOR,
    action: 'a-synthetic-action-invented-for-this-test', payload: '{}', recordedAtUnix: 1000,
  });
  const memoryService = fakeMemoryService();
  const result = await compactRun({ ledger, memoryService }, { runId: RUN });
  assert.equal(result.written.length, 0);
  assert.equal(result.skipped, 1);
  assert.equal(memoryService.written.length, 0);
});

test('compactRun() extracts a decisione from workspace_action.planned, citing the event', async () => {
  const ledger = new EventLedger();
  ledger.append({
    id: 'e1', correlationId: RUN, actor: ACTOR, action: 'workspace_action.planned',
    payload: JSON.stringify({ goal: 'fix the flaky test', risk: 'low', files: ['a.mjs'] }),
    recordedAtUnix: 1_753_000_000,
  });
  const memoryService = fakeMemoryService();
  const result = await compactRun({ ledger, memoryService }, { runId: RUN, projectId: 'p1' });
  assert.equal(result.written.length, 1);
  const [candidate] = memoryService.written;
  assert.equal(candidate.cube, 'workshop');
  assert.equal(candidate.category, 'decisione');
  assert.match(candidate.content, /fix the flaky test/);
  assert.equal(candidate.derived, false);
  assert.equal(candidate.promotionState, 'project-candidate');
  assert.equal(candidate.provenance.eventId, 'e1');
  assert.equal(candidate.provenance.runId, RUN);
  assert.equal(candidate.actorId, ACTOR);
  assert.equal(candidate.projectId, 'p1');
});

test('compactRun() maps executor.ran and workspace_action.refused to fatto/difetto respectively', async () => {
  const ledger = new EventLedger();
  ledger.append({
    id: 'e1', correlationId: RUN, actor: ACTOR, action: 'workspace_action.planned',
    payload: JSON.stringify({ goal: 'g', risk: 'low', files: [] }), recordedAtUnix: 1000,
  });
  ledger.append({
    id: 'e2', correlationId: RUN, causationId: 'e1', actor: ACTOR, action: 'executor.ran',
    payload: JSON.stringify({ performed: ['x'], refused: [], ok: true }), recordedAtUnix: 1001,
  });
  ledger.append({
    id: 'e3', correlationId: RUN, causationId: 'e2', actor: ACTOR, action: 'workspace_action.refused',
    payload: JSON.stringify({ reason: 'a claim was contradicted' }), recordedAtUnix: 1002,
  });
  const memoryService = fakeMemoryService();
  const result = await compactRun({ ledger, memoryService }, { runId: RUN });
  assert.equal(result.written.length, 3);
  assert.equal(memoryService.written[1].category, 'fatto');
  assert.equal(memoryService.written[2].category, 'difetto');
  assert.match(memoryService.written[2].content, /contradicted/);
});

test('compactRun() discards an event whose payload does not parse, without throwing', async () => {
  const ledger = new EventLedger();
  ledger.append({
    id: 'e1', correlationId: RUN, actor: ACTOR, action: 'workspace_action.planned',
    payload: 'not json', recordedAtUnix: 1000,
  });
  const memoryService = fakeMemoryService();
  const result = await compactRun({ ledger, memoryService }, { runId: RUN });
  assert.equal(result.written.length, 0);
  assert.equal(result.discarded.length, 1);
  assert.equal(result.discarded[0], 'e1');
});

test('compactRun() produces globally-unique, immutable-shape signatures per event', async () => {
  const ledger = new EventLedger();
  ledger.append({
    id: 'e1', correlationId: RUN, actor: ACTOR, action: 'workspace_action.planned',
    payload: JSON.stringify({ goal: 'g', risk: 'low', files: [] }), recordedAtUnix: 1_753_000_000,
  });
  const memoryService = fakeMemoryService();
  await compactRun({ ledger, memoryService }, { runId: RUN });
  assert.match(memoryService.written[0].signature, /^workshop\/workspace-actions\/\d{4}\/\d{2}\/\d{2}\/e1-decisione$/);
});
