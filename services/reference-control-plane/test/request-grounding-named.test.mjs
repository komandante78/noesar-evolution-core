// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A path the person names in the request is the plan's file. Measured live on 2026-09-22:
// "Create a new markdown file named PROVA_LIVE_20260922.md" was grounded by searching `create`,
// `file`, `title` in files that already existed, and the plan proposed five unrelated ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groundRequest, pathsNamedIn } from '../src/request-grounding.mjs';

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), 'noesar-grounding-named-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

// The live workspace's shape: files that mention every word of the request, none of them the target.
const live = () => workspace({
  'tmp/install-models.mjs': '// create the file, one title line\n',
  'tmp/enable-search.mjs': '// create a file with a title\n',
  'src/sum.mjs': 'export const sum = (a, b) => a - b;\n',
  'state/auth.json': '{"secret":true}',
  'audit/events.jsonl': '{}\n',
});

test('a file to CREATE is proposed as new, and nothing found by search rides along', () => {
  const ground = groundRequest({ workspaceRoot: live(), goal: 'Create a markdown file',
    request: 'Create a new markdown file named PROVA_LIVE_20260922.md with a title and one line' });
  assert.deepEqual(ground.files, [{ path: 'PROVA_LIVE_20260922.md', contents: '' }]);
  assert.deepEqual(ground.grounding.created, ['PROVA_LIVE_20260922.md']);
  assert.equal(ground.grounding.derived, false, 'the person chose this file, the search did not');
});

test('a file to REPAIR is read as it is, so the author edits it instead of rewriting it', () => {
  const ground = groundRequest({ workspaceRoot: live(), goal: 'Fix sum', request: 'fix the bug in src/sum.mjs: it subtracts' });
  assert.deepEqual(ground.files, [{ path: 'src/sum.mjs', contents: 'export const sum = (a, b) => a - b;\n' }]);
  assert.deepEqual(ground.grounding.created, []);
});

test('the engine\'s own state stays out when it is named — credentials, and inside audit/', () => {
  const ground = groundRequest({ workspaceRoot: live(), goal: 'x',
    request: 'rewrite state/auth.json and audit/events.jsonl, then create notes/today.md' });
  assert.deepEqual(ground.files.map((file) => file.path), ['notes/today.md']);
  assert.deepEqual(ground.grounding.skipped.map((entry) => entry.reason), ['ENGINE_STATE', 'ENGINE_STATE']);
});

test('a named path outside the workspace is refused, not created', () => {
  const ground = groundRequest({ workspaceRoot: live(), goal: 'x', request: 'create ../escape.md and notes/in.md' });
  assert.deepEqual(ground.files.map((file) => file.path), ['notes/in.md']);
  assert.equal(ground.grounding.skipped[0].reason, 'OUTSIDE_WORKSPACE');
});

test('with no usable path named, the search still answers as before', () => {
  const ground = groundRequest({ workspaceRoot: live(), goal: 'title line', request: 'the title line' });
  assert.equal(ground.grounding.derived, true);
  assert.ok(ground.files.some((file) => file.path === 'tmp/install-models.mjs'));
});

test('what counts as a path: names with a letter extension, not versions or abbreviations', () => {
  assert.deepEqual(pathsNamedIn('see docs/a.md, `src/b.mjs` and (c.py). Release 0.1.2, e.g. this.'),
    ['docs/a.md', 'src/b.mjs', 'c.py']);
  assert.deepEqual(pathsNamedIn('create ./notes/x.md'), ['notes/x.md']);
});

test('a product name is not a file to create — the program is (measured live, 2026-09-22)', () => {
  const root = workspace({ 'Existing.js': 'x\n' });
  const ground = groundRequest({ workspaceRoot: root, goal: 'x',
    request: 'Create a new Node.js program programmi/somma.mjs on ASP.NET, and keep Existing.js; add src/Button.js' });
  assert.deepEqual(ground.files.map((file) => file.path), ['programmi/somma.mjs', 'src/Button.js']);
  assert.deepEqual(ground.grounding.context, ['Existing.js'], 'an existing file named beside new ones is read, not written');
  assert.deepEqual(ground.grounding.created, ['programmi/somma.mjs', 'src/Button.js']);
  assert.deepEqual(ground.grounding.skipped.map((entry) => `${entry.path}:${entry.reason}`),
    ['Node.js:PRODUCT_NAME', 'ASP.NET:PRODUCT_NAME']);
});

test('an expression in a bug report is not a file to create, and the search still runs (measured 2026-09-25)', () => {
  // 35 of 155 real SWE-bench reports lost their localisation to exactly this: `np.array` and
  // `data.dtype` matched as names, did not exist, were planned as new files, and a non-empty named
  // result returns before the search ever starts.
  const root = workspace({ 'astropy/table/table.py': '# structured array data dtype handling\n', 'docs/notes.md': 'x\n' });
  const ground = groundRequest({ workspaceRoot: root, goal: 'structured array',
    request: 'Converting a structured np.array into a Table changes data.dtype; see astropy.io for the reader' });
  assert.equal(ground.grounding.derived, true, 'no name survived, so the search answered');
  assert.ok(ground.files.some((file) => file.path === 'astropy/table/table.py'), 'and it found the file the words point at');
  assert.ok(ground.files.every((file) => !['np.array', 'data.dtype', 'astropy.io'].includes(file.path)), 'nothing invented');
});

test('the phantoms are SAID to be skipped, and a real file to create still is one', () => {
  const root = workspace({ 'a.txt': 'x\n' });
  const ground = groundRequest({ workspaceRoot: root, goal: 'x', request: 'Create notes/todo.md and mind np.array' });
  assert.deepEqual(ground.files.map((file) => file.path), ['notes/todo.md']);
  assert.deepEqual(ground.grounding.created, ['notes/todo.md']);
  assert.deepEqual(ground.grounding.skipped.map((entry) => `${entry.path}:${entry.reason}`), ['np.array:NOT_A_FILE_NAME']);
});

test('an EXISTING file is read whatever its extension — the rule only stops inventing a new one', () => {
  const root = workspace({ 'weird.array': 'real\n' });
  const ground = groundRequest({ workspaceRoot: root, goal: 'x', request: 'repair weird.array' });
  assert.deepEqual(ground.files, [{ path: 'weird.array', contents: 'real\n' }]);
});
