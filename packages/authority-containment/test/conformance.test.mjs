// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Proves two things: (1) this repository's real production JS capability engine conforms to
// @noesar/authority-containment's SPEC.md, via the reference adapter; (2) the suite itself can
// fail — against broken adapters — so a green result here means something.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { runConformance, REQUIREMENTS, loadCanonicalVectors } from '../conformance/index.mjs';
import { attempt } from '../src/reference-adapter.mjs';

describe('SPEC.md requirement <-> case mapping is complete in both directions', () => {
  test('every case maps to a requirement that AC-001..AC-006 actually defines', () => {
    const DEFINED = new Set(['AC-002', 'AC-003', 'AC-004', 'AC-005']);
    for (const [id, requirement] of Object.entries(REQUIREMENTS)) {
      assert.ok(DEFINED.has(requirement), `${id} maps to undefined requirement ${requirement}`);
    }
  });

  test('the canonical vectors file still carries all five named cases', () => {
    const { cases } = loadCanonicalVectors();
    assert.equal(cases.length, 5, 'a case going missing must fail loudly, not run fewer checks silently');
    assert.deepEqual(cases.map((c) => c.id).sort(), Object.keys(REQUIREMENTS).sort());
  });
});

describe('the real product JS engine (services/reference-control-plane/src/capability.mjs)', () => {
  test('conforms to every AC-00x requirement', async () => {
    const report = await runConformance(attempt);
    assert.equal(report.total, 6, 'surface check + 5 cases'); // surface:attempt + CAP-001/002/005/011/012
    const failures = report.results.filter((entry) => !entry.ok);
    assert.deepEqual(failures, [], `unexpected failures: ${JSON.stringify(failures, null, 2)}`);
    assert.equal(report.passed, report.total);
  });
});

describe('the suite is itself tested against broken implementations', () => {
  test('an attempt() that is not a function fails only the surface check', async () => {
    const report = await runConformance(undefined);
    assert.equal(report.total, 1);
    assert.equal(report.passed, 0);
  });

  test('an attempt() that mints everything fails AC-003/AC-004/AC-005, passes AC-002', async () => {
    const report = await runConformance(() => ({ minted: true }));
    const byId = Object.fromEntries(report.results.map((entry) => [entry.id, entry]));
    assert.equal(byId['CAP-001'].ok, true, 'the positive control must still pass');
    assert.equal(byId['CAP-002'].ok, false);
    assert.equal(byId['CAP-005'].ok, false);
    assert.equal(byId['CAP-011'].ok, false);
    assert.equal(byId['CAP-012'].ok, false);
  });

  test('an attempt() that refuses everything fails AC-002 (the positive control)', async () => {
    const report = await runConformance(() => ({ minted: false, kind: 'OUT_OF_SCOPE' }));
    const byId = Object.fromEntries(report.results.map((entry) => [entry.id, entry]));
    assert.equal(byId['CAP-001'].ok, false, 'refusing the benign case must be caught, not pass vacuously');
  });

  test('an attempt() that reports the wrong refusal kind fails, even though minted matches', async () => {
    const report = await runConformance((vector) => {
      if (vector.id === 'CAP-001') return { minted: true };
      return { minted: false, kind: 'INVALID' }; // real answer for these cases is OUT_OF_SCOPE
    });
    const byId = Object.fromEntries(report.results.map((entry) => [entry.id, entry]));
    assert.equal(byId['CAP-002'].ok, false);
  });

  test('an attempt() that throws is caught and reported as a failure, not an uncaught rejection', async () => {
    const report = await runConformance(() => { throw new Error('boom'); });
    assert.ok(report.results.every((entry) => entry.ok === false || entry.id === 'surface:attempt'));
    assert.match(report.results.find((entry) => entry.id === 'CAP-001').detail, /threw instead of returning a verdict/);
  });
});
