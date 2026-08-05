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
import { createServer } from 'node:http';
import {
  WorkspaceActionOrchestrator, WorkspaceActionError, workspaceActionsStatus,
} from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { ReasoningRouter, ReasoningUnavailable } from '../src/reasoning-router.mjs';

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
test('the orchestrator refuses at construction if shadowsRoot is nested inside workspaceRoot', async () => {
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

test('plan → approve promotes a real file write and modification', async () => {
  const fx = fixture();
  try {
    mkdirSync(join(fx.ws, 'existing'), { recursive: true });
    writeFileSync(join(fx.ws, 'existing/a.txt'), 'original\n');
    const planned = await fx.orch.plan({
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

test('plan() answers with the run\'s status — the caller must not have to assume one', async () => {
  // Phase 5 of CodeN Evolution (D-0301). This field was missing, and BOTH shells filled the
  // hole with the same constant: the browser stitched `{...planned, status:'PENDING_APPROVAL'}`
  // onto the answer and the terminal printed `status: PENDING_APPROVAL`, each showing as the
  // engine's word a state the engine had never said. It happened to be true, which is what
  // kept it invisible. So the assertion is not "it says PENDING_APPROVAL" on its own but "it
  // says what the run says": a mode that plans into another state must carry both clients
  // with it rather than leave them reporting this one.
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'status', files: [{ path: 's.txt', contents: 'x\n' }], actor: 'owner', nowUnix: NOW });
    assert.equal(planned.status, fx.orch.get(planned.runId).status);
    assert.equal(planned.status, 'PENDING_APPROVAL');
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(fx.orch.get(planned.runId).status, 'PROMOTED');

    // And the shape, because behaviour cannot tell the difference and that is the whole
    // point of the defect: every plan this build makes is PENDING_APPROVAL, so a hardcoded
    // `status: 'PENDING_APPROVAL'` in the return would pass every assertion above — it is
    // precisely the constant the two shells were printing before phase 5. Pinning the read
    // is the only thing that distinguishes "the engine said so" from "the engine happens to
    // agree". Found by mutating the return to that constant and watching nothing fail.
    const source = readFileSync(new URL('../src/workspace-actions.mjs', import.meta.url), 'utf8');
    const planBody = source.slice(source.indexOf('  async plan({'), source.indexOf('   * What would this plan do'));
    assert.ok(planBody.length > 500, 'plan() moved; this test cannot see its return');
    assert.match(planBody, /return \{ runId, status: this\.#runs\.get\(runId\)\.status,/,
      'plan() states a status instead of reading the run\'s own');
  } finally { cleanup(fx); }
});

test('the diff shows real before/after content for every touched file', async () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.ws, 'a.txt'), 'before\n');
    const planned = await fx.orch.plan({ request: 'edit', files: [{ path: 'a.txt', contents: 'after\n' }], actor: 'owner', nowUnix: NOW });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(approved.diff.length, 1);
    assert.equal(approved.diff[0].status, 'MODIFIED');
    assert.equal(approved.diff[0].before, 'before\n');
    assert.equal(approved.diff[0].after, 'after\n');
    assert.equal(approved.diff[0].diffAvailable, true);
  } finally { cleanup(fx); }
});

test('a created file diffs with before:null', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'create', files: [{ path: 'new.txt', contents: 'x\n' }], actor: 'owner', nowUnix: NOW });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(approved.diff[0].status, 'CREATED');
    assert.equal(approved.diff[0].before, null);
  } finally { cleanup(fx); }
});

test('restore writes back exactly the original bytes, and deletes a file that did not exist before', async () => {
  const fx = fixture();
  try {
    mkdirSync(join(fx.ws, 'existing'), { recursive: true });
    writeFileSync(join(fx.ws, 'existing/a.txt'), 'original content\n');
    const planned = await fx.orch.plan({
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

test('every step of a promoted run is recorded in the causal event ledger, chained', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    const chain = fx.events.correlation(planned.runId).map((event) => event.action);
    assert.deepEqual(chain, [
      'workspace_action.planned', 'workspace_action.approved', 'capability.minted',
      'executor.ran', 'shadow.compared', 'workspace_action.claims_verified', 'workspace_action.promoted',
    ]);
    assert.equal(fx.events.verify().valid, true);
  } finally { cleanup(fx); }
});

// --- the recompute verifier, wired: D-0209, CodeN Evolution construction order step 9 ---

test('a matching claim promotes normally and reports complete coverage', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW,
      claims: [{ type:'file_equals', path:'x.txt', value:'hi' }],
    });
    const { promoted, coverage } = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(promoted, true);
    assert.equal(coverage.complete, true);
    assert.equal(coverage.contradicted.length, 0);
    assert.equal(readFileSync(join(fx.ws, 'x.txt'), 'utf8'), 'hi');
  } finally { cleanup(fx); }
});

test('a CONTRADICTED claim refuses promotion even though the path comparison was clean', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW,
      claims: [{ type:'file_equals', path:'x.txt', value:'this is not what got written' }],
    });
    const { promoted, coverage } = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(promoted, false);
    assert.equal(coverage.contradicted.length, 1);
    assert.equal(existsSync(join(fx.ws, 'x.txt')), false);
  } finally { cleanup(fx); }
});

test('an unrecomputable (behavioural) claim does not block promotion — a coverage gap, not a contradiction', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW,
      claims: [{ type:'behavioural', description:'unrecomputable on purpose' }],
    });
    const { promoted, coverage } = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(promoted, true);
    assert.equal(coverage.complete, false);
    assert.equal(coverage.unrecomputed.length, 1);
    assert.equal(coverage.contradicted.length, 0);
  } finally { cleanup(fx); }
});

test('no claims declared: coverage says so explicitly, still promotes', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    const { promoted, coverage } = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(promoted, true);
    assert.equal(coverage.total, 0);
    assert.match(coverage.declaration, /no claims were declared/);
  } finally { cleanup(fx); }
});

test('the claims_verified ledger event records the declaration even on a refused run', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW,
      claims: [{ type:'file_equals', path:'x.txt', value:'wrong' }],
    });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    const event = fx.events.correlation(planned.runId).find((e) => e.action === 'workspace_action.claims_verified');
    assert.ok(event);
    const details = JSON.parse(event.payload);
    assert.equal(details.contradicted, 1);
  } finally { cleanup(fx); }
});

// --- the adversarial half: proving it never exits its authority -------------

// These three replace one test that asserted `NO_FILES`: a plan naming no files was refused
// outright, which is why both shells' `/plan` could never do anything — s319's terminal sent
// `files: []` on every one of them.
//
// The refusal is gone; the property it protected is not, and the property is what is
// asserted here. Its own words were "the reference provider has no model and cannot invent a
// target from prose alone". Grounding does not give it one: it asks the REPOSITORY, by
// literal search over the interpreted goal, so the model's only influence on which files are
// chosen is the goal it returned. The first test therefore does not check that an empty list
// is accepted — it checks that every file such a plan touches exists in the workspace.
test('a request with no files is grounded in the repository, and every file it plans on is real', async () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.ws, 'greeting.txt'), 'the greeting shown at startup\n');
    writeFileSync(join(fx.ws, 'unrelated.txt'), 'nothing to do with it\n');
    const planned = await fx.orch.plan({ request: 'adjust the greeting', files: [], actor: 'x', nowUnix: NOW });
    assert.ok(planned.grounding, 'a plan built from prose must say that its files were derived');
    assert.equal(planned.grounding.derived, true);
    assert.ok(planned.grounding.terms.includes('greeting'), 'the terms searched for must be reported, not hidden');
    const touched = planned.plan.steps.flatMap((step) => step.files);
    assert.ok(touched.length > 0, 'grounding produced a plan that touches nothing');
    for (const path of touched) {
      assert.ok(existsSync(join(fx.ws, path)),
        `the plan names \`${path}\`, which is not in the workspace — a path reached the plan without coming from the repository`);
    }
    assert.ok(touched.includes('greeting.txt'), 'the file the goal points at was not selected');
  } finally { cleanup(fx); }
});

test('a request that matches nothing is refused, and the refusal names what it searched for', async () => {
  const fx = fixture();
  try {
    await assert.rejects(
      async () => fx.orch.plan({ request: 'zzqqxx unobtainium', files: [], actor: 'x', nowUnix: NOW }),
      (error) => {
        assert.ok(error instanceof WorkspaceActionError);
        assert.equal(error.kind, 'NO_CANDIDATES');
        // The whole point of replacing `NO_FILES`: a refusal that says what to do next
        // instead of only that the caller held it wrong.
        assert.match(error.message, /zzqqxx/);
        return true;
      },
    );
  } finally { cleanup(fx); }
});

test('naming files still overrules the search — grounding widens what CAN be planned, never what WAS', async () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.ws, 'greeting.txt'), 'the greeting shown at startup\n');
    const planned = await fx.orch.plan({
      request: 'adjust the greeting',
      files: [{ path: 'chosen.txt', contents: 'named by the caller' }],
      actor: 'x', nowUnix: NOW,
    });
    assert.equal(planned.grounding, null, 'a caller who named files must not be told something was derived');
    assert.deepEqual(planned.plan.steps.flatMap((step) => step.files), ['chosen.txt'],
      'the search replaced a choice the caller had already made');
  } finally { cleanup(fx); }
});

test('a path that leaves the workspace is refused at plan time, before any token exists', async () => {
  const fx = fixture();
  try {
    await assert.rejects(
      async () => fx.orch.plan({ request: 'escape', files: [{ path: '../../../etc/passwd', contents: 'pwned' }], actor: 'x', nowUnix: NOW }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'CONSTRAINED_AWAY',
    );
    assert.equal(existsSync('/etc/passwd-noesar-test'), false);
  } finally { cleanup(fx); }
});

test('the same run cannot be approved twice', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'x.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.throws(
      () => fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 2 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'ALREADY_DECIDED',
    );
  } finally { cleanup(fx); }
});

test('a rejected run cannot later be approved', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'y.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.reject({ runId: planned.runId, approverId: 'owner', reason: 'no', nowUnix: NOW + 1 });
    assert.throws(
      () => fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 2 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'ALREADY_DECIDED',
    );
    assert.equal(existsSync(join(fx.ws, 'y.txt')), false);
  } finally { cleanup(fx); }
});

test('an approval with no approver is refused and nothing is written', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'z.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    assert.throws(
      () => fx.orch.approve({ runId: planned.runId, approverId: '', nowUnix: NOW + 1 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'NO_APPROVER',
    );
    assert.equal(existsSync(join(fx.ws, 'z.txt')), false);
  } finally { cleanup(fx); }
});

test('an unknown run id is refused on approve, reject and restore alike', async () => {
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

test('a run that was never promoted cannot be restored', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.reject({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.throws(
      () => fx.orch.restore({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 2 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'NOT_PROMOTED',
    );
  } finally { cleanup(fx); }
});

test('a promoted run cannot be restored twice', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    fx.orch.restore({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 2 });
    assert.throws(
      () => fx.orch.restore({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 3 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'ALREADY_RESTORED',
    );
  } finally { cleanup(fx); }
});

test('two independent runs against two different workspaces never cross-contaminate', async () => {
  const fx1 = fixture();
  const fx2 = fixture();
  try {
    const p1 = await fx1.orch.plan({ request: 'write 1', files: [{ path: 'one.txt', contents: '1' }], actor: 'owner', nowUnix: NOW });
    const p2 = await fx2.orch.plan({ request: 'write 2', files: [{ path: 'two.txt', contents: '2' }], actor: 'owner', nowUnix: NOW });
    const a1 = fx1.orch.approve({ runId: p1.runId, approverId: 'owner', nowUnix: NOW + 1 });
    const a2 = fx2.orch.approve({ runId: p2.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(a1.promoted, true);
    assert.equal(a2.promoted, true);
    assert.equal(existsSync(join(fx1.ws, 'two.txt')), false);
    assert.equal(existsSync(join(fx2.ws, 'one.txt')), false);
  } finally { cleanup(fx1); cleanup(fx2); }
});

test('a write with no actual effect is refused, not silently promoted as a success', async () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.ws, 'nochange.txt'), 'already this');
    const planned = await fx.orch.plan({ request: 'no-op', files: [{ path: 'nochange.txt', contents: 'already this' }], actor: 'owner', nowUnix: NOW });
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

test('there is no way to ask this wiring for a destructive step — plan() always builds WRITE-only blast radii', async () => {
  const fx = fixture();
  try {
    // DELETE and EXECUTE are refused by construction, not by a policy a caller could weaken:
    // orch.plan() has no parameter that reaches `destructive`, and approve() only ever builds
    // WRITE actions. workspaceActionsStatus() declares the same boundary.
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'a.txt', contents: 'x' }], actor: 'owner', nowUnix: NOW });
    assert.equal(planned.plan.steps[0].blastRadius.destructive, false);
  } finally { cleanup(fx); }
});

// --- status honesty -----------------------------------------------------------

test('status declares the trivial-path scope and the test-execution boundary, not a stronger claim', async () => {
  const status = workspaceActionsStatus();
  assert.deepEqual(status.operationsSupported, ['WRITE']);
  assert.ok(status.operationsNotSupported.includes('DELETE'));
  assert.ok(status.operationsNotSupported.includes('EXECUTE'));
  assert.equal(status.testExecution, false);
  assert.equal(status.runsPersistAcrossRestart, false);
  assert.match(status.testExecutionReason, /EXECUTE/);
});

// --- the reasoning provider on the path that actually acts --------------------
//
// Until this wiring existed, `plan()` built a ReferenceReasoningProvider directly. An
// operator could select an external provider and the one path that mints a capability token
// and writes a real file went on asking the reference one, silently. These tests exist so
// that regressing to that is a red line, not an invisible reversal.

/** A stand-in external provider over real HTTP. Records what it was asked. */
async function stubProvider(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const request = { path: req.url, body: body ? JSON.parse(body) : null };
      seen.push(request);
      const { status, payload } = handler(request);
      const text = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}
function externalEnv(endpoint, surfaces, extra = {}) {
  return {
    NOESAR_REASONING_MODE: 'rust-external',
    NOESAR_RUST_REASONING_ENDPOINT: endpoint,
    NOESAR_RUST_REASONING_TOKEN: 'a-token-long-enough-for-the-daemon',
    NOESAR_EXTERNAL_SURFACES: surfaces,
    ...extra,
  };
}
function routedFixture(env) {
  const fx = fixture();
  const routed = new WorkspaceActionOrchestrator({
    workspaceRoot: fx.ws, shadowsRoot: fx.shadows,
    minter: new TokenMinter(randomBytes(32)), events: fx.events,
    reasoningFor: () => new ReasoningRouter({ workspaceRoot: fx.ws, env }),
  });
  return { ...fx, orch: routed };
}

test('with no external provider, plan() records that the reference answered every surface', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW,
    });
    assert.ok(Array.isArray(planned.provenance) && planned.provenance.length > 0);
    assert.ok(planned.provenance.every((entry) => entry.provider === 'reference'));
    // The surfaces plan() actually consults, named rather than counted: a future edit that
    // drops one would otherwise still satisfy "every entry is the reference provider".
    assert.deepEqual(planned.provenance.map((entry) => entry.surface),
      ['interpret', 'hypothesize', 'constrain', 'classify', 'confidence', 'expect']);
  } finally { cleanup(fx); }
});

test('a selected external provider answers on the path that mints a token', async () => {
  const stub = await stubProvider(() => ({
    status: 200,
    payload: { ok: true, value: { tests: [], diffTouches: ['a.txt'], mustFail: [], observable: true } },
  }));
  const fx = routedFixture(externalEnv(stub.endpoint, 'expect'));
  try {
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW,
    });
    const bySurface = Object.fromEntries(planned.provenance.map((e) => [e.surface, e.provider]));
    assert.equal(bySurface.expect, 'atom');
    assert.equal(bySurface.interpret, 'reference');
    assert.equal(stub.seen.at(-1).path, '/v1/expect');
    // The run keeps it, not just the response: an approver deciding tomorrow has to be able
    // to see which provider produced the expectation they are approving against.
    assert.equal(fx.orch.get(planned.runId).provenance.find((e) => e.surface === 'expect').provider, 'atom');
  } finally { stub.close(); cleanup(fx); }
});

test('a selected provider that is unreachable makes plan() unavailable, never refused', async () => {
  // 422 "refused" would tell the caller their plan was rejected. Nothing was rejected — the
  // provider they chose was not there, and those are opposite facts about the same run.
  //
  // Phase 6 (`D-0312`) made carrying on the DEFAULT, so this classification is asserted in the
  // configuration that still raises — the installation that chose to stop rather than degrade.
  // The distinction itself is unchanged, and is exactly what `NOESAR_ATOM_FALLBACK=off` buys.
  const fx = routedFixture(externalEnv('http://127.0.0.1:1', 'expect', { NOESAR_ATOM_FALLBACK: 'off' }));
  try {
    await assert.rejects(
      () => fx.orch.plan({ request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW }),
      (error) => error instanceof ReasoningUnavailable && !(error instanceof WorkspaceActionError),
    );
  } finally { cleanup(fx); }
});

test('by default that same run carries on, and the answer says it degraded', async () => {
  // The phase-6 half of the pair above, on the orchestrator rather than the router: the caller
  // gets a plan AND is told, on the same answer, that ATOM did not produce it.
  const fx = routedFixture(externalEnv('http://127.0.0.1:1', 'expect'));
  try {
    const planned = await fx.orch.plan({ request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW });
    assert.equal(planned.status, 'PENDING_APPROVAL', 'the session stopped instead of carrying on');
    assert.equal(planned.reasoning.degraded, true, 'it carried on without saying so — the silent fallback');
    assert.equal(planned.reasoning.provider, 'reference');
    assert.ok(planned.reasoning.surfaces.includes('expect'));
    assert.ok(planned.reasoning.reasons.some((reason) => /could not be reached/.test(reason)));
    assert.ok(Number.isFinite(planned.reasoning.firstAtUnix), 'degraded, but the answer does not say when');
  } finally { cleanup(fx); }
});

// --- simulate: asking what a plan would do, without doing it ------------------

test('simulate answers `supported: false` with the reference provider, and executes nothing', async () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'a.txt', contents: 'changed\n' }], actor: 'owner', nowUnix: NOW,
    });
    const outcome = await fx.orch.simulate({ runId: planned.runId, actor: 'owner', nowUnix: NOW });
    assert.equal(outcome.simulation.supported, false);
    assert.equal(outcome.executed, false);
    // The three things a simulation must not have done, checked rather than assumed.
    assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'original\n');
    assert.equal(fx.orch.get(planned.runId).status, 'PENDING_APPROVAL');
    assert.equal(existsSync(join(fx.shadows, `${planned.runId}-simulate`)), false);
  } finally { cleanup(fx); }
});

test('a routed simulate carries the prediction through unchanged, and still executes nothing', async () => {
  // Recorded at the moment the provider is asked. Without it the "discarded afterwards"
  // assertion below would pass just as happily against a shadow that was never built — it
  // would prove nothing about the cleanup, and would hide a provider handed an empty path.
  const sawShadow = {};
  const stub = await stubProvider((request) => {
    if (request.path === '/v1/simulate') {
      const root = request.body.shadowWorkspace;
      sawShadow.existed = existsSync(root);
      sawShadow.carriedTheWorkspace = existsSync(join(root, 'a.txt'));
      return { status: 200, payload: { ok: true, value: { supported: true, predictedDiff: ['M a.txt'], predictedResult: 'one file modified', executed: false } } };
    }
    return { status: 200, payload: { ok: true, value: { tests: [], diffTouches: ['a.txt'], mustFail: [], observable: true } } };
  });
  const fx = routedFixture(externalEnv(stub.endpoint, 'simulate'));
  try {
    writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'a.txt', contents: 'changed\n' }], actor: 'owner', nowUnix: NOW,
    });
    const outcome = await fx.orch.simulate({ runId: planned.runId, actor: 'owner', nowUnix: NOW });
    assert.equal(outcome.simulation.supported, true);
    assert.deepEqual(outcome.simulation.predictedDiff, ['M a.txt']);
    assert.deepEqual(outcome.provenance, [{ surface: 'simulate', provider: 'atom' }]);
    // The provider is handed a shadow, never the real workspace: predicting must not be a
    // path by which something reads — or comes to write — the tree it is predicting about.
    const asked = stub.seen.find((r) => r.path === '/v1/simulate');
    assert.notEqual(asked.body.shadowWorkspace, fx.ws);
    assert.ok(asked.body.shadowWorkspace.startsWith(fx.shadows));
    assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'original\n');
    // In this order: it was there and it carried the workspace when the provider was asked,
    // and it was gone once the answer came back.
    assert.equal(sawShadow.existed, true, 'the shadow must exist while the provider is reading it');
    assert.equal(sawShadow.carriedTheWorkspace, true, 'a shadow the provider cannot read the workspace in is not a shadow');
    assert.equal(existsSync(asked.body.shadowWorkspace), false, 'the shadow is discarded before the answer is returned');
  } finally { stub.close(); cleanup(fx); }
});

test('simulating a run that was already decided is refused, not answered about the past', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'write', files: [{ path: 'a.txt', contents: 'hi' }], actor: 'owner', nowUnix: NOW,
    });
    fx.orch.reject({ runId: planned.runId, approverId: 'owner', reason: 'no', nowUnix: NOW });
    await assert.rejects(
      () => fx.orch.simulate({ runId: planned.runId, actor: 'owner', nowUnix: NOW }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'ALREADY_DECIDED',
    );
  } finally { cleanup(fx); }
});

test('status declares the routing and the cross-process limit of simulate', async () => {
  const status = workspaceActionsStatus();
  assert.equal(status.reasoningRouted, true);
  assert.equal(status.simulationSupported, true);
  // The limit is declared in the product's own status, not only in a document: a provider in
  // another process cannot read a path it has no mount onto, and that is the honest state.
  assert.match(status.simulationCrossProcessLimit, /PATH/);
});
