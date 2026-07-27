// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The product's own metric, and the closure that reports a change — UI-070…UI-072, UI-036.
//
// The metric is **human review time per accepted change**. It is not a score and it is
// never rendered as one: a score invites the reader to feel good about a number, whereas
// a time says how much of a person's day the product costs.
//
// Two things about it are easy to get wrong, and both are written into the code rather
// than into a comment on a dashboard:
//
//   UI-072 · a REJECTED change counts as time spent. Excluding it would be choosing the
//           denominator that flatters the product: the review happened, the person spent
//           the minutes, and the fact that the answer was "no" is precisely the outcome a
//           trustworthy tool must be able to report. `record()` therefore takes the
//           decision and never filters on it, and `summary()` reports both while keeping
//           them inside one figure.
//
//   UI-070 · the interval starts when the change was READY FOR A HUMAN, not when the
//           request was made. In the finished design that instant is "the shadow run
//           produced a result". Shadow execution does not exist in this build, so the
//           left edge is the moment the approval was raised — the same instant, measured
//           at the only place that currently knows it. This substitution is declared in
//           `docs/DECISION_LOG.md` rather than hidden: when shadow execution lands, the
//           left edge moves and the samples before it stay comparable, because both mean
//           "the work was done and the product was waiting for a person".

const DAY = 86_400_000;

function seconds(fromIso, toIso) {
  const from = Date.parse(fromIso); const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(Math.round((to - from) / 1000), 0);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export class ProductMetric {
  constructor({ store }) { this.store = store; }

  /**
   * One review, recorded when a human decides. Approve and reject both land here.
   */
  record({ itemId, kind = 'unknown', projectId = null, readyAt, decidedAt = new Date().toISOString(), decision, actorId = 'system' }) {
    if (decision !== 'approve' && decision !== 'reject') {
      throw Object.assign(new Error('A review sample needs the decision that was taken.'), { status:400 });
    }
    const elapsed = seconds(readyAt, decidedAt);
    if (elapsed === null) throw Object.assign(new Error('A review sample needs both instants.'), { status:400 });
    return this.store.transact((state) => {
      const sample = {
        id:`${itemId}@${decidedAt}`, itemId:String(itemId), kind:String(kind), projectId,
        readyAt, decidedAt, seconds:elapsed, decision, actorId,
      };
      state.reviewSamples.push(sample);
      return sample;
    });
  }

  /**
   * The figure, and the trend behind it. `windowDays` bounds the trend, never the count:
   * a window that silently dropped samples would be the same choice-of-denominator
   * defect that UI-072 exists to prevent, so `total` always counts everything held.
   */
  summary({ projectId = null, at = Date.now(), windowDays = 30 } = {}) {
    const all = this.store.read().reviewSamples.filter((item) => !projectId || item.projectId === projectId);
    const since = at - windowDays * DAY;
    const inWindow = all.filter((item) => Date.parse(item.decidedAt) >= since);
    const approved = inWindow.filter((item) => item.decision === 'approve');
    const rejected = inWindow.filter((item) => item.decision === 'reject');

    const days = new Map();
    for (const sample of inWindow) {
      const day = sample.decidedAt.slice(0, 10);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(sample.seconds);
    }

    return {
      // What the metric is, carried with the number, so a caller cannot render it as a score.
      unit:'seconds of human review per decided change',
      windowDays,
      total:all.length,
      decided:inWindow.length,
      medianSeconds:median(inWindow.map((item) => item.seconds)),
      totalSeconds:inWindow.reduce((sum, item) => sum + item.seconds, 0),
      approved:{ count:approved.length, medianSeconds:median(approved.map((item) => item.seconds)) },
      // Stated separately AND included above. Both, deliberately: the split is useful,
      // the exclusion would be dishonest.
      rejected:{ count:rejected.length, medianSeconds:median(rejected.map((item) => item.seconds)) },
      rejectedIncluded:true,
      trend:[...days.entries()].sort().map(([day, values]) => ({ day, decided:values.length, medianSeconds:median(values) })),
      // The left edge of every interval, declared with the figure rather than in a footnote.
      readyDefinition:'approval raised (shadow execution does not exist in this build)',
    };
  }
}

/**
 * The closure of a change — stage 16 — and the box that makes it worth reading.
 *
 * `UI-036` is Critical and is the reason this class exists: **the NOT DONE box cannot be
 * empty without saying so.** A report that lists only what succeeded teaches uniform
 * trust, which is the opposite of useful; and a report where the box is merely blank is
 * indistinguishable from one where nobody looked.
 *
 * So there are three states and the middle one is not allowed:
 *   · items listed            → the report says what was not done
 *   · nothing listed, declared → the author states "nothing was left undone", and owns it
 *   · nothing listed, silent   → REFUSED
 */
export class ClosureRegister {
  constructor({ store, ledger = null }) { this.store = store; this.ledger = ledger; }

  record({ runId, kind = 'agent-run', projectId = null, summary = '', notDone = [], nothingLeftUndone = false, residualRisk = '', reviewSeconds = null, actorId = 'system' }) {
    const items = (Array.isArray(notDone) ? notDone : [])
      .map((entry) => String(entry).trim()).filter(Boolean).slice(0, 100);
    if (!items.length && nothingLeftUndone !== true) {
      throw Object.assign(
        new Error('A closure must list what was not done, or state explicitly that nothing was left undone.'),
        { status:400 },
      );
    }
    if (!String(residualRisk).trim()) {
      throw Object.assign(new Error('A closure must state the residual risk, even if the residual risk is "none".'), { status:400 });
    }
    const record = {
      id:`closure:${runId}`, runId:String(runId), kind:String(kind), projectId,
      summary:String(summary).slice(0, 5000),
      notDone:items,
      nothingLeftUndone:!items.length,
      residualRisk:String(residualRisk).slice(0, 5000),
      reviewSeconds:reviewSeconds === null ? null : Math.max(Math.round(Number(reviewSeconds)), 0),
      closedAt:new Date().toISOString(), actorId,
    };
    const stored = this.store.transact((state) => {
      const existing = state.closures.findIndex((item) => item.runId === record.runId);
      if (existing >= 0) state.closures[existing] = record; else state.closures.push(record);
      return record;
    });
    this.ledger?.append({ actor:actorId, action:'change.closed', result:'success', details:{ runId:record.runId, notDone:record.notDone.length, nothingLeftUndone:record.nothingLeftUndone } });
    return stored;
  }

  list({ projectId = null } = {}) {
    return this.store.read().closures
      .filter((item) => !projectId || item.projectId === projectId)
      .sort((left, right) => (left.closedAt < right.closedAt ? 1 : -1));
  }

  get(runId) {
    return this.store.read().closures.find((item) => item.runId === String(runId)) ?? null;
  }
}
