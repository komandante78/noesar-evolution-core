// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Statistics over review durations, and the one formatter that renders them.
//
// # Why this is a module and not a second metric
//
// `CE-024` — *human review time per decided change* — has exactly **one** implementation in this
// product: `ProductMetric` (`product-metric.mjs`), backed by the `reviewSamples` store. This file
// holds the arithmetic that implementation uses. It deliberately knows nothing about runs, items,
// lanes or stores: it takes an array of durations in seconds and answers questions about them.
//
// The first draft of this file was a **second** metric, computed straight off the orchestrator's
// run records, and it would have put two different numbers behind the same sentence — Home saying
// one thing and `/review` another. That is `CE-033`'s rule ("no third answer to the same
// question") and the `L0-L8` collision `MASTER_PROJECT/02_ATOM.md` records, which cost this
// project real confusion once already. The Owner's decision was one metric; this is the half of
// the first draft that survived it, and it survived because arithmetic over durations is
// genuinely reusable while a second sampler was genuinely duplication.

/** Ordered copy, so callers cannot observe their own array being sorted underneath them. */
function ascending(values) {
  return values.slice().sort((a, b) => a - b);
}

/**
 * The median, on an already-sorted array. Reported **alongside** the mean and never instead of
 * it, because the two disagree in the case that matters: one change that sat unreviewed over a
 * weekend drags a mean far from anything a reviewer would recognise as typical, while the median
 * keeps describing the ordinary case. A single number here would have to choose which to hide.
 */
export function median(values) {
  const sorted = ascending(values);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * The nearest-rank percentile — the smallest observed value at or above the requested rank.
 * Deliberately not interpolated: every number this module reports is a duration somebody
 * actually waited, and an interpolated p90 is a duration nobody waited.
 */
export function percentile(values, fraction) {
  const sorted = ascending(values);
  if (sorted.length === 0) return null;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Everything worth saying about a set of review durations, in one shape.
 *
 * `count` and `totalSeconds` are here rather than left to the caller for a reason `UI-072` makes
 * concrete: the denominator is the thing most easily chosen to flatter, so it travels with the
 * figure it divides instead of being recomputed by whoever renders it.
 */
export function summariseDurations(secondsList) {
  const sorted = ascending(secondsList ?? []);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    totalSeconds: total,
    medianSeconds: median(sorted),
    meanSeconds: sorted.length === 0 ? null : Math.round(total / sorted.length),
    p90Seconds: percentile(sorted, 0.9),
    fastestSeconds: sorted.length === 0 ? null : sorted[0],
    slowestSeconds: sorted.length === 0 ? null : sorted[sorted.length - 1],
  };
}

/**
 * `UI-071` asks for a **trend**, which needs an order and a comparison, not one number.
 *
 * The comparison is the two halves of the series, older against newer, and it is reported only
 * when each half holds at least two points: a "trend" drawn through one point on each side is a
 * line between two anecdotes. Presenting that as a direction would be the same overclaim as
 * `D-0604`'s aggregate on mismatched denominators — which this project chose to declare an
 * artefact rather than print.
 *
 * @param {number[]} orderedSeconds durations in the order they happened, oldest first
 */
export function trendDirection(orderedSeconds) {
  const series = orderedSeconds ?? [];
  if (series.length < 4) {
    return { direction: 'INSUFFICIENT_DATA', olderMedianSeconds: null, newerMedianSeconds: null, changeSeconds: null };
  }
  const split = Math.floor(series.length / 2);
  const older = median(series.slice(0, split));
  const newer = median(series.slice(split));
  const change = newer - older;
  // "Improving" means review got CHEAPER, which is a SMALLER number — the one place here where a
  // falling value is the good news, so it is named rather than left for the reader to infer.
  let direction = 'STEADY';
  if (change < 0) direction = 'IMPROVING';
  else if (change > 0) direction = 'WORSENING';
  return { direction, olderMedianSeconds: older, newerMedianSeconds: newer, changeSeconds: change };
}

/**
 * A duration a person reads, from a duration a machine stored.
 *
 * Lives here rather than in a shell because **three** surfaces show this number — the terminal,
 * the browser-embedded terminal and the WebUI — and this project has already paid for the same
 * answer being written three times: `CE-033`, and the `detailLines` truncation that existed in
 * two shells and not the third until `F-TERM-003` buried a live answer off screen.
 */
export function formatReviewDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
