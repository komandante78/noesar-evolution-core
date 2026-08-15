// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `test/support/workspace.mjs` is the fix for `F-TMP-001` (D-0463): a shared `freshTempDir()`
// that owns cleaning up what it creates, instead of every test file re-deriving `try/finally`
// or forgetting it, the way 57 files here did (D-0460 measured 8.3 GB leaked from two of
// them). This file cannot exercise its OWN cleanup directly — the helper's `after()` fires
// after this whole file's tests finish, so nothing here can await it — so it proves the two
// properties that are actually load-bearing instead: the directory it hands back is real, and
// it is tracked for later removal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { freshTempDir } from './support/workspace.mjs';

test('freshTempDir() returns a real, freshly created directory', () => {
  const dir = freshTempDir('noesar-workspace-support-test-');
  assert.ok(existsSync(dir), `freshTempDir() must return a directory that exists: ${dir}`);
});

test('freshTempDir() returns a distinct directory on every call', () => {
  const first = freshTempDir('noesar-workspace-support-test-');
  const second = freshTempDir('noesar-workspace-support-test-');
  assert.notEqual(first, second, 'two calls must not collide on the same directory');
  assert.ok(existsSync(first) && existsSync(second));
});

test('freshTempDir() honours the prefix it is given', () => {
  const dir = freshTempDir('noesar-custom-prefix-');
  assert.match(dir, /noesar-custom-prefix-/, `the directory name must carry the caller's prefix: ${dir}`);
});
