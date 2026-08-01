// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0284: Phase 2 of Debug Evolution's own plan (Owner s302) — "un compito ciascuno, lettura
// riga per riga; il verdetto vero/falso-positivo NON va inventato: è ATOM". First slice: the
// `discovery`+`skeptic` pair from the six agent roles Debug Evolution already DECLARES
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
// D-0285: second slice, `security`+`root-cause` — two more of the six declared roles, still
// pure reasoning, still zero execution. A third correction, same shape as the first: this
// session's own proposal for `security` first described it as producing `SEMANTIC_REACHABILITY`
// evidence, which on closer reading is wrong — in `de_v2/core.py`'s own taxonomy that type sits
// beside `STATIC_ANALYZER`/`DETERMINISTIC_REPRODUCER`/`RUNTIME_DETECTOR`/`FORMAL_PROOF`, the
// family of TOOL- or EXECUTION-verified evidence, not model opinion. Tagging an ATOM answer
// with it would claim a rigor that was never performed — the same mistake `classify`/
// `confidence`/`expect` would have been. `security` and `root-cause` therefore add
// `AI_HYPOTHESIS` rows exactly like `discovery` does, and neither attempts a transition past
// `HYPOTHESIZED`: `REACHABILITY_CHECKED` needs real `SEMANTIC_REACHABILITY` evidence, which is
// a tool's job or a human's, not this module's to manufacture by relabelling.
// `reproducer`/`patch-review`, the remaining two roles, stay explicitly out of scope: both
// need real code execution (`REPRODUCED` needs `DETERMINISTIC_REPRODUCER`/`RUNTIME_DETECTOR`
// evidence, `PATCH_VERIFIED` needs a patch that does not yet exist anywhere), and NOESAR
// EVOLUTION already has a real EXECUTE sandbox (`D-0249`/`D-0250`/`D-0253`) deliberately left
// disabled per installation, by design, not by omission — turning it on is the Owner's call to
// make on its own, not a side effect of a Debug Evolution triage feature.
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

// `nonGoals` excludes remediation and execution on every intent below, on purpose — Debug
// Evolution's own catalog manifest (`owner-module-catalog.mjs`) already declares "automatic
// remediation applied without human review" and "executing any code" as excluded use; an
// intent that left either door open here would contradict that in a different file instead
// of a different session.
const SHARED_NON_GOALS = Object.freeze(['proposing or applying a fix', 'executing any code']);

/** `discovery`+`skeptic`: is the reported defect real, and what tells against it. */
export function findingAsDiscoveryIntent(finding) {
  return {
    goal: `Determine whether the reported finding "${finding.title}" at ${finding.path}:${finding.line} describes a real defect in the code at that location.`,
    nonGoals: [...SHARED_NON_GOALS],
    successCriteria: [
      'a hypothesis stating whether the code at the reported location has the described defect',
      'evidence for that hypothesis citing the actual code at the location',
      'a genuine search for evidence against the hypothesis, not merely a declaration that none was sought',
    ],
    ambiguities: [],
  };
}

/**
 * `security`: is the location reachable from a trust boundary an attacker could reach.
 * `nonGoals` says explicitly that this module cannot itself VERIFY reachability — that
 * distinction is what keeps the resulting evidence honestly `AI_HYPOTHESIS`
 * (`hypothesisToEvidenceRows()` below), never the tool-verified `SEMANTIC_REACHABILITY`.
 */
export function findingAsSecurityIntent(finding) {
  return {
    goal: `Determine whether the code path described by the finding "${finding.title}" at ${finding.path}:${finding.line} is reachable from an external or otherwise untrusted trust boundary, and what would be required to reach it.`,
    nonGoals: [...SHARED_NON_GOALS, 'declaring reachability verified — that requires tool-based or dynamic analysis this module does not perform'],
    successCriteria: [
      'a hypothesis stating whether the location is reachable from a boundary an attacker could reach',
      'evidence for that hypothesis citing the actual code path from the boundary to the location',
      'a genuine search for evidence against reachability, such as a guard, an authorisation check, or a branch that is never taken from outside',
    ],
    ambiguities: [],
  };
}

/** `root-cause`: the specific coding mistake behind the symptom, not a restatement of it. */
export function findingAsRootCauseIntent(finding) {
  return {
    goal: `Identify the underlying causal defect behind the finding "${finding.title}" at ${finding.path}:${finding.line} — the specific coding mistake that produces the reported symptom, not merely a restatement of the finding's own description.`,
    nonGoals: [...SHARED_NON_GOALS],
    successCriteria: [
      "a hypothesis naming the specific causal defect, not the symptom already in the finding's own description",
      'evidence for that hypothesis citing the actual code responsible',
      'a genuine search for evidence against this being the true root cause, such as a different defect that better explains the symptom',
    ],
    ambiguities: [],
  };
}

/** Every role this module implements, in the order Debug Evolution's own `AGENTS` declares
 * them (`de_v2/app.py`) — `security` before `root-cause`, matching that list. */
export const TRIAGE_ROLE_INTENTS = Object.freeze([
  { role: 'discovery', buildIntent: findingAsDiscoveryIntent },
  { role: 'security', buildIntent: findingAsSecurityIntent },
  { role: 'root-cause', buildIntent: findingAsRootCauseIntent },
]);

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
export function atomEvidenceToFindingEvidence(evidence, { evidenceType, statement, role }) {
  const summary = evidence.kind === 'SUPPORTED'
    ? `${statement} — ${evidence.sources.map((source) => `${source.locator}: ${source.excerpt}`).join('; ')}`
    : `${statement} — ${evidence.rationale}`;
  return {
    evidence_type: evidenceType,
    source: 'atom',
    summary,
    metadata: { role, atomEvidenceKind: evidence.kind, sources: evidence.sources ?? [] },
  };
}

/**
 * `Hypothesis` (from `hypothesize()`) -> the evidence rows this module submits for it.
 * `role` (`discovery`/`security`/`root-cause`, `TRIAGE_ROLE_INTENTS` above) is recorded in
 * each row's `metadata` so an Owner reading the Evidence Court can tell which question
 * produced which evidence — the rows are otherwise indistinguishable once written.
 * `supporting` becomes `AI_HYPOTHESIS` rows. `contrary` becomes `COUNTER_EVIDENCE` rows ONLY
 * when it is genuinely `FOUND` — `NOT_SOUGHT` and `NONE_FOUND` are both real, different
 * answers ("we did not look" vs "we looked and found nothing") and neither is evidence of
 * anything, so neither manufactures a row.
 */
export function hypothesisToEvidenceRows(hypothesis, role) {
  const rows = hypothesis.supporting.map((evidence) => atomEvidenceToFindingEvidence(evidence, {
    evidenceType: 'AI_HYPOTHESIS', statement: hypothesis.statement, role,
  }));
  if (hypothesis.contrary === 'FOUND') {
    for (const evidence of hypothesis.contraryEvidence ?? []) {
      rows.push(atomEvidenceToFindingEvidence(evidence, {
        evidenceType: 'COUNTER_EVIDENCE', statement: `Counter-evidence to: ${hypothesis.statement}`, role,
      }));
    }
  }
  return rows;
}
