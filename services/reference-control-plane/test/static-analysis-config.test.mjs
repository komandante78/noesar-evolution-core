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

test('the ignore list excludes only vendored, generated or non-source trees', () => {
  const ignores = config.flatMap((block) => block.ignores ?? []);
  const allowed = [
    'rust/vendor/**', 'node_modules/**', '**/node_modules/**', 'BACKUPS/**',
    'provenance/**', 'MASTER_REFERENCE/**', 'private-boundary/**',
    'apps/webui-react/dist/**',
  ];
  for (const entry of ignores) {
    assert.ok(
      allowed.includes(entry),
      `unexpected ignore "${entry}": excluding first-party source is how a gate stops finding things`,
    );
  }
  // Specifically: the directories that actually hold product code must NOT be ignored.
  for (const forbidden of ['services/**', 'tools/**', 'apps/webui-static/**', 'tests/**', 'ai-workspace/**']) {
    assert.equal(ignores.includes(forbidden), false, `${forbidden} must never be ignored`);
  }
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
