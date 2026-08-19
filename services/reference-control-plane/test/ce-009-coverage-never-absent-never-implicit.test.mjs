// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-009 · "La copertura di proiezione è sempre presente, mai arrotondata a «completa»."
// CE-019 · "Il rapporto finale … la casella `NON FATTO` non può essere vuota senza dirlo."
//
// Verified the way the matrix says to verify them: **a test that refuses a report without
// coverage or with implicit coverage** (CE-009), and **a test on the format** (CE-019).
//
// # Why this file exists at all, when both rules already had code
//
// `verification.mjs#projectionCoverage()` has never rounded a partial result up, and
// `test/verification.test.mjs` has proven that since it was written. `ClosureRegister`
// refuses a closure that lists nothing and declares nothing, and both shells render the box.
// Neither of those is the thing this criterion names. The criterion is about **the report**,
// and the report is `assembleSessionProof()` — served at `/api/v1/workspace-actions/:id/
// session-proof`. Measured 2026-08-19, before the guard now under test:
//
//   · a decided run carrying no coverage serialised to `{"diff":[],"risk":…,"promoted":false}`
//     — `coverage: undefined` is dropped by `JSON.stringify`, so the served report had no
//     coverage at all. Not "declared unmeasured": absent.
//   · a coverage object claiming `complete:true` over 6 of 9 recomputed passed through
//     untouched, and the report asserted a complete projection of a partial one.
//   · every PROMOTED run's `notDone` was `null` — a blank NOT DONE box, indistinguishable
//     from a run where nobody looked, which is the exact thing §16 forbids.
//
// A rule enforced only in the producer is a rule any second producer walks around. These
// tests hold the CONSUMER, which is where the criterion is written.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { assembleSessionProof, SessionProofRefused } from '../src/session-proof.mjs';
import { projectionCoverage } from '../src/verification.mjs';

const NOW = 1_760_000_000;

/** A run in the shape `WorkspaceActionOrchestrator` keeps, with nothing about coverage set. */
const runWith = (overrides) => ({
  runId: 'r-ce009', intent: { goal: 'g' }, hypotheses: [], plan: { steps: [] }, expectation: {},
  files: [{ path: 'a.txt', contents: 'x' }], provenance: [], request: 'r', projectRules: [],
  constraints: [], mode: 'safe', policy: 'restrictive', claims: [],
  createdAtUnix: NOW, decidedAtUnix: NOW + 1, egressSamples: [], risk: { overall: 'LOW' },
  result: null, diff: [], ...overrides,
});

/** Real coverage, produced by the real function, so no test here asserts against a fiction. */
const realCoverage = ({ recomputed = 2, total = 2, matched = null } = {}) => {
  const results = [];
  for (let index = 0; index < total; index += 1) {
    const isRecomputed = index < recomputed;
    const doesMatch = index < (matched ?? recomputed);
    results.push({
      claim: { type: 'file-exists', path: `f${index}.txt` },
      recomputed: isRecomputed,
      matches: isRecomputed && doesMatch,
      reason: isRecomputed ? 'recomputed against the shadow' : 'behavioural claim — EXECUTE is refused',
    });
  }
  return projectionCoverage(results);
};

describe('CE-009 · a report without coverage is refused', () => {
  test('a MEASURED run that carries no coverage does not produce a report at all', () => {
    const run = runWith({ status: 'PROMOTED', coverage: null });
    assert.throws(() => assembleSessionProof({ run, events: [] }), (error) => {
      assert.ok(error instanceof SessionProofRefused, 'the refusal must be typed, not a bare Error');
      assert.match(error.message, /no projection coverage/);
      // The refusal is thrown inside a GET route (`server.mjs` `/…/session-proof`), whose outer
      // handler classifies by `error.status`. Carrying 500 is what makes the refusal a logged,
      // ledger-recorded 500 instead of an unclassified failure — the request fails, the process
      // does not, and no half-right report is served.
      assert.equal(error.status, 500, 'an untyped status would be served as an unclassified failure');
      return true;
    }, 'a measured run with no coverage was reported — the coverage key would vanish from the served JSON');
  });

  test('the absence is DECLARED, never omitted, when the run was never measured', () => {
    // The other half of the same rule: «un\'affermazione non misurata è dichiarata non
    // misurata». Refusing here would be wrong — a run refused before measurement is a real,
    // legitimate report. What is forbidden is saying nothing.
    const run = runWith({ status: 'REFUSED', coverage: null, measurement: null });
    const proof = assembleSessionProof({ run, events: [] });
    const { coverage } = proof.fields.esito.value;
    assert.equal(coverage.measured, false);
    assert.match(coverage.reason, /before any measurement ran/);
    // The property that actually failed before: it must survive serialisation.
    const served = JSON.parse(JSON.stringify(proof)).fields.esito.value;
    assert.ok('coverage' in served && served.coverage !== null,
      'the coverage key disappeared from the served report — this is the original defect');
    assert.equal(served.coverage.measured, false);
  });

  test('a coverage object whose numbers cannot be read is refused, not passed through', () => {
    for (const broken of [
      { total: 3, recomputed: 1, declaration: 'x', unrecomputed: [], contradicted: [] },       // no `matched`
      { total: 3, recomputed: 1, matched: 1, declaration: 'x', contradicted: [] },             // no list
      { total: 3, recomputed: 1, matched: 1, unrecomputed: [], contradicted: [] },             // no declaration
      { total: '3', recomputed: 1, matched: 1, declaration: 'x', unrecomputed: [], contradicted: [] },
    ]) {
      assert.throws(
        () => assembleSessionProof({ run: runWith({ status: 'PROMOTED', coverage: broken }), events: [] }),
        SessionProofRefused,
        `a report was assembled over unreadable coverage: ${JSON.stringify(broken)}`);
    }
  });
});

describe('CE-009 · coverage is never rounded up to "complete"', () => {
  test('a report claiming complete over a partial projection is refused', () => {
    // The value a well-behaved producer would never emit — and the point is precisely that
    // the report must not depend on the producer behaving.
    const rounded = { ...realCoverage({ recomputed: 6, total: 9 }), complete: true };
    assert.throws(
      () => assembleSessionProof({ run: runWith({ status: 'PROMOTED', coverage: rounded }), events: [] }),
      (error) => {
        assert.match(error.message, /claims `complete` over 6\/9 recomputed and 6\/9 matched/);
        return true;
      },
      'a report asserted a complete projection of a partial one');
  });

  test('recomputed-but-contradicted is not complete either, and is refused if claimed', () => {
    const rounded = { ...realCoverage({ recomputed: 4, total: 4, matched: 3 }), complete: true };
    assert.equal(rounded.recomputed, 4, 'everything was recomputed…');
    assert.equal(rounded.matched, 3, '…but one did not match, so this is not a complete projection');
    assert.throws(() => assembleSessionProof({ run: runWith({ status: 'PROMOTED', coverage: rounded }), events: [] }),
      SessionProofRefused);
  });

  test('a genuinely complete projection is accepted, so the guard is not simply refusing everything', () => {
    const coverage = realCoverage({ recomputed: 3, total: 3 });
    assert.equal(coverage.complete, true, 'the real function must call this one complete');
    const proof = assembleSessionProof({ run: runWith({ status: 'PROMOTED', coverage }), events: [] });
    assert.equal(proof.fields.esito.value.coverage.complete, true);
    assert.equal(proof.fields.esito.value.coverage.measured, true);
  });

  test('zero declared claims is never complete, and the report says so in words', () => {
    const coverage = realCoverage({ recomputed: 0, total: 0 });
    assert.equal(coverage.complete, false, 'nothing recomputed cannot be a complete projection');
    const proof = assembleSessionProof({ run: runWith({ status: 'PROMOTED', coverage }), events: [] });
    assert.match(proof.fields.esito.value.coverage.declaration, /no claims were declared/);
  });
});

describe('CE-019 · the NOT DONE box of the final report is never blank and silent', () => {
  test('a promoted run with unrecomputed claims names each one', () => {
    const coverage = realCoverage({ recomputed: 1, total: 3 });
    const proof = assembleSessionProof({ run: runWith({ status: 'PROMOTED', coverage }), events: [] });
    const { notDone } = proof.fields.esito.value;
    assert.equal(notDone.items.length, 2, 'two claims were not recomputed and both belong in the box');
    assert.equal(notDone.nothingLeftUndone, false);
    for (const item of notDone.items) {
      assert.match(item, /claim not recomputed: file-exists f\d\.txt — /,
        'an item must name the claim AND the reason — a bare count sends nobody anywhere');
    }
  });

  test('an empty box is a DECLARATION, never a null', () => {
    const coverage = realCoverage({ recomputed: 3, total: 3 });
    const proof = assembleSessionProof({ run: runWith({ status: 'PROMOTED', coverage }), events: [] });
    const { notDone } = proof.fields.esito.value;
    assert.notEqual(notDone, null, 'the original defect: `notDone: null` on every promoted run');
    assert.equal(notDone.nothingLeftUndone, true);
    assert.equal(notDone.items.length, 0);
    assert.match(notDone.declaration, /stated rather than left blank/);
    // Serialised, because a declaration that only exists in memory is not in the report.
    const served = JSON.parse(JSON.stringify(proof)).fields.esito.value.notDone;
    assert.equal(served.nothingLeftUndone, true);
    assert.ok(served.declaration.length > 0);
  });

  test('a refused run says what was not done, and does not borrow the promoted wording', () => {
    const run = runWith({ status: 'REFUSED', coverage: null, measurement: null });
    const { notDone } = assembleSessionProof({ run, events: [] }).fields.esito.value;
    assert.equal(notDone.nothingLeftUndone, false);
    assert.ok(notDone.items.some((item) => /nothing was promoted/.test(item)));
    assert.ok(notDone.items.some((item) => /no claim was recomputed/.test(item)));
  });

  test('a run not yet decided has no outcome at all — which is a third state, not an empty box', () => {
    const run = runWith({ status: 'PENDING_APPROVAL', decidedAtUnix: null });
    const proof = assembleSessionProof({ run, events: [] });
    assert.equal(proof.fields.esito.value, null);
    assert.match(proof.fields.esito.reason, /does not exist before approve\(\) decides/);
  });
});
