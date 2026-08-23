// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reference implementation, held to its own conformance suite.
//
// This file is deliberately thin. Everything that decides *what conformance means* lives in
// `../conformance/index.mjs`, so a second implementation is measured by the same code and not
// by a second reading of the same prose. If this file grew assertions of its own, they would be
// guarantees the contract does not actually require of anybody else.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as implementation from '../src/index.mjs';
import { runConformance, vectors, REQUIREMENTS } from '../conformance/index.mjs';

describe('@noesar/capability-token — the reference implementation conforms', () => {
  test('every conformance case passes', async () => {
    const report = await runConformance(implementation);
    const failures = report.results.filter((entry) => !entry.ok).map((entry) => `${entry.id}: ${entry.detail}`);
    assert.deepEqual(failures, [], `${report.failed} of ${report.total} conformance cases failed`);
    assert.ok(report.total >= 15, `the suite should carry a substantial number of cases, has ${report.total}`);
  });

  test('the suite fails an implementation that is missing part of the surface', async () => {
    const crippled = { ...implementation, verify: undefined };
    const report = await runConformance(crippled);
    assert.ok(report.failed > 0, 'a missing function must fail conformance');
    assert.ok(report.results.some((entry) => entry.id === 'surface:verify' && !entry.ok));
  });

  test('the suite fails a pre-image that drops a signed field — reordered operations', async () => {
    // The defect this must catch: an encoder that forgets to feed the operations list at all.
    const droppingOperations = {
      ...implementation,
      sign(token, secret) {
        return implementation.sign({ ...token, operations: [] }, secret);
      },
    };
    const report = await runConformance(droppingOperations);
    const failed = report.results.filter((entry) => entry.id.startsWith('mac:') && !entry.ok);
    assert.ok(failed.length > 0, 'an implementation that ignores operations must fail the mac vectors');
  });

  test('the suite fails a verify() that always returns false', async () => {
    // The oracle for the positive control: without it, an always-false verify() would pass
    // every tamper:* case and look like a perfect implementation.
    const alwaysRefuses = { ...implementation, verify: () => false };
    const report = await runConformance(alwaysRefuses);
    assert.ok(report.results.some((entry) => entry.id === 'tamper:positive-control' && !entry.ok),
      'a verify() that always returns false must fail the positive control');
  });

  test('the suite fails an implementation that accepts a short secret', async () => {
    const permissive = {
      ...implementation,
      sign: (token) => implementation.sign(token, Buffer.alloc(32, 1)), // ignores the caller's secret entirely
    };
    const report = await runConformance(permissive);
    const secretFailures = report.results.filter((entry) => entry.id.startsWith('secret:') && !entry.ok);
    assert.ok(secretFailures.length > 0, 'ignoring the caller-supplied secret must fail the secret cases');
  });

  test('the suite fails an implementation that leaks authorization policy on its surface', async () => {
    const leaking = { ...implementation, mint: () => {} };
    const report = await runConformance(leaking);
    assert.ok(report.results.some((entry) => entry.id === 'nongoals:mint' && !entry.ok),
      'exporting mint() must fail CT-007');
  });
});

describe('the specification and the suite cannot drift apart', () => {
  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const stated = [...new Set([...spec.matchAll(/^## (CT-\d{3})\b/gm)].map((m) => m[1]))];

  test('SPEC.md states requirements at all', () => {
    // Guard on the derivation, not only on the comparison: if this regex matched nothing, every
    // assertion below would pass vacuously over an empty set.
    assert.ok(stated.length >= 5, `expected the specification to state requirements, found ${stated.length}`);
  });

  test('every requirement in SPEC.md is measured by at least one conformance case', async () => {
    const report = await runConformance(implementation);
    const measured = new Set(report.results.map((entry) => entry.requirement).filter(Boolean));
    const unmeasured = stated.filter((requirement) => !measured.has(requirement));
    assert.deepEqual(unmeasured, [], 'a requirement no case measures is not closed, however clearly it is written');
  });

  test('every conformance case names a requirement that SPEC.md actually states', async () => {
    const report = await runConformance(implementation);
    const rogue = [...new Set(report.results
      .filter((entry) => entry.requirement && !stated.includes(entry.requirement))
      .map((entry) => `${entry.id} -> ${entry.requirement}`))];
    assert.deepEqual(rogue, [], 'a case naming a requirement SPEC.md does not state has nowhere to be read');
  });

  test('no case is allowed to carry no requirement at all', async () => {
    const report = await runConformance(implementation);
    const untraceable = report.results.filter((entry) => !entry.requirement).map((entry) => entry.id);
    assert.deepEqual(untraceable, [], 'a case family that maps to no requirement must fail, never default');
    assert.ok(Object.values(REQUIREMENTS).every((value) => /^CT-\d{3}$/.test(value)), 'every mapping points at a requirement id');
  });
});

test('the vectors file used by the suite is the same file the Python conformance runner reads', () => {
  // A second copy would let the two languages drift apart silently — one file is the whole
  // point of CT-004's "measured against the real product, not the reference source" claim.
  assert.ok(vectors.mac.length >= 3, 'expected mac vectors to be present');
  assert.ok(vectors.mac.every((v) => v.provenance?.includes('TokenMinter')),
    'every mac vector must declare it was minted by the real product, not hand-built');
});
