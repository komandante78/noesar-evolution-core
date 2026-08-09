// SPDX-License-Identifier: AGPL-3.0-or-later
//
// UI-080…096's orchestration: intent gate -> provider -> content gate -> ephemeral report.
// Fakes stand in for the gate and the tool executor — the HTTP wiring of both is already
// covered by research-gate.test.mjs and tool-executor's own tests; this file is the pipeline
// logic that sits between them.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  resolveResearchTool,
  runResearchReport, validateCandidate, validateReportPayload,
  ResearchReportStore, RefusalRegistry, buildQueryEcho, REPORT_TTL_MS,
} from '../src/research.mjs';

const goodCandidate = {
  name: 'Vendor A',
  volatileObservedAt: '2026-07-31T00:00:00Z',
  evidence: [
    { kind: 'SOURCE_FACT', statement: 'Listed price is €42.' },
    { kind: 'NOT_VERIFIED', statement: 'Delivery time was not independently checked.' },
  ],
  evidenceQuality: { reviewCount: 38, timeSpanDays: 14, verifiedPurchaseShare: 0.2, anomalyFlag: true, anomalyNote: '31 of 38 reviews landed in the same fortnight.' },
  sponsored: false,
};

function fakeGate(outcomes) {
  let call = 0;
  const seen = [];
  return {
    seen,
    async classify(query) {
      seen.push(query);
      const outcome = outcomes[Math.min(call, outcomes.length - 1)];
      call += 1;
      return outcome;
    },
  };
}

function fakeExecutor(result) {
  const calls = [];
  return {
    calls,
    async execute(tool, input, ctx) {
      calls.push({ tool, input, ctx });
      if (result instanceof Error) throw result;
      return { toolId: tool.id, result, latencyMs: 1 };
    },
  };
}

function fakeLedger() { const entries = []; return { entries, append: (e) => { entries.push(e); return e; } }; }

const tool = { id: 'tool-1', name: 'Search Co', external: true, consent: { granted: true } };

test('validateCandidate accepts a well-formed candidate and rejects a missing evidence array', () => {
  const validated = validateCandidate(goodCandidate, 0);
  assert.equal(validated.name, 'Vendor A');
  assert.equal(validated.affiliateLink, false);
  assert.equal(validated.evidenceQuality.anomalyFlag, true);
  assert.throws(() => validateCandidate({ name: 'X' }, 0), /evidence must be a non-empty array/);
});

test('an excluded candidate must name why (UI-086)', () => {
  assert.throws(() => validateCandidate({ name: 'X', excluded: true }, 0), /excluded but names no reason/);
  const excluded = validateCandidate({ name: 'X', excluded: true, excludedReason: 'Outside your stated criteria.' }, 0);
  assert.equal(excluded.excluded, true);
});

test('validateReportPayload refuses an empty candidate list rather than an empty report', () => {
  assert.throws(() => validateReportPayload({ candidates: [] }), /no candidates/);
});

test('PROCEED end to end: both gates called, tool called once, report stored', async () => {
  const gate = fakeGate([{ outcome: 'PROCEED', category: null }, { outcome: 'PROCEED', category: null }]);
  const executor = fakeExecutor({ candidates: [goodCandidate] });
  const ledger = fakeLedger();
  const reportStore = new ResearchReportStore();
  const refusalRegistry = new RefusalRegistry();
  const outcome = await runResearchReport({
    objective: 'Compare vacuum cleaners under 400 euros', criteria: ['under-400-eur', 'cordless'],
    actorId: 'user-1', gate, tools: [tool], executor, toolId: 'tool-1',
    ledger, reportStore, refusalRegistry,
  });
  assert.equal(outcome.outcome, 'PROCEED');
  assert.equal(gate.seen.length, 2, 'intent gate and content gate must both be asked');
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(executor.calls[0].input.criteria, ['under-400-eur', 'cordless']);
  const stored = reportStore.get(outcome.report.id);
  assert.ok(stored);
  assert.equal(stored.candidates.length, 1);
  assert.equal(stored.queryEcho, buildQueryEcho('Compare vacuum cleaners under 400 euros', ['under-400-eur', 'cordless']));
  assert.ok(ledger.entries.some((e) => e.action === 'research.report-created'));
});

test('intent REFUSE never calls the provider — no query is emitted (UI-095)', async () => {
  const gate = fakeGate([{ outcome: 'REFUSE', category: 'REGULATED_PURCHASE' }]);
  const executor = fakeExecutor({ candidates: [goodCandidate] });
  const ledger = fakeLedger();
  const outcome = await runResearchReport({
    objective: 'how to buy this without a licence', criteria: [],
    actorId: 'user-1', gate, tools: [tool], executor, toolId: 'tool-1',
    ledger, reportStore: new ResearchReportStore(), refusalRegistry: new RefusalRegistry(),
  });
  assert.equal(outcome.outcome, 'REFUSE');
  assert.equal(outcome.stage, 'intent');
  assert.equal(outcome.category, 'REGULATED_PURCHASE');
  assert.ok(outcome.refusalId);
  assert.equal(executor.calls.length, 0, 'the provider must never be called after an intent refusal');
});

test('content REFUSE discards the report even though the provider already answered', async () => {
  const gate = fakeGate([{ outcome: 'PROCEED', category: null }, { outcome: 'REFUSE', category: 'PHYSICAL_HARM_INSTRUCTIONS' }]);
  const executor = fakeExecutor({ candidates: [goodCandidate] });
  const ledger = fakeLedger();
  const reportStore = new ResearchReportStore();
  const outcome = await runResearchReport({
    objective: 'find suppliers', criteria: [],
    actorId: 'user-1', gate, tools: [tool], executor, toolId: 'tool-1',
    ledger, reportStore, refusalRegistry: new RefusalRegistry(),
  });
  assert.equal(outcome.outcome, 'REFUSE');
  assert.equal(outcome.stage, 'content');
  assert.equal(reportStore.get(outcome.refusalId), null, 'nothing with the refusal id was ever stored as a report');
});

test('an ASK outcome dispatches nothing and asks for more from the caller (UI-092)', async () => {
  const gate = fakeGate([{ outcome: 'ASK', category: null }]);
  const executor = fakeExecutor({ candidates: [goodCandidate] });
  const outcome = await runResearchReport({
    objective: 'best price', criteria: [],
    actorId: 'user-1', gate, tools: [tool], executor, toolId: 'tool-1',
    ledger: fakeLedger(), reportStore: new ResearchReportStore(), refusalRegistry: new RefusalRegistry(),
  });
  assert.equal(outcome.outcome, 'ASK');
  assert.equal(executor.calls.length, 0);
});

test('no provider configured answers UNCONFIGURED rather than a guessed direction', async () => {
  const gate = fakeGate([{ outcome: 'PROCEED', category: null }]);
  await assert.rejects(
    runResearchReport({
      objective: 'x', criteria: [], actorId: 'user-1', gate, tools: [tool], executor: fakeExecutor({ candidates: [] }),
      toolId: null, ledger: fakeLedger(), reportStore: new ResearchReportStore(), refusalRegistry: new RefusalRegistry(),
    }),
    (error) => { assert.equal(error.kind, 'UNCONFIGURED'); return true; },
  );
});

test('an unconsented provider is refused even if a toolId is set (consent cannot be assumed)', async () => {
  const gate = fakeGate([{ outcome: 'PROCEED', category: null }]);
  const unconsented = { id: 'tool-2', name: 'Search Co', external: true, consent: { granted: false } };
  await assert.rejects(
    runResearchReport({
      objective: 'x', criteria: [], actorId: 'user-1', gate, tools: [unconsented], executor: fakeExecutor({ candidates: [] }),
      toolId: 'tool-2', ledger: fakeLedger(), reportStore: new ResearchReportStore(), refusalRegistry: new RefusalRegistry(),
    }),
    (error) => { assert.equal(error.kind, 'UNCONSENTED'); return true; },
  );
});

test('a malformed provider answer is refused, not silently patched with defaults', async () => {
  const gate = fakeGate([{ outcome: 'PROCEED', category: null }]);
  const executor = fakeExecutor({ candidates: [{ name: 'X' }] });
  await assert.rejects(
    runResearchReport({
      objective: 'x', criteria: [], actorId: 'user-1', gate, tools: [tool], executor,
      toolId: 'tool-1', ledger: fakeLedger(), reportStore: new ResearchReportStore(), refusalRegistry: new RefusalRegistry(),
    }),
    (error) => { assert.equal(error.kind, 'INTERNAL'); return true; },
  );
});

test('ResearchReportStore: expiry, revoke and the not-found case are indistinguishable to a caller', () => {
  const store = new ResearchReportStore();
  const now = Date.parse('2026-07-31T00:00:00Z');
  const report = store.put({ createdBy: 'u1', objective: 'x', criteria: [], queryEcho: '{}', candidates: [], nowMs: now });
  assert.ok(store.get(report.id, { nowMs: now + 1000 }));
  assert.equal(store.get(report.id, { nowMs: now + REPORT_TTL_MS + 1 }), null, 'expired');
  assert.equal(store.get('never-existed'), null, 'missing');
  const revoked = store.revoke(report.id, { actorId: 'u1', nowMs: now + 1000 });
  assert.equal(revoked.revoked, true);
  assert.equal(store.get(report.id, { nowMs: now + 1000 }), null, 'revoked');
  assert.equal(store.revoke(report.id, { actorId: 'u1' }), null, 'revoking twice is a no-op, not an error');
});

test('RefusalRegistry: a contest can only be filed by the person the refusal was shown to (UI-096)', () => {
  const registry = new RefusalRegistry();
  const refusal = registry.record({ actorId: 'user-1', stage: 'intent', category: 'X' });
  assert.throws(() => registry.contest(refusal.id, { note: 'wrong', actorId: 'someone-else' }), /may only be contested/);
  const contested = registry.contest(refusal.id, { note: 'this was legitimate', actorId: 'user-1' });
  assert.equal(contested.contested, true);
  assert.throws(() => registry.contest('missing', { actorId: 'user-1' }), /No such refusal/);
});

// ——— s336: a self-hosted search engine may be the provider, and consent still applies ———
//
// The product shipped no search vendor by design, and until now the only provider it would
// accept was `external: true` — which `endpoint()` then refuses when it points at a private
// address. A metasearch running on this installation's own network was therefore rejected by one
// rule for satisfying the other, and the only eligible provider was one you had to buy.
//
// What is NOT relaxed is consent. A self-hosted aggregator forwards the query to public engines,
// so the query still leaves; what running it ourselves buys is that no vendor sees it beside an
// account or a billing identity. These two tests are the pair: local is allowed, unconsented is
// not, and the second is what stops the first from becoming a hole.
describe('a self-hosted research provider', () => {
  const provider = (over = {}) => ({
    id: 'searxng', name: 'NOESAR search', external: false, disabled: false,
    consent: { granted: true }, ...over,
  });

  test('a LOCAL consented provider is accepted', () => {
    const store = { read: () => ({ tools: [provider()], researchToolId: 'searxng' }) };
    assert.doesNotThrow(() => resolveResearchTool(store.read().tools, 'searxng'));
  });

  test('consent is still mandatory, local or not', () => {
    for (const tool of [provider({ consent: { granted: false } }), provider({ external: true, consent: null })]) {
      assert.throws(() => resolveResearchTool([tool], tool.id), /not consented/);
    }
  });

  test('a disabled provider is refused rather than dialled', () => {
    assert.throws(() => resolveResearchTool([provider({ disabled: true })], 'searxng'), /disabled/);
  });
});
