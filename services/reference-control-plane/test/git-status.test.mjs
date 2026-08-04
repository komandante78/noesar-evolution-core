// SPDX-License-Identifier: AGPL-3.0-or-later
// Git branch status for the CodeN top bar (s313/s317 addendum, card D/graphics follow-up).
// Three honest outcomes, each exercised against a real git binary — not mocked, because the
// thing worth catching here is exactly the kind of drift a mock would hide: a flag renamed
// in a future git release, or output shaped differently than assumed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitStatus } from '../src/git-status.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-git-status-'));
  return dir;
}

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'user.name', 'test']);
  writeFileSync(join(dir, 'f.txt'), 'hi');
  git(dir, ['add', 'f.txt']);
  git(dir, ['commit', '-qm', 'init']);
}

test('a path that is not inside a git repository says so, not "unknown"', async () => {
  const dir = fixture();
  try {
    const result = await gitStatus(dir);
    assert.equal(result.available, false);
    assert.equal(result.reason, 'not_a_git_repository');
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('a path that does not exist at all is refused the same way as a non-repo path', async () => {
  const result = await gitStatus('/no/such/path/at/all/xyz');
  assert.equal(result.available, false);
  assert.equal(result.reason, 'not_a_git_repository');
});

test('a repo with no upstream reports the branch and hasUpstream:false, not a fabricated count', async () => {
  const dir = fixture();
  try {
    initRepo(dir);
    const result = await gitStatus(dir);
    assert.equal(result.available, true);
    assert.equal(result.detached, false);
    assert.ok(result.branch);
    assert.equal(result.hasUpstream, false);
    assert.equal(result.ahead, null);
    assert.equal(result.behind, null);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('detached HEAD reports detached:true and branch:null, never the literal string "HEAD"', async () => {
  const dir = fixture();
  try {
    initRepo(dir);
    git(dir, ['checkout', '-q', '--detach', 'HEAD']);
    const result = await gitStatus(dir);
    assert.equal(result.available, true);
    assert.equal(result.detached, true);
    assert.equal(result.branch, null);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('a repo tracking an upstream reports real ahead/behind counts', async () => {
  const remote = fixture();
  const clone = fixture();
  try {
    initRepo(remote);
    git(remote, ['branch', '-m', 'main']);
    git(clone, ['clone', '-q', remote, '.']);
    git(clone, ['config', 'user.email', 'test@example.invalid']);
    git(clone, ['config', 'user.name', 'test']);

    const clean = await gitStatus(clone);
    assert.equal(clean.available, true);
    assert.equal(clean.hasUpstream, true);
    assert.equal(clean.ahead, 0);
    assert.equal(clean.behind, 0);

    writeFileSync(join(clone, 'g.txt'), 'more');
    git(clone, ['add', 'g.txt']);
    git(clone, ['commit', '-qm', 'ahead by one']);
    const ahead = await gitStatus(clone);
    assert.equal(ahead.ahead, 1);
    assert.equal(ahead.behind, 0);
  } finally {
    rmSync(remote, { recursive:true, force:true });
    rmSync(clone, { recursive:true, force:true });
  }
});
