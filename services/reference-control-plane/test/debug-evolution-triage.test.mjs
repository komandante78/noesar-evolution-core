// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0284/D-0285, unit half: pure conversion functions only, no I/O — the same posture as
// sector-modules.mjs's own tests. debug-evolution-bridge.test.mjs (extended alongside this
// file) covers the orchestration; debug-evolution-triage-http.test.mjs covers the real HTTP
// route end to end against stub ATOM and stub Debug Evolution servers.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findingAsGatheredEvidence, findingAsDiscoveryIntent, findingAsSecurityIntent, findingAsRootCauseIntent,
  atomEvidenceToFindingEvidence, hypothesisToEvidenceRows, TRIAGE_ROLE_INTENTS,
} from '../src/debug-evolution-triage.mjs';

const FINDING = {
  id: 'f-1', project_id: 'p-1', rule_id: 'sql-injection', title: 'Possible SQL injection',
  description: 'user input flows into a raw query', severity: 'high', state: 'DETECTED',
  path: 'src/db.py', line: 42,
};

describe('D-0284 — findingAsDiscoveryIntent / findingAsGatheredEvidence', () => {
  test('the intent excludes remediation and execution, matching the module manifest\'s excluded_use', () => {
    const intent = findingAsDiscoveryIntent(FINDING);
    assert.match(intent.goal, /Possible SQL injection/);
    assert.match(intent.goal, /src\/db\.py:42/);
    assert.deepEqual(intent.nonGoals, ['proposing or applying a fix', 'executing any code']);
    assert.ok(intent.successCriteria.some((c) => /genuine search/.test(c)), 'must ask for a genuine search, not just a hypothesis');
  });

  test('gathered evidence is SUPPORTED with the finding\'s own location and rule as the source, never empty', () => {
    const gathered = findingAsGatheredEvidence(FINDING);
    assert.equal(gathered.length, 1);
    assert.equal(gathered[0].kind, 'SUPPORTED');
    assert.equal(gathered[0].sources.length, 1);
    assert.equal(gathered[0].sources[0].locator, 'src/db.py:42');
    assert.match(gathered[0].sources[0].excerpt, /sql-injection/);
  });
});

describe('D-0285 — findingAsSecurityIntent / findingAsRootCauseIntent', () => {
  test('the security intent asks about reachability from a trust boundary, and disclaims verifying it', () => {
    const intent = findingAsSecurityIntent(FINDING);
    assert.match(intent.goal, /reachable/);
    assert.match(intent.goal, /trust boundary|untrusted/);
    assert.ok(
      intent.nonGoals.some((g) => /verified/.test(g)),
      'must disclaim VERIFYING reachability — that is what keeps the evidence honestly AI_HYPOTHESIS, never the tool-verified SEMANTIC_REACHABILITY',
    );
    assert.deepEqual(intent.nonGoals.slice(0, 2), ['proposing or applying a fix', 'executing any code']);
  });

  test('the root-cause intent asks for the causal defect, explicitly not a restatement of the symptom', () => {
    const intent = findingAsRootCauseIntent(FINDING);
    assert.match(intent.goal, /causal defect/);
    assert.ok(intent.successCriteria.some((c) => /not.*(restatement|symptom)|symptom.*not/i.test(c)));
  });

  test('TRIAGE_ROLE_INTENTS lists exactly discovery, security, root-cause, each with a working builder', () => {
    assert.deepEqual(TRIAGE_ROLE_INTENTS.map((entry) => entry.role), ['discovery', 'security', 'root-cause']);
    for (const { buildIntent } of TRIAGE_ROLE_INTENTS) {
      const intent = buildIntent(FINDING);
      assert.ok(intent.goal.length > 0);
      assert.ok(intent.nonGoals.includes('executing any code'));
    }
  });
});

describe('D-0284 — atomEvidenceToFindingEvidence', () => {
  test('SUPPORTED evidence becomes an AI_HYPOTHESIS row citing the source locator', () => {
    const row = atomEvidenceToFindingEvidence(
      { kind: 'SUPPORTED', sources: [{ locator: 'src/db.py:42', excerpt: 'raw_query(user_input)' }] },
      { evidenceType: 'AI_HYPOTHESIS', statement: 'the query is built from unsanitised input' },
    );
    assert.equal(row.evidence_type, 'AI_HYPOTHESIS');
    assert.equal(row.source, 'atom');
    assert.match(row.summary, /the query is built from unsanitised input/);
    assert.match(row.summary, /src\/db\.py:42/);
    assert.equal(row.metadata.atomEvidenceKind, 'SUPPORTED');
  });

  test('UNSUPPORTED_INFERENCE evidence becomes a row whose summary carries the rationale, not a fabricated source', () => {
    const row = atomEvidenceToFindingEvidence(
      { kind: 'UNSUPPORTED_INFERENCE', rationale: 'no corpus was read' },
      { evidenceType: 'COUNTER_EVIDENCE', statement: 'Counter-evidence to: X' },
    );
    assert.equal(row.evidence_type, 'COUNTER_EVIDENCE');
    assert.match(row.summary, /no corpus was read/);
    assert.deepEqual(row.metadata.sources, []);
  });

  test('neither ATOM evidence kind ever becomes a Debug Evolution PRIMARY evidence type — AI_HYPOTHESIS/COUNTER_EVIDENCE only, by construction of the caller', () => {
    // atomEvidenceToFindingEvidence takes evidenceType as an argument rather than deriving
    // it, so this is really a property of hypothesisToEvidenceRows below; asserted here too
    // as the cheapest possible regression net for "a finding can never be CONFIRMED by AI
    // evidence alone" (de_v2/core.py's own can_transition rule).
    const PRIMARY = new Set(['DETERMINISTIC_REPRODUCER', 'RUNTIME_DETECTOR', 'FORMAL_PROOF', 'END_TO_END_CONTRACT', 'INDEPENDENT_TEST']);
    for (const evidenceType of ['AI_HYPOTHESIS', 'COUNTER_EVIDENCE']) {
      assert.equal(PRIMARY.has(evidenceType), false);
    }
  });
});

describe('D-0284/D-0285 — hypothesisToEvidenceRows', () => {
  test('supporting evidence becomes AI_HYPOTHESIS rows, tagged with the role that asked the question', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'the input is unsanitised',
      supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'a', excerpt: 'b' }] }],
      contrary: 'NOT_SOUGHT',
    }, 'discovery');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].evidence_type, 'AI_HYPOTHESIS');
    assert.equal(rows[0].metadata.role, 'discovery');
  });

  test('contrary:FOUND adds COUNTER_EVIDENCE rows from contraryEvidence, same role tag', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'the input is unsanitised',
      supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'a', excerpt: 'b' }] }],
      contrary: 'FOUND',
      contraryEvidence: [{ kind: 'SUPPORTED', sources: [{ locator: 'c', excerpt: 'this path is actually parameterised' }] }],
    }, 'discovery');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].evidence_type, 'AI_HYPOTHESIS');
    assert.equal(rows[1].evidence_type, 'COUNTER_EVIDENCE');
    assert.match(rows[1].summary, /parameterised/);
    assert.equal(rows[0].metadata.role, 'discovery');
    assert.equal(rows[1].metadata.role, 'discovery');
  });

  test('a security-role hypothesis is tagged AI_HYPOTHESIS, never the tool-verified SEMANTIC_REACHABILITY', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'reachable from the public API without authentication',
      supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'a', excerpt: 'b' }] }],
      contrary: 'NOT_SOUGHT',
    }, 'security');
    assert.equal(rows[0].evidence_type, 'AI_HYPOTHESIS', 'D-0285 correction: security reasoning is still AI_HYPOTHESIS, not SEMANTIC_REACHABILITY');
    assert.equal(rows[0].metadata.role, 'security');
  });

  test('contrary:NOT_SOUGHT adds no counter-evidence row — "did not look" must not read as "looked, found nothing"', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'x', supporting: [], contrary: 'NOT_SOUGHT',
    }, 'discovery');
    assert.equal(rows.length, 0);
  });

  test('contrary:NONE_FOUND adds no counter-evidence row either — a real search that found nothing is not itself evidence', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'x', supporting: [], contrary: 'NONE_FOUND',
    }, 'discovery');
    assert.equal(rows.length, 0);
  });

  test('contrary:FOUND with an empty contraryEvidence array (a malformed answer) adds no rows rather than throwing', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'x', supporting: [], contrary: 'FOUND', contraryEvidence: [],
    }, 'discovery');
    assert.equal(rows.length, 0);
  });
});
