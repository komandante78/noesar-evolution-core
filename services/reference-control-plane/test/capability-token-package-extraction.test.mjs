// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0653. Proves `packages/capability-token/` is a faithful extraction of this file's own
// signing algorithm, not a plausible-looking reimplementation. Every case below mints a REAL
// token through the production `TokenMinter` and asserts `@noesar/capability-token`'s `sign()`
// reproduces the identical MAC — the same check that generated `conformance/vectors.json`,
// pinned here so a future change to either side that breaks the agreement fails a test in the
// product's own suite, not only in the package's.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TokenMinter, authorizePlan } from '../src/capability.mjs';
import { sign as packageSign, verify as packageVerify } from '../../../packages/capability-token/src/index.mjs';

const NOW = 1_800_000_000;
const secret = Buffer.alloc(32, 7);

function authorizedPlan(files, destructive) {
  const plan = {
    mode: 'safe',
    constraints: [],
    steps: [{
      id: 'a',
      description: 's',
      files,
      commands: [],
      dependsOn: [],
      blastRadius: { paths: files, reachesOutsideWorkspace: false, destructive, limits: null },
    }],
  };
  const approval = { approverId: 'owner-001', grantedAtUnix: NOW, expiresAtUnix: NOW + 999999, scopeNote: 'x' };
  return authorizePlan(plan, approval, NOW);
}

describe('the extracted package reproduces the production TokenMinter MAC exactly', () => {
  test('an ordinary single-path grant, no limits', () => {
    const authorized = authorizedPlan(['src/a.rs'], false);
    const minter = new TokenMinter(secret);
    const token = minter.mint(authorized, { stepId: 'a', paths: ['src/a.rs'], operations: ['WRITE'], uses: 1, expiresAtUnix: NOW + 600 }, NOW);
    assert.equal(packageSign(token, secret), token.mac);
    assert.equal(packageVerify(token, secret), true);
  });

  test('multiple paths, multiple operations, destructive', () => {
    const authorized = authorizedPlan(['src/a.rs', 'src/b.rs'], true);
    const minter = new TokenMinter(secret);
    const token = minter.mint(authorized, {
      stepId: 'a', paths: ['src/a.rs', 'src/b.rs'], operations: ['DELETE', 'EXECUTE'], uses: 3, expiresAtUnix: NOW + 600,
    }, NOW);
    assert.equal(packageSign(token, secret), token.mac);
  });

  test('a full limits envelope is inside the reproduced MAC', () => {
    const authorized = authorizedPlan(['src/a.rs'], true);
    const minter = new TokenMinter(secret);
    const token = minter.mint(authorized, {
      stepId: 'a', paths: ['src/a.rs'], operations: ['EXECUTE'], uses: 1, expiresAtUnix: NOW + 600,
      limits: { memoryBytes: 67108864, cpuSeconds: 5, openFiles: 64, processes: 8, fileSizeBytes: 1048576, coreDumpBytes: 0 },
    }, NOW);
    assert.equal(packageSign(token, secret), token.mac);
  });

  test('a token widened after minting no longer verifies under the extracted package either', () => {
    const authorized = authorizedPlan(['src/a.rs', 'src/secret.rs'], false);
    const minter = new TokenMinter(secret);
    const token = minter.mint(authorized, { stepId: 'a', paths: ['src/a.rs'], operations: ['READ'], uses: 1, expiresAtUnix: NOW + 600 }, NOW);
    const widened = { ...token, paths: [...token.paths, 'src/secret.rs'] };
    assert.equal(packageVerify(widened, secret), false, 'the package must refuse a token widened after production signed it');
  });
});
