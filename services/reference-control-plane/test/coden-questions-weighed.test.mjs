// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The questions a model named, weighed by a typed decision before they stop the work
// (`NOESAR_DECIDE=on`). Measured 2026-09-25: the namer asked on 6 of 6 CLEAR requests, which is why
// the question gate ships off; the decision sees the request, the files and the questions.
//
// THE ORACLE: against the tree before this file, a plan whose namer names two questions ALWAYS
// stops on them — the first test below fails there.
//
// Fixture: the same shape as `coden-asks-before-writing.test.mjs` — a real orchestrator, a real
// Author over a stub model, a real router over a stub namer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ReasoningRouter } from '../src/reasoning-router.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { Author } from '../src/author.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const LOCAL = Object.freeze({ NOESAR_LOCAL_MODEL_SURFACES: 'interpret', NOESAR_AUTHORING_ENDPOINT: 'http://model.invalid' });
const REQUEST = 'Tidy the config files, handlers etc, as needed.';
const NAMED = 'Which config files are in scope?\nWhich handlers count as handlers here?';
const ORIGINAL = 'export const config = {};\n';
const NOW = Math.floor(Date.now() / 1000);

function session(decide = null) {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-qw-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-qw-sh-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src/config.js'), ORIGINAL);
  const events = new EventLedger();
  const weighed = [];
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: workspace, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)), events,
    env: { NOESAR_ASK_MIN_QUESTIONS: '1' },
    author: new Author({ generate: async ({ contents }) => `<<<<<<< SEARCH\n${String(contents).trimEnd()}\n=======\nexport const config = { tidy: true };\n>>>>>>> REPLACE` }),
    reasoningFor: (sessionId, options = {}) => new ReasoningRouter({
      workspaceRoot: workspace, sessionId, env: LOCAL, generateAmbiguities: async () => NAMED, ...options,
    }),
    ...(decide ? { decide: async (args) => { weighed.push(args); return decide(args); } } : {}),
  });
  return {
    events, weighed,
    plan: () => orchestrator.plan({ request: REQUEST, files: [{ path: 'src/config.js', contents: ORIGINAL }], actor: 'owner', nowUnix: NOW }),
    cleanup: () => { for (const directory of [workspace, shadows]) rmSync(directory, { recursive: true, force: true }); },
  };
}
const yes = (p) => async () => ({ abstained: false, answer: p > 0.5 ? 0 : 1, probabilities: [p, 1 - p], confidence: Math.max(p, 1 - p), mass: 1, record: {} });
const weighedEvent = (s) => s.events.events().find((e) => e.action === 'workspace_action.questions_weighed');

test('a confident «it can be done without asking» lets the work go on — and the ledger says the questions were set aside', async (t) => {
  const s = session(yes(0.92));
  t.after(s.cleanup);
  const planned = await s.plan();
  assert.deepEqual(planned.questions, [], 'the run did not stop on the questions');
  assert.ok(planned.authoring.authored >= 1, 'the Author wrote');
  const event = JSON.parse(weighedEvent(s).payload);
  assert.equal(event.waived, true);
  assert.equal(event.probability, 0.92);
  assert.match(s.weighed[0].context, /Questions a first reading raised:\n1\. Which config files are in scope\?/);
});

test('anything short of confident stops the work on the questions, exactly as before', async (t) => {
  const s = session(yes(0.6));
  t.after(s.cleanup);
  const planned = await s.plan();
  assert.equal(planned.questions.length, 2);
  assert.equal(JSON.parse(weighedEvent(s).payload).waived, false);
});

test('without decisions the questions stop the work and nothing new is recorded', async (t) => {
  const s = session();
  t.after(s.cleanup);
  const planned = await s.plan();
  assert.equal(planned.questions.length, 2);
  assert.equal(weighedEvent(s), undefined);
});
