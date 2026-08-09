// Every decision this repository POINTS AT must be a decision somebody actually wrote.
//
// Why this file exists, and it is the second occurrence rather than the first. Images have been
// deployed under tags that name a decision — `d0355-atom-inside`, `d0361-security-hardened` — while
// `docs/DECISION_LOG.md` stopped at `D-0354`. The whole of s335, s336 and s337 lived only in commit
// messages. Commit `aaea1ae` (s334) exists for precisely this reason, to write `D-0349…D-0353` into
// the log "not only into commit messages", and the gap reopened in the very next session.
//
// What is NOT asserted, because it was measured and is false on the shipped tree — a guard that has
// to be suppressed teaches people to suppress guards:
//
//   - contiguity. 51 numbers have no entry (D-0108…D-0151, D-0304…D-0316, D-0325, D-0327), all of
//     them older than this file.
//   - "every D-reference in PROJECT_STATE.json resolves". It names 49 decisions in that missing
//     range. Writing those entries is real owed work; it is not something a test can conjure, and
//     failing red until somebody does it would just be turned off.
//
// What IS asserted is the narrow thing that is both true today and exactly where the recurrence
// happened: the decision named by the image PROJECT_STATE says was DEPLOYED must be written down.
// That is the pointer that went unchecked seven times in a row, because nothing ever read it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const decisionLog = readFileSync(join(repoRoot, 'docs', 'DECISION_LOG.md'), 'utf8');
const projectState = readFileSync(join(repoRoot, 'PROJECT_STATE.json'), 'utf8');

/** The numbers that have a heading of their own, which is what "written down" means here. */
function writtenDecisions(markdown) {
  return new Set([...markdown.matchAll(/^## D-(\d{4})/gm)].map((m) => m[1]));
}

/** Every D-reference in a blob of text, however it is embedded (prose, a note, a tag). */
function referencedDecisions(text) {
  return new Set([...text.matchAll(/\bD-(\d{4})\b/g)].map((m) => m[1]));
}

test('the decision recorded beside the deployed image is written down', () => {
  const written = writtenDecisions(decisionLog);
  const note = JSON.parse(projectState).last_commit_note ?? '';

  const named = [...referencedDecisions(note)].sort();
  assert.ok(
    named.length > 0,
    'PROJECT_STATE.last_commit_note names no decision — a deploy that records no decision is how ' +
      'seven of them went unwritten',
  );

  const dangling = named.filter((n) => !written.has(n));
  assert.deepEqual(
    dangling,
    [],
    `the last deploy recorded ${dangling.map((n) => `D-${n}`).join(', ')}, which ${
      dangling.length === 1 ? 'has' : 'have'
    } no heading in docs/DECISION_LOG.md.`,
  );
});

test('a deployed image tag recorded in PROJECT_STATE.json names a decision that exists', () => {
  // Deploys record the image in `last_commit_note` as e.g. "Deployed as noesar-evolution:d0362-x".
  // The tag carries the decision number in its own spelling (`d0362`), which is the form that went
  // unchecked for seven decisions: nothing reads it, so nothing noticed it pointed nowhere.
  const written = writtenDecisions(decisionLog);
  const tagged = [...projectState.matchAll(/noesar-evolution:d(\d{4})-/g)].map((m) => m[1]);

  for (const number of tagged) {
    assert.ok(
      written.has(number),
      `PROJECT_STATE.json records a deployed image tagged d${number}-…, but docs/DECISION_LOG.md ` +
        `has no "## D-${number}" entry.`,
    );
  }
});

test('no two entries claim the same decision number in the modern range', () => {
  // Below D-0300 the log genuinely repeats D-0025…D-0028 and that history is not being rewritten.
  // From D-0300 on, a collision means one of two entries is about to be read as the other.
  const numbers = [...decisionLog.matchAll(/^## D-(\d{4})/gm)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n >= 300);
  const seen = new Set();
  const collisions = [];
  for (const n of numbers) {
    if (seen.has(n)) collisions.push(n);
    seen.add(n);
  }
  assert.deepEqual(collisions, [], `duplicate decision headings: ${collisions.join(', ')}`);
});
