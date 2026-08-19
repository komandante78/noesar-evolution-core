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

import { DECISION_SURFACES } from './session-replay.mjs';
import { degradationSummary } from './reasoning-router.mjs';

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
  const usedExternal = (run.provenance ?? []).some((entry) => entry.provider === 'atom' && DECISION_SURFACES.includes(entry.surface));
  const base = {
    request: run.request,
    files: run.files.map((file) => ({ path: file.path, contents: file.contents })),
    projectRules: run.projectRules, constraints: run.constraints,
    mode: run.mode, policy: run.policy, claims: run.claims,
    plannedAtUnix: run.createdAtUnix, decidedAtUnix: run.decidedAtUnix ?? null,
  };
  if (!usedExternal) {
    return {
      ...base,
      replayable: 'DECISION_LAYER_ONLY',
      replayableReason: '11_REVISIONE_E_CORREZIONI.md P1: re-running these inputs through the same reference provider reproduces the same decisions, because the reference provider is a pure function of them (no model call to be non-deterministic about).',
    };
  }
  if (run.fixturePack) {
    return {
      ...base,
      replayable: 'MODEL_FIXTURE_CAPTURED',
      replayableReason: 'D-0259 (SESS-002): at least one surface answered externally, and a fixture pack was captured at plan() time via ReasoningRouter#fixtures(runId). Replay does not regenerate the model\'s answers (11_REVISIONE_E_CORREZIONI.md P1) — it resubmits this exact pack to the same provider\'s own `/v1/replay`, proven faithful by tools/measure-replay-fidelity.mjs (D-0227).',
      fixturePackDigest: run.fixturePack.digest ?? null,
    };
  }
  return {
    ...base,
    replayable: 'NOT_REPLAYABLE',
    replayableReason: 'at least one surface answered externally, but capturing a fixture pack for this run failed or was refused at plan() time — declared, not silently treated as DECISION_LAYER_ONLY (recomputing locally would replay a DIFFERENT decision than the one this run actually made).',
  };
}

/**
 * A report this module refuses to assemble, rather than assemble wrongly.
 *
 * Refusing is the only honest outcome for the two cases below, because both produce a
 * report that reads as *better* than the run it describes — a proof that flatters is worse
 * than no proof (`CLAUDE10.md` rule 38).
 */
export class SessionProofRefused extends Error {
  constructor(message) { super(message); this.name = 'SessionProofRefused'; this.status = 500; }
}

/** One claim, in a line a reviewer can act on. */
const describeClaim = (claim) => {
  if (!claim || typeof claim !== 'object') return String(claim);
  const type = claim.type ?? 'claim';
  const target = claim.path ?? claim.file ?? claim.field ?? null;
  return target ? `${type} ${target}` : type;
};

/**
 * CE-009, enforced where the report is built rather than only where the number is computed.
 *
 * `15_CODEN_EVOLUTION_DA_ZERO.md` §3.IV: *«la copertura di proiezione non può mai essere
 * assente né arrotondata a "completa". Un'affermazione non misurata è dichiarata non
 * misurata.»* `projectionCoverage()` already honours that — but it was the ONLY thing that
 * did, and nothing checked the report. Measured 2026-08-19, before this guard existed:
 *
 *   · a decided run carrying no coverage produced `{"diff":[],"risk":…,"promoted":false}` —
 *     the `coverage` key was `undefined`, so `JSON.stringify` **dropped it entirely** and the
 *     served report simply had no coverage in it. Absent, not declared absent.
 *   · a coverage object stating `complete:true` over `6/9` recomputed passed straight through
 *     and the report asserted a complete projection of a partial one. Rounded up, by a
 *     producer other than `projectionCoverage()` — which is exactly the hole a check placed
 *     only in the producer leaves open.
 *
 * Three outcomes, and the middle one is the one that did not exist:
 *   · measured        → the coverage object, whole, with its declaration
 *   · never measured  → `{ measured:false, reason }` — **declared** absence
 *   · inconsistent    → REFUSED
 */
function coverageOf(run) {
  const coverage = run.coverage ?? null;
  const wasMeasured = run.measurement != null || run.status === 'PROMOTED';
  if (coverage === null || coverage === undefined) {
    if (wasMeasured) {
      throw new SessionProofRefused(
        `run \`${run.runId}\` was measured but carries no projection coverage — a report without coverage is refused `
        + '(CE-009); coverage is produced by verification.mjs#projectionCoverage() at measure time');
    }
    return {
      measured: false,
      reason: `run \`${run.runId}\` was ${run.status} before any measurement ran, so no claim was recomputed`,
      declaration: 'no projection coverage: nothing was recomputed, and that is stated rather than omitted',
    };
  }
  for (const key of ['total', 'recomputed', 'matched']) {
    if (!Number.isInteger(coverage[key])) {
      throw new SessionProofRefused(
        `run \`${run.runId}\`: projection coverage has no integer \`${key}\` — a report whose coverage cannot be read `
        + 'is a report without coverage (CE-009)');
    }
  }
  if (!Array.isArray(coverage.unrecomputed) || !Array.isArray(coverage.contradicted)) {
    throw new SessionProofRefused(
      `run \`${run.runId}\`: projection coverage must name what was not recomputed and what was contradicted — `
      + 'a fraction with no list is the implicit coverage CE-009 forbids');
  }
  if (typeof coverage.declaration !== 'string' || !coverage.declaration.trim()) {
    throw new SessionProofRefused(`run \`${run.runId}\`: projection coverage carries no declaration (CE-009)`);
  }
  const trulyComplete = coverage.total > 0
    && coverage.recomputed === coverage.total
    && coverage.matched === coverage.total;
  if (coverage.complete === true && !trulyComplete) {
    throw new SessionProofRefused(
      `run \`${run.runId}\`: projection coverage claims \`complete\` over ${coverage.recomputed}/${coverage.total} `
      + `recomputed and ${coverage.matched}/${coverage.total} matched — coverage is never rounded up to complete (CE-009)`);
  }
  return { measured: true, ...coverage };
}

/**
 * CE-019, on the surface that had no owner.
 *
 * Stage 16's `NON FATTO` box *«non può essere vuota senza dirlo»* (§16 of the same document).
 * `ClosureRegister` enforces that for the closure a human writes, and both shells render it.
 * The Session Proof carries a **second** NOT DONE box, served at `/…/session-proof`, and that
 * one was `null` for every promoted run — blank, and indistinguishable from a run where
 * nobody looked.
 *
 * It is filled from measured facts, never invented: a claim the verifier did not recompute is
 * a thing this run did not do. Contradicted claims stay in `coverage.contradicted` — they were
 * verified and failed, which is a different statement and belongs where it already is.
 */
function notDoneOf(run, coverage) {
  const items = [];
  if (run.status === 'REFUSED') items.push('nothing was promoted: the run was refused');
  if (coverage.measured === false) {
    items.push(`no claim was recomputed — ${coverage.reason}`);
  } else {
    for (const entry of coverage.unrecomputed) {
      items.push(`claim not recomputed: ${describeClaim(entry.claim)} — ${entry.reason}`);
    }
  }
  return {
    items,
    nothingLeftUndone: items.length === 0,
    declaration: items.length === 0
      ? 'nothing was left undone, and that is stated rather than left blank'
      : `${items.length} thing${items.length === 1 ? '' : 's'} not done or not verified`,
  };
}

/**
 * @param {object} run     one entry of WorkspaceActionOrchestrator's internal run map
 * @param {object[]} events this run's correlation from EventLedger.correlation(runId)
 */
export function assembleSessionProof({ run, events }) {
  const decided = run.status !== 'PENDING_APPROVAL';
  // Both guards run BEFORE the fields are built, so a report that would have been wrong is
  // never half-assembled and never partially served.
  const coverage = decided ? coverageOf(run) : null;
  const notDone = decided ? notDoneOf(run, coverage) : null;
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
      ? { source: 'workspace-actions.mjs#diff() + verification.mjs projectionCoverage() + ReferenceReasoningProvider.classify()', value: { diff: run.diff, coverage, risk: run.risk, promoted: run.status === 'PROMOTED', notDone } }
      : { source: null, value: null, reason: NOT_DECIDED_YET(run) },
    fixture: { source: 'the exact inputs given to plan(), stored on the run', value: fixtureOf(run) },
  };
  for (const name of SESSION_PROOF_FIELDS) {
    if (!(name in fields)) throw new Error(`session-proof.mjs is missing field \`${name}\` — SESS-001 requires all ten`);
  }
  // Phase 6 (`D-0312`): the Session Proof says whether this session ran at the quality it asked
  // for. It is a header fact, beside `status`, and NOT an eleventh field — SESS-001 freezes the
  // ten and a proof that quietly grew one would no longer be the thing that document describes.
  //
  // Always present, `degraded:false` on a healthy run. The alternative — a key that appears
  // only when something went wrong — is a key readers learn to skip, and its absence would be
  // indistinguishable from a proof assembled by code that predates this phase.
  const degradation = degradationSummary({
    reasoning: run.reasoningDegradations ?? [],
    authoring: run.authoring?.degradations ?? [],
  });
  return {
    version: SESSION_PROOF_VERSION,
    runId: run.runId,
    status: run.status,
    degradation,
    generatedAtUnix: Math.floor(Date.now() / 1000),
    fields,
    // The digest covers the ten fields, as it always has. `degradation` is derived from the
    // same run and adding it here would change every historical digest for no new information.
    digest: digest(fields),
  };
}
