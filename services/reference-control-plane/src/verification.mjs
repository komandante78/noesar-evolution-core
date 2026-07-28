// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The recompute verifier · CodeN Evolution construction order, step 9
// (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §3.IV) — the next real step after the
// eight the backbone (Fase 1) already built, per that document's own dependency order.
//
// "L'oracolo è il test unitario, e basta. È debole." The three layers that document names:
//
//   1. Decompose until a claim is recomputable, not merely plausible-looking.
//   2. Metamorphic relations / properties derived from the code, not the prompt.
//   3. Declared projection coverage: what fraction of a change's claims were actually
//      recomputed, and which were not, WITH THE REASON — never omitted, never rounded up.
//
// This module builds layers 1 and 3 for the claim shapes that are honestly recomputable
// WITHOUT running anything: a claim about a file's resulting content, existence, hash, or
// a JSON field, checked by reading the file the shadow already produced (shadow.mjs's
// ShadowWorkspace, D-0175-ish) and comparing directly -- no shell, no test runner. Layer 2
// (metamorphic relations) is not attempted here: it needs code-derived properties per
// language, a larger undertaking named as future work, not faked with one generic check.
//
// What this deliberately does NOT do, named rather than discovered later: verify a claim
// about program BEHAVIOUR (e.g. "function f now returns 4 for input 2") -- that requires
// executing code, and EXECUTE stays permanently refused (executor.mjs, workspace-actions.mjs
// module comment). A behavioural claim is reported UNRECOMPUTED with that reason, not
// silently skipped and not faked by pattern-matching source text.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { contained } from './shadow.mjs';

export class VerificationError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'VerificationError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new VerificationError(kind, reason); };

function readShadowFile(shadowRoot, path) {
  let resolved;
  try {
    resolved = contained(shadowRoot, path);
  } catch (error) {
    return { ok:false, reason: error.reason ?? String(error.message ?? error) };
  }
  try {
    return { ok:true, content: readFileSync(resolved, 'utf8') };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok:true, content: null };
    return { ok:false, reason: String(error.message ?? error) };
  }
}

function getJsonPath(value, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), value);
}

// Each verifier recomputes independently from the shadow's file content and returns
// { recomputed, matches, reason }. `recomputed:false` is a declared gap, never a silent one.
const CLAIM_VERIFIERS = Object.freeze({
  file_exists: (claim, shadowRoot) => {
    const read = readShadowFile(shadowRoot, claim.path);
    if (!read.ok) return { recomputed:false, matches:false, reason:read.reason };
    return { recomputed:true, matches: read.content !== null, reason:null };
  },
  file_absent: (claim, shadowRoot) => {
    const read = readShadowFile(shadowRoot, claim.path);
    if (!read.ok) return { recomputed:false, matches:false, reason:read.reason };
    return { recomputed:true, matches: read.content === null, reason:null };
  },
  file_equals: (claim, shadowRoot) => {
    const read = readShadowFile(shadowRoot, claim.path);
    if (!read.ok) return { recomputed:false, matches:false, reason:read.reason };
    if (read.content === null) return { recomputed:true, matches:false, reason:'file does not exist' };
    return { recomputed:true, matches: read.content === claim.value, reason:null };
  },
  file_contains: (claim, shadowRoot) => {
    const read = readShadowFile(shadowRoot, claim.path);
    if (!read.ok) return { recomputed:false, matches:false, reason:read.reason };
    if (read.content === null) return { recomputed:true, matches:false, reason:'file does not exist' };
    return { recomputed:true, matches: read.content.includes(claim.value), reason:null };
  },
  file_hash_equals: (claim, shadowRoot) => {
    const read = readShadowFile(shadowRoot, claim.path);
    if (!read.ok) return { recomputed:false, matches:false, reason:read.reason };
    if (read.content === null) return { recomputed:true, matches:false, reason:'file does not exist' };
    const digest = createHash('sha256').update(read.content).digest('hex');
    return { recomputed:true, matches: digest === claim.value, reason: digest === claim.value ? null : `recomputed sha256 is ${digest}` };
  },
  json_field_equals: (claim, shadowRoot) => {
    const read = readShadowFile(shadowRoot, claim.path);
    if (!read.ok) return { recomputed:false, matches:false, reason:read.reason };
    if (read.content === null) return { recomputed:true, matches:false, reason:'file does not exist' };
    let parsed;
    try { parsed = JSON.parse(read.content); } catch { return { recomputed:false, matches:false, reason:'file is not valid JSON' }; }
    const actual = getJsonPath(parsed, claim.field);
    return { recomputed:true, matches: actual === claim.value, reason: actual === claim.value ? null : `recomputed field is ${JSON.stringify(actual)}` };
  },
  behavioural: () => ({
    recomputed:false, matches:false,
    reason:'behavioural claims require executing code; EXECUTE is permanently refused (executor.mjs) — declared unrecomputed by design, not silently skipped',
  }),
});

export const SUPPORTED_CLAIM_TYPES = Object.freeze(Object.keys(CLAIM_VERIFIERS).filter((t) => t !== 'behavioural'));

/**
 * Recomputes every claim against `shadowRoot` (the shadow's post-execution state --
 * callers pass `shadow.root` from a ShadowWorkspace after execute() has run, never the
 * live workspace). One result per claim, in the same order given. An unknown claim
 * `type` is `recomputed:false` with the type named, not thrown -- one bad claim in a
 * batch should not hide the results of the others.
 */
export function verifyClaims(claims, shadowRoot) {
  if (!Array.isArray(claims)) refuse('INVALID_CLAIMS', 'claims must be an array');
  return claims.map((claim) => {
    if (!claim || typeof claim.type !== 'string') {
      return { claim, recomputed:false, matches:false, reason:'claim has no `type`' };
    }
    const verifier = CLAIM_VERIFIERS[claim.type];
    if (!verifier) {
      return { claim, recomputed:false, matches:false, reason:`unsupported claim type "${claim.type}" — supported: ${SUPPORTED_CLAIM_TYPES.join(', ')}, plus "behavioural" (always declared unrecomputed)` };
    }
    const { recomputed, matches, reason } = verifier(claim, shadowRoot);
    return { claim, recomputed, matches, reason };
  });
}

/**
 * CE-009's rule made mechanical: coverage is a fraction PLUS the list of what was not
 * recomputed and why. `complete` is only ever true when every claim was both recomputed
 * and matched -- there is no path that rounds a partial result up.
 */
export function projectionCoverage(results) {
  const total = results.length;
  const recomputed = results.filter((r) => r.recomputed).length;
  const matched = results.filter((r) => r.recomputed && r.matches).length;
  const contradicted = results.filter((r) => r.recomputed && !r.matches);
  const unrecomputed = results.filter((r) => !r.recomputed);
  return {
    total,
    recomputed,
    matched,
    contradicted: contradicted.map((r) => ({ claim:r.claim, reason:r.reason })),
    unrecomputed: unrecomputed.map((r) => ({ claim:r.claim, reason:r.reason })),
    coverageFraction: total === 0 ? null : recomputed / total,
    complete: total > 0 && recomputed === total && matched === total,
    declaration: total === 0
      ? 'no claims were declared for this change'
      : `${recomputed}/${total} claims recomputed, ${matched}/${total} matched`
        + (contradicted.length > 0 ? ` — ${contradicted.length} CONTRADICTED` : '')
        + (unrecomputed.length > 0 ? ` — ${unrecomputed.length} not recomputed (see unrecomputed[])` : ''),
  };
}

export function verificationStatus() {
  return {
    supportedClaimTypes: SUPPORTED_CLAIM_TYPES,
    behaviouralClaimsRecomputable: false,
    behaviouralClaimsReason: 'EXECUTE is permanently refused; a behavioural claim is always reported unrecomputed, by design.',
    metamorphicRelations: false,
    metamorphicRelationsReason: 'Not built. 15_CODEN_EVOLUTION_DA_ZERO.md §3.IV names code-derived metamorphic relations as a second layer beyond direct recomputation — this module is the first layer only.',
    coverageNeverRoundedToComplete: true,
    reason: 'Recomputes file-shaped claims (existence, content, hash, JSON field) directly against a shadow\'s post-execution state — no test execution. Declares projection coverage per CE-009: what fraction was recomputed, and names every claim that was not, with the reason.',
  };
}
