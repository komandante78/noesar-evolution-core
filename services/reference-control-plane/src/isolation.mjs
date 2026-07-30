// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-capability isolation limits (ARCH-008), control-plane side. Mirrors
// rust/crates/noesar-sandbox.
//
// The criterion is that a capability runs with the limits written in *its own token*, not with
// the limits of the whole container. Two halves make that true, and this file is the first:
//
//   1. the limits travel inside the token, under its MAC, so nobody between minting and
//      spending can widen them (this file, plus `capability.mjs`);
//   2. a short-lived child process applies them before it becomes the command
//      (`rust/crates/noesar-sandbox`, measured: a child held to 64 MiB inside a container
//      allowed 8 GiB, with the hard limit lowered too so the child cannot raise it back).
//
// WHY A LADDER RATHER THAN A REQUIREMENT. `D-0246` probed the three mechanisms named by
// `MASTER_PROJECT/03_ARCHITETTURA.md` §7 and found two absent on a real host: no Landlock in
// the kernel, no writable cgroup subtree from the container runtime. Under `CLAUDE10.md` §16
// that is not a blocker and not a question for the Owner — this product is installed on
// arbitrary hosts and never owns the one it runs on. So the strongest available mechanism is
// detected at runtime and the level is *declared per installation*, on a floor that needs
// nothing but POSIX: `setrlimit` is per-process, needs no kernel option, no delegation and no
// privilege to lower a limit. It works precisely where the other three do not.

export class IsolationError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'IsolationError';
    this.kind = kind;
    this.reason = reason;
  }
}

const invalid = (reason) => { throw new IsolationError('INVALID', reason); };
const outOfScope = (reason) => { throw new IsolationError('OUT_OF_SCOPE', reason); };

/// Fixed order. The MAC feeds limits through `canonicalLimits`, and the Rust minter feeds the
/// identical string, so this order is part of the wire contract between the two
/// implementations — not a presentation detail. Reordering it invalidates every token.
export const LIMIT_DIMENSIONS = Object.freeze([
  'memoryBytes',
  'cpuSeconds',
  'openFiles',
  'processes',
  'fileSizeBytes',
  'coreDumpBytes',
]);

export const ISOLATION_TIERS = Object.freeze([
  Object.freeze({ tier: 0, name: 'POSIX_RLIMIT', requires: 'setrlimit + PR_SET_NO_NEW_PRIVS', everywhere: true }),
  Object.freeze({ tier: 1, name: 'SECCOMP_FILTER', requires: 'Linux CONFIG_SECCOMP_FILTER', everywhere: false }),
  Object.freeze({ tier: 2, name: 'LANDLOCK', requires: 'Linux CONFIG_SECURITY_LANDLOCK', everywhere: false }),
  Object.freeze({ tier: 3, name: 'CGROUP_V2', requires: 'a delegated writable cgroup v2 subtree', everywhere: false }),
]);

/// Validate a limits object and return a frozen, normalised copy.
///
/// Every dimension is an integer count of bytes or seconds. Rejecting floats, strings and
/// negatives rather than coercing: `"64"`, `64.5` and `-1` all mean the caller built this by
/// hand, and guessing the intent of a *limit* is how one ends up larger than meant. `null` and
/// absence both mean "not constrained by this token" — inherited from the container, which is
/// not the same as unlimited (see `exceedsCeiling`).
export function parseLimits(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    invalid('limits must be an object naming byte and second counts');
  }
  for (const key of Object.keys(raw)) {
    if (!LIMIT_DIMENSIONS.includes(key)) invalid(`unknown limit \`${key}\``);
  }
  const limits = {};
  for (const dimension of LIMIT_DIMENSIONS) {
    const value = raw[dimension];
    if (value === undefined || value === null) { limits[dimension] = null; continue; }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      invalid(`limit \`${dimension}\` must be a non-negative integer, got \`${String(value)}\``);
    }
    // Beyond 2^53 an integer stops being exactly representable here while the kernel would
    // still accept it, so the limit applied could differ from the limit audited.
    if (!Number.isSafeInteger(value)) invalid(`limit \`${dimension}\` exceeds the exactly representable range`);
    limits[dimension] = value;
  }
  if (LIMIT_DIMENSIONS.every((dimension) => limits[dimension] === null)) {
    invalid('a limits object constraining no dimension confines nothing');
  }
  return Object.freeze(limits);
}

/// The canonical string the MAC covers. Identical on both sides — see `LIMIT_DIMENSIONS`.
/// `-` for an unconstrained dimension so that "unset" and "zero" can never collide: `0` is a
/// real and very restrictive limit (`coreDumpBytes: 0` forbids core dumps).
export function canonicalLimits(limits) {
  if (!limits) return 'none';
  return LIMIT_DIMENSIONS
    .map((dimension) => `${dimension}=${limits[dimension] === null ? '-' : limits[dimension]}`)
    .join(';');
}

/// The **container-ceiling** relation: names the first dimension set above what the host
/// itself allows, or `null` when acceptable. A dimension left unset is inherited from the
/// container, so it is not a violation.
///
/// Distinct from `withinGrant` on purpose. Conflating the two was a real defect in the Rust
/// crate, caught by running it: a valid 64 MiB spec was refused against an 8 GiB container
/// because the container reported `openFiles` and `processes` and the spec named neither.
export function exceedsCeiling(limits, ceiling) {
  if (!limits || !ceiling) return null;
  for (const dimension of LIMIT_DIMENSIONS) {
    const mine = limits[dimension];
    const cap = ceiling[dimension];
    if (mine !== null && mine !== undefined && cap !== null && cap !== undefined && mine > cap) {
      return dimension;
    }
  }
  return null;
}

/// The **granted-scope** relation: does a token stay inside limits an approval granted? Here an
/// unset dimension *is* unlimited and therefore never satisfies a set grant — asking for "no
/// cap on processes" when the grant caps them is widening, which is the whole attack.
export function withinGrant(limits, grant) {
  if (!grant) return true;
  if (!limits) return LIMIT_DIMENSIONS.every((dimension) => grant[dimension] === null || grant[dimension] === undefined);
  for (const dimension of LIMIT_DIMENSIONS) {
    const cap = grant[dimension];
    if (cap === null || cap === undefined) continue;
    const mine = limits[dimension];
    if (mine === null || mine === undefined) return false;
    if (mine > cap) return false;
  }
  return true;
}

/// Refuse a limits object that is technically valid but operationally useless. A capability that
/// may allocate 4 KiB cannot run anything, and a sandbox that always fails is indistinguishable
/// from a broken one — which is how a real guarantee gets switched off "temporarily".
const FLOOR = Object.freeze({ memoryBytes: 1024 * 1024, cpuSeconds: 1, openFiles: 8, processes: 1 });

export function assertUsable(limits) {
  if (!limits) return;
  for (const [dimension, floor] of Object.entries(FLOOR)) {
    const value = limits[dimension];
    if (value !== null && value !== undefined && value < floor) {
      outOfScope(`limit \`${dimension}\`=${value} is below the usable floor of ${floor}: a capability that cannot run is not a capability`);
    }
  }
}

/// What this installation can actually enforce, for declaration rather than assumption.
///
/// `support` and `ceiling` come from `noesar-sandbox --detect` when the binary is present. When
/// it is absent this reports `enforcementAvailable: false` and says so — it does not fall back
/// to claiming tier 0 on the strength of the platform being POSIX. A tier nothing measured is
/// the kind of claim this project treats as a defect.
export function isolationStatus({ detected = null, sandboxBinary = null } = {}) {
  const tier = detected?.tier ?? null;
  return {
    limitsTravelInsideTheToken: true,
    limitsCoveredByTokenMac: true,
    dimensions: [...LIMIT_DIMENSIONS],
    tiers: ISOLATION_TIERS.map((entry) => ({ ...entry })),
    enforcementAvailable: Boolean(detected),
    sandboxBinary,
    tier,
    tierName: detected?.tierName ?? null,
    support: detected?.support ?? null,
    containerCeiling: detected?.containerCeiling ?? null,
    blockedSyscalls: detected?.deniedSyscalls ?? null,
    // Stated plainly because it is the honest boundary of this phase.
    spentThroughSandbox: false,
    reason: detected
      ? `Limits are carried inside the capability token and covered by its MAC, so they cannot be widened between minting and spending. Enforcement runs in a short-lived child process that applies them before becoming the command: tier ${tier} (${detected.tierName}) on this installation. The POSIX floor (setrlimit with the hard limit lowered too, plus PR_SET_NO_NEW_PRIVS) needs no kernel option and no cgroup delegation, so it holds on hosts where Landlock and cgroup v2 are unavailable — measured absent on the development host and handled rather than treated as a blocker. No product surface spends a token through the sandbox yet: EXECUTE remains refused by the executor, and wiring it is named future work, not claimed here.`
      : 'Limits are carried inside the capability token and covered by its MAC. The sandbox binary that enforces them was not found on this installation, so no isolation tier is claimed: enforcement is unavailable and reported as such rather than assumed from the platform.',
  };
}
