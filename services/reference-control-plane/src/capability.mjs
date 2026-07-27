// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Capability tokens in the runtime that ships. Mirrors rust/crates/noesar-capability, and
// both sides answer to conformance/capability-vectors.json — neither is the oracle for the
// other.
//
// 03_ARCHITETTURA section 4: no adapter may grant itself a permission; a manifest is a
// request; the engine issues the tokens. Here that means a request object has no method
// that yields a token, and mint() refuses anything that is not an authorised plan.
//
// The registry lives in memory. A restart therefore invalidates every outstanding token,
// which is stated rather than discovered: it is the safe direction — a token that outlived
// the engine that issued it would be a grant nobody is holding the ledger for.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const OPERATIONS = Object.freeze(['READ', 'WRITE', 'DELETE', 'EXECUTE']);
const DESTRUCTIVE = Object.freeze(['DELETE', 'EXECUTE']);

export class CapabilityError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'CapabilityError';
    this.kind = kind;
    this.reason = reason;
  }
}

const notAuthorized = (reason) => { throw new CapabilityError('NOT_AUTHORIZED', reason); };
const outOfScope = (reason) => { throw new CapabilityError('OUT_OF_SCOPE', reason); };
const refused = (reason) => { throw new CapabilityError('REFUSED', reason); };
const invalid = (reason) => { throw new CapabilityError('INVALID', reason); };

function feed(hash, value) {
  const text = String(value);
  hash.update(text, 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(Buffer.byteLength(text, 'utf8')));
  hash.update(length);
}

export function planDigest(plan) {
  const hash = createHash('sha256');
  feed(hash, plan.mode);
  for (const constraint of plan.constraints ?? []) feed(hash, constraint);
  for (const step of plan.steps) {
    feed(hash, step.id);
    feed(hash, step.description);
    for (const file of step.files ?? []) feed(hash, file);
    for (const command of step.commands ?? []) feed(hash, command);
    for (const dependency of step.dependsOn ?? []) feed(hash, dependency);
    feed(hash, step.blastRadius.destructive ? 'destructive' : 'non-destructive');
  }
  return hash.digest('hex');
}

// The only route from a plan to permission to act on it.
export function authorizePlan(plan, approval, nowUnix) {
  if (!String(approval?.approverId ?? '').trim()) {
    notAuthorized('an approval with no approver names nobody accountable');
  }
  if (!(approval.expiresAtUnix > approval.grantedAtUnix)) {
    notAuthorized('an approval that expires before it is granted authorises nothing');
  }
  if (nowUnix >= approval.expiresAtUnix) notAuthorized('the approval has lapsed');
  return { plan, approval, digest: planDigest(plan) };
}

export class TokenMinter {
  #secret;
  #issued = new Map();
  #counter = 0;

  constructor(secret) {
    if (!Buffer.isBuffer(secret) || secret.length < 32) {
      invalid('a capability signing secret must be at least 32 bytes');
    }
    this.#secret = secret;
  }

  #sign(token) {
    const mac = createHmac('sha256', this.#secret);
    feed(mac, token.id);
    feed(mac, token.planDigest);
    feed(mac, token.stepId);
    for (const path of token.paths) feed(mac, path);
    for (const operation of token.operations) feed(mac, operation.toLowerCase());
    feed(mac, String(token.expiresAtUnix));
    feed(mac, String(token.usesGranted));
    return mac.digest('hex');
  }

  mint(authorized, request, nowUnix) {
    const step = authorized.plan.steps.find((candidate) => candidate.id === request.stepId);
    if (!step) outOfScope(`step \`${request.stepId}\` is not in the approved plan`);
    if (!request.paths?.length || !request.operations?.length) {
      invalid('a capability granting no path or no operation is not a capability');
    }
    if (!(request.uses > 0)) {
      invalid('a token that can never be spent is a token that should not be issued');
    }
    for (const operation of request.operations) {
      if (!OPERATIONS.includes(operation)) invalid(`unknown operation \`${operation}\``);
    }
    // Widening is the whole attack: the step's own files are the ceiling.
    for (const path of request.paths) {
      if (!step.files.includes(path)) {
        outOfScope(`path \`${path}\` is not among the files of step \`${step.id}\``);
      }
    }
    if (!step.blastRadius.destructive
      && request.operations.some((operation) => DESTRUCTIVE.includes(operation))) {
      outOfScope(`step \`${step.id}\` is not declared destructive and cannot grant delete or execute`);
    }
    if (step.blastRadius.reachesOutsideWorkspace) {
      outOfScope(`step \`${step.id}\` reaches outside the workspace`);
    }
    if (request.expiresAtUnix <= nowUnix) {
      invalid('a token already expired at issue is a token nobody can use or audit');
    }
    // Revoking the approval must not leave live grants behind it.
    if (request.expiresAtUnix > authorized.approval.expiresAtUnix) {
      outOfScope('a capability may not outlive the approval it descends from');
    }

    this.#counter += 1;
    const id = createHash('sha256')
      .update(authorized.digest)
      .update(request.stepId)
      .update(String(this.#counter))
      .digest('hex')
      .slice(0, 32);
    const token = {
      id,
      planDigest: authorized.digest,
      stepId: request.stepId,
      paths: [...request.paths],
      operations: [...request.operations],
      expiresAtUnix: request.expiresAtUnix,
      usesGranted: request.uses,
    };
    token.mac = this.#sign(token);
    this.#issued.set(id, { usesRemaining: request.uses });
    return token;
  }

  spend(token, attempt, nowUnix) {
    const expected = Buffer.from(this.#sign(token), 'utf8');
    const supplied = Buffer.from(String(token.mac ?? ''), 'utf8');
    // Length first, because timingSafeEqual throws on a mismatch and the throw would itself
    // be the signal. Constant time after that.
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      refused('the token does not verify against this engine');
    }
    const state = this.#issued.get(token.id);
    if (!state) refused('this engine did not issue that token');
    if (nowUnix >= token.expiresAtUnix) refused('the token has expired');
    if (state.usesRemaining === 0) refused('the token is spent');
    if (!token.paths.includes(attempt.path)) {
      refused(`path \`${attempt.path}\` is not granted by this token`);
    }
    if (!token.operations.includes(attempt.operation)) {
      refused(`operation \`${attempt.operation}\` is not granted by this token`);
    }
    this.#issued.set(token.id, { usesRemaining: state.usesRemaining - 1 });
    return { spent: true, usesRemaining: state.usesRemaining - 1 };
  }

  // Revocation is a first-class act, not the absence of a renewal.
  revoke(tokenId) {
    return this.#issued.delete(tokenId);
  }

  outstanding() {
    let count = 0;
    for (const state of this.#issued.values()) if (state.usesRemaining > 0) count += 1;
    return count;
  }
}

export function capabilityStatus(minter) {
  return {
    enforcedBy: 'engine',
    adaptersMaySelfGrant: false,
    operations: [...OPERATIONS],
    destructiveOperations: [...DESTRUCTIVE],
    outstandingTokens: minter.outstanding(),
    // Said, not left to be discovered.
    registryPersistsAcrossRestart: false,
    executorEnforcesTokens: false,
    reason: 'Tokens are minted only from a plan a person approved, are bound to one step, and cannot name a path that step does not. The executor that accepts nothing but a token is not built yet, so nothing is executed through them.',
  };
}
