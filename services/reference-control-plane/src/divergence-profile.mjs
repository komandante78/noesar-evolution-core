// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Invention II — the repository is the oracle. `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md`
// §3, build order 8, acceptance `CE-010`.
//
// THE PROBLEM IT ANSWERS, IN ONE NUMBER. METR measured maintainer merge decisions sitting
// **24 percentage points below** the SWE-bench score across 296 agent-generated PRs reviewed
// by four real maintainers. The tests say *it works*; the maintainer says *that is not how we
// do it here*. Nobody closes that gap, because "how we do it here" sounds subjective.
//
// It is not subjective. It is already written in the repository: a git history is a corpus of
// thousands of changes **somebody accepted**. So the conventions are RECOMPUTED from that
// history rather than configured by anyone — which is the whole of `CE-010`, and the reason
// its stated verification is "two repositories with opposite conventions produce opposite
// profiles" rather than "the numbers look right".
//
// A CANDIDATE CHANGE GETS A PROFILE, NEVER A SCORE. This module deliberately exposes no
// aggregate, and `divergence-profile.test.mjs` asserts that it never grows one. A single
// number invites a threshold, a threshold invites automation, and the thing being measured —
// whether a human would accept this change here — is exactly what must not be automated. Each
// signal instead says what was observed, what this repository usually does, and how far apart
// those are. The reader decides; the profile makes deciding cheap.
//
// WHAT IT IS NOT. Not a linter (it has no opinion about code), not a quality score, not a
// gate. Nothing here refuses anything.

import { spawn } from 'node:child_process';

const DEFAULT_MAX_COMMITS = 400;

export class DivergenceUnavailable extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'DivergenceUnavailable';
    this.reason = reason;
  }
}

function runGit(cwd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let child;
    // An argv array, never a shell string — the same rule local-model-runtime.mjs states and
    // git-status.mjs follows. A ref name is attacker-influenceable in a repository somebody
    // else wrote.
    try { child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) {
      resolve({ ok: false, stdout: '', stderr: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, stdout, stderr: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr }); });
  });
}

/** Whether a path is a test, by this project's own shapes — declared here rather than
 *  inferred, so a reader can disagree with the rule instead of with a number it produced. */
export function isTestPath(path) {
  const lower = String(path).toLowerCase();
  if (/(^|\/)(tests?|spec|__tests__)\//.test(lower)) return true;
  return /\.(test|spec)\.[a-z0-9]+$/.test(lower) || /_test\.[a-z0-9]+$/.test(lower);
}

/** The layer a path belongs to: its first two segments, or its first if it has only one.
 *  Coarse on purpose — "how many layers does this touch" is the question METR's maintainers
 *  were answering, and a per-directory reading answers a different, noisier one. */
export function layerOf(path) {
  const parts = String(path).split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Reads the accepted changes of a repository and reports what they have in common.
 *
 * Merge commits are excluded (`--no-merges`): a merge's file list is the union of what other
 * commits already contributed, so counting it would report a co-change between files nobody
 * ever changed together.
 */
export async function buildRepositoryConventions(rootDir, { maxCommits = DEFAULT_MAX_COMMITS } = {}) {
  const inside = await runGit(rootDir, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    throw new DivergenceUnavailable('not a git repository, so this repository has no accepted changes to learn from');
  }
  const log = await runGit(rootDir, [
    'log', '--no-merges', `--max-count=${Number(maxCommits) || DEFAULT_MAX_COMMITS}`,
    '--name-only', '--pretty=format:%x00%H',
  ]);
  if (!log.ok) throw new DivergenceUnavailable('git log could not be read');

  const commits = [];
  for (const block of log.stdout.split('\u0000')) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const files = lines.slice(1);
    if (files.length > 0) commits.push({ sha: lines[0], files });
  }
  if (commits.length === 0) {
    throw new DivergenceUnavailable('this repository has no non-merge commits touching files yet');
  }

  const fileChangeCount = new Map();
  const pairCount = new Map();
  const sizes = [];
  const layerCounts = [];
  let commitsWithTest = 0;
  let testFiles = 0;
  let nonTestFiles = 0;

  for (const commit of commits) {
    const unique = [...new Set(commit.files)];
    sizes.push(unique.length);
    layerCounts.push(new Set(unique.map(layerOf)).size);
    let sawTest = false;
    for (const file of unique) {
      fileChangeCount.set(file, (fileChangeCount.get(file) ?? 0) + 1);
      if (isTestPath(file)) { testFiles += 1; sawTest = true; } else { nonTestFiles += 1; }
    }
    if (sawTest) commitsWithTest += 1;
    // Pairs, ordered so `a|b` and `b|a` are one key. A commit touching 200 files would
    // contribute 19900 pairs and drown the graph in coincidence, so wide commits are counted
    // for size and skipped for co-change — declared in the result, not silently dropped.
    if (unique.length <= 25) {
      const sorted = [...unique].sort();
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          const key = `${sorted[i]}\u0000${sorted[j]}`;
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        }
      }
    }
  }

  return {
    commitsAnalysed: commits.length,
    changeSize: { median: median(sizes), max: Math.max(...sizes) },
    layersPerChange: { median: median(layerCounts), max: Math.max(...layerCounts) },
    // Two readings, because they answer different questions and only reporting one of them is
    // how "this project tests its work" turns into a claim nobody checked: how OFTEN a change
    // carries a test at all, and how MANY test files accompany each non-test file.
    testHabit: {
      commitsWithTest,
      shareOfCommitsWithTest: commitsWithTest / commits.length,
      testFilesPerNonTestFile: nonTestFiles === 0 ? 0 : testFiles / nonTestFiles,
    },
    fileChangeCount,
    pairCount,
    coChangeCommitCeiling: 25,
  };
}

/**
 * How far a candidate set of changed paths sits from what this repository usually accepts.
 *
 * Returns signals. Never a score — see the header.
 */
export function divergenceOf(conventions, changedPaths, { minPairSupport = 3, strongPartner = 0.6 } = {}) {
  const paths = [...new Set((changedPaths ?? []).map(String))].sort();
  const signals = [];

  const layers = new Set(paths.map(layerOf));
  signals.push({
    id: 'scope',
    observed: { files: paths.length, layers: layers.size },
    usual: { files: conventions.changeSize.median, layers: conventions.layersPerChange.median },
    level: layers.size > Math.max(1, conventions.layersPerChange.median) * 2 || paths.length > Math.max(1, conventions.changeSize.median) * 4
      ? 'high'
      : layers.size > conventions.layersPerChange.median || paths.length > conventions.changeSize.median * 2
        ? 'medium' : 'none',
    note: `${paths.length} file(s) across ${layers.size} layer(s); accepted changes here touch a median of ${conventions.changeSize.median} across ${conventions.layersPerChange.median}`,
  });

  // Co-change: for each changed file, the partner it is usually changed WITH and that is
  // absent here. This is the signal a maintainer gives as "you forgot the migration".
  const missing = [];
  for (const path of paths) {
    const own = conventions.fileChangeCount.get(path) ?? 0;
    if (own < minPairSupport) continue;
    for (const [key, together] of conventions.pairCount) {
      const [a, b] = key.split('\u0000');
      if (a !== path && b !== path) continue;
      const partner = a === path ? b : a;
      if (paths.includes(partner)) continue;
      const frequency = together / own;
      if (together >= minPairSupport && frequency >= strongPartner) {
        missing.push({ path, partner, together, ofChanges: own, frequency });
      }
    }
  }
  missing.sort((x, y) => y.frequency - x.frequency || (x.path < y.path ? -1 : 1));
  signals.push({
    id: 'co-change',
    observed: { missingPartners: missing.length },
    usual: { rule: `a partner changed with a file in at least ${Math.round(strongPartner * 100)}% of that file's changes` },
    level: missing.length === 0 ? 'none' : missing[0].frequency >= 0.8 ? 'high' : 'medium',
    detail: missing.slice(0, 10),
    note: missing.length === 0
      ? 'nothing this change touches has a habitual partner it left behind'
      : `${missing[0].path} changes with ${missing[0].partner} in ${Math.round(missing[0].frequency * 100)}% of its changes — not here`,
  });

  const tests = paths.filter(isTestPath).length;
  const nonTests = paths.length - tests;
  signals.push({
    id: 'tests',
    observed: { testFiles: tests, otherFiles: nonTests },
    usual: {
      shareOfCommitsWithTest: conventions.testHabit.shareOfCommitsWithTest,
      testFilesPerNonTestFile: conventions.testHabit.testFilesPerNonTestFile,
    },
    level: tests === 0 && nonTests > 0 && conventions.testHabit.shareOfCommitsWithTest >= 0.5
      ? 'high'
      : tests === 0 && nonTests > 0 && conventions.testHabit.shareOfCommitsWithTest >= 0.2 ? 'medium' : 'none',
    note: tests > 0
      ? `${tests} test file(s) changed`
      : `no test changed; ${Math.round(conventions.testHabit.shareOfCommitsWithTest * 100)}% of accepted changes here carry one`,
  });

  const unprecedented = paths.filter((path) => !conventions.fileChangeCount.has(path));
  signals.push({
    id: 'new-files',
    observed: { count: unprecedented.length, paths: unprecedented.slice(0, 10) },
    usual: { rule: 'a file with no history here has no accepted precedent to compare against' },
    // Never 'high'. A new file is ordinary — it is the reason the other signals are worth
    // reading, not a divergence of its own.
    level: unprecedented.length > 0 ? 'medium' : 'none',
    note: unprecedented.length === 0 ? 'every file here has been changed before' : `${unprecedented.length} file(s) have no history in this repository`,
  });

  return {
    basis: {
      commitsAnalysed: conventions.commitsAnalysed,
      recomputed: true,
      configured: false,
      coChangeCommitCeiling: conventions.coChangeCommitCeiling,
    },
    signals,
  };
}

/** The one-call form the workbench uses. */
export async function profileChange(rootDir, changedPaths, options = {}) {
  const conventions = await buildRepositoryConventions(rootDir, options);
  return divergenceOf(conventions, changedPaths, options);
}
