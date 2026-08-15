// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 6 (`17`), `D-0312`: if ATOM falls the product carries on — and SAYS SO.
//
// The criterion these tests exist to make measurable is the one rule 5 of `17` warns about: «se
// ATOM cade il prodotto continua dichiarandolo» was written on 2026-08-05 and, until this file,
// nothing could fail if the product did the opposite. Every assertion below therefore checks
// BOTH halves — that the work finished, and that the degradation is on the record. A test that
// only checked the first would pass on a product that had gone back to falling back in silence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { ReasoningRouter, degradationSummary, degradationFrequency } from '../src/reasoning-router.mjs';
import { ReasoningUnavailable } from '../src/atom-client.mjs';
import { Author, AuthoringUnavailable, AuthoringRefused, declaredFallbackGenerator } from '../src/author.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { reasoningSummary, frequencySummary, createView } from '../../../apps/webui-static/coden-view-model.js';
import { freshTempDir } from './support/workspace.mjs';

/** An installation that selected ATOM. `fetchImpl` is what decides whether ATOM is up. */
const ATOM_ENV = {
  NOESAR_REASONING_MODE: 'rust-external',
  NOESAR_RUST_REASONING_ENDPOINT: 'http://atom.test:8410',
  NOESAR_RUST_REASONING_TOKEN: 'token',
  NOESAR_EXTERNAL_SURFACES: 'decompose,expect',
};
/** A daemon that is not there — the transport failing, which is what a stopped container is. */
const DEAD = async () => { throw new Error('connect ECONNREFUSED'); };

function workspace() {
  const root = freshTempDir('noesar-phase6-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/login.js'), 'export function loginRoute(app) {\n  app.post("/login", handler);\n}\n');
  writeFileSync(join(root, 'README.md'), '# demo\n\nA login route with no rate limiting.\n');
  return root;
}

test('with ATOM unreachable the reference provider answers, and the degradation is recorded', async () => {
  const router = new ReasoningRouter({ workspaceRoot: workspace(), env: ATOM_ENV, fetchImpl: DEAD, sessionId: 's' });
  const step = { id: 's1', description: 'add a limiter', files: ['src/login.js'], commands: [], destructive: false };

  const answer = await router.decompose(step);
  assert.ok(answer, 'the work did not carry on: decompose produced nothing with ATOM down');

  const degradations = router.degradations();
  assert.equal(degradations.length, 1, 'the fallback happened but nothing recorded it');
  const [record] = degradations;
  assert.equal(record.surface, 'decompose');
  assert.equal(record.provider, 'reference');
  assert.equal(record.requestedProvider, 'atom');
  // `D-0312` names three things the record must carry. Asserted individually so a record that
  // loses one of them fails on the one it lost.
  assert.match(record.reason, /could not be reached/i, 'the record has no REASON');
  assert.ok(Number.isFinite(record.atUnix), 'the record has no INSTANT');
  assert.equal(typeof record.at, 'string');
  assert.equal(router.degraded, true);

  // The provenance must not read like a surface that was never routed anywhere.
  const entry = router.provenance().find((item) => item.surface === 'decompose');
  assert.equal(entry.provider, 'reference');
  assert.equal(entry.degraded, true, 'the provenance calls this an ordinary reference answer — that is the silent fallback');
});

test('a session that never selected ATOM does not report a degradation', async () => {
  // The case that would make `degraded` meaningless if it were wrong: an installation with no
  // external provider never wanted ATOM, so it never degraded away from it.
  const router = new ReasoningRouter({ workspaceRoot: workspace(), sessionId: 's', env: {} });
  await router.decompose({ id: 's1', description: 'x', files: ['src/login.js'], commands: [], destructive: false });
  assert.deepEqual(router.degradations(), []);
  assert.equal(router.degraded, false);
});

test('NOESAR_ATOM_FALLBACK=off keeps the pre-phase-6 behaviour, and is the only way to get it', async () => {
  const router = new ReasoningRouter({
    workspaceRoot: workspace(), fetchImpl: DEAD, sessionId: 's',
    env: { ...ATOM_ENV, NOESAR_ATOM_FALLBACK: 'off' },
  });
  await assert.rejects(
    () => router.decompose({ id: 's1', description: 'x', files: ['src/login.js'], commands: [], destructive: false }),
    ReasoningUnavailable,
  );
  assert.deepEqual(router.degradations(), [], 'a stop is not a degradation and must not be recorded as one');
});

test('ATOM answering and then falling STOPS with a resumable checkpoint, never at two qualities', async () => {
  // The half-quality rule of `D-0312`, and the reason a blanket fallback would be wrong.
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls > 1) throw new Error('connect ECONNREFUSED');
    // The client reads `text()` and parses it — an empty body is a provider that failed, not
    // one that answered, and the first draft of this test got a green checkpoint for the wrong
    // reason because of it. Hence the assertion below that ATOM really did answer first.
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ ok: true, value: { steps: [{ id: 'a', description: 'from atom', files: [], commands: [], destructive: false }] } }),
    };
  };
  const router = new ReasoningRouter({ workspaceRoot: workspace(), env: ATOM_ENV, fetchImpl, sessionId: 's' });
  const step = { id: 's1', description: 'x', files: ['src/login.js'], commands: [], destructive: false };

  await router.decompose(step);
  assert.deepEqual(router.provenance(), [{ surface: 'decompose', provider: 'atom' }],
    'ATOM did not actually answer the first call, so what follows would not be testing the mid-step case at all');
  const error = await router.expect({ steps: [step], constraints: [], mode: 'safe' }).catch((thrown) => thrown);

  assert.ok(error instanceof ReasoningUnavailable, 'it degraded instead of stopping — half this step came from ATOM');
  assert.ok(error.checkpoint, 'it stopped, but with nothing to resume from — that loses the work');
  assert.equal(error.checkpoint.resumable, true);
  assert.equal(error.checkpoint.stoppedAtSurface, 'expect');
  assert.ok(error.checkpoint.answeredExternally.includes('decompose'),
    'the checkpoint does not say which part ATOM had already done, which is what a resume needs');
});

test('ATOM REFUSING counts as ATOM having answered, so a later fall still checkpoints', async () => {
  // The subtle half of the mid-step rule, and a case a mutation walked straight through: a
  // refusal is the provider ANSWERING. If it did not count, a session where ATOM refused one
  // surface and then died would quietly degrade the rest — half judged by ATOM, half not,
  // which is precisely the two-qualities outcome `D-0312` rules out.
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls > 1) throw new Error('connect ECONNREFUSED');
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: { kind: 'REFUSED', reason: 'the step would produce nothing observable' } }) };
  };
  const router = new ReasoningRouter({ workspaceRoot: workspace(), env: ATOM_ENV, fetchImpl, sessionId: 's' });
  const step = { id: 's1', description: 'x', files: ['src/login.js'], commands: [], destructive: false };

  await assert.rejects(() => router.decompose(step), (error) => error.name === 'ReasoningRefused');

  const error = await router.expect({ steps: [step], constraints: [], mode: 'safe' }).catch((thrown) => thrown);
  assert.ok(error?.checkpoint, 'ATOM refused and then fell, and the product carried on as though ATOM had never been there');
  assert.ok(error.checkpoint.answeredExternally.includes('decompose'));
  assert.deepEqual(router.degradations(), [], 'a mid-step stop is not a degradation');
});

test('the authoring fallback is chosen at assembly, declared, and never inside the port', async () => {
  const atomDown = async () => { throw new AuthoringUnavailable('ATOM at http://atom.test could not be reached for authoring: fetch failed'); };
  const model = async () => '```\nexport const authored = true;\n```';
  const told = [];
  const generate = declaredFallbackGenerator({ primary: atomDown, fallback: model, onDegrade: (record) => told.push(record) });

  const author = new Author({ generate, model: 'chain' });
  const result = await author.author({ goal: 'g', step: 's', files: [{ path: 'src/login.js', contents: 'old\n' }] });

  assert.equal(result.summary.authored, 1, 'ATOM was down and nothing was written — the product did not carry on');
  assert.equal(result.degradations.length, 1, 'it carried on without saying so');
  assert.equal(result.degradations[0].provider, 'reference');
  assert.equal(result.degradations[0].path, 'src/login.js');
  assert.match(result.degradations[0].reason, /could not be reached/);
  assert.equal(told.length, 1, 'onDegrade was not called, so an assembly cannot log or record it');

  // Drained per run: the next authoring must not inherit this one's degradation.
  const second = await new Author({ generate, model: 'chain' })
    .author({ goal: 'g', step: 's', files: [{ path: 'a.js', contents: 'x\n' }] });
  assert.equal(second.degradations.length, 1, 'each run reports its OWN degradations');
});

test('an ATOM content refusal is NOT a fallback trigger', async () => {
  // Otherwise a refusal becomes advisory: ask a weaker provider until one says yes.
  const refusing = async () => { throw new AuthoringRefused('NOT_A_FILE', 'ATOM refused this answer', 'src/login.js'); };
  let fellBack = false;
  const generate = declaredFallbackGenerator({ primary: refusing, fallback: async () => { fellBack = true; return '```\nx\n```'; } });
  const result = await new Author({ generate, model: 'chain' })
    .author({ goal: 'g', step: 's', files: [{ path: 'src/login.js', contents: 'old\n' }] });
  assert.equal(fellBack, false, 'a reachable ATOM said no and the product asked someone else');
  assert.equal(result.summary.refused, 1);
  assert.deepEqual(result.degradations, []);
});

test('a whole task completes with ATOM down, and the Session Proof says how', async () => {
  // The phase's STOP condition, end to end: plan() with ATOM unreachable on both halves.
  const root = workspace();
  const events = new EventLedger();
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: root,
    shadowsRoot: freshTempDir('noesar-phase6-shadows-'),
    minter: new TokenMinter(randomBytes(32)), events, env: ATOM_ENV,
    reasoningFor: (sessionId) => new ReasoningRouter({ workspaceRoot: root, env: ATOM_ENV, fetchImpl: DEAD, sessionId }),
    author: new Author({
      generate: declaredFallbackGenerator({
        primary: async () => { throw new AuthoringUnavailable('ATOM at http://atom.test:8410 could not be reached for authoring: fetch failed'); },
        fallback: async () => '```\nexport function loginRoute(app) {\n  app.post("/login", limiter, handler);\n}\n```',
      }),
      model: 'chain',
    }),
  });

  const planned = await orchestrator.plan({
    actor: 'owner', request: 'add rate limiting to the login route',
    files: [{ path: 'src/login.js', contents: 'export function loginRoute(app) {\n  app.post("/login", handler);\n}\n' }],
    nowUnix: Math.floor(Date.now() / 1000),
  });

  assert.equal(planned.status, 'PENDING_APPROVAL', 'the session stopped — this is the BEFORE state, not the after');
  assert.ok(planned.reasoning, '`reasoning` is not on the answer, so a shell cannot show it without asking a second question');
  assert.equal(planned.reasoning.degraded, true);
  assert.equal(planned.reasoning.provider, 'reference');
  assert.ok(planned.reasoning.reasons.length > 0, 'degraded with no reason is exactly the silence D-0312 forbids');
  assert.ok(planned.authoring.authored > 0, 'ATOM was down and no bytes were written: the work did not carry on');

  const proof = orchestrator.sessionProof(planned.runId);
  assert.ok(proof.degradation, 'the Session Proof does not carry the degradation');
  assert.equal(proof.degradation.degraded, true);
  assert.ok(proof.degradation.reasons.length > 0);
  // Reasoning and authoring degrade INDEPENDENTLY, so each needs its own assertion. Survived a
  // mutation once: zeroing the reasoning source left `degraded:true` on the authoring one
  // alone, and a test that only reads the boolean cannot tell which half stopped working.
  assert.ok(proof.degradation.surfaces.includes('expect'),
    'the proof lost the REASONING degradation — the boolean is carried by authoring alone');
  assert.deepEqual([...proof.degradation.authoredPaths], ['src/login.js'],
    'the proof lost the AUTHORING degradation');
  assert.equal(proof.degradation.events.length, 2, 'the proof reports one source where there were two');
  assert.ok(Number.isFinite(proof.degradation.firstAtUnix), 'the proof says it degraded but not when');
  // SESS-001 freezes the ten fields; `degradation` is a header fact and must not have become
  // an eleventh one.
  assert.equal(Object.keys(proof.fields).length, 10);
});

test('both shells shape the degradation from the same function, and neither invents a word', () => {
  assert.equal(reasoningSummary(null), '—');
  assert.equal(createView().reasoning, '—', 'a fresh view claims a provider nothing has reported yet');
  assert.equal(reasoningSummary(degradationSummary({})), 'atom');

  const degraded = degradationSummary({
    reasoning: [{ surface: 'expect', provider: 'reference', requestedProvider: 'atom', reason: 'ATOM could not be reached', atUnix: 10, at: 'x' }],
  });
  const shown = reasoningSummary(degraded);
  assert.match(shown, /^reference \(degraded: /, 'the shell shows a bare provider name and drops the fact that it degraded');
  assert.match(shown, /ATOM could not be reached/, 'the reason is dropped on the way to the screen');
});

// --- the second half of D-0312: how OFTEN ATOM falls -------------------------------------

test('the frequency is derived from the ledger, so it survives the request that observed it', () => {
  // Built from event shapes rather than a live run so the arithmetic is testable on its own.
  // A live run exercises the same function two tests below.
  const at = (n) => ({ recordedAtUnix: n });
  const events = [
    { action: 'workspace_action.planned', payload: '{}', ...at(100) },
    { action: 'workspace_action.planned', payload: '{}', ...at(200) },
    { action: 'workspace_action.degraded', payload: JSON.stringify({ reasons: ['atom is down'], surfaces: ['expect'] }), ...at(200) },
    { action: 'workspace_action.planned', payload: '{}', ...at(300) },
    { action: 'workspace_action.degraded', payload: JSON.stringify({ reasons: ['atom is down'], surfaces: ['expect', 'decompose'] }), ...at(300) },
    { action: 'workspace_action.approved', payload: '{}', ...at(310) },
  ];

  const all = degradationFrequency(events);
  assert.equal(all.runs, 3, 'the denominator counted something other than planned runs');
  assert.equal(all.degradedRuns, 2);
  assert.equal(all.rate, 2 / 3);
  assert.deepEqual(all.byReason.map((entry) => [entry.key, entry.count]), [['atom is down', 2]]);
  assert.deepEqual(all.bySurface.map((entry) => entry.key), ['expect', 'decompose']);
  assert.equal(all.firstAtUnix, 200);
  assert.equal(all.lastAtUnix, 300);

  // A window narrows both halves, not just the numerator — otherwise a recent spike would be
  // divided by the whole of history and read as calm.
  const recent = degradationFrequency(events, { sinceUnix: 250 });
  assert.equal(recent.runs, 1);
  assert.equal(recent.degradedRuns, 1);
  assert.equal(recent.rate, 1);
});

test('nothing having run is reported as nothing having run, never as healthy', () => {
  const empty = degradationFrequency([]);
  assert.equal(empty.runs, 0);
  assert.equal(empty.rate, null, '0 of 0 reported as a rate reads as a perfect record');
  assert.equal(frequencySummary(empty), 'no runs yet');
  assert.equal(frequencySummary(null), '—');
  assert.equal(frequencySummary({ runs: 4, degradedRuns: 1, rate: 0.25 }), '1/4 runs degraded (25%)');
});

test('a real degraded run writes the ledger line the frequency counts, and counts itself', async () => {
  const root = workspace();
  const events = new EventLedger();
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: root,
    shadowsRoot: freshTempDir('noesar-phase6-freq-'),
    minter: new TokenMinter(randomBytes(32)), events, env: ATOM_ENV,
    reasoningFor: (sessionId) => new ReasoningRouter({ workspaceRoot: root, env: ATOM_ENV, fetchImpl: DEAD, sessionId }),
  });

  const planned = await orchestrator.plan({
    actor: 'owner', request: 'add rate limiting to the login route',
    files: [{ path: 'src/login.js', contents: 'export function loginRoute(app) {\n  app.post("/login", handler);\n}\n' }],
    nowUnix: Math.floor(Date.now() / 1000),
  });

  const written = events.events().filter((event) => event.action === 'workspace_action.degraded');
  assert.equal(written.length, 1, 'the degradation lives only in the response — a restart forgets it ever happened');
  const payload = JSON.parse(written[0].payload);
  assert.ok(payload.reasons.length > 0);
  assert.ok(payload.surfaces.includes('expect'));

  // The run counts ITSELF: the ledger line is written before the answer is shaped, so a shell
  // is never shown "0 degraded" on the very response reporting a degradation.
  assert.equal(planned.reasoning.frequency.runs, 1);
  assert.equal(planned.reasoning.frequency.degradedRuns, 1);
  assert.equal(planned.reasoning.frequency.rate, 1);
  assert.equal(frequencySummary(planned.reasoning.frequency), '1/1 runs degraded (100%)');
});
