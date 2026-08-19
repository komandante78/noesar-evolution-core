// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-021` — *«Le due shell mostrano la stessa sessione viva, e staccarsi non ferma il compito»*
// (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **H**), verification method
// *«avvio in una shell, distacco, aggancio dall'altra»*.
//
// # Two halves, and only one of them was ever measured
//
// **«la stessa sessione viva»** is already proven, over real sockets, by
// `coden-bridge.test.mjs`: two viewports of one account see each other (`viewport.list`), a
// resize is announced to the siblings, and a **mutating** call broadcasts `session.changed`
// while a read-only one deliberately does not. That file is cited here rather than duplicated.
//
// **«staccarsi non ferma il compito»** had no row at all. `two-shells-parity.test.mjs` carries a
// suite *titled* `CE-021 — the two shells cannot drift apart unnoticed`, and it measures the
// permission policy — a different claim wearing this criterion's name, which is precisely the
// trap `noesar-evolution` rule 5 names: a criterion no row measures is not closed, however often
// the title says otherwise.
//
// So this file measures the unmeasured half, by the criterion's own method: start the work
// through one transport, drop that transport, and finish the work from another.
//
// # Why "drop the transport" is the honest way to model a detach
//
// A detach is not a cancel. The shell goes away; the engine does not hear about it and has no
// reason to. So the test starts a run through caller A, discards A entirely — its dispatch
// closure, its pending promise, its identity as a caller — and then reaches the SAME engine
// through a caller built afterwards. If the run had lived in the shell, B would find nothing.
//
// # The negative control, which is what stops this passing vacuously
//
// A second orchestrator is built over the same workspace and asked for the same run. It must
// NOT find it. Without that, "B sees the run" would be satisfied by any test that simply asked
// the object it had just created — and "the two shells share one live session" would be a
// sentence about a variable name.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { createSessionDispatch } from '../src/session-protocol.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { freshTempDir } from './support/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const ACTOR = 'owner-001';

/** One engine, and the workspace it owns. Two callers are built over it below — that is the
 *  whole design: `createSessionDispatch`'s own doc comment says a second orchestrator would give
 *  the terminal its own runs, invisible to the browser. */
function engine() {
  const ws = freshTempDir('noesar-ce021-ws-');
  const shadows = freshTempDir('noesar-ce021-sh-');
  writeFileSync(join(ws, '.seed'), 'seed');
  writeFileSync(join(ws, 'note.txt'), 'before\n');
  const workspaceActions = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), env: {}, author: null,
  });
  return { ws, shadows, workspaceActions };
}

/** A transport. Nothing about it is shared with the next one except the engine it was handed. */
const shell = (workspaceActions) => createSessionDispatch({
  workspaceActions,
  capabilityMinter: new TokenMinter(randomBytes(32)),
  capabilityStatus: () => ({}),
  ledger: { append: () => {} },
});

const call = (dispatch, method, params) => dispatch(method, params, ACTOR, () => true);

describe('CE-021 — detaching does not stop the task', () => {
  test('a run started in one shell is found, and finished, from a shell built after the first is gone', async () => {
    const { ws, workspaceActions } = engine();

    // ── shell A: start the work ───────────────────────────────────────────────────────────
    let shellA = shell(workspaceActions);
    const started = await call(shellA, 'workspace.plan', {
      request: 'change the note', files: [{ path: 'note.txt', contents: 'after\n' }],
    });
    assert.ok(started.runId, 'the plan did not start');
    assert.equal(started.status, 'PENDING_APPROVAL');

    // ── the detach ────────────────────────────────────────────────────────────────────────
    // A is discarded entirely. No close, no cancel, no notification — a detached shell tells
    // the engine nothing, which is exactly why the task must not depend on it.
    shellA = null;

    // ── shell B: attach and finish it ─────────────────────────────────────────────────────
    const shellB = shell(workspaceActions);
    const seen = await call(shellB, 'workspace.get', { runId: started.runId });
    assert.equal(seen.runId, started.runId, 'the second shell cannot see the first shell\'s run');
    assert.equal(seen.status, 'PENDING_APPROVAL', 'the run changed state when its shell went away');

    // And it is not merely visible: it is still ACTIONABLE. A run that could be read but not
    // continued would be a record of a task, not a live one.
    const measured = await call(shellB, 'workspace.measure', { runId: started.runId });
    assert.ok(measured, 'the run could not be measured from the second shell');
    const approved = await call(shellB, 'workspace.approve', { runId: started.runId });
    assert.ok(approved, 'the run could not be approved from the second shell');

    // The work reached the workspace — the task finished, started by a shell that no longer
    // exists. This is the byte-level end of "staccarsi non ferma il compito".
    assert.equal(readFileSync(join(ws, 'note.txt'), 'utf8'), 'after\n',
      'the promoted bytes are not in the workspace: the task did not survive the detach');
  });

  test('negative control — a second engine does NOT see the run, so "the same session" is a real property', async () => {
    const first = engine();
    const started = await call(shell(first.workspaceActions), 'workspace.plan', {
      request: 'change the note', files: [{ path: 'note.txt', contents: 'after\n' }],
    });

    // Same workspace on disk, a different engine over it — which is what a second orchestrator
    // constructed by a second transport would be.
    const second = new WorkspaceActionOrchestrator({
      workspaceRoot: first.ws, shadowsRoot: first.shadows,
      minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), env: {}, author: null,
    });
    await assert.rejects(
      () => call(shell(second), 'workspace.get', { runId: started.runId }),
      (error) => { assert.equal(error.kind, 'NOT_FOUND'); return true; },
      'a SECOND engine found the run — then the test above proves nothing about sharing one',
    );
  });

  test('both transports are handed the same engine, and neither constructs one of its own', () => {
    const source = readFileSync(join(REPO_ROOT, 'services/reference-control-plane/src/server.mjs'), 'utf8');
    const constructions = [...source.matchAll(/new WorkspaceActionOrchestrator\(/g)];
    assert.equal(constructions.length, 1,
      `server.mjs constructs ${constructions.length} orchestrators — the shells would have that many `
      + 'sets of runs, and CE-021 would be false by construction rather than by accident');

    // The one dispatch built over it is what both transports are given: the socket server and
    // the browser bridge. Two dispatches would be two closures over the same engine, which is
    // harmless — two ENGINES would not be, and that is what the count above pins.
    const dispatches = [...source.matchAll(/createSessionDispatch\(/g)];
    assert.equal(dispatches.length, 1, 'server.mjs builds more than one dispatch');
    assert.match(source, /createCodenBridge\(\{[\s\S]{0,400}?dispatch/,
      'the browser bridge is not handed the dispatch — it would be reaching a different engine');
    assert.match(source, /startUnixSocketServer\(\{[\s\S]{0,400}?dispatch/,
      'the terminal socket is not handed the dispatch');
  });

  test('the live-session half is measured elsewhere, and the file that measures it still does', () => {
    // Cited, not duplicated — and checked, so the citation cannot go stale silently.
    const bridge = readFileSync(join(REPO_ROOT, 'services/reference-control-plane/test/coden-bridge.test.mjs'), 'utf8');
    for (const claim of [
      /viewport\.list/,
      /a mutating call tells the sibling viewports; a read-only one does not/,
      /a resize is announced to the siblings/,
    ]) {
      assert.match(bridge, claim,
        'coden-bridge.test.mjs no longer proves the "same live session" half CE-021 leans on it for');
    }
  });
});
