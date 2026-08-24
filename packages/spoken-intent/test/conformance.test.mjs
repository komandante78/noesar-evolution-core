// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reference implementation, held to its own conformance suite.
//
// Deliberately thin, and for the same reason as `packages/capability-token`'s: everything that
// decides *what conformance means* lives in `../conformance/index.mjs`, so a second
// implementation is measured by the same code and not by a second reading of the same prose. If
// this file grew assertions of its own they would be guarantees the contract does not actually
// require of anybody else.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as implementation from '../src/index.mjs';
import { runConformance, vectors, REQUIREMENTS } from '../conformance/index.mjs';

describe('@noesar/spoken-intent — the reference implementation conforms', () => {
  test('every conformance case passes', async () => {
    const report = await runConformance(implementation);
    const failures = report.results.filter((entry) => !entry.ok).map((entry) => `${entry.id}: ${entry.detail}`);
    assert.deepEqual(failures, [], `${report.failed} of ${report.total} conformance cases failed`);
    assert.ok(report.total >= 45, `the suite should carry a substantial number of cases, has ${report.total}`);
  });

  // A suite that has never failed has not been shown to work. Three different mutilations, each
  // hitting a different requirement, because a suite that only catches a missing function is a
  // suite that only checks the surface.
  test('the suite fails an implementation missing part of the surface', async () => {
    const report = await runConformance({ ...implementation, splitCompound: undefined });
    assert.ok(report.failed > 0);
    assert.ok(report.results.some((entry) => entry.id === 'surface:splitCompound' && !entry.ok));
  });

  test('the suite fails an implementation that folds no accents', async () => {
    const crippled = { ...implementation, normalise: (text) => String(text ?? '').toLowerCase().trim() };
    const report = await runConformance(crippled);
    assert.ok(report.results.some((entry) => entry.id.startsWith('normalise:') && !entry.ok), 'SI-002 must be measurable');
  });

  // THE case that separates this contract from every fuzzy matcher. If a "helpful" implementation
  // added edit-distance matching, every matching case above would still pass and the product would
  // be more dangerous. This is the one that must fail it.
  test('the suite fails an implementation that matches approximately', async () => {
    const fuzzy = {
      ...implementation,
      resolve(utterance, options) {
        const strict = implementation.resolve(utterance, options);
        if (strict.kind !== 'nothing') return strict;
        // The naive "be forgiving" change: fall back to the first entry sharing a prefix.
        const wanted = implementation.normalise(utterance).slice(0, 6);
        const guess = (options.entries ?? []).find((entry) => (entry.handles.prose ?? []).some((term) => term.startsWith(wanted)));
        return guess ? { kind: 'intent', heard: utterance, entry: guess, argument: '' } : strict;
      },
    };
    const report = await runConformance(fuzzy);
    assert.ok(report.results.some((entry) => entry.id === 'nongoals:no-fuzzy' && !entry.ok),
      'SI-008 must catch approximate matching — a near miss that acts is the failure this contract exists to prevent');
  });
});

describe('the specification and the suite cannot drift apart', () => {
  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const declared = [...spec.matchAll(/^## (SI-\d{3}) · /gm)].map((match) => match[1]);

  test('every requirement in SPEC.md is measured by a case family', () => {
    const measured = new Set(Object.values(REQUIREMENTS));
    assert.deepEqual(declared.filter((id) => !measured.has(id)), [], 'a requirement no case measures is a requirement nobody has to meet');
    assert.ok(declared.length >= 8, `expected at least 8 requirements, SPEC.md declares ${declared.length}`);
  });

  test('every case family names a requirement that exists', () => {
    const known = new Set(declared);
    assert.deepEqual(Object.entries(REQUIREMENTS).filter(([, id]) => !known.has(id)), []);
  });

  test('every case carries its requirement in the report', async () => {
    const report = await runConformance(implementation);
    const orphans = report.results.filter((entry) => !entry.requirement);
    assert.deepEqual(orphans.map((entry) => entry.id), [], 'a case that traces to no requirement is untraceable evidence');
  });

  test('every vector carries the reason it exists', () => {
    for (const family of ['normalise', 'content', 'rank', 'unique', 'argument', 'compound']) {
      for (const item of vectors[family]) {
        assert.ok(item.why && item.why.length > 12, `${family}/${item.id} needs a real "why", not a label`);
      }
    }
  });
});
