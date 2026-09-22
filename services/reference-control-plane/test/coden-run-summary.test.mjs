// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a shell shows for a run, and while it waits for one. Measured live on 2026-09-22 in the
// browser terminal: `/plan` sat 20-40 s on a still screen, then answered with ten lines of JSON
// and "… 361 more lines", and nothing said the next thing to type was `/measure <run>`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callResult, runSummary, working, createView, WORKING_NOTE } from '../../../apps/webui-static/coden-view-model.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ID = 'b8d44f83-98ad-4183-98f1-434ed3b289bb';

test('a plan ends with where it stands, which files — new ones marked — and what to type next', () => {
  const shown = callResult('plan', {
    runId: ID, status: 'PENDING_APPROVAL', risk: { overall: 'LOW' }, confidence: { value: 0.3 },
    plan: { steps: [{ files: ['programmi/somma.mjs', 'README.md', '.'] }] },
    grounding: { created: ['programmi/somma.mjs'] },
    authoring: { available: true, reason: null, authored: 1 },
  });
  assert.equal(shown.headline, 'plan — 1 file written');
  assert.ok(shown.lines[0].startsWith('authoring: '), 'the authoring line stays first, as D-0579 requires');
  assert.deepEqual(shown.lines.slice(-3), [
    `run ${ID} — PENDING_APPROVAL, risk LOW, confidence 0.3`,
    'files: programmi/somma.mjs (new) · README.md',
    `next: /measure ${ID}   runs it in a throw-away copy; nothing real is touched`,
  ]);
  assert.ok(shown.lines.some((line) => line.trim().startsWith('"runId"')), 'the dump is still there');
  assert.ok(shown.lines.findIndex((line) => line.trim().startsWith('"runId"')) < shown.lines.length - 3,
    'and it comes BEFORE the summary: a terminal shows the end of an answer');
});

test('a measurement names each file\'s change and sends a clean run to approval, an unclean one to repair', () => {
  const measured = (clean) => runSummary({ runId: ID, status: 'MEASURED', clean,
    diff: [{ path: 'programmi/media.mjs', status: 'MODIFIED' }] });
  assert.deepEqual(measured(true).slice(1, 4), [
    `run ${ID} — MEASURED, clean`, 'files: programmi/media.mjs (modified)',
    `next: /diff ${ID} to read it, then /approve ${ID}  or  /reject ${ID}`,
  ]);
  assert.match(measured(false)[3], /^next: \/repair .+ the measured run is not clean$/);
  assert.match(runSummary({ runId: ID, status: 'PROMOTED' })[2], /\/restore .+ undoes it$/);
});

test('an answer that is not a run gets no summary — nothing is invented', () => {
  assert.deepEqual(runSummary({ available: true, branch: 'main' }), []);
  assert.deepEqual(runSummary(null), []);
  assert.deepEqual(runSummary({ runId: ID, status: 'REJECTED' }), ['', `run ${ID} — REJECTED`]);
});

test('the working line is shown while waiting and taken back when the answer arrives', () => {
  const view = createView();
  const before = view.transcript.length;
  const done = working(view);
  assert.equal(view.transcript.at(-1).text, WORKING_NOTE);
  view.transcript.push({ kind: 'note', text: 'another viewport ran plan' });
  done();
  assert.equal(view.transcript.length, before + 1, 'only the working line leaves, not what arrived meanwhile');
  assert.ok(!view.transcript.some((entry) => entry.text === WORKING_NOTE));
  done();
  assert.equal(view.transcript.length, before + 1, 'taking it back twice removes nothing else');
});

test('all three shells show the working line and take it back on both outcomes', () => {
  for (const shell of ['apps/webui-static/app.js', 'apps/webui-static/coden-terminal.js', 'tools/tui-fullscreen.mjs']) {
    const source = readFileSync(join(REPO_ROOT, shell), 'utf8');
    assert.match(source, /const done ?= ?working\(/, `${shell} does not show that it is waiting`);
    assert.ok((source.match(/done\(\);/g) ?? []).length >= 2, `${shell} must take the line back on success AND on error`);
  }
});

test('approve() answers with the status it saved, so the shells can offer /restore', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { randomBytes } = await import('node:crypto');
  const { WorkspaceActionOrchestrator } = await import('../src/workspace-actions.mjs');
  const { TokenMinter } = await import('../src/capability.mjs');
  const { EventLedger } = await import('../src/events.mjs');
  const ws = mkdtempSync(join(tmpdir(), 'noesar-approve-status-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-approve-status-sh-'));
  try {
    writeFileSync(join(ws, 'a.txt'), 'one\n');
    const orch = new WorkspaceActionOrchestrator({ workspaceRoot: ws, shadowsRoot: shadows,
      minter: new TokenMinter(randomBytes(32)), events: new EventLedger() });
    const now = () => Math.floor(Date.now() / 1000);
    const planned = await orch.plan({ request: 'two', files: [{ path: 'a.txt', contents: 'two\n' }], actor: 't', nowUnix: now() });
    await orch.measure({ runId: planned.runId, actor: 't', nowUnix: now() });
    const approved = orch.approve({ runId: planned.runId, approverId: 't', nowUnix: now() });
    assert.equal(approved.status, 'PROMOTED');
    assert.match(runSummary(approved).at(-1), /\/restore .+ undoes it$/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(shadows, { recursive: true, force: true });
  }
});
