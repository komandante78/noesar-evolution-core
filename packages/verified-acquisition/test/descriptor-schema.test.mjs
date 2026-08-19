// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0546`. The validator that stands between a publisher and a signature over a useless
// document. Two things are proven here and they are not the same claim:
//
//   1. it REFUSES what the schema forbids — one negative case per keyword it implements, because
//      a validator is only worth what its false cases prove. A validator that returns `valid`
//      for everything passes every positive test ever written for it.
//   2. it REFUSES A SCHEMA IT CANNOT FULLY CHECK — the guarantee that matters most, since the
//      alternative is a green light earned by not looking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateAgainstSchema, assertSchemaSupported, formatSchemaErrors, SchemaSupportError,
} from '../src/index.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_SCHEMA = JSON.parse(readFileSync(join(REPO, 'schemas', 'model-descriptor.schema.json'), 'utf8'));

/** The smallest document the real schema accepts — every `required` field and nothing else. */
const minimal = () => ({
  id: 'demo/tiny',
  version: '1.0.0',
  publisher: 'noesar',
  source: 'https://example.invalid/tiny.gguf',
  license: 'apache-2.0',
  hashes: { sha256: 'a'.repeat(64) },
  formats: ['gguf'],
  workloads: ['chat'],
  resource_profiles: [{ name: 'cpu', ram_gb: 8 }],
});

const errorAt = (result, path) => result.errors.find((error) => error.path === path);

// ---------------------------------------------------------------------------------------------
// 1. The real schema, which is the only one this project actually signs against.
// ---------------------------------------------------------------------------------------------

test('the shipped model-descriptor schema uses only keywords this validator implements', () => {
  // This is the regression guard the module's own comment promises: the day someone adds
  // `pattern` or `minimum` to schemas/model-descriptor.schema.json, THIS fails — loudly, here —
  // instead of every descriptor silently passing a check that was never performed.
  assert.doesNotThrow(() => assertSchemaSupported(REAL_SCHEMA));
});

test('a minimal descriptor satisfies the shipped schema, and reports no errors', () => {
  const result = validateAgainstSchema(minimal(), REAL_SCHEMA);
  assert.equal(result.valid, true, formatSchemaErrors(result.errors));
  assert.deepEqual(result.errors, []);
});

test('a missing required field is named by its own path, not as "invalid document"', () => {
  const document = minimal();
  delete document.hashes;
  const result = validateAgainstSchema(document, REAL_SCHEMA);
  assert.equal(result.valid, false);
  assert.equal(errorAt(result, '/hashes').message, 'is required and missing');
});

test('every missing required field is reported in one pass, not one per run', () => {
  // A publisher fixing one field per invocation learns the shape one round trip at a time.
  const result = validateAgainstSchema({ id: 'x' }, REAL_SCHEMA);
  const missing = result.errors.filter((error) => error.message === 'is required and missing');
  assert.equal(missing.length, 8, formatSchemaErrors(result.errors));
});

test('a field of the wrong type is refused, and its consequences are not piled on top', () => {
  const document = { ...minimal(), formats: 'gguf' };
  const result = validateAgainstSchema(document, REAL_SCHEMA);
  assert.equal(result.valid, false);
  assert.equal(errorAt(result, '/formats').message, 'must be array, not string');
  // The wrong type is the ONE error worth showing: no per-item errors are invented beneath it.
  assert.equal(result.errors.filter((error) => error.path.startsWith('/formats/')).length, 0);
});

test('a wrong item inside an array is located by index', () => {
  const result = validateAgainstSchema({ ...minimal(), formats: ['gguf', 7] }, REAL_SCHEMA);
  assert.equal(errorAt(result, '/formats/1').message, 'must be string, not number');
});

test('a field the schema does not define is refused — additionalProperties: false is enforced', () => {
  const result = validateAgainstSchema({ ...minimal(), sourceUrl: 'https://example.invalid' }, REAL_SCHEMA);
  assert.equal(errorAt(result, '/sourceUrl').message, 'is not a field this schema defines');
});

test('a typo in a required field name is reported as BOTH the absence and the stranger', () => {
  // The case the module exists for: `hashes` spelled `hash` would otherwise be signed happily.
  const document = minimal();
  document.hash = document.hashes;
  delete document.hashes;
  const result = validateAgainstSchema(document, REAL_SCHEMA);
  assert.equal(errorAt(result, '/hashes').message, 'is required and missing');
  assert.equal(errorAt(result, '/hash').message, 'is not a field this schema defines');
});

test('additionalProperties given as a schema is applied to each unnamed key', () => {
  const result = validateAgainstSchema({ ...minimal(), hashes: { sha256: 12345 } }, REAL_SCHEMA);
  assert.equal(errorAt(result, '/hashes/sha256').message, 'must be string, not number');
});

test('an absent optional field is absent, not invalid', () => {
  const document = minimal();
  assert.equal(Object.hasOwn(document, 'quantizations'), false);
  assert.equal(validateAgainstSchema(document, REAL_SCHEMA).valid, true);
});

// ---------------------------------------------------------------------------------------------
// 2. The signature block — the sub-object the signer writes and the schema closes.
// ---------------------------------------------------------------------------------------------

const signed = () => ({
  ...minimal(),
  signature: { algorithm: 'ed25519', value: 'AAAA', publicKeyFingerprint: 'ff', signedAt: '2026-08-19T00:00:00.000Z' },
});

test('a signed descriptor satisfies the schema — the signer and the schema agree', () => {
  const result = validateAgainstSchema(signed(), REAL_SCHEMA);
  assert.equal(result.valid, true, formatSchemaErrors(result.errors));
});

test('a signature algorithm other than ed25519 is refused by const', () => {
  const document = signed();
  document.signature.algorithm = 'rsa-pss';
  const result = validateAgainstSchema(document, REAL_SCHEMA);
  assert.equal(errorAt(result, '/signature/algorithm').message, 'must be "ed25519", not "rsa-pss"');
});

test('an extra field smuggled into the signature block is refused', () => {
  const document = signed();
  document.signature.trustLevel = 'official';
  assert.equal(errorAt(validateAgainstSchema(document, REAL_SCHEMA), '/signature/trustLevel').message,
    'is not a field this schema defines');
});

test('a signature block missing publicKeyFingerprint is refused at its nested path', () => {
  const document = signed();
  delete document.signature.publicKeyFingerprint;
  assert.equal(errorAt(validateAgainstSchema(document, REAL_SCHEMA), '/signature/publicKeyFingerprint').message,
    'is required and missing');
});

// ---------------------------------------------------------------------------------------------
// 3. The refusal to pretend — an unimplemented keyword throws instead of passing.
// ---------------------------------------------------------------------------------------------

test('an unimplemented keyword throws rather than reporting a document as valid', () => {
  assert.throws(
    () => validateAgainstSchema({ id: 'x' }, { type: 'object', properties: { id: { type: 'string', pattern: '^x$' } } }),
    (error) => error instanceof SchemaSupportError && error.keyword === 'pattern',
  );
});

test('the refusal covers a keyword the DOCUMENT never reaches', () => {
  // The whole point of walking the schema and not the document: a constraint sitting on an
  // optional field nobody filled in would otherwise pass unnoticed until the day it mattered.
  const schema = { type: 'object', properties: { never: { type: 'array', items: { type: 'string', minLength: 3 } } } };
  assert.throws(() => validateAgainstSchema({}, schema), SchemaSupportError);
});

test('the refusal names where in the schema it gave up', () => {
  const schema = { type: 'object', properties: { nested: { type: 'object', properties: { deep: { multipleOf: 2 } } } } };
  try {
    validateAgainstSchema({}, schema);
    assert.fail('expected a SchemaSupportError');
  } catch (error) {
    assert.equal(error.keyword, 'multipleOf');
    assert.equal(error.path, '/nested/deep');
  }
});

test('a schema that is not an object at all is refused, not treated as permissive', () => {
  assert.throws(() => validateAgainstSchema({}, 'model-descriptor'), SchemaSupportError);
});

// ---------------------------------------------------------------------------------------------
// 4. The keywords used by no shipped schema today, proven anyway — they are in SUPPORTED, so
//    they are claims this module makes, and an unproven claim is the same as an untested one.
// ---------------------------------------------------------------------------------------------

test('enum accepts a listed value and refuses one that is not listed', () => {
  const schema = { type: 'object', properties: { level: { enum: ['low', 'high'] } } };
  assert.equal(validateAgainstSchema({ level: 'high' }, schema).valid, true);
  assert.equal(errorAt(validateAgainstSchema({ level: 'medium' }, schema), '/level').message,
    'must be one of "low", "high"');
});

test('integer is not satisfied by a fractional number, and number is not satisfied by NaN', () => {
  assert.equal(validateAgainstSchema({ n: 3 }, { properties: { n: { type: 'integer' } } }).valid, true);
  assert.equal(validateAgainstSchema({ n: 3.5 }, { properties: { n: { type: 'integer' } } }).valid, false);
  assert.equal(validateAgainstSchema({ n: NaN }, { properties: { n: { type: 'number' } } }).valid, false);
});

test('null is its own type and never satisfies "object"', () => {
  assert.equal(validateAgainstSchema({ meta: null }, { properties: { meta: { type: 'object' } } }).valid, false);
  assert.equal(validateAgainstSchema({ meta: null }, { properties: { meta: { type: 'null' } } }).valid, true);
});

test('a union type is satisfied by either member', () => {
  const schema = { properties: { ram: { type: ['number', 'string'] } } };
  assert.equal(validateAgainstSchema({ ram: 8 }, schema).valid, true);
  assert.equal(validateAgainstSchema({ ram: '8G' }, schema).valid, true);
  assert.equal(errorAt(validateAgainstSchema({ ram: true }, schema), '/ram').message,
    'must be number or string, not boolean');
});

test('a false subschema allows nothing', () => {
  assert.equal(validateAgainstSchema({ x: 1 }, { properties: { x: false } }).valid, false);
});

// ---------------------------------------------------------------------------------------------
// 5. What the publisher actually reads.
// ---------------------------------------------------------------------------------------------

test('formatSchemaErrors prints one indented line per error, in the order found', () => {
  const document = minimal();
  delete document.license;
  document.formats = 'gguf';
  const lines = formatSchemaErrors(validateAgainstSchema(document, REAL_SCHEMA).errors).split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines, ['  /license is required and missing', '  /formats must be array, not string']);
});

test('an error on the document itself is labelled, not printed as an empty path', () => {
  const [line] = formatSchemaErrors(validateAgainstSchema('not a descriptor', REAL_SCHEMA).errors).split('\n');
  assert.equal(line, '  (document) must be object, not string');
});
