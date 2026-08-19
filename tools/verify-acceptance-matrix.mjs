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
// Thirty-six of fifty-three rows carry no verdict anywhere, fifteen of them CRITICAL — including
// `CE-001`, "no path mutates the workspace without spending a token coined by an authorised Plan",
// which is the central security claim of the whole product. Failing the suite on that today would
// make the battery permanently red, and a permanently red check is one people learn to ignore.
// Failing when it gets WORSE turns the number into something that can only move one way.
//
// Lower `MAX_UNSTATED` when rows gain a verdict. Raising it is a decision to be argued for in
// `docs/DECISION_LOG.md`, not a fix for a failing run.
import { extract, summarise, MATRIX_JSON, SOURCES } from './acceptance-matrix.mjs';
import { readFileSync } from 'node:fs';

/** Measured 2026-08-19 (`D-0556`). May be lowered, never raised without a recorded decision. */
const MAX_UNSTATED = 36;
/** Of those, how many are CRITICAL. The number that matters most, held separately for that reason. */
const MAX_UNSTATED_CRITICAL = 15;

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
for (const row of live.rows) {
  if (!/^(CE|CUBE|ARCH)-\d{3}$/.test(row.id)) fail(`${row.id}: malformed id`);
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
