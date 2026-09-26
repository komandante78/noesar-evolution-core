// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The measure -> repair loop, on the plans it actually gets.
//
// Measured 2026-09-26 on SWE-bench Verified (temperature 0, fourteen instances): 13 of 14 search-derived
// plans ended `exhausted`, and the patches changed files nobody asked about. Three defects, one loop:
//
//   A. `expect()` declares EVERY file of the step as one the diff must touch. For five candidates the
//      search found, that is false: the fix is usually in one. The repair brief then told the model
//      «`X` was declared as changed and no change reached it» for each candidate it had rightly left
//      alone, and `approve()` refused to promote the run at all.
//   B. A repair REPLACED the written set with only what it changed in that pass, so a file fixed by the
//      previous attempt and left alone went back to the original at the next measurement.
//   C. The repair never saw the request as written, only its first sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { Author } from '../src/author.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const NOW = Math.floor(Date.now() / 1000);
const A = 'alpha\n';
const B = 'beta\n';
const edited = (contents, body) => ['<<<<<<< SEARCH', String(contents).replace(/\n$/, ''), '=======', String(body).replace(/\n$/, ''), '>>>>>>> REPLACE'].join('\n');
const REQUEST = 'fix alpha\n\nThe marker the fix needs is ZQX-42.';

/** `script[path]` is the list of bodies that file gets, one per call to it; `null` means «leave it as shown». */
function fixture({ script, derived }) {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-derived-ws-'));
  writeFileSync(join(ws, 'a.txt'), A);
  writeFileSync(join(ws, 'b.txt'), B);
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-derived-shadows-'));
  const calls = {};
  const prompts = [];
  const author = new Author({
    model: 'test-model',
    generate: async ({ prompt, path, contents }) => {
      const n = calls[path] ?? 0;
      calls[path] = n + 1;
      prompts.push({ path, call: n, prompt });
      const body = script[path][Math.min(n, script[path].length - 1)];
      return edited(contents, body ?? contents);
    },
  });
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32), { ceiling: null }),
    events: new EventLedger(), author, env: {},
    groundRequest: () => ({
      files: [{ path: 'a.txt', contents: A }, { path: 'b.txt', contents: B }],
      grounding: { derived: true, terms: ['alpha'], selected: ['a.txt', 'b.txt'] },
      context: [],
    }),
  });
  const plan = () => orch.plan({
    request: REQUEST,
    files: derived ? [] : [{ path: 'a.txt', contents: A }, { path: 'b.txt', contents: B }],
    actor: 'owner', nowUnix: NOW, conversationId: 'c-1',
  });
  const cleanup = () => { rmSync(ws, { recursive: true, force: true }); rmSync(shadows, { recursive: true, force: true }); };
  return { ws, orch, plan, prompts, cleanup, read: (p) => readFileSync(join(ws, p), 'utf8') };
}

test('A: a search-derived plan that rightly edits one candidate measures clean and is promoted', async () => {
  const fx = fixture({ derived: true, script: { 'a.txt': ['alpha fixed\n'], 'b.txt': [null] } });
  try {
    const { runId } = await fx.plan();
    const measured = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(measured.clean, true, JSON.stringify(measured.result.surprise));
    const approved = fx.orch.approve({ runId, approverId: 'owner', nowUnix: NOW });
    assert.equal(approved.promoted, true);
    assert.equal(fx.read('a.txt'), 'alpha fixed\n');
    assert.equal(fx.read('b.txt'), B, 'the candidate nobody changed is untouched');
  } finally { fx.cleanup(); }
});

test('A: a derived plan that changed nothing is still not clean', async () => {
  const fx = fixture({ derived: true, script: { 'a.txt': [null], 'b.txt': [null] } });
  try {
    const { runId } = await fx.plan();
    const measured = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(measured.clean, false);
    assert.ok(measured.result.comparisonRefused, 'an observation of nothing is refused, as before');
  } finally { fx.cleanup(); }
});

test('A: a plan a person named still needs every named file to change', async () => {
  const fx = fixture({ derived: false, script: { 'a.txt': ['alpha fixed\n'], 'b.txt': [null] } });
  try {
    const { runId } = await fx.plan();
    const measured = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(measured.clean, false);
    assert.deepEqual(measured.result.surprise.expectedAndAbsent, ['b.txt']);
  } finally { fx.cleanup(); }
});

test('B: a repair keeps what the previous attempt wrote in a file it leaves alone', async () => {
  // Named plan, so both files must change: the first pass fixes a.txt only, the repair fixes b.txt and
  // leaves a.txt as it was shown — which is the version the first pass wrote.
  const fx = fixture({ derived: false, script: { 'a.txt': ['alpha fixed\n', null], 'b.txt': [null, 'beta fixed\n'] } });
  try {
    const { runId } = await fx.plan();
    assert.equal(fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW }).clean, false);
    await fx.orch.repair({ runId, actor: 'owner', nowUnix: NOW });
    const measured = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(measured.clean, true, JSON.stringify(measured.result.surprise));
    fx.orch.approve({ runId, approverId: 'owner', nowUnix: NOW });
    assert.equal(fx.read('a.txt'), 'alpha fixed\n', 'the first fix survived the repair');
    assert.equal(fx.read('b.txt'), 'beta fixed\n');
  } finally { fx.cleanup(); }
});

test('C: the repair prompt carries the request as written, not only its first sentence', async () => {
  const fx = fixture({ derived: false, script: { 'a.txt': ['alpha fixed\n', null], 'b.txt': [null, 'beta fixed\n'] } });
  try {
    const { runId } = await fx.plan();
    fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    await fx.orch.repair({ runId, actor: 'owner', nowUnix: NOW });
    const repairPrompts = fx.prompts.filter((p) => p.call === 1);
    assert.ok(repairPrompts.length > 0, 'the repair called the model');
    for (const { prompt } of repairPrompts) assert.ok(prompt.includes('ZQX-42'), 'the detail below the first sentence reached the repair');
  } finally { fx.cleanup(); }
});
