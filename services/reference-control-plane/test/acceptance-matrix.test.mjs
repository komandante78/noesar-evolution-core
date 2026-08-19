// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0556`. The parser is the risky part: it turns four prose tables into the one machine-readable
// spine every later claim about "done" will rest on. A parser that silently drops a row, or reads
// a severity wrong, would understate the gap — and understating the gap is the specific failure
// this whole instrument exists to prevent.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract, summarise, readStatus, SOURCES, MATRIX_JSON } from '../../../tools/acceptance-matrix.mjs';

describe('the acceptance matrix is read from the documents that own it — D-0556', () => {
  const matrix = extract();

  // `D-0561`: this said `SOURCES.length === 4` and the id shape said `(CE|CUBE|ARCH)`. Both were
  // the count and the alphabet of the day it was written, restated in a second place — so adding
  // the two documents that had carried acceptance tables all along broke a guard that had nothing
  // to say about them. What the guard is actually for is below, unchanged: a listed document that
  // yields no rows, because a table that stopped parsing looks exactly like a table that was
  // deleted. The floor on the total row count is the same guarantee for the whole set.
  test('every owning document is parsed, and each yields rows', () => {
    assert.ok(SOURCES.length >= 4, `only ${SOURCES.length} owning documents are listed`);
    for (const source of SOURCES) {
      const rows = matrix.rows.filter((row) => row.source.startsWith(source.file));
      assert.ok(rows.length > 0, `${source.file} yielded no criteria — a table that stopped parsing looks exactly like a table that was deleted`);
    }
    assert.ok(matrix.rows.length >= 66,
      `${matrix.rows.length} criteria parsed, fewer than the 66 measured on 2026-08-19 — a table stopped parsing`);
  });

  const ID_SHAPE = new RegExp(`^(${[...new Set(SOURCES.map((source) => source.prefix))].join('|')})-\\d{3}$`);

  test('every row carries an id, a criterion, a known severity and a method of verification', () => {
    for (const row of matrix.rows) {
      assert.match(row.id, ID_SHAPE, `${row.source}`);
      assert.ok(row.criterion.length > 10, `${row.id}: criterion too short to be one`);
      assert.ok(['critical', 'high', 'medium'].includes(row.severity), `${row.id}: severity "${row.severity}"`);
      assert.ok(row.howVerified.length > 0, `${row.id}: no stated method of verification`);
      assert.match(row.source, /^MASTER_PROJECT\/.+\.md:\d+$/, `${row.id}: source must locate the row`);
    }
  });

  test('an id names exactly one criterion', () => {
    const ids = matrix.rows.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, 'a duplicate id makes every reference to it ambiguous');
  });

  test('severity markers are stripped of their markdown, not carried into the data', () => {
    // The first run of this parser reported severities as "**C**" and grouped them under that
    // literal — the numbers were right and unusable. Data that carries its own presentation is
    // data nobody can aggregate.
    for (const row of matrix.rows) {
      assert.ok(!/[*`]/.test(row.severity), `${row.id}: severity still carries markdown`);
    }
  });

  test('a status is READ, never inferred — a row with no status column has none', () => {
    const unstated = matrix.rows.filter((row) => row.status === null);
    assert.ok(unstated.length > 0, 'if this ever reaches zero, check it is because verdicts were recorded and not because the parser started inventing them');
    for (const row of matrix.rows) {
      if (row.status === null) continue;
      assert.ok(['RECORDED_MET', 'RECORDED_NOT_MET', 'RECORDED_PARTIAL', 'RECORDED_OTHER'].includes(row.status.verdict), row.id);
      assert.ok(row.status.text.length > 0, `${row.id}: a recorded status must carry the text it was read from`);
    }
  });

  test('the committed projection equals what the documents say right now', () => {
    // The drift guard, asserted here as well as in the tool, because this is the suite the
    // pre-commit hook runs: a criterion edited without regenerating never reaches a commit.
    const committed = JSON.parse(readFileSync(MATRIX_JSON, 'utf8'));
    assert.deepEqual(
      committed.rows.map((row) => [row.id, row.criterion, row.severity, row.howVerified, row.source]),
      matrix.rows.map((row) => [row.id, row.criterion, row.severity, row.howVerified, row.source]),
      'docs/acceptance-matrix.json is stale — run: node tools/acceptance-matrix.mjs extract',
    );
  });

  test('the counts this project reports about itself are the ones measured here', () => {
    const summary = summarise(matrix);
    assert.equal(summary.total, summary.withStatus + summary.unstated);
    assert.ok(summary.total >= 53, `criteria may be added, never silently lost — found ${summary.total}`);
    // Stated as a floor rather than pinned: rows gaining a verdict must not be a test edit.
    assert.ok(summary.unstated <= 36, `${summary.unstated} criteria carry no verdict, worse than the 36 baseline`);
  });
});

// ── the verdict classifier, repaired `D-0581` ────────────────────────────────────────────────
//
// A row's verdict used to be decided by testing `✅` FIRST and ANYWHERE in the cell. `CE-036`'s
// verdict opens with `⚠️` and explains, in prose, that it is *«non è un ✅ pieno»* — and that
// mention, inside a sentence saying the opposite, classified the row as MET. The tool that exists
// so nobody can round a verdict up rounded one up itself, in the dangerous direction.
//
// The rule now: a cell states its verdict by what it LEADS with, and prose after it may name the
// other outcomes — which is exactly what an honest partial verdict does.
describe('a verdict is read from what the cell LEADS with — D-0581', () => {
  test('a partial verdict may say the words "not a full ✅" without becoming one', () => {
    const status = readStatus('⚠️ **MISURATO**: soddisfatto tranne una clausola — non è un ✅ pieno.');
    assert.equal(status.verdict, 'RECORDED_PARTIAL');
  });

  test('a met verdict may name a refusal it proved without becoming a failure', () => {
    const status = readStatus('✅ verificato: ogni tentativo è rifiutato, e un ❌ sarebbe stato il difetto.');
    assert.equal(status.verdict, 'RECORDED_MET');
  });

  test('a failure that mentions what it would have taken to pass stays a failure', () => {
    const status = readStatus('❌ non soddisfatto: servirebbe la prova che oggi darebbe ✅.');
    assert.equal(status.verdict, 'RECORDED_NOT_MET');
  });

  test('the leading marker wins wherever the others appear after it', () => {
    assert.equal(readStatus('⚠️ a ✅ b ❌ c').verdict, 'RECORDED_PARTIAL');
    assert.equal(readStatus('❌ a ✅ b ⚠️ c').verdict, 'RECORDED_NOT_MET');
    assert.equal(readStatus('✅ a ⚠️ b ❌ c').verdict, 'RECORDED_MET');
  });

  test('a cell with no marker is OTHER, and an empty one is no verdict at all', () => {
    assert.equal(readStatus('registrato, senza glifo').verdict, 'RECORDED_OTHER');
    assert.equal(readStatus('   '), null);
    assert.equal(readStatus(''), null);
    assert.equal(readStatus(null), null);
  });

  test('and the row this repair was found on now reads as what it says', () => {
    const row = extract().rows.find((candidate) => candidate.id === 'CE-036');
    assert.equal(row.status?.verdict, 'RECORDED_PARTIAL',
      'CE-036 states a superseded presentation clause; a MET here is the tool grading prose');
  });
});
