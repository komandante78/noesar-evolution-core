// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-024` — the rows that measure the product's own metric.
//
// `noesar-evolution` skill, rule 5: *un criterio che nessuna riga di matrice misura NON è chiuso,
// per quanto il documento lo affermi*. These are those rows. Two halves:
//
//   1. the arithmetic (`review-latency.mjs`), and
//   2. **the join** — that the CodeN Evolution run lane reaches the one metric this product
//      publishes, which is the gap `CE-024` actually had. The metric, its store, its endpoint and
//      its Home panel all existed; nothing sampled them from `approve()`/`reject()`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summariseDurations, trendDirection, formatReviewDuration, median, percentile } from '../src/review-latency.mjs';
import { ProductMetric, READY_SOURCES } from '../src/product-metric.mjs';

// ── the arithmetic ────────────────────────────────────────────────────────────────────────────

test('median and mean are both reported, because on this distribution they disagree', () => {
  const summary = summariseDurations([10, 10, 10, 10, 3600]);
  assert.equal(summary.medianSeconds, 10, 'the ordinary review');
  assert.equal(summary.meanSeconds, 728, 'dragged by the one that sat overnight');
  assert.equal(summary.p90Seconds, 3600);
  assert.equal(summary.count, 5);
  assert.equal(summary.totalSeconds, 3640);
});

test('the p90 is a duration somebody actually waited, never an interpolated one', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.9), 40);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([], 0.9), null);
});

test('nothing measured is null, not zero — and dividing by zero never happens', () => {
  const summary = summariseDurations([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.medianSeconds, null);
  assert.equal(summary.meanSeconds, null);
  assert.equal(summary.totalSeconds, 0);
  assert.equal(median([]), null);
});

test('the input array is never sorted underneath the caller', () => {
  const values = [90, 10, 50];
  summariseDurations(values);
  median(values);
  assert.deepEqual(values, [90, 10, 50]);
});

test('UI-071: the trend says which way, and cheaper review is the SMALLER number', () => {
  assert.equal(trendDirection([200, 200, 20, 20]).direction, 'IMPROVING');
  assert.equal(trendDirection([200, 200, 20, 20]).changeSeconds, -180);
  assert.equal(trendDirection([20, 20, 200, 200]).direction, 'WORSENING');
  assert.equal(trendDirection([50, 50, 50, 50]).direction, 'STEADY');
});

test('UI-071: three points is a line between anecdotes, and is refused as a direction', () => {
  const trend = trendDirection([10, 20, 30]);
  assert.equal(trend.direction, 'INSUFFICIENT_DATA');
  assert.equal(trend.changeSeconds, null);
});

test('formatReviewDuration reads as a duration a person waited', () => {
  assert.equal(formatReviewDuration(0), '0s');
  assert.equal(formatReviewDuration(90), '1m 30s');
  assert.equal(formatReviewDuration(3661), '1h 1m');
  assert.equal(formatReviewDuration(90000), '1d 1h');
  assert.equal(formatReviewDuration(null), '—', 'nothing measured is not zero');
});

// ── the join: the run lane reaches the one metric ─────────────────────────────────────────────

/** The smallest store `ProductMetric` needs — same shape as the atomic store's transact/read. */
function fakeStore() {
  const state = { reviewSamples: [] };
  return { state, transact: (fn) => fn(state), read: () => state };
}

const iso = (unix) => new Date(unix * 1000).toISOString();

test('UI-070: a sample from the run lane measures from the SHADOW instant, and says so', () => {
  const store = fakeStore();
  const metric = new ProductMetric({ store });
  const sample = metric.record({
    itemId: 'run-1', kind: 'coden-run', readyAt: iso(1000), decidedAt: iso(1120),
    decision: 'approve', outcome: 'PROMOTED', readySource: 'shadow-measured',
  });
  assert.equal(sample.seconds, 120);
  assert.equal(sample.readySource, 'shadow-measured');
  assert.equal(sample.outcome, 'PROMOTED');
});

test('a sample must declare which left edge it measured from', () => {
  const metric = new ProductMetric({ store: fakeStore() });
  assert.throws(() => metric.record({
    itemId: 'x', readyAt: iso(0), decidedAt: iso(10), decision: 'approve', readySource: 'invented',
  }), /which left edge/);
  assert.deepEqual(READY_SOURCES.slice(), ['approval-raised', 'shadow-measured']);
});

test('UI-072: a rejected run is inside the figure, not excluded from it', () => {
  const store = fakeStore();
  const metric = new ProductMetric({ store });
  const at = Date.parse(iso(10_000_000)) + 1000;
  metric.record({ itemId: 'yes', readyAt: iso(9_999_000), decidedAt: iso(9_999_010), decision: 'approve', readySource: 'shadow-measured' });
  metric.record({ itemId: 'no', readyAt: iso(9_999_000), decidedAt: iso(9_999_600), decision: 'reject', readySource: 'shadow-measured' });
  const summary = metric.summary({ at });
  // The dishonesty UI-072 names: reporting 10s by keeping only what was accepted, while the
  // reviewer actually spent 610s. If this ever reads 10, the denominator was picked.
  assert.equal(summary.decided, 2);
  assert.equal(summary.totalSeconds, 610);
  assert.equal(summary.rejected.count, 1);
  assert.equal(summary.rejectedIncluded, true);
  assert.equal(summary.statistics.count, 2, 'the richer statistics run over the SAME samples');
  assert.equal(summary.statistics.totalSeconds, 610);
});

test('the report says how many samples used which left edge, so a moved definition is visible', () => {
  const store = fakeStore();
  const metric = new ProductMetric({ store });
  const at = Date.parse(iso(10_000_000)) + 1000;
  metric.record({ itemId: 'old', readyAt: iso(9_999_000), decidedAt: iso(9_999_010), decision: 'approve', readySource: 'approval-raised' });
  metric.record({ itemId: 'new', readyAt: iso(9_999_000), decidedAt: iso(9_999_020), decision: 'approve', readySource: 'shadow-measured' });
  const summary = metric.summary({ at });
  assert.deepEqual(summary.readySources, { 'approval-raised': 1, 'shadow-measured': 1 });
  assert.match(summary.readyDefinition, /shadow result was ready/);
  // The old wording claimed shadow execution did not exist in this build. It does, since D-0567,
  // and a definition that outlived its own truth is what this asserts against.
  assert.doesNotMatch(summary.readyDefinition, /does not exist in this build/);
});

test('a sample written before this change, with no readySource, still counts as the old edge', () => {
  const store = fakeStore();
  const metric = new ProductMetric({ store });
  const at = Date.parse(iso(10_000_000)) + 1000;
  // Written straight into the store, the way a pre-existing installation's file holds it.
  store.state.reviewSamples.push({
    id: 'legacy', itemId: 'legacy', kind: 'approval', projectId: null,
    readyAt: iso(9_999_000), decidedAt: iso(9_999_030), seconds: 30, decision: 'approve', actorId: 'system',
  });
  const summary = metric.summary({ at });
  assert.equal(summary.decided, 1, 'it is not dropped for lacking a field it predates');
  assert.deepEqual(summary.readySources, { 'approval-raised': 1, 'shadow-measured': 0 });
});
