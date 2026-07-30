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
// EXECUTE is not a blanket refusal any more (D-0250) — the caller decides, per installation.
// With no `executeSandbox` argument at all the default is byte-identical to before D-0250:
// this layer has no execution surface, and offering the operation while quietly doing
// nothing would be worse than not offering it. A config that says `enabled:false` is a
// DIFFERENT, more accurate fact (`EXECUTE_DISABLED_BY_OPERATOR`, below). Enabled, the same
// token discipline every other action kind uses applies, and the effect is a real, measured,
// per-capability-limited process (ARCH-008). D-0253 built the identical mirror in
// `rust/crates/noesar-executor` — this is no longer JS-only.

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { compare, contained, COVERAGE_WHOLE, ShadowError } from './shadow.mjs';
import { runSandboxedSync, SandboxError } from './sandbox-runner.mjs';

export const ACTIONS = Object.freeze(['READ', 'WRITE', 'DELETE', 'EXECUTE']);

const OPERATION_OF = Object.freeze({
  READ: 'READ', WRITE: 'WRITE', DELETE: 'DELETE', EXECUTE: 'EXECUTE',
});

export const NO_EXECUTION_SURFACE =
  'this layer has no execution surface: a command cannot be contained here, and pretending to run it would be worse than refusing';

// ARCH-008 / D-0250: the client's decision, not this file's. `execute()`'s default is
// unchanged — call it exactly as every existing caller does, with no `executeSandbox`
// argument, and EXECUTE is `NO_EXECUTION_SURFACE`, byte-identical to before this file
// changed (conformance vector EXEC-007 is untouched by this change on purpose). This reason
// fires only when a caller HAS wired an execute-sandbox config (`execute-sandbox-config.mjs`,
// `NOESAR_EXECUTE_SANDBOX`) and the operator's own answer on THIS installation is "no".
export const EXECUTE_DISABLED_BY_OPERATOR =
  'EXECUTE capability exists on this installation but is disabled by operator configuration (NOESAR_EXECUTE_SANDBOX=disabled)';

export const EXECUTE_TOKEN_WITHOUT_LIMITS =
  'an EXECUTE token without an isolation envelope cannot be run: the sandbox refuses a command under no limits at all';

function tokenFor(tokens, action, planDigest) {
  return tokens.find((token) => token.planDigest === planDigest
    && token.paths.includes(action.path)
    && token.operations.includes(OPERATION_OF[action.kind]));
}

export function execute({
  authorized, minter, tokens, shadow, actions, expectation, tests = [], nowUnix, executeSandbox = null,
}) {
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
    if (action.kind === 'EXECUTE' && !executeSandbox?.enabled) {
      // Default path, unchanged since before D-0250: no config passed at all reports the
      // exact original reason (EXEC-007, byte-identical). A config that WAS passed but says
      // `enabled: false` is a different, more accurate fact — the mechanism exists on this
      // build, an operator chose not to turn it on here — and gets a different reason so the
      // two are never confused by whoever reads the outcome.
      const reason = executeSandbox ? EXECUTE_DISABLED_BY_OPERATOR : NO_EXECUTION_SURFACE;
      outcomes.push({ path:action.path ?? action.command ?? '', operation:'EXECUTE', performed:false,
        reason, tokenId:null });
      continue;
    }
    if (action.kind === 'EXECUTE') {
      // Enabled on this installation: EXECUTE now goes through the SAME token lookup and
      // spend-before-effect discipline as every other action kind (`tokenFor`/`minter.spend`
      // below are the identical calls READ/WRITE/DELETE make), then the effect is a real,
      // measured, contained process instead of a file operation.
      const token = tokenFor(tokens ?? [], action, authorized.digest);
      if (!token) {
        outcomes.push({ path:action.path, operation:'EXECUTE', performed:false,
          reason:'no capability token of this plan grants this path and operation', tokenId:null });
        continue;
      }
      try {
        minter.spend(token, { path:action.path, operation:'EXECUTE' }, nowUnix);
      } catch (error) {
        outcomes.push({ path:action.path, operation:'EXECUTE', performed:false,
          reason:error.reason ?? String(error), tokenId:token.id });
        continue;
      }
      // Belt and braces: `capability.mjs`'s mint() already refuses an EXECUTE request with
      // no limits on any installation whose minter carries a ceiling (ARCH-008, D-0248). A
      // token reaching here with none anyway — a different minter, an older token format —
      // is refused rather than run with the whole container's limits, which is exactly the
      // per-container isolation this mechanism exists to replace.
      if (!token.limits) {
        outcomes.push({ path:action.path, operation:'EXECUTE', performed:false,
          reason:EXECUTE_TOKEN_WITHOUT_LIMITS, tokenId:token.id });
        continue;
      }
      let cwd;
      try {
        // The same containment rule every other action kind uses, not a second one: EXECUTE
        // runs with its working directory confined to the shadow, exactly like WRITE/DELETE
        // confine the file they touch.
        cwd = contained(shadow.root, action.path);
      } catch (error) {
        outcomes.push({ path:action.path, operation:'EXECUTE', performed:false,
          reason:error.reason ?? String(error), tokenId:token.id });
        continue;
      }
      let sandboxResult;
      try {
        sandboxResult = runSandboxedSync({
          binaryPath: executeSandbox.binaryPath, limits: token.limits,
          command: action.command, argv: action.args ?? [], cwd,
          timeoutMs: action.timeoutMs, maxOutputBytes: action.maxOutputBytes,
        });
      } catch (error) {
        const reason = error instanceof SandboxError ? error.reason : String(error.message ?? error);
        outcomes.push({ path:action.path, operation:'EXECUTE', performed:false, reason, tokenId:token.id });
        continue;
      }
      outcomes.push({
        path:action.path, operation:'EXECUTE', performed:sandboxResult.performed,
        reason: sandboxResult.performed ? null : (sandboxResult.reason ?? 'the sandbox refused this run'),
        tokenId:token.id,
        exitCode: sandboxResult.exitCode ?? null,
        stdout: sandboxResult.stdout ?? '',
        stderr: sandboxResult.stderr ?? '',
      });
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

export function executorStatus(executeSandbox = null) {
  // D-0250: this used to say "there is no sandbox here that could contain a running
  // process" unconditionally. That stopped being true the moment noesar-sandbox shipped
  // (D-0248/D-0249) — reporting it anyway would be exactly the fabricated-guarantee failure
  // mode this project exists to avoid. What is still true, and stated plainly either way: on
  // THIS installation, is the operator's own answer to NOESAR_EXECUTE_SANDBOX enabled or not.
  const enabled = Boolean(executeSandbox?.enabled);
  return {
    acceptsOnlyCapabilityTokens: true,
    spendsBeforeEffect: true,
    executionSurface: enabled,
    refusedOperations: enabled ? [] : ['EXECUTE'],
    writesOutsideShadow: false,
    requiresWholeWorkspaceShadow: true,
    executeSandboxEnabled: enabled,
    executeSandboxRequested: Boolean(executeSandbox?.requested),
    reason: enabled
      ? 'Every action must present a token of the approved plan that names its path and operation; the token is spent before the effect, so a refusal means nothing happened. EXECUTE is enabled on this installation (NOESAR_EXECUTE_SANDBOX=enabled): a granted token is run inside a short-lived, per-capability-limited child process (ARCH-008), never with the whole container\'s limits, and never without a spent token naming it. A shadow that holds only the declared paths is refused: it cannot observe an undeclared write, so a clean comparison from it would be an artefact of how it was built.'
      : 'Every action must present a token of the approved plan that names its path and operation; the token is spent before the effect, so a refusal means nothing happened. EXECUTE exists as a mechanism (ARCH-008) but is disabled on this installation — the operator has not set NOESAR_EXECUTE_SANDBOX=enabled, or the sandbox binary is not present. A shadow that holds only the declared paths is refused: it cannot observe an undeclared write, so a clean comparison from it would be an artefact of how it was built.',
  };
}
