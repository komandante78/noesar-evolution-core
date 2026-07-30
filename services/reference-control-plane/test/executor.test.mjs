// SPDX-License-Identifier: AGPL-3.0-or-later
// The closed circle, end to end in one process: approved plan -> tokens -> shadow ->
// executor -> observation -> comparison. The Rust crate holds the same properties natively.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenMinter, authorizePlan } from '../src/capability.mjs';
import { ShadowWorkspace, compare } from '../src/shadow.mjs';
import { execute, executorStatus, NO_EXECUTION_SURFACE } from '../src/executor.mjs';

const NOW = 1800000000;
const SECRET = Buffer.alloc(32, 7);

function bench(files, destructive = false) {
  const source = mkdtempSync(join(tmpdir(), 'noesar-exec-src-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-exec-dst-'));
  for (const file of files) writeFileSync(join(source, file), 'before');
  const plan = {
    mode:'safe', constraints:[],
    steps:[{ id:'a', description:'s', files:[...files], commands:[], dependsOn:[],
      blastRadius:{ paths:[...files], reachesOutsideWorkspace:false, destructive } }],
  };
  const authorized = authorizePlan(plan, {
    approverId:'owner-001', grantedAtUnix:NOW, expiresAtUnix:NOW + 3600, scopeNote:'test',
  }, NOW);
  return {
    source, shadowRoot, authorized,
    minter: new TokenMinter(SECRET),
    // The whole workspace, not the declared paths: a shadow built from exactly what the plan
    // named could never report an undeclared write, and the executor refuses one.
    shadow: ShadowWorkspace.ofWorkspace(source, shadowRoot),
    cleanup() {
      rmSync(source, { recursive:true, force:true });
      rmSync(shadowRoot, { recursive:true, force:true });
    },
  };
}

const ask = (paths, operations, uses = 1) => ({
  stepId:'a', paths, operations, reason:'test', uses, expiresAtUnix:NOW + 600,
});
const expectation = (paths) => ({
  pathsTheDiffMustTouch:paths, testsExpectedToPass:[], testsExpectedToFail:[],
});

test('an action with a token lands in the shadow and never in the source', () => {
  const b = bench(['a.txt']);
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[{ kind:'WRITE', path:'a.txt', contents:'after' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 1, JSON.stringify(report.outcomes));
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(readFileSync(join(b.shadow.root, 'a.txt'), 'utf8'), 'after');
    // The source is untouched: that is what the shadow is for.
    assert.equal(readFileSync(join(b.source, 'a.txt'), 'utf8'), 'before');
  } finally { b.cleanup(); }
});

test('an action with no token is refused and changes nothing', () => {
  const b = bench(['a.txt']);
  try {
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[], shadow:b.shadow,
      actions:[{ kind:'WRITE', path:'a.txt', contents:'after' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 0);
    assert.equal(readFileSync(join(b.shadow.root, 'a.txt'), 'utf8'), 'before');
    // Nothing happened, so nothing was observed, so the comparison could not run -- and the
    // report says that instead of calling the run clean.
    assert.equal(report.surprise, null);
    assert.ok(report.comparisonRefused);
    assert.equal(report.ok, false);
  } finally { b.cleanup(); }
});

test('a token for a different path or operation does not authorise this action', () => {
  const b = bench(['a.txt', 'b.txt']);
  try {
    const write = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
    const wrongPath = execute({
      authorized:b.authorized, minter:b.minter, tokens:[write], shadow:b.shadow,
      actions:[{ kind:'WRITE', path:'b.txt', contents:'x' }],
      expectation:expectation(['b.txt']), nowUnix:NOW,
    });
    assert.equal(wrongPath.performed, 0);
    assert.equal(readFileSync(join(b.shadow.root, 'b.txt'), 'utf8'), 'before');

    const read = b.minter.mint(b.authorized, ask(['a.txt'], ['READ']), NOW);
    const wrongOp = execute({
      authorized:b.authorized, minter:b.minter, tokens:[read], shadow:b.shadow,
      actions:[{ kind:'WRITE', path:'a.txt', contents:'x' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(wrongOp.performed, 0);
    assert.equal(readFileSync(join(b.shadow.root, 'a.txt'), 'utf8'), 'before');
  } finally { b.cleanup(); }
});

test('a spent token stops authorising and the second action has no effect', () => {
  const b = bench(['a.txt']);
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[
        { kind:'WRITE', path:'a.txt', contents:'first' },
        { kind:'WRITE', path:'a.txt', contents:'second' },
      ],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 1);
    assert.equal(report.refused, 1);
    // The second write never happened: the spend is refused before the effect.
    assert.equal(readFileSync(join(b.shadow.root, 'a.txt'), 'utf8'), 'first');
  } finally { b.cleanup(); }
});

test('a token minted for another plan is not accepted', () => {
  const b = bench(['a.txt']);
  try {
    const otherPlan = {
      mode:'safe', constraints:[],
      steps:[{ id:'a', description:'s', files:['a.txt', 'extra.txt'], commands:[], dependsOn:[],
        blastRadius:{ paths:['a.txt', 'extra.txt'], reachesOutsideWorkspace:false, destructive:false } }],
    };
    const otherAuthorized = authorizePlan(otherPlan, {
      approverId:'owner-001', grantedAtUnix:NOW, expiresAtUnix:NOW + 3600, scopeNote:'other',
    }, NOW);
    assert.notEqual(otherAuthorized.digest, b.authorized.digest);
    const token = b.minter.mint(otherAuthorized, ask(['a.txt'], ['WRITE']), NOW);
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[{ kind:'WRITE', path:'a.txt', contents:'after' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 0);
    assert.equal(readFileSync(join(b.shadow.root, 'a.txt'), 'utf8'), 'before');
  } finally { b.cleanup(); }
});

test('EXECUTE is declared and always refused, even holding a token for it', () => {
  const b = bench(['a.txt'], true);
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['EXECUTE']), NOW);
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[{ kind:'EXECUTE', command:'rm -rf /' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 0);
    assert.equal(report.outcomes[0].reason, NO_EXECUTION_SURFACE);
  } finally { b.cleanup(); }
});

test('a path leaving the shadow is refused even holding a token that names it', () => {
  const b = bench(['a.txt']);
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
    // The token is widened by hand to the escaping path. The capability layer would refuse
    // to mint this; the point here is that the executor's containment refuses it too.
    const widened = { ...token, paths:['../outside.txt'] };
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[widened], shadow:b.shadow,
      actions:[{ kind:'WRITE', path:'../outside.txt', contents:'x' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 0, JSON.stringify(report.outcomes));
    assert.ok(!existsSync(join(b.shadowRoot, '..', 'outside.txt')));
  } finally { b.cleanup(); }
});

test('a delete is observed and compared', () => {
  const b = bench(['a.txt'], true);
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['DELETE']), NOW);
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[{ kind:'DELETE', path:'a.txt' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 1);
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.ok(!existsSync(join(b.shadow.root, 'a.txt')));
    assert.ok(existsSync(join(b.source, 'a.txt')));
  } finally { b.cleanup(); }
});

test('a change nobody declared makes the run not ok even though every action was allowed', () => {
  const b = bench(['a.txt', 'secret.txt']);
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt', 'secret.txt'], ['WRITE'], 2), NOW);
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[
        { kind:'WRITE', path:'a.txt', contents:'after' },
        { kind:'WRITE', path:'secret.txt', contents:'after' },
      ],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 2);
    assert.equal(report.ok, false);
    assert.deepEqual(report.surprise.unexpected, ['secret.txt']);
  } finally { b.cleanup(); }
});

// The case above catches an undeclared write only because the caller happened to put
// `secret.txt` in the plan's files, so the shadow held it. This one is the real shape of the
// accident: a file the plan never mentioned at all. With a shadow built from the declared
// paths it is not in the shadow, so writing it is invisible and the run reports clean.
test('a file the plan never named at all is still observed when it is written', () => {
  const b = bench(['a.txt']);
  try {
    writeFileSync(join(b.source, 'never-mentioned.txt'), 'before');
    const fresh = ShadowWorkspace.ofWorkspace(b.source,
      mkdtempSync(join(tmpdir(), 'noesar-exec-dst2-')));
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
    execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:fresh,
      actions:[{ kind:'WRITE', path:'a.txt', contents:'after' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    // Something outside the executor touches the shadow — a test runner, a build, a script.
    writeFileSync(join(fresh.root, 'never-mentioned.txt'), 'touched');
    const surprise = compare(expectation(['a.txt']), fresh.observe([]));
    assert.equal(surprise.clean, false);
    assert.deepEqual(surprise.unexpected, ['never-mentioned.txt']);
    assert.equal(readFileSync(join(b.source, 'never-mentioned.txt'), 'utf8'), 'before');
    fresh.discard();
  } finally { b.cleanup(); }
});

test('the executor refuses a shadow that cannot observe an undeclared write', () => {
  const b = bench(['a.txt']);
  try {
    const targeted = new ShadowWorkspace(b.source,
      mkdtempSync(join(tmpdir(), 'noesar-exec-dst3-')), ['a.txt']);
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
    let kind = null;
    try {
      execute({
        authorized:b.authorized, minter:b.minter, tokens:[token], shadow:targeted,
        actions:[{ kind:'WRITE', path:'a.txt', contents:'after' }],
        expectation:expectation(['a.txt']), nowUnix:NOW,
      });
    } catch (error) {
      kind = error.kind;
    }
    // F4-014: 'INVALID', not a Node-only 'COVERAGE' kind Rust's ShadowError has no equivalent
    // for — see the comment above the throw site in executor.mjs.
    assert.equal(kind, 'INVALID');
    // Refused before anything was spent or written.
    assert.equal(readFileSync(join(targeted.root, 'a.txt'), 'utf8'), 'before');
    targeted.discard();
  } finally { b.cleanup(); }
});

test('the status states the execution surface it does not have', () => {
  const status = executorStatus();
  assert.equal(status.acceptsOnlyCapabilityTokens, true);
  assert.equal(status.spendsBeforeEffect, true);
  assert.equal(status.executionSurface, false);
  assert.equal(status.requiresWholeWorkspaceShadow, true);
  assert.deepEqual(status.refusedOperations, ['EXECUTE']);
});

// --- ARCH-008 / D-0250: EXECUTE as a per-installation client decision -------------------------

import { existsSync as fsExistsSync } from 'node:fs';
import { EXECUTE_DISABLED_BY_OPERATOR, EXECUTE_TOKEN_WITHOUT_LIMITS } from '../src/executor.mjs';

const SANDBOX_BINARY = join(import.meta.dirname, '../../../rust/target/release/noesar-sandbox');
const HAVE_SANDBOX_BINARY = fsExistsSync(SANDBOX_BINARY);

test('with no executeSandbox argument at all, EXECUTE is refused EXACTLY as before D-0250 — zero regression', () => {
  const b = bench(['a.txt'], true);
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['EXECUTE']), NOW);
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[{ kind:'EXECUTE', command:'rm -rf /' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
    });
    assert.equal(report.performed, 0);
    assert.equal(report.outcomes[0].reason, NO_EXECUTION_SURFACE, 'byte-identical to EXEC-007, unchanged');
  } finally { b.cleanup(); }
});

test('with a config present but disabled, the reason names the operator decision, distinct from "no surface"', () => {
  const b = bench(['a.txt'], true);
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['EXECUTE']), NOW);
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[{ kind:'EXECUTE', path:'a.txt', command:'/bin/true' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
      executeSandbox: { enabled:false, requested:false, binaryPath:SANDBOX_BINARY },
    });
    assert.equal(report.performed, 0);
    assert.equal(report.outcomes[0].reason, EXECUTE_DISABLED_BY_OPERATOR);
    assert.notEqual(report.outcomes[0].reason, NO_EXECUTION_SURFACE, 'must not claim there is no surface when there is one, just disabled');
  } finally { b.cleanup(); }
});

test('enabled, but the token was minted with no limits — refused defensively, never run with the container\'s own limits', {
  skip: !HAVE_SANDBOX_BINARY,
}, () => {
  const b = bench(['a.txt'], true);
  try {
    // No `.limits` on the mint request, and `bench()`'s minter carries no ceiling — the
    // mint-time gate (capability.mjs, D-0248) only fires when a ceiling is configured, so
    // this token reaches execute() with `limits: null` deliberately, to prove the executor's
    // OWN defensive check catches it independently of the mint-time one.
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['EXECUTE']), NOW);
    assert.equal(token.limits, null, 'fixture check: this token must carry no limits');
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[{ kind:'EXECUTE', path:'a.txt', command:'/bin/true' }],
      expectation:expectation(['a.txt']), nowUnix:NOW,
      executeSandbox: { enabled:true, requested:true, binaryPath:SANDBOX_BINARY },
    });
    assert.equal(report.performed, 0);
    assert.equal(report.outcomes[0].reason, EXECUTE_TOKEN_WITHOUT_LIMITS);
  } finally { b.cleanup(); }
});

// EXECUTE's granted `path` is the working directory the command runs confined to — not a
// file, unlike WRITE/DELETE's paths. `'.'` names the shadow root itself via the SAME
// `contained()` helper those kinds use (`resolve(root, '.') === root`), so this needs its own
// plan whose step declares `.` as a file, not `bench()`'s file-content fixture.
function benchDir(destructive = true) {
  const source = mkdtempSync(join(tmpdir(), 'noesar-exec-dir-src-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-exec-dir-dst-'));
  // ShadowWorkspace.ofWorkspace refuses "a shadow of nothing" (a structurally empty
  // materialisation can never report an undeclared write) — one placeholder file, not part
  // of the EXECUTE grant itself, satisfies that guard.
  writeFileSync(join(source, 'placeholder.txt'), 'unrelated to the EXECUTE grant');
  const plan = {
    mode:'safe', constraints:[],
    steps:[{ id:'a', description:'s', files:['.'], commands:[], dependsOn:[],
      blastRadius:{ paths:['.'], reachesOutsideWorkspace:false, destructive } }],
  };
  const authorized = authorizePlan(plan, {
    approverId:'owner-001', grantedAtUnix:NOW, expiresAtUnix:NOW + 3600, scopeNote:'test',
  }, NOW);
  return {
    source, shadowRoot, authorized, minter: new TokenMinter(SECRET),
    shadow: ShadowWorkspace.ofWorkspace(source, shadowRoot),
    cleanup() {
      rmSync(source, { recursive:true, force:true });
      rmSync(shadowRoot, { recursive:true, force:true });
    },
  };
}

test('enabled, granted, limited — a real command actually runs, contained, through the real binary', {
  skip: !HAVE_SANDBOX_BINARY,
}, () => {
  const b = benchDir();
  try {
    const token = b.minter.mint(b.authorized, {
      ...ask(['.'], ['EXECUTE']),
      limits: { memoryBytes: 64 * 1024 * 1024, cpuSeconds: 5 },
    }, NOW);
    assert.ok(token.limits, 'fixture check: this token must carry limits');
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[token], shadow:b.shadow,
      actions:[{ kind:'EXECUTE', path:'.', command:'/bin/echo', args:['ran for real'] }],
      expectation:{ pathsTheDiffMustTouch:[], testsExpectedToPass:[], testsExpectedToFail:[] },
      nowUnix:NOW,
      executeSandbox: { enabled:true, requested:true, binaryPath:SANDBOX_BINARY },
    });
    assert.equal(report.performed, 1, JSON.stringify(report.outcomes));
    assert.equal(report.outcomes[0].exitCode, 0);
    assert.match(report.outcomes[0].stdout, /ran for real/);
  } finally { b.cleanup(); }
});

test('enabled, granted, limited — spend-before-effect still holds: a forged token runs nothing', {
  skip: !HAVE_SANDBOX_BINARY,
}, () => {
  const b = benchDir();
  try {
    const token = b.minter.mint(b.authorized, {
      ...ask(['.'], ['EXECUTE']),
      limits: { memoryBytes: 64 * 1024 * 1024, cpuSeconds: 5 },
    }, NOW);
    const forged = { ...token, mac: token.mac.slice(0, -1) + (token.mac.slice(-1) === '0' ? '1' : '0') };
    const report = execute({
      authorized:b.authorized, minter:b.minter, tokens:[forged], shadow:b.shadow,
      actions:[{ kind:'EXECUTE', path:'.', command:'/bin/echo', args:['must not run'] }],
      expectation:{ pathsTheDiffMustTouch:[], testsExpectedToPass:[], testsExpectedToFail:[] },
      nowUnix:NOW,
      executeSandbox: { enabled:true, requested:true, binaryPath:SANDBOX_BINARY },
    });
    assert.equal(report.performed, 0);
  } finally { b.cleanup(); }
});

test('the status tells the truth in both directions: disabled names the mechanism, enabled names the surface', () => {
  const off = executorStatus({ enabled:false, requested:false });
  assert.equal(off.executionSurface, false);
  assert.deepEqual(off.refusedOperations, ['EXECUTE']);
  assert.match(off.reason, /disabled on this installation/);

  const on = executorStatus({ enabled:true, requested:true });
  assert.equal(on.executionSurface, true);
  assert.deepEqual(on.refusedOperations, []);
  assert.match(on.reason, /enabled on this installation/);

  const nothing = executorStatus();
  assert.equal(nothing.executionSurface, false);
  assert.equal(nothing.executeSandboxEnabled, false);
});
