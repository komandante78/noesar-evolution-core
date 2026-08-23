// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The conformance suite for @noesar/capability-token — the specification made executable.
// Mirrors packages/verified-acquisition/conformance/index.mjs on purpose: same shape, same
// discipline, so a reader of one already knows how to read the other.
//
// It imports no test runner and injects nothing that needs a network, a clock or a filesystem
// beyond the vectors it reads once at import time. `runConformance()` returns a plain object.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Case family -> the `SPEC.md` requirement it measures. Enforced in both directions by
 * `test/conformance.test.mjs`: a requirement no case measures, or a case naming a requirement
 * that does not exist, fails the package's own tests. */
export const REQUIREMENTS = Object.freeze({
  surface: 'CT-001',
  encoding: 'CT-002',
  canonicalLimits: 'CT-003',
  mac: 'CT-004',
  secret: 'CT-005',
  tamper: 'CT-006',
  nongoals: 'CT-007',
});

const VECTORS = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
export const vectors = VECTORS;
export const vectorsPath = fileURLToPath(new URL('./vectors.json', import.meta.url));

/**
 * Run the suite against an implementation.
 *
 * @param {object} implementation  the module's public surface: `sign`, `verify`,
 *                                 `canonicalLimits`, `parseLimits`, `feedField`,
 *                                 `LIMIT_DIMENSIONS`, `OPERATIONS`, `CONTRACT_VERSION`
 * @returns {Promise<{total:number,passed:number,failed:number,results:Array}>}
 */
export async function runConformance(implementation) {
  const results = [];
  const check = (id, condition, detail = '') => {
    const family = String(id).split(':')[0];
    const requirement = REQUIREMENTS[family] ?? null;
    if (!requirement) {
      results.push({ id, requirement: null, ok: false, detail: `case family "${family}" maps to no requirement in SPEC.md` });
      return;
    }
    results.push({ id, requirement, ok: Boolean(condition), detail: condition ? '' : detail });
  };
  const summarize = () => ({
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });

  const { sign, verify, canonicalLimits, feedField, LIMIT_DIMENSIONS, OPERATIONS } = implementation ?? {};

  // ── CT-001 · surface ─────────────────────────────────────────────────────────────────────
  // `parseLimits` is deliberately not required here — see SPEC.md CT-001: it validates
  // untrusted input, which is a convenience, not part of the pre-image contract itself.
  for (const name of ['sign', 'verify', 'canonicalLimits', 'feedField']) {
    check(`surface:${name}`, typeof implementation?.[name] === 'function', `${name} is not a function`);
  }
  check('surface:LIMIT_DIMENSIONS', Array.isArray(LIMIT_DIMENSIONS) && LIMIT_DIMENSIONS.length === 6,
    'LIMIT_DIMENSIONS must be the 6 fixed dimensions');
  check('surface:OPERATIONS', Array.isArray(OPERATIONS) && OPERATIONS.length === 4,
    'OPERATIONS must be the 4 fixed operations');
  if (results.some((entry) => !entry.ok)) return summarize();

  // ── CT-002 · canonical field encoding ────────────────────────────────────────────────────
  // The collision this length prefix exists to prevent: two different splits of the same
  // concatenated text must never feed identically. Measured on the actual digest, not on the
  // implementation's internal state, so any correct 8-byte-length-prefix scheme passes and any
  // ambiguous one (e.g. a separator character that could appear in the data) fails.
  {
    const digestOf = (parts) => {
      const mac = createHmac('sha256', Buffer.alloc(32, 1));
      for (const part of parts) feedField(mac, part);
      return mac.digest('hex');
    };
    const split1 = digestOf(['ab', 'c']);
    const split2 = digestOf(['a', 'bc']);
    check('encoding:no-ambiguous-concatenation', split1 !== split2,
      'feedField("ab")+feedField("c") must not equal feedField("a")+feedField("bc")');
    const repeat1 = digestOf(['x']);
    const repeat2 = digestOf(['x']);
    check('encoding:deterministic', repeat1 === repeat2, 'feedField must be deterministic for the same input');
  }

  // ── CT-003 · canonical limits string ─────────────────────────────────────────────────────
  for (const vector of VECTORS.canonicalLimits) {
    const got = canonicalLimits(vector.limits);
    check(`canonicalLimits:${vector.id}`, got === vector.expected,
      `expected ${JSON.stringify(vector.expected)}, got ${JSON.stringify(got)}`);
  }

  // ── CT-004 · the mac pre-image, measured against tokens minted by the real product ──────
  for (const vector of VECTORS.mac) {
    const secret = Buffer.from(vector.secretHex, 'hex');
    let got;
    try {
      got = sign(vector.token, secret);
    } catch (error) {
      check(`mac:${vector.id}`, false, `sign threw: ${error.message}`);
      continue;
    }
    check(`mac:${vector.id}`, got === vector.expectedMacHex,
      `expected ${vector.expectedMacHex}, got ${got}`);
  }

  // ── CT-005 · secret length is enforced at both sign and verify ──────────────────────────
  {
    const shortSecret = Buffer.alloc(31, 1);
    const token = VECTORS.mac[0].token;
    let signRefused = false;
    try { sign(token, shortSecret); } catch { signRefused = true; }
    check('secret:sign-refuses-short-secret', signRefused, 'sign() must reject a secret shorter than 32 bytes');
    let verifyRefused = false;
    try { verify({ ...token, mac: 'x' }, shortSecret); } catch { verifyRefused = true; }
    check('secret:verify-refuses-short-secret', verifyRefused, 'verify() must reject a secret shorter than 32 bytes');
  }

  // ── CT-006 · tamper-evidence ─────────────────────────────────────────────────────────────
  for (const vector of VECTORS.tamper) {
    const secret = Buffer.from(vector.secretHex, 'hex');
    let ok;
    try {
      ok = verify(vector.mutatedToken, secret);
    } catch (error) {
      check(`tamper:${vector.id}`, false, `verify threw instead of returning false: ${error.message}`);
      continue;
    }
    check(`tamper:${vector.id}`, ok === vector.expectVerify,
      `expected verify()=${vector.expectVerify}, got ${ok}`);
  }
  // The positive control this project has learned to demand: the untampered token from the
  // same family must still verify, or the tamper cases above would be passing vacuously
  // against an implementation whose verify() always returns false.
  {
    const base = VECTORS.tamper[0].signedToken;
    const secret = Buffer.from(VECTORS.tamper[0].secretHex, 'hex');
    check('tamper:positive-control', verify(base, secret) === true,
      'the untampered token must still verify — otherwise every tamper case above is vacuous');
  }

  // ── CT-007 · the authorization policy is not part of this surface ──────────────────────
  // This is the boundary the package's own README states in prose; here it is a check. A
  // reference encoder/decoder that also exported minting policy would silently widen what a
  // third-party implementer is asked to reproduce.
  for (const name of ['mint', 'TokenMinter', 'authorizePlan', 'spend', 'revoke']) {
    check(`nongoals:${name}`, implementation?.[name] === undefined,
      `${name} must not be part of this package's surface — it is product-specific authorization policy`);
  }

  return summarize();
}
