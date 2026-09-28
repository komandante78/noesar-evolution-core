// SPDX-License-Identifier: AGPL-3.0-or-later
//
// THE PROOF OF THE BUG, run in the shadow (`NOESAR_REPRODUCE=on`).
//
// WHY THIS FILE EXISTS. The cycle could run a declared command and repair on its failure, and on
// a bug report nobody declares one — so «clean» meant «the declared effects happened», never «the
// bug is gone». Measured on SWE-bench Verified on 27/09/2026: 3 of 14 runs correct, and the loop
// could not tell which. These are the criteria of the join: the Author writes a script from the
// report, it must FAIL on the unchanged code to be used, it then has to PASS after the change, and
// it never leaves the shadow.
//
// A real sandbox and a real `python3`, located the way `coden-declared-commands.test.mjs` locates
// the binary: a stub would prove the stub. Absent, the tests that need them are skipped and say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  WorkspaceActionOrchestrator, repairBrief, REPRODUCTION_PATH, REPRODUCTION_COMMAND,
} from '../src/workspace-actions.mjs';
import { Author } from '../src/author.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const SANDBOX_BINARY = join(import.meta.dirname, '../../../rust/target/release/noesar-sandbox');
const ENABLED = { enabled: true, requested: true, binaryPath: SANDBOX_BINARY };
const HAVE_PYTHON = spawnSync('python3', ['-c', 'pass']).status === 0;
const RUNS = existsSync(SANDBOX_BINARY) && HAVE_PYTHON;
const SKIP = RUNS ? false : `needs ${existsSync(SANDBOX_BINARY) ? '' : 'the sandbox binary '}${HAVE_PYTHON ? '' : 'python3'}`.trim();

const NOW = Math.floor(Date.now() / 1000);
const BUGGY = 'BUG = True\n';
const FIXED = 'BUG = False\n';
// Imports `a` from the shadow root: the trap measured inside a SWE-bench image is exactly this
// import resolving somewhere other than the changed copy.
const SHOWS_THE_BUG = 'import sys\nimport a\nsys.exit(3 if a.BUG else 0)\n';

const edited = (contents, body) => [
  '<<<<<<< SEARCH', String(contents).replace(/\n$/, ''), '=======', String(body).replace(/\n$/, ''), '>>>>>>> REPLACE',
].join('\n');

/** `fixes` is consumed one per authoring of `a.py`; the last one repeats. */
function fixture({ env = { NOESAR_REPRODUCE: 'on' }, script = SHOWS_THE_BUG, fixes = [FIXED], executeSandbox = ENABLED } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-repro-ws-'));
  writeFileSync(join(ws, 'a.py'), BUGGY);
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-repro-shadows-'));
  const prompts = [];
  let fixCalls = 0;
  const author = new Author({
    model: 'test-model',
    generate: async ({ prompt, contents }) => {
      prompts.push(prompt);
      // A file with no contents is the reproduction: the only new file this fixture ever asks for.
      if (!String(contents ?? '').trim()) return `\`\`\`python\n${script}\`\`\``;
      const body = fixes[Math.min(fixCalls, fixes.length - 1)];
      fixCalls += 1;
      return edited(contents, body);
    },
  });
  const events = new EventLedger();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32), { ceiling: null }), events, author, executeSandbox, env,
  });
  const plan = (policy = 'permissive') => orch.plan({
    request: 'BUG is True and it should not be', files: [{ path: 'a.py', contents: BUGGY }],
    policy, actor: 'owner', nowUnix: NOW,
  });
  return { ws, shadows, orch, events, prompts, plan };
}
const cleanup = ({ ws, shadows }) => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(shadows, { recursive: true, force: true });
};

test('off by default: a plan is exactly what it was, with no reproduction and no command', async () => {
  const fx = fixture({ env: {} });
  try {
    const planned = await fx.plan();
    assert.equal(planned.reproduction, null);
    assert.deepEqual(planned.plan.steps[0].commands, []);
    assert.ok(!planned.plan.steps[0].files.includes(REPRODUCTION_PATH));
  } finally { cleanup(fx); }
});

test('asked for under the restrictive policy, it is declined with the reason — the plan survives', async () => {
  // The switch does not widen what a caller's policy allows: a step that runs a command is
  // destructive and `restrictive` constrains it away, so no command is added at all.
  const fx = fixture();
  try {
    const planned = await fx.plan('restrictive');
    assert.equal(planned.reproduction.contents, null);
    assert.match(planned.reproduction.reason, /permissive/);
    assert.deepEqual(planned.plan.steps[0].commands, []);
  } finally { cleanup(fx); }
});

test('the reproduction is declared in the plan the Owner approves, at a path the product chose', { skip: SKIP }, async () => {
  const fx = fixture();
  try {
    const planned = await fx.plan();
    const step = planned.plan.steps[0];
    assert.ok(step.commands.includes(REPRODUCTION_COMMAND));
    assert.ok(step.files.includes(REPRODUCTION_PATH));
    assert.equal(planned.reproduction.contents, SHOWS_THE_BUG);
    assert.equal(planned.reproduction.reproduces, null, 'nothing has run at plan() time');
  } finally { cleanup(fx); }
});

test('a reproduction that fails before and passes after: clean, and it never leaves the shadow', { skip: SKIP }, async () => {
  const fx = fixture();
  try {
    const { runId } = await fx.plan();
    const iterated = await fx.orch.iterate({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(iterated.stopped, 'clean');
    const ran = iterated.result.outcomes.find((o) => o.name === REPRODUCTION_COMMAND);
    assert.equal(ran?.exitCode, 0, 'the reproduction ran after the change and passed');
    assert.ok(!iterated.diff.some((entry) => entry.path === REPRODUCTION_PATH), 'not in the diff');
    const approved = fx.orch.approve({ runId, approverId: 'owner', nowUnix: NOW });
    assert.equal(approved.promoted, true);
    assert.equal(readFileSync(join(fx.ws, 'a.py'), 'utf8'), FIXED);
    assert.equal(existsSync(join(fx.ws, REPRODUCTION_PATH)), false, 'never promoted');
    assert.equal(iterated.reproduction.reproduces, true);
    assert.equal(iterated.reproduction.exitCode, 3, 'it failed on the unchanged code first');
  } finally { cleanup(fx); }
});

test('a fix the reproduction refuses is dirty, and the repair is told what it printed', { skip: SKIP }, async () => {
  // THE criterion: before this, `BUG = True  # fixed` measured clean — the effects were the
  // declared ones. Now the script says the bug is still there, and the next prompt carries it.
  const fx = fixture({ fixes: ['BUG = True  # fixed\n', FIXED] });
  try {
    const { runId } = await fx.plan();
    const first = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(first.clean, false);
    const brief = repairBrief(first.result).join('\n');
    assert.match(brief, new RegExp(`${REPRODUCTION_COMMAND.replace(/[.]/g, '\\.')}\` exited 3`));
    await fx.orch.repair({ runId, actor: 'owner', nowUnix: NOW });
    assert.match(fx.prompts.at(-1), /sys\.exit\(3 if a\.BUG else 0\)/, 'the repair sees the script');
    assert.equal(fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW }).clean, true);
  } finally { cleanup(fx); }
});

test('a reproduction that passes on the unchanged code proves nothing, and is not used', { skip: SKIP }, async () => {
  const fx = fixture({ script: 'import sys\nsys.exit(0)\n' });
  try {
    const { runId } = await fx.plan();
    const measured = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.ok(!measured.result.outcomes.some((o) => o.operation === 'EXECUTE'), 'not run as a test');
    assert.equal(measured.clean, true, 'the run is measured exactly as without it');
    assert.equal(measured.reproduction.reproduces, false);
    assert.match(measured.reproduction.reason, /does not show the bug/);
  } finally { cleanup(fx); }
});

test('a script that crashes is broken, not a reproduction: exit 1 is not exit 3', { skip: SKIP }, async () => {
  // Taking any non-zero exit as «the bug is there» would turn a broken script into a failing
  // test on every attempt, and cost the runs that were right.
  const fx = fixture({ script: 'raise SystemError("broken script")\n' });
  try {
    const { runId } = await fx.plan();
    const measured = fx.orch.measure({ runId, actor: 'owner', nowUnix: NOW });
    assert.equal(measured.clean, true);
    assert.ok(!measured.result.outcomes.some((o) => o.operation === 'EXECUTE'));
    assert.equal(measured.reproduction.exitCode, 1);
    assert.match(measured.reproduction.reason, /script is broken/);
  } finally { cleanup(fx); }
});
