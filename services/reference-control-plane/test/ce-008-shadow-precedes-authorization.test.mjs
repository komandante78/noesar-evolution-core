// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-008` — *«L'ombra precede l'autorizzazione: nessun dialogo di autorizzazione senza
// risultato misurato»* (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**),
// verification method *«test che tenta di autorizzare un passo mai simulato»*.
// And `CE-026` — *«Nessun contenuto autorato raggiunge il repository vero senza essere prima
// esistito in ombra»* (`16` §11), method *«test che tenta di promuovere un contenuto mai
// simulato»*. One file, because they are the same question asked at two moments.
//
// # This file has already been two different files, and that is the record worth keeping
//
// Written on 2026-08-19 (`D-0566`) it **characterised a gap**: `approve()` did everything in one
// call, so the attempt `CE-008` says must be refused — authorising a step nobody simulated —
// *succeeded*, and the criterion was recorded `❌`, the register's first. Rewritten the same day
// (`D-0567`) it asserts the closure: the attempt is now refused by name.
//
// The order is what changed, and the order IS the criterion:
//
//   measure()  the actor authorises a run IN A SHADOW; nothing can reach the workspace from it
//   approve()  the approver authorises THE CHANGE, against the result measure() produced
//
// Two authorisations of two different things, because the naive fix is circular: `execute()`
// refuses without a token, a token comes only from an authorised plan, and an authorisation
// needs a human. What it also bought, which was not the goal: the workspace mutation now spends
// a token of its own inside `#promote` instead of inheriting the one spent on the shadow.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator, WorkspaceActionError, workspaceActionsStatus } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { AGENT_COMMANDS } from '../../../apps/shared/coden/agent-commands.js';

const NOW = 1_800_000_000;

function fixture() {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-ce008-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce008-sh-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const events = new EventLedger();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events, env: {},
  });
  return { ws, shadows, orch, events, cleanup() {
    rmSync(ws, { recursive: true, force: true });
    rmSync(shadows, { recursive: true, force: true });
  } };
}

describe('CE-008 / CE-026 — the shadow, the authorisation, and which of the two comes first', () => {

  // ── CE-008 · the attempt the criterion names ──────────────────────────────────────────────
  test('CE-008: a step nobody measured cannot be authorised — the attempt is refused by name', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });

      assert.throws(
        () => fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW }),
        (error) => error instanceof WorkspaceActionError && error.kind === 'NOT_MEASURED',
      );
      // And the refusal is about the bytes, not only about the reply.
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'original\n');
    } finally { fx.cleanup(); }
  });

  test('CE-008: the measurement precedes the approval in the ledger, which is where the order is readable', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
      fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW + 1 });

      const actions = fx.events.correlation(planned.runId).map((event) => event.action);
      const at = (name) => actions.indexOf(name);
      for (const name of ['workspace_action.measuring', 'executor.ran', 'shadow.compared',
        'workspace_action.measured', 'workspace_action.approved']) {
        assert.ok(at(name) >= 0, `${name} was not recorded: ${actions.join(', ')}`);
      }
      // Everything the approver needs to have seen is recorded before the approval is.
      assert.ok(at('executor.ran') < at('workspace_action.approved'), 'the execution follows the approval again');
      assert.ok(at('shadow.compared') < at('workspace_action.approved'), 'the comparison follows the approval again');
      assert.ok(at('workspace_action.claims_verified') < at('workspace_action.approved'), 'the claims are recomputed after the approval again');
      // Two mints: the shadow run and the change are separately authorised.
      assert.equal(actions.filter((action) => action === 'capability.minted').length, 2);
      assert.equal(fx.events.verify().valid, true);
    } finally { fx.cleanup(); }
  });

  test('CE-008: measuring changes nothing in the workspace, and says what it found', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      const measured = fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });

      assert.equal(measured.status, 'MEASURED');
      assert.equal(measured.clean, true);
      assert.equal(measured.promoted, false);
      assert.equal(measured.diff.length, 1);
      assert.equal(measured.diff[0].before, 'original\n');
      assert.equal(measured.diff[0].after, 'changed\n');
      // The whole point: the approver has seen the real after-bytes and the file is untouched.
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'original\n');
    } finally { fx.cleanup(); }
  });

  test('CE-008: a measured run can still be rejected, and the shadow goes with it', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
      fx.orch.reject({ runId: planned.runId, approverId: 'owner-001', reason: 'no', nowUnix: NOW + 1 });

      assert.equal(fx.orch.get(planned.runId).status, 'REJECTED');
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'original\n');
      assert.equal(readdirSync(fx.shadows).length, 0, 'the shadow of a rejected run survived');
    } finally { fx.cleanup(); }
  });

  test('CE-008: both shells offer the measurement, from the one registry they share', () => {
    // A criterion met in the engine and absent from a shell is met for nobody. The registry is
    // the single list both the browser and the terminal read (`CE-021`), so one assertion
    // covers both — and `two-shells-parity.test.mjs` is what keeps that true.
    const names = AGENT_COMMANDS.map((command) => command.name);
    assert.ok(names.includes('measure'), 'no shell can measure a plan');
    const measure = AGENT_COMMANDS.find((command) => command.name === 'measure');
    assert.equal(measure.method, 'workspace.measure');
    assert.equal(measure.permission, 'workspace.write');
  });

  // ── CE-026 · the guarantee one step later ─────────────────────────────────────────────────
  test('CE-026: what lands in the workspace is the shadow\'s bytes, and the shadow does not survive the call', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'promoted content\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
      fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW + 1 });

      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'promoted content\n');
      assert.equal(readdirSync(fx.shadows).length, 0, 'a shadow survived the call');
    } finally { fx.cleanup(); }
  });

  test('CE-026: a run whose verification was contradicted promotes nothing', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
      const planned = await fx.orch.plan({
        request: 'change a line',
        files: [{ path: 'a.txt', contents: 'changed\n' }],
        claims: [{ type: 'file_equals', path: 'a.txt', value: 'not what will be written' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      // The contradiction is found at MEASURE time now, which is the improvement: the approver
      // is told before deciding, instead of discovering it in the outcome of their own approval.
      const measured = fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
      assert.equal(measured.clean, false);
      assert.equal(measured.coverage.contradicted.length, 1);

      const decided = fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW + 1 });
      assert.equal(decided.promoted, false);
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'original\n');
      assert.equal(existsSync(join(fx.ws, 'a.txt')), true);
    } finally { fx.cleanup(); }
  });

  test('CE-008/CE-026: a measurement lost to a restart is re-taken, never promoted from memory of it', async () => {
    // The shadow is held in memory on purpose. `approve()` must refuse rather than promote a
    // result nobody can still look at — and `measure()` must be able to run again on that run,
    // or a restart would strand it.
    // A real restart, not a simulated one: a second orchestrator over the same run store, which
    // is what `durability.test.mjs` proves an operator actually gets back.
    const ws = mkdtempSync(join(tmpdir(), 'noesar-ce008-restart-ws-'));
    const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce008-restart-sh-'));
    const store = mkdtempSync(join(tmpdir(), 'noesar-ce008-restart-runs-'));
    const secret = randomBytes(32);
    // The ledger is durable too, or the second instance would carry no memory of the first
    // and every causation id would dangle — which is a property of THIS test, not of the
    // product: `durability.test.mjs` shows the same shape.
    const journalPath = join(store, 'engine-events.jsonl');
    const build = () => new WorkspaceActionOrchestrator({
      workspaceRoot: ws, shadowsRoot: shadows, minter: new TokenMinter(secret),
      events: EventLedger.loadFrom(journalPath), runStoreDirectory: store, env: {},
    });
    try {
      writeFileSync(join(ws, '.seed'), 'seed');
      writeFileSync(join(ws, 'a.txt'), 'original\n');
      const before = build();
      const planned = await before.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      before.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });

      const after = build();
      assert.equal(after.get(planned.runId).status, 'MEASURED');
      assert.throws(
        () => after.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW + 1 }),
        (error) => error instanceof WorkspaceActionError && error.kind === 'MEASUREMENT_LOST',
      );
      assert.equal(readFileSync(join(ws, 'a.txt'), 'utf8'), 'original\n');

      // …and the run is not stranded: it can be measured again and then approved.
      assert.equal(after.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW + 1 }).status, 'MEASURED');
      assert.equal(after.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW + 2 }).promoted, true);
      assert.equal(readFileSync(join(ws, 'a.txt'), 'utf8'), 'changed\n');
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(shadows, { recursive: true, force: true });
      rmSync(store, { recursive: true, force: true });
    }
  });

  test('CE-008: the status still declares what simulate() is, so the two are never confused', () => {
    // `simulate()` is the OPTIONAL provider prediction and answers `supported: false` on the
    // reference provider. `measure()` is the mandatory execution into a shadow. The gap this
    // criterion recorded came from expecting the first to do the second's job.
    const status = workspaceActionsStatus();
    assert.equal(status.simulationSupported, true);
    assert.match(status.simulationSupportedReason, /no token is minted and nothing is executed/);
  });
});
