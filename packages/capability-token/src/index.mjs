// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The capability token wire format — extracted, not copied. This is the byte-level contract
// two independent implementations (rust/crates/noesar-capability and
// services/reference-control-plane/src/capability.mjs) already agree on today, made portable
// and specified so a third implementation can hold itself to the same bytes.
//
// What this package IS: canonical field encoding, the MAC pre-image sequence, the canonical
// limits string, and constant-time verification. What it is NOT: the authorization policy
// (which plan a token may descend from, which paths a step grants, destructive-operation
// gating, approval lifecycle). That policy is product-specific and deliberately stays where
// it is — see README.md "What this deliberately does not do".
//
// Zero dependencies. No clock, no filesystem, no network — every function is pure.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const CONTRACT_VERSION = '1.0.0';

/** Fixed order — part of the wire contract, not a presentation choice. Reordering invalidates
 * every token signed under the old order. Matches `LIMIT_DIMENSIONS` in
 * services/reference-control-plane/src/isolation.mjs and the field order hardcoded into the
 * format string in rust/crates/noesar-capability's `canonical_limits`. */
export const LIMIT_DIMENSIONS = Object.freeze([
  'memoryBytes',
  'cpuSeconds',
  'openFiles',
  'processes',
  'fileSizeBytes',
  'coreDumpBytes',
]);

export const OPERATIONS = Object.freeze(['READ', 'WRITE', 'DELETE', 'EXECUTE']);

export const TokenFormatError = Object.freeze({
  SECRET_TOO_SHORT: 'SECRET_TOO_SHORT',
  UNKNOWN_LIMIT_DIMENSION: 'UNKNOWN_LIMIT_DIMENSION',
  INVALID_LIMIT_VALUE: 'INVALID_LIMIT_VALUE',
  UNKNOWN_OPERATION: 'UNKNOWN_OPERATION',
});

export class CapabilityTokenFormatError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'CapabilityTokenFormatError';
    this.kind = kind;
  }
}

const fail = (kind, reason) => { throw new CapabilityTokenFormatError(kind, reason); };

/** One length-delimited field into a running hash/MAC. The 8-byte little-endian length
 * prefix is what makes concatenation unambiguous: without it, `feed("ab"); feed("c")` and
 * `feed("a"); feed("bc")` would hash identically. Matches `feed()` in capability.mjs
 * byte-for-byte, and Rust's `value.len().to_le_bytes()` (a `usize` on a 64-bit target is 8
 * bytes, the same width). */
export function feedField(mac, value) {
  const text = String(value);
  const bytes = Buffer.from(text, 'utf8');
  mac.update(bytes);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(bytes.length));
  mac.update(length);
}

/** Validate a limits object and return a frozen, normalised copy, or `null` for "no envelope".
 * Every dimension is a non-negative safe integer or absent — never coerced, per
 * isolation.mjs's own rule: a float or a negative number means the caller built this by hand,
 * and guessing the intent of a *limit* is how one ends up larger than meant. */
export function parseLimits(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(TokenFormatError.INVALID_LIMIT_VALUE, 'limits must be an object naming byte and second counts');
  }
  for (const key of Object.keys(raw)) {
    if (!LIMIT_DIMENSIONS.includes(key)) {
      fail(TokenFormatError.UNKNOWN_LIMIT_DIMENSION, `unknown limit \`${key}\``);
    }
  }
  const limits = {};
  for (const dimension of LIMIT_DIMENSIONS) {
    const value = raw[dimension];
    if (value === undefined || value === null) { limits[dimension] = null; continue; }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
      fail(TokenFormatError.INVALID_LIMIT_VALUE, `limit \`${dimension}\` must be a non-negative safe integer, got \`${String(value)}\``);
    }
    limits[dimension] = value;
  }
  return Object.freeze(limits);
}

/** The canonical string the MAC covers. `-` for an unconstrained dimension so "unset" and
 * "zero" never collide: `coreDumpBytes: 0` is a real, very restrictive limit. `none` when no
 * envelope was granted at all. Byte-identical to `canonicalLimits` in isolation.mjs and to
 * `canonical_limits` in rust/crates/noesar-capability/src/lib.rs — pinned there by
 * `canonical_limits_matches_the_javascript_minter_byte_for_byte`. */
export function canonicalLimits(limits) {
  if (!limits) return 'none';
  return LIMIT_DIMENSIONS
    .map((dimension) => `${dimension}=${limits[dimension] === null || limits[dimension] === undefined ? '-' : limits[dimension]}`)
    .join(';');
}

/** The exact MAC pre-image sequence, in order. This is the normative core (`CT-004`): two
 * implementations that feed these fields in this order under HMAC-SHA256 produce the same MAC
 * for the same token and secret, and neither has to read the other's source to do it. */
function feedToken(mac, token) {
  feedField(mac, token.id);
  feedField(mac, token.planDigest);
  feedField(mac, token.stepId);
  for (const path of token.paths) feedField(mac, path);
  for (const operation of token.operations) {
    if (!OPERATIONS.includes(operation)) {
      fail(TokenFormatError.UNKNOWN_OPERATION, `unknown operation \`${operation}\``);
    }
    feedField(mac, operation.toLowerCase());
  }
  feedField(mac, String(token.expiresAtUnix));
  feedField(mac, String(token.usesGranted));
  feedField(mac, canonicalLimits(token.limits ?? null));
}

function requireSecret(secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    fail(TokenFormatError.SECRET_TOO_SHORT, 'a capability signing secret must be at least 32 bytes');
  }
}

/** Sign a token's fields under a secret. Returns the MAC as lowercase hex. Does not touch
 * `token.mac` — the caller decides where the returned value goes, matching the pattern the
 * two extracted-from implementations use: sign, then attach. */
export function sign(token, secret) {
  requireSecret(secret);
  const mac = createHmac('sha256', secret);
  feedToken(mac, token);
  return mac.digest('hex');
}

/** Verify a token's `mac` field against a secret, in constant time. Returns `true`/`false` —
 * never throws for a mismatch, only for a malformed secret or an unknown operation, both
 * programmer errors. A single mutated byte anywhere in the signed fields — a widened path, an
 * extended expiry, a raised limit — produces a MAC that does not verify: that is the entire
 * guarantee this package exists to make checkable outside this repository. */
export function verify(token, secret) {
  requireSecret(secret);
  const expected = Buffer.from(sign(token, secret), 'utf8');
  const supplied = Buffer.from(String(token.mac ?? ''), 'utf8');
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}
