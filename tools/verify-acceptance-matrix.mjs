#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The acceptance matrix cannot drift, and cannot get worse — `D-0556`.
//
// Three duties, and the third is the one that makes this more than a linter:
//
//   1. DRIFT      `docs/acceptance-matrix.json` must equal what the four documents say right now.
//                 The documents are the source of truth; the JSON is a projection of them. Editing
//                 a criterion without regenerating fails here, so the two can never become two
//                 different matrices — which is exactly how this project ended up with four stale
//                 registers in the first place (`D-0554`).
//   2. SHAPE      a criterion with no stated method of verification is not a criterion. Its own
//                 matrix header says every row is verifiable *by executing*, not by reading.
//   3. RATCHET    the number of criteria with NO recorded verdict may go down and never up.
//
// # Why a ratchet and not a hard failure
//
// Thirty-two of sixty-six rows carry no verdict anywhere, eleven of them CRITICAL — down from
// thirty-six of fifty-three and fifteen when this was written, the same day. `CE-001` ("no path
// mutates the workspace without spending a token coined by an authorised Plan", the central
// security claim of the whole product) was among them and is now recorded. Failing the suite on
// the remaining eleven would make the battery permanently red, and a permanently red check is one
// people learn to ignore. Failing when it gets WORSE turns the number into something that can
// only move one way.
//
// Lower `MAX_UNSTATED` when rows gain a verdict. Raising it is a decision to be argued for in
// `docs/DECISION_LOG.md`, not a fix for a failing run.
import { extract, summarise, MATRIX_JSON, SOURCES } from './acceptance-matrix.mjs';
import { readFileSync } from 'node:fs';

/**
 * Measured 2026-08-19 (`D-0556`) at 36. May be lowered, never raised without a recorded decision.
 * 34 at `D-0561` (`CE-001`, `CE-004`), 32 at `D-0563` (`CE-017`, `CE-018`), 30 at `D-0566`
 * (`CE-008` — recorded NOT met — and `CE-026`), 29 at `D-0566` with `CE-022` — all the same day.
 * 27 at `D-0571` (`CE-002`, `CE-029`), 24 at `D-0573` (`CE-003`, `CE-014`, `CE-025`).
 */
const MAX_UNSTATED = 24;
/**
 * Of those, how many are CRITICAL. The number that matters most, held separately for that reason.
 * 15 at `D-0556`, 13 at `D-0561`, 11 at `D-0563`, 8 at `D-0566`, 6 at `D-0571`, 3 at `D-0573`. Seen to fire at each new floor rather than
 * assumed to: set one notch tighter it refuses with `N CRITICAL criteria have no recorded
 * verdict, up from N-1`, measured at every one of those three floors.
 */
const MAX_UNSTATED_CRITICAL = 3;

const KNOWN_SEVERITIES = new Set(['critical', 'high', 'medium']);

let failures = 0;
const fail = (message) => { failures += 1; process.stdout.write(`  FAIL  ${message}\n`); };

process.stdout.write('Acceptance matrix\n\n');

// ── 1 · drift ───────────────────────────────────────────────────────────────────────────────────
const live = extract();
let committed = null;
try {
  committed = JSON.parse(readFileSync(MATRIX_JSON, 'utf8'));
} catch (error) {
  fail(`docs/acceptance-matrix.json is missing or unreadable (${error.message}); run: node tools/acceptance-matrix.mjs extract`);
}

if (committed) {
  const liveById = new Map(live.rows.map((row) => [row.id, row]));
  const committedById = new Map(committed.rows.map((row) => [row.id, row]));
  for (const id of liveById.keys()) {
    if (!committedById.has(id)) fail(`${id} exists in the documents but not in the committed matrix — regenerate`);
  }
  for (const id of committedById.keys()) {
    if (!liveById.has(id)) fail(`${id} is in the committed matrix but no longer in any document — regenerate, and say in the decision log why a criterion disappeared`);
  }
  for (const [id, row] of liveById) {
    const other = committedById.get(id);
    if (!other) continue;
    for (const field of ['criterion', 'severity', 'howVerified', 'source']) {
      if (row[field] !== other[field]) {
        fail(`${id}.${field} changed in the document but not in the committed matrix — regenerate (document: ${String(row[field]).slice(0, 60)}…)`);
      }
    }
    const liveVerdict = row.status?.verdict ?? null;
    const otherVerdict = other.status?.verdict ?? null;
    if (liveVerdict !== otherVerdict) fail(`${id} verdict changed (${otherVerdict} -> ${liveVerdict}) without regenerating`);
  }
}

// ── 2 · shape ───────────────────────────────────────────────────────────────────────────────────
// The prefixes are DERIVED from `SOURCES`, not restated. Written out by hand as
// `(CE|CUBE|ARCH)` they were a second list that had to be remembered, and adding two source
// documents (`D-0561`) made all thirteen of their rows "malformed" — a check failing on
// perfectly well-formed ids because the checker had its own private idea of the alphabet.
const ID_SHAPE = new RegExp(`^(${[...new Set(SOURCES.map((source) => source.prefix))].join('|')})-\\d{3}$`);

for (const row of live.rows) {
  if (!ID_SHAPE.test(row.id)) fail(`${row.id}: malformed id (known prefixes: ${ID_SHAPE.source})`);
  if (!KNOWN_SEVERITIES.has(row.severity)) fail(`${row.id}: unknown severity "${row.severity}" — C, A and M are the scale its own header defines`);
  if (!row.criterion) fail(`${row.id}: empty criterion`);
  if (!row.howVerified) fail(`${row.id}: no stated method of verification — the matrix's own rule is that every row is verifiable by executing, not by reading`);
}

// ── 3 · ratchet ─────────────────────────────────────────────────────────────────────────────────
const summary = summarise(live);
const unstatedCritical = live.rows.filter((row) => row.severity === 'critical' && row.status === null);
if (summary.unstated > MAX_UNSTATED) {
  fail(`${summary.unstated} criteria have no recorded verdict, up from the ${MAX_UNSTATED} baseline — a new criterion arrived without a verdict, or one lost the verdict it had`);
}
if (unstatedCritical.length > MAX_UNSTATED_CRITICAL) {
  fail(`${unstatedCritical.length} CRITICAL criteria have no recorded verdict, up from ${MAX_UNSTATED_CRITICAL}`);
}

process.stdout.write(`  sources        ${SOURCES.length} documents\n`);
process.stdout.write(`  criteria       ${summary.total}\n`);
process.stdout.write(`  verdict recorded  ${summary.withStatus}  (met: ${summary.recordedMet})\n`);
process.stdout.write(`  NO VERDICT        ${summary.unstated}  of which CRITICAL: ${unstatedCritical.length}\n`);
if (unstatedCritical.length) {
  process.stdout.write(`  critical, unstated: ${unstatedCritical.map((row) => row.id).join(' ')}\n`);
}
process.stdout.write(`  ratchet        unstated <= ${MAX_UNSTATED}, critical unstated <= ${MAX_UNSTATED_CRITICAL}\n`);

if (failures) {
  process.stdout.write(`\nACCEPTANCE_MATRIX: FAIL (${failures})\n`);
  process.exit(1);
}
process.stdout.write('\nACCEPTANCE_MATRIX: PASS\n');
