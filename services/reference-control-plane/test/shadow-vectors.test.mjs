// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs conformance/shadow-vectors.json through the Node shadow, plus the filesystem half,
// which is not expressible as data and is tested natively on each side.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  ShadowWorkspace, ShadowError, compare, shadowStatus, contained, SHADOW_STRATEGY,
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

test('the status states what it does not do instead of implying it', () => {
  const status = shadowStatus();
  assert.equal(status.copyOnWrite, false);
  assert.equal(status.executesPlans, false);
  assert.equal(status.comparesBothDirections, true);
});
