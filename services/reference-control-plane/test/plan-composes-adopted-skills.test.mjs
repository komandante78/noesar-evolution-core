// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Plan actually hands the adopted skills to the Author.
//
// WHY THIS FILE EXISTS, and it is not a nicety. `author-skill-composition.test.mjs` proves
// `buildAuthoringPrompt` composes skills and that a hostile one cannot renegotiate the call.
// All fourteen of those were green while the line that carries the skills FROM the plan TO
// the Author could be deleted with no test noticing — measured by deleting it: 55 passed,
// 0 failed. Prompt-side coverage says nothing about whether anything ever reaches the prompt.
// Same shape as `remote-targets`, unreachable for three months behind two green guards.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const NOW = Math.floor(Date.now() / 1000);
const created = [];

/**
 * An Author that records what it was handed and writes nothing interesting. `available`
 * must be true or `plan()` skips the authoring branch entirely — which would make every
 * assertion below pass for the wrong reason.
 */
function recordingAuthor(seen) {
  return {
    available: true,
    async author(call) {
      seen.push(call);
      return {
        contents: new Map(), unchanged: [], discarded: [], fixtures: [],
        refusals: [], degradations: [], novelty: 'novel', attemptDigest: 'x',
        summary: { authored: 0 },
      };
    },
  };
}

function fixture({ skillsFor, seen }) {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-skillplan-ws-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  writeFileSync(join(ws, 'target.mjs'), 'export const A = 1;\n');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-skillplan-shadows-'));
  created.push(ws, shadows);
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
    author: recordingAuthor(seen),
    ...(skillsFor ? { skillsFor } : {}),
  });
  return { ws, orch };
}

after(() => { for (const dir of created) rmSync(dir, { recursive: true, force: true }); });

async function planOnce(orch) {
  return orch.plan({
    request: 'raise A to two',
    files: [{ path: 'target.mjs', contents: 'export const A = 1;\n' }],
    actor: 'tester', nowUnix: NOW,
  });
}

describe('the Plan carries adopted skills to the Author', () => {
  test('a skill in scope arrives at the Author', async () => {
    const seen = [];
    const { orch } = fixture({
      seen,
      skillsFor: () => [{ id: 'house', name: 'House', instructions: 'Prefer const.' }],
    });
    await planOnce(orch);
    assert.equal(seen.length, 1, 'the Author must have been called');
    assert.deepEqual(seen[0].skills?.map((s) => s.id), ['house']);
    assert.equal(seen[0].skills[0].instructions, 'Prefer const.');
  });

  test('with nothing adopted the Author is handed an empty set, never undefined', async () => {
    const seen = [];
    const { orch } = fixture({ seen });
    await planOnce(orch);
    assert.deepEqual(seen[0].skills, []);
  });

  test('the run reports which skills reached the writer, by size and never by body', async () => {
    const seen = [];
    const { orch } = fixture({
      seen,
      skillsFor: () => [{ id: 'house', name: 'House', instructions: 'Prefer const.' }],
    });
    const run = await planOnce(orch);
    assert.equal(run.skillComposition.composed, 1);
    assert.equal(run.skillComposition.skills[0].id, 'house');
    assert.equal(run.skillComposition.skills[0].instructionBytes, 13);
    // The body must not travel on the run record — that would put what `searchCatalog`
    // refuses to return into the ledger through the back door.
    assert.ok(!JSON.stringify(run.skillComposition).includes('Prefer const.'));
  });

  test('skillComposition is present even when nothing was composed', async () => {
    // A field that appears only when something happened is a field a shell stops reading.
    const seen = [];
    const { orch } = fixture({ seen });
    const run = await planOnce(orch);
    assert.equal(run.skillComposition.composed, 0);
    assert.deepEqual(run.skillComposition.skills, []);
  });

  test('a resolver that throws costs the operator the skills, never the plan', async () => {
    const seen = [];
    const { orch } = fixture({
      seen,
      skillsFor: () => { throw new Error('registry exploded'); },
    });
    const run = await planOnce(orch);
    assert.ok(run, 'the plan must still be produced');
    assert.equal(run.skillComposition.composed, 0);
    assert.match(run.skillComposition.reason, /registry exploded/);
    assert.deepEqual(seen[0].skills, []);
  });

  test('a resolver returning something that is not a list is treated as none', async () => {
    const seen = [];
    const { orch } = fixture({ seen, skillsFor: () => 'not a list' });
    const run = await planOnce(orch);
    assert.equal(run.skillComposition.composed, 0);
    assert.deepEqual(seen[0].skills, []);
  });

  test('the resolver is consulted per plan, so dropping a skill takes effect on the next one', async () => {
    const seen = [];
    let inScope = [{ id: 'temporary', name: 'Temporary', instructions: 'For this task only.' }];
    const { orch } = fixture({ seen, skillsFor: () => inScope });
    await planOnce(orch);
    inScope = [];
    await planOnce(orch);
    assert.deepEqual(seen[0].skills.map((s) => s.id), ['temporary']);
    assert.deepEqual(seen[1].skills, []);
  });
});
