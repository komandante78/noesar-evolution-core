// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0284: Phase 2 of Debug Evolution's own plan (Owner s302) — "un compito ciascuno, lettura
// riga per riga; il verdetto vero/falso-positivo NON va inventato: è ATOM". First slice only:
// the `discovery`+`skeptic` pair from the six agent roles Debug Evolution already DECLARES
// (`de_v2/app.py`'s `AGENTS`) but has never wired to anything.
//
// The four surfaces named for this in an earlier session (`classify`/`confidence`/`evidence`/
// `expect`) turned out not to fit on inspection of the pinned contract
// (`ATOM_EVOLUTION/contract/noesar-reasoning/src/lib.rs`): `classify`, `confidence` and
// `expect` are all signed on a `Plan` — a code-CHANGE plan, steps/files/commands/blast-radius
// — not on a static-analysis finding. Forcing a finding through that shape would mean minting
// a fake "plan to inspect this finding" for no reason but to match a surface name, which is
// exactly the kind of invented ceremony this project's own rules forbid. The two surfaces that
// actually fit without forcing anything are `hypothesize(intent, gathered) -> Hypothesis[]`
// and `evidence(claim) -> Evidence`. `Hypothesis` already carries BOTH `supporting` evidence
// AND a genuine `contrary` search (`NOT_SOUGHT` / `NONE_FOUND` / `FOUND{evidence}`) in one
// answer — discovery and skeptic are one call, not two.
//
// Pure conversion only — no I/O in this file, on purpose: `debug-evolution-bridge.mjs`
// orchestrates the HTTP calls (to Debug Evolution and, through a caller-supplied
// `ReasoningRouter`, to ATOM), the same split that module already has between its own pure
// helpers and `rescanNoesarEvolutionProjects()`'s I/O. Nothing here invents Debug Evolution's
// own verdict machinery: `findings`/`evidence`/`transitions` and the `can_transition` state
// machine (`de_v2/core.py`, the "Evidence Court", D-0280) already exist and are untouched —
// this module only plays the same part a human already plays through that product's own
// WebUI (open a finding, add evidence, attempt a transition), with `actor:'atom'` instead of
// `actor:'webui'`, and a real `ReasoningRouter` answering instead of a person reading the
// code by eye.

/**
 * A finding's own scanner-supplied fields, offered to `hypothesize()` as evidence already
 * gathered — the static analyzer already found SOMETHING at this location; ATOM is being
 * asked to say whether it stands up, not to find it from nothing. `Supported` requires a
 * non-empty `sources` array by construction on the ATOM side, so this always has one: the
 * finding's own location and rule are the source.
 */
export function findingAsGatheredEvidence(finding) {
  return [{
    kind: 'SUPPORTED',
    sources: [{
      locator: `${finding.path}:${finding.line}`,
      excerpt: `[${finding.rule_id}] ${finding.title}: ${finding.description}`,
    }],
  }];
}

/**
 * The intent handed to `hypothesize()`. `nonGoals` excludes remediation on purpose — Debug
 * Evolution's own catalog manifest (`owner-module-catalog.mjs`) already declares "automatic
 * remediation applied without human review" as excluded use; an intent that left the door
 * open for a fix proposal here would contradict that in a different file instead of a
 * different session.
 */
export function findingAsIntent(finding) {
  return {
    goal: `Determine whether the reported finding "${finding.title}" at ${finding.path}:${finding.line} describes a real defect in the code at that location.`,
    nonGoals: ['proposing or applying a fix', 'executing any code'],
    successCriteria: [
      'a hypothesis stating whether the code at the reported location has the described defect',
      'evidence for that hypothesis citing the actual code at the location',
      'a genuine search for evidence against the hypothesis, not merely a declaration that none was sought',
    ],
    ambiguities: [],
  };
}

/**
 * One `Evidence` (ATOM's wire shape: `{kind:'SUPPORTED', sources:[...]}` or
 * `{kind:'UNSUPPORTED_INFERENCE', rationale}`) converted to one Debug Evolution evidence row
 * (`POST /api/v2/findings/:id/evidence`'s own body shape — `evidence_type`/`summary`/
 * `source`/`metadata`). Neither ATOM evidence kind is a Debug Evolution `PRIMARY` evidence
 * type (`de_v2/core.py`'s `PRIMARY` set: DETERMINISTIC_REPRODUCER, RUNTIME_DETECTOR,
 * FORMAL_PROOF, END_TO_END_CONTRACT, INDEPENDENT_TEST) — an AI hypothesis, however
 * well-supported ATOM believes it to be, is always `AI_HYPOTHESIS` on Debug Evolution's side.
 * That is not a limitation this module works around: it is the mechanical guarantee that "AI
 * or static evidence alone cannot confirm" (`can_transition`'s own words) holds regardless of
 * what this module does or believes.
 */
export function atomEvidenceToFindingEvidence(evidence, { evidenceType, statement }) {
  const summary = evidence.kind === 'SUPPORTED'
    ? `${statement} — ${evidence.sources.map((source) => `${source.locator}: ${source.excerpt}`).join('; ')}`
    : `${statement} — ${evidence.rationale}`;
  return {
    evidence_type: evidenceType,
    source: 'atom',
    summary,
    metadata: { atomEvidenceKind: evidence.kind, sources: evidence.sources ?? [] },
  };
}

/**
 * `Hypothesis` (from `hypothesize()`) -> the evidence rows this module submits for it.
 * `supporting` becomes `AI_HYPOTHESIS` rows (discovery's half). `contrary` becomes
 * `COUNTER_EVIDENCE` rows ONLY when it is genuinely `FOUND` — `NOT_SOUGHT` and `NONE_FOUND`
 * are both real, different answers ("we did not look" vs "we looked and found nothing") and
 * neither is evidence of anything, so neither manufactures a row. This is skeptic's half:
 * present only when ATOM actually searched.
 */
export function hypothesisToEvidenceRows(hypothesis) {
  const rows = hypothesis.supporting.map((evidence) => atomEvidenceToFindingEvidence(evidence, {
    evidenceType: 'AI_HYPOTHESIS', statement: hypothesis.statement,
  }));
  if (hypothesis.contrary === 'FOUND') {
    for (const evidence of hypothesis.contraryEvidence ?? []) {
      rows.push(atomEvidenceToFindingEvidence(evidence, {
        evidenceType: 'COUNTER_EVIDENCE', statement: `Counter-evidence to: ${hypothesis.statement}`,
      }));
    }
  }
  return rows;
}
