// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0556`. The parser is the risky part: it turns four prose tables into the one machine-readable
// spine every later claim about "done" will rest on. A parser that silently drops a row, or reads
// a severity wrong, would understate the gap — and understating the gap is the specific failure
// this whole instrument exists to prevent.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract, summarise, SOURCES, MATRIX_JSON } from '../../../tools/acceptance-matrix.mjs';

describe('the acceptance matrix is read from the documents that own it — D-0556', () => {
  const matrix = extract();

  test('all four owning documents are parsed, and each yields rows', () => {
    assert.equal(SOURCES.length, 4);
    for (const source of SOURCES) {
      const rows = matrix.rows.filter((row) => row.source.startsWith(source.file));
      assert.ok(rows.length > 0, `${source.file} yielded no criteria — a table that stopped parsing looks exactly like a table that was deleted`);
    }
  });

  test('every row carries an id, a criterion, a known severity and a method of verification', () => {
    for (const row of matrix.rows) {
      assert.match(row.id, /^(CE|CUBE|ARCH)-\d{3}$/, `${row.source}`);
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
