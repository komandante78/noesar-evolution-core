// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The product metric and the closure — UI-070…UI-072 and UI-036.
//
// Two of these are Critical, and both are Critical for the same reason: they are the
// places where a product is tempted to flatter itself. A metric that quietly drops
// rejected changes reports a better number by choosing its denominator; a closing report
// with an empty NOT DONE box reads as "nothing went wrong" when it may equally mean
// "nobody looked".
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ClosureRegister, ProductMetric } from '../src/product-metric.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-metric-'));
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  return { dir, store, metric:new ProductMetric({ store }), closures:new ClosureRegister({ store }) };
}
const AT = Date.parse('2026-02-10T12:00:00.000Z');

describe('the product metric', () => {
  test('a rejected change counts as time spent — the figure includes it', () => {
    const f = fixture();
    try {
      // Two minutes to say yes, ten minutes to say no. The ten minutes were spent.
      f.metric.record({ itemId:'a', readyAt:'2026-02-10T10:00:00.000Z', decidedAt:'2026-02-10T10:02:00.000Z', decision:'approve' });
      f.metric.record({ itemId:'b', readyAt:'2026-02-10T11:00:00.000Z', decidedAt:'2026-02-10T11:10:00.000Z', decision:'reject' });

      const summary = f.metric.summary({ at:AT });
      assert.equal(summary.decided, 2);
      assert.equal(summary.totalSeconds, 120 + 600);
      assert.equal(summary.medianSeconds, 360);
      assert.equal(summary.rejected.count, 1);
      assert.equal(summary.rejected.medianSeconds, 600);
      assert.equal(summary.rejectedIncluded, true);
      // UI-072 stated as an assertion rather than as a comment: dropping the rejection
      // would leave the median at 120, which is the number a flattering build reports.
      assert.notEqual(summary.medianSeconds, summary.approved.medianSeconds);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('the figure is a time and says so, never a score', () => {
    const f = fixture();
    try {
      f.metric.record({ itemId:'a', readyAt:'2026-02-10T10:00:00.000Z', decidedAt:'2026-02-10T10:05:00.000Z', decision:'approve' });
      const summary = f.metric.summary({ at:AT });
      assert.match(summary.unit, /seconds of human review/);
      assert.equal(summary.medianSeconds, 300);
      // The left edge of the interval travels with the number, so no reader has to guess
      // what "ready" meant in the build that produced it.
      assert.match(summary.readyDefinition, /shadow execution does not exist/);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('the window bounds the trend and never the count', () => {
    const f = fixture();
    try {
      f.metric.record({ itemId:'old', readyAt:'2025-12-01T10:00:00.000Z', decidedAt:'2025-12-01T10:01:00.000Z', decision:'approve' });
      f.metric.record({ itemId:'new', readyAt:'2026-02-09T10:00:00.000Z', decidedAt:'2026-02-09T10:03:00.000Z', decision:'approve' });
      const summary = f.metric.summary({ at:AT, windowDays:30 });
      assert.equal(summary.total, 2, 'everything held is counted');
      assert.equal(summary.decided, 1, 'the window bounds what the trend shows');
      assert.deepEqual(summary.trend.map((point) => point.day), ['2026-02-09']);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('a sample without a decision, or without both instants, is refused', () => {
    const f = fixture();
    try {
      assert.throws(() => f.metric.record({ itemId:'a', readyAt:'2026-02-10T10:00:00.000Z', decision:'maybe' }), /decision that was taken/);
      assert.throws(() => f.metric.record({ itemId:'a', readyAt:null, decision:'approve' }), /both instants/);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('an empty metric answers with nothing rather than with a zero that looks like a result', () => {
    const f = fixture();
    try {
      const summary = f.metric.summary({ at:AT });
      assert.equal(summary.decided, 0);
      assert.equal(summary.medianSeconds, null);
      assert.equal(summary.approved.medianSeconds, null);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });
});

describe('the closure and its NOT DONE box', () => {
  test('a closure listing nothing and declaring nothing is REFUSED', () => {
    const f = fixture();
    try {
      assert.throws(
        () => f.closures.record({ runId:'run-1', residualRisk:'none' }),
        /list what was not done, or state explicitly/,
      );
      assert.equal(f.closures.list().length, 0, 'a refused closure is not stored half-written');
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('an empty box is allowed only when it is declared, and the declaration is recorded', () => {
    const f = fixture();
    try {
      const closed = f.closures.record({ runId:'run-1', residualRisk:'none', nothingLeftUndone:true });
      assert.equal(closed.nothingLeftUndone, true);
      assert.deepEqual(closed.notDone, []);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('items listed are kept, and the declaration flag cannot claim the box was empty', () => {
    const f = fixture();
    try {
      const closed = f.closures.record({
        runId:'run-2', residualRisk:'the migration is untested against a populated cluster',
        notDone:['the RTL pass', '  ', 'the screen-reader pass'], nothingLeftUndone:true,
      });
      assert.deepEqual(closed.notDone, ['the RTL pass', 'the screen-reader pass']);
      // The caller said "nothing left undone" while listing two things. The record follows
      // the items, not the claim: a flag that could contradict its own content would let a
      // report say "clean" while carrying the opposite.
      assert.equal(closed.nothingLeftUndone, false);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('residual risk is required, even when it is "none"', () => {
    const f = fixture();
    try {
      assert.throws(() => f.closures.record({ runId:'run-3', notDone:['one thing'] }), /residual risk/);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('closing the same run twice replaces the report rather than growing a second one', () => {
    const f = fixture();
    try {
      f.closures.record({ runId:'run-4', residualRisk:'none', nothingLeftUndone:true });
      f.closures.record({ runId:'run-4', residualRisk:'low', notDone:['the load test'] });
      assert.equal(f.closures.list().length, 1);
      assert.deepEqual(f.closures.get('run-4').notDone, ['the load test']);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });
});
