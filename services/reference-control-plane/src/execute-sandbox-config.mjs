// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-008, the client's decision point. `D-0249` shipped a real sandbox mechanism and left
// EXECUTE refused because its "permanently refused" was a stated cross-language security
// contract, not an incidental gap — reversing it was never the Owner's alone to decide on
// this one installation's behalf, because NOESAR EVOLUTION is installed by other people on
// their own hosts (`CLAUDE10.md` §16, the platform law). This module is where that decision
// lives: one environment variable, read per installation, defaulting to the safe answer.
//
// Same pattern as `NOESAR_LOCAL_MODEL_RUNTIME` in local-model-runtime.mjs, deliberately: a
// second config idiom for "an operator must opt in to a capability that can run a process"
// would be a second thing to audit for the same property. `disabled` wins over anything else
// — a client who has not explicitly written `enabled` gets today's behaviour, unchanged.

import { accessSync, constants } from 'node:fs';

export const DEFAULT_EXECUTE_SANDBOX_BINARY = '/opt/noesar/bin/noesar-sandbox';

/// Resolve what this installation has decided, from its own environment. Never throws: an
/// installation that mistyped the env var or never set it gets `disabled`, not a crash.
///
/// `enabled` is true only when BOTH the operator asked for it AND the binary the decision
/// depends on is actually present and executable — asking for a capability that then silently
/// no-ops would be worse than asking and being told it is not available yet. `binaryChecked`
/// records which path was probed, so a misconfigured installation can be diagnosed instead of
/// silently falling back.
export function resolveExecuteSandboxConfig(env = process.env) {
  const requested = String(env.NOESAR_EXECUTE_SANDBOX ?? 'disabled').toLowerCase() === 'enabled';
  const binaryPath = String(env.NOESAR_EXECUTE_SANDBOX_BINARY ?? DEFAULT_EXECUTE_SANDBOX_BINARY);

  if (!requested) {
    return Object.freeze({ enabled: false, requested: false, binaryPath, binaryPresent: null });
  }

  let binaryPresent = false;
  try {
    accessSync(binaryPath, constants.X_OK);
    binaryPresent = true;
  } catch { binaryPresent = false; }

  return Object.freeze({ enabled: requested && binaryPresent, requested, binaryPath, binaryPresent });
}
