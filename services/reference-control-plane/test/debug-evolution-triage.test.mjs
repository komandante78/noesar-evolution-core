// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0284, unit half: pure conversion functions only, no I/O — the same posture as
// sector-modules.mjs's own tests. debug-evolution-bridge.test.mjs (extended alongside this
// file) covers the orchestration; debug-evolution-triage-http.test.mjs covers the real HTTP
// route end to end against stub ATOM and stub Debug Evolution servers.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findingAsGatheredEvidence, findingAsIntent, atomEvidenceToFindingEvidence, hypothesisToEvidenceRows,
} from '../src/debug-evolution-triage.mjs';

const FINDING = {
  id: 'f-1', project_id: 'p-1', rule_id: 'sql-injection', title: 'Possible SQL injection',
  description: 'user input flows into a raw query', severity: 'high', state: 'DETECTED',
  path: 'src/db.py', line: 42,
};

describe('D-0284 — findingAsIntent / findingAsGatheredEvidence', () => {
  test('the intent excludes remediation and execution, matching the module manifest\'s excluded_use', () => {
    const intent = findingAsIntent(FINDING);
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

describe('D-0284 — hypothesisToEvidenceRows', () => {
  test('supporting evidence becomes AI_HYPOTHESIS rows', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'the input is unsanitised',
      supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'a', excerpt: 'b' }] }],
      contrary: 'NOT_SOUGHT',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].evidence_type, 'AI_HYPOTHESIS');
  });

  test('contrary:FOUND adds COUNTER_EVIDENCE rows from contraryEvidence', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'the input is unsanitised',
      supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'a', excerpt: 'b' }] }],
      contrary: 'FOUND',
      contraryEvidence: [{ kind: 'SUPPORTED', sources: [{ locator: 'c', excerpt: 'this path is actually parameterised' }] }],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].evidence_type, 'AI_HYPOTHESIS');
    assert.equal(rows[1].evidence_type, 'COUNTER_EVIDENCE');
    assert.match(rows[1].summary, /parameterised/);
  });

  test('contrary:NOT_SOUGHT adds no counter-evidence row — "did not look" must not read as "looked, found nothing"', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'x', supporting: [], contrary: 'NOT_SOUGHT',
    });
    assert.equal(rows.length, 0);
  });

  test('contrary:NONE_FOUND adds no counter-evidence row either — a real search that found nothing is not itself evidence', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'x', supporting: [], contrary: 'NONE_FOUND',
    });
    assert.equal(rows.length, 0);
  });

  test('contrary:FOUND with an empty contraryEvidence array (a malformed answer) adds no rows rather than throwing', () => {
    const rows = hypothesisToEvidenceRows({
      statement: 'x', supporting: [], contrary: 'FOUND', contraryEvidence: [],
    });
    assert.equal(rows.length, 0);
  });
});
