// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tasks taken from what this repository actually did, instead of nine written by hand.
//
// `D-0215` measured the providers on a built-in task set and reported `NO_DIFFERENCE`, then
// named the two ways out: a metric on the shape of the decomposition, or tasks from a real
// repository. This is the second. A real commit is a real multi-file change somebody actually
// made — its file list was not chosen to make either provider look good, which is the only
// property that matters in a task set used to compare them.
//
// A commit becomes one task: the files it touched, and whether it deleted any of them. That
// is the same shape a plan step has, so no translation layer stands between the history and
// what is measured.
//
// Merge commits are skipped: their file list is an artefact of the merge, not of a change
// anybody wrote. Commits touching a single file are kept — a task set that dropped them would
// be selecting for the cases where splitting has something to do, which is the thumb on the
// scale this file exists to avoid.
//
// Usage:
//   node tools/derive-tasks-from-history.mjs [count] > tasks.json

import { execFileSync } from 'node:child_process';

const count = Number.parseInt(process.argv[2] ?? '60', 10);
if (!Number.isFinite(count) || count < 1) {
  process.stderr.write('usage: derive-tasks-from-history.mjs [count]\n');
  process.exit(2);
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// `--no-merges` at the source rather than filtering later: a merge's file list never becomes
// a candidate task, so it cannot be counted and then quietly dropped.
const hashes = git(['log', '--no-merges', '-n', String(count), '--format=%H']).trim().split('\n').filter(Boolean);

const tasks = [];
for (const hash of hashes) {
  // --name-status, not --name-only: the status letter is how a deletion is known, and a
  // destructive change is exactly the case the two providers are expected to treat
  // differently. Inferring it from the path would be a guess.
  const raw = git(['show', '--no-renames', '--name-status', '--format=%s', hash]);
  const lines = raw.split('\n');
  const subject = (lines.shift() ?? '').trim();
  const files = [];
  let destructive = false;
  for (const line of lines) {
    const match = line.match(/^([ACDMRT])\d*\t(.+)$/);
    if (!match) continue;
    const [, status, path] = match;
    if (status === 'D') destructive = true;
    files.push(path);
  }
  if (files.length === 0) continue;
  tasks.push({
    id: hash.slice(0, 8),
    request: subject || `apply the change in ${hash.slice(0, 8)}`,
    files,
    // The commands a change of this shape would be checked by. Derived from the files rather
    // than invented per task, and identical for both providers — a command list that differed
    // between the two would be measuring the task set, not the providers.
    commands: commandsFor(files),
    destructive,
  });
}

function commandsFor(files) {
  const commands = [];
  if (files.some((path) => path.endsWith('.mjs') || path.endsWith('.js'))) commands.push('node --test');
  if (files.some((path) => path.endsWith('.rs'))) commands.push('cargo test');
  if (files.some((path) => path.endsWith('.py'))) commands.push('pytest');
  return commands;
}

process.stdout.write(`${JSON.stringify({
  source: 'git history of this repository, --no-merges',
  derivedFrom: `${hashes.length} commit(s)`,
  tasks,
}, null, 2)}\n`);
process.stderr.write(`DERIVED_TASKS=${tasks.length} FROM_COMMITS=${hashes.length}\n`);
