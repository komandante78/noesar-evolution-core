// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A plan may declare the commands it will run, and `measure()` runs them — in the SHADOW,
// through the sandbox that has been shipped since `D-0249`/`D-0250` and mirrored in Rust by
// `D-0253`, under the isolation envelope the approved plan itself named.
//
// WHY THIS FILE EXISTS AT ALL. Nothing here builds a sandbox: the mechanism was already
// there, already token-gated, already measured. What was missing was the wiring between it
// and CodeN Evolution, and the shape of that gap is the one this project keeps paying for —
// not something broken, something UNREACHABLE. `execute()` was called with `tests: []` on the
// only path that calls it, so `compare()` reported every declared test as `testsNeverRun` and
// no plan that declared one could ever come back clean. A mechanism that presents as built
// and cannot be reached is the defect `08_MILESTONES_AND_DELIVERABLES.md` M3 names by name.
//
// THE ORACLE. Each of these was run against the tree BEFORE the wiring and watched to fail —
// `planned.plan.steps[0].commands` was `[]`, the expectation required `.` to be touched, and
// the end-to-end run came back `testsNeverRun`. A test nobody has seen fail is a hope.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator, WorkspaceActionError, workspaceActionsStatus } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

// The same binary `executor.test.mjs` and `sandbox-runner.test.mjs` use, located the same way:
// a real process is only meaningful where the binary was built, and the absence is declared
// rather than papered over with a stub that would prove the stub.
const SANDBOX_BINARY = join(import.meta.dirname, '../../../rust/target/release/noesar-sandbox');
const HAVE_SANDBOX_BINARY = existsSync(SANDBOX_BINARY);
const ENABLED = { enabled: true, requested: true, binaryPath: SANDBOX_BINARY };

const NOW = Math.floor(Date.now() / 1000);

function fixture({ executeSandbox = null } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-cmd-ws-'));
  // ShadowWorkspace refuses "a shadow of nothing", so a workspace is never literally empty.
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-cmd-shadows-'));
  const events = new EventLedger();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32), { ceiling: null }), events,
    executeSandbox,
    // `env: {}`, not the ambient one: an operator shell that had selected an external
    // reasoning provider must not change what this fixture measures.
    env: {},
  });
  return { ws, shadows, orch, events };
}
const cleanup = ({ ws, shadows }) => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(shadows, { recursive: true, force: true });
};

const refusal = async (promise) => {
  try { await promise; return null; } catch (error) {
    if (error instanceof WorkspaceActionError) return error;
    throw error;
  }
};

// --- the two refusals that come before anything runs -------------------------------------

test('an installation that does not run commands says so at plan(), not at measurement', async () => {
  // The point is WHERE the refusal happens. Left to `measure()`, the only symptom would be an
  // EXECUTE outcome carrying EXECUTE_DISABLED_BY_OPERATOR buried in a run that failed for no
  // reason the operator asked about — sending them to look for a defect in their plan when
  // the answer is a switch on their host.
  const fx = fixture(); // no executeSandbox at all: the default every installation has
  try {
    const error = await refusal(fx.orch.plan({
      request: 'run the suite', files: [{ path: 'a.txt', contents: 'x\n' }],
      commands: ['/bin/echo test-ok'], policy: 'permissive', actor: 'owner', nowUnix: NOW,
    }));
    assert.ok(error, 'a declared command on an installation with no sandbox must be refused');
    assert.equal(error.kind, 'EXECUTION_DISABLED');
  } finally { cleanup(fx); }
});

test('a declared command carrying shell metacharacters is refused, sandbox or no sandbox', async () => {
  // There is no shell: argv is the declared string split on whitespace. A command that needs
  // quoting is therefore REFUSED rather than guessed at — guessing where one argument ends is
  // how the command that runs stops being the command the approver read. Checked before the
  // installation's own switch, so it holds identically on a host that runs nothing.
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    for (const command of ['/bin/sh -c "rm -rf /"', '/bin/echo test && rm -rf /', '/bin/echo test; id', '/bin/echo $HOME test']) {
      const error = await refusal(fx.orch.plan({
        request: 'run', files: [{ path: 'a.txt', contents: 'x\n' }],
        commands: [command], policy: 'permissive', actor: 'owner', nowUnix: NOW,
      }));
      assert.ok(error, `\`${command}\` must not be plannable`);
      assert.equal(error.kind, 'INVALID_COMMAND', `for \`${command}\``);
    }
  } finally { cleanup(fx); }
});

test('a command is not something a plan drifts into: the default policy constrains the step away', async () => {
  // An EXECUTE grant needs a step declared destructive (capability.mjs), and `constrain()`
  // removes a destructive step under the default `restrictive` policy. So running a command
  // is an explicit `policy: 'permissive'` — a property inherited from the existing design
  // rather than a new gate, and pinned here because it is the one that keeps EXECUTE from
  // arriving by accident in a plan somebody skim-read.
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    const error = await refusal(fx.orch.plan({
      request: 'run the suite', files: [{ path: 'a.txt', contents: 'x\n' }],
      commands: ['/bin/echo test-ok'], actor: 'owner', nowUnix: NOW, // policy defaults to restrictive
    }));
    assert.ok(error, 'a destructive step must not survive the restrictive policy');
    assert.equal(error.kind, 'CONSTRAINED_AWAY');
  } finally { cleanup(fx); }
});

// --- what the plan the Owner approves actually says ---------------------------------------

test('the plan declares the command, its working directory and the envelope it may use', async () => {
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    const planned = await fx.orch.plan({
      request: 'run the suite', files: [{ path: 'a.txt', contents: 'x\n' }],
      commands: ['/bin/echo test-ok'], policy: 'permissive', actor: 'owner', nowUnix: NOW,
    });
    const step = planned.plan.steps[0];
    assert.deepEqual(step.commands, ['/bin/echo test-ok']);
    // `.` is the working directory, and capability.mjs refuses to mint a grant for a path the
    // step does not declare — so the step has to name it.
    assert.ok(step.files.includes('.'), 'the execution directory must be declared by the step');
    assert.ok(step.files.includes('a.txt'), 'the files the plan writes are still declared');
    assert.equal(step.blastRadius.destructive, true);
    // The envelope is in the PLAN, where the person approving it can read it — not chosen
    // later somewhere nobody looks. capability.mjs treats it as the ceiling the token may not
    // widen, so what is approved is what can run.
    assert.ok(step.blastRadius.limits, 'the step must carry the isolation envelope it grants');
    assert.equal(typeof step.blastRadius.limits.memoryBytes, 'number');
    assert.equal(typeof step.blastRadius.limits.cpuSeconds, 'number');
  } finally { cleanup(fx); }
});

test('the expectation does not require a directory to be touched', async () => {
  // The regression this closes: `expect()` put every one of a step's files into
  // `pathsTheDiffMustTouch`, and an observation keys its changes by FILE path — so `.` was a
  // requirement nothing could ever satisfy. Not an EXECUTE special case: an expectation
  // unsatisfiable by construction is a criterion that measures nothing.
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    const planned = await fx.orch.plan({
      request: 'run the suite', files: [{ path: 'a.txt', contents: 'x\n' }],
      commands: ['/bin/echo test-ok'], policy: 'permissive', actor: 'owner', nowUnix: NOW,
    });
    assert.ok(!planned.expectation.pathsTheDiffMustTouch.includes('.'),
      'a directory in pathsTheDiffMustTouch can never be satisfied');
    assert.deepEqual(planned.expectation.pathsTheDiffMustTouch, ['a.txt']);
    // And the command IS the name the outcome will be matched against, so a plan and its
    // verdict cannot disagree about which command they are talking about.
    assert.deepEqual(planned.expectation.testsExpectedToPass, ['/bin/echo test-ok']);
  } finally { cleanup(fx); }
});

test('a plan that declares no command is byte-identical to before this wiring', async () => {
  // The property that makes this change safe to ship: every existing run is untouched. No
  // `.` in the step, no EXECUTE in the grant, nothing destructive, and the same LOW risk.
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    const planned = await fx.orch.plan({
      request: 'just write a file', files: [{ path: 'a.txt', contents: 'x\n' }],
      actor: 'owner', nowUnix: NOW,
    });
    const step = planned.plan.steps[0];
    assert.deepEqual(step.files, ['a.txt']);
    assert.deepEqual(step.commands, []);
    assert.equal(step.blastRadius.destructive, false);
    assert.equal(step.blastRadius.limits, undefined);
    assert.equal(planned.risk.overall, 'LOW');
    fx.orch.measure({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
    const minted = fx.events.correlation(planned.runId)
      .filter((event) => event.action === 'capability.minted')
      .map((event) => JSON.parse(event.payload));
    assert.deepEqual(minted[0].operations, ['WRITE'], 'no command, no EXECUTE grant');
  } finally { cleanup(fx); }
});

// --- the grant, and the half of it that must never widen ----------------------------------

test('EXECUTE is granted for the measurement only — the token that promotes never carries it', async () => {
  // The property that makes running a command before the approval safe at all: it runs
  // against the SHADOW. `measure()` mints with EXECUTE; `#promote()` mints the token that
  // writes the real workspace and it is WRITE and nothing else. Asserted on the source as
  // well as on the ledger, because the ledger can only show what a run reached — and a run
  // whose command was refused never reaches the second mint at all.
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    const planned = await fx.orch.plan({
      request: 'run the suite', files: [{ path: 'a.txt', contents: 'x\n' }],
      commands: ['/bin/echo test-ok'], policy: 'permissive', actor: 'owner', nowUnix: NOW,
    });
    fx.orch.measure({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
    const measurement = fx.events.correlation(planned.runId)
      .filter((event) => event.action === 'capability.minted')
      .map((event) => JSON.parse(event.payload))
      .find((payload) => payload.purpose === 'MEASUREMENT');
    assert.ok(measurement, 'the measurement must mint a token');
    assert.deepEqual(measurement.operations, ['WRITE', 'EXECUTE']);
    assert.ok(measurement.paths.includes('.'), 'the grant must name the working directory');

    const source = readFileSync(new URL('../src/workspace-actions.mjs', import.meta.url), 'utf8');
    const mints = source.match(/operations: \['WRITE'\]/g) ?? [];
    assert.equal(mints.length, 1,
      'exactly one mint in this file is WRITE-only, and it is the one that promotes into the real workspace');
  } finally { cleanup(fx); }
});

// --- the whole chain, against the real binary ---------------------------------------------

test('a declared test runs for real, and its outcome is what the expectation is answered with', {
  skip: !HAVE_SANDBOX_BINARY,
}, async () => {
  // The end-to-end proof. Before the wiring this failed on `testsNeverRun`: `execute()` was
  // called with `tests: []`, so the expectation could never be met and nothing was ever
  // promoted. `/bin/echo test-ok` is chosen for two reasons at once — it exits 0, and its
  // declared string contains "test", which is what `expect()` reads to decide a command is a
  // test whose outcome the run must be answered with.
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    const planned = await fx.orch.plan({
      request: 'write the change and run the suite',
      files: [{ path: 'a.txt', contents: 'written by the plan\n' }],
      commands: ['/bin/echo test-ok'], policy: 'permissive', actor: 'owner', nowUnix: NOW,
    });
    const measured = fx.orch.measure({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });

    const ran = measured.result.outcomes.find((outcome) => outcome.operation === 'EXECUTE');
    assert.ok(ran, 'the run must carry an EXECUTE outcome');
    assert.equal(ran.performed, true, JSON.stringify(ran));
    assert.equal(ran.exitCode, 0);
    assert.match(ran.stdout, /test-ok/);
    assert.equal(ran.name, '/bin/echo test-ok', 'the outcome carries the name the plan declared');

    // The half that was missing: the outcome reaches the comparison.
    assert.deepEqual(measured.result.observation.tests, [{ name: '/bin/echo test-ok', passed: true }]);
    assert.deepEqual(measured.result.surprise.testsNeverRun, []);
    assert.deepEqual(measured.result.surprise.testsExpectedToPassThatFailed, []);
    assert.equal(measured.result.surprise.clean, true, JSON.stringify(measured.result.surprise));
    assert.equal(measured.result.ok, true);

    // And only then does anything reach the real workspace.
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
    assert.equal(approved.promoted, true);
    assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'written by the plan\n');
  } finally { cleanup(fx); }
});

test('a declared test that FAILS stops the promotion', {
  skip: !HAVE_SANDBOX_BINARY,
}, async () => {
  // The one that matters more than the happy path: a run whose test failed must not reach the
  // workspace. `/bin/false` exits 1, and its declared string carries "test" so the expectation
  // requires it to pass.
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    const planned = await fx.orch.plan({
      request: 'write the change and run the suite',
      files: [{ path: 'a.txt', contents: 'must not be promoted\n' }],
      commands: ['/bin/false test'], policy: 'permissive', actor: 'owner', nowUnix: NOW,
    });
    const measured = fx.orch.measure({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
    const ran = measured.result.outcomes.find((outcome) => outcome.operation === 'EXECUTE');
    // It RAN and lost on its own merits — not refused, which would be a different fact.
    assert.equal(ran.performed, true, JSON.stringify(ran));
    assert.notEqual(ran.exitCode, 0);
    assert.deepEqual(measured.result.observation.tests, [{ name: '/bin/false test', passed: false }]);
    assert.deepEqual(measured.result.surprise.testsExpectedToPassThatFailed, ['/bin/false test']);
    assert.equal(measured.result.surprise.clean, false);
    assert.equal(measured.result.ok, false);
    assert.equal(existsSync(join(fx.ws, 'a.txt')), false, 'nothing may reach the workspace');
  } finally { cleanup(fx); }
});

test('the command runs against the shadow, never against the workspace', {
  skip: !HAVE_SANDBOX_BINARY,
}, async () => {
  // Stated as a measurement rather than as a comment: the command's working directory is the
  // shadow's root, so a command that writes lands in the shadow and the real workspace does
  // not see it until — and unless — the comparison came back clean and the Owner approved.
  const fx = fixture({ executeSandbox: ENABLED });
  try {
    const planned = await fx.orch.plan({
      request: 'write the change and run the suite',
      files: [{ path: 'a.txt', contents: 'x\n' }],
      commands: ['/bin/pwd test'], policy: 'permissive', actor: 'owner', nowUnix: NOW,
    });
    const measured = fx.orch.measure({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
    const ran = measured.result.outcomes.find((outcome) => outcome.operation === 'EXECUTE');
    assert.equal(ran.performed, true, JSON.stringify(ran));
    const cwd = ran.stdout.trim();
    assert.ok(cwd.startsWith(fx.shadows), `the command ran in \`${cwd}\`, which is not under the shadows root`);
    assert.ok(!cwd.startsWith(fx.ws), 'the command must never run in the real workspace');
  } finally { cleanup(fx); }
});

// --- what the product says about itself ---------------------------------------------------

test('the status reports this installation\'s own answer, and never two answers at once', async () => {
  // `08_MILESTONES_AND_DELIVERABLES.md` M3: no unwired mechanism left presenting as built —
  // and its mirror image, no wired mechanism left presenting as refused. The status used to
  // say EXECUTE was refused permanently, which stopped being true when `D-0250` shipped.
  const off = workspaceActionsStatus();
  assert.equal(off.testExecution, false);
  assert.ok(off.operationsNotSupported.includes('EXECUTE'));
  assert.match(off.testExecutionReason, /switched off on this installation/);

  const on = workspaceActionsStatus(ENABLED);
  assert.equal(on.testExecution, true);
  assert.ok(on.operationsSupported.includes('EXECUTE'));
  assert.ok(!on.operationsNotSupported.includes('EXECUTE'));
  assert.match(on.testExecutionReason, /SHADOW/);

  // Neither wording may claim the old permanent refusal, in either direction.
  for (const status of [off, on]) {
    assert.ok(!/refuses EXECUTE permanently/.test(status.testExecutionReason),
      'the status must not repeat a claim the executor stopped making in D-0250');
  }
});
