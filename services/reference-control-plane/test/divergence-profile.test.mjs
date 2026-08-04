// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-010 · "Il profilo di divergenza è ricalcolato dalla storia git, non configurato a mano",
// verified the way the matrix says to verify it: **two repositories with opposite conventions
// produce opposite profiles**. That phrasing is the whole test design. Asserting that the
// numbers "look right" against one repository would pass equally well for a module that
// returned constants, which is exactly the failure this criterion was written against.
//
// So the two repositories below are built commit by commit, with deliberately opposite
// habits, and the SAME candidate change is profiled against each. Every assertion is about
// the two answers disagreeing.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildRepositoryConventions, divergenceOf, profileChange,
  isTestPath, layerOf, DivergenceUnavailable,
} from '../src/divergence-profile.mjs';

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Builds a throwaway repository from a list of commits, each a map of path -> contents. */
function repository(commits) {
  const root = mkdtempSync(join(tmpdir(), 'noesar-divergence-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'probe@example.invalid']);
  git(root, ['config', 'user.name', 'probe']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  let revision = 0;
  for (const files of commits) {
    revision += 1;
    for (const [path, contents] of Object.entries(files)) {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${contents}\n// revision ${revision}\n`);
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', `commit ${revision}`]);
  }
  return root;
}

/** A repository where every change carries a test and touches one layer. */
function disciplined() {
  const commits = [];
  for (let index = 0; index < 12; index += 1) {
    commits.push({
      [`src/auth.mjs`]: `auth ${index}`,
      [`test/auth.test.mjs`]: `auth test ${index}`,
    });
  }
  return repository(commits);
}

/** A repository where nothing is ever tested and every change sprawls across layers. */
function sprawling() {
  const commits = [];
  for (let index = 0; index < 12; index += 1) {
    commits.push({
      [`src/auth.mjs`]: `auth ${index}`,
      [`web/ui/page.js`]: `page ${index}`,
      [`ops/deploy/run.sh`]: `deploy ${index}`,
      [`docs/manual/guide.md`]: `guide ${index}`,
      [`db/schema/tables.sql`]: `schema ${index}`,
    });
  }
  return repository(commits);
}

describe('the shapes it reads paths by', () => {
  test('a test is recognised by directory or by suffix, and ordinary files are not', () => {
    assert.equal(isTestPath('test/auth.test.mjs'), true);
    assert.equal(isTestPath('services/x/test/thing.test.mjs'), true);
    assert.equal(isTestPath('spec/thing_test.rb'), true);
    assert.equal(isTestPath('src/latest/protest.mjs'), false, 'a word containing "test" is not a test file');
    assert.equal(isTestPath('src/auth.mjs'), false);
  });

  test('a layer is coarse on purpose', () => {
    assert.equal(layerOf('services/reference-control-plane/src/x.mjs'), 'services/reference-control-plane');
    assert.equal(layerOf('README.md'), '.');
  });
});

describe('CE-010 · two repositories with opposite conventions produce opposite profiles', () => {
  test('the SAME untested single-file change is a divergence in one and ordinary in the other', async () => {
    const strict = disciplined();
    const loose = sprawling();
    try {
      const candidate = ['src/auth.mjs'];
      const inStrict = await profileChange(strict, candidate);
      const inLoose = await profileChange(loose, candidate);

      const testsIn = (profile) => profile.signals.find((signal) => signal.id === 'tests');
      assert.equal(testsIn(inStrict).level, 'high',
        'a repository that tests every change did not flag an untested one');
      assert.equal(testsIn(inLoose).level, 'none',
        'a repository that never tests anything demanded a test — the conventions are not being read from the history');

      // And the co-change signal inverts with them: in the disciplined repository auth.mjs
      // has a habitual partner it left behind; in the sprawling one it has four.
      const coIn = (profile) => profile.signals.find((signal) => signal.id === 'co-change');
      assert.equal(coIn(inStrict).detail[0].partner, 'test/auth.test.mjs');
      assert.ok(coIn(inLoose).detail.length >= 3,
        'a repository where five files always move together did not notice four of them missing');
    } finally {
      rmSync(strict, { recursive: true, force: true });
      rmSync(loose, { recursive: true, force: true });
    }
  });

  test('the same five-file sprawl is ordinary in one and out of scope in the other', async () => {
    const strict = disciplined();
    const loose = sprawling();
    try {
      const candidate = ['src/auth.mjs', 'web/ui/page.js', 'ops/deploy/run.sh', 'docs/manual/guide.md', 'db/schema/tables.sql'];
      const scopeIn = (profile) => profile.signals.find((signal) => signal.id === 'scope').level;
      assert.equal(scopeIn(await profileChange(loose, candidate)), 'none',
        'a repository whose every change touches five layers called five layers unusual');
      assert.notEqual(scopeIn(await profileChange(strict, candidate)), 'none',
        'a repository whose every change touches one layer accepted five without comment');
    } finally {
      rmSync(strict, { recursive: true, force: true });
      rmSync(loose, { recursive: true, force: true });
    }
  });
});

describe('what the profile is, and is not', () => {
  test('it never carries a score, at any level', async () => {
    // The header's promise, enforced. A single number invites a threshold, a threshold
    // invites automation, and "would a human accept this change here" is the one thing that
    // must not be automated. A test is the only thing that stops it appearing later.
    const root = disciplined();
    try {
      const profile = await profileChange(root, ['src/auth.mjs']);
      const banned = /score|rating|grade|percentile|verdict|pass|fail/i;
      const walk = (node, path) => {
        if (node === null || typeof node !== 'object') return;
        for (const key of Object.keys(node)) {
          assert.ok(!banned.test(key), `\`${path}.${key}\` looks like a score; this profile must not have one`);
          walk(node[key], `${path}.${key}`);
        }
      };
      walk(profile, 'profile');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('it says the conventions were recomputed, and how many commits it read', async () => {
    const root = disciplined();
    try {
      const profile = await profileChange(root, ['src/auth.mjs']);
      assert.equal(profile.basis.recomputed, true);
      assert.equal(profile.basis.configured, false);
      assert.equal(profile.basis.commitsAnalysed, 12);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a file with no history is reported as having none, and never as high divergence', async () => {
    const root = disciplined();
    try {
      const profile = await profileChange(root, ['src/brand-new.mjs']);
      const signal = profile.signals.find((entry) => entry.id === 'new-files');
      assert.equal(signal.observed.count, 1);
      assert.deepEqual(signal.observed.paths, ['src/brand-new.mjs']);
      assert.notEqual(signal.level, 'high', 'a new file is ordinary; it is why the other signals are worth reading');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a directory that is not a repository is unavailable, not empty conventions', async () => {
    // The difference matters: empty conventions would make every change look ordinary, which
    // is a claim about the repository rather than an admission that there is none.
    const root = mkdtempSync(join(tmpdir(), 'noesar-divergence-bare-'));
    try {
      await assert.rejects(
        () => buildRepositoryConventions(root),
        (error) => error instanceof DivergenceUnavailable,
      );
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('the co-change graph', () => {
  test('a habitual partner is found; a coincidence is not', async () => {
    const commits = [];
    // a.mjs and b.mjs always move together. c.mjs moved with them exactly once.
    for (let index = 0; index < 10; index += 1) {
      const files = { 'src/a.mjs': `a ${index}`, 'src/b.mjs': `b ${index}` };
      if (index === 3) files['src/c.mjs'] = 'c once';
      commits.push(files);
    }
    const root = repository(commits);
    try {
      const conventions = await buildRepositoryConventions(root);
      const profile = divergenceOf(conventions, ['src/a.mjs']);
      const signal = profile.signals.find((entry) => entry.id === 'co-change');
      const partners = signal.detail.map((entry) => entry.partner);
      assert.deepEqual(partners, ['src/b.mjs'],
        'either the habitual partner was missed or the one-off coincidence was reported as one');
      assert.equal(signal.level, 'high');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('naming the partner too removes the signal', async () => {
    const commits = [];
    for (let index = 0; index < 10; index += 1) commits.push({ 'src/a.mjs': `a ${index}`, 'src/b.mjs': `b ${index}` });
    const root = repository(commits);
    try {
      const conventions = await buildRepositoryConventions(root);
      const profile = divergenceOf(conventions, ['src/a.mjs', 'src/b.mjs']);
      assert.equal(profile.signals.find((entry) => entry.id === 'co-change').level, 'none');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
