// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regenerates MANIFEST.sha256 — the integrity manifest for this repository's tracked files.
//
//   node tools/generate-manifest.mjs [--check]
//
// --check writes nothing and exits non-zero when the manifest on disk disagrees with the
// files. That is the form the battery and the pre-commit hook call.
//
// # Which manifest this is, because the name has carried two referents
//
// `docs/SOURCE_PROVENANCE.md` §3.2 records a `MANIFEST.sha256` that arrived *inside* V4 source
// package 01 and verified 5,606/5,606 against this repository at extraction. That was the
// **received** instance, and its verification result is written down in that document, which is
// where a historical fact belongs. The file in the working tree is no longer that record — it
// has been rewritten across 109 commits — so from `D-0615` it is unambiguously the **produced**
// instance: the manifest this project ships, describing this repository as it is now.
//
// The distinction is never "which list"; it is always "which instance". This project has already
// been burned once by one vocabulary with two referents (`L0-L8`, `MASTER_PROJECT/02_ATOM.md`),
// and the answer to that is to name the instance every time, not to invent a second name.
//
// # Scope, and why it is this one
//
// Every file tracked by git, minus this manifest itself. That set has an objective definition,
// is reproducible by anyone who clones the repository, and excludes by construction the six
// entries the previous manifest carried for files git does not track — a `.pyc` under
// `tools/__pycache__/` and three vendored Rust build artefacts (`.a`, `.o`, `.wasm`).
//
// # Portability (CLAUDE10.md §60-64)
//
// Generation needs git; verification must not. A delivered archive has no `.git`, and the
// consumer verifying it is the whole point of shipping a manifest. So when git is absent
// `--check` still verifies every hash it can, and **declares** that completeness went
// unchecked. It never passes silently on half a check.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.join(here, '..');
export const MANIFEST_NAME = 'MANIFEST.sha256';

/** The manifest never lists itself: a file cannot carry its own hash. */
export function isSelf(relPath) {
  return relPath === MANIFEST_NAME;
}

export function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

/**
 * Is this tracked path something the manifest can attest? One definition, because the question
 * is asked twice — once when generating and once when checking — and two spellings of "which
 * files belong here" is exactly how they drift apart. `tools/deploy/redeploy.sh` records the
 * same lesson from the other direction: `env_count()` exists because "how many variables" had
 * been spelled two ways three lines apart (`D-0608`).
 *
 * Symlinks and gitlinks are tracked but have no content of their own to hash. Without this
 * shared predicate the generator would skip them and the checker would then report them as
 * "tracked but not listed" — a failure that regenerating could never repair. Measured
 * 2026-08-21: this repository has zero such entries, so the trap is latent, not active. It is
 * repaired anyway, because a gate that can wedge itself is worse than no gate.
 */
export function isAttestable(absPath) {
  let stat;
  try {
    stat = fs.lstatSync(absPath);
  } catch {
    return false;
  }
  return stat.isFile();
}

/**
 * The tracked set, or null when git cannot answer. Null is a real answer and callers must
 * handle it — it is the difference between "complete" and "as far as could be checked".
 */
export function trackedFiles(root = repoRoot) {
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // git's own "fatal: not a git repository" would otherwise land on stderr underneath the
      // tool's deliberate, calmer declaration of the same fact. The degraded path is designed;
      // it should not read like a crash.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return out
    .split('\0')
    .filter(Boolean)
    .filter((rel) => !isSelf(rel))
    // A path tracked but deleted from the working tree is not hashable. It is reported as a
    // finding by check(), not silently dropped here.
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `<sha256>  ./<path>` — the `./` prefix is what the shipped verifiers already expect. */
export function formatLine(hash, relPath) {
  return `${hash}  ./${relPath}`;
}

export function parseManifest(text) {
  const entries = [];
  const malformed = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const sep = line.indexOf('  ');
    if (sep !== 64 || !/^[0-9a-f]{64}$/.test(line.slice(0, 64))) {
      malformed.push(line);
      continue;
    }
    entries.push({ hash: line.slice(0, 64), path: line.slice(sep + 2).replace(/^\.\//, '') });
  }
  return { entries, malformed };
}

export function buildManifest(root = repoRoot) {
  const tracked = trackedFiles(root);
  if (tracked === null) throw new Error('git is unavailable: the manifest cannot be generated');
  const lines = [];
  const unreadable = [];
  for (const rel of tracked) {
    const abs = path.join(root, rel);
    if (!isAttestable(abs)) {
      unreadable.push(rel);
      continue;
    }
    lines.push(formatLine(sha256File(abs), rel));
  }
  return { text: `${lines.join('\n')}\n`, count: lines.length, unreadable };
}

/**
 * Compares the manifest on disk with the files. Returns a verdict object rather than printing,
 * so the test suite can assert on it without parsing stdout.
 */
export function check(root = repoRoot) {
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: 'absent', wrong: [], missingFile: [], notListed: [], untracked: [], malformed: [], completenessChecked: false };
  }
  const { entries, malformed } = parseManifest(fs.readFileSync(manifestPath, 'utf8'));

  const wrong = [];
  const missingFile = [];
  for (const entry of entries) {
    const abs = path.join(root, entry.path);
    if (!isAttestable(abs)) {
      missingFile.push(entry.path);
      continue;
    }
    if (sha256File(abs) !== entry.hash) wrong.push(entry.path);
  }

  const tracked = trackedFiles(root);
  let notListed = [];
  let untracked = [];
  const completenessChecked = tracked !== null;
  if (completenessChecked) {
    const listed = new Set(entries.map((e) => e.path));
    const trackedSet = new Set(tracked);
    // Same predicate the generator uses: a tracked path with no regular-file content is not
    // expected in the manifest, so it must not be reported as a hole the generator would
    // refuse to fill. This is the shared definition, not a second copy of the rule.
    notListed = tracked.filter((rel) => !listed.has(rel) && isAttestable(path.join(root, rel)));
    untracked = entries.map((e) => e.path).filter((rel) => !trackedSet.has(rel));
  }

  const ok =
    malformed.length === 0 &&
    wrong.length === 0 &&
    missingFile.length === 0 &&
    notListed.length === 0 &&
    untracked.length === 0;

  return { ok, entries: entries.length, wrong, missingFile, notListed, untracked, malformed, completenessChecked };
}

function sample(list, n = 5) {
  return list.slice(0, n).map((p) => `      ${p}`).join('\n') + (list.length > n ? `\n      … ${list.length - n} more` : '');
}

function main(argv) {
  const checkOnly = argv.includes('--check');
  const manifestPath = path.join(repoRoot, MANIFEST_NAME);

  if (checkOnly) {
    const verdict = check();
    if (verdict.reason === 'absent') {
      console.error(`MANIFEST=FAIL ${MANIFEST_NAME} is absent`);
      return 1;
    }
    if (verdict.ok) {
      const scope = verdict.completenessChecked
        ? `${verdict.entries} files, complete against git`
        : `${verdict.entries} files hashed; COMPLETENESS UNCHECKED (no git on this host)`;
      console.log(`MANIFEST=OK ${scope}`);
      // Without git the check is partial, and a partial check is not a pass.
      return verdict.completenessChecked ? 0 : 2;
    }
    console.error(`MANIFEST=FAIL entries=${verdict.entries}`);
    if (verdict.malformed.length) console.error(`  malformed lines: ${verdict.malformed.length}`);
    if (verdict.wrong.length) console.error(`  hash differs (${verdict.wrong.length}):\n${sample(verdict.wrong)}`);
    if (verdict.missingFile.length) console.error(`  listed but not a readable file (${verdict.missingFile.length}):\n${sample(verdict.missingFile)}`);
    if (verdict.notListed.length) console.error(`  tracked but not listed (${verdict.notListed.length}):\n${sample(verdict.notListed)}`);
    if (verdict.untracked.length) console.error(`  listed but not tracked (${verdict.untracked.length}):\n${sample(verdict.untracked)}`);
    if (!verdict.completenessChecked) console.error('  NOTE: git unavailable — completeness was not checked');
    console.error(`  repair: node tools/generate-manifest.mjs`);
    return 1;
  }

  const { text, count, unreadable } = buildManifest();
  fs.writeFileSync(manifestPath, text);
  console.log(`MANIFEST=WRITTEN ${count} files`);
  if (unreadable.length) {
    console.log(`  skipped ${unreadable.length} tracked path(s) with no regular-file content:`);
    console.log(sample(unreadable));
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
