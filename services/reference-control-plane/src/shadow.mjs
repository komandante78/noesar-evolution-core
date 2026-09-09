// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shadow execution in the runtime that ships. Mirrors rust/crates/noesar-shadow; both sides
// answer to conformance/shadow-vectors.json.
//
// Copy-on-write, where the filesystem actually provides it -- and that is decided by an
// attempt on the real directory, never by an assumption. A reflink clone (FICLONE) needs no
// privileges and no mount of our own; it needs a filesystem that supports it, so the answer
// is measured per installation and reported. Where it is absent the same tree is copied in
// full, which is slower and identical in behaviour, and the status says which one happened.
//
// The shadow holds the WHOLE workspace, not only the paths a plan names. That is not an
// optimisation. The comparison is two-sided and the second side -- a file touched that
// nobody declared -- can only be observed in a shadow that contains files nobody declared.
// A shadow built from exactly the declared paths makes `unexpected` structurally empty, and
// hands the guarantee to whoever built it.

import { createHash } from 'node:crypto';
import {
  constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync,
  readFileSync, readlinkSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative as relativeTo, resolve, sep } from 'node:path';

/** Only the paths a plan names are copied. Kept for callers that want a narrow shadow. */
export const SHADOW_STRATEGY = 'TARGETED_COPY';

export const MECHANISM_REFLINK = 'REFLINK_CLONE';
export const MECHANISM_COPY = 'FULL_COPY';

export const COVERAGE_WHOLE = 'WHOLE_WORKSPACE';
export const COVERAGE_DECLARED = 'DECLARED_PATHS_ONLY';

/** Refused rather than truncated: see materialise(). */
export const DEFAULT_MAX_FILES = 20000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

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

// A symlink is digested by where it points, not by what it points at: retargeting a link is
// a change to the workspace, and following it would read outside the shadow.
function digestOfLink(path) {
  return createHash('sha256').update(`symlink:${readlinkSync(path)}`).digest('hex');
}

/**
 * Does this directory support reflinks? Answered by trying one, in the directory the shadow
 * will actually live in -- filesystem support is a property of the mount, so asking anywhere
 * else answers a different question. COPYFILE_FICLONE_FORCE fails rather than falling back,
 * which is exactly what makes it a probe and not just a fast path.
 */
export function probeCopyOnWrite(directory) {
  const stamp = `${process.pid}-${process.hrtime.bigint()}`;
  const from = join(directory, `.noesar-cow-probe-${stamp}`);
  const to = `${from}.clone`;
  let supported = false;
  try {
    mkdirSync(directory, { recursive:true });
    writeFileSync(from, 'noesar copy-on-write probe');
    copyFileSync(from, to, fsConstants.COPYFILE_FICLONE_FORCE);
    supported = true;
  } catch {
    supported = false;
  } finally {
    for (const path of [from, to]) {
      try { if (existsSync(path)) unlinkSync(path); } catch { /* the probe cleans up or says nothing */ }
    }
  }
  return {
    measured: true,
    supported,
    mechanism: supported ? MECHANISM_REFLINK : MECHANISM_COPY,
  };
}

// A file this installation cannot READ stops the copy, and it must: a shadow that quietly
// skipped one would compare a tree that is not the workspace and call the difference clean.
// What was missing was the way out. Measured on the live installation, 2026-09-07: a single
// file left `0600 root:root` inside the workspace stopped every simulation, and said so with
// a bare errno that names the path and neither the cause nor the remedy.
function readFailure(error, from) {
  if (error?.code !== 'EACCES' && error?.code !== 'EPERM') return error;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const gid = typeof process.getgid === 'function' ? process.getgid() : null;
  return new ShadowError('IO',
    `${from} cannot be read by this installation${uid === null ? '' : `, which runs as uid ${uid}`}. `
    + 'The shadow copies every file it compares, so this run stops here rather than compare a tree '
    + 'that is not the workspace and report the difference as clean. '
    + `Make that file readable to it${gid === null ? '' : `: chown :${gid} <file> && chmod 0640 <file>`}.`,
    from);
}

function cloneFile(from, to, useReflink) {
  try {
    return cloneFileOnce(from, to, useReflink);
  } catch (error) {
    throw readFailure(error, from);
  }
}

function cloneFileOnce(from, to, useReflink) {
  if (useReflink) {
    try {
      copyFileSync(from, to, fsConstants.COPYFILE_FICLONE_FORCE);
      return true;
    } catch {
      // The probe passed and this file did not: a hard link, a different mount underneath,
      // a filesystem that clones only some inodes. Fall back for this file and keep going --
      // but the caller is told the mechanism degraded rather than left to assume it held.
      copyFileSync(from, to);
      return false;
    }
  }
  copyFileSync(from, to);
  return false;
}

// Walks the source tree once, producing the entries to materialise. Anything that is not a
// file, a directory or a symlink -- a socket, a fifo, a device -- cannot be cloned and is
// EXCLUDED AND COUNTED rather than silently passed over: the live workspace holds PostgreSQL
// sockets, so refusing outright would make the whole mechanism unusable on the real
// installation, and skipping in silence would overstate what the shadow covers.
function walkSource(sourceRoot, limits) {
  const files = [];
  const directories = [];
  const links = [];
  const excluded = [];
  let bytes = 0;
  const stack = [sourceRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes:true });
    } catch (error) {
      throw new ShadowError('IO', `the source tree could not be read: ${error.code ?? error.message}`,
        relativeTo(sourceRoot, current));
    }
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      const rel = relativeTo(sourceRoot, absolute);
      if (entry.isDirectory()) {
        directories.push(rel);
        stack.push(absolute);
      } else if (entry.isSymbolicLink()) {
        links.push(rel);
      } else if (entry.isFile()) {
        let size = 0;
        try { size = lstatSync(absolute).size; } catch { size = 0; }
        bytes += size;
        files.push(rel);
        if (files.length > limits.maxFiles) {
          throw new ShadowError('LIMIT',
            `the workspace holds more than ${limits.maxFiles} files; a partial shadow would be compared as if it were complete`,
            rel);
        }
        if (bytes > limits.maxBytes) {
          throw new ShadowError('LIMIT',
            `the workspace exceeds ${limits.maxBytes} bytes; a partial shadow would be compared as if it were complete`,
            rel);
        }
      } else {
        excluded.push({ path:rel, why:'not a file, directory or symlink — it cannot be cloned' });
      }
    }
  }
  return { files, directories, links, excluded };
}

export class ShadowWorkspace {
  #root;
  #source;
  #baseline = new Map();
  #coverage;
  #strategy;
  #mechanism;
  #excluded = [];
  #degraded = 0;

  // A path that is not contained by either root aborts the whole creation: a partially built
  // shadow that silently dropped one file would be compared as if it were complete.
  //
  // `paths` names a targeted shadow; `options.wholeWorkspace` materialises the tree. Both
  // run through this constructor because private fields are installed here and nowhere else.
  constructor(sourceRoot, shadowRoot, paths, options = {}) {
    if (options.wholeWorkspace) {
      this.#materialise(sourceRoot, shadowRoot, options);
      return;
    }
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
        try { copyFileSync(item.from, item.to); } catch (error) { throw readFailure(error, item.from); }
        this.#baseline.set(item.relative, digestOf(item.to));
      } else {
        // A file the plan names that does not exist yet is legitimate -- the plan may create
        // it -- and its baseline is its absence, recorded as such.
        this.#baseline.set(item.relative, null);
      }
    }
    this.#root = resolvedShadow;
    this.#source = resolve(sourceRoot);
    this.#coverage = COVERAGE_DECLARED;
    this.#strategy = SHADOW_STRATEGY;
    this.#mechanism = MECHANISM_COPY;
  }

  /**
   * The whole workspace, copy-on-write where the mount allows it. This is the shadow the
   * plan asks for: it can hold a file nobody declared, which is the only way the comparison
   * can ever report that one was touched.
   */
  static ofWorkspace(sourceRoot, shadowRoot, options = {}) {
    return new ShadowWorkspace(sourceRoot, shadowRoot, null, { ...options, wholeWorkspace:true });
  }

  #materialise(sourceRoot, shadowRoot, options) {
    const limits = {
      maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    };
    const source = resolve(sourceRoot);
    const resolvedShadow = resolve(shadowRoot);
    if (resolvedShadow === source || resolvedShadow.startsWith(source + sep)
      || source.startsWith(resolvedShadow + sep)) {
      throw new ShadowError('CONTAINMENT',
        'the shadow and the workspace must not contain one another');
    }
    if (!existsSync(source) || !statSync(source).isDirectory()) {
      throw new ShadowError('INVALID', 'the workspace to shadow must be an existing directory');
    }
    // The walk happens first and throws before anything is written: a LIMIT refusal must not
    // leave half a tree behind that a later reader could mistake for a shadow.
    const found = walkSource(source, limits);

    mkdirSync(resolvedShadow, { recursive:true });
    const probe = probeCopyOnWrite(resolvedShadow);

    this.#root = resolvedShadow;
    this.#source = source;
    this.#baseline = new Map();
    this.#coverage = COVERAGE_WHOLE;
    this.#strategy = probe.mechanism;
    this.#mechanism = probe.mechanism;
    this.#excluded = found.excluded;
    this.#degraded = 0;

    for (const rel of found.directories) mkdirSync(contained(resolvedShadow, rel), { recursive:true });
    for (const rel of found.files) {
      const to = contained(resolvedShadow, rel);
      mkdirSync(dirname(to), { recursive:true });
      const cloned = cloneFile(join(source, rel), to, probe.supported);
      if (probe.supported && !cloned) this.#degraded += 1;
      this.#baseline.set(rel, digestOf(to));
    }
    for (const rel of found.links) {
      const to = contained(resolvedShadow, rel);
      mkdirSync(dirname(to), { recursive:true });
      // Recreated as a link, not as its contents: following it would read outside.
      symlinkSync(readlinkSync(join(source, rel)), to);
      this.#baseline.set(rel, digestOfLink(to));
    }
    if (this.#baseline.size === 0) {
      throw new ShadowError('INVALID', 'a shadow of nothing can neither be executed nor observed');
    }
  }

  get root() { return this.#root; }

  get source() { return this.#source; }

  get strategy() { return this.#strategy; }

  get mechanism() { return this.#mechanism; }

  /** WHOLE_WORKSPACE or DECLARED_PATHS_ONLY — what this shadow is able to observe. */
  get coverage() { return this.#coverage; }

  /** Entries the shadow could not clone, listed rather than silently absent. */
  get excluded() { return [...this.#excluded]; }

  /** Files for which the reflink was refused after the probe passed. */
  get degradedClones() { return this.#degraded; }

  get baselineSize() { return this.#baseline.size; }

  // A whole-workspace shadow walks the tree it holds, so a path that nobody named is still
  // seen. A targeted shadow can only look at what it copied, and says so through `coverage`
  // rather than presenting the narrower answer as the same thing.
  observe(tests = []) {
    const changed = {};
    const now = this.#coverage === COVERAGE_WHOLE
      ? this.#currentTree()
      : this.#currentBaselinePaths();
    for (const [relative, before] of this.#baseline) {
      const after = now.get(relative) ?? null;
      if (before === null && after !== null) changed[relative] = 'CREATED';
      else if (before !== null && after === null) changed[relative] = 'DELETED';
      else if (before !== null && after !== null && before !== after) changed[relative] = 'MODIFIED';
    }
    if (this.#coverage === COVERAGE_WHOLE) {
      for (const [relative] of now) {
        if (!this.#baseline.has(relative)) changed[relative] = 'CREATED';
      }
    }
    return { changed, tests };
  }

  #currentBaselinePaths() {
    const now = new Map();
    for (const [relative] of this.#baseline) {
      const path = contained(this.#root, relative);
      if (existsSync(path) && statSync(path).isFile()) now.set(relative, digestOf(path));
    }
    return now;
  }

  #currentTree() {
    const now = new Map();
    const stack = [this.#root];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes:true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const absolute = join(current, entry.name);
        const rel = relativeTo(this.#root, absolute);
        if (entry.isDirectory()) stack.push(absolute);
        else if (entry.isSymbolicLink()) now.set(rel, digestOfLink(absolute));
        else if (entry.isFile()) now.set(rel, digestOf(absolute));
      }
    }
    return now;
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
  // A declared path naming a DIRECTORY is not a diff target and never could be: `observe()`
  // keys its changes by FILE path, so `.` — the working directory a declared command runs in
  // — can never appear among them. Requiring it makes every run that declares a command dirty
  // for a reason nothing could ever satisfy.
  //
  // Excluding it hides nothing, and that is why no field is added to report the exclusion: a
  // requirement that cannot distinguish a clean run from a dirty one carried no information
  // to lose. The producing side keeps its own guard (`reasoning.mjs::expect` does not emit
  // it), but the rule belongs HERE as well, because this is the ONLY place every provider's
  // expectation passes through — including an external one this build does not own and cannot
  // rebuild. Measured, not anticipated: on the reference installation `expect` is routed to
  // ATOM, which answered with `.` in it, and a command that ran perfectly still came back
  // `expectedAndAbsent: ["."]`.
  const declared = (expectation.pathsTheDiffMustTouch ?? []).filter((path) => path !== '.');
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

  // A command the plan DECLARED, which ran and failed, cannot leave the run clean — whether or
  // not the expectation named it. Measured on the live installation on 2026-09-09, sandbox on:
  // a plan declaring `/bin/false` ran it, `observation.tests` recorded `passed: false`, and the
  // run still came back clean and PROMOTED. Two reasons compounded, and either alone is enough:
  // `reasoning.mjs::expect` lists a command under `testsExpectedToPass` only when the literal
  // word `test` occurs in the command string, so `/bin/false` was never claimed; and this
  // installation routes `expect` to ATOM, which lists none at all. The property the product
  // states of itself — a declared test that passes promotes, one that fails does not — held
  // only for commands whose text happened to contain a word.
  //
  // The rule belongs HERE for the same reason the `.` rule above does: this is the ONLY place
  // every provider's expectation passes through, including an external one this build does not
  // own and cannot rebuild. A command the expectation declares as expected-to-FAIL is excluded:
  // there its failure is the claim, not a surprise (`SHADOW-012`).
  const expectedToFail = expectation.testsExpectedToFail ?? [];
  const declaredCommandsThatFailed = (observation.tests ?? [])
    .filter((test) => !test.passed
      && !expectedToFail.includes(test.name)
      && !testsExpectedToPassThatFailed.includes(test.name))
    .map((test) => test.name);

  const surprise = {
    expectedAndAbsent: declared.filter((path) => !touched.includes(path)),
    unexpected: touched.filter((path) => !declared.includes(path)),
    testsExpectedToPassThatFailed,
    testsExpectedToFailThatPassed,
    testsNeverRun,
    declaredCommandsThatFailed,
  };
  surprise.clean = surprise.expectedAndAbsent.length === 0
    && surprise.unexpected.length === 0
    && surprise.testsExpectedToPassThatFailed.length === 0
    && surprise.testsExpectedToFailThatPassed.length === 0
    && surprise.testsNeverRun.length === 0
    && surprise.declaredCommandsThatFailed.length === 0;
  return surprise;
}

/**
 * The mechanism is probed against `probeRoot` at the moment of asking, so the installation
 * reports what its own filesystem does rather than what the build hoped for.
 */
export function shadowStatus(probeRoot) {
  const probe = probeCopyOnWrite(probeRoot);
  return {
    mechanism: probe.mechanism,
    copyOnWrite: probe.supported,
    // Stated so nobody has to infer that the answer came from an attempt.
    measured: probe.measured,
    coverage: COVERAGE_WHOLE,
    probedAt: probeRoot,
    comparesBothDirections: true,
    // Stated, not implied by the absence of an error. D-0190/D-0191: /api/v1/workspace-actions
    // now builds a real whole-workspace shadow and executes an approved plan into it on every
    // approval — this is a statement about the mechanism, not about the directory this
    // particular call happened to probe (`probeRoot` is only ever a reflink probe target).
    executesPlans: true,
    reason: probe.supported
      ? 'The shadow is a reflink clone of the whole workspace, so a file nobody declared is present and a write to it is observed. The comparison runs in both directions. /api/v1/workspace-actions executes an approved plan into a shadow like this one on every approval, and promotes to the real workspace only when the comparison came back clean.'
      : 'This filesystem refused a reflink clone, so the whole workspace is copied in full instead — same coverage and same observations, more time and more space. The comparison runs in both directions. /api/v1/workspace-actions executes an approved plan into a shadow like this one on every approval, and promotes to the real workspace only when the comparison came back clean.',
  };
}
