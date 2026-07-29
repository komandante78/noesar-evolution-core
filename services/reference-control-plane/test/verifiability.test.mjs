// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The yardstick has to be shown to work before any number produced with it means anything.
// This project has found defects in its own measurement three times; a criterion that has
// never rejected anything has not been demonstrated to reject.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstViolation, isVerifiable, judgeDecomposition, dependencyIntegrity, leavesWorkspace,
  verificationGroup, Violation, DependencyViolation, MAX_FILES_PER_PART,
} from '../src/verifiability.mjs';

const step = (files, { commands = [], destructive = false, id = 's', dependsOn = [] } = {}) => ({
  id, description: 'd', files, commands, dependsOn,
  blastRadius: { paths: files, reachesOutsideWorkspace: files.some(leavesWorkspace), destructive },
});

test('a single-file, single-command step inside the workspace is verifiable', () => {
  assert.equal(firstViolation(step(['src/a.rs'], { commands: ['cargo test'] })), null);
  assert.equal(isVerifiable(step(['src/a.rs'])), true);
});

// --- each criterion must fire, for its own reason and no other -----------------

test('a step half inside and half outside the workspace is refused as mixed radius', () => {
  assert.equal(firstViolation(step(['src/a.rs', '../outside.rs'])), Violation.MIXED_RADIUS);
  // Entirely outside is NOT mixed: it is one authorisation, and a different rule's problem.
  assert.notEqual(firstViolation(step(['../a.rs', '../b.rs'])), Violation.MIXED_RADIUS);
});

test('a destructive step over more than one file cannot be checkpointed per target', () => {
  assert.equal(
    firstViolation(step(['src/a.rs', 'src/b.rs'], { destructive: true })),
    Violation.DESTRUCTIVE_OVER_MANY_FILES,
  );
  // One destructive target is fine — the rule is about attribution, not about deleting.
  assert.equal(firstViolation(step(['src/a.rs'], { destructive: true })), null);
});

test('files checked by different suites are refused, because passing one says nothing about the other', () => {
  assert.equal(firstViolation(step(['src/a.rs', 'docs/b.md'])), Violation.MULTIPLE_VERIFICATION_GROUPS);
  assert.equal(firstViolation(step(['src/a.rs', 'src/b.rs'])), null);
});

test('two commands in one part make a failure unattributable', () => {
  assert.equal(
    firstViolation(step(['src/a.rs'], { commands: ['cargo test', 'cargo build'] })),
    Violation.UNATTRIBUTABLE_COMMANDS,
  );
});

test('size is the last rule, so it never hides a reason that has an argument behind it', () => {
  const many = Array.from({ length: MAX_FILES_PER_PART + 1 }, (_, i) => `src/f${i}.rs`);
  assert.equal(firstViolation(step(many)), Violation.TOO_MANY_FILES);
  // Both too large AND destructive over many files: the destructive reason must win, because
  // splitting by size would leave the destructive problem inside every part produced.
  assert.equal(firstViolation(step(many, { destructive: true })), Violation.DESTRUCTIVE_OVER_MANY_FILES);
});

test('the group of a path is its top directory, and a root-level file is its own group', () => {
  assert.equal(verificationGroup('src/a.rs'), 'src');
  assert.equal(verificationGroup('./src/a.rs'), 'src');
  assert.equal(verificationGroup('README.md'), '.');
});

// --- the verdict must not be gameable ------------------------------------------

test('a decomposition with one offending part is not settled, however many parts are clean', () => {
  const verdict = judgeDecomposition([
    step(['src/a.rs'], { id: 'p1' }),
    step(['src/b.rs'], { id: 'p2' }),
    step(['src/c.rs', 'docs/d.md'], { id: 'p3' }),
  ]);
  assert.equal(verdict.parts, 3);
  assert.equal(verdict.verifiableParts, 2);
  assert.equal(verdict.allPartsVerifiable, false);
  assert.equal(verdict.settled, false);
  assert.deepEqual(verdict.offending, [{ id: 'p3', violation: Violation.MULTIPLE_VERIFICATION_GROUPS }]);
});

test('returning nothing does not score perfectly', () => {
  // The cheapest way to have no unverifiable part is to return no part at all. If that read
  // as success, the metric would reward a provider for answering less.
  const verdict = judgeDecomposition([]);
  assert.equal(verdict.allPartsVerifiable, false);
  assert.equal(verdict.settled, false);
  assert.equal(verdict.unverifiableParts, 0);
});

test('splitting more does not by itself improve the verdict', () => {
  // Ten unverifiable parts and one unverifiable part are both `false`. The verdict is a
  // boolean precisely so that a provider cannot move it by changing the denominator — the
  // failure that made the projection-coverage number meaningless (D-0215).
  const manyBad = Array.from({ length: 10 }, (_, i) => step([`src/a${i}.rs`, `docs/b${i}.md`], { id: `p${i}` }));
  assert.equal(judgeDecomposition(manyBad).allPartsVerifiable, false);
  assert.equal(judgeDecomposition([manyBad[0]]).allPartsVerifiable, false);
});

// --- dependency integrity: a property of the set, not of one part (D-0217 -> found missing) --

test('a dependency naming a part outside the decomposition is dangling', () => {
  const parts = [step(['src/a.rs'], { id: 'p1', dependsOn: ['p0'] })];
  const violations = dependencyIntegrity(parts);
  assert.deepEqual(violations, [{ id: 'p1', violation: DependencyViolation.DANGLING_DEPENDENCY, dependsOn: 'p0' }]);
});

test('a part depending on itself is a cycle of one', () => {
  const parts = [step(['src/a.rs'], { id: 'p1', dependsOn: ['p1'] })];
  assert.deepEqual(dependencyIntegrity(parts), [{ id: 'p1', violation: DependencyViolation.DEPENDENCY_CYCLE }]);
});

test('two parts depending on each other are both reported, not just the one visited first', () => {
  const parts = [
    step(['src/a.rs'], { id: 'p1', dependsOn: ['p2'] }),
    step(['src/b.rs'], { id: 'p2', dependsOn: ['p1'] }),
  ];
  const ids = dependencyIntegrity(parts).map((v) => v.id).sort();
  assert.deepEqual(ids, ['p1', 'p2']);
});

test('a dangling edge is never misreported as a cycle', () => {
  // p1 -> p2 (missing), p2 does not exist. Walking the dangling edge must not land back on p1.
  const parts = [step(['src/a.rs'], { id: 'p1', dependsOn: ['p2'] })];
  const violations = dependencyIntegrity(parts);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].violation, DependencyViolation.DANGLING_DEPENDENCY);
});

test('a linear chain of resolved dependencies has no violation — the shape A-0019 relies on', () => {
  // p1 carries the file; p2 and p3 are observation-only parts naming p1, exactly A-0019's shape.
  const parts = [
    step(['src/a.rs'], { id: 'p1' }),
    step([], { id: 'p2', commands: ['cargo test'], dependsOn: ['p1'] }),
    step([], { id: 'p3', commands: ['cargo build'], dependsOn: ['p1'] }),
  ];
  assert.deepEqual(dependencyIntegrity(parts), []);
  assert.equal(judgeDecomposition(parts).dependenciesResolve, true);
});

test('an unresolved dependency makes the decomposition unsettled even if every part is otherwise clean', () => {
  const parts = [
    step(['src/a.rs'], { id: 'p1' }),
    step(['src/b.rs'], { id: 'p2', dependsOn: ['missing'] }),
  ];
  const verdict = judgeDecomposition(parts);
  assert.equal(verdict.allPartsVerifiable, true, 'every part alone is verifiable by firstViolation');
  assert.equal(verdict.dependenciesResolve, false);
  assert.equal(verdict.settled, false, 'a broken graph is not a finished decomposition, however clean each part reads alone');
});
