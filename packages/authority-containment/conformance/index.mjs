// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The conformance suite for @noesar/authority-containment — the specification made
// executable. Mirrors packages/capability-token/conformance/index.mjs on purpose: same shape,
// same discipline, so a reader of one already knows how to read the other.
//
// Deliberately reads no separate vector copy: `loadCanonicalVectors()` reads the SAME live
// `conformance/capability-vectors.json` this repository's own JS and Rust minters already
// answer to, filtered to the five case ids SPEC.md names. See SPEC.md's own closing section
// for why a second copy is refused rather than merely avoided.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Case id -> the `SPEC.md` requirement it measures. Enforced in both directions by
 * `test/conformance.test.mjs`: a requirement no case measures, or a case naming a requirement
 * that does not exist, fails the package's own tests. */
export const REQUIREMENTS = Object.freeze({
  'CAP-001': 'AC-002',
  'CAP-002': 'AC-003',
  'CAP-005': 'AC-004',
  'CAP-011': 'AC-005',
  'CAP-012': 'AC-005',
});

export const CANONICAL_VECTORS_PATH = fileURLToPath(
  new URL('../../../conformance/capability-vectors.json', import.meta.url),
);

/**
 * Read the canonical, product-wide capability vectors and return only the five cases this
 * specification names — plus the shared `now`/`approval` context every case is checked
 * against. Throws loudly if any named id has gone missing, rather than silently running four
 * cases and reporting a green suite that checked less than it claims to.
 */
export function loadCanonicalVectors() {
  const data = JSON.parse(readFileSync(CANONICAL_VECTORS_PATH, 'utf8'));
  const ids = Object.keys(REQUIREMENTS);
  const byId = new Map(data.cases.map((entry) => [entry.id, entry]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(
      `conformance/capability-vectors.json no longer contains: ${missing.join(', ')} — ` +
      'this package specifies a property those cases measure and cannot verify without them',
    );
  }
  return {
    nowUnix: data.now,
    approval: data.approval,
    cases: ids.map((id) => byId.get(id)),
  };
}

/**
 * Run the suite against an implementation.
 *
 * @param {(vector: {id:string, steps:object[], request:object}, context: {nowUnix:number, approval:object}) => ({minted:boolean, kind?:string} | Promise<{minted:boolean, kind?:string}>)} attempt
 * @returns {Promise<{total:number, passed:number, failed:number, results:Array}>}
 */
export async function runConformance(attempt) {
  const results = [];
  const check = (id, requirement, condition, detail = '') => {
    results.push({ id, requirement, ok: Boolean(condition), detail: condition ? '' : detail });
  };
  const summarize = () => ({
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });

  // ── AC-001 · surface ──────────────────────────────────────────────────────────────────────
  check('surface:attempt', 'AC-001', typeof attempt === 'function', 'attempt must be a function');
  if (results.some((entry) => !entry.ok)) return summarize();

  const { nowUnix, approval, cases } = loadCanonicalVectors();
  const context = { nowUnix, approval };

  for (const vector of cases) {
    const requirement = REQUIREMENTS[vector.id];
    let got;
    try {
      got = await attempt({ id: vector.id, steps: vector.steps, request: vector.request }, context);
    } catch (error) {
      check(vector.id, requirement, false, `attempt() threw instead of returning a verdict: ${error.message}`);
      continue;
    }
    const expectedMinted = Boolean(vector.expected.minted);
    if (got?.minted !== expectedMinted) {
      check(vector.id, requirement, false,
        `expected minted=${expectedMinted}, got minted=${got?.minted} (${vector.why})`);
      continue;
    }
    if (!expectedMinted && vector.expected.kind && got.kind !== vector.expected.kind) {
      check(vector.id, requirement, false,
        `expected kind=${vector.expected.kind}, got kind=${got.kind} (${vector.why})`);
      continue;
    }
    check(vector.id, requirement, true);
  }

  return summarize();
}
