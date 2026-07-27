// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs conformance/reasoning-vectors.json through the Node reference provider.
// The Rust reference provider runs the same file. Neither is the oracle for the other:
// the file is, and a change that suits one implementation fails the other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ReferenceReasoningProvider, ReasoningRefused, reasoningStatus,
  REASONING_CONTRACT_VERSION, MANDATORY_SURFACES, NO_MODEL_REASON,
} from '../src/reasoning.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vectors = JSON.parse(
  readFileSync(resolve(root, 'conformance/reasoning-vectors.json'), 'utf8'),
);
const provider = new ReferenceReasoningProvider(vectors.workspaceRoot);

function planFrom(steps) {
  return provider.buildPlan(steps.map((step) => ({
    id: step.id,
    description: step.id,
    files: step.files,
    commands: step.commands,
    dependsOn: step.dependsOn ?? [],
    blastRadius: provider.blastRadius(step.files, step.destructive),
  })));
}

function refusedBy(fn) {
  try {
    fn();
    return false;
  } catch (error) {
    assert.ok(error instanceof ReasoningRefused, `expected a refusal, got ${error}`);
    return true;
  }
}

test('the vectors and the contract agree on what is mandatory', () => {
  assert.equal(vectors.contractVersion, REASONING_CONTRACT_VERSION);
  assert.equal(MANDATORY_SURFACES.length, 11);
  assert.ok(!MANDATORY_SURFACES.includes('simulate'));
});

for (const vector of vectors.interpret) {
  test(`interpret ${vector.id}`, () => {
    if (vector.expected.refused) {
      assert.ok(refusedBy(() => provider.interpret(vector.request)));
      return;
    }
    const intent = provider.interpret(vector.request);
    assert.equal(intent.goal, vector.expected.goal);
    assert.equal(intent.ambiguities.length, vector.expected.ambiguityCount);
    assert.equal(intent.successCriteria.length, vector.expected.successCriteriaCount);
  });
}

for (const vector of vectors.hypothesize) {
  test(`hypothesize ${vector.id}`, () => {
    const hypotheses = provider.hypothesize({ goal: vector.goal }, []);
    assert.equal(hypotheses.length, vector.expected.count);
    assert.equal(hypotheses[0].contrary, vector.expected.contrary);
    assert.equal(hypotheses[0].supporting.length, vector.expected.supportingCount);
  });
}

for (const vector of vectors.classify) {
  test(`classify ${vector.id}`, () => {
    const assessment = provider.classify(planFrom(vector.steps));
    assert.equal(assessment.overall, vector.expected.overall);
    assert.deepEqual(assessment.perStep.map(([, risk]) => risk), vector.expected.perStep);
  });
}

for (const vector of vectors.constrain) {
  test(`constrain ${vector.id}`, () => {
    const result = provider.constrain(planFrom(vector.steps), vector.policy);
    assert.equal(result.refused, vector.expected.refused);
    if (!vector.expected.refused) {
      assert.deepEqual(result.plan.steps.map((step) => step.id), vector.expected.keptIds);
      assert.deepEqual(result.removed, vector.expected.removedIds);
    }
  });
}

for (const vector of vectors.decompose) {
  test(`decompose ${vector.id}`, () => {
    const step = {
      id: vector.step.id,
      description: vector.step.id,
      files: vector.step.files,
      commands: vector.step.commands,
      dependsOn: [],
      blastRadius: provider.blastRadius(vector.step.files, vector.step.destructive),
    };
    const result = provider.decompose(step);
    assert.equal(result.split, vector.expected.split);
    if (vector.expected.split) assert.equal(result.steps.length, vector.expected.parts);
  });
}

for (const vector of vectors.expect) {
  test(`expect ${vector.id}`, () => {
    const plan = planFrom(vector.steps);
    if (vector.expected.refused) {
      assert.ok(refusedBy(() => provider.expect(plan)));
      return;
    }
    const expectation = provider.expect(plan);
    assert.deepEqual(expectation.pathsTheDiffMustTouch, vector.expected.paths);
    assert.deepEqual(expectation.testsExpectedToPass, vector.expected.testsExpectedToPass);
  });
}

for (const vector of vectors.confidence) {
  test(`confidence ${vector.id}`, () => {
    const confidence = provider.confidence(planFrom(vector.steps), vector.results);
    assert.equal(confidence.reasonsNotHigher.length, vector.expected.reasonCount);
    assert.ok(confidence.value <= vector.expected.maximum,
      `a provider with no model must not approach certainty, got ${confidence.value}`);
    assert.ok(confidence.value > 0);
    assert.ok(confidence.reasonsNotHigher.includes(NO_MODEL_REASON));
  });
}

for (const vector of vectors.evidence) {
  test(`evidence ${vector.id}`, () => {
    if (vector.expected.refused) {
      assert.ok(refusedBy(() => provider.evidence(vector.claim)));
      return;
    }
    assert.equal(provider.evidence(vector.claim).kind, vector.expected.kind);
  });
}

test('the same session always produces the same replay pack', () => {
  const first = provider.fixtures('session-7');
  assert.equal(first.digest, provider.fixtures('session-7').digest);
  assert.notEqual(first.digest, provider.fixtures('session-8').digest);
  assert.ok(refusedBy(() => provider.fixtures(' ')));
});

test('a dependency on a later or missing step is refused', () => {
  assert.ok(refusedBy(() => planFrom([
    { id: 'a', files: [], commands: [], destructive: false, dependsOn: ['b'] },
    { id: 'b', files: [], commands: [], destructive: false },
  ])));
});

test('the status says the core does not require ATOM, and does not imply it by silence', () => {
  const status = reasoningStatus({});
  assert.equal(status.mode, 'reference-node');
  assert.equal(status.atomRequired, false);
  assert.equal(status.rustCandidateCompiled, false);
  assert.equal(status.simulationSupported, false);
  assert.equal(status.mandatorySurfaces.length, 11);
});
