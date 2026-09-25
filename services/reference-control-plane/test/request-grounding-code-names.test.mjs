// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The names a report writes as code are searched before its prose.
//
// Measured 2026-09-25 on 155 SWE-bench Verified issues: the gold file was inside the first five
// results for 79 of them when the search took the report's first twelve words, and for 101 when the
// names written as code (`separability_matrix`, `CompoundModel`, `URLValidator`) went first. The
// first twelve words of a report are its title and its prose; the name that pins the bug to one
// file usually sits below them, often inside a code block, and never reached the search at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groundRequest, searchTermsOf } from '../src/request-grounding.mjs';

test('a name written as code goes first even when it comes after the prose', () => {
  const report = 'Modeling does not compute separability correctly for nested models when composing them. '
    + 'Consider the following call: separability_matrix(CompoundModel)';
  const terms = searchTermsOf(report);
  assert.deepEqual(terms.slice(0, 2), ['separability_matrix', 'compoundmodel']);
  assert.ok(terms.includes('modeling'), 'the prose is still searched, after the names');
});

test('an acronym before a word is a name too', () => {
  assert.equal(searchTermsOf('reject bad input in URLValidator')[0], 'urlvalidator');
  assert.equal(searchTermsOf('the HTTPError is raised')[0], 'httperror');
});

test('at most eight names take a slot; plain words fill the rest of the twelve, in order', () => {
  const names = 'aa_a bb_b cc_c dd_d ee_e ff_f gg_g hh_h ii_i jj_j';
  const words = 'alpha beta gamma delta epsilon';
  const terms = searchTermsOf(`${words} ${names}`);
  assert.equal(terms.length, 12);
  assert.deepEqual(terms.slice(0, 8), ['aa_a', 'bb_b', 'cc_c', 'dd_d', 'ee_e', 'ff_f', 'gg_g', 'hh_h']);
  assert.deepEqual(terms.slice(8), ['alpha', 'beta', 'gamma', 'delta']);
});

test('a request with no such name keeps the first-appearance order of the plain words', () => {
  assert.deepEqual(searchTermsOf('restore the passkey rotation counter in webauthn'),
    ['restore', 'passkey', 'rotation', 'counter', 'webauthn']);
});

test('the same name in another case is one term, classified by its first appearance', () => {
  assert.deepEqual(searchTermsOf('Foo_Bar and foo_bar'), ['foo_bar']);
});

test('through groundRequest: a name that sits beyond the twelfth word now reaches the search', () => {
  // Twelve plain words fill the whole budget on their own, so before this the identifier at the end
  // was never searched and the file that defines it was not a candidate at all.
  const root = mkdtempSync(join(tmpdir(), 'noesar-code-names-'));
  writeFileSync(join(root, 'core.py'), 'def separability_matrix():\n    return 1\n');
  writeFileSync(join(root, 'prose.py'), '# alpha beta gamma\n');
  try {
    const request = 'alpha beta gamma delta epsilon zeta theta kappa lambda sigma omega upsilon and finally separability_matrix';
    const result = groundRequest({ workspaceRoot: root, goal: request, request });
    assert.equal(result.grounding.terms[0], 'separability_matrix');
    assert.ok(result.files.map((f) => f.path).includes('core.py'), 'the file that defines the name is a candidate');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
