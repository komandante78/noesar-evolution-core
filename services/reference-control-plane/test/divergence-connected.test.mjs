// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 7 (`17`), `CE-010`: the divergence profile CONNECTED — the Author receives it before it
// writes, and both shells show it beside the change.
//
// The measure `17` sets is not "the module works" (`divergence-profile.test.mjs` covers that).
// It is: **two repositories with opposite conventions produce opposite profiles, and they are
// seen**. So these tests build two real git repositories with deliberately opposite habits and
// profile the same shape of change against each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { profileChange, DivergenceUnavailable } from '../src/divergence-profile.mjs';
import { buildAuthoringPrompt, Author } from '../src/author.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { createSessionDispatch, SESSION_METHOD_POLICY } from '../src/session-protocol.mjs';
import { divergenceLines, divergenceSummary, DIVERGENCE_LEVELS } from '../../../apps/webui-static/coden-view-model.js';
import { freshTempDir } from './support/workspace.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  },
});

function repository(name) {
  const root = freshTempDir(`noesar-phase7-${name}-`);
  git(root, 'init', '-q', '-b', 'main');
  return root;
}

function commit(root, files, message) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

/**
 * A repository whose accepted history ALWAYS carries a test with the source it changes.
 * A source-only change here is out of keeping, and the profile must say so.
 */
function testDisciplined() {
  const root = repository('disciplined');
  commit(root, { 'src/a.js': 'export const a = 0;\n', 'test/a.test.js': 'a\n', 'README.md': '#\n' }, 'init');
  for (let n = 1; n <= 8; n += 1) {
    commit(root, { 'src/a.js': `export const a = ${n};\n`, 'test/a.test.js': `a ${n}\n` }, `change ${n}`);
  }
  return root;
}

/**
 * The opposite habit, deliberately: this repository's accepted history never carries a test.
 * The SAME source-only change is perfectly in keeping here.
 */
function testFree() {
  const root = repository('free');
  commit(root, { 'src/a.js': 'export const a = 0;\n', 'README.md': '#\n' }, 'init');
  for (let n = 1; n <= 8; n += 1) {
    commit(root, { 'src/a.js': `export const a = ${n};\n` }, `change ${n}`);
  }
  return root;
}

const signal = (profile, id) => profile.signals.find((entry) => entry.id === id);

test('two repositories with opposite conventions produce opposite profiles for the same change', async () => {
  const disciplined = await profileChange(testDisciplined(), ['src/a.js']);
  const free = await profileChange(testFree(), ['src/a.js']);

  // The SAME change — one source file, no test — read against two histories.
  const strict = signal(disciplined, 'tests');
  const relaxed = signal(free, 'tests');

  assert.equal(strict.level, 'high',
    'a source-only change in a repository that always ships a test is not reported as divergent');
  assert.equal(relaxed.level, 'none',
    'the same change is reported as divergent in a repository that never ships one — the profile is not reading history at all');
  assert.notEqual(strict.level, relaxed.level, 'the two profiles are not opposite, so nothing here measures convention');

  // And the co-change habit, which is the other axis the two repositories differ on: in the
  // disciplined one `src/a.js` has a habitual partner it left behind.
  assert.equal(signal(disciplined, 'co-change').level, 'high');
  assert.equal(signal(free, 'co-change').level, 'none');

  // Never a score, on either. This is the rule the module refuses to break and the one a
  // connected profile is most likely to break on its behalf.
  for (const profile of [disciplined, free]) {
    assert.equal(profile.signals.length, 4);
    for (const entry of profile.signals) {
      assert.ok(DIVERGENCE_LEVELS.includes(entry.level), `\`${entry.id}\` has level \`${entry.level}\``);
      assert.equal(typeof entry.score, 'undefined', 'a score appeared in the profile');
    }
  }
});

test('the Author is handed the profile BEFORE it writes, and the prompt names the real signals', async () => {
  const profile = await profileChange(testDisciplined(), ['src/a.js']);
  const prompt = buildAuthoringPrompt({
    goal: 'g', step: 's', path: 'src/a.js', contents: 'export const a = 8;\n', profile: profile.signals,
  });

  // FOUND WIRING IT: this read `signal.signal` while the module emits `id`, so every line was
  // `- undefined: <level>` — a prompt that looks populated and says nothing. Neither module was
  // wrong on its own, which is why nothing caught it.
  assert.ok(!prompt.includes('undefined'), 'the prompt carries `undefined` where a signal name belongs');
  for (const id of ['scope', 'co-change', 'tests', 'new-files']) {
    assert.match(prompt, new RegExp(`- ${id}: `), `the prompt does not name the \`${id}\` signal`);
  }
  // The note is what tells a model what to DO. A level alone is a colour.
  assert.match(prompt, /no test changed; \d+% of accepted changes here carry one/);
  // And still never a number that ranks the change as a whole.
  assert.ok(!/divergence score/i.test(prompt));
});

test('plan() computes the profile before authoring and returns it beside the change', async () => {
  const root = testDisciplined();
  const seen = [];
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: root,
    shadowsRoot: freshTempDir('noesar-phase7-shadows-'),
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
    author: new Author({
      generate: async ({ profile }) => { seen.push(profile); return '```\nexport const a = 9;\n```'; },
      model: 'stub',
    }),
  });

  const planned = await orchestrator.plan({
    actor: 'owner', request: 'bump the constant',
    files: [{ path: 'src/a.js', contents: 'export const a = 8;\n' }],
    nowUnix: Math.floor(Date.now() / 1000),
  });

  assert.ok(planned.divergence, '`divergence` is not on the answer, so nothing can show it beside the diff');
  assert.equal(planned.divergence.available, true);
  assert.equal(planned.divergence.signals.length, 4);
  assert.ok(planned.divergence.basis.commitsAnalysed > 0, 'the profile claims no basis, so it read no history');

  // The ORDER is rule 6 of `16` §3.2: the Author writes WITH the conventions, it does not get
  // judged against them afterwards. If the generator never saw them, the profile is a critic.
  assert.equal(seen.length, 1);
  assert.ok(Array.isArray(seen[0]) && seen[0].length === 4,
    'the Author was called without the profile — computed, and then not used for the thing it is for');
  assert.deepEqual(seen[0].map((entry) => entry.id).sort(), ['co-change', 'new-files', 'scope', 'tests']);
});

test('a workspace with no history still plans, and says why it has no profile', async () => {
  // A real installation: a directory that is not a repository. It gets a plan; what it does not
  // get is an invented profile.
  const root = freshTempDir('noesar-phase7-bare-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/a.js'), 'export const a = 0;\n');
  await assert.rejects(() => profileChange(root, ['src/a.js']), DivergenceUnavailable);

  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: root,
    shadowsRoot: freshTempDir('noesar-phase7-shadows2-'),
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
  });
  const planned = await orchestrator.plan({
    actor: 'owner', request: 'bump the constant',
    files: [{ path: 'src/a.js', contents: 'export const a = 0;\n' }],
    nowUnix: Math.floor(Date.now() / 1000),
  });
  assert.equal(planned.status, 'PENDING_APPROVAL', 'a workspace with no git history cannot be planned in');
  assert.equal(planned.divergence.available, false);
  assert.ok(planned.divergence.reason, 'unavailable with no reason is the same silence phase 6 was about');
  assert.deepEqual(planned.divergence.signals, []);
});

test('the terminal can ask for a profile, under the same permission the browser needs', async () => {
  const root = testDisciplined();
  const dispatch = createSessionDispatch({
    workspaceActions: null, buildRepositoryMap: null, literalSearch: null,
    resolveWorkspaceSubpath: null, workspaceRoot: root, engineEvents: new EventLedger(),
    workspaceActionsStatus: () => ({}), getShadowSnapshot: () => ({}),
    capabilityStatus: () => ({}), capabilityMinter: null, contextGraph: null,
    ledger: { append: () => {} }, invariantEnforcement: {},
  });

  // The policy entry exists and is not more generous than the route it twins.
  assert.deepEqual(SESSION_METHOD_POLICY['coden.divergence'],
    { permission: 'coden.plan', bridged: false });

  const answer = await dispatch('coden.divergence', { paths: ['src/a.js'] }, 'owner',
    (permission) => permission === 'coden.plan');
  assert.equal(answer.available, true);
  assert.equal(answer.signals.length, 4);

  // A caller without the permission is refused rather than served a weaker answer.
  await assert.rejects(() => dispatch('coden.divergence', { paths: ['src/a.js'] }, 'nobody', () => false));

  // And the paths are required: a profile of nothing would be four signals about no change.
  await assert.rejects(() => dispatch('coden.divergence', { paths: [] }, 'owner', () => true));
});

test('both shells shape the profile with one function, and neither of them computes a score', async () => {
  const profile = await profileChange(testDisciplined(), ['src/a.js']);
  const available = { available: true, reason: null, signals: profile.signals, basis: profile.basis };

  const lines = divergenceLines(available);
  assert.equal(lines.length, 4, 'a shell shows a number of signals the profile did not produce');
  for (const line of lines) {
    assert.ok(DIVERGENCE_LEVELS.includes(line.level));
    assert.equal(typeof line.note, 'string');
  }
  const summary = divergenceSummary(available);
  assert.match(summary, /tests high/);
  // The rule, asserted directly: no rendering of a profile may contain a total.
  assert.ok(!/score|total|overall \d/i.test(summary), 'the summary invented an aggregate');

  // Unavailable is shown as a reason, never as a clean bill of health.
  const missing = divergenceLines({ available: false, reason: 'not a git repository', signals: [] });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].level, 'unavailable');
  assert.match(missing[0].note, /not a git repository/);
  assert.equal(divergenceSummary({ available: false, reason: 'x', signals: [] }), 'divergence unavailable');
  assert.equal(divergenceSummary(null), '—');
});

// --- three holes a mutation walked through, closed ----------------------------------------

test('the HTTP twin is CSRF-guarded, like every other POST that spends this server on request', () => {
  // Survived a mutation: removing `requireCsrf` from the route changed nothing red. It mutates
  // nothing, but it walks git history over caller-named paths, so a foreign page that can make
  // the browser call it spends this server's time on that page's behalf.
  const source = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("url.pathname === '/api/v1/coden/divergence'");
  assert.ok(start > -1, 'the divergence route is gone');
  const next = source.indexOf('url.pathname ===', start + 20);
  const route = source.slice(start, next > -1 ? next : start + 2000);
  assert.match(route, /requireCsrf\(req, res, authenticated\)/,
    'the divergence route no longer checks CSRF');
});

test('a level the profile could never emit is shown as unknown, never passed through', () => {
  // Survived a mutation, because every test above feeds a REAL profile — and the branch exists
  // precisely for the input a real profile does not produce. `divergence-profile.mjs` refuses
  // to emit a score today; the guard is what keeps a future one from arriving on screen as
  // though it were a level.
  const lines = divergenceLines({
    available: true,
    signals: [
      { id: 'scope', level: 0.82, note: 'a score arrived where a level belongs' },
      { id: 'tests', level: 'catastrophic', note: 'a level nobody declared' },
    ],
  });
  assert.deepEqual(lines.map((line) => line.level), ['unknown', 'unknown']);
  for (const line of lines) assert.equal(line.level, 'unknown');
  // The note survives: the operator still gets to read what was claimed.
  assert.match(lines[0].note, /a score arrived/);
});

test('a change in keeping with the repository says so, and is not confused with having no profile', () => {
  // Survived a mutation that returned 'divergence unavailable' for a perfectly quiet profile.
  // The two are opposite facts: "we looked and this fits" versus "we could not look".
  const quiet = {
    available: true,
    reason: null,
    signals: [
      { id: 'scope', level: 'none', note: 'in range' },
      { id: 'co-change', level: 'none', note: 'no partner left behind' },
      { id: 'tests', level: 'none', note: '1 test file(s) changed' },
      { id: 'new-files', level: 'none', note: 'every file here has been changed before' },
    ],
  };
  assert.equal(divergenceSummary(quiet), 'in keeping with this repository');
  assert.notEqual(divergenceSummary(quiet), divergenceSummary({ available: false, reason: 'x', signals: [] }));
  // And it still renders four lines: "nothing is raised" is not "nothing to show".
  assert.equal(divergenceLines(quiet).length, 4);
});
