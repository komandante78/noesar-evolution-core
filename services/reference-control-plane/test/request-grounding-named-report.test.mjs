// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In a report, a file it names is evidence, not the whole answer.
//
// Measured 2026-09-26 on 155 SWE-bench Verified issues (bench.mjs + diff.mjs, reference provider): the 5
// instances answered by a named file were all reports, and 4 of the 5 names were a test, an example or a
// doc page. django-10097 named its test data file `tests/validators/invalid_urls.txt`; the fix is in
// `django/core/validators.py`, which the search finds. Keeping the named file AND searching beside it:
// 101 -> 103 localised, 2 gained, 0 lost. A plain instruction («modifica app.js») is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groundRequest } from '../src/request-grounding.mjs';

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), 'noesar-named-report-'));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

const FILES = {
  'core/validators.py': 'class URLValidator:\n    def check_url(self, value):\n        return value\n',
  'tests/invalid_urls.txt': 'http://foo:bar@example.com\n',
  'other/unrelated.py': 'x = 1\n',
};
const REPORT = 'URLValidator accepts invalid characters in the username.\n\n'
  + 'Adding a line to tests/invalid_urls.txt shows it: URLValidator.check_url lets them through.';

test('a report keeps the file it names and still searches beside it', () => {
  const root = workspace(FILES);
  try {
    const result = groundRequest({ workspaceRoot: root, goal: 'URLValidator accepts invalid characters', request: REPORT });
    const paths = result.files.map((file) => file.path);
    assert.equal(paths[0], 'tests/invalid_urls.txt', 'the named file comes first');
    assert.ok(paths.includes('core/validators.py'), `the search found the source file too: ${paths.join(', ')}`);
    assert.equal(new Set(paths).size, paths.length, 'no file is planned twice');
    assert.deepEqual(result.grounding.named, ['tests/invalid_urls.txt'], 'whoever approves sees which file was named');
    assert.equal(result.grounding.derived, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a plain instruction still plans exactly the file it names', () => {
  const root = workspace(FILES);
  try {
    const request = 'add a comment to tests/invalid_urls.txt about URLValidator';
    const result = groundRequest({ workspaceRoot: root, goal: request, request });
    assert.deepEqual(result.files.map((file) => file.path), ['tests/invalid_urls.txt']);
    assert.equal(result.grounding.derived, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a report whose words find nothing else still plans the file it names, rather than refusing', () => {
  const root = workspace({ 'notes/data.txt': 'alpha\n' });
  try {
    const request = 'Something is off.\n\nSee notes/data.txt';
    const result = groundRequest({ workspaceRoot: root, goal: 'Something is off', request });
    assert.deepEqual(result.files.map((file) => file.path), ['notes/data.txt']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
