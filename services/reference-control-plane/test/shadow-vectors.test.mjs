// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs conformance/shadow-vectors.json through the Node shadow, plus the filesystem half,
// which is not expressible as data and is tested natively on each side.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  ShadowWorkspace, ShadowError, compare, shadowStatus, contained, SHADOW_STRATEGY,
  probeCopyOnWrite,
} from '../src/shadow.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vectors = JSON.parse(readFileSync(resolve(root, 'conformance/shadow-vectors.json'), 'utf8'));

function caught(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    assert.ok(error instanceof ShadowError, `expected a ShadowError, got ${error}`);
    return error.kind;
  }
}

for (const vector of vectors.cases) {
  test(`compare ${vector.id} — ${vector.why}`, () => {
    if (vector.expected.refused) {
      assert.equal(caught(() => compare(vector.expectation, vector.observation)), 'INVALID');
      return;
    }
    const surprise = compare(vector.expectation, vector.observation);
    assert.equal(surprise.clean, vector.expected.clean, JSON.stringify(surprise));
    for (const field of ['unexpected', 'expectedAndAbsent', 'testsNeverRun',
      'testsExpectedToPassThatFailed', 'testsExpectedToFailThatPassed']) {
      if (vector.expected[field]) assert.deepEqual(surprise[field], vector.expected[field]);
    }
  });
}

test('the vector file has not shrunk unnoticed', () => {
  assert.equal(vectors.cases.length, 10);
});

test('the shadow copies only what the plan names and leaves the source alone', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst-'));
  try {
    writeFileSync(join(source, 'wanted.txt'), 'a');
    writeFileSync(join(source, 'untouched.txt'), 'b');
    const shadow = new ShadowWorkspace(source, shadowRoot, ['wanted.txt']);
    assert.ok(existsSync(join(shadow.root, 'wanted.txt')));
    assert.ok(!existsSync(join(shadow.root, 'untouched.txt')));
    assert.equal(shadow.strategy, SHADOW_STRATEGY);

    writeFileSync(join(shadow.root, 'wanted.txt'), 'changed');
    const observed = shadow.observe([]);
    assert.equal(observed.changed['wanted.txt'], 'MODIFIED');
    // The source is untouched: that is the whole point of a shadow.
    assert.equal(readFileSync(join(source, 'wanted.txt'), 'utf8'), 'a');
    shadow.discard();
    assert.ok(!existsSync(shadow.root));
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});

test('creation, modification and deletion inside the shadow are each observed', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src2-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst2-'));
  try {
    writeFileSync(join(source, 'a.txt'), 'before');
    writeFileSync(join(source, 'gone.txt'), 'x');
    const shadow = new ShadowWorkspace(source, shadowRoot, ['a.txt', 'gone.txt', 'new.txt']);
    writeFileSync(join(shadow.root, 'a.txt'), 'after');
    unlinkSync(join(shadow.root, 'gone.txt'));
    writeFileSync(join(shadow.root, 'new.txt'), 'created');
    const observed = shadow.observe([]);
    assert.equal(observed.changed['a.txt'], 'MODIFIED');
    assert.equal(observed.changed['gone.txt'], 'DELETED');
    assert.equal(observed.changed['new.txt'], 'CREATED');
    shadow.discard();
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});

test('a path leaving the root aborts the whole shadow', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src3-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst3-'));
  try {
    writeFileSync(join(source, 'ok.txt'), 'a');
    for (const escape of ['../outside.txt', '/etc/passwd', 'a/../../outside.txt']) {
      assert.equal(caught(() => contained(source, escape)), 'CONTAINMENT', escape);
    }
    // Aborting the whole creation matters: a shadow that silently dropped one path would be
    // compared as if it were complete.
    assert.equal(
      caught(() => new ShadowWorkspace(source, shadowRoot, ['ok.txt', '../outside.txt'])),
      'CONTAINMENT',
    );
    assert.ok(!existsSync(join(shadowRoot, 'ok.txt')));
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});

test('an untouched shadow observes nothing and therefore cannot be called clean', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src4-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst4-'));
  try {
    writeFileSync(join(source, 'a.txt'), 'same');
    const shadow = new ShadowWorkspace(source, shadowRoot, ['a.txt']);
    const observed = shadow.observe([]);
    assert.deepEqual(observed.changed, {});
    assert.equal(caught(() => compare({ pathsTheDiffMustTouch:['a.txt'] }, observed)), 'INVALID');
    shadow.discard();
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});

test('a shadow of nothing is refused', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src5-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst5-'));
  try {
    assert.equal(caught(() => new ShadowWorkspace(source, shadowRoot, [])), 'INVALID');
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});

// The dangerous side of the comparison is "something happened that nobody declared". A
// shadow that only holds the declared paths cannot ever observe that, so `unexpected` is
// structurally empty and the guarantee is decided by whoever built the shadow -- which is
// the caller. These are the tests that hold the whole-workspace shadow to its purpose.
test('a write nobody declared is observed — the dangerous side is not structurally empty', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src6-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst6-'));
  try {
    writeFileSync(join(source, 'declared.txt'), 'a');
    writeFileSync(join(source, 'nobody-named-me.txt'), 'b');
    const shadow = ShadowWorkspace.ofWorkspace(source, shadowRoot);
    assert.equal(shadow.coverage, 'WHOLE_WORKSPACE');
    // Both exist in the shadow: the plan named one of them, the workspace holds both.
    assert.ok(existsSync(join(shadow.root, 'nobody-named-me.txt')));

    writeFileSync(join(shadow.root, 'declared.txt'), 'changed');
    writeFileSync(join(shadow.root, 'nobody-named-me.txt'), 'touched by accident');
    const observed = shadow.observe([]);
    assert.equal(observed.changed['declared.txt'], 'MODIFIED');
    assert.equal(observed.changed['nobody-named-me.txt'], 'MODIFIED');

    const surprise = compare({ pathsTheDiffMustTouch:['declared.txt'] }, observed);
    assert.equal(surprise.clean, false);
    assert.deepEqual(surprise.unexpected, ['nobody-named-me.txt']);

    // The source is untouched — copy-on-write shares blocks, it does not share writes.
    assert.equal(readFileSync(join(source, 'nobody-named-me.txt'), 'utf8'), 'b');
    shadow.discard();
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});

test('a file created anywhere in the shadow is observed, not only where a plan looked', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src7-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst7-'));
  try {
    mkdirSync(join(source, 'src'), { recursive:true });
    writeFileSync(join(source, 'src/a.txt'), 'a');
    const shadow = ShadowWorkspace.ofWorkspace(source, shadowRoot);
    mkdirSync(join(shadow.root, 'src/deep'), { recursive:true });
    writeFileSync(join(shadow.root, 'src/deep/appeared.txt'), 'new');
    unlinkSync(join(shadow.root, 'src/a.txt'));
    const observed = shadow.observe([]);
    assert.equal(observed.changed['src/deep/appeared.txt'], 'CREATED');
    assert.equal(observed.changed['src/a.txt'], 'DELETED');
    shadow.discard();
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});

test('the mechanism is probed on the real directory, never assumed', () => {
  const probeRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-probe-'));
  try {
    const probe = probeCopyOnWrite(probeRoot);
    assert.ok(typeof probe.supported === 'boolean');
    assert.ok(['REFLINK_CLONE', 'FULL_COPY'].includes(probe.mechanism));
    // Whatever the answer is, it came from an attempt on this directory.
    assert.equal(probe.measured, true);
    assert.equal(probe.supported, probe.mechanism === 'REFLINK_CLONE');
  } finally {
    rmSync(probeRoot, { recursive:true, force:true });
  }
});

test('the status reports the probed mechanism and still states what it does not do', () => {
  const probeRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-status-'));
  try {
    const status = shadowStatus(probeRoot);
    assert.equal(status.measured, true);
    assert.equal(status.copyOnWrite, status.mechanism === 'REFLINK_CLONE');
    assert.equal(status.coverage, 'WHOLE_WORKSPACE');
    assert.equal(status.executesPlans, false);
    assert.equal(status.comparesBothDirections, true);
  } finally {
    rmSync(probeRoot, { recursive:true, force:true });
  }
});

test('a shadow that cannot see outside the declared paths says so', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src8-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst8-'));
  try {
    writeFileSync(join(source, 'a.txt'), 'a');
    const targeted = new ShadowWorkspace(source, shadowRoot, ['a.txt']);
    // Kept, and honest about the guarantee it cannot give.
    assert.equal(targeted.coverage, 'DECLARED_PATHS_ONLY');
    assert.equal(targeted.strategy, SHADOW_STRATEGY);
    targeted.discard();
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});

test('a workspace larger than the declared limits is refused, never silently truncated', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-shadow-src9-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-shadow-dst9-'));
  try {
    for (let i = 0; i < 5; i += 1) writeFileSync(join(source, `f${i}.txt`), 'x');
    // A partial shadow would be compared as if it were the whole workspace.
    assert.equal(
      caught(() => ShadowWorkspace.ofWorkspace(source, shadowRoot, { maxFiles:3 })),
      'LIMIT',
    );
    assert.equal(
      caught(() => ShadowWorkspace.ofWorkspace(source, shadowRoot, { maxBytes:2 })),
      'LIMIT',
    );
  } finally {
    rmSync(source, { recursive:true, force:true });
    rmSync(shadowRoot, { recursive:true, force:true });
  }
});
