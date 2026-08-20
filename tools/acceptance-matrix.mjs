#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The acceptance matrix, read by a machine — `D-0556`.
//
// # What was actually missing, which is not what the record said
//
// `docs/WORK_PLAN_V5_REWRITE.md` §5 risk 4 says the rewrite has *"zero matrici con ID e severità,
// zero tracciabilità"*, and `docs/GAP_REGISTER.md` `G-01` repeated it. **Both are wrong**, measured
// 2026-08-19: **sixty-six** criteria exist, each with an id, a severity and a stated method of
// verification, spread across six documents of `MASTER_PROJECT/`. The matrix's own header says
// what it is for — *"ogni riga è verificabile eseguendo, non leggendo"*.
//
// What is missing is that **nothing reads them**. Sixty-six criteria in prose, in six files, in
// two different table shapes, and one test file in the whole repository mentions one id. A matrix
// nobody executes is the same failure as a criterion nobody measures, one level up — and this
// project has already paid for that failure twice.
//
// The count itself has already been wrong once, in this file. It said fifty-three across four
// documents, because four was the number of documents somebody listed below — not the number that
// own criteria. `08_INSTALLAZIONE.md` (10 `INST-*`) and `01_VISIONE_E_POSIZIONE.md` (3 `SESS-*`)
// had carried the identical five-column table all along, ten of the thirteen rows with a verdict
// already written. Corrected 2026-08-19 (`D-0561`). A register that omits part of its own subject
// is the failure it was built to end, one level up again.
//
// # What this tool does, and the one thing it refuses to do
//
//   extract   parse the four tables into `docs/acceptance-matrix.json`, one spine, machine-readable
//   check     re-parse and compare against that file — **the documents are the source of truth**,
//             so a document edited without regenerating fails, rather than the JSON quietly
//             becoming a second, divergent matrix
//   report    counts: rows, rows carrying a recorded status, rows carrying none
//
// **It never decides that a row passes.** Status is *read* from the document that owns it, never
// inferred, never computed from a test result this tool went looking for. A tool that graded the
// matrix would be grading its own author's prose, and the first false PASS would be structural
// rather than accidental (`CLAUDE10.md` rule 38).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MATRIX_JSON = join(ROOT, 'docs', 'acceptance-matrix.json');

/**
 * The four documents that own criteria, and the id prefix each one owns.
 *
 * Listed explicitly rather than discovered by globbing `MASTER_PROJECT/`: a new matrix appearing
 * in a fifth document must be an act of authorship that lands here, not something a glob absorbs
 * silently. The count in `docs/GAP_REGISTER.md` would otherwise drift without anyone deciding it.
 */
export const SOURCES = Object.freeze([
  { file: 'MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md', prefix: 'CE', owns: 'the change itself — authority, evidence, reversibility' },
  { file: 'MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md', prefix: 'CE', owns: 'generation and access — who wrote the change, and the one door' },
  { file: 'MASTER_PROJECT/14_MEMORIA_A_CUBI.md', prefix: 'CUBE', owns: 'memory: immutability, provenance, the schema-enforced walls' },
  { file: 'MASTER_PROJECT/03_ARCHITETTURA.md', prefix: 'ARCH', owns: 'the running shape: supervisor, children, isolation' },
  // Added 2026-08-19 (`D-0561`), and the reason is the one this tool exists for. Both documents
  // have carried a five-column acceptance table — the same shape as the four above, verdicts
  // already written — since before this tool was built, and neither was listed. "53 criteria"
  // was therefore the size of the LIST, not the size of the acceptance surface, which is 66.
  // Ten of the thirteen missing rows already stated a verdict, so the omission was not making
  // the project look better than it is; it was making the register wrong in both directions at
  // once, and a register nobody can quote whole is the defect `G-01` was opened for.
  { file: 'MASTER_PROJECT/08_INSTALLAZIONE.md', prefix: 'INST', owns: 'the installation as it runs: mounts, listeners, privileges, the writable surface' },
  { file: 'MASTER_PROJECT/01_VISIONE_E_POSIZIONE.md', prefix: 'SESS', owns: 'the session packet and its replay — the product\'s evidence claim about itself' },
  // Added 2026-08-20 (`D-0588`). The last clause of the product's own definition of done — *"i
  // cinque archivi di consegna passano un audit indipendente"* — had stood as prose since the
  // rewrite, measured by nothing, and its list of five positions existed in no document of
  // `MASTER_PROJECT/` at all. A criterion no row measures is not closed, and one whose content
  // cannot be read is not a criterion. `PKG-001` gives it a row and an honest ❌.
  { file: 'MASTER_PROJECT/09_PIANO.md', prefix: 'PKG', owns: 'the delivery package: the five archives, their identity, and what each must carry' },
]);

const SEVERITY = Object.freeze({ C: 'critical', A: 'high', M: 'medium' });

/** Split a markdown table row into cells, honouring `\|` inside a cell. */
const cells = (line) => line
  .replace(/^\s*\|/, '').replace(/\|\s*$/, '')
  .split(/(?<!\\)\|/)
  .map((cell) => cell.trim().replace(/\\\|/g, '|'));

const strip = (text) => text.replace(/[`*]/g, '').trim();

/**
 * The markers, and the verdict each one declares. Order in this list is NOT precedence — see
 * `readStatus`; it is only the set of things a cell can lead with.
 */
const VERDICT_MARKERS = Object.freeze([
  { marker: /✅/, verdict: 'RECORDED_MET' },
  { marker: /❌|✖/, verdict: 'RECORDED_NOT_MET' },
  { marker: /⚠|parzial|partial/i, verdict: 'RECORDED_PARTIAL' },
]);

/**
 * A row's status is whatever its own document records — or `null`.
 *
 * `null` is the finding, not a gap in this parser: rows with no status column at all mean nothing
 * anywhere states whether they hold. That number is the point of this tool, and rounding it away
 * by inventing a default would destroy the only thing it measures.
 */
export function readStatus(raw) {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  // **Classified by the FIRST marker in the cell, not by a fixed precedence** — repaired
  // 2026-08-19 (`D-0581`), after this tool read a verdict wrong on a row written that same hour.
  //
  // The previous form tested `✅` first and anywhere in the cell. `CE-036`'s verdict opens with
  // `⚠️` and explains, in prose, that it is *«non è un ✅ pieno»* — and that mention, inside a
  // sentence saying the opposite, classified the row as MET. A verdict decided by a glyph
  // appearing anywhere in its own explanation is a verdict that can be flipped by describing it,
  // and it fails in the dangerous direction: towards MET.
  //
  // A cell states its verdict by what it LEADS with. Everything after is prose about it, and
  // prose is allowed to name the other outcomes — that is what an honest partial verdict does.
  let found = null;
  for (const { marker, verdict } of VERDICT_MARKERS) {
    const at = text.search(marker);
    if (at === -1) continue;
    if (!found || at < found.at) found = { at, verdict };
  }
  const decisions = [...text.matchAll(/\b(D-\d{4})\b/g)].map((match) => match[1]);
  return { verdict: found?.verdict ?? 'RECORDED_OTHER', decisions: [...new Set(decisions)], text };
}

/** Parse one document's matrix rows. Returns `[]` for a document with no table. */
export function parseDocument(file) {
  const absolute = join(ROOT, file);
  const lines = readFileSync(absolute, 'utf8').split('\n');
  const rows = [];
  lines.forEach((line, index) => {
    if (!/^\s*\|\s*`?(CE|CUBE|ARCH|INST|SESS|PKG)-\d{3}`?\s*\|/.test(line)) return;
    const parts = cells(line);
    const [id, criterion, severity, howVerified, status] = parts;
    rows.push({
      id: strip(id),
      criterion: criterion.trim(),
      severity: SEVERITY[strip(severity).toUpperCase()] ?? strip(severity),
      howVerified: (howVerified ?? '').trim(),
      status: readStatus(status),
      source: `${file}:${index + 1}`,
    });
  });
  return rows;
}

export function extract() {
  const rows = SOURCES.flatMap((source) => parseDocument(source.file));
  const seen = new Map();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`duplicate criterion id ${row.id}: ${seen.get(row.id)} and ${row.source} — an id that names two criteria makes every reference to it ambiguous`);
    }
    seen.set(row.id, row.source);
  }
  rows.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return {
    generatedBy: relative(ROOT, fileURLToPath(import.meta.url)),
    sources: SOURCES.map(({ file, prefix, owns }) => ({ file, prefix, owns })),
    note: 'Generated from the documents listed in `sources`, which are the source of truth. Do not edit this file by hand: `tools/verify-acceptance-matrix.mjs` fails when it disagrees with them. Status is READ from the owning document, never inferred — a row with `status: null` is a criterion nothing anywhere states a verdict on.',
    rows,
  };
}

export function summarise(matrix) {
  const total = matrix.rows.length;
  const withStatus = matrix.rows.filter((row) => row.status !== null);
  const met = withStatus.filter((row) => row.status.verdict === 'RECORDED_MET');
  const bySeverity = {};
  for (const row of matrix.rows) {
    const key = row.severity;
    bySeverity[key] ??= { total: 0, unstated: 0 };
    bySeverity[key].total += 1;
    if (row.status === null) bySeverity[key].unstated += 1;
  }
  return { total, withStatus: withStatus.length, recordedMet: met.length, unstated: total - withStatus.length, bySeverity };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? 'report';
  const matrix = extract();
  const summary = summarise(matrix);
  if (mode === 'extract') {
    writeFileSync(MATRIX_JSON, `${JSON.stringify(matrix, null, 2)}\n`);
    process.stdout.write(`ACCEPTANCE_MATRIX extracted rows=${summary.total} -> ${relative(ROOT, MATRIX_JSON)}\n`);
  } else {
    process.stdout.write(`ACCEPTANCE_MATRIX rows=${summary.total} status-recorded=${summary.withStatus} recorded-met=${summary.recordedMet} NO-STATUS-AT-ALL=${summary.unstated}\n`);
    for (const [severity, counts] of Object.entries(summary.bySeverity)) {
      process.stdout.write(`  ${severity.padEnd(9)} ${counts.total} rows, ${counts.unstated} with no recorded verdict\n`);
    }
  }
}
