// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reference adapter: proves this repository's OWN production JS engine
// (services/reference-control-plane/src/capability.mjs) conforms to
// @noesar/authority-containment's SPEC.md. Nothing here is mocked — `authorizePlan` and
// `TokenMinter` are the exact exports the running product imports.
//
// A third party wiring its own engine to this package's `runConformance()` would write an
// equivalent file: translate a vector's `steps`/`request` into whatever shape their own plan
// and mint function expect, and translate their own refusal into `{ minted: false, kind }`.

import { authorizePlan, TokenMinter, CapabilityError } from
  '../../../services/reference-control-plane/src/capability.mjs';

// Fixed, non-secret: this adapter never signs anything a caller relies on, it only observes
// whether mint() throws. Any secret >= 32 bytes would do.
const SECRET = Buffer.alloc(32, 9);

function planFrom(steps) {
  return {
    steps: steps.map((step) => ({
      id: step.id,
      description: step.id,
      files: step.files,
      commands: [],
      dependsOn: [],
      blastRadius: {
        paths: step.files,
        reachesOutsideWorkspace: Boolean(step.outside),
        destructive: Boolean(step.destructive),
      },
    })),
    constraints: [],
    mode: 'safe',
  };
}

/** @type {import('../conformance/index.mjs').attempt} */
export function attempt({ steps, request }, { nowUnix, approval }) {
  try {
    const authorized = authorizePlan(planFrom(steps), approval, nowUnix);
    const minter = new TokenMinter(SECRET);
    minter.mint(authorized, request, nowUnix);
    return { minted: true };
  } catch (error) {
    if (error instanceof CapabilityError) {
      return { minted: false, kind: error.kind };
    }
    throw error;
  }
}
