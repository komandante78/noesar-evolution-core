// SPDX-License-Identifier: AGPL-3.0-or-later
// SESS-002/SESS-003 (MASTER_PROJECT/01_VISIONE_E_POSIZIONE.md): does replaying a recorded
// session reproduce the same decisions, and does the product's current code still reach the
// same verdict a historical fixture recorded?

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { compareDecisions, comparePolicyOutcome, callAtomReplay } from '../src/session-replay.mjs';
import { ReferenceReasoningProvider } from '../src/reasoning.mjs';
import { ReasoningUnavailable } from '../src/atom-client.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

function fixture() {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-sr-ws-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-sr-shadows-'));
  const events = new EventLedger();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events,
  });
  return { ws, shadows, orch, events };
}
function cleanup({ ws, shadows }) {
  rmSync(ws, { recursive: true, force: true });
  rmSync(shadows, { recursive: true, force: true });
}
const NOW = Math.floor(Date.now() / 1000);

// --- compareDecisions / comparePolicyOutcome (pure) --------------------------

test('compareDecisions: identical decision bundles are faithful with no diffs', () => {
  const decision = { intent: { goal: 'g' }, hypotheses: [{ statement: 's' }], plan: { steps: [] }, risk: { overall: 'LOW' }, confidence: { score: 1 }, expectation: { pathsTheDiffMustTouch: ['a.txt'] } };
  const result = compareDecisions(decision, JSON.parse(JSON.stringify(decision)));
  assert.equal(result.faithful, true);
  assert.deepEqual(result.diffs, []);
});

test('compareDecisions: a changed field is reported by name, with was/now', () => {
  const original = { intent: { goal: 'original goal' }, hypotheses: [], plan: {}, risk: { overall: 'LOW' }, confidence: {}, expectation: {} };
  const recomputed = { ...original, intent: { goal: 'DIFFERENT' }, risk: { overall: 'HIGH' } };
  const result = compareDecisions(original, recomputed);
  assert.equal(result.faithful, false);
  assert.deepEqual(result.diffs.map((d) => d.field), ['intent', 'risk']);
  assert.equal(result.diffs[0].was.goal, 'original goal');
  assert.equal(result.diffs[0].now.goal, 'DIFFERENT');
});

test('comparePolicyOutcome: same refused/risk -> no drift', () => {
  const result = comparePolicyOutcome({ refused: false, riskOverall: 'LOW' }, { refused: false, riskOverall: 'LOW' });
  assert.equal(result.changed, false);
});

test('comparePolicyOutcome: a different refusal is drift', () => {
  const result = comparePolicyOutcome({ refused: false, riskOverall: 'LOW' }, { refused: true, riskOverall: null });
  assert.equal(result.changed, true);
  assert.equal(result.was.refused, false);
  assert.equal(result.now.refused, true);
});

test('comparePolicyOutcome: a different risk class with the same refusal is still drift', () => {
  const result = comparePolicyOutcome({ refused: false, riskOverall: 'LOW' }, { refused: false, riskOverall: 'MODERATE' });
  assert.equal(result.changed, true);
});

// --- callAtomReplay (injectable HTTP) -----------------------------------------

test('callAtomReplay returns the value on a faithful envelope', async () => {
  const fetchImpl = async () => ({ status: 200, text: async () => JSON.stringify({ ok: true, value: { faithful: true, total: 3, reproduced: 3, diverged: 0, rejected: [] } }) });
  const value = await callAtomReplay({ endpoint: 'http://stub', token: 't', pack: { sessionId: 'x' }, fetchImpl });
  assert.equal(value.faithful, true);
  assert.equal(value.reproduced, 3);
});

test('callAtomReplay throws ReasoningUnavailable on a refused envelope', async () => {
  const fetchImpl = async () => ({ status: 200, text: async () => JSON.stringify({ ok: false, error: { reason: 'pack rejected' } }) });
  await assert.rejects(
    () => callAtomReplay({ endpoint: 'http://stub', token: 't', pack: {}, fetchImpl }),
    (error) => error instanceof ReasoningUnavailable && /pack rejected/.test(error.reason),
  );
});

test('callAtomReplay throws ReasoningUnavailable when the transport itself fails', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => callAtomReplay({ endpoint: 'http://stub', token: 't', pack: {}, fetchImpl }),
    (error) => error instanceof ReasoningUnavailable,
  );
});

// --- orchestrator.replay() — LOCAL_RECOMPUTE (reference provider) ------------

test('replay() on a reference-only run recomputes and reports faithful', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'add a greeting file', files: [{ path: 'hello.txt', contents: 'hello\n' }],
      actor: 'owner', nowUnix: NOW,
    });
    const replayed = await fx.orch.replay({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
    assert.equal(replayed.method, 'LOCAL_RECOMPUTE');
    assert.equal(replayed.faithful, true);
    assert.deepEqual(replayed.diffs, []);
  } finally { cleanup(fx); }
});

test('replay() on an unknown runId refuses NOT_FOUND', async () => {
  const fx = fixture();
  try {
    await assert.rejects(
      () => fx.orch.replay({ runId: 'does-not-exist', actor: 'owner', nowUnix: NOW }),
      (error) => error.kind === 'NOT_FOUND',
    );
  } finally { cleanup(fx); }
});

// A provider that answers identically to the reference provider on the first call (used by
// plan()) and DIFFERENTLY on every later call (used by replay()) — simulating the exact thing
// SESS-002 must catch: code that changed between when a plan was recorded and when it was
// replayed. `provenance()` always reports empty so replay() takes the LOCAL_RECOMPUTE path.
class DriftingProvider {
  #real;
  #tamper;
  constructor(workspaceRoot, tamper) {
    this.#real = new ReferenceReasoningProvider(workspaceRoot);
    this.#tamper = tamper;
  }
  interpret(...a) { return this.#real.interpret(...a); }
  hypothesize(...a) {
    const result = this.#real.hypothesize(...a);
    return this.#tamper ? [{ ...result[0], statement: 'TAMPERED STATEMENT' }] : result;
  }
  blastRadius(...a) { return this.#real.blastRadius(...a); }
  buildPlan(...a) { return this.#real.buildPlan(...a); }
  constrain(...a) { return this.#real.constrain(...a); }
  classify(...a) { return this.#real.classify(...a); }
  confidence(...a) { return this.#real.confidence(...a); }
  expect(...a) { return this.#real.expect(...a); }
  fixtures(...a) { return this.#real.fixtures(...a); }
  provenance() { return []; }
}

test('replay() catches a real divergence when the decision layer changed between plan and replay', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-sr-drift-ws-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-sr-drift-shadows-'));
  let calls = 0;
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
    reasoningFor: () => { calls += 1; return new DriftingProvider(ws, calls > 1); },
  });
  try {
    const planned = await orch.plan({ request: 'edit', files: [{ path: 'a.txt', contents: 'x\n' }], actor: 'owner', nowUnix: NOW });
    const replayed = await orch.replay({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
    assert.equal(replayed.method, 'LOCAL_RECOMPUTE');
    assert.equal(replayed.faithful, false);
    const hyp = replayed.diffs.find((d) => d.field === 'hypotheses');
    assert.ok(hyp, 'hypotheses should be reported as diverged');
    assert.equal(hyp.now[0].statement, 'TAMPERED STATEMENT');
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(shadows, { recursive: true, force: true }); }
});

// --- orchestrator.replay() — EXTERNAL_PACK ------------------------------------

async function stubAtom(handlers) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ path: req.url, body: body ? JSON.parse(body) : null });
      const handler = handlers[req.url] ?? (() => ({ status: 404, payload: { ok: false, error: { reason: 'no handler' } } }));
      const { status, payload } = handler(seen.at(-1));
      const text = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

test('replay() on an externally-routed run resubmits the captured pack to /v1/replay', async () => {
  const stub = await stubAtom({
    '/v1/expect': () => ({ status: 200, payload: { ok: true, value: { testsExpectedToPass: [], testsExpectedToFail: [], pathsTheDiffMustTouch: ['a.txt'] } } }),
    '/v1/fixtures': () => ({ status: 200, payload: { ok: true, value: { sessionId: 'whatever', digest: 'abc123', entries: ['recorded-entry'] } } }),
    '/v1/replay': () => ({ status: 200, payload: { ok: true, value: { faithful: true, total: 1, reproduced: 1, diverged: 0, rejected: [] } } }),
  });
  const env = {
    NOESAR_REASONING_MODE: 'rust-external', NOESAR_RUST_REASONING_ENDPOINT: stub.endpoint,
    // `expect` is a real decision surface (see DECISION_SURFACES) -- routing only `fixtures`
    // would leave the decision itself fully local, and correctly take LOCAL_RECOMPUTE instead.
    NOESAR_RUST_REASONING_TOKEN: 'a-token-long-enough', NOESAR_EXTERNAL_SURFACES: 'expect,fixtures',
  };
  const fx = fixture();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: fx.ws, shadowsRoot: fx.shadows, minter: new TokenMinter(randomBytes(32)), events: fx.events, env,
  });
  try {
    const planned = await orch.plan({ request: 'edit', files: [{ path: 'a.txt', contents: 'x\n' }], actor: 'owner', nowUnix: NOW });
    assert.equal(orch.get(planned.runId).fixturePack.digest, 'abc123');
    const replayed = await orch.replay({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
    assert.equal(replayed.method, 'EXTERNAL_PACK');
    assert.equal(replayed.replayable, true);
    assert.equal(replayed.faithful, true);
    assert.equal(stub.seen.find((s) => s.path === '/v1/replay').body.pack.digest, 'abc123');

    const proof = orch.sessionProof(planned.runId);
    assert.equal(proof.fields.fixture.value.replayable, 'MODEL_FIXTURE_CAPTURED');
    assert.equal(proof.fields.fixture.value.fixturePackDigest, 'abc123');
  } finally { stub.close(); cleanup(fx); }
});

test('replay() declares NOT_REPLAYABLE honestly when fixture capture failed at plan() time', async () => {
  const stub = await stubAtom({
    '/v1/expect': () => ({ status: 200, payload: { ok: true, value: { testsExpectedToPass: [], testsExpectedToFail: [], pathsTheDiffMustTouch: ['a.txt'] } } }),
    '/v1/fixtures': () => ({ status: 500, payload: { ok: false, error: { reason: 'daemon refused to record' } } }),
  });
  const env = {
    NOESAR_REASONING_MODE: 'rust-external', NOESAR_RUST_REASONING_ENDPOINT: stub.endpoint,
    NOESAR_RUST_REASONING_TOKEN: 'a-token-long-enough', NOESAR_EXTERNAL_SURFACES: 'expect,fixtures',
  };
  const fx = fixture();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: fx.ws, shadowsRoot: fx.shadows, minter: new TokenMinter(randomBytes(32)), events: fx.events, env,
  });
  try {
    const planned = await orch.plan({ request: 'edit', files: [{ path: 'a.txt', contents: 'x\n' }], actor: 'owner', nowUnix: NOW });
    assert.equal(orch.get(planned.runId).fixturePack, null);
    const replayed = await orch.replay({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
    assert.equal(replayed.method, 'EXTERNAL_PACK');
    assert.equal(replayed.replayable, false);
    assert.match(replayed.reason, /no fixture pack was captured/);

    const proof = orch.sessionProof(planned.runId);
    assert.equal(proof.fields.fixture.value.replayable, 'NOT_REPLAYABLE');
  } finally { stub.close(); cleanup(fx); }
});

// --- orchestrator.replayHistoricalFixture() — SESS-003 ------------------------

test('replayHistoricalFixture(): a historical outcome that still matches current code shows no drift', async () => {
  const fx = fixture();
  try {
    const result = await fx.orch.replayHistoricalFixture({
      fixture: { request: 'benign edit', files: [{ path: 'a.txt', contents: 'x\n' }] },
      historicalOutcome: { refused: false, riskOverall: 'LOW' },
    });
    assert.equal(result.method, 'POLICY_REPLAY');
    assert.equal(result.policyDrift.changed, false);
  } finally { cleanup(fx); }
});

test('replayHistoricalFixture(): a historical record that disagrees with current code is reported as drift', async () => {
  const fx = fixture();
  try {
    const result = await fx.orch.replayHistoricalFixture({
      fixture: { request: 'benign edit', files: [{ path: 'a.txt', contents: 'x\n' }] },
      historicalOutcome: { refused: true, riskOverall: 'HIGH' },
    });
    assert.equal(result.policyDrift.changed, true);
    assert.equal(result.policyDrift.was.refused, true);
    assert.equal(result.policyDrift.now.refused, false);
  } finally { cleanup(fx); }
});

test('replayHistoricalFixture(): current code refusing what history says was permitted is drift, not an error', async () => {
  const fx = fixture();
  try {
    const result = await fx.orch.replayHistoricalFixture({
      // A path that leaves the workspace makes ReferenceReasoningProvider.constrain() refuse
      // (reachesOutsideWorkspace) regardless of policy -- CONSTRAINED_AWAY, caught and
      // reported as the drift itself, never thrown as a WorkspaceActionError to the caller.
      fixture: { request: 'reach outside', files: [{ path: '../outside.txt', contents: 'x\n' }] },
      historicalOutcome: { refused: false, riskOverall: 'LOW' },
    });
    assert.equal(result.method, 'POLICY_REPLAY');
    assert.equal(result.policyDrift.changed, true);
    assert.equal(result.policyDrift.now.refused, true);
    assert.match(result.recomputedRefusalReason, /workspace/i);
  } finally { cleanup(fx); }
});

test('replayHistoricalFixture(): refuses NO_FILES for a fixture with nothing declared', async () => {
  const fx = fixture();
  try {
    await assert.rejects(
      () => fx.orch.replayHistoricalFixture({ fixture: { request: 'x', files: [] }, historicalOutcome: {} }),
      (error) => error.kind === 'NO_FILES',
    );
  } finally { cleanup(fx); }
});
