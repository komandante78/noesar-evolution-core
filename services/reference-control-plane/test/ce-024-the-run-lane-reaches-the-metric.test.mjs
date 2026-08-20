// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-024` — the criterion, measured end to end rather than in parts.
//
// # What this file proves that the unit tests do not
//
// `review-latency.test.mjs` proves the arithmetic and proves `ProductMetric` records what it is
// handed. Neither of those touches the question `CE-024` actually asks: **does a human decision
// on a real run become a number the product reports?** A metric assembled from three individually
// correct pieces that nothing connects is precisely the "capability that works once and then
// stops" and the "backend with no user path" the engineering rules refuse to call done.
//
// So this drives the real chain: a real `WorkspaceActionOrchestrator` over a real temporary
// workspace, a real `ProductMetric` over a real `AtomicStore` on disk, wired **the way
// `server.mjs` wires them** — and then asks the metric what it holds.
//
// The one joint it cannot cross is `server.mjs` itself: booting the whole server here would cost
// minutes and a port. That joint is covered by the source assertions at the bottom, which are
// weaker than execution and are declared as such rather than presented as equal proof.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { ProductMetric } from '../src/product-metric.mjs';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';

const NOW = Math.floor(Date.now() / 1000);
const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

/** The chain as server.mjs builds it: orchestrator -> recordReview -> ProductMetric -> store. */
function chain() {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-ce024-ws-'));
  // ShadowWorkspace refuses to shadow an empty tree, and a live installation never has one.
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce024-shadows-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'noesar-ce024-state-'));

  const store = new AtomicJsonStore(join(stateDir, 'ai-workspace.json'));
  const metric = new ProductMetric({ store });
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
    // `env: {}` for `D-0566`'s reason: a fixture whose result depends on the operator's shell
    // having selected a provider is not a fixture.
    env: {},
    // The line under test, copied in shape from server.mjs.
    recordReview: (sample) => metric.record(sample),
  });
  return { ws, shadows, stateDir, store, metric, orch };
}
function cleanup({ ws, shadows, stateDir }) {
  for (const dir of [ws, shadows, stateDir]) rmSync(dir, { recursive: true, force: true });
}

async function planOne(orch, { path, contents, request, nowUnix }) {
  return orch.plan({ request, files: [{ path, contents }], actor: 'owner-1', nowUnix });
}

test('CE-024 · an APPROVED run becomes review time the product reports', async () => {
  const fx = chain();
  try {
    mkdirSync(join(fx.ws, 'existing'), { recursive: true });
    writeFileSync(join(fx.ws, 'existing/a.txt'), 'original\n');
    const planned = await planOne(fx.orch, {
      path: 'existing/a.txt', contents: 'original\nnew line\n', request: 'add a line', nowUnix: NOW,
    });
    // The shadow result exists at NOW+10; the person answers at NOW+130. UI-070's interval is
    // the 120 seconds BETWEEN those, not the 130 since the plan: nobody was reading anything
    // for the first ten.
    fx.orch.measure({ runId: planned.runId, actor: 'owner-1', nowUnix: NOW + 10 });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner-1', nowUnix: NOW + 130 });
    assert.equal(approved.promoted, true, 'the change really landed');
    assert.equal(readFileSync(join(fx.ws, 'existing/a.txt'), 'utf8'), 'original\nnew line\n');

    const samples = fx.store.read().reviewSamples;
    assert.equal(samples.length, 1, 'the decision reached the metric');
    assert.equal(samples[0].seconds, 120, 'measured from the SHADOW instant, not from the plan');
    assert.equal(samples[0].readySource, 'shadow-measured');
    assert.equal(samples[0].decision, 'approve');
    assert.equal(samples[0].outcome, 'PROMOTED');
    assert.equal(samples[0].kind, 'coden-run');
    assert.equal(samples[0].itemId, planned.runId);

    // And the figure the surfaces actually render.
    const summary = fx.metric.summary({ at: (NOW + 200) * 1000 });
    assert.equal(summary.decided, 1);
    assert.equal(summary.medianSeconds, 120);
    assert.equal(summary.readySources['shadow-measured'], 1);
  } finally { cleanup(fx); }
});

test('CE-024 · UI-072 — a REJECTED run is review time too, and the store proves it', async () => {
  const fx = chain();
  try {
    const planned = await planOne(fx.orch, {
      path: 'rejected.txt', contents: 'nope\n', request: 'something to say no to', nowUnix: NOW,
    });
    fx.orch.measure({ runId: planned.runId, actor: 'owner-1', nowUnix: NOW + 5 });
    fx.orch.reject({ runId: planned.runId, approverId: 'owner-1', reason: 'not this', nowUnix: NOW + 605 });

    const samples = fx.store.read().reviewSamples;
    assert.equal(samples.length, 1);
    assert.equal(samples[0].decision, 'reject');
    assert.equal(samples[0].seconds, 600, 'the reviewer spent ten minutes and said no — that is the cost');
    assert.equal(samples[0].outcome, 'REJECTED');

    const summary = fx.metric.summary({ at: (NOW + 700) * 1000 });
    // The dishonesty the criterion names: a product reporting "no review time" because the only
    // review it had ended in a refusal.
    assert.equal(summary.decided, 1);
    assert.equal(summary.totalSeconds, 600);
    assert.equal(summary.rejected.count, 1);
    assert.equal(summary.rejectedIncluded, true);
  } finally { cleanup(fx); }
});

test('CE-024 · approve and reject land in ONE figure, mixed as they really happened', async () => {
  const fx = chain();
  try {
    const yes = await planOne(fx.orch, { path: 'yes.txt', contents: 'a\n', request: 'yes', nowUnix: NOW });
    fx.orch.measure({ runId: yes.runId, actor: 'owner-1', nowUnix: NOW + 1 });
    fx.orch.approve({ runId: yes.runId, approverId: 'owner-1', nowUnix: NOW + 21 });

    const no = await planOne(fx.orch, { path: 'no.txt', contents: 'b\n', request: 'no', nowUnix: NOW + 30 });
    fx.orch.measure({ runId: no.runId, actor: 'owner-1', nowUnix: NOW + 31 });
    fx.orch.reject({ runId: no.runId, approverId: 'owner-1', reason: 'no', nowUnix: NOW + 91 });

    const summary = fx.metric.summary({ at: (NOW + 200) * 1000 });
    assert.equal(summary.decided, 2);
    assert.equal(summary.totalSeconds, 80, '20 accepted + 60 refused');
    assert.equal(summary.approved.count, 1);
    assert.equal(summary.rejected.count, 1);
    assert.equal(summary.statistics.count, 2);
  } finally { cleanup(fx); }
});

test('CE-024 · a run rejected before it was ever measured is a declared gap, not an invented interval', async () => {
  const fx = chain();
  try {
    const planned = await planOne(fx.orch, { path: 'blind.txt', contents: 'c\n', request: 'blind', nowUnix: NOW });
    // No measure(): the person said no to the DESCRIPTION. There is no shadow instant, so there
    // is no interval — and the alternative, timing from the plan, would report a measurement
    // nobody took.
    fx.orch.reject({ runId: planned.runId, approverId: 'owner-1', reason: 'no', nowUnix: NOW + 400 });

    assert.equal(fx.store.read().reviewSamples.length, 0, 'nothing invented');
    assert.deepEqual(fx.orch.reviewSamplingGaps(), { decidedWithoutMeasurement: 1, notRecorded: 0 },
      'and nothing hidden either — the gap is countable');
  } finally { cleanup(fx); }
});

test('CE-024 · a metric that throws never fails a promotion that already happened', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-ce024-hostile-ws-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce024-hostile-shadows-'));
  try {
    const orch = new WorkspaceActionOrchestrator({
      workspaceRoot: ws, shadowsRoot: shadows,
      minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), env: {},
      recordReview: () => { throw new Error('the metric store is gone'); },
    });
    const planned = await planOne(orch, { path: 'x.txt', contents: 'd\n', request: 'x', nowUnix: NOW });
    orch.measure({ runId: planned.runId, actor: 'owner-1', nowUnix: NOW + 1 });
    const approved = orch.approve({ runId: planned.runId, approverId: 'owner-1', nowUnix: NOW + 2 });
    // The files are on disk. Losing the measurement of the work must never be what undoes it.
    assert.equal(approved.promoted, true);
    assert.equal(readFileSync(join(ws, 'x.txt'), 'utf8'), 'd\n');
    assert.equal(orch.reviewSamplingGaps().notRecorded, 1, 'and the loss is counted, not swallowed');
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(shadows, { recursive: true, force: true });
  }
});

test('CE-024 · an orchestrator with no metric wired records nothing and breaks nothing', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-ce024-unwired-ws-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce024-unwired-shadows-'));
  try {
    const orch = new WorkspaceActionOrchestrator({
      workspaceRoot: ws, shadowsRoot: shadows,
      minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), env: {},
    });
    const planned = await planOne(orch, { path: 'y.txt', contents: 'e\n', request: 'y', nowUnix: NOW });
    orch.measure({ runId: planned.runId, actor: 'owner-1', nowUnix: NOW + 1 });
    assert.equal(orch.approve({ runId: planned.runId, approverId: 'owner-1', nowUnix: NOW + 2 }).promoted, true);
    assert.deepEqual(orch.reviewSamplingGaps(), { decidedWithoutMeasurement: 0, notRecorded: 0 });
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(shadows, { recursive: true, force: true });
  }
});

// ── the joint execution cannot cross, asserted on the shipped source and DECLARED as weaker ────
//
// Booting the server would cost minutes and a port. These read `server.mjs`'s own text instead,
// which proves the wiring lines EXIST and not that they run. That is a real difference and it is
// stated rather than glossed: this project has been burned by a page that declared it ran a
// client which was not in the image.

test('CE-024 · server.mjs hands the orchestrator a recorder and the dispatch the same metric', () => {
  const source = readFileSync(join(REPO_ROOT, 'services/reference-control-plane/src/server.mjs'), 'utf8');
  assert.match(source, /recordReview:\s*\(sample\)\s*=>\s*productMetric\.record\(sample\)/,
    'the run lane must feed the metric');
  assert.match(source, /getProductMetric:\s*\(\)\s*=>\s*productMetric/,
    'and both shells must read the SAME instance the HTTP route does');
  // One instance, not two: a second `new ProductMetric` would give the terminal its own samples.
  assert.equal((source.match(/new ProductMetric\(/g) ?? []).length, 1,
    'a second instance would be a second set of samples, invisible to the other surface');
});

test('CE-024 · the `/review` verb exists in both shells and names the one method', () => {
  const commands = readFileSync(join(REPO_ROOT, 'apps/shared/coden/agent-commands.js'), 'utf8');
  const viewModel = readFileSync(join(REPO_ROOT, 'apps/webui-static/coden-view-model.js'), 'utf8');
  assert.match(commands, /name:\s*'review'.*method:\s*'review\.latency'/);
  assert.match(viewModel, /review:\s*\(\)\s*=>\s*\['review\.latency'/);
});
