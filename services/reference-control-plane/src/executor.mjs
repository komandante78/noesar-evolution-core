// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The executor that accepts nothing but a capability token. Mirrors
// rust/crates/noesar-executor.
//
// F4-014, closed: like reasoning, capability, shadow and events, this step now has a shared
// oracle — `conformance/executor-vectors.json`, run natively by both this file (test/
// executor-vectors.test.mjs) and rust/crates/noesar-executor (tests/conformance.rs). Unlike
// the other four, `execute()` has real side effects (a signed token minter, real files, a
// real shadow), so a vector describes a scenario each side builds natively rather than pure
// input/output data. Building it surfaced one real divergence: this file used to throw a
// Node-only `'COVERAGE'` error kind that `noesar-shadow`'s Rust `ShadowError` enum has no
// equivalent for; both sides now report `'INVALID'` for the same refusal.
//
// This is the step that closes the circle: an approved plan mints tokens, the executor may
// only act by spending one, everything it does lands in a shadow, and the shadow is compared
// against what the plan declared.
//
// The order is the security property: the token is spent BEFORE the effect, never after. If
// spending is refused the effect never happens; if the effect happened first, a refusal would
// be a report about damage already done.
//
// EXECUTE is a declared, permanently refused operation. This layer has no execution surface,
// and offering the operation while quietly doing nothing would be worse than not offering it.

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { compare, contained, COVERAGE_WHOLE, ShadowError } from './shadow.mjs';

export const ACTIONS = Object.freeze(['READ', 'WRITE', 'DELETE', 'EXECUTE']);

const OPERATION_OF = Object.freeze({
  READ: 'READ', WRITE: 'WRITE', DELETE: 'DELETE', EXECUTE: 'EXECUTE',
});

export const NO_EXECUTION_SURFACE =
  'this layer has no execution surface: a command cannot be contained here, and pretending to run it would be worse than refusing';

function tokenFor(tokens, action, planDigest) {
  return tokens.find((token) => token.planDigest === planDigest
    && token.paths.includes(action.path)
    && token.operations.includes(OPERATION_OF[action.kind]));
}

export function execute({ authorized, minter, tokens, shadow, actions, expectation, tests = [], nowUnix }) {
  // A shadow holding only the paths the plan named cannot ever report that a file nobody
  // declared was touched: `unexpected` would be empty because there was nothing else there
  // to observe, not because nothing else happened. Refused here rather than run to a result
  // that would claim a guarantee decided by whoever built the shadow.
  //
  // F4-014: this used to throw kind 'COVERAGE', a discriminant that exists only on this
  // side — noesar-shadow's Rust ShadowError enum has no Coverage variant and the Rust
  // executor reports the identical refusal as Invalid. Building the shared oracle surfaced
  // the mismatch; matching Rust's existing behaviour here is the smaller, safer fix (one
  // string, no new Rust enum variant to thread through every match arm and Display impl).
  if (shadow?.coverage !== COVERAGE_WHOLE) {
    throw new ShadowError('INVALID',
      'the executor requires a whole-workspace shadow: one holding only the declared paths cannot observe an undeclared write, and a clean comparison from it would be an artefact of its own construction');
  }
  const outcomes = [];

  for (const action of actions ?? []) {
    if (action.kind === 'EXECUTE') {
      outcomes.push({ path:action.command ?? '', operation:'EXECUTE', performed:false,
        reason:NO_EXECUTION_SURFACE, tokenId:null });
      continue;
    }
    if (!ACTIONS.includes(action.kind)) {
      outcomes.push({ path:action.path ?? '', operation:action.kind, performed:false,
        reason:`unknown action \`${action.kind}\``, tokenId:null });
      continue;
    }

    // A token bound to a different plan is not a token for this run. Checked before the
    // spend, because spending it would consume a use of somebody else's grant.
    const token = tokenFor(tokens ?? [], action, authorized.digest);
    if (!token) {
      outcomes.push({ path:action.path, operation:OPERATION_OF[action.kind], performed:false,
        reason:'no capability token of this plan grants this path and operation', tokenId:null });
      continue;
    }

    // Spent BEFORE the effect. A refusal here must mean nothing happened.
    try {
      minter.spend(token, { path:action.path, operation:OPERATION_OF[action.kind] }, nowUnix);
    } catch (error) {
      outcomes.push({ path:action.path, operation:OPERATION_OF[action.kind], performed:false,
        reason:error.reason ?? String(error), tokenId:token.id });
      continue;
    }

    let resolved;
    try {
      // Containment is the shadow's own rule, used here rather than reimplemented: two
      // implementations of one rule is how the two stop agreeing.
      resolved = contained(shadow.root, action.path);
    } catch (error) {
      outcomes.push({ path:action.path, operation:OPERATION_OF[action.kind], performed:false,
        reason:error.reason ?? String(error), tokenId:token.id });
      continue;
    }

    try {
      if (action.kind === 'READ') readFileSync(resolved);
      else if (action.kind === 'WRITE') {
        mkdirSync(dirname(resolved), { recursive:true });
        writeFileSync(resolved, String(action.contents ?? ''));
      } else if (action.kind === 'DELETE') {
        if (!existsSync(resolved)) throw new Error('no such file');
        rmSync(resolved);
      }
      outcomes.push({ path:action.path, operation:OPERATION_OF[action.kind], performed:true,
        reason:null, tokenId:token.id });
    } catch (error) {
      outcomes.push({ path:action.path, operation:OPERATION_OF[action.kind], performed:false,
        reason:String(error.message ?? error), tokenId:token.id });
    }
  }

  const observation = shadow.observe(tests);
  let surprise = null;
  let comparisonRefused = null;
  try {
    surprise = compare(expectation, observation);
  } catch (error) {
    if (!(error instanceof ShadowError)) throw error;
    comparisonRefused = error.reason;
  }

  const performed = outcomes.filter((outcome) => outcome.performed).length;
  return {
    planDigest: authorized.digest,
    outcomes,
    performed,
    refused: outcomes.length - performed,
    observation,
    surprise,
    comparisonRefused,
    // True only when every action was performed AND the comparison ran AND it was clean.
    // A run whose comparison could not happen is never ok.
    ok: outcomes.length - performed === 0 && surprise !== null && surprise.clean === true,
  };
}

export function executorStatus() {
  return {
    acceptsOnlyCapabilityTokens: true,
    spendsBeforeEffect: true,
    executionSurface: false,
    refusedOperations: ['EXECUTE'],
    writesOutsideShadow: false,
    requiresWholeWorkspaceShadow: true,
    reason: 'Every action must present a token of the approved plan that names its path and operation; the token is spent before the effect, so a refusal means nothing happened. EXECUTE is declared and always refused: there is no sandbox here that could contain a running process. A shadow that holds only the declared paths is refused: it cannot observe an undeclared write, so a clean comparison from it would be an artefact of how it was built.',
  };
}
