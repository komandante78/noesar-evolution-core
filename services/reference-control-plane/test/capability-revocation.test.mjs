// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0577`, closing `F-REVOKE-001` — **a capability grant can be withdrawn by a person**.
//
// # What was wrong, measured before this file existed
//
// `TokenMinter#revoke` was written, correct, and called by nothing: `D-0571` measured zero
// product callers and `ce-002-token-refused-on-every-surface.test.mjs` pinned that number so it
// could not drift unnoticed. The consequence was not theoretical — the only way to stop a live
// token was to wait for its own expiry, so a grant issued in error stayed usable for as long as
// its approval said, and nothing anywhere could list which grants were outstanding. An authority
// that cannot be withdrawn is an authority nobody can correct.
//
// # What this file proves, and at which layer
//
//   1. **the engine** — a grant is describable while it is live, describable WITHOUT its MAC,
//      gone the moment it is withdrawn, and refused on the next use;
//   2. **the session protocol** — both verbs are gated by the permission the policy table names,
//      refused when the transport says the caller may not, and the withdrawal writes a ledger
//      line that says WHAT was withdrawn, not merely that something was;
//   3. **the shells** — the two verbs exist in the one command table both shells render, at the
//      permissions the protocol enforces, so neither shell has an act the other lacks.
//
// The HTTP layer is proved where its harness already lives: the route's happy path and its
// double-withdrawal case in `ce-002-…` (which now reaches the *revoked* state through the real
// route rather than through a foreign engine's token), and its CSRF and unknown-token cases in
// `capability-http-adversarial.test.mjs`. A third listener here would cost seconds to re-prove
// what those two already boot a server for.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TokenMinter, authorizePlan, capabilityStatus, CapabilityError } from '../src/capability.mjs';
import { createSessionDispatch, SESSION_METHOD_POLICY, ProtocolError } from '../src/session-protocol.mjs';
import { AGENT_COMMANDS } from '../../../apps/shared/coden/agent-commands.js';
import { showAddress } from '../../../apps/shared/coden/coden-address-views.mjs';

const NOW = 1_800_000_000;
const SECRET = Buffer.alloc(32, 11);

/** A plan with one non-destructive step over one file — the smallest thing that can be granted. */
function plan(file = 'grant.txt') {
  return {
    mode: 'safe',
    constraints: [],
    steps: [{
      id: 'step-1', description: 'write it', files: [file], commands: [], dependsOn: [],
      blastRadius: { paths: [file], reachesOutsideWorkspace: false, destructive: false },
    }],
  };
}

function mintOne(minter, { file = 'grant.txt', uses = 2, ttl = 900, nowUnix = NOW } = {}) {
  const authorized = authorizePlan(plan(file), {
    approverId: 'owner-1', grantedAtUnix: nowUnix, expiresAtUnix: nowUnix + ttl,
  }, nowUnix);
  return minter.mint(authorized, {
    stepId: 'step-1', paths: [file], operations: ['WRITE'], uses, expiresAtUnix: nowUnix + ttl,
  }, nowUnix);
}

describe('capability revocation · the engine', () => {
  test('a live grant is describable, and carries everything needed to decide whether to withdraw it', () => {
    const minter = new TokenMinter(SECRET);
    const token = mintOne(minter, { file: 'a.txt', uses: 3 });

    const [grant] = minter.grants(NOW);
    assert.equal(minter.grants(NOW).length, 1);
    assert.equal(grant.tokenId, token.id);
    assert.equal(grant.stepId, 'step-1');
    assert.equal(grant.planDigest, token.planDigest);
    assert.deepEqual(grant.paths, ['a.txt']);
    assert.deepEqual(grant.operations, ['WRITE']);
    assert.equal(grant.usesGranted, 3);
    assert.equal(grant.usesRemaining, 3);
    assert.equal(grant.expired, false);
  });

  test('describing a grant is never a way to obtain one — no MAC, and no shared array to mutate', () => {
    const minter = new TokenMinter(SECRET);
    const token = mintOne(minter, { file: 'b.txt' });

    const [grant] = minter.grants(NOW);
    assert.ok(!Object.hasOwn(grant, 'mac'), 'a described grant must not carry the signature that makes it spendable');
    assert.ok(!JSON.stringify(grant).includes(token.mac), 'the MAC must not reach a screen by any field name');

    // The paths are a copy. A caller that mutated the description would otherwise widen the
    // registry's own record of what the grant covers — the registry is what `revoke()` reports
    // to the ledger, so an edit here would falsify the audit trail, not merely a screen.
    grant.paths.push('../etc/passwd');
    assert.deepEqual(minter.grants(NOW)[0].paths, ['b.txt']);
  });

  test('withdrawing a grant removes it from the list and refuses the next use', () => {
    const minter = new TokenMinter(SECRET);
    const token = mintOne(minter, { file: 'c.txt', uses: 2 });
    const attempt = { path: 'c.txt', operation: 'WRITE' };

    // One legitimate use first: the point is withdrawing a grant that was still good, not
    // withdrawing one that had already run out.
    assert.equal(minter.spend(token, attempt, NOW).usesRemaining, 1);

    assert.equal(minter.revoke(token.id), true);
    assert.deepEqual(minter.grants(NOW), []);
    assert.equal(minter.outstanding(), 0);
    assert.equal(minter.grant(token.id, NOW), null);

    assert.throws(() => minter.spend(token, attempt, NOW), (error) => {
      assert.ok(error instanceof CapabilityError);
      assert.equal(error.kind, 'REFUSED');
      assert.match(error.reason, /did not issue that token/);
      return true;
    });
  });

  test('withdrawing what this engine does not hold reports false, and invents nothing', () => {
    const minter = new TokenMinter(SECRET);
    mintOne(minter, { file: 'd.txt' });

    assert.equal(minter.revoke('f'.repeat(32)), false);
    assert.equal(minter.grant('f'.repeat(32), NOW), null);
    assert.equal(minter.grant(null, NOW), null);
    assert.equal(minter.grants(NOW).length, 1, 'a failed withdrawal must not disturb the grants that are held');
  });

  test('a spent grant drops off the list — the list is what is live, not what was ever issued', () => {
    const minter = new TokenMinter(SECRET);
    const token = mintOne(minter, { file: 'e.txt', uses: 1 });
    minter.spend(token, { path: 'e.txt', operation: 'WRITE' }, NOW);

    assert.deepEqual(minter.grants(NOW), []);
    assert.equal(minter.grant(token.id, NOW), null);
  });

  test('a grant past its own expiry is still listed, flagged — lapsed and never-issued are different facts', () => {
    const minter = new TokenMinter(SECRET);
    const token = mintOne(minter, { file: 'f.txt', ttl: 60 });

    const later = NOW + 61;
    const [grant] = minter.grants(later);
    assert.equal(grant.tokenId, token.id);
    assert.equal(grant.expired, true, 'an operator asking what is outstanding is owed the lapsed ones too');
    // …and `expired` is a measurement, so it is absent rather than guessed when no clock is given.
    assert.equal(minter.grants()[0].expired, null);
  });

  test('the posture says revocation is reachable — the flag a shell decides what to render from', () => {
    const status = capabilityStatus(new TokenMinter(SECRET));
    assert.equal(status.revocationReachable, true);
    assert.match(status.reason, /withdrawn/);
  });
});

describe('capability revocation · the session protocol', () => {
  function bench() {
    const minter = new TokenMinter(SECRET);
    const appended = [];
    const dispatch = createSessionDispatch({
      capabilityStatus,
      capabilityMinter: minter,
      ledger: { append: (entry) => appended.push(entry) },
    });
    return { minter, appended, dispatch };
  }

  test('the two verbs carry the permissions their HTTP twins already ask, and both transports get them', () => {
    assert.deepEqual(SESSION_METHOD_POLICY['capability.grants'], { permission: 'workspace.read', bridged: true });
    assert.deepEqual(SESSION_METHOD_POLICY['capability.revoke'], { permission: 'workspace.write', bridged: true });
  });

  test('a caller who may not write cannot withdraw a grant, and the refusal names the permission', async () => {
    const { minter, dispatch } = bench();
    const token = mintOne(minter);

    await assert.rejects(
      () => dispatch('capability.revoke', { tokenId: token.id }, 'reader-1', (permission) => permission === 'workspace.read'),
      (error) => {
        assert.ok(error instanceof ProtocolError);
        assert.match(error.message, /workspace\.write/);
        return true;
      },
    );
    // Refused, and the grant untouched: a denial that half-executed would be worse than none.
    assert.equal(minter.grants(NOW).length, 1);
  });

  test('a caller who may not read the workspace cannot list what is outstanding', async () => {
    const { dispatch } = bench();
    await assert.rejects(
      () => dispatch('capability.grants', {}, 'stranger-1', () => false),
      (error) => { assert.match(error.message, /workspace\.read/); return true; },
    );
  });

  test('a transport that cannot say what its caller may do is refused, not let through', async () => {
    const { dispatch } = bench();
    await assert.rejects(
      () => dispatch('capability.revoke', { tokenId: 'x' }, 'someone', undefined),
      (error) => { assert.match(error.message, /did not say what the caller may do/); return true; },
    );
  });

  test('the withdrawal is recorded naming WHAT was withdrawn, not merely that something was', async () => {
    const { minter, appended, dispatch } = bench();
    const token = mintOne(minter, { file: 'g.txt', uses: 4 });

    const listed = await dispatch('capability.grants', {}, 'owner-1', () => true);
    assert.equal(listed.grants.length, 1);
    assert.equal(listed.grants[0].tokenId, token.id);

    const result = await dispatch('capability.revoke', { tokenId: token.id }, 'owner-1', () => true);
    assert.equal(result.revoked, true);
    assert.deepEqual(result.grant.paths, ['g.txt']);

    assert.equal(appended.length, 1);
    const [entry] = appended;
    assert.equal(entry.action, 'capability.revoked');
    assert.equal(entry.result, 'revoked');
    assert.equal(entry.actor, 'owner-1');
    assert.equal(entry.details.tokenId, token.id);
    assert.deepEqual(entry.details.paths, ['g.txt']);
    assert.deepEqual(entry.details.operations, ['WRITE']);
    assert.equal(entry.details.usesForfeited, 4, 'the ledger records what the withdrawal actually cost the holder');
    assert.equal(entry.details.transport, 'tui');

    assert.deepEqual((await dispatch('capability.grants', {}, 'owner-1', () => true)).grants, []);
  });

  test('withdrawing an unknown or unnamed grant is refused, and writes no ledger line', async () => {
    const { appended, dispatch } = bench();

    await assert.rejects(
      () => dispatch('capability.revoke', { tokenId: 'f'.repeat(32) }, 'owner-1', () => true),
      (error) => { assert.equal(error.kind, 'NOT_FOUND'); return true; },
    );
    await assert.rejects(
      () => dispatch('capability.revoke', {}, 'owner-1', () => true),
      (error) => { assert.equal(error.kind, 'INVALID_REQUEST'); return true; },
    );
    assert.equal(appended.length, 0, 'a refused withdrawal is not a withdrawal, and must not read as one in the trail');
  });
});

describe('capability revocation · the Authority panel, in the shell both surfaces render', () => {
  const ENTRY = Object.freeze({
    address: 'coden/agent/authority', region: 'agent', panel: 'authority',
    label: 'Authority requests', declaredEmpty: [],
  });
  const render = (answers) => showAddress(
    { call: async (method) => answers[method] ?? {} }, { lastList: null }, ENTRY, '', () => {},
  );

  test('a live grant is shown with what it covers, and the verb that withdraws it', async () => {
    const lines = (await render({
      status: { capability: { revocationReachable: true } },
      'capability.grants': { grants: [{
        tokenId: 'abc123', stepId: 'step-1', paths: ['note.txt', 'other.txt'], operations: ['WRITE'],
        usesGranted: 2, usesRemaining: 1, expiresAtUnix: 1_800_000_900, expired: false,
      }] },
    })).join('\n');

    assert.match(lines, /live grants — 1 outstanding/);
    assert.match(lines, /abc123 · step step-1 · WRITE · 1\/2 uses left/);
    assert.match(lines, /note\.txt, other\.txt/, 'a grant a person must judge is shown with the paths it covers');
    assert.match(lines, /`revoke <token>` withdraws one now/, 'a panel that shows a problem and not its verb is a report, not a capability');
    assert.doesNotMatch(lines, /LAPSED/);
  });

  test('a lapsed grant says so — the operator is owed the difference between gone and expired', async () => {
    const lines = (await render({
      'capability.grants': { grants: [{
        tokenId: 'old', stepId: 's', paths: ['x'], operations: ['WRITE'],
        usesGranted: 1, usesRemaining: 1, expiresAtUnix: 1, expired: true,
      }] },
    })).join('\n');
    assert.match(lines, /LAPSED/);
  });

  test('an empty list and an unanswered one are different sentences, and neither is a crash', async () => {
    const empty = (await render({ 'capability.grants': { grants: [] } })).join('\n');
    assert.match(empty, /none outstanding/);

    // The shape an engine that predates this method returns. Before `D-0577` hardened it, this
    // threw a TypeError and blanked the panel — found by `coden-shell-parity`, whose stub
    // answers `{}` to a method it has not been taught.
    const silent = (await render({})).join('\n');
    assert.match(silent, /not shown: this engine did not answer with a grant list/);
    assert.doesNotMatch(silent, /none outstanding/, 'an unrecognised answer must never be rendered as a reassurance');
  });

  test('a reader who may not list is told so, not shown an empty panel', async () => {
    const lines = (await showAddress(
      {
        call: async (method) => {
          if (method === 'status') return { capability: {} };
          throw new Error('`capability.grants` needs `workspace.read`');
        },
      },
      { lastList: null }, ENTRY, '', () => {},
    )).join('\n');
    assert.match(lines, /not shown: `capability\.grants` needs `workspace\.read`/);
  });
});

describe('capability revocation · the shells', () => {
  test('both verbs are in the one command table the two shells render, at the enforced permissions', () => {
    const byName = new Map(AGENT_COMMANDS.map((command) => [command.name, command]));

    for (const [name, method] of [['grants', 'capability.grants'], ['revoke', 'capability.revoke']]) {
      const command = byName.get(name);
      assert.ok(command, `\`${name}\` must exist: the Authority panel tells a person to type it`);
      assert.equal(command.kind, 'call');
      assert.equal(command.method, method);
      // Copied here rather than imported — the browser cannot import out of `services/` — so it
      // is DERIVED by comparison, the difference between this and a second list that drifts.
      assert.equal(command.permission, SESSION_METHOD_POLICY[method].permission);
    }
    assert.equal(byName.get('revoke').argument, '<token>', 'a verb that acts on one grant must ask for it');
  });
});
