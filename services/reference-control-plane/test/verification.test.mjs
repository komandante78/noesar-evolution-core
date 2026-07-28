// SPDX-License-Identifier: AGPL-3.0-or-later
// CodeN Evolution construction order, step 9: the recompute verifier + projection
// coverage. No Rust twin — see the module comment in src/verification.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  VerificationError, verifyClaims, projectionCoverage, verificationStatus,
  SUPPORTED_CLAIM_TYPES,
} from '../src/verification.mjs';

function tmpShadow() {
  return mkdtempSync(join(tmpdir(), 'noesar-verify-'));
}

test('verifyClaims refuses a non-array claims argument', () => {
  assert.throws(() => verifyClaims('not-an-array', '/tmp'), VerificationError);
});

test('file_exists: recomputed true for a file that is there, false for one that is not', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'present.txt'), 'x');
    const results = verifyClaims([
      { type:'file_exists', path:'present.txt' },
      { type:'file_exists', path:'absent.txt' },
    ], root);
    assert.deepEqual(results.map((r) => [r.recomputed, r.matches]), [[true, true], [true, false]]);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('file_absent: the inverse of file_exists', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'present.txt'), 'x');
    const results = verifyClaims([
      { type:'file_absent', path:'present.txt' },
      { type:'file_absent', path:'absent.txt' },
    ], root);
    assert.deepEqual(results.map((r) => r.matches), [false, true]);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('file_equals: matches exact content, recomputed even when it does not match', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'a.txt'), 'hello world');
    const results = verifyClaims([
      { type:'file_equals', path:'a.txt', value:'hello world' },
      { type:'file_equals', path:'a.txt', value:'goodbye' },
    ], root);
    assert.deepEqual(results.map((r) => [r.recomputed, r.matches]), [[true, true], [true, false]]);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('file_equals on a missing file: recomputed, does not match, names the reason', () => {
  const root = tmpShadow();
  try {
    const [result] = verifyClaims([{ type:'file_equals', path:'missing.txt', value:'x' }], root);
    assert.equal(result.recomputed, true);
    assert.equal(result.matches, false);
    assert.match(result.reason, /does not exist/);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('file_contains: substring match', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'a.log'), 'line one\nERROR: bad thing\nline three');
    const results = verifyClaims([
      { type:'file_contains', path:'a.log', value:'ERROR' },
      { type:'file_contains', path:'a.log', value:'PANIC' },
    ], root);
    assert.deepEqual(results.map((r) => r.matches), [true, false]);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('file_hash_equals: recomputes sha256 directly, names the recomputed digest on mismatch', () => {
  const root = tmpShadow();
  try {
    const content = 'the exact bytes that matter';
    writeFileSync(join(root, 'a.bin'), content);
    const realDigest = createHash('sha256').update(content).digest('hex');
    const results = verifyClaims([
      { type:'file_hash_equals', path:'a.bin', value:realDigest },
      { type:'file_hash_equals', path:'a.bin', value:'0'.repeat(64) },
    ], root);
    assert.equal(results[0].matches, true);
    assert.equal(results[1].matches, false);
    assert.match(results[1].reason, new RegExp(realDigest));
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('json_field_equals: a dotted path into real, parsed JSON', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'pkg.json'), JSON.stringify({ name:'x', meta:{ version:'2.0.0' } }));
    const results = verifyClaims([
      { type:'json_field_equals', path:'pkg.json', field:'meta.version', value:'2.0.0' },
      { type:'json_field_equals', path:'pkg.json', field:'meta.version', value:'1.0.0' },
    ], root);
    assert.deepEqual(results.map((r) => r.matches), [true, false]);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('json_field_equals on a file that is not JSON: recomputed:false, not a crash', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'not.json'), 'this is not { json');
    const [result] = verifyClaims([{ type:'json_field_equals', path:'not.json', field:'x', value:1 }], root);
    assert.equal(result.recomputed, false);
    assert.match(result.reason, /not valid JSON/);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('a behavioural claim is always declared unrecomputed, by design, not silently skipped', () => {
  const root = tmpShadow();
  try {
    const [result] = verifyClaims([{ type:'behavioural', description:'f(2) returns 4' }], root);
    assert.equal(result.recomputed, false);
    assert.match(result.reason, /EXECUTE is permanently refused/);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('an unknown claim type is named in the reason, not thrown, so the rest of the batch still runs', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'a.txt'), 'x');
    const results = verifyClaims([
      { type:'made_up_type', path:'a.txt' },
      { type:'file_exists', path:'a.txt' },
    ], root);
    assert.equal(results[0].recomputed, false);
    assert.match(results[0].reason, /unsupported claim type/);
    assert.equal(results[1].recomputed, true);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('a claim escaping the shadow root is refused, not followed', () => {
  const root = tmpShadow();
  try {
    const [result] = verifyClaims([{ type:'file_exists', path:'../../../etc/passwd' }], root);
    assert.equal(result.recomputed, false);
    assert.match(result.reason, /leaves the shadow/);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('projectionCoverage: zero claims declares so, is not "complete"', () => {
  const coverage = projectionCoverage([]);
  assert.equal(coverage.total, 0);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.coverageFraction, null);
  assert.match(coverage.declaration, /no claims were declared/);
});

test('projectionCoverage: all recomputed and matched is complete:true', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'a.txt'), 'x');
    const results = verifyClaims([{ type:'file_exists', path:'a.txt' }], root);
    const coverage = projectionCoverage(results);
    assert.equal(coverage.complete, true);
    assert.equal(coverage.coverageFraction, 1);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('projectionCoverage: one unrecomputed claim among several is never rounded up to complete', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'a.txt'), 'x');
    const results = verifyClaims([
      { type:'file_exists', path:'a.txt' },
      { type:'behavioural', description:'unrecomputable' },
    ], root);
    const coverage = projectionCoverage(results);
    assert.equal(coverage.total, 2);
    assert.equal(coverage.recomputed, 1);
    assert.equal(coverage.complete, false);
    assert.equal(coverage.unrecomputed.length, 1);
    assert.match(coverage.declaration, /not recomputed/);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('projectionCoverage: a recomputed claim that does not match is CONTRADICTED, distinct from unrecomputed', () => {
  const root = tmpShadow();
  try {
    writeFileSync(join(root, 'a.txt'), 'actual content');
    const results = verifyClaims([{ type:'file_equals', path:'a.txt', value:'expected content' }], root);
    const coverage = projectionCoverage(results);
    assert.equal(coverage.contradicted.length, 1);
    assert.equal(coverage.unrecomputed.length, 0);
    assert.equal(coverage.complete, false);
    assert.match(coverage.declaration, /CONTRADICTED/);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('verificationStatus declares supported claim types and the honest limits', () => {
  const status = verificationStatus();
  assert.deepEqual(status.supportedClaimTypes, SUPPORTED_CLAIM_TYPES);
  assert.ok(SUPPORTED_CLAIM_TYPES.includes('file_hash_equals'));
  assert.ok(!SUPPORTED_CLAIM_TYPES.includes('behavioural'));
  assert.equal(status.behaviouralClaimsRecomputable, false);
  assert.equal(status.metamorphicRelations, false);
  assert.equal(status.coverageNeverRoundedToComplete, true);
});
