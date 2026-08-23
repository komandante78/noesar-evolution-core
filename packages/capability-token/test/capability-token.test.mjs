// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit-level tests of the reference implementation's own behaviour, distinct from the
// conformance suite: these pin implementation details (error kinds, parseLimits validation)
// that CT-001..CT-007 do not require of every implementation, so they belong here and not in
// conformance/index.mjs.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  sign, verify, canonicalLimits, parseLimits, feedField,
  CapabilityTokenFormatError, TokenFormatError, CONTRACT_VERSION,
  LIMIT_DIMENSIONS, OPERATIONS,
} from '../src/index.mjs';

const secret = Buffer.alloc(32, 3);
const baseToken = () => ({
  id: 'tok-1',
  planDigest: 'digest-1',
  stepId: 'step-a',
  paths: ['src/a.rs'],
  operations: ['WRITE'],
  expiresAtUnix: 1_800_000_600,
  usesGranted: 1,
  limits: null,
});

describe('CONTRACT_VERSION and frozen constants', () => {
  test('CONTRACT_VERSION is a semver-shaped string', () => {
    assert.match(CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
  });

  test('LIMIT_DIMENSIONS and OPERATIONS are frozen', () => {
    assert.ok(Object.isFrozen(LIMIT_DIMENSIONS));
    assert.ok(Object.isFrozen(OPERATIONS));
    assert.equal(LIMIT_DIMENSIONS.length, 6);
    assert.equal(OPERATIONS.length, 4);
  });
});

describe('sign() / verify() round-trip', () => {
  test('a token signed with a secret verifies against the same secret', () => {
    const token = baseToken();
    token.mac = sign(token, secret);
    assert.equal(verify(token, secret), true);
  });

  test('sign() is deterministic for the same fields and secret', () => {
    const token = baseToken();
    assert.equal(sign(token, secret), sign(token, secret));
  });

  test('two tokens differing only in path order sign differently', () => {
    const a = { ...baseToken(), paths: ['src/a.rs', 'src/b.rs'] };
    const b = { ...baseToken(), paths: ['src/b.rs', 'src/a.rs'] };
    assert.notEqual(sign(a, secret), sign(b, secret));
  });

  test('a secret shorter than 32 bytes is refused, not silently accepted', () => {
    assert.throws(() => sign(baseToken(), Buffer.alloc(31, 1)), CapabilityTokenFormatError);
    assert.throws(() => verify({ ...baseToken(), mac: 'x' }, Buffer.alloc(31, 1)), CapabilityTokenFormatError);
    try {
      sign(baseToken(), Buffer.alloc(31, 1));
      assert.fail('expected a throw');
    } catch (error) {
      assert.equal(error.kind, TokenFormatError.SECRET_TOO_SHORT);
    }
  });

  test('an unknown operation is refused rather than silently signed', () => {
    const token = { ...baseToken(), operations: ['DESTROY'] };
    assert.throws(() => sign(token, secret), CapabilityTokenFormatError);
  });

  test('verify() returns false, never throws, for a mismatched mac', () => {
    const token = { ...baseToken(), mac: 'not-a-real-mac' };
    assert.equal(verify(token, secret), false);
  });
});

describe('parseLimits()', () => {
  test('null and undefined both mean no envelope', () => {
    assert.equal(parseLimits(null), null);
    assert.equal(parseLimits(undefined), null);
  });

  test('an unknown dimension is refused', () => {
    assert.throws(() => parseLimits({ notADimension: 1 }), CapabilityTokenFormatError);
  });

  test('a negative, float, or unsafe-integer value is refused', () => {
    assert.throws(() => parseLimits({ memoryBytes: -1 }));
    assert.throws(() => parseLimits({ memoryBytes: 1.5 }));
    assert.throws(() => parseLimits({ memoryBytes: Number.MAX_SAFE_INTEGER + 1 }));
  });

  test('a valid partial envelope normalises absent dimensions to null', () => {
    const parsed = parseLimits({ memoryBytes: 1024 });
    assert.equal(parsed.memoryBytes, 1024);
    assert.equal(parsed.cpuSeconds, null);
    assert.ok(Object.isFrozen(parsed));
  });
});

describe('canonicalLimits()', () => {
  test('null renders as the literal string "none"', () => {
    assert.equal(canonicalLimits(null), 'none');
  });

  test('coreDumpBytes: 0 and an unset coreDumpBytes render differently', () => {
    const zero = canonicalLimits({ coreDumpBytes: 0 });
    const unset = canonicalLimits({});
    assert.notEqual(zero, unset);
    assert.match(zero, /coreDumpBytes=0/);
    assert.match(unset, /coreDumpBytes=-/);
  });

  test('dimensions render in the fixed order regardless of input key order', () => {
    const a = canonicalLimits({ coreDumpBytes: 1, memoryBytes: 2 });
    const b = canonicalLimits({ memoryBytes: 2, coreDumpBytes: 1 });
    assert.equal(a, b);
    assert.equal(a.indexOf('memoryBytes'), 0);
  });
});

describe('feedField()', () => {
  test('feeding an empty string still advances the hash (an 8-byte zero length)', () => {
    const macA = createHmac('sha256', secret);
    feedField(macA, '');
    const macB = createHmac('sha256', secret);
    // nothing fed to macB at all — an empty-string feed must still change the digest, because
    // the length prefix (eight zero bytes) is itself part of the pre-image.
    assert.notEqual(macA.digest('hex'), macB.digest('hex'));
  });

  test('feeding "ab" then "c" differs from feeding "a" then "bc" — CT-002\'s reason to exist', () => {
    const macA = createHmac('sha256', secret);
    feedField(macA, 'ab');
    feedField(macA, 'c');
    const macB = createHmac('sha256', secret);
    feedField(macB, 'a');
    feedField(macB, 'bc');
    assert.notEqual(macA.digest('hex'), macB.digest('hex'));
  });
});
