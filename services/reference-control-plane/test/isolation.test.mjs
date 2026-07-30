// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-008: per-capability isolation limits. Two properties are under test here, and the
// second one is the security property:
//
//   1. a limits object is validated, not coerced;
//   2. the limits live inside the token's MAC, so widening them in transit is detected.
//
// The second is tested by tampering and watching the spend refuse — an oracle that has never
// failed has not been shown to work.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  ISOLATION_TIERS, IsolationError, LIMIT_DIMENSIONS, assertUsable, canonicalLimits,
  exceedsCeiling, isolationStatus, parseLimits, withinGrant,
} from '../src/isolation.mjs';
import { TokenMinter, authorizePlan } from '../src/capability.mjs';

const NOW = 1_800_000_000;

function plan(limits = null) {
  return {
    id: 'p1', mode: 'apply', constraints: [],
    steps: [{
      id: 'a', description: 'write a file', files: ['src/a.rs'], commands: [], dependencies: [],
      blastRadius: { destructive: false, reachesOutsideWorkspace: false, ...(limits ? { limits } : {}) },
    }],
  };
}

function authorised(limits = null) {
  return authorizePlan(plan(limits), {
    approverId: 'owner', grantedAtUnix: NOW - 10, expiresAtUnix: NOW + 3600, scope: 'p1',
  }, NOW);
}

// --- validation -------------------------------------------------------------------------------

test('parseLimits accepts a partial object and normalises the rest to null', () => {
  const limits = parseLimits({ memoryBytes: 64 * 1024 * 1024, cpuSeconds: 5 });
  assert.equal(limits.memoryBytes, 67108864);
  assert.equal(limits.cpuSeconds, 5);
  assert.equal(limits.openFiles, null);
  assert.equal(Object.isFrozen(limits), true);
});

test('parseLimits treats absent and null alike, and both differ from zero', () => {
  // 0 is a real, very restrictive limit: coreDumpBytes 0 forbids core dumps entirely. If
  // "unset" and 0 collapsed together, forbidding core dumps would read as not asking.
  assert.equal(parseLimits({ coreDumpBytes: 0 }).coreDumpBytes, 0);
  assert.equal(parseLimits({ coreDumpBytes: null, memoryBytes: 1 }).coreDumpBytes, null);
  assert.notEqual(canonicalLimits(parseLimits({ coreDumpBytes: 0 })),
    canonicalLimits(parseLimits({ coreDumpBytes: null, memoryBytes: 1 })));
});

test('parseLimits refuses a non-integer, negative, string or unsafe limit', () => {
  for (const bad of [{ memoryBytes: 1.5 }, { memoryBytes: -1 }, { memoryBytes: '64' },
    { memoryBytes: Number.MAX_SAFE_INTEGER + 2 }, { memoryBytes: NaN }]) {
    assert.throws(() => parseLimits(bad), IsolationError, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('parseLimits refuses an unknown dimension rather than ignoring it', () => {
  // Dropping it silently would apply less isolation than the caller asked for.
  assert.throws(() => parseLimits({ memoryBytez: 1 }), /unknown limit/);
});

test('parseLimits refuses an object that constrains nothing', () => {
  assert.throws(() => parseLimits({}), /confines nothing/);
  assert.throws(() => parseLimits({ memoryBytes: null }), /confines nothing/);
});

test('parseLimits refuses an array or a scalar', () => {
  assert.throws(() => parseLimits([1]), IsolationError);
  assert.throws(() => parseLimits(64), IsolationError);
});

test('null limits stay null — not every capability names an envelope', () => {
  assert.equal(parseLimits(null), null);
  assert.equal(parseLimits(undefined), null);
});

// --- the two relations, which are not the same question ---------------------------------------

test('exceedsCeiling ignores dimensions the token leaves to the container', () => {
  // The real defect this pair was split over: a container reports openFiles and processes, an
  // ordinary token names neither, and that must not be a refusal.
  const ceiling = parseLimits({ memoryBytes: 8589934592, openFiles: 40960, processes: 127784, coreDumpBytes: 0 });
  const limits = parseLimits({ memoryBytes: 67108864, cpuSeconds: 10 });
  assert.equal(exceedsCeiling(limits, ceiling), null);
});

test('exceedsCeiling names the dimension that is too wide, and accepts equality', () => {
  const ceiling = parseLimits({ memoryBytes: 1024 });
  assert.equal(exceedsCeiling(parseLimits({ memoryBytes: 4096 }), ceiling), 'memoryBytes');
  assert.equal(exceedsCeiling(parseLimits({ memoryBytes: 1024 }), ceiling), null);
});

test('exceedsCeiling checks every dimension, not only memory', () => {
  const ceiling = parseLimits({
    memoryBytes: 4096, cpuSeconds: 10, openFiles: 64, processes: 8, fileSizeBytes: 1000, coreDumpBytes: 0,
  });
  assert.equal(exceedsCeiling(parseLimits({ cpuSeconds: 11 }), ceiling), 'cpuSeconds');
  assert.equal(exceedsCeiling(parseLimits({ openFiles: 65 }), ceiling), 'openFiles');
  assert.equal(exceedsCeiling(parseLimits({ processes: 9 }), ceiling), 'processes');
  assert.equal(exceedsCeiling(parseLimits({ fileSizeBytes: 1001 }), ceiling), 'fileSizeBytes');
  assert.equal(exceedsCeiling(parseLimits({ coreDumpBytes: 1 }), ceiling), 'coreDumpBytes');
});

test('withinGrant is strict where exceedsCeiling is not: unset is unlimited, so it widens', () => {
  const grant = parseLimits({ memoryBytes: 4096, processes: 4 });
  assert.equal(withinGrant(parseLimits({ memoryBytes: 2048, processes: 2 }), grant), true);
  // Naming no process cap when the grant sets one is asking for more than was granted.
  assert.equal(withinGrant(parseLimits({ memoryBytes: 2048 }), grant), false);
  assert.equal(withinGrant(parseLimits({ memoryBytes: 8192, processes: 2 }), grant), false);
  assert.equal(withinGrant(parseLimits({ memoryBytes: 1 }), null), true);
});

test('assertUsable refuses an envelope nothing could run in', () => {
  // A sandbox that always fails is indistinguishable from a broken one, which is how a real
  // guarantee gets switched off "temporarily".
  assert.throws(() => assertUsable(parseLimits({ memoryBytes: 4096 })), /usable floor/);
  assert.doesNotThrow(() => assertUsable(parseLimits({ memoryBytes: 64 * 1024 * 1024 })));
});

// --- the security property: limits are under the MAC ------------------------------------------

test('a minted token carries its limits', () => {
  const minter = new TokenMinter(randomBytes(32));
  const token = minter.mint(authorised(), {
    stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1,
    expiresAtUnix: NOW + 60, limits: { memoryBytes: 64 * 1024 * 1024, cpuSeconds: 5 },
  }, NOW);
  assert.equal(token.limits.memoryBytes, 67108864);
});

test('WIDENING THE LIMITS IN TRANSIT IS DETECTED — the whole point of ARCH-008', () => {
  const minter = new TokenMinter(randomBytes(32));
  const token = minter.mint(authorised(), {
    stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1,
    expiresAtUnix: NOW + 60, limits: { memoryBytes: 64 * 1024 * 1024 },
  }, NOW);

  // Prove the oracle works in the clean direction first: an untouched token spends.
  assert.doesNotThrow(() => minter.spend(structuredClone(token),
    { path: 'src/a.rs', operation: 'WRITE' }, NOW));

  // Now the attack: raise the memory limit and keep everything else, MAC included.
  const tampered = structuredClone(token);
  tampered.limits = { ...token.limits, memoryBytes: 8 * 1024 * 1024 * 1024 };
  assert.throws(() => minter.spend(tampered, { path: 'src/a.rs', operation: 'WRITE' }, NOW),
    /does not verify/, 'a widened limit must not verify against the engine that issued it');
});

test('removing the limits entirely is also detected', () => {
  const minter = new TokenMinter(randomBytes(32));
  const token = minter.mint(authorised(), {
    stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 2,
    expiresAtUnix: NOW + 60, limits: { memoryBytes: 64 * 1024 * 1024 },
  }, NOW);
  const stripped = structuredClone(token);
  delete stripped.limits;
  assert.throws(() => minter.spend(stripped, { path: 'src/a.rs', operation: 'WRITE' }, NOW),
    /does not verify/, 'dropping the envelope must not read as never having had one');
});

test('a token minted without limits still verifies — limits are optional, not implied', () => {
  const minter = new TokenMinter(randomBytes(32));
  const token = minter.mint(authorised(), {
    stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1, expiresAtUnix: NOW + 60,
  }, NOW);
  assert.equal(token.limits, null);
  assert.doesNotThrow(() => minter.spend(token, { path: 'src/a.rs', operation: 'WRITE' }, NOW));
});

// --- mint-time refusals -----------------------------------------------------------------------

test('limits wider than the step grants are refused', () => {
  const minter = new TokenMinter(randomBytes(32));
  assert.throws(() => minter.mint(authorised({ memoryBytes: 64 * 1024 * 1024 }), {
    stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1,
    expiresAtUnix: NOW + 60, limits: { memoryBytes: 512 * 1024 * 1024 },
  }, NOW), /exceed what step/);
});

test('limits wider than the installation ceiling are refused, naming the dimension', () => {
  const minter = new TokenMinter(randomBytes(32), { ceiling: { memoryBytes: 128 * 1024 * 1024 } });
  assert.throws(() => minter.mint(authorised(), {
    stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1,
    expiresAtUnix: NOW + 60, limits: { memoryBytes: 512 * 1024 * 1024 },
  }, NOW), /`memoryBytes` is wider than this installation/);
});

test('a token below the ceiling mints, and a dimension left to the container is not a refusal', () => {
  const minter = new TokenMinter(randomBytes(32), {
    ceiling: { memoryBytes: 8589934592, openFiles: 40960, processes: 127784 },
  });
  const token = minter.mint(authorised(), {
    stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1,
    expiresAtUnix: NOW + 60, limits: { memoryBytes: 64 * 1024 * 1024 },
  }, NOW);
  assert.equal(token.limits.memoryBytes, 67108864);
  assert.equal(token.limits.openFiles, null);
});

test('on an enforcing installation an EXECUTE token without limits is refused', () => {
  const minter = new TokenMinter(randomBytes(32), { ceiling: { memoryBytes: 8589934592 } });
  const destructive = authorizePlan({
    id: 'p1', mode: 'apply', constraints: [],
    steps: [{
      id: 'a', description: 'run', files: ['src/a.rs'], commands: ['./x'], dependencies: [],
      blastRadius: { destructive: true, reachesOutsideWorkspace: false },
    }],
  }, { approverId: 'owner', grantedAtUnix: NOW - 10, expiresAtUnix: NOW + 3600, scope: 'p1' }, NOW);
  assert.throws(() => minter.mint(destructive, {
    stepId: 'a', paths: ['src/a.rs'], operations: ['EXECUTE'], uses: 1, expiresAtUnix: NOW + 60,
  }, NOW), /must carry its own limits/);
});

test('without a configured ceiling an EXECUTE token still mints — a limit nothing applies is ceremony', () => {
  // Deliberate: requiring an envelope before anything can enforce one would record a figure no
  // kernel ever sees. Reverted inside the same phase after it broke two correct designs.
  const minter = new TokenMinter(randomBytes(32));
  const destructive = authorizePlan({
    id: 'p1', mode: 'apply', constraints: [],
    steps: [{
      id: 'a', description: 'run', files: ['src/a.rs'], commands: ['./x'], dependencies: [],
      blastRadius: { destructive: true, reachesOutsideWorkspace: false },
    }],
  }, { approverId: 'owner', grantedAtUnix: NOW - 10, expiresAtUnix: NOW + 3600, scope: 'p1' }, NOW);
  assert.doesNotThrow(() => minter.mint(destructive, {
    stepId: 'a', paths: ['src/a.rs'], operations: ['EXECUTE'], uses: 1, expiresAtUnix: NOW + 60,
  }, NOW));
});

// --- declaration ------------------------------------------------------------------------------

test('isolationStatus claims no tier when nothing detected it', () => {
  const status = isolationStatus();
  assert.equal(status.enforcementAvailable, false);
  assert.equal(status.tier, null);
  assert.match(status.reason, /not found|unavailable/);
  // The honest boundary of this phase must be stated, not implied.
  assert.equal(status.spentThroughSandbox, false);
});

test('isolationStatus reports the detected tier verbatim', () => {
  const status = isolationStatus({
    sandboxBinary: '/usr/local/bin/noesar-sandbox',
    detected: {
      tier: 1, tierName: 'SECCOMP_FILTER', deniedSyscalls: 18,
      support: { rlimit: true, noNewPrivs: true, seccompFilter: true, landlock: false, cgroupV2Writable: false },
      containerCeiling: { memoryBytes: 8589934592 },
    },
  });
  assert.equal(status.enforcementAvailable, true);
  assert.equal(status.tierName, 'SECCOMP_FILTER');
  assert.equal(status.support.landlock, false);
  assert.equal(status.blockedSyscalls, 18);
});

test('the tier ladder has a floor that is claimed to work everywhere', () => {
  assert.equal(ISOLATION_TIERS[0].tier, 0);
  assert.equal(ISOLATION_TIERS[0].everywhere, true);
  assert.equal(ISOLATION_TIERS.filter((entry) => entry.everywhere).length, 1);
});

test('the canonical MAC order is fixed — it is a wire contract with the Rust minter', () => {
  assert.deepEqual([...LIMIT_DIMENSIONS],
    ['memoryBytes', 'cpuSeconds', 'openFiles', 'processes', 'fileSizeBytes', 'coreDumpBytes']);
  assert.equal(canonicalLimits(null), 'none');
  assert.equal(canonicalLimits(parseLimits({ memoryBytes: 1, coreDumpBytes: 0 })),
    'memoryBytes=1;cpuSeconds=-;openFiles=-;processes=-;fileSizeBytes=-;coreDumpBytes=0');
});
