// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0346` — the run directory is bounded.
//
// From the day durability was built (`D-0338`) `save()` wrote one file per run and nothing
// ever removed one. On a self-hosted installation that runs for months that is a disk
// filling up in silence — and it fills in the worst possible way, because the product keeps
// working right up to the moment it can no longer write anything at all, the audit ledger
// included. It was carried as "registered and NOT done, for scope" across four sessions.
//
// The two properties that matter are not "old files go away". They are: a run somebody is
// waiting on is never removed, and a file this store cannot read is never removed either.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, RunStoreError } from '../src/run-store.mjs';

const created = [];
after(() => { for (const dir of created) rmSync(dir, { recursive: true, force: true }); });

function storeWith(count, { startAt = 1000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-run-retention-'));
  created.push(dir);
  const store = new RunStore(dir);
  for (let i = 0; i < count; i += 1) {
    // savedAtUnix ascending, so run-0 is the oldest and run-(n-1) the newest.
    store.save(`run-${i}`, { status: 'PROMOTED', n: i });
    const file = join(dir, `run-${i}.json`);
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    doc.savedAtUnix = startAt + i;
    writeFileSync(file, `${JSON.stringify(doc)}\n`);
  }
  return { dir, store };
}

describe('the run directory stops growing without limit', () => {
  test('the newest `keep` survive and the rest go', () => {
    const { dir, store } = storeWith(10);
    const result = store.prune({ keep: 4 });
    assert.equal(result.removed.length, 6);
    assert.equal(result.kept, 4);
    assert.equal(readdirSync(dir).filter((n) => n.endsWith('.json')).length, 4);
  });

  test('it keeps the NEWEST, not whichever the filesystem listed first', () => {
    const { dir, store } = storeWith(10);
    store.prune({ keep: 3 });
    const left = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    assert.deepEqual(left, ['run-7.json', 'run-8.json', 'run-9.json']);
  });

  test('under the limit nothing is touched', () => {
    const { dir, store } = storeWith(3);
    const result = store.prune({ keep: 100 });
    assert.deepEqual(result.removed, []);
    assert.equal(readdirSync(dir).filter((n) => n.endsWith('.json')).length, 3);
  });

  test('pruning twice removes nothing the second time', () => {
    const { store } = storeWith(10);
    store.prune({ keep: 4 });
    assert.deepEqual(store.prune({ keep: 4 }).removed, []);
  });

  test('what survives still loads', () => {
    const { store } = storeWith(10);
    store.prune({ keep: 2 });
    const { runs, damaged } = store.loadAll();
    assert.equal(runs.length, 2);
    assert.deepEqual(damaged, []);
  });
});

describe('what pruning refuses to remove', () => {
  test('a protected run survives even when it is the oldest thing there', () => {
    // The property that matters most: a PENDING_APPROVAL run is a person waiting for a
    // decision, and deleting it because it is old answers the decision by losing it.
    const { dir, store } = storeWith(10);
    const result = store.prune({ keep: 2, protectedRunIds: new Set(['run-0']) });
    assert.ok(existsSync(join(dir, 'run-0.json')), 'the protected run must survive');
    assert.ok(!result.removed.includes('run-0'));
    assert.equal(result.protectedCount, 1);
  });

  test('a protected run does not eat into the budget for the others', () => {
    const { dir, store } = storeWith(10);
    store.prune({ keep: 2, protectedRunIds: new Set(['run-0']) });
    const left = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    assert.deepEqual(left, ['run-0.json', 'run-8.json', 'run-9.json']);
  });

  test('a file it cannot read is never deleted', () => {
    // Guessing that unreadable means disposable is how evidence disappears exactly when
    // something has already gone wrong.
    const { dir, store } = storeWith(6);
    writeFileSync(join(dir, 'run-damaged.json'), '{ this is not json');
    const result = store.prune({ keep: 1 });
    assert.ok(existsSync(join(dir, 'run-damaged.json')), 'a damaged file must survive pruning');
    assert.equal(result.damagedSkipped, 1);
  });

  test('a file that is not a run file is left alone', () => {
    const { dir, store } = storeWith(4);
    writeFileSync(join(dir, 'README.txt'), 'not a run');
    store.prune({ keep: 1 });
    assert.ok(existsSync(join(dir, 'README.txt')));
  });

  test('a store with no directory prunes nothing and does not throw', () => {
    assert.deepEqual(new RunStore(null).prune({ keep: 1 }).removed, []);
  });

  test('a nonsense retention is refused rather than silently treated as zero', () => {
    // The version of this that "worked" by coercing -1 to 0 would delete every run.
    const { store } = storeWith(2);
    for (const bad of [-1, 1.5, '10', null, NaN]) {
      assert.throws(() => store.prune({ keep: bad }), (error) => error instanceof RunStoreError);
    }
  });
});

// Everything above tests `prune()`. None of it tests that anything ever CALLS it — the
// distinction this project has now paid for twice (`remote-targets` unreachable for three
// months; the plan-to-Author skill wiring deletable with 55 tests green). So: drive the
// orchestrator, count the files on disk, and let the directory itself be the assertion.
describe('the product actually prunes, it does not merely own a pruner', () => {
  const NOW = Math.floor(Date.now() / 1000);

  async function orchestratorWithRetention(runRetention) {
    const { WorkspaceActionOrchestrator } = await import('../src/workspace-actions.mjs');
    const { TokenMinter } = await import('../src/capability.mjs');
    const { EventLedger } = await import('../src/events.mjs');
    const { randomBytes } = await import('node:crypto');

    const ws = mkdtempSync(join(tmpdir(), 'noesar-retention-ws-'));
    const shadows = mkdtempSync(join(tmpdir(), 'noesar-retention-shadows-'));
    const runs = mkdtempSync(join(tmpdir(), 'noesar-retention-runs-'));
    created.push(ws, shadows, runs);
    writeFileSync(join(ws, '.seed'), 'seed');
    writeFileSync(join(ws, 'target.mjs'), 'export const A = 1;\n');

    const orch = new WorkspaceActionOrchestrator({
      workspaceRoot: ws, shadowsRoot: shadows,
      minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
      runStoreDirectory: runs, runRetention,
    });
    return { orch, runs };
  }

  const planOnce = (orch, n) => orch.plan({
    request: `change number ${n}`,
    files: [{ path: 'target.mjs', contents: 'export const A = 1;\n' }],
    actor: 'tester', nowUnix: NOW + n,
  });

  test('planning more runs than the limit leaves the limit on disk', async () => {
    const { orch, runs } = await orchestratorWithRetention(3);
    const ids = [];
    for (let i = 0; i < 8; i += 1) ids.push((await planOnce(orch, i)).runId);
    // Every run here is PENDING_APPROVAL, so protection must hold ALL of them: the bound
    // is on finished work, never on decisions nobody has made yet.
    assert.equal(readdirSync(runs).filter((n) => n.endsWith('.json')).length, 8,
      'pending runs must never be pruned, however many there are');

    // Decide them, and only then may they be pruned.
    // Later than every plan above: the ledger refuses an event recorded before its cause,
    // and `NOW` would be earlier than the last plan's `NOW + 7`.
    for (const runId of ids) orch.reject({ runId, approverId: 'tester', reason: 'test', nowUnix: NOW + 100 });
    assert.equal(readdirSync(runs).filter((n) => n.endsWith('.json')).length, 3,
      'once decided, the directory must fall to the retention limit');
  });

  test('a retention that is not a positive integer is refused at construction', async () => {
    for (const bad of [0, -1, 2.5, '10', null]) {
      await assert.rejects(
        async () => orchestratorWithRetention(bad),
        (error) => /runRetention must be a positive integer/.test(String(error?.message ?? error)),
        `runRetention=${JSON.stringify(bad)} must be refused`,
      );
    }
  });
});
