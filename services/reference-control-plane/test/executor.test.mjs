// SPDX-License-Identifier: AGPL-3.0-or-later
// The closed circle, end to end in one process: approved plan -> tokens -> shadow ->
// executor -> observation -> comparison. The Rust crate holds the same properties natively.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenMinter, authorizePlan } from '../src/capability.mjs';
import { ShadowWorkspace } from '../src/shadow.mjs';
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
    shadow: new ShadowWorkspace(source, shadowRoot, [...files]),
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

test('the status states the execution surface it does not have', () => {
  const status = executorStatus();
  assert.equal(status.acceptsOnlyCapabilityTokens, true);
  assert.equal(status.spendsBeforeEffect, true);
  assert.equal(status.executionSurface, false);
  assert.deepEqual(status.refusedOperations, ['EXECUTE']);
});
