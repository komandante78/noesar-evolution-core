// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs conformance/capability-vectors.json through the Node minter. The Rust crate runs the
// same file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  TokenMinter, authorizePlan, planDigest, capabilityStatus, CapabilityError,
} from '../src/capability.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vectors = JSON.parse(
  readFileSync(resolve(root, 'conformance/capability-vectors.json'), 'utf8'),
);
const SECRET = Buffer.alloc(32, 7);

function planOf(steps) {
  return {
    mode: 'safe',
    constraints: [],
    steps: steps.map((step) => ({
      id: step.id,
      description: 's',
      files: step.files,
      commands: [],
      dependsOn: [],
      blastRadius: {
        paths: step.files,
        reachesOutsideWorkspace: step.outside,
        destructive: step.destructive,
      },
    })),
  };
}

function caught(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    assert.ok(error instanceof CapabilityError, `expected a CapabilityError, got ${error}`);
    return error.kind;
  }
}

for (const vector of vectors.cases) {
  test(`mint ${vector.id} — ${vector.why}`, () => {
    const minter = new TokenMinter(SECRET);
    const authorized = authorizePlan(planOf(vector.steps), vectors.approval, vectors.now);
    if (vector.expected.minted) {
      const token = minter.mint(authorized, vector.request, vectors.now);
      assert.equal(token.stepId, vector.request.stepId);
      assert.equal(token.planDigest, authorized.digest);
      assert.ok(token.mac.length === 64);
      return;
    }
    assert.equal(caught(() => minter.mint(authorized, vector.request, vectors.now)),
      vector.expected.kind);
  });
}

const grantSteps = [{ id: 'a', files: ['src/a.rs', 'src/other.rs'], destructive: false, outside: false }];
const grantRequest = {
  stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1, expiresAtUnix: 1800000600,
};

for (const vector of vectors.spend) {
  test(`spend ${vector.id} — ${vector.why}`, () => {
    const minter = new TokenMinter(SECRET);
    const authorized = authorizePlan(planOf(grantSteps), vectors.approval, vectors.now);
    const token = minter.mint(authorized, grantRequest, vectors.now);
    if (vector.twice) minter.spend(token, vector.attempt, vector.at);
    if (vector.expected.allowed) {
      assert.deepEqual(minter.spend(token, vector.attempt, vector.at), { spent: true, usesRemaining: 0 });
      return;
    }
    assert.equal(caught(() => minter.spend(token, vector.attempt, vector.at)), vector.expected.kind);
  });
}

test('a plan alone is not permission to act on it', () => {
  const plan = planOf(grantSteps);
  assert.equal(caught(() => authorizePlan(plan, { ...vectors.approval, approverId: '  ' }, vectors.now)), 'NOT_AUTHORIZED');
  assert.equal(caught(() => authorizePlan(plan, { ...vectors.approval, expiresAtUnix: vectors.now - 1, grantedAtUnix: vectors.now - 100 }, vectors.now)), 'NOT_AUTHORIZED');
});

test('a token edited after issue stops verifying', () => {
  const minter = new TokenMinter(SECRET);
  const authorized = authorizePlan(planOf(grantSteps), vectors.approval, vectors.now);
  const token = minter.mint(authorized, grantRequest, vectors.now);
  const widened = { ...token, paths: [...token.paths, 'src/other.rs'] };
  assert.equal(
    caught(() => minter.spend(widened, { path: 'src/other.rs', operation: 'WRITE' }, 1800000100)),
    'REFUSED',
  );
});

test('a token from another engine is unknown, not merely invalid', () => {
  const first = new TokenMinter(SECRET);
  const authorized = authorizePlan(planOf(grantSteps), vectors.approval, vectors.now);
  const token = first.mint(authorized, grantRequest, vectors.now);
  const second = new TokenMinter(Buffer.alloc(32, 9));
  assert.equal(caught(() => second.spend(token, { path: 'src/a.rs', operation: 'WRITE' }, 1800000100)), 'REFUSED');
});

test('revocation takes a live token out of service', () => {
  const minter = new TokenMinter(SECRET);
  const authorized = authorizePlan(planOf(grantSteps), vectors.approval, vectors.now);
  const token = minter.mint(authorized, { ...grantRequest, uses: 5 }, vectors.now);
  assert.equal(minter.outstanding(), 1);
  assert.equal(minter.revoke(token.id), true);
  assert.equal(minter.outstanding(), 0);
  assert.equal(caught(() => minter.spend(token, { path: 'src/a.rs', operation: 'WRITE' }, 1800000100)), 'REFUSED');
});

test('approving one plan does not authorise another', () => {
  const first = planDigest(planOf(grantSteps));
  const second = planDigest(planOf([{ id: 'a', files: ['src/z.rs'], destructive: false, outside: false }]));
  assert.notEqual(first, second);
});

test('a short secret is refused at construction', () => {
  assert.equal(caught(() => new TokenMinter(Buffer.alloc(31, 1))), 'INVALID');
});

test('the status states what is not enforced instead of implying it', () => {
  const status = capabilityStatus(new TokenMinter(SECRET));
  assert.equal(status.adaptersMaySelfGrant, false);
  assert.equal(status.registryPersistsAcrossRestart, false);
  assert.equal(status.executorImplemented, true);
  assert.equal(status.executorEnforcesTokens, true);
  // D-0190/D-0191: /api/v1/workspace-actions now routes real writes through the executor.
  assert.equal(status.executorWiredToProductActions, true);
  assert.equal(status.outstandingTokens, 0);
});

test('the vector file has not shrunk unnoticed', () => {
  assert.equal(vectors.cases.length, 12);
  assert.equal(vectors.spend.length, 5);
});
