// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-001` — *«Nessun percorso muta il workspace senza spendere un token coniato da un Piano
// autorizzato»* (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**), whose
// stated verification method is *«suite avversaria il cui unico lavoro è provare a farglielo
// fare»*. This file is that suite. Until it existed the criterion had **no recorded verdict
// anywhere** — one of the fifteen critical ones in that state (`D-0556`).
//
// # Why a new file, when capability, executor and workspace-actions are all already tested
//
// They are, and this file deliberately does not repeat them. What none of them measures is the
// word the criterion actually turns on: **nessun percorso** — *no path*. Every existing suite
// proves that the path it drives refuses without a token. None of them proves there is no
// OTHER path. A criterion about the absence of a route cannot be closed by testing the routes
// somebody thought of, so section 1 derives the set of writers from the source and fails when
// it grows.
//
// The second thing none of them measures is the difference between a refusal and a
// non-mutation. An outcome that says `performed: false` is a **report**; CE-001 is about the
// bytes. Section 2 therefore asserts, after every refused attack, that the file on disk is
// unchanged — the source workspace AND the shadow — instead of trusting the reason string.
//
// # What is NOT claimed here, stated rather than left to be discovered
//
// `restore()` writes to the real workspace and spends no token (section 3). It is not a hole:
// it can only write back bytes `#promote` captured, so it cannot produce a state the workspace
// did not already have under an authorised plan. But that is a *different* property from the
// one CE-001 states, so it is measured as its own thing and named in the verdict rather than
// folded into it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { TokenMinter, authorizePlan, CapabilityError } from '../src/capability.mjs';
import { ShadowWorkspace } from '../src/shadow.mjs';
import { execute } from '../src/executor.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { EventLedger } from '../src/events.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const NOW = 1800000000;
const SECRET = Buffer.alloc(32, 7);

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1 · THE CLOSURE — which modules can write at all, and which of them know where the
//     workspace is. Derived from the source every run; the lists below are the declaration
//     the derivation is checked against, in the shape `tui-import-closure.test.mjs` already
//     uses for imports. A new writer is not a failure of this test — it is a module whose
//     relationship to CE-001 nobody has stated yet, and the test says so by name.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const WRITE_CALL = /\b(writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|mkdir|renameSync|rename|rmSync|rm|unlinkSync|unlink|createWriteStream|copyFileSync|cpSync)\s*\(/;

/** Source with comments removed, so a write named in prose is not counted as a write. */
function code(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

function modules(root) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...modules(full));
    else if (entry.name.endsWith('.mjs')) found.push(full);
  }
  return found.sort();
}

// The three modules that both know where the workspace is and can write. Each carries the
// reason it is not a way to mutate authored content without a token — checked in section 2
// for the first, and stated with its evidence for the other two.
const WORKSPACE_AWARE_WRITERS = new Map([
  ['workspace-actions.mjs',
    'the promotion path itself: #promote copies shadow -> workspace only after execute() spent a token for every outcome it copies, and only when the comparison came back clean'],
  ['session-protocol.mjs',
    'unlinkSync of a stale unix socket path, never a file of a plan — the terminal transport, not authored content'],
  ['server.mjs',
    'creates the product-state directories that live on the workspace volume (publishers/, module credentials, the model catalogue, an update backup) with modes 0600/0700 — none of them is a path a plan can name'],
]);

test('CE-001 closure: exactly three modules both know the workspace root and can write', () => {
  const offenders = [];
  for (const file of modules(SRC)) {
    const text = code(file);
    if (!WRITE_CALL.test(text)) continue;
    if (!/workspaceRoot/.test(text)) continue;
    const name = relative(SRC, file);
    if (!WORKSPACE_AWARE_WRITERS.has(name)) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    `these modules can write AND know where the workspace is, and no one has stated their relationship to CE-001: ${offenders.join(', ')}`);
});

test('CE-001 closure: every declared writer still exists and still writes', () => {
  // The other direction, so the declaration cannot rot into a list of files that no longer
  // do what it says. A stale allow-list is how a closure argument quietly stops being one.
  for (const [name] of WORKSPACE_AWARE_WRITERS) {
    const file = join(SRC, name);
    assert.ok(existsSync(file), `${name} is declared above but no longer exists`);
    assert.match(code(file), WRITE_CALL, `${name} is declared as a writer but no longer writes`);
  }
});

test('CE-001 closure: the executor never learns where the real workspace is', () => {
  // It is handed a shadow root and acts inside it. If it ever took a workspace root, "the
  // effect lands in a throwaway copy" would stop being structural and become a convention.
  const text = code(join(SRC, 'executor.mjs'));
  assert.ok(!/workspaceRoot/.test(text),
    'executor.mjs now references a workspace root — the effect could reach the real tree directly');
  assert.match(text, /shadow\.root/, 'executor.mjs no longer writes through shadow.root');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2 · THE ATTACKS — nine ways to hold something token-shaped, and the bytes after each.
// ═══════════════════════════════════════════════════════════════════════════════════════════

function bench({ destructive = false } = {}) {
  const source = mkdtempSync(join(tmpdir(), 'noesar-ce001-src-'));
  const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-ce001-dst-'));
  writeFileSync(join(source, 'a.txt'), 'before');
  writeFileSync(join(source, 'b.txt'), 'before');
  const plan = {
    mode: 'safe',
    constraints: [],
    steps: [{
      id: 'a', description: 's', files: ['a.txt', 'b.txt'], commands: [], dependsOn: [],
      blastRadius: { paths: ['a.txt', 'b.txt'], reachesOutsideWorkspace: false, destructive },
    }],
  };
  const authorized = authorizePlan(plan, {
    approverId: 'owner-001', grantedAtUnix: NOW, expiresAtUnix: NOW + 3600, scopeNote: 'ce-001',
  }, NOW);
  return {
    source, shadowRoot, authorized,
    minter: new TokenMinter(SECRET),
    shadow: ShadowWorkspace.ofWorkspace(source, shadowRoot),
    cleanup() {
      rmSync(source, { recursive: true, force: true });
      rmSync(shadowRoot, { recursive: true, force: true });
    },
  };
}

const ask = (paths, operations, uses = 1) => ({
  stepId: 'a', paths, operations, reason: 'ce-001', uses, expiresAtUnix: NOW + 600,
});
const expectation = (paths) => ({
  pathsTheDiffMustTouch: paths, testsExpectedToPass: [], testsExpectedToFail: [],
});
const write = (path, contents = 'AFTER') => ({ kind: 'WRITE', path, contents });

/** The whole point of section 2: the report is not the evidence, the bytes are. */
function assertUnchanged(b, path = 'a.txt') {
  assert.equal(readFileSync(join(b.source, path), 'utf8'), 'before',
    `the real workspace was mutated at ${path}`);
  assert.equal(readFileSync(join(b.shadow.root, path), 'utf8'), 'before',
    `the shadow was mutated at ${path}`);
}

function attack(name, build) {
  test(`CE-001: ${name} — and the bytes are unchanged`, () => {
    const b = bench();
    try {
      const tokens = build(b);
      const report = execute({
        authorized: b.authorized, minter: b.minter, tokens, shadow: b.shadow,
        actions: [write('a.txt')], expectation: expectation(['a.txt']), nowUnix: NOW,
      });
      assert.equal(report.performed, 0, JSON.stringify(report.outcomes));
      assert.equal(report.ok, false);
      assertUnchanged(b);
    } finally { b.cleanup(); }
  });
}

// The positive control comes FIRST and on purpose. Nine refusals prove nothing if the write
// could not have happened anyway: a broken bench would pass every attack in this file.
test('CE-001 control: with a token minted from the approved plan, the write DOES land', () => {
  const b = bench();
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
    const report = execute({
      authorized: b.authorized, minter: b.minter, tokens: [token], shadow: b.shadow,
      actions: [write('a.txt')], expectation: expectation(['a.txt']), nowUnix: NOW,
    });
    assert.equal(report.performed, 1, JSON.stringify(report.outcomes));
    assert.equal(readFileSync(join(b.shadow.root, 'a.txt'), 'utf8'), 'AFTER');
    // Even the authorised effect never reaches the real tree from here: promotion is a
    // separate, later decision (section 3).
    assert.equal(readFileSync(join(b.source, 'a.txt'), 'utf8'), 'before');
  } finally { b.cleanup(); }
});

attack('no token at all', () => []);

attack('a forged MAC', (b) => {
  const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
  const flipped = token.mac[0] === 'a' ? 'b' : 'a';
  return [{ ...token, mac: flipped + token.mac.slice(1) }];
});

attack('a token from a minter with a different secret', (b) => {
  const other = new TokenMinter(Buffer.alloc(32, 9));
  return [other.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW)];
});

// The subtle one. The MAC verifies — same secret, same plan, same shape — and the token is
// still refused, because the registry that would have to decrement it never issued it. Without
// this, "the token verifies" and "this engine granted it" would be the same sentence.
attack('a token from a DIFFERENT minter holding the SAME secret', (b) => {
  const twin = new TokenMinter(SECRET);
  return [twin.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW)];
});

// Expiry needs its own clock and so cannot use `attack()`, which runs everything at `NOW`.
// Written as an `attack()` first, this one FAILED — the token had not expired yet at `NOW`
// and the write correctly landed. That failure is worth keeping in the record: it is the
// positive control firing a second time, on a case the author got wrong.
test('CE-001: a token spent after it expired changes nothing', () => {
  const b = bench();
  try {
    const token = b.minter.mint(b.authorized, { ...ask(['a.txt'], ['WRITE']), expiresAtUnix: NOW + 10 }, NOW);
    const report = execute({
      authorized: b.authorized, minter: b.minter, tokens: [token], shadow: b.shadow,
      actions: [write('a.txt')], expectation: expectation(['a.txt']), nowUnix: NOW + 11,
    });
    assert.equal(report.performed, 0, JSON.stringify(report.outcomes));
    assertUnchanged(b);
  } finally { b.cleanup(); }
});

test('CE-001: an exhausted token changes nothing the second time', () => {
  const b = bench();
  try {
    const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE'], 1), NOW);
    b.minter.spend(token, { path: 'a.txt', operation: 'WRITE' }, NOW);   // the one use
    const report = execute({
      authorized: b.authorized, minter: b.minter, tokens: [token], shadow: b.shadow,
      actions: [write('a.txt')], expectation: expectation(['a.txt']), nowUnix: NOW,
    });
    assert.equal(report.performed, 0, JSON.stringify(report.outcomes));
    assertUnchanged(b);
  } finally { b.cleanup(); }
});

attack('a revoked token', (b) => {
  const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
  assert.equal(b.minter.revoke(token.id), true);
  return [token];
});

attack('a token granted for another path', (b) => {
  const token = b.minter.mint(b.authorized, ask(['b.txt'], ['WRITE']), NOW);
  return [token];
});

attack('a READ token used to write', (b) => {
  const token = b.minter.mint(b.authorized, ask(['a.txt'], ['READ']), NOW);
  return [token];
});

attack('a token carrying another plan\'s digest', (b) => {
  const token = b.minter.mint(b.authorized, ask(['a.txt'], ['WRITE']), NOW);
  return [{ ...token, planDigest: 'f'.repeat(64) }];
});

// --- and the mint side: three ways a token that could do harm is never issued at all -------

test('CE-001: no token is minted for a path the approved step does not name', () => {
  const b = bench();
  try {
    assert.throws(() => b.minter.mint(b.authorized, ask(['c.txt'], ['WRITE']), NOW),
      (error) => error instanceof CapabilityError && error.kind === 'OUT_OF_SCOPE');
    assertUnchanged(b);
  } finally { b.cleanup(); }
});

test('CE-001: no token is minted for a path that leaves the workspace, whatever the step declares', () => {
  const source = mkdtempSync(join(tmpdir(), 'noesar-ce001-esc-'));
  try {
    writeFileSync(join(source, 'a.txt'), 'before');
    const plan = {
      mode: 'safe', constraints: [],
      steps: [{
        id: 'a', description: 's', files: ['../escape.txt'], commands: [], dependsOn: [],
        // The lie is deliberate: the plan arrives over the wire and declares itself contained.
        blastRadius: { paths: ['../escape.txt'], reachesOutsideWorkspace: false, destructive: false },
      }],
    };
    const authorized = authorizePlan(plan, {
      approverId: 'owner-001', grantedAtUnix: NOW, expiresAtUnix: NOW + 3600, scopeNote: 'ce-001',
    }, NOW);
    const minter = new TokenMinter(SECRET);
    assert.throws(() => minter.mint(authorized, ask(['../escape.txt'], ['WRITE']), NOW),
      (error) => error instanceof CapabilityError && error.kind === 'OUT_OF_SCOPE');
  } finally { rmSync(source, { recursive: true, force: true }); }
});

test('CE-001: a plan nobody approved authorises nothing, so no token can descend from it', () => {
  const plan = {
    mode: 'safe', constraints: [],
    steps: [{
      id: 'a', description: 's', files: ['a.txt'], commands: [], dependsOn: [],
      blastRadius: { paths: ['a.txt'], reachesOutsideWorkspace: false, destructive: false },
    }],
  };
  assert.throws(() => authorizePlan(plan, {
    approverId: '   ', grantedAtUnix: NOW, expiresAtUnix: NOW + 3600,
  }, NOW), (error) => error instanceof CapabilityError && error.kind === 'NOT_AUTHORIZED');
  assert.throws(() => authorizePlan(plan, {
    approverId: 'owner-001', grantedAtUnix: NOW - 7200, expiresAtUnix: NOW - 3600,
  }, NOW), (error) => error instanceof CapabilityError && error.kind === 'NOT_AUTHORIZED');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3 · THE PRODUCT SURFACE, and the one mutation that spends no token.
// ═══════════════════════════════════════════════════════════════════════════════════════════

function orchestrator() {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-ce001-ws-'));
  // ShadowWorkspace refuses to shadow an empty tree, and a real workspace never is one.
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce001-sh-'));
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
  });
  return { ws, shadows, orch, cleanup() {
    rmSync(ws, { recursive: true, force: true });
    rmSync(shadows, { recursive: true, force: true });
  } };
}

test('CE-001: planning alone mutates nothing — the workspace changes only at approval', async () => {
  const fx = orchestrator();
  try {
    mkdirSync(join(fx.ws, 'src'), { recursive: true });
    writeFileSync(join(fx.ws, 'src/a.txt'), 'original\n');
    const planned = await fx.orch.plan({
      request: 'change a line',
      files: [{ path: 'src/a.txt', contents: 'changed\n' }],
      actor: 'owner-001', nowUnix: NOW,
    });
    // A plan exists, a shadow may exist, and the real file is untouched.
    assert.equal(readFileSync(join(fx.ws, 'src/a.txt'), 'utf8'), 'original\n');
    fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });
    assert.equal(readFileSync(join(fx.ws, 'src/a.txt'), 'utf8'), 'changed\n');
  } finally { fx.cleanup(); }
});

test('CE-001 named exception: restore() mutates the workspace and spends no token — and can only write back what promotion captured', async () => {
  const fx = orchestrator();
  try {
    mkdirSync(join(fx.ws, 'src'), { recursive: true });
    writeFileSync(join(fx.ws, 'src/a.txt'), 'original\n');
    const planned = await fx.orch.plan({
      request: 'change a line',
      files: [
        { path: 'src/a.txt', contents: 'changed\n' },
        { path: 'src/new.txt', contents: 'created\n' },
      ],
      actor: 'owner-001', nowUnix: NOW,
    });
    fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });
    assert.equal(readFileSync(join(fx.ws, 'src/a.txt'), 'utf8'), 'changed\n');
    assert.ok(existsSync(join(fx.ws, 'src/new.txt')));

    fx.orch.restore({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW + 1 });
    // The bound: byte-for-byte the state before the plan, and nothing else. A restore that
    // could write anything else would be a second, unauthorised authoring surface.
    assert.equal(readFileSync(join(fx.ws, 'src/a.txt'), 'utf8'), 'original\n');
    assert.equal(existsSync(join(fx.ws, 'src/new.txt')), false);

    // And it is not a repeatable write primitive: once used, it refuses.
    assert.throws(() => fx.orch.restore({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW + 2 }));
  } finally { fx.cleanup(); }
});

test('CE-001: restore refuses on a run that was never promoted, so it cannot be used to write at all', async () => {
  const fx = orchestrator();
  try {
    writeFileSync(join(fx.ws, 'a.txt'), 'original\n');
    const planned = await fx.orch.plan({
      request: 'change a line',
      files: [{ path: 'a.txt', contents: 'changed\n' }],
      actor: 'owner-001', nowUnix: NOW,
    });
    assert.throws(() => fx.orch.restore({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW }));
    assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'original\n');
  } finally { fx.cleanup(); }
});
