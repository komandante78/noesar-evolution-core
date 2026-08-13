// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Guards on the static-analysis configuration itself.
//
// ESLint runs in a pinned container, so it cannot be invoked from inside the unit suite.
// What the suite CAN do is stop the gate from being quietly weakened: no-undef downgraded
// to a warning, a directory added to `ignores` to make a finding go away, or the runner
// scripts losing their executable bit. Each of those turns a green run into a meaningless
// one, and none of them would fail any other test.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const configPath = path.join(repoRoot, 'eslint.config.mjs');

const config = await import(`file://${configPath}`).then((module) => module.default);

test('the eslint configuration exists and is a flat-config array', () => {
  assert.ok(Array.isArray(config), 'flat config must export an array');
  assert.ok(config.length >= 2);
});

test('no-undef is an error in every block that declares rules, and is never downgraded', () => {
  const withRules = config.filter((block) => block.rules);
  assert.ok(withRules.length >= 2, 'at least the Node and browser surfaces must carry rules');
  for (const block of withRules) {
    assert.equal(
      block.rules['no-undef'], 'error',
      `no-undef must be an error for ${JSON.stringify(block.files ?? 'default')}`,
    );
  }
});

test('every first-party JavaScript surface is covered by a rules block', () => {
  const patterns = config.filter((block) => block.rules).flatMap((block) => block.files ?? []);
  const joined = patterns.join(' ');
  // The six areas the gate is required to cover: runtime, WebUI, tools, tests, workers
  // and the Node-based installers. All of them are .mjs/.js under the repository root, so
  // the universal pattern is what proves coverage.
  assert.ok(
    joined.includes('**/*.mjs') && joined.includes('**/*.js'),
    `expected a repository-wide JavaScript pattern, got: ${joined}`,
  );
  assert.ok(joined.includes('apps/webui-static/**/*.js'), 'the WebUI needs its own globals');
});

// Flat config gives `ignores` two entirely different meanings, and conflating them makes this
// gate wrong in both directions. In a config object with NO `files`, `ignores` is global: those
// paths are not linted at all, and that is the list this test exists to police. In an object
// that also has `files`, `ignores` merely narrows THAT block — the paths are still linted, by
// whichever other block matches them, and the usual reason to write one is to apply a STRICTER
// block instead of a laxer one.
//
// Measured 2026-08-13 (`D-0405` slice 1): the old version of this test flattened both kinds
// together and failed on `ignores: ['apps/shared/**']` inside the Node block — an entry whose
// entire purpose is to STOP shared code inheriting Node's globals, so that `process.env` in a
// module the browser loads is an error instead of passing. The gate read a tightening as a
// weakening. Splitting the two meanings is the repair; the second test below is the part that
// makes the split safe, because a scoped ignore with nothing else covering it would be an
// unlinted tree wearing a legitimate-looking shape.
const GLOBAL_IGNORES = config.filter((block) => block.ignores && !block.files)
  .flatMap((block) => block.ignores);
const SCOPED_IGNORES = config.filter((block) => block.ignores && block.files)
  .flatMap((block) => block.ignores);

test('the ignore list excludes only vendored, generated or non-source trees', () => {
  const allowed = [
    'rust/vendor/**', 'node_modules/**', '**/node_modules/**', 'BACKUPS/**',
    'provenance/**', 'MASTER_REFERENCE/**', 'private-boundary/**',
    // Vendored third-party bytes, not first-party source. Admitted here deliberately and with
    // a condition: what replaces linting is `vendor-provenance.test.mjs`, which pins the exact
    // hashes. An ignored tree with nothing checking it is the hole this list exists to prevent.
    'apps/webui-static/vendor/**',
  ];
  for (const entry of GLOBAL_IGNORES) {
    assert.ok(
      allowed.includes(entry),
      `unexpected ignore "${entry}": excluding first-party source is how a gate stops finding things`,
    );
  }
  // Specifically: the directories that actually hold product code must NOT be ignored.
  for (const forbidden of ['services/**', 'tools/**', 'apps/webui-static/**', 'apps/shared/**',
    'tests/**', 'ai-workspace/**']) {
    assert.equal(GLOBAL_IGNORES.includes(forbidden), false, `${forbidden} must never be ignored`);
  }
});

test('a block-scoped ignore always hands its files to another rules block', () => {
  // The loophole the split above would otherwise open: `files: ['**/*.js'], ignores: ['x/**']`
  // with nothing else matching `x/**` leaves that tree linted by no block at all, which looks
  // exactly like a tightening and behaves exactly like a global ignore. Every scoped ignore
  // must therefore name a tree some rules block still claims.
  for (const entry of SCOPED_IGNORES) {
    const prefix = entry.replace(/\*+.*$/, ''); // 'apps/shared/**' -> 'apps/shared/'
    assert.ok(prefix, `the scoped ignore "${entry}" has no directory to check coverage against`);
    const covered = config.some((block) => block.rules
      && (block.files ?? []).some((pattern) => pattern.startsWith(prefix)));
    assert.ok(covered,
      `"${entry}" is excluded from its block and claimed by no other: that tree is unlinted`);
  }
});

test('the shared tree gets neither runtime\'s globals, so no-undef enforces the contract', () => {
  // `apps/shared/` is imported by the browser over HTTP and by the terminal off disk. A global
  // from either runtime granted here is a reference that lints clean and throws in the other
  // shell — the failure would be a blank page or a dead terminal, not a lint warning. This
  // pins the intersection: `console` (specified in both) and nothing else.
  const shared = config.find((block) => (block.files ?? []).some((p) => p.startsWith('apps/shared/')));
  assert.ok(shared, 'apps/shared has no rules block of its own');
  assert.deepEqual(Object.keys(shared.languageOptions?.globals ?? {}), ['console'],
    'the shared tree was granted a runtime global: it is imported by two runtimes and may have neither');
  assert.equal(shared.rules['no-undef'], 'error');
});

test('unused suppression directives are reported rather than accumulating', () => {
  const block = config.find((entry) => entry.linterOptions);
  assert.ok(block, 'some block must set linterOptions');
  assert.equal(block.linterOptions.reportUnusedDisableDirectives, 'error');
});

test('the runner and its self-test exist and are executable', () => {
  for (const script of ['tools/run-eslint.sh', 'tools/verify-linter-detects.sh']) {
    const full = path.join(repoRoot, script);
    assert.ok(fs.existsSync(full), `${script} is missing`);
    const mode = fs.statSync(full).mode & 0o111;
    assert.notEqual(mode, 0, `${script} is not executable`);
  }
});

test('the linter version and image are pinned, not floating', () => {
  const runner = fs.readFileSync(path.join(repoRoot, 'tools/run-eslint.sh'), 'utf8');
  assert.match(runner, /ESLINT_VERSION="\$\{NOESAR_ESLINT_VERSION:-\d+\.\d+\.\d+\}"/,
    'the eslint version must have an exact default, not "latest"');
  assert.match(runner, /node:22-bookworm-slim@sha256:[0-9a-f]{64}/,
    'the container must be pinned by digest');
});

test('the pre-commit hook runs the gate and refuses to pass silently when it cannot', () => {
  const hook = fs.readFileSync(path.join(repoRoot, '.githooks/pre-commit'), 'utf8');
  assert.match(hook, /tools\/run-eslint\.sh/);
  assert.match(hook, /node --test/);
  // The failure mode that matters: docker missing must block, not skip.
  assert.match(hook, /BLOCKED - docker is unavailable/);
});
