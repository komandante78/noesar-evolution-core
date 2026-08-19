// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reference implementation, held to its own conformance suite.
//
// This file is deliberately thin. Everything that decides *what conformance means* lives in
// `../conformance/index.mjs`, so a second implementation is measured by the same code and not by
// a second reading of the same prose. If this file grew assertions of its own, they would be
// guarantees the contract does not actually require of anybody else.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as implementation from '../src/index.mjs';
import { readFileSync } from 'node:fs';
import { runConformance, vectors, REQUIREMENTS } from '../conformance/index.mjs';

describe('@noesar/verified-acquisition — the reference implementation conforms', () => {
  test('every conformance case passes', async () => {
    const report = await runConformance(implementation);
    const failures = report.results.filter((entry) => !entry.ok).map((entry) => `${entry.id}: ${entry.detail}`);
    assert.deepEqual(failures, [], `${report.failed} of ${report.total} conformance cases failed`);
    // Asserted as a floor rather than an exact number: the suite is meant to grow, and pinning
    // the count would make growing it a test edit rather than a decision.
    assert.ok(report.total >= 40, `the suite should carry a substantial number of cases, has ${report.total}`);
  });

  test('the suite fails an implementation that is missing part of the surface', async () => {
    // The oracle check this project has learned to demand: a conformance suite that has never
    // been seen to FAIL has not been shown to measure anything.
    const crippled = { ...implementation, verifyModelDescriptor: undefined };
    const report = await runConformance(crippled);
    assert.ok(report.failed > 0, 'a missing function must fail conformance');
    assert.ok(report.results.some((entry) => entry.id === 'surface:verifyModelDescriptor' && !entry.ok));
  });

  test('the suite fails an implementation whose origin policy is more permissive', async () => {
    const permissive = { ...implementation, checkSource: (source) => (source ? { allowed: true } : { allowed: false, kind: 'NO_SOURCE' }) };
    const report = await runConformance(permissive);
    const originFailures = report.results.filter((entry) => entry.id.startsWith('origin:') && !entry.ok);
    assert.ok(originFailures.length > 0, 'accepting plain http to any host must fail conformance');
  });

  test('the suite fails an encoder that does not sort object members — D-0547', async () => {
    // The defect VA-012 exists to catch, and the one a second implementation is most likely to
    // ship: insertion order instead of sorted order. It produces valid JSON, round-trips
    // perfectly, and yields a signature nobody else can reproduce.
    const insertionOrder = {
      ...implementation,
      canonicalJson: (value) => JSON.stringify(value),
      canonicalJsonBytes: (value) => Buffer.from(JSON.stringify(value), 'utf8'),
    };
    const report = await runConformance(insertionOrder);
    const failed = report.results.filter((entry) => entry.id.startsWith('canonicalisation:') && !entry.ok);
    assert.ok(failed.length > 0, 'an unsorted encoder must fail conformance');
    assert.ok(failed.every((entry) => entry.requirement === 'VA-012'), 'those failures must be attributed to VA-012');
  });

  test('the suite fails an encoder that coerces a value outside the JSON space — D-0548', async () => {
    // `JSON.stringify(new Date(0))` is a string, and `{}` for an object with no own enumerable
    // properties: both are a representation invented for something that is not a JSON value.
    const coercing = { ...implementation, canonicalJson: (value) => JSON.stringify(value) ?? 'null' };
    const report = await runConformance(coercing);
    assert.ok(
      report.results.some((entry) => entry.id.startsWith('canonicalisation:rejects:') && !entry.ok),
      'an encoder that coerces a non-JSON value must fail conformance',
    );
  });

  test('the suite fails an implementation that ignores the byte ceiling', async () => {
    const uncapped = {
      ...implementation,
      fetchArtefact: (options) => implementation.fetchArtefact({ ...options, maxBytes: null }),
    };
    const report = await runConformance(uncapped);
    assert.ok(report.results.some((entry) => entry.id.startsWith('cap:') && !entry.ok), 'ignoring the cap must fail conformance');
  });
});

describe('the specification and the suite cannot drift apart — D-0532', () => {
  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const stated = [...new Set([...spec.matchAll(/^## (VA-\d{3})\b/gm)].map((m) => m[1]))];

  test('SPEC.md states requirements at all', () => {
    // Guard on the derivation, not only on the comparison: if this regex ever matched nothing,
    // every assertion below would pass vacuously and report perfect traceability over an empty
    // set — the exact false green this project has already paid for once.
    assert.ok(stated.length >= 10, `expected the specification to state requirements, found ${stated.length}`);
  });

  test('every requirement in SPEC.md is measured by at least one conformance case', async () => {
    const report = await runConformance(implementation);
    const measured = new Set(report.results.map((entry) => entry.requirement).filter(Boolean));
    const unmeasured = stated.filter((requirement) => !measured.has(requirement));
    assert.deepEqual(unmeasured, [], 'a requirement no case measures is not closed, however clearly it is written');
  });

  test('every conformance case names a requirement that SPEC.md actually states', async () => {
    const report = await runConformance(implementation);
    const orphans = [...new Set(report.results
      .filter((entry) => !stated.includes(entry.requirement))
      .map((entry) => `${entry.id} -> ${entry.requirement}`))];
    assert.deepEqual(orphans, [], 'a case that measures nothing stated is a case nobody can act on');
  });

  test('no case is allowed to carry no requirement at all', async () => {
    // What this actually measures, stated plainly: an unmapped case family produces
    // `requirement: null` AND a failing result — that is how the runner refuses to absorb a case
    // nobody can trace. So "every result carries a requirement" and "every result passes",
    // together, are the observable form of that refusal. An earlier draft of this test asserted
    // only the SHAPE of the mapping table and claimed in its comment to be an oracle; it was not,
    // and a check that overstates itself is worse than an absent one.
    const report = await runConformance(implementation);
    const untraceable = report.results.filter((entry) => !entry.requirement).map((entry) => entry.id);
    assert.deepEqual(untraceable, [], 'a case family that maps to no requirement must fail, never default');
    assert.ok(Object.values(REQUIREMENTS).every((value) => /^VA-\d{3}$/.test(value)), 'every mapping points at a requirement id');
  });
});

describe('the vectors are data, and stay usable by a consumer with no JavaScript', () => {
  test('every origin vector is complete enough to be executed by another runtime', () => {
    for (const vector of vectors.origin) {
      assert.ok(vector.id, 'a vector needs an id');
      assert.ok('source' in vector, `${vector.id} needs a source`);
      assert.equal(typeof vector.allowed, 'boolean', `${vector.id} needs an expected verdict`);
      if (!vector.allowed) assert.ok(vector.kind, `${vector.id} must name the refusal it expects`);
    }
  });

  test('the vectors declare the contract version they were written against', () => {
    assert.equal(vectors.contractVersion, implementation.CONTRACT_VERSION);
  });

  test('every canonicalisation vector carries the bytes AND their digest — D-0547', () => {
    for (const vector of vectors.canonicalisation.cases) {
      assert.ok(vector.id, 'a vector needs an id');
      assert.equal(typeof vector.expected, 'string', `${vector.id} needs the exact expected string`);
      assert.match(vector.expectedSha256, /^[0-9a-f]{64}$/, `${vector.id} needs the digest of those bytes`);
      assert.ok(Number.isInteger(vector.rule), `${vector.id} must point at a numbered rule in VA-012`);
    }
  });

  test('the negative-zero vector still carries a negative zero', () => {
    // Measured, not assumed: `JSON.stringify(-0)` emits `0`, so regenerating this file with a
    // script silently flattens this case into `0 -> "0"` — which passes while testing nothing.
    // `JSON.parse('-0')` does preserve the sign, so the literal in the file is what keeps the
    // case real. This assertion is the tripwire on that.
    const vector = vectors.canonicalisation.cases.find((entry) => entry.id === 'negative-zero-encodes-as-zero');
    assert.ok(vector, 'the negative-zero case must exist');
    assert.ok(Object.is(vector.value.n, -0), 'the vector was flattened to +0 and now proves nothing');
    assert.equal(vector.expected, '{"n":0}');
  });
});
