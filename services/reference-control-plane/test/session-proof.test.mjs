// SPDX-License-Identifier: AGPL-3.0-or-later
// SESS-001 (MASTER_PROJECT/01_VISIONE_E_POSIZIONE.md): "un pacchetto con tutti e dieci i
// campi... test che verifica la presenza e la sorgente di ognuno dei dieci campi su una
// sessione reale". "Reale" here means a run that actually went through plan() → approve()
// against a real filesystem shadow, not a hand-built object shaped like one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { assembleSessionProof, SESSION_PROOF_FIELDS } from '../src/session-proof.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { derivePrivacy } from '../src/privacy.mjs';

function fixture() {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-sp-ws-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-sp-shadows-'));
  const events = new EventLedger();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events,
    privacyStateFor: () => derivePrivacy({ observed: true, providers: [], tools: [] }),
  });
  return { ws, shadows, orch, events };
}
function cleanup({ ws, shadows }) {
  rmSync(ws, { recursive: true, force: true });
  rmSync(shadows, { recursive: true, force: true });
}
const NOW = Math.floor(Date.now() / 1000);

test('SESSION_PROOF_FIELDS names exactly the ten fields of 01_VISIONE_E_POSIZIONE.md', () => {
  assert.equal(SESSION_PROOF_FIELDS.length, 10);
  for (const name of [
    'intento', 'ipotesi', 'piano', 'attesa', 'realta',
    'autorita', 'egress', 'provenienza', 'esito', 'fixture',
  ]) assert.ok(SESSION_PROOF_FIELDS.includes(name), name);
});

test('a promoted real run has all ten fields present, each traced to its real source', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'add a greeting file',
      files: [{ path: 'hello.txt', contents: 'hello\n' }],
      actor: 'owner-1', nowUnix: NOW,
    });
    fx.orch.measure({ runId: planned.runId, actor: 'owner-1', nowUnix: NOW + 1 });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner-1', nowUnix: NOW + 1 });
    assert.equal(approved.promoted, true);

    const proof = fx.orch.sessionProof(planned.runId);
    assert.equal(proof.version, '1.0.0');
    assert.equal(proof.runId, planned.runId);
    assert.equal(proof.status, 'PROMOTED');
    assert.equal(Object.keys(proof.fields).length, 10);

    for (const name of SESSION_PROOF_FIELDS) {
      const field = proof.fields[name];
      assert.ok(field, `field \`${name}\` missing`);
      assert.ok(field.source, `field \`${name}\` has no source on a decided, promoted run`);
      assert.notEqual(field.value, undefined, `field \`${name}\` has no value`);
    }

    // Traceability: each field's value is the real object another module produced, not a
    // paraphrase of it.
    assert.equal(proof.fields.intento.value.goal, planned.intent.goal);
    assert.deepEqual(proof.fields.piano.value, planned.plan);
    assert.deepEqual(proof.fields.attesa.value, planned.expectation);
    assert.equal(proof.fields.realta.value.result.ok, true);
    assert.equal(proof.fields.realta.value.diff[0].path, 'hello.txt');
    assert.equal(proof.fields.esito.value.promoted, true);

    const authority = proof.fields.autorita.value;
    assert.ok(authority.some((e) => e.action === 'capability.minted'));
    assert.ok(authority.some((e) => e.action === 'executor.ran'));

    const egress = proof.fields.egress.value;
    // Three samples since `D-0567`, not two: the run is now sampled where it is planned, where
    // it is MEASURED, and where it is approved. The measurement is the point at which the
    // engine has actually done something (it executed into a shadow), so an egress record that
    // skipped it would leave the most consequential moment of the run unsampled.
    assert.equal(egress.length, 3);
    assert.deepEqual(egress.map((sample) => sample.at), ['planned', 'measuring', 'approved']);
    assert.equal(egress[0].state, 'LOCAL_ONLY_VERIFIED');

    const provenance = proof.fields.provenienza.value;
    assert.equal(provenance.length, 1);
    assert.equal(provenance[0].path, 'hello.txt');
    assert.equal(provenance[0].contaminationState, 'UNTRACKED');

    assert.equal(proof.fields.fixture.value.request, 'add a greeting file');
    assert.deepEqual(proof.fields.fixture.value.files, [{ path: 'hello.txt', contents: 'hello\n' }]);
    assert.equal(proof.fields.fixture.value.replayable, 'DECISION_LAYER_ONLY');

    assert.equal(typeof proof.digest, 'string');
    assert.ok(proof.digest.length > 0);
  } finally { cleanup(fx); }
});

test('a run pending approval declares reality/outcome absent rather than fabricating them', async () => {
  const fx = fixture();
  try {
    const planned = await fx.orch.plan({
      request: 'edit', files: [{ path: 'a.txt', contents: 'x\n' }], actor: 'owner', nowUnix: NOW,
    });
    const proof = fx.orch.sessionProof(planned.runId);
    assert.equal(proof.status, 'PENDING_APPROVAL');
    assert.equal(proof.fields.realta.value, null);
    assert.equal(proof.fields.realta.source, null);
    assert.match(proof.fields.realta.reason, /PENDING_APPROVAL/);
    assert.equal(proof.fields.esito.value, null);
    // Fields that do exist before a decision are still real, not placeholders.
    assert.equal(proof.fields.intento.value.goal, planned.intent.goal);
    assert.equal(proof.fields.egress.value.length, 1);
    assert.equal(proof.fields.egress.value[0].at, 'planned');
  } finally { cleanup(fx); }
});

test('an orchestrator with no privacyStateFor reports an honest empty egress, not a fabricated state', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-sp-noeg-ws-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-sp-noeg-shadows-'));
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
  });
  try {
    const planned = await orch.plan({ request: 'x', files: [{ path: 'a.txt', contents: 'y\n' }], actor: 'o', nowUnix: NOW });
    const proof = orch.sessionProof(planned.runId);
    assert.deepEqual(proof.fields.egress.value, []);
    assert.equal(proof.fields.egress.source, null);
    assert.match(proof.fields.egress.reason, /no privacyStateFor/);
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(shadows, { recursive: true, force: true }); }
});

test('unknown runId returns null rather than an empty-shaped proof', () => {
  const fx = fixture();
  try {
    assert.equal(fx.orch.sessionProof('does-not-exist'), null);
  } finally { cleanup(fx); }
});

test('assembleSessionProof surfaces a capability.denied event in the authority timeline', () => {
  // Unit-level, on the pure assembler directly: proves the shape supports a denial without
  // needing to contrive a real mint refusal through the full plan/approve pipeline, which
  // the orchestrator's own validation makes deliberately hard to reach from a valid plan.
  const run = {
    runId: 'r1', status: 'REFUSED', intent: { goal: 'g' }, hypotheses: [], plan: { steps: [] },
    expectation: {}, files: [{ path: 'a.txt', contents: 'x' }], provenance: [],
    request: 'r', projectRules: [], constraints: [], mode: 'safe', policy: 'restrictive', claims: [],
    createdAtUnix: NOW, decidedAtUnix: NOW + 1, egressSamples: [], risk: { overall: 'LOW' },
    result: null, diff: [], coverage: { declaration: 0, total: 0, recomputed: 0, contradicted: [] },
  };
  const events = [{
    id: 'e1', correlationId: 'r1', causationId: null, actor: 'owner', action: 'capability.denied',
    payload: JSON.stringify({ stepId: 'step-1', kind: 'OUT_OF_SCOPE', reason: 'the requested limits exceed what step `step-1` grants' }),
    recordedAtUnix: NOW,
  }];
  const proof = assembleSessionProof({ run, events });
  const authority = proof.fields.autorita.value;
  assert.equal(authority.length, 1);
  assert.equal(authority[0].action, 'capability.denied');
  assert.equal(authority[0].details.kind, 'OUT_OF_SCOPE');
});
