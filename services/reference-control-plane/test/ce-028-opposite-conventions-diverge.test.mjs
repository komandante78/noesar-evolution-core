// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-028` — *"Il profilo di divergenza entra nell'autoratura, e due repository con convenzioni
// opposte producono contenuti diversi a parità di richiesta"*, verified as the row asks: *"lo
// stesso compito su due repository con convenzioni opposte"*.
//
// TWO REAL REPOSITORIES, not two stubbed profiles. `git init`, real commits, and the product's
// own `profileChange` reading their history — because the claim is about what a repository's
// ACCEPTED CHANGES teach, and a hand-written profile object would prove only that a field
// travels from one function to another. The two histories are built to be opposite in the two
// signals `divergence-profile.mjs` computes from habit:
//
//   "tests always"  every accepted change carries its test  -> tests: high, co-change: high
//   "tests never"   no accepted change has ever carried one -> tests: none, co-change: none
//
// WHAT IS ASSERTED, AND WHAT IS NOT. Asserted: the two repositories really do produce opposite
// profiles; the profile really does reach the prompt; and a generator that reads what it is
// asked produces different bytes for the same request. NOT asserted: that a particular live
// model obeys the conventions it is shown — that is a property of a model, not of this product,
// and this suite has no model. The seam is the same one `author.test.mjs` names in its header:
// the proof against a real model is `EVIDENCE/`, never a suite nobody can run without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { Author } from '../src/author.mjs';
import { profileChange } from '../src/divergence-profile.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

// The Author EDITS a file that already has contents (`applyEditBlocks`): a file larger than
// the answer budget cannot be restated, only changed. `edited` says what these tests always
// said — replace everything that is there with this — in the shape the contract now takes.
const edited = (contents, body) => [
  '<<<<<<< SEARCH',
  String(contents).replace(/\n$/, ''),
  '=======',
  String(body).replace(/\n$/, ''),
  '>>>>>>> REPLACE',
].join('\n');

const NOW = Math.floor(Date.now() / 1000);
const git = (cwd, ...args) => execFileSync('git', args, {
  cwd,
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'ce028', GIT_AUTHOR_EMAIL: 'ce028@example.invalid',
    GIT_COMMITTER_NAME: 'ce028', GIT_COMMITTER_EMAIL: 'ce028@example.invalid',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
}).toString();

/**
 * A repository whose accepted changes either always carry a test, or never do.
 *
 * Five commits, because `divergenceOf` requires a file to have at least `minPairSupport` (3)
 * changes of its own before it will name a habitual partner — a habit observed twice is a
 * coincidence, and the module is right to refuse to call it a convention.
 */
function repository({ withTests }) {
  const root = mkdtempSync(join(tmpdir(), `noesar-ce028-${withTests ? 'tested' : 'untested'}-`));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  git(root, 'init', '--quiet');
  git(root, 'config', 'commit.gpgsign', 'false');
  for (let n = 1; n <= 5; n += 1) {
    writeFileSync(join(root, 'src/login.js'), `export function loginRoute() { /* v${n} */ }\n`);
    const staged = ['src/login.js'];
    if (withTests) {
      writeFileSync(join(root, 'test/login.test.js'), `// covers v${n}\n`);
      staged.push('test/login.test.js');
    }
    git(root, 'add', ...staged);
    git(root, 'commit', '--quiet', '-m', `change ${n}`);
  }
  return root;
}

const signal = (profile, id) => profile.signals.find((entry) => entry.id === id);

// --- the two repositories really are opposite ----------------------------------------------

test('two repositories with opposite histories produce opposite profiles for the same change', async (t) => {
  const tested = repository({ withTests: true });
  const untested = repository({ withTests: false });
  t.after(() => { for (const r of [tested, untested]) rmSync(r, { recursive: true, force: true }); });

  // The same request in both: touch `src/login.js` and nothing else.
  const a = await profileChange(tested, ['src/login.js']);
  const b = await profileChange(untested, ['src/login.js']);

  assert.equal(a.basis.commitsAnalysed, 5);
  assert.equal(b.basis.commitsAnalysed, 5);

  assert.equal(signal(a, 'tests').level, 'high',
    'a repository where every accepted change carries a test must call a change with none a divergence');
  assert.equal(signal(b, 'tests').level, 'none',
    'a repository that has never carried a test cannot call their absence a divergence');
  assert.match(signal(a, 'tests').note, /100% of accepted changes here carry one/);

  assert.equal(signal(a, 'co-change').level, 'high');
  assert.match(signal(a, 'co-change').note, /src\/login\.js changes with test\/login\.test\.js in 100% of its changes — not here/);
  assert.equal(signal(b, 'co-change').level, 'none');

  // The signals that do NOT depend on the habit stay the same, which is what makes the two
  // above a real contrast rather than two profiles that differ everywhere.
  assert.equal(signal(a, 'new-files').level, signal(b, 'new-files').level);
});

// --- and the profile reaches the authoring --------------------------------------------------

/** A stand-in for a model that reads what it is asked. It does one thing: obey the conventions
 *  section. That is exactly the behaviour under test — whether the Author SHOWS the conventions
 *  — and nothing more is claimed of it. */
function conventionReadingGenerator(seen) {
  return async ({ prompt, contents }) => {
    seen.push(prompt);
    const wantsTest = /- tests: (high|medium)/.test(prompt);
    const partner = /- co-change: (high|medium)/.test(prompt);
    const notes = [
      wantsTest ? '// this repository expects a test with a change like this' : null,
      partner ? '// and the file it is usually changed with' : null,
    ].filter(Boolean).join('\n');
    return edited(contents, `${notes}${notes ? '\n' : ''}export function loginRoute() { /* rate limited */ }`);
  };
}

function benchOn(root, seen) {
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce028-sh-'));
  const runs = mkdtempSync(join(tmpdir(), 'noesar-ce028-runs-'));
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: root, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)),
    events: new EventLedger(), author: new Author({ generate: conventionReadingGenerator(seen) }),
    runStoreDirectory: runs,
  });
  return { orchestrator, cleanup: () => { for (const d of [shadows, runs]) rmSync(d, { recursive: true, force: true }); } };
}

const SAME_REQUEST = {
  request: 'rate limit the login route',
  files: [{ path: 'src/login.js', contents: 'export function loginRoute() { /* v5 */ }\n' }],
  actor: 'owner', nowUnix: NOW,
};

test('the same request on two repositories with opposite conventions produces different content', async (t) => {
  const tested = repository({ withTests: true });
  const untested = repository({ withTests: false });
  const seenTested = [];
  const seenUntested = [];
  const a = benchOn(tested, seenTested);
  const b = benchOn(untested, seenUntested);
  t.after(() => {
    a.cleanup(); b.cleanup();
    for (const r of [tested, untested]) rmSync(r, { recursive: true, force: true });
  });

  const planA = await a.orchestrator.plan({ ...SAME_REQUEST });
  const planB = await b.orchestrator.plan({ ...SAME_REQUEST });

  // 1 · the profile really was computed, from the repository, on both sides
  assert.equal(planA.divergence.available, true, planA.divergence.reason ?? '');
  assert.equal(planB.divergence.available, true, planB.divergence.reason ?? '');
  assert.equal(planA.divergence.basis.commitsAnalysed, 5);

  // 2 · the profile really entered the AUTHORING — the prompt, not just the answer
  assert.match(seenTested[0], /Conventions induced from this repository's own history — match them:/);
  assert.match(seenTested[0], /- tests: high — no test changed; 100% of accepted changes here carry one/);
  assert.match(seenUntested[0], /- tests: none/);
  assert.doesNotMatch(seenUntested[0], /- tests: high/);
  // Written after `author.mjs`'s own note that this line once read `signal.signal` against a
  // module emitting `id`, and sent `- undefined: high` to the model for a whole phase: a prompt
  // that looks populated and says nothing. Asserted on the rendered text for that reason.
  assert.doesNotMatch(seenTested[0], /- undefined:/);

  // 3 · and the same request came out as different bytes — asserted on the CONTENT digest the
  // product computes, not on the prompts, because "the prompts differed" is step 2 and would
  // be a weaker claim wearing this step's name.
  assert.equal(planA.authoring.authored, 1);
  assert.equal(planB.authoring.authored, 1);
  assert.notEqual(planA.authoring.digest, planB.authoring.digest,
    'the same request on two repositories with opposite conventions produced identical content');

  const bodyA = [...a.orchestrator.get(planA.runId).authoredContents.values()][0];
  const bodyB = [...b.orchestrator.get(planB.runId).authoredContents.values()][0];
  assert.match(bodyA, /this repository expects a test/);
  assert.doesNotMatch(bodyB, /this repository expects a test/);
  // The functional line is identical in both: what the conventions changed is what the change
  // CARRIES, not what it does. A test asserting the two bodies share nothing would pass for the
  // wrong reason — two unrelated answers are not evidence that conventions were read.
  assert.match(bodyA, /export function loginRoute\(\) \{ \/\* rate limited \*\/ \}/);
  assert.match(bodyB, /export function loginRoute\(\) \{ \/\* rate limited \*\/ \}/);
});

// --- the honest boundary --------------------------------------------------------------------

test('a workspace with no history says so instead of inventing a profile', async (t) => {
  const bare = mkdtempSync(join(tmpdir(), 'noesar-ce028-bare-'));
  mkdirSync(join(bare, 'src'), { recursive: true });
  writeFileSync(join(bare, 'src/login.js'), 'export function loginRoute() {}\n');
  const seen = [];
  const b = benchOn(bare, seen);
  t.after(() => { b.cleanup(); rmSync(bare, { recursive: true, force: true }); });

  const plan = await b.orchestrator.plan({ ...SAME_REQUEST });
  assert.equal(plan.divergence.available, false);
  assert.match(plan.divergence.reason, /not a git repository/);
  // The prompt must then carry NO conventions section at all — an empty one would read as
  // "this repository has no conventions", which is a different and false claim.
  assert.doesNotMatch(seen[0], /Conventions induced from this repository/);
  // And the authoring still happens: no history is not a reason to refuse to write.
  assert.equal(plan.authoring.authored, 1);
});
