// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-023's instrument, not CE-023 itself.
//
// The measurement needs a live external provider, so it cannot run here — and that is exactly
// why the *reporting* half is worth pinning: it is the part of the tool that is read, and on
// 2026-08-20 it was read wrong twice in a single run. Both defects below were live, found by
// running `tools/measure-projection-coverage.mjs` against the installed ATOM daemon, and both
// are invisible to any test of the numbers because they are about what the page says.
//
// `renderReport` is a pure function of the two runs. These cases drive it with fabricated rows
// of the shape `runTask` produces — never with a fabricated measurement result presented as a
// measurement (rule 38): nothing here claims a coverage figure about any provider.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../../../tools/measure-projection-coverage.mjs';

const ROUTING = { externalSurfaces: ['decompose', 'expect'], endpoint: 'http://127.0.0.1:8410' };

/** One row of the shape `runTask` returns, so the test drives the real contract. */
function row(id, label, { parts = 1, covered = 1, total = 1, refused = null } = {}) {
  return { id, label, parts, covered, total, refused, providers: {} };
}

test('a 0/n that came from a refusal prints the reason, and is marked apart from a 0/n that did not', () => {
  const tasks = [{ id: 'T1' }, { id: 'T2' }];
  const without = [row('T1', 'reference'), row('T2', 'reference', { covered: 0 })];
  const withAtom = [
    row('T1', 'external'),
    row('T2', 'external', { parts: 4, covered: 0, total: 4, refused: 'step(s) step-1.1.2 would produce nothing observable' }),
  ];

  const text = renderReport({ tasks, without, withAtom, routing: ROUTING }).join('\n');

  assert.match(text, /REFUSED external\s+T2: step\(s\) step-1\.1\.2 would produce nothing observable/);
  assert.match(text, /refusals: 1/);
  // The refused row carries the marker; the row that merely covered nothing does not.
  const refusedLine = text.split('\n').find((line) => line.startsWith('T2 '));
  assert.match(refusedLine, /0\/4 = 0\.00/);
  assert.ok(refusedLine.includes('0.00!'), `expected the refusal marker on the external score: ${refusedLine}`);
  assert.ok(!refusedLine.includes('0.00!  0'), 'the reference score in the same row must not be marked');
});

test('no refusal, no refusal block — the section is absent rather than empty', () => {
  const tasks = [{ id: 'T1' }];
  const text = renderReport({
    tasks,
    without: [row('T1', 'reference')],
    withAtom: [row('T1', 'external')],
    routing: ROUTING,
  }).join('\n');

  assert.ok(!text.includes('REFUSED'), 'a run with nothing refused must not print a refusal section');
  assert.ok(!text.includes('refusals:'));
});

test('the denominator warning fires on DIFFERS, not only on NO_DIFFERENCE', () => {
  // The exact shape of the run that exposed this: the providers split the same task into a
  // different number of steps, so the aggregate moves for a reason that is not coverage.
  const tasks = [{ id: 'T1' }, { id: 'T2' }];
  const without = [row('T1', 'reference'), row('T2', 'reference', { parts: 2, covered: 2, total: 2 })];
  const withAtom = [row('T1', 'external'), row('T2', 'external', { parts: 4, covered: 0, total: 4 })];

  const text = renderReport({ tasks, without, withAtom, routing: ROUTING }).join('\n');

  assert.match(text, /VERDICT=DIFFERS/);
  assert.match(text, /WARNING the totals differ/);
  assert.match(text, /The aggregate is unsafe when the part counts disagree\./);
});

test('the denominator warning still fires on NO_DIFFERENCE, where it already did', () => {
  // Per-task delta is zero on both tasks — 0.50 against 0.50, 1.00 against 1.00 — yet the
  // totals move, because the same ratios carry different weights: 2/3 = 0.6667 against
  // 3/5 = 0.6000. That gap is the denominator artefact and nothing else.
  const tasks = [{ id: 'T1' }, { id: 'T2' }];
  const without = [row('T1', 'reference', { parts: 2, covered: 1, total: 2 }), row('T2', 'reference')];
  const withAtom = [row('T1', 'external', { parts: 4, covered: 2, total: 4 }), row('T2', 'external')];

  const text = renderReport({ tasks, without, withAtom, routing: ROUTING }).join('\n');

  assert.match(text, /VERDICT=NO_DIFFERENCE/);
  assert.match(text, /WARNING the totals differ/);
});

test('the warning stays silent when the part counts agree, so it keeps meaning something', () => {
  const tasks = [{ id: 'T1' }];
  const text = renderReport({
    tasks,
    without: [row('T1', 'reference', { parts: 2, covered: 2, total: 2 })],
    withAtom: [row('T1', 'external', { parts: 2, covered: 1, total: 2 })],
    routing: ROUTING,
  }).join('\n');

  assert.match(text, /VERDICT=DIFFERS/);
  assert.ok(!text.includes('WARNING'), 'a real per-task difference with equal part counts is not a denominator artefact');
});

test('importing the tool runs no measurement — the module is safe to load without a provider', () => {
  // The CLI half is guarded by an argv check. If that guard regressed, importing this module
  // at the top of this file would already have tried to reach an external provider and the
  // suite would fail somewhere far from the cause; asserting it here names the cause.
  assert.equal(typeof renderReport, 'function');
});
