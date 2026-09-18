// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The gate for `src/release-version.mjs`. `package.json` and `package-lock.json` carry the same
// release number and cannot import it, so nothing but this test stands between a release and the
// oldest defect in this project's registry: a number that disagrees with itself across files.
//
// It is trusted because it has been seen to fail: run against the tree as it stood before the
// 0.7.0 bump — constant at 0.7.0, both JSON files still at 0.6.0 — it failed on exactly those
// two assertions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_VERSION } from '../src/release-version.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readJson = (name) => JSON.parse(readFileSync(join(repoRoot, name), 'utf8'));

test('the release number is a semantic version', () => {
  assert.match(RELEASE_VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});

test('package.json and package-lock.json carry the release number the code carries', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  assert.equal(pkg.version, RELEASE_VERSION, 'package.json version');
  assert.equal(lock.version, RELEASE_VERSION, 'package-lock.json version');
  assert.equal(lock.packages['']?.version, RELEASE_VERSION, 'package-lock.json root package version');
});

test('package.json declares the licence every source file already carries', () => {
  assert.equal(readJson('package.json').license, 'AGPL-3.0-or-later');
});
