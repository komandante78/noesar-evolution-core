// SPDX-License-Identifier: AGPL-3.0-or-later
// D-0190: the first product surface that spends a capability token and changes a real file.
// The second half is adversarial on purpose — the phase-1 criterion (09_PIANO.md §3) is
// proved by "a suite whose only job is to try to make it exit its authority", not by the
// happy path alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  WorkspaceActionOrchestrator, WorkspaceActionError, workspaceActionsStatus,
} from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

function fixture() {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-wa-ws-'));
  // A real workspace is never literally empty; ShadowWorkspace.ofWorkspace() refuses to
  // shadow a tree with nothing in it (shadow.mjs, "a shadow of nothing"), so every fixture
  // seeds one file, matching what the live installation always has (config/, logs/, ...).
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-wa-shadows-'));
  const events = new EventLedger();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events,
  });
  return { ws, shadows, orch, events };
}
function cleanup({ ws, shadows }) {
  rmSync(ws, { recursive: true, force: true });
  rmSync(shadows, { recursive: true, force: true });
}
const NOW = Math.floor(Date.now() / 1000);

// Regression: server.mjs's first wiring pointed shadowsRoot at `workspace/shadows` — nested
// inside the very tree it shadows — and only failed on the first live approve(), five levels
// deep inside shadow.mjs, because the read-only status route that already used that directory
// never builds a real whole-workspace shadow there. Caught by a live HTTP check, not by a
// unit test, because every other fixture in this file uses two sibling directories. Fixed by
// checking containment at construction; this proves the check fires.
test('the orchestrator refuses at construction if shadowsRoot is nested inside workspaceRoot', () => {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-wa-nested-ws-'));
  try {
    assert.throws(
      () => new WorkspaceActionOrchestrator({
        workspaceRoot: ws, shadowsRoot: join(ws, 'shadows'),
        minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
      }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'CONTAINMENT',
    );
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

// --- happy path -------------------------------------------------------------

test('plan → approve promotes a real file write and modification', () => {
  const fx = fixture();
  try {
    mkdirSync(join(fx.ws, 'existing'), { recursive: true });
    writeFileSync(join(fx.ws, 'existing/a.txt'), 'original\n');
    const planned = fx.orch.plan({
      request: 'add a line and create a file',
      files: [
        { path: 'existing/a.txt', contents: 'original\nnew line\n' },
        { path: 'new-file.txt', contents: 'brand new\n' },
      ],
      actor: 'owner-1', nowUnix: NOW,
    });
    assert.equal(planned.risk.overall, 'LOW');

    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner-1', nowUnix: NOW + 1 });
    assert.equal(approved.promoted, true);
    assert.equal(approved.result.ok, true);
    assert.equal(readFileSync(join(fx.ws, 'existing/a.txt'), 'utf8'), 'original\nnew line\n');
    assert.equal(existsSync(join(fx.ws, 'new-file.txt')), true);
    assert.equal(readFileSync(join(fx.ws, 'new-file.txt'), 'utf8'), 'brand new\n');
  } finally { cleanup(fx); }
});

test('the diff shows real before/after content for every touched file', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.ws, 'a.txt'), 'before\n');
    const planned = fx.orch.plan({ request: 'edit', files: [{ path: 'a.txt', contents: 'after\n' }], actor: 'owner', nowUnix: NOW });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(approved.diff.length, 1);
    assert.equal(approved.diff[0].status, 'MODIFIED');
    assert.equal(approved.diff[0].before, 'before\n');
    assert.equal(approved.diff[0].after, 'after\n');
    assert.equal(approved.diff[0].diffAvailable, true);
  } finally { cleanup(fx); }
});

test('a created file diffs with before:null', () => {
  const fx = fixture();
  try {
    const planned = fx.orch.plan({ request: 'create', files: [{ path: 'new.txt', contents: 'x\n' }], actor: 'owner', nowUnix: NOW });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(approved.diff[0].status, 'CREATED');
    assert.equal(approved.diff[0].before, null);
  } finally { cleanup(fx); }
});

test('restore writes back exactly the original bytes, and deletes a file that did not exist before', () => {
  const fx = fixture();
  try {
    mkdirSync(join(fx.ws, 'existing'), { recursive: true });
    writeFileSync(join(fx.ws, 'existing/a.txt'), 'original content\n');
    const planned = fx.orch.plan({
      request: 'edit and create',
      files: [
        { path: 'existing/a.txt', contents: 'original content\nnew line\n' },
        { path: 'new-file.txt', contents: 'brand new\n' },
      ],
      actor: 'owner', nowUnix: NOW,
    });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });

    const restored = fx.orch.restore({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 2 });
    assert.equal(restored.status, 'RESTORED');
    assert.equal(readFileSync(join(fx.ws, 'existing/a.txt'), 'utf8'), 'original content\n');
    assert.equal(existsSync(join(fx.ws, 'new-file.txt')), false);
  } finally { cleanup(fx); }
});

test('every step of a promoted run is recorded in the causal event ledger, chained', () => {
  const fx = fixture();
  try {
    const planned = fx.orch.plan({ request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    const chain = fx.events.correlation(planned.runId).map((event) => event.action);
    assert.deepEqual(chain, [
      'workspace_action.planned', 'workspace_action.approved', 'capability.minted',
      'executor.ran', 'shadow.compared', 'workspace_action.promoted',
    ]);
    assert.equal(fx.events.verify().valid, true);
  } finally { cleanup(fx); }
});

// --- the adversarial half: proving it never exits its authority -------------

test('a request with no files is refused before anything is planned', () => {
  const fx = fixture();
  try {
    assert.throws(
      () => fx.orch.plan({ request: 'do nothing', files: [], actor: 'x', nowUnix: NOW }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'NO_FILES',
    );
  } finally { cleanup(fx); }
});

test('a path that leaves the workspace is refused at plan time, before any token exists', () => {
  const fx = fixture();
  try {
    assert.throws(
      () => fx.orch.plan({ request: 'escape', files: [{ path: '../../../etc/passwd', contents: 'pwned' }], actor: 'x', nowUnix: NOW }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'CONSTRAINED_AWAY',
    );
    assert.equal(existsSync('/etc/passwd-noesar-test'), false);
  } finally { cleanup(fx); }
});

test('the same run cannot be approved twice', () => {
  const fx = fixture();
  try {
    const planned = fx.orch.plan({ request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.throws(
      () => fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 2 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'ALREADY_DECIDED',
    );
  } finally { cleanup(fx); }
});

test('a rejected run cannot later be approved', () => {
  const fx = fixture();
  try {
    const planned = fx.orch.plan({ request: 'write', files: [{ path: 'y.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.reject({ runId: planned.runId, approverId: 'owner', reason: 'no', nowUnix: NOW + 1 });
    assert.throws(
      () => fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 2 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'ALREADY_DECIDED',
    );
    assert.equal(existsSync(join(fx.ws, 'y.txt')), false);
  } finally { cleanup(fx); }
});

test('an approval with no approver is refused and nothing is written', () => {
  const fx = fixture();
  try {
    const planned = fx.orch.plan({ request: 'write', files: [{ path: 'z.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    assert.throws(
      () => fx.orch.approve({ runId: planned.runId, approverId: '', nowUnix: NOW + 1 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'NO_APPROVER',
    );
    assert.equal(existsSync(join(fx.ws, 'z.txt')), false);
  } finally { cleanup(fx); }
});

test('an unknown run id is refused on approve, reject and restore alike', () => {
  const fx = fixture();
  try {
    for (const verb of ['approve', 'reject', 'restore']) {
      assert.throws(
        () => fx.orch[verb]({ runId: 'does-not-exist', approverId: 'x', actor: 'x', nowUnix: NOW }),
        (error) => error instanceof WorkspaceActionError && error.kind === 'NOT_FOUND',
        `expected ${verb} to refuse an unknown run`,
      );
    }
  } finally { cleanup(fx); }
});

test('a run that was never promoted cannot be restored', () => {
  const fx = fixture();
  try {
    const planned = fx.orch.plan({ request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.reject({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.throws(
      () => fx.orch.restore({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 2 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'NOT_PROMOTED',
    );
  } finally { cleanup(fx); }
});

test('a promoted run cannot be restored twice', () => {
  const fx = fixture();
  try {
    const planned = fx.orch.plan({ request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    fx.orch.restore({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 2 });
    assert.throws(
      () => fx.orch.restore({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 3 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'ALREADY_RESTORED',
    );
  } finally { cleanup(fx); }
});

test('two independent runs against two different workspaces never cross-contaminate', () => {
  const fx1 = fixture();
  const fx2 = fixture();
  try {
    const p1 = fx1.orch.plan({ request: 'write 1', files: [{ path: 'one.txt', contents: '1' }], actor: 'owner', nowUnix: NOW });
    const p2 = fx2.orch.plan({ request: 'write 2', files: [{ path: 'two.txt', contents: '2' }], actor: 'owner', nowUnix: NOW });
    const a1 = fx1.orch.approve({ runId: p1.runId, approverId: 'owner', nowUnix: NOW + 1 });
    const a2 = fx2.orch.approve({ runId: p2.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(a1.promoted, true);
    assert.equal(a2.promoted, true);
    assert.equal(existsSync(join(fx1.ws, 'two.txt')), false);
    assert.equal(existsSync(join(fx2.ws, 'one.txt')), false);
  } finally { cleanup(fx1); cleanup(fx2); }
});

test('a write with no actual effect is refused, not silently promoted as a success', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.ws, 'nochange.txt'), 'already this');
    const planned = fx.orch.plan({ request: 'no-op', files: [{ path: 'nochange.txt', contents: 'already this' }], actor: 'owner', nowUnix: NOW });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    // shadow.mjs treats "nothing changed" and "nothing was looked at" as the same empty set
    // (compare()'s own comment) and refuses to produce a surprise for either — surprise stays
    // null, comparisonRefused carries why, and execute()'s `ok` is false either way. A no-op
    // is therefore never promoted, which is the property this test exists to prove.
    assert.equal(approved.promoted, false);
    assert.equal(approved.result.ok, false);
    assert.equal(approved.result.surprise, null);
    assert.match(approved.result.comparisonRefused, /cannot be compared/);
    assert.equal(readFileSync(join(fx.ws, 'nochange.txt'), 'utf8'), 'already this');
  } finally { cleanup(fx); }
});

test('there is no way to ask this wiring for a destructive step — plan() always builds WRITE-only blast radii', () => {
  const fx = fixture();
  try {
    // DELETE and EXECUTE are refused by construction, not by a policy a caller could weaken:
    // orch.plan() has no parameter that reaches `destructive`, and approve() only ever builds
    // WRITE actions. workspaceActionsStatus() declares the same boundary.
    const planned = fx.orch.plan({ request: 'write', files: [{ path: 'a.txt', contents: 'x' }], actor: 'owner', nowUnix: NOW });
    assert.equal(planned.plan.steps[0].blastRadius.destructive, false);
  } finally { cleanup(fx); }
});

// --- status honesty -----------------------------------------------------------

test('status declares the trivial-path scope and the test-execution boundary, not a stronger claim', () => {
  const status = workspaceActionsStatus();
  assert.deepEqual(status.operationsSupported, ['WRITE']);
  assert.ok(status.operationsNotSupported.includes('DELETE'));
  assert.ok(status.operationsNotSupported.includes('EXECUTE'));
  assert.equal(status.testExecution, false);
  assert.equal(status.runsPersistAcrossRestart, false);
  assert.match(status.testExecutionReason, /EXECUTE/);
});
