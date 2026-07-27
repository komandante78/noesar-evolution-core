// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shadow execution in the runtime that ships. Mirrors rust/crates/noesar-shadow; both sides
// answer to conformance/shadow-vectors.json.
//
// Not copy-on-write: overlayfs and reflinks need privileges or a filesystem that supports
// them, and neither is guaranteed where this product installs. Only the paths the plan
// names are copied, and shadowStatus() says so rather than letting a reader assume a
// cheaper mechanism than the one in use.
//
// The comparison is two-sided and the second side is the dangerous one: a file touched that
// nobody declared is the exact shape of the accident this phase exists to prevent.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path';

export const SHADOW_STRATEGY = 'TARGETED_COPY';

export class ShadowError extends Error {
  constructor(kind, reason, path = null) {
    super(reason);
    this.name = 'ShadowError';
    this.kind = kind;
    this.reason = reason;
    this.path = path;
  }
}

// Absolute paths and parent components are rejected before resolution, and the resolved
// result is checked again: a symlink out of the shadow counts as leaving.
export function contained(root, relative) {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new ShadowError('INVALID', 'a path is required');
  }
  if (isAbsolute(relative)) {
    throw new ShadowError('CONTAINMENT', 'an absolute path is not inside the shadow', relative);
  }
  if (normalize(relative).split(/[\\/]/).includes('..')) {
    throw new ShadowError('CONTAINMENT', 'a parent component leaves the shadow', relative);
  }
  const rootResolved = resolve(root);
  const joined = resolve(rootResolved, relative);
  if (joined !== rootResolved && !joined.startsWith(rootResolved + sep)) {
    throw new ShadowError('CONTAINMENT', 'the resolved path is outside the shadow', relative);
  }
  return joined;
}

function digestOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export class ShadowWorkspace {
  #root;
  #baseline = new Map();

  // A path that is not contained by either root aborts the whole creation: a partially built
  // shadow that silently dropped one file would be compared as if it were complete.
  constructor(sourceRoot, shadowRoot, paths) {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new ShadowError('INVALID', 'a shadow of nothing can neither be executed nor observed');
    }
    const resolvedShadow = resolve(shadowRoot);
    const planned = paths.map((relative) => ({
      relative,
      from: contained(sourceRoot, relative),
      to: contained(resolvedShadow, relative),
    }));
    mkdirSync(resolvedShadow, { recursive:true });
    for (const item of planned) {
      mkdirSync(dirname(item.to), { recursive:true });
      if (existsSync(item.from) && statSync(item.from).isFile()) {
        copyFileSync(item.from, item.to);
        this.#baseline.set(item.relative, digestOf(item.to));
      } else {
        // A file the plan names that does not exist yet is legitimate -- the plan may create
        // it -- and its baseline is its absence, recorded as such.
        this.#baseline.set(item.relative, null);
      }
    }
    this.#root = resolvedShadow;
  }

  get root() { return this.#root; }

  get strategy() { return SHADOW_STRATEGY; }

  // Only paths present in the baseline are looked at: claiming to have observed a path the
  // shadow never copied would be a lie about coverage.
  observe(tests = []) {
    const changed = {};
    for (const [relative, before] of this.#baseline) {
      const path = contained(this.#root, relative);
      const after = existsSync(path) && statSync(path).isFile() ? digestOf(path) : null;
      if (before === null && after !== null) changed[relative] = 'CREATED';
      else if (before !== null && after === null) changed[relative] = 'DELETED';
      else if (before !== null && after !== null && before !== after) changed[relative] = 'MODIFIED';
    }
    return { changed, tests };
  }

  discard() {
    if (!this.#root || this.#root === sep) {
      throw new ShadowError('CONTAINMENT', 'refusing to remove a root that is not a shadow');
    }
    rmSync(this.#root, { recursive:true, force:true });
  }
}

export function observationIsEmpty(observation) {
  return Object.keys(observation?.changed ?? {}).length === 0
    && (observation?.tests ?? []).length === 0;
}

export function compare(expectation, observation) {
  // "No differences found" and "nothing was looked at" are the same empty set, and only one
  // of them is a result.
  if (observationIsEmpty(observation)) {
    throw new ShadowError('INVALID',
      'an observation of nothing cannot be compared: it is indistinguishable from a clean run');
  }
  const touched = Object.keys(observation.changed);
  const declared = expectation.pathsTheDiffMustTouch ?? [];
  const outcomeOf = (name) => (observation.tests ?? []).find((test) => test.name === name);

  const testsNeverRun = [];
  const testsExpectedToPassThatFailed = [];
  for (const name of expectation.testsExpectedToPass ?? []) {
    const result = outcomeOf(name);
    if (!result) testsNeverRun.push(name);
    else if (!result.passed) testsExpectedToPassThatFailed.push(name);
  }
  const testsExpectedToFailThatPassed = [];
  for (const name of expectation.testsExpectedToFail ?? []) {
    const result = outcomeOf(name);
    if (!result) testsNeverRun.push(name);
    else if (result.passed) testsExpectedToFailThatPassed.push(name);
  }

  const surprise = {
    expectedAndAbsent: declared.filter((path) => !touched.includes(path)),
    unexpected: touched.filter((path) => !declared.includes(path)),
    testsExpectedToPassThatFailed,
    testsExpectedToFailThatPassed,
    testsNeverRun,
  };
  surprise.clean = surprise.expectedAndAbsent.length === 0
    && surprise.unexpected.length === 0
    && surprise.testsExpectedToPassThatFailed.length === 0
    && surprise.testsExpectedToFailThatPassed.length === 0
    && surprise.testsNeverRun.length === 0;
  return surprise;
}

export function shadowStatus() {
  return {
    strategy: SHADOW_STRATEGY,
    copyOnWrite: false,
    comparesBothDirections: true,
    // Stated, not implied by the absence of an error.
    executesPlans: false,
    reason: 'The shadow copies only the paths a plan names and compares what was declared with what was observed, in both directions. Nothing executes a plan into it yet: the executor that accepts nothing but a capability token is step 5.',
  };
}
