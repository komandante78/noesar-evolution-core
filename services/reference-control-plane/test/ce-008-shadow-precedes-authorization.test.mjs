// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-008` — *«L'ombra precede l'autorizzazione: nessun dialogo di autorizzazione senza
// risultato misurato»* (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**),
// verification method *«test che tenta di autorizzare un passo mai simulato»*.
// And `CE-026` — *«Nessun contenuto autorato raggiunge il repository vero senza essere prima
// esistito in ombra»* (`16` §11), method *«test che tenta di promuovere un contenuto mai
// simulato»*. They are one file because they are the same question asked at two moments, and
// **the two answers are different**.
//
// # The result, stated before the tests rather than after them
//
//   CE-026  MET     — nothing reaches the real workspace except by being copied out of a
//                     shadow; `#promote` reads `shadow.root` and there is no second writer.
//   CE-008  NOT MET — the shadow runs INSIDE `approve()`, after the human has authorised.
//                     `approve()` accepts a run nobody ever simulated, which is exactly the
//                     attempt this criterion says must be refused.
//
// # Why a green test file records a criterion as NOT MET
//
// The tests below assert **what the product actually does**, including where that differs from
// what the criterion asks. A test that asserted the desired behaviour would sit red for as long
// as the gap lasts, and a permanently red suite is one people learn to ignore — the same
// argument the acceptance ratchet is built on. So the gap is written into the verdict cell of
// `15` §11 as `❌`, and characterised here so that **the day the order changes, this file fails
// and the verdict has to be re-stated** rather than quietly inherited.
//
// # What the current design does guarantee, so the gap is not overstated
//
// The authorisation is not blind: `plan()` produces the file list, the declared blast radius and
// the diff the caller supplied. What it is not is a *measured* result — nothing has been
// executed when the approval is asked for. `simulate()` exists for that and is **optional**: on
// an installation running only the reference provider it answers `supported: false`, so there is
// no measured result available before approval at all. The protection the shadow does give is
// real and lands one step later: promotion happens only if execution and comparison came back
// clean, which is `CE-026` below.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator, workspaceActionsStatus } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const NOW = 1_800_000_000;

function fixture() {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-ce008-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce008-sh-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const events = new EventLedger();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events,
  });
  return { ws, shadows, orch, events, cleanup() {
    rmSync(ws, { recursive: true, force: true });
    rmSync(shadows, { recursive: true, force: true });
  } };
}

describe('CE-008 / CE-026 — the shadow, the authorisation, and which of the two comes first', () => {

  // ── CE-008 · the attempt the criterion names, and what actually happens ───────────────────
  test('CE-008 NOT MET: a step nobody ever simulated is authorised without objection', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });

      // `simulate()` is never called. The criterion says this authorisation must be refused.
      const decided = fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });

      assert.equal(decided.promoted, true,
        'approve() refused an unsimulated run — CE-008 may now be MET and its verdict must be re-stated');
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'changed\n');
    } finally { fx.cleanup(); }
  });

  test('CE-008: the measurement exists, but it happens AFTER the approval, not before it', async () => {
    // The order, read off the ledger rather than off the source: `approved` is recorded before
    // `executor.ran` and `shadow.compared`. That IS the criterion, inverted.
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });

      const actions = fx.events.correlation(planned.runId).map((event) => event.action);
      const approvedAt = actions.indexOf('workspace_action.approved');
      const executedAt = actions.indexOf('executor.ran');
      const comparedAt = actions.indexOf('shadow.compared');

      assert.ok(approvedAt >= 0 && executedAt >= 0 && comparedAt >= 0,
        `the run did not record the three events: ${actions.join(', ')}`);
      assert.ok(approvedAt < executedAt && executedAt < comparedAt,
        'the shadow now precedes the approval — CE-008 may be MET and its verdict must be re-stated');
    } finally { fx.cleanup(); }
  });

  test('CE-008: on an installation with only the reference provider, simulate() offers no measured result to approve against', () => {
    // Not an accident of configuration — the status says so, and this asserts the status
    // rather than the comment. It is what makes the gap structural rather than local.
    const status = workspaceActionsStatus();
    assert.equal(status.simulationSupported, true);
    assert.match(status.simulationSupportedReason, /reference provider answers `supported: false`/,
      'the reference provider now predicts something — CE-008 may be closable and must be re-measured');
  });

  // ── CE-026 · the guarantee that IS in place, one step later ───────────────────────────────
  test('CE-026: what lands in the workspace is the shadow\'s bytes, not the caller\'s', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'promoted content\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });

      // The shadow for this run is discarded after the call, so the proof that the bytes came
      // through it is the ledger's own order: executed, compared, then promoted.
      const actions = fx.events.correlation(planned.runId).map((event) => event.action);
      assert.ok(actions.includes('executor.ran'));
      assert.ok(actions.includes('shadow.compared'));
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'promoted content\n');
      // And the scratch space did not survive the call: a shadow left behind is a second copy
      // of the workspace nobody is accounting for.
      assert.equal(readdirSync(fx.shadows).length, 0, 'a shadow survived the call');
    } finally { fx.cleanup(); }
  });

  test('CE-026: a run that was refused promotes nothing — the real workspace never sees it', async () => {
    // The other half: existing in shadow is necessary, and a shadow whose comparison did not
    // come back clean is not sufficient. A contradicted claim is the cheapest way to reach
    // that state through the public surface.
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line',
        files: [{ path: 'a.txt', contents: 'changed\n' }],
        claims: [{ type: 'file_equals', path: 'a.txt', value: 'not what will be written' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      const decided = fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });

      assert.equal(decided.promoted, false, JSON.stringify(decided.coverage));
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'original\n',
        'a run whose verification failed still reached the real workspace');
      assert.equal(existsSync(join(fx.ws, 'a.txt')), true);
    } finally { fx.cleanup(); }
  });
});
