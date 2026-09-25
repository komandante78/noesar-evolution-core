// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CodeN asks before it writes — the questions the local model names stop the work instead of
// being recorded and read by nobody.
//
// Measured on 2026-09-25 before this existed: `interpret().ambiguities` was produced (by the local
// model when `NOESAR_LOCAL_MODEL_SURFACES=interpret`, `reasoning-router.mjs`), written into the run
// and the session proof, and `git grep '\.ambiguities'` under `src/` found no reader. The only code
// that ever acted on the questions was the HiL-Bench harness. So the product could name what a
// request leaves out and then write the file anyway, on a guess.
//
// The properties, each with a test that fails when it breaks:
//   1. questions the MODEL named stop authoring: nothing is written on a guess
//   2. a run with open questions cannot be measured, so it cannot be approved or iterated either:
//      the real workspace does not change until a person has answered
//   3. `answer()` continues the work as a new run carrying the answers, and closes the old one
//   4. one round only: a second set of questions after an answer does not stop the work again
//   5. the ten-word reference list does NOT stop anything — its entries are statements about
//      English words, and «one long sentence» fires on most Italian requests over 25 words
//   6. the answered run replays faithfully: what it records is what it was planned from
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { ReasoningRouter } from '../src/reasoning-router.mjs';
import { WorkspaceActionOrchestrator, WorkspaceActionError } from '../src/workspace-actions.mjs';
import { Author } from '../src/author.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const LOCAL = Object.freeze({ NOESAR_LOCAL_MODEL_SURFACES: 'interpret', NOESAR_AUTHORING_ENDPOINT: 'http://model.invalid' });
const REQUEST = 'Tidy the config files, handlers etc, as needed.';
const NAMED = 'Which config files are in scope?\nWhich handlers count as handlers here?';
const NAMED_LIST = ['Which config files are in scope?', 'Which handlers count as handlers here?'];
const ANSWERS = 'Only src/config.js. There are no handlers yet: leave them out.';
const ORIGINAL = 'export const config = {};\n';
const NOW = Math.floor(Date.now() / 1000);

/**
 * A real orchestrator, a real Author over a stub model, a real router over a stub namer. `namer`
 * is what the local model answers each time it is asked to name questions, in order.
 */
function session(...namer) {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-ask-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ask-sh-'));
  const runs = mkdtempSync(join(tmpdir(), 'noesar-ask-runs-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src/config.js'), ORIGINAL);
  const asked = [];
  const namerAnswers = [...namer];
  const generateAmbiguities = async ({ prompt }) => {
    asked.push(prompt);
    const next = namerAnswers.length > 1 ? namerAnswers.shift() : namerAnswers[0];
    if (next instanceof Error) throw next;
    return next;
  };
  const authored = [];
  const author = new Author({
    generate: async ({ prompt, contents }) => {
      authored.push(prompt);
      return `<<<<<<< SEARCH\n${String(contents).trimEnd()}\n=======\nexport const config = { tidy: true };\n>>>>>>> REPLACE`;
    },
  });
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: workspace, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)),
    events: new EventLedger(), runStoreDirectory: runs, author,
    reasoningFor: (sessionId, options = {}) => new ReasoningRouter({
      workspaceRoot: workspace, sessionId, env: LOCAL, generateAmbiguities, ...options,
    }),
  });
  return {
    orchestrator, asked, authored,
    plan: () => orchestrator.plan({
      request: REQUEST, files: [{ path: 'src/config.js', contents: ORIGINAL }], actor: 'owner', nowUnix: NOW,
    }),
    real: () => readFileSync(join(workspace, 'src/config.js'), 'utf8'),
    cleanup: () => { for (const directory of [workspace, shadows, runs]) rmSync(directory, { recursive: true, force: true }); },
  };
}

const refusedAs = (kind) => (error) => error instanceof WorkspaceActionError && error.kind === kind;

test('questions the model named stop the work: nothing is authored, and the run says what it asks', async (t) => {
  const s = session(NAMED);
  t.after(s.cleanup);
  const planned = await s.plan();

  assert.equal(s.authored.length, 0, 'the Author was asked to write on a guess');
  assert.deepEqual(planned.questions, NAMED_LIST);
  assert.equal(planned.status, 'PENDING_APPROVAL');
  assert.equal(planned.authoring.authored, 0);
  assert.equal(planned.authoring.awaitingAnswers, true);
  for (const question of NAMED_LIST) assert.ok(planned.authoring.reason.includes(question), `the reason must carry «${question}»`);
  assert.deepEqual(s.orchestrator.get(planned.runId).questions, NAMED_LIST, 'the questions belong to the stored run');
});

test('a run with open questions cannot be measured, so nothing downstream can promote it', async (t) => {
  const s = session(NAMED);
  t.after(s.cleanup);
  const planned = await s.plan();

  assert.throws(() => s.orchestrator.measure({ runId: planned.runId, actor: 'owner', nowUnix: NOW }), refusedAs('QUESTIONS_UNANSWERED'));
  await assert.rejects(() => s.orchestrator.iterate({ runId: planned.runId, actor: 'owner', nowUnix: NOW }), refusedAs('QUESTIONS_UNANSWERED'));
  assert.throws(() => s.orchestrator.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW }));
  assert.equal(s.real(), ORIGINAL, 'the real workspace changed while a question was open');
});

test('answering continues the work as a new run that carries the answers, and closes the old one', async (t) => {
  const s = session(NAMED, 'NOTHING');
  t.after(s.cleanup);
  const planned = await s.plan();
  const answered = await s.orchestrator.answer({ runId: planned.runId, answers: ANSWERS, actor: 'owner', nowUnix: NOW + 1 });

  assert.notEqual(answered.runId, planned.runId);
  assert.deepEqual(answered.questions, []);
  assert.equal(answered.authoring.authored, 1);
  assert.equal(s.authored.length, 1);
  assert.ok(s.authored[0].includes(ANSWERS), 'the Author never saw what the person answered');
  const old = s.orchestrator.get(planned.runId);
  assert.equal(old.status, 'ANSWERED');
  assert.equal(old.answeredBy, answered.runId);
  assert.equal(s.orchestrator.get(answered.runId).answers, ANSWERS);

  const measured = s.orchestrator.measure({ runId: answered.runId, actor: 'owner', nowUnix: NOW + 2 });
  assert.equal(measured.status, 'MEASURED');
  s.orchestrator.approve({ runId: answered.runId, approverId: 'owner', nowUnix: NOW + 3 });
  assert.equal(s.real(), 'export const config = { tidy: true };\n');
});

test('one round only: questions named after an answer do not stop the work again', async (t) => {
  const s = session(NAMED);
  t.after(s.cleanup);
  const planned = await s.plan();
  const answered = await s.orchestrator.answer({ runId: planned.runId, answers: ANSWERS, actor: 'owner', nowUnix: NOW + 1 });

  assert.equal(s.asked.length, 2, 'the answered request is interpreted again');
  assert.deepEqual(answered.intent.ambiguities, NAMED_LIST, 'the model still names them');
  assert.deepEqual(answered.questions, [], 'and they no longer stop anything');
  assert.equal(answered.authoring.authored, 1);
});

test('answer() refuses what is not an answer to an open question', async (t) => {
  const s = session(NAMED, 'NOTHING');
  t.after(s.cleanup);
  const planned = await s.plan();
  await assert.rejects(() => s.orchestrator.answer({ runId: planned.runId, answers: '   ', actor: 'owner', nowUnix: NOW }), refusedAs('INVALID_ANSWERS'));
  await assert.rejects(() => s.orchestrator.answer({ runId: 'no-such-run', answers: ANSWERS, actor: 'owner', nowUnix: NOW }), refusedAs('NOT_FOUND'));

  const answered = await s.orchestrator.answer({ runId: planned.runId, answers: ANSWERS, actor: 'owner', nowUnix: NOW + 1 });
  await assert.rejects(() => s.orchestrator.answer({ runId: answered.runId, answers: ANSWERS, actor: 'owner', nowUnix: NOW + 2 }), refusedAs('NO_QUESTIONS'));
  await assert.rejects(() => s.orchestrator.answer({ runId: planned.runId, answers: ANSWERS, actor: 'owner', nowUnix: NOW + 2 }), refusedAs('ALREADY_DECIDED'));
});

test('NOTHING from the model is a complete request: the work goes ahead as before', async (t) => {
  const s = session('NOTHING');
  t.after(s.cleanup);
  const planned = await s.plan();

  assert.deepEqual(planned.questions, []);
  assert.equal(planned.authoring.authored, 1);
  assert.equal(s.orchestrator.measure({ runId: planned.runId, actor: 'owner', nowUnix: NOW }).status, 'MEASURED');
});

test('the reference list never stops the work — only questions a model named do', async (t) => {
  // A model that cannot be reached degrades `ambiguities` to the ten-word list, declared. Those
  // entries describe English words («`etc` does not name what is included»); stopping on them
  // would stop most Italian requests over 25 words on «one long sentence».
  const s = session(new Error('connect ECONNREFUSED 127.0.0.1:8420'));
  t.after(s.cleanup);
  const planned = await s.plan();

  assert.equal(planned.intent.ambiguities.length, 2, 'the reference list answered');
  assert.deepEqual(planned.questions, []);
  assert.equal(planned.authoring.authored, 1);
});

test('an answered run replays faithfully: it records the request it was planned from', async (t) => {
  const s = session(NAMED, 'NOTHING');
  t.after(s.cleanup);
  const planned = await s.plan();
  const answered = await s.orchestrator.answer({ runId: planned.runId, answers: ANSWERS, actor: 'owner', nowUnix: NOW + 1 });

  assert.ok(s.orchestrator.get(answered.runId).request.includes(ANSWERS));
  const replayed = await s.orchestrator.replay({ runId: answered.runId, actor: 'owner', nowUnix: NOW + 2 });
  assert.equal(replayed.faithful, true, JSON.stringify(replayed.decisions ?? replayed));
});

test('every shell shows the questions and offers only the two ways on', async () => {
  const { callResult, planTurn } = await import('../../../apps/webui-static/coden-view-model.js');
  const { nextStepsFor, resolveCommand, parseCommandPrompt, AGENT_COMMANDS, groupMenu } = await import('../../../apps/shared/coden/agent-commands.js');
  const s = session(NAMED);
  try {
    const planned = await s.plan();
    const shown = callResult('plan', planned);
    const text = [shown.headline, ...shown.lines].join('\n');
    assert.equal(shown.headline, 'plan — nothing written');
    for (const question of NAMED_LIST) assert.ok(text.includes(question), `the terminal must show «${question}»`);
    assert.ok(text.includes(`next: /answer ${planned.runId}`), 'the next step on a questioned run is answering it');
    assert.ok(!text.includes(`/measure ${planned.runId}`), 'measure is refused on this run and must not be offered');
    assert.deepEqual(nextStepsFor(planned.status, { questions: planned.questions.length }).map((step) => step.name), ['answer', 'reject']);

    const turn = planTurn(`/answer ${planned.runId} ${ANSWERS}`, {
      resolve: (typed) => resolveCommand(typed, AGENT_COMMANDS), parse: parseCommandPrompt, commands: AGENT_COMMANDS, groups: groupMenu,
    });
    assert.equal(turn.method, 'workspace.answer');
    assert.deepEqual(turn.params, { runId: planned.runId, answers: ANSWERS });
  } finally {
    s.cleanup();
  }
});
