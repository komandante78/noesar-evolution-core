// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The AI workspace state migration — WP-2 raised `AI_STATE_VERSION` from 1 to 2 to add
// `workflows` and `workflowRuns`; the missing interface parts raised it from 2 to 3 to add
// `reviewSamples` (UI-070…UI-072) and to backfill the two fields a session needs to be
// archivable and binnable (UI-011, UI-012); D-0286 raised it from 3 to 4 to add
// `remoteTargets` (Debug Evolution Phase 3, SSH-fetched scan targets).
//
// This test exists because of a defect this project has already found and paid for: PostgreSQL
// migration 0012 could never be applied to any cluster, which was itself the proof that the
// delivered SQL had never been executed. A version constant bumped without a migration beside
// it is the same defect in a different file — and the consequence here is concrete, not
// theoretical. The installed workspace at RUNTIME_ROOT/state/ai-workspace.json carried
// `"schemaVersion": 1` when this test was first written. Before that migration existed,
// `validateState` demanded an exact match, so the next deployment would have refused to load
// the workspace at all.
//
// The fixture below is therefore not invented. It is the shape of the real installed file:
// version 1, with the thirteen collections that version had and none of the four added since.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AI_STATE_VERSION, AtomicJsonStore, defaultAiState, migrateAiState } from '../src/ai-workspace/atomic-store.mjs';

const VERSION_1_COLLECTIONS = [
  'projects', 'conversations', 'messages', 'branches', 'memories', 'artifacts', 'sources',
  'knowledgeChunks', 'providerProfiles', 'tools', 'agents', 'agentRuns', 'tasks',
];

// A version-1 state file carrying real content, so the test proves data survives rather
// than only that an empty file upgrades.
function versionOneState() {
  const state = { schemaVersion: 1 };
  for (const name of VERSION_1_COLLECTIONS) state[name] = [];
  state.projects.push({ id: 'project-1', name: 'Existing project' });
  state.providerProfiles.push({ id: 'provider-1', name: 'Local OpenAI-compatible', enabled: false });
  state.tasks.push({ id: 'task-1', title: 'Existing task', status: 'open' });
  state.settings = { defaultProviderId: 'provider-1', externalEgressDefault: 'deny', retentionDays: 365, semanticSearchEnabled: true };
  return state;
}

describe('the AI workspace state migrates forward', () => {
  test('the current version is 4 and the default state carries every added collection', () => {
    assert.equal(AI_STATE_VERSION, 4);
    const fresh = defaultAiState();
    assert.deepEqual(fresh.workflows, []);
    assert.deepEqual(fresh.workflowRuns, []);
    assert.deepEqual(fresh.reviewSamples, []);
    assert.deepEqual(fresh.remoteTargets, []);
  });

  test('a version-2 state gains the review samples, the session fields, and the later remoteTargets collection', () => {
    const version2 = { ...versionOneState(), schemaVersion:2, workflows:[], workflowRuns:[] };
    version2.conversations.push({ id:'c-1', title:'Written before the bin existed', archived:false });
    const migrated = migrateAiState(version2);

    assert.equal(migrated.schemaVersion, 4);
    assert.deepEqual(migrated.reviewSamples, []);
    assert.deepEqual(migrated.remoteTargets, [], 'migrateAiState always runs to AI_STATE_VERSION, not just to where this migration itself stops');
    // The backfill is the point: a record written before these fields existed must answer
    // the same way as one written after, or `deletedAt` reads `undefined` and a session
    // looks alive to one operator and dead to another.
    assert.equal(migrated.conversations[0].deletedAt, null);
    assert.equal(migrated.conversations[0].purgeAfter, null);
    assert.equal(migrated.conversations[0].title, 'Written before the bin existed');
  });

  test('a version-3 state gains remoteTargets and nothing else changes', () => {
    const version3 = { ...defaultAiState(), schemaVersion: 3 };
    delete version3.remoteTargets;
    version3.projects.push({ id: 'project-1', name: 'Existing project' });
    const migrated = migrateAiState(version3);

    assert.equal(migrated.schemaVersion, 4);
    assert.deepEqual(migrated.remoteTargets, []);
    assert.equal(migrated.projects[0].id, 'project-1', 'D-0286 is purely additive -- nothing pre-existing is touched');
  });

  test('the chain runs 1 to 4 in one read, because the installed file is still version 1', () => {
    const migrated = migrateAiState(versionOneState());
    assert.equal(migrated.schemaVersion, 4);
    assert.deepEqual(migrated.workflows, []);
    assert.deepEqual(migrated.reviewSamples, []);
    assert.deepEqual(migrated.remoteTargets, []);
    assert.equal(migrated.projects[0].id, 'project-1');
  });

  test('a version-1 state is upgraded rather than refused', () => {
    const migrated = migrateAiState(versionOneState());
    assert.equal(migrated.schemaVersion, 4);
    assert.deepEqual(migrated.workflows, []);
    assert.deepEqual(migrated.workflowRuns, []);
    assert.deepEqual(migrated.remoteTargets, []);
  });

  test('migration preserves every existing record and setting', () => {
    const before = versionOneState();
    const migrated = migrateAiState(before);
    for (const name of VERSION_1_COLLECTIONS) {
      assert.deepEqual(migrated[name], before[name], `${name} must survive the migration untouched`);
    }
    assert.deepEqual(migrated.settings, before.settings);
  });

  test('an already-current state is returned unchanged', () => {
    const current = defaultAiState();
    const migrated = migrateAiState(current);
    assert.equal(migrated.schemaVersion, 4);
    assert.deepEqual(migrated, current);
  });

  test('a state from a future version is refused, not guessed at', () => {
    // An older build must not operate on state whose invariants it does not know. It would
    // not fail loudly — it would corrupt quietly, for instance by deleting a project a
    // workflow run still references.
    assert.throws(
      () => migrateAiState({ ...defaultAiState(), schemaVersion: AI_STATE_VERSION + 1 }),
      /newer than this build supports/,
    );
  });

  test('a version with no migration registered is refused', () => {
    assert.throws(() => migrateAiState({ schemaVersion: 0 }), /No migration from AI workspace schemaVersion 0/);
  });
});

describe('the store reads and rewrites an installed version-1 file', () => {
  test('read() upgrades a real version-1 file on disk without touching it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'noesar-ai-migration-'));
    const path = join(directory, 'state/ai-workspace.json');
    const store = new AtomicJsonStore(path);
    const original = `${JSON.stringify(versionOneState(), null, 2)}\n`;
    writeFileSync(path, original, { encoding: 'utf8', mode: 0o600 });

    const read = store.read();
    assert.equal(read.schemaVersion, 4, 'the installed file must load, not throw');
    assert.equal(read.projects.length, 1);

    // Reading is not writing: the file on disk is still exactly what the running product
    // wrote, so a read alone can never make the state unreadable to the current image.
    assert.equal(readFileSync(path, 'utf8'), original);
  });

  test('the first write after a migration persists version 4 and keeps the data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'noesar-ai-migration-write-'));
    const path = join(directory, 'state/ai-workspace.json');
    const store = new AtomicJsonStore(path);
    writeFileSync(path, `${JSON.stringify(versionOneState(), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

    store.transact((state) => { state.workflows.push({ id: 'workflow-1', name: 'First workflow' }); });

    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(persisted.schemaVersion, 4);
    assert.equal(persisted.workflows.length, 1);
    assert.equal(persisted.projects.length, 1, 'the pre-existing project must still be there');
    assert.equal(persisted.tasks[0].title, 'Existing task');
  });

  test('a transaction on a migrated file does not crash on the new collections', () => {
    // This is the failure mode the migration exists to prevent: `state.workflows.push(...)`
    // against `undefined` on the very first workflow created on an upgraded installation.
    const directory = mkdtempSync(join(tmpdir(), 'noesar-ai-migration-push-'));
    const path = join(directory, 'state/ai-workspace.json');
    const store = new AtomicJsonStore(path);
    writeFileSync(path, `${JSON.stringify(versionOneState(), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    assert.doesNotThrow(() => store.transact((state) => { state.workflowRuns.push({ id: 'run-1' }); }));
    assert.doesNotThrow(() => store.transact((state) => { state.remoteTargets.push({ id: 'target-1' }); }));
  });
});
