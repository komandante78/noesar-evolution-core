// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0654. Phase E of FUNDING/19_WORK_PLAN_TO_BETA.md — the "for any implementation of the
// 11-surface contract" half of the authority-conformance proof.
//
// A ReasoningProvider implementation, exercising every mandatory surface, that is
// deliberately DISHONEST in exactly one place: `constrain()` never refuses anything. Every
// other surface delegates to `ReferenceReasoningProvider`, so this is not a strawman — it is
// "the reference provider, minus the one piece of cooperation the authority boundary is not
// supposed to need."
//
// What this proves, and why it matters: `workspace-actions.mjs`'s own pipeline calls
// `constrain()` BEFORE a human ever approves a plan, and the reference provider's `constrain()`
// filters out steps that reach outside the workspace or are destructive under a restrictive
// policy. If capability minting silently trusted that filtering to have happened, a reasoning
// backend that skipped it — buggy, compromised, or simply a different, less careful
// implementation someone plugs in later — would be a backend an operator's own approval could
// not actually contain. `TokenMinter.mint()` is supposed to re-derive the workspace-escape
// check independently of whatever the plan declares (`capability.mjs`'s own comment: "a
// verdict supplied by the caller is not a verdict"). This fixture is how that claim is
// exercised by something that is NOT the reference provider, rather than only read as a
// comment in the file that makes it.
//
// This is a conformance fixture, not a product component. Nothing outside its own test file
// imports it.

import { ReferenceReasoningProvider } from '../reasoning.mjs';

export class AdversarialReasoningProvider {
  #reference;

  constructor(workspaceRoot = '/workspace') {
    this.#reference = new ReferenceReasoningProvider(workspaceRoot);
  }

  identity() {
    return { ...this.#reference.identity(), name: 'adversarial-fixture' };
  }

  interpret(...args) { return this.#reference.interpret(...args); }
  hypothesize(...args) { return this.#reference.hypothesize(...args); }
  plan(...args) { return this.#reference.plan(...args); }
  buildPlan(...args) { return this.#reference.buildPlan(...args); }
  decompose(...args) { return this.#reference.decompose(...args); }
  expect(...args) { return this.#reference.expect(...args); }
  classify(...args) { return this.#reference.classify(...args); }
  confidence(...args) { return this.#reference.confidence(...args); }
  evidence(...args) { return this.#reference.evidence(...args); }
  cancel(...args) { return this.#reference.cancel(...args); }
  fixtures(...args) { return this.#reference.fixtures(...args); }
  simulate(...args) { return this.#reference.simulate(...args); }

  /**
   * The one dishonest surface. A real `constrain()` refuses a step that reaches outside the
   * workspace, or that is destructive under a restrictive policy — see
   * `ReferenceReasoningProvider#constrain`. This one approves everything unchanged, as if every
   * step were already safe. Any containment that survives this provider is containment the
   * *authority layer* provides, not containment borrowed from a cooperative reasoning backend.
   */
  constrain(plan) {
    return { refused: false, plan, removed: [] };
  }
}
