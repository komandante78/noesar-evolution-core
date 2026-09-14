// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `interpret().ambiguities` named by the LOCAL model — the route decided with the Owner on
// 14/09/2026, and the four decisions it carries, each with a test that fails when it breaks:
//
//   1. only `ambiguities` comes from the model; the goal stays the engine's quote (grounding
//      searches on it, so a model rewording it would move every file the product finds)
//   2. replay re-reads the recorded answer and never asks the model again (`CE-006`)
//   3. a model that cannot answer — or answers nothing readable — degrades to the provider that
//      answered the rest of the intent, DECLARED
//   4. off unless named: with no configuration nothing changes and the model is never asked
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

import { ReasoningRouter, routingFrom, degradationSummary } from '../src/reasoning-router.mjs';
import { ReasoningRefused } from '../src/reasoning.mjs';
import { namerPrompt } from '../src/ambiguity-namer.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const LOCAL = Object.freeze({ NOESAR_LOCAL_MODEL_SURFACES: 'interpret', NOESAR_AUTHORING_ENDPOINT: 'http://model.invalid' });
// INTERPRET-002 of the shared vectors: the ten vague words find two ambiguities in this request.
const REQUEST = 'Tidy the config files, handlers etc, as needed.';
const NAMED = 'Which config files are in scope?\nWhich handlers count as handlers here?';
const NAMED_LIST = ['Which config files are in scope?', 'Which handlers count as handlers here?'];
const NOW = Math.floor(Date.now() / 1000);
const digest = (text) => createHash('sha256').update(String(text)).digest('hex');

/** A generation port that answers what it is given — or throws it — and counts every ask. */
function model(answer) {
  const asked = [];
  const generate = async ({ prompt }) => {
    asked.push(prompt);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { generate, asked };
}

test('with no configuration interpret is the reference provider, and the model is never asked', async () => {
  const port = model(NAMED);
  const router = new ReasoningRouter({ env: {}, generateAmbiguities: port.generate });
  const intent = await router.interpret(REQUEST);

  assert.equal(intent.ambiguities.length, 2);
  assert.equal(port.asked.length, 0);
  assert.deepEqual(routingFrom({}).localModelSurfaces, []);
  assert.deepEqual(router.provenance(), [{ surface: 'interpret', provider: 'reference' }]);
  assert.deepEqual(router.modelCalls(), []);
});

test('routed, the model names the ambiguities with the measured prompt, and the engine keeps the goal', async () => {
  const reference = await new ReasoningRouter({ env: {} }).interpret(REQUEST);
  const port = model(NAMED);
  const router = new ReasoningRouter({ env: LOCAL, generateAmbiguities: port.generate });
  const intent = await router.interpret(REQUEST);

  assert.deepEqual(intent.ambiguities, NAMED_LIST);
  assert.equal(intent.goal, reference.goal);
  assert.deepEqual(intent.nonGoals, reference.nonGoals);
  assert.deepEqual(intent.successCriteria, reference.successCriteria);
  assert.deepEqual(port.asked, [namerPrompt(REQUEST)], 'the product must ask exactly what was measured');
  assert.deepEqual(router.provenance(), [
    { surface: 'interpret', provider: 'reference' },
    { surface: 'interpret', provider: 'local-model', fields: ['ambiguities'] },
  ]);
  const [call] = router.modelCalls();
  assert.equal(call.promptDigest, digest(namerPrompt(REQUEST)));
  assert.equal(call.answerDigest, digest(NAMED));
  assert.equal(call.reason, null);
  assert.equal(router.degraded, false);
});

test('NOTHING is an answer: no ambiguities, and nothing degraded', async () => {
  const router = new ReasoningRouter({ env: LOCAL, generateAmbiguities: model('NOTHING').generate });
  assert.deepEqual((await router.interpret(REQUEST)).ambiguities, []);
  assert.equal(router.degraded, false);
});

test('a model that cannot be reached degrades to the reference ambiguities, and says so', async () => {
  const router = new ReasoningRouter({
    env: LOCAL, generateAmbiguities: model(new Error('connect ECONNREFUSED 127.0.0.1:8420')).generate,
  });
  const intent = await router.interpret(REQUEST);

  assert.equal(intent.ambiguities.length, 2, 'the ten words answer instead');
  const [record] = router.degradations();
  assert.equal(record.surface, 'interpret');
  assert.equal(record.provider, 'reference');
  assert.equal(record.requestedProvider, 'local-model');
  assert.match(record.reason, /ECONNREFUSED/);
  assert.equal(router.provenance().at(-1).degraded, true);
  assert.equal(degradationSummary({ reasoning: router.degradations() }).requestedProvider, 'local-model');
  assert.equal(router.modelCalls()[0].answerDigest, null);
});

test('an answer with no question in it is not "nothing is missing": it degrades, declared', async () => {
  const router = new ReasoningRouter({ env: LOCAL, generateAmbiguities: model('Sure, the task is perfectly clear.').generate });
  const intent = await router.interpret(REQUEST);

  assert.equal(intent.ambiguities.length, 2);
  assert.equal(router.degraded, true);
  assert.match(router.degradations()[0].reason, /no question/);
});

test('an empty request is refused before the model is asked', async () => {
  const port = model(NAMED);
  const router = new ReasoningRouter({ env: LOCAL, generateAmbiguities: port.generate });
  await assert.rejects(() => router.interpret('   '), ReasoningRefused);
  assert.equal(port.asked.length, 0);
});

test('surfaces named with no model to ask are reported, never routed', () => {
  const routing = routingFrom({ NOESAR_LOCAL_MODEL_SURFACES: 'interpret, plan' });
  assert.deepEqual(routing.localModelSurfaces, []);
  assert.equal(routing.localModelEndpointMissing, true);
  assert.deepEqual(routing.unknownLocalModelSurfaces, ['plan']);
});

/** A real orchestrator whose router asks a stub model — the path `plan()` and `replay()` walk. */
function session(answer) {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-lma-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-lma-sh-'));
  const runs = mkdtempSync(join(tmpdir(), 'noesar-lma-runs-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src/config.js'), 'export const config = {};\n');
  const port = model(answer);
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: workspace, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)),
    events: new EventLedger(), runStoreDirectory: runs,
    reasoningFor: (sessionId, options = {}) => new ReasoningRouter({
      workspaceRoot: workspace, sessionId, env: LOCAL, generateAmbiguities: port.generate, ...options,
    }),
  });
  return {
    orchestrator, port, store: join(runs, 'authoring-replay'),
    plan: () => orchestrator.plan({
      request: REQUEST,
      files: [{ path: 'src/config.js', contents: 'export const config = {};\n' }],
      actor: 'owner', nowUnix: NOW,
    }),
    replay: (runId) => orchestrator.replay({ runId, actor: 'owner', nowUnix: NOW + 1 }),
    cleanup: () => { for (const directory of [workspace, shadows, runs]) rmSync(directory, { recursive: true, force: true }); },
  };
}

test('a run whose ambiguities the model named replays from the record, without asking the model again', async (t) => {
  const s = session(NAMED);
  t.after(s.cleanup);
  const planned = await s.plan();
  assert.deepEqual(planned.intent.ambiguities, NAMED_LIST);
  assert.equal(s.port.asked.length, 1);

  const replayed = await s.replay(planned.runId);
  assert.equal(replayed.method, 'LOCAL_RECOMPUTE');
  assert.equal(replayed.faithful, true, JSON.stringify(replayed.decisions ?? replayed));
  assert.equal(s.port.asked.length, 1, 'replay asked the model again: its non-determinism would read as drift');
});

test('a recorded answer the store can no longer produce is unreplayable, never recomputed', async (t) => {
  const s = session(NAMED);
  t.after(s.cleanup);
  const planned = await s.plan();
  writeFileSync(join(s.store, digest(NAMED)), 'tampered');

  const replayed = await s.replay(planned.runId);
  assert.equal(replayed.replayable, false);
  assert.match(replayed.reason, /hashes to/);
  assert.equal(s.port.asked.length, 1);
});

test('a run that degraded at plan time replays the same degradation, faithfully', async (t) => {
  const s = session(new Error('the model at http://model.invalid could not be reached'));
  t.after(s.cleanup);
  const planned = await s.plan();
  assert.equal(planned.intent.ambiguities.length, 2);

  const replayed = await s.replay(planned.runId);
  assert.equal(replayed.faithful, true, JSON.stringify(replayed.decisions ?? replayed));
  assert.equal(s.port.asked.length, 1, 'a degraded call replays as degraded, it is not retried');
});

test('the retention sweep keeps the bytes a reasoning replay needs', async (t) => {
  const s = session(NAMED);
  t.after(s.cleanup);
  await s.plan();
  const live = s.orchestrator.authoringReplayReferences();

  assert.equal(live.has(digest(namerPrompt(REQUEST))), true);
  assert.equal(live.has(digest(NAMED)), true, 'a sweep would delete the answer replay reads — D-0606, again');
});
