// SPDX-License-Identifier: AGPL-3.0-or-later
// Phase 1 step 7: minimal repository understanding. No Rust twin (see the module comment in
// src/repo-map.mjs), so this is a plain test suite, not a shared-vectors run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRepositoryMap, literalSearch, repoMapStatus, RepoMapError,
} from '../src/repo-map.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-repo-map-'));
  return dir;
}

function write(dir, relPath, content) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive:true });
  writeFileSync(full, content);
  return full;
}

test('refuses a root that does not exist', () => {
  assert.throws(() => buildRepositoryMap('/no/such/path/at/all'), RepoMapError);
});

test('refuses a root that is a file, not a directory', () => {
  const dir = fixture();
  const file = write(dir, 'x.txt', 'hi');
  try {
    assert.throws(() => buildRepositoryMap(file), RepoMapError);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('language detection counts files by extension, unknown extensions counted separately', () => {
  const dir = fixture();
  write(dir, 'src/a.js', 'export const a = 1;\n');
  write(dir, 'src/b.py', 'def b():\n    pass\n');
  write(dir, 'notes.xyz', 'not a recognised language\n');
  write(dir, 'README.md', '# hi\n');
  try {
    const map = buildRepositoryMap(dir);
    const byLang = Object.fromEntries(map.languages.languages.map((e) => [e.language, e.files]));
    assert.equal(byLang.javascript, 1);
    assert.equal(byLang.python, 1);
    assert.equal(map.languages.primary, 'javascript');
    assert.equal(map.languages.otherFiles, 1); // .xyz — .md is a known non-language extension
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('ignored directories are never walked', () => {
  const dir = fixture();
  write(dir, 'src/a.js', 'export const a = 1;\n');
  write(dir, 'node_modules/dep/index.js', 'export const dep = 1;\n');
  write(dir, '.git/objects/x', 'not source');
  try {
    const map = buildRepositoryMap(dir);
    assert.equal(map.filesScanned, 1);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('symlinked directories are never entered — no silent escape from rootDir', () => {
  const dir = fixture();
  const outside = fixture();
  write(outside, 'secret.txt', 'outside the workspace');
  write(dir, 'src/a.js', 'export const a = 1;\n');
  try {
    symlinkSync(outside, join(dir, 'linked'), 'dir');
    const map = buildRepositoryMap(dir);
    assert.equal(map.filesScanned, 1);
    assert.equal(map.skippedSymlinks, 1);
  } finally {
    rmSync(dir, { recursive:true, force:true });
    rmSync(outside, { recursive:true, force:true });
  }
});

test('package.json main and bin are reported as entry points, from the manifest itself', () => {
  const dir = fixture();
  write(dir, 'package.json', JSON.stringify({
    name:'x', main:'src/index.js', bin:{ x:'bin/x.js' },
  }));
  try {
    const map = buildRepositoryMap(dir);
    const kinds = map.entryPoints.map((e) => `${e.kind}:${e.path}`);
    assert.ok(kinds.includes('main:src/index.js'));
    assert.ok(kinds.includes('bin:bin/x.js'));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('Cargo.toml [[bin]] and the src/main.rs convention are both reported', () => {
  const dir = fixture();
  write(dir, 'Cargo.toml', '[package]\nname = "x"\n\n[[bin]]\nname = "extra"\npath = "src/bin/extra.rs"\n');
  write(dir, 'src/main.rs', 'fn main() {}\n');
  try {
    const map = buildRepositoryMap(dir);
    const paths = map.entryPoints.map((e) => e.path);
    assert.ok(paths.includes('src/bin/extra.rs'));
    assert.ok(paths.includes('src/main.rs'));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('Dockerfile CMD/ENTRYPOINT are reported as entry points', () => {
  const dir = fixture();
  write(dir, 'Dockerfile', 'FROM node:22\nCMD ["node", "server.js"]\n');
  try {
    const map = buildRepositoryMap(dir);
    assert.ok(map.entryPoints.some((e) => e.kind === 'cmd'));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('symbol index finds functions, classes and exported consts, with a line number', () => {
  const dir = fixture();
  write(dir, 'src/a.mjs', [
    'export function alpha() {}',
    'class Beta {}',
    'export const gamma = 1;',
  ].join('\n'));
  try {
    const map = buildRepositoryMap(dir);
    const names = map.symbolIndex.symbols.map((s) => s.name);
    assert.ok(names.includes('alpha'));
    assert.ok(names.includes('Beta'));
    assert.ok(names.includes('gamma'));
    const alpha = map.symbolIndex.symbols.find((s) => s.name === 'alpha');
    assert.equal(alpha.line, 1);
    assert.equal(alpha.kind, 'function');
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('symbol index covers Python and Rust with their own patterns', () => {
  const dir = fixture();
  write(dir, 'a.py', 'def foo():\n    pass\n\nclass Bar:\n    pass\n');
  write(dir, 'b.rs', 'pub fn foo() {}\nstruct Baz;\n');
  try {
    const map = buildRepositoryMap(dir);
    const byLang = {};
    for (const s of map.symbolIndex.symbols) (byLang[s.language] ??= []).push(s.name);
    assert.deepEqual(new Set(byLang.python), new Set(['foo', 'Bar']));
    assert.deepEqual(new Set(byLang.rust), new Set(['foo', 'Baz']));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('dependency map reads declared deps from package.json and Cargo.toml', () => {
  const dir = fixture();
  write(dir, 'package.json', JSON.stringify({ name:'x', dependencies:{ 'left-pad':'1.0.0' } }));
  write(dir, 'Cargo.toml', '[package]\nname = "x"\n\n[dependencies]\nserde = "1.0"\n');
  try {
    const map = buildRepositoryMap(dir);
    const names = map.dependencyMap.declared.map((d) => d.name);
    assert.ok(names.includes('left-pad'));
    assert.ok(names.includes('serde'));
    const serde = map.dependencyMap.declared.find((d) => d.name === 'serde');
    assert.equal(serde.version, '"1.0"');
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('dependency map follows only relative import specifiers, not bare package names', () => {
  const dir = fixture();
  write(dir, 'src/a.mjs', "import { b } from './b.mjs';\nimport { readFileSync } from 'node:fs';\n");
  try {
    const map = buildRepositoryMap(dir);
    const specifiers = map.dependencyMap.internalImports.map((i) => i.specifier);
    assert.deepEqual(specifiers, ['./b.mjs']);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('truncation is reported, not silently dropped, when maxFiles is exceeded', () => {
  const dir = fixture();
  for (let i = 0; i < 10; i += 1) write(dir, `f${i}.js`, `export const v${i} = ${i};\n`);
  try {
    const map = buildRepositoryMap(dir, { maxFiles:3 });
    assert.equal(map.filesScanned, 3);
    assert.equal(map.truncated, true);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('literal search finds a line and reports its number, case-sensitively by default', () => {
  const dir = fixture();
  write(dir, 'src/a.mjs', 'const NEEDLE = 1;\nconst other = 2;\n');
  try {
    const found = literalSearch(dir, 'NEEDLE');
    assert.equal(found.matches.length, 1);
    assert.equal(found.matches[0].line, 1);
    const notFound = literalSearch(dir, 'needle');
    assert.equal(notFound.matches.length, 0);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('literal search is case-insensitive on request', () => {
  const dir = fixture();
  write(dir, 'src/a.mjs', 'const NEEDLE = 1;\n');
  try {
    const found = literalSearch(dir, 'needle', { caseSensitive:false });
    assert.equal(found.matches.length, 1);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('literal search never builds a RegExp from the query — special characters are literal', () => {
  const dir = fixture();
  write(dir, 'src/a.mjs', 'const pattern = "a(b)c.*d";\n');
  try {
    // A naive `new RegExp(query)` would throw or mis-match on this; `includes` does neither.
    const found = literalSearch(dir, 'a(b)c.*d');
    assert.equal(found.matches.length, 1);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('literal search refuses an empty query instead of matching every line', () => {
  const dir = fixture();
  write(dir, 'a.txt', 'anything\n');
  try {
    assert.throws(() => literalSearch(dir, ''), RepoMapError);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('literal search reports truncation once maxMatches is reached', () => {
  const dir = fixture();
  write(dir, 'a.txt', Array.from({ length:10 }, () => 'needle').join('\n'));
  try {
    const found = literalSearch(dir, 'needle', { maxMatches:3 });
    assert.equal(found.matches.length, 3);
    assert.equal(found.truncated, true);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('one file cannot spend a term\'s whole budget and starve every file walked after it', () => {
  // Walk order here follows directory-entry order, which on this fixture sorts by name (see
  // walk() in repo-map.mjs) -- so the heavy repeater is named to be walked FIRST, and the
  // genuine single mention LAST, the shape that actually starved a real gold file. Measured
  // 2026-09-12 on a live SWE-bench instance: `astropy/timeseries/core.py` never became a
  // search candidate for any of the six terms it genuinely contains, because each one had
  // already reached the old 200-line-match cap on files walked earlier in the tree.
  const dir = fixture();
  write(dir, 'a-repeats-the-term.mjs', Array.from({ length:30 }, () => 'widget').join('\n'));
  write(dir, 'z-mentions-it-once.mjs', 'widget\n');
  try {
    // Without a per-file cap, the first file's 30 raw matches alone exceed maxMatches:10 and
    // the walk stops inside it -- the second file is never reached. Oracle run both ways
    // 2026-09-12: with maxMatchesPerFile raised past 30, this same assertion fails.
    const found = literalSearch(dir, 'widget', { maxMatches:10, maxMatchesPerFile:4 });
    const paths = new Set(found.matches.map((m) => m.path));
    assert.ok(
      paths.has('z-mentions-it-once.mjs'),
      'a file walked after a heavy repeater lost visibility for a term it genuinely contains',
    );
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('status declares the heuristic and the phase-2 boundary, not a stronger claim', () => {
  const status = repoMapStatus();
  assert.equal(status.astParsing, false);
  assert.equal(status.incremental, false);
  assert.equal(status.secondLevelSignals, false);
  assert.equal(status.rustTwin, false);
  assert.match(status.symbolIndexMethod, /regex/i);
});

// The phase-1 criterion (09_PIANO.md §3) reads "opens a REAL repository, understands its
// structure" — so this repository's own source tree is exercised here, not only fixtures.
test('opens this repository — a real, non-trivial tree — and reports a coherent map', () => {
  const map = buildRepositoryMap(join(repoRoot, 'services/reference-control-plane/src'));
  assert.ok(map.filesScanned > 20, `expected a real source tree, got ${map.filesScanned} files`);
  assert.equal(map.languages.primary, 'javascript');
  assert.ok(map.symbolIndex.symbols.length > 50);
  assert.ok(map.symbolIndex.symbols.some((s) => s.name === 'buildRepositoryMap'));
  const search = literalSearch(join(repoRoot, 'services/reference-control-plane/src'), 'SPDX-License-Identifier');
  assert.ok(search.matches.length > 20);
});
