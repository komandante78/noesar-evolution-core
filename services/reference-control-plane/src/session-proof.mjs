// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SESS-001 (MASTER_PROJECT/01_VISIONE_E_POSIZIONE.md §"Il prodotto della posizione"): every
// authorised session emits a package with all ten fields — intent, hypotheses, plan,
// expectation, reality, authority, egress, provenance, outcome, fixture. This module does not
// invent any of the ten: each is read from the object that already produces it during a real
// plan()/approve() cycle (workspace-actions.mjs) and its causal event correlation
// (events.mjs). Nothing here is a second implementation of a decision another module already
// makes — it is only the seam that gathers what already exists into one signed shape.
//
// A field that has no real source yet is REPORTED as absent — never filled with a plausible
// value. `provenienza`'s contamination tracking is the clearest case: MEVCM/CUBE-001..009
// (docs/SESSION_HANDOFF.md) does not exist, so every source this run touched is reported
// UNTRACKED rather than quietly marked clean. A Session Proof that hides its own gaps is worse
// than one with none, for the same reason a privacy banner that claims LOCAL_ONLY_VERIFIED
// without checking would be worse than STATUS_UNKNOWN.

export const SESSION_PROOF_VERSION = '1.0.0';
export const SESSION_PROOF_FIELDS = Object.freeze([
  'intento', 'ipotesi', 'piano', 'attesa', 'realta',
  'autorita', 'egress', 'provenienza', 'esito', 'fixture',
]);

const NOT_DECIDED_YET = (run) => `run \`${run.runId}\` is ${run.status}; this field does not exist before approve() decides the run`;

function digest(entries) {
  // No cryptographic signature yet (SESS-002/003's replay engine is the natural place to add
  // one, since a signature over a package nothing can re-derive is decoration) — a content
  // digest so two copies of the same proof can be compared byte-for-byte, honestly labelled.
  const text = JSON.stringify(entries);
  let hash = 0n;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31n + BigInt(text.charCodeAt(index))) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

function authorityTimeline(events) {
  const relevant = events.filter((event) => [
    'capability.minted', 'capability.denied', 'capability.revoked', 'executor.ran',
  ].includes(event.action));
  return relevant.map((event) => ({
    action: event.action, actor: event.actor, at: event.recordedAtUnix,
    details: JSON.parse(event.payload || '{}'),
  }));
}

function provenanceOf(run) {
  // The only sources this reference implementation reads for the trivial-risk path: the files
  // the caller supplied to plan(). Anything a future memory/RAG surface reads belongs to
  // CUBE-001..009, not to this field's source — reporting it here before that subsystem exists
  // would attribute contamination tracking to a run that never had any.
  return run.files.map((file) => ({
    path: file.path,
    sizeBytes: Buffer.byteLength(file.contents, 'utf8'),
    contaminationState: 'UNTRACKED',
    contaminationReason: 'MEVCM/CUBE-001..009 is not built yet (docs/SESSION_HANDOFF.md) — this source is neither vouched for nor flagged, only named.',
  }));
}

function fixtureOf(run) {
  return {
    request: run.request,
    files: run.files.map((file) => ({ path: file.path, contents: file.contents })),
    projectRules: run.projectRules, constraints: run.constraints,
    mode: run.mode, policy: run.policy, claims: run.claims,
    plannedAtUnix: run.createdAtUnix, decidedAtUnix: run.decidedAtUnix ?? null,
    replayable: 'DECISION_LAYER_ONLY',
    replayableReason: '11_REVISIONE_E_CORREZIONI.md P1: re-running these inputs through the same reference provider reproduces the same decisions, because the reference provider is a pure function of them (no model call to be non-deterministic about). Model output fixtures for an EXTERNAL provider are not captured by this reference orchestrator — SESS-002 (the replay engine) is where that capture belongs, and it has not been built.',
  };
}

/**
 * @param {object} run     one entry of WorkspaceActionOrchestrator's internal run map
 * @param {object[]} events this run's correlation from EventLedger.correlation(runId)
 */
export function assembleSessionProof({ run, events }) {
  const decided = run.status !== 'PENDING_APPROVAL';
  const fields = {
    intento: { source: 'ReferenceReasoningProvider.interpret(), recorded on the run at plan()', value: run.intent },
    ipotesi: { source: 'ReferenceReasoningProvider.hypothesize(), recorded on the run at plan()', value: run.hypotheses },
    piano: { source: `ReasoningRouter.buildPlan()+constrain() — provenance: ${JSON.stringify(run.provenance)}`, value: run.plan },
    attesa: { source: 'ReferenceReasoningProvider.expect(), recorded on the run at plan()', value: run.expectation },
    realta: decided
      ? { source: 'executor.mjs execute() against the whole-workspace shadow, plus workspace-actions.mjs#diff()', value: { result: run.result, diff: run.diff } }
      : { source: null, value: null, reason: NOT_DECIDED_YET(run) },
    autorita: { source: 'EventLedger.correlation(runId), filtered to capability.* and executor.ran', value: authorityTimeline(events) },
    egress: {
      source: run.egressSamples.length ? 'privacy.mjs derivePrivacy(), sampled by the orchestrator\'s privacyStateFor() at plan() and approve()' : null,
      value: run.egressSamples,
      ...(run.egressSamples.length ? {} : { reason: 'no privacyStateFor was configured on this WorkspaceActionOrchestrator instance' }),
    },
    provenienza: { source: 'the `files` array supplied to plan() by the caller — the only sources this reference implementation reads', value: provenanceOf(run) },
    esito: decided
      ? { source: 'workspace-actions.mjs#diff() + verification.mjs projectionCoverage() + ReferenceReasoningProvider.classify()', value: { diff: run.diff, coverage: run.coverage, risk: run.risk, promoted: run.status === 'PROMOTED', notDone: run.status === 'REFUSED' ? 'nothing was promoted' : null } }
      : { source: null, value: null, reason: NOT_DECIDED_YET(run) },
    fixture: { source: 'the exact inputs given to plan(), stored on the run', value: fixtureOf(run) },
  };
  for (const name of SESSION_PROOF_FIELDS) {
    if (!(name in fields)) throw new Error(`session-proof.mjs is missing field \`${name}\` — SESS-001 requires all ten`);
  }
  return {
    version: SESSION_PROOF_VERSION,
    runId: run.runId,
    status: run.status,
    generatedAtUnix: Math.floor(Date.now() / 1000),
    fields,
    digest: digest(fields),
  };
}
