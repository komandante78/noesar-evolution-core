// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0654. Phase E of FUNDING/19_WORK_PLAN_TO_BETA.md (WP3): "does a backend ever exceed its
// granted token — for any implementation of the 11-surface contract."
//
// Every case here drives the REAL production `TokenMinter`/`authorizePlan` from
// capability.mjs — nothing about the authority layer is mocked. What is swapped is the
// reasoning provider: `ReferenceReasoningProvider` (the honest, cooperative one) and
// `AdversarialReasoningProvider` (identical except its `constrain()` never refuses anything —
// see fixtures/adversarial-reasoning-provider.mjs for why that is the sharpest available lie).
//
// AUTH-001 is a positive control: without it, every refusal below would pass vacuously against
// a `mint()` that refuses everything. AUTH-002/003/004 are the actual claim: whatever the
// reasoning backend declares or fails to filter, `mint()` independently re-derives the
// workspace-escape check and the step-membership check, and never trusts a provider's own
// bookkeeping to have been honest.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TokenMinter, authorizePlan, CapabilityError } from '../src/capability.mjs';
import { ReferenceReasoningProvider } from '../src/reasoning.mjs';
import { AdversarialReasoningProvider } from '../src/fixtures/adversarial-reasoning-provider.mjs';

const NOW = 1_800_000_000;
const secret = Buffer.alloc(32, 5);

function approvalFor(planExpiry) {
  return { approverId: 'owner-001', grantedAtUnix: NOW, expiresAtUnix: planExpiry + 999999, scopeNote: 'authority conformance' };
}

describe('authority containment holds for any ReasoningProvider implementation — Phase E', () => {
  test('AUTH-001 — positive control: an honest step and a matching request still mint', () => {
    const provider = new ReferenceReasoningProvider('/workspace');
    const step = { id: 'a', description: 's', files: ['src/a.rs'], commands: [], dependsOn: [], blastRadius: provider.blastRadius(['src/a.rs'], false) };
    const plan = provider.buildPlan([step], [], 'safe');
    const authorized = authorizePlan(plan, approvalFor(NOW + 600), NOW);
    const minter = new TokenMinter(secret);
    const token = minter.mint(authorized, { stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1, expiresAtUnix: NOW + 600 }, NOW);
    assert.ok(token.mac, 'the benign case must mint — otherwise every refusal below is vacuous');
  });

  test('AUTH-002 — a workspace-escaping step, honestly declared, unfiltered by an adversarial constrain()', () => {
    const adversary = new AdversarialReasoningProvider('/workspace');
    const honest = new ReferenceReasoningProvider('/workspace');
    // The reference provider's own blastRadius() computes the flag from the files, so it
    // cannot itself be tricked into declaring this dishonestly — it correctly says `true`.
    const blastRadius = honest.blastRadius(['../../etc/passwd'], false);
    assert.equal(blastRadius.reachesOutsideWorkspace, true, 'sanity: the reference helper must flag this path as escaping');
    const step = { id: 'a', description: 's', files: ['../../etc/passwd'], commands: [], dependsOn: [], blastRadius };
    const plan = adversary.buildPlan([step], [], 'safe');
    // A real constrain() would refuse this plan entirely. The adversarial one does not.
    const constrained = adversary.constrain(plan, 'restrictive');
    assert.equal(constrained.refused, false, 'sanity: the adversarial fixture must NOT filter this — that is the point of the fixture');

    const authorized = authorizePlan(constrained.plan, approvalFor(NOW + 600), NOW);
    const minter = new TokenMinter(secret);
    assert.throws(
      () => minter.mint(authorized, { stepId: 'a', paths: ['../../etc/passwd'], operations: ['READ'], uses: 1, expiresAtUnix: NOW + 600 }, NOW),
      CapabilityError,
      'mint() must refuse this independently of the unfiltered plan and the never-refusing constrain()',
    );
  });

  test('AUTH-003 — a workspace-escaping step whose OWN blastRadius flag lies, from a plan the reference helper never built', () => {
    // Not every future ReasoningProvider will route through `blastRadius()` the way this one
    // does. This step is built by hand to be exactly what a buggy or malicious third
    // implementation might emit: files that escape, and a flag that says they do not.
    const adversary = new AdversarialReasoningProvider('/workspace');
    const step = {
      id: 'a', description: 's', files: ['../../etc/passwd'], commands: [], dependsOn: [],
      blastRadius: { paths: ['../../etc/passwd'], reachesOutsideWorkspace: false, destructive: false },
    };
    const plan = adversary.buildPlan([step], [], 'safe');
    const constrained = adversary.constrain(plan, 'restrictive');
    assert.equal(constrained.refused, false);

    const authorized = authorizePlan(constrained.plan, approvalFor(NOW + 600), NOW);
    const minter = new TokenMinter(secret);
    assert.throws(
      () => minter.mint(authorized, { stepId: 'a', paths: ['../../etc/passwd'], operations: ['READ'], uses: 1, expiresAtUnix: NOW + 600 }, NOW),
      CapabilityError,
      'mint() must not trust a declared reachesOutsideWorkspace=false when the path itself escapes',
    );
  });

  test('AUTH-004 — a request naming a path the step never listed, via the adversarial provider\'s own plan', () => {
    const adversary = new AdversarialReasoningProvider('/workspace');
    // blastRadius() is a construction convenience on ReferenceReasoningProvider, not one of
    // the 11 mandatory surfaces — the fixture is not required to expose it, so a plain object
    // is built directly here, the same shape any other implementation would produce.
    const step = { id: 'a', description: 's', files: ['src/a.rs'], commands: [], dependsOn: [], blastRadius: { paths: ['src/a.rs'], reachesOutsideWorkspace: false, destructive: false } };
    const plan = adversary.buildPlan([step], [], 'safe');
    const constrained = adversary.constrain(plan, 'restrictive');

    const authorized = authorizePlan(constrained.plan, approvalFor(NOW + 600), NOW);
    const minter = new TokenMinter(secret);
    assert.throws(
      () => minter.mint(authorized, { stepId: 'a', paths: ['src/a.rs', 'src/secret.rs'], operations: ['READ'], uses: 1, expiresAtUnix: NOW + 600 }, NOW),
      CapabilityError,
      'mint() must refuse a path the approved step never declared, regardless of which provider proposed the plan',
    );
  });

  test('the adversarial fixture genuinely implements the same surfaces as the reference provider — it is not a strawman', () => {
    // If this ever drifted (a surface added to ReferenceReasoningProvider and forgotten here),
    // the fixture would silently stop being "any implementation of the 11-surface contract"
    // and start being a partial stub nobody noticed the shrinkage of.
    const MANDATORY_SURFACES = ['interpret', 'hypothesize', 'plan', 'decompose', 'expect', 'constrain', 'classify', 'confidence', 'evidence', 'cancel', 'fixtures'];
    const adversary = new AdversarialReasoningProvider('/workspace');
    for (const surface of MANDATORY_SURFACES) {
      assert.equal(typeof adversary[surface], 'function', `AdversarialReasoningProvider is missing the mandatory surface \`${surface}\``);
    }
  });
});
