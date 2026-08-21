// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0615 — MANIFEST.sha256 is checked, and the checker is proven to fire.
//
// The manifest sat wrong for months and nothing went red, because nothing looked at it: it was
// hand-patched two lines at a time across 109 commits while 818 tracked files were never added
// and 114 hashes drifted away from their files. A manifest nobody verifies is not an integrity
// claim, it is a decoration — so the repair is not "regenerate it", it is "regenerate it AND
// make it impossible for it to rot again quietly".
//
// Which means this file's real subject is the checker, not the manifest. A clean scan proves the
// scanner found nothing, never that the tree is correct (`CLAUDE10.md` §40c), so every way the
// manifest can be wrong is reproduced here against a disposable repository and asserted to FAIL.
// The rows below are the oracle; the last one is the actual repository.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  check,
  buildManifest,
  parseManifest,
  formatLine,
  trackedFiles,
  isSelf,
  MANIFEST_NAME,
  repoRoot,
} from '../../../tools/generate-manifest.mjs';

/** A throwaway git repository, removed by the caller's finally. Never touches the real tree. */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noesar-manifest-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'alpha.txt'), 'alpha\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'beta.txt'), 'beta\n');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  const { text } = buildManifest(dir);
  fs.writeFileSync(path.join(dir, MANIFEST_NAME), text);
  return dir;
}

function withRepo(fn) {
  const dir = makeRepo();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a freshly generated manifest verifies', () => {
  withRepo((dir) => {
    const verdict = check(dir);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.entries, 2);
    assert.equal(verdict.completenessChecked, true);
  });
});

test('ORACLE: a changed file makes the check fail', () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, 'alpha.txt'), 'alpha tampered\n');
    const verdict = check(dir);
    assert.equal(verdict.ok, false, 'the checker did not fire on a changed file');
    assert.deepEqual(verdict.wrong, ['alpha.txt']);
    assert.deepEqual(verdict.notListed, []);
  });
});

test('ORACLE: a tracked file absent from the manifest makes the check fail', () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, 'gamma.txt'), 'gamma\n');
    execFileSync('git', ['-C', dir, 'add', 'gamma.txt']);
    const verdict = check(dir);
    assert.equal(verdict.ok, false, 'the checker did not fire on an unlisted tracked file');
    assert.deepEqual(verdict.notListed, ['gamma.txt']);
    // This is the exact defect that went unseen for months: 818 files in this bucket.
    assert.deepEqual(verdict.wrong, []);
  });
});

test('ORACLE: an entry for a file git does not track makes the check fail', () => {
  withRepo((dir) => {
    // The real manifest carried six of these — a .pyc and three vendored Rust build artefacts.
    const stray = path.join(dir, 'stray.o');
    fs.writeFileSync(stray, 'not tracked\n');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(stray)).digest('hex');
    fs.appendFileSync(path.join(dir, MANIFEST_NAME), `${formatLine(hash, 'stray.o')}\n`);
    const verdict = check(dir);
    assert.equal(verdict.ok, false, 'the checker did not fire on an untracked entry');
    assert.deepEqual(verdict.untracked, ['stray.o']);
  });
});

test('ORACLE: an entry whose file is gone makes the check fail', () => {
  withRepo((dir) => {
    fs.rmSync(path.join(dir, 'sub', 'beta.txt'));
    const verdict = check(dir);
    assert.equal(verdict.ok, false, 'the checker did not fire on a vanished file');
    assert.deepEqual(verdict.missingFile, ['sub/beta.txt']);
  });
});

test('ORACLE: a malformed line makes the check fail rather than being skipped', () => {
  withRepo((dir) => {
    fs.appendFileSync(path.join(dir, MANIFEST_NAME), 'this is not a manifest line\n');
    const verdict = check(dir);
    assert.equal(verdict.ok, false, 'a malformed line was tolerated');
    assert.equal(verdict.malformed.length, 1);
  });
});

test('ORACLE: an absent manifest is a failure, not an empty pass', () => {
  withRepo((dir) => {
    fs.rmSync(path.join(dir, MANIFEST_NAME));
    const verdict = check(dir);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'absent');
  });
});

test('the manifest never lists itself', () => {
  withRepo((dir) => {
    const listed = parseManifest(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8')).entries;
    assert.equal(listed.some((e) => isSelf(e.path)), false);
    assert.equal(isSelf(MANIFEST_NAME), true);
  });
});

test('generation is deterministic: the same tree yields byte-identical output', () => {
  withRepo((dir) => {
    assert.equal(buildManifest(dir).text, buildManifest(dir).text);
  });
});

test('paths are sorted, so a diff shows the change and not a reshuffle', () => {
  withRepo((dir) => {
    const paths = parseManifest(buildManifest(dir).text).entries.map((e) => e.path);
    assert.deepEqual(paths, [...paths].sort());
  });
});

test('a tracked symlink does not wedge the gate into an unrepairable failure', () => {
  // Found by hunting this phase's own diff, before it shipped. The generator skips a tracked
  // path with no regular-file content; if the checker did not skip the same paths, it would
  // report that path as "tracked but not listed" and regenerating could never make it green —
  // a gate that wedges itself. The two now share one predicate (isAttestable), which is the
  // D-0608 lesson applied here: a rule consulted twice and spelled twice drifts apart.
  //
  // Measured 2026-08-21: this repository has zero tracked symlinks, so this is a latent trap,
  // not an active defect. It is asserted anyway, because "nobody has done it yet" is not a
  // property a gate can rely on.
  withRepo((dir) => {
    fs.symlinkSync('alpha.txt', path.join(dir, 'link.txt'));
    execFileSync('git', ['-C', dir, 'add', 'link.txt']);
    const built = buildManifest(dir);
    assert.deepEqual(built.unreadable, ['link.txt'], 'the generator should skip a symlink');
    fs.writeFileSync(path.join(dir, MANIFEST_NAME), built.text);

    const verdict = check(dir);
    assert.equal(verdict.ok, true, 'a regenerated manifest must verify even with a tracked symlink present');
    assert.deepEqual(verdict.notListed, [], 'the symlink must not be reported as a missing entry');
  });
});

test('without git, completeness is declared unchecked rather than assumed', () => {
  // CLAUDE10.md §63: detect, degrade, declare. A delivered archive has no `.git`, and the
  // consumer verifying it is the reason a manifest ships at all — so the hashes must still be
  // checkable, and the half that cannot be checked must say so instead of passing quietly.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noesar-manifest-nogit-'));
  try {
    fs.writeFileSync(path.join(dir, 'alpha.txt'), 'alpha\n');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'alpha.txt'))).digest('hex');
    fs.writeFileSync(path.join(dir, MANIFEST_NAME), `${formatLine(hash, 'alpha.txt')}\n`);
    assert.equal(trackedFiles(dir), null, 'a directory that is not a git repository should answer null');
    const verdict = check(dir);
    assert.equal(verdict.completenessChecked, false);
    assert.equal(verdict.ok, true, 'the hashes it CAN check must still be checked');
    assert.deepEqual(verdict.wrong, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real repository manifest is complete and correct', () => {
  const verdict = check(repoRoot);
  assert.equal(verdict.completenessChecked, true, 'this repository is a git checkout');
  assert.equal(
    verdict.ok,
    true,
    `MANIFEST.sha256 disagrees with the tree — wrong:${verdict.wrong.length} ` +
      `notListed:${verdict.notListed.length} untracked:${verdict.untracked.length} ` +
      `missingFile:${verdict.missingFile.length}. Repair: node tools/generate-manifest.mjs`,
  );
  assert.equal(verdict.entries, trackedFiles(repoRoot).length);
});
