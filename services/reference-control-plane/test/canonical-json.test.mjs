import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  canonicalJson,
  canonicalJsonBytes,
} from '../src/canonical-json.mjs';

// Resolved from this file, not from the process CWD — the idiom every other vector test in
// this directory already uses (`event-vectors.test.mjs`, `executor-vectors.test.mjs`, …).
// Found 2026-08-19: this one alone said `resolve('conformance/authority-vectors.json')`, so it
// passed when the battery was launched from the repository root and threw ENOENT when the same
// file was run from `services/reference-control-plane/`. A conformance vector that is checked
// or skipped depending on where the runner happens to stand is not a conformance check.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('object keys are sorted recursively', () => {
  assert.equal(
    canonicalJson({ z:{ y:2, a:1 }, a:0 }),
    '{"a":0,"z":{"a":1,"y":2}}'
  );
});

test('arrays preserve order', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
});

test('negative zero canonicalizes to zero', () => {
  assert.equal(canonicalJson({ value:-0 }), '{"value":0}');
});

test('unicode remains UTF-8 JSON', () => {
  assert.equal(canonicalJson({ word:'è' }), '{"word":"è"}');
});

test('non-finite values are rejected', () => {
  assert.throws(() => canonicalJson({ value:Number.NaN }), /non-finite/);
  assert.throws(() => canonicalJson({ value:Number.POSITIVE_INFINITY }), /non-finite/);
});

test('unsupported values are rejected', () => {
  assert.throws(() => canonicalJson(undefined), /rejects undefined/);
});

test('bytes are UTF-8 canonical JSON', () => {
  assert.deepEqual(
    canonicalJsonBytes({ b:2, a:1 }),
    Buffer.from('{"a":1,"b":2}', 'utf8')
  );
});

test('published HMAC conformance vector matches', () => {
  const vectors = JSON.parse(readFileSync(
    resolve(ROOT, 'conformance/authority-vectors.json'),
    'utf8'
  ));
  const vector = vectors.authorityHmac[0];
  const secret = Buffer.from(vector.secretHex, 'hex');
  assert.equal(canonicalJson(vector.body), vector.canonicalUtf8);
  const signature = createHmac('sha256', secret)
    .update(canonicalJsonBytes(vector.body))
    .digest('base64url');
  assert.equal(signature, vector.signatureBase64Url);
});
