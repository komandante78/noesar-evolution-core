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
import { isAbsolute, normalize } from 'node:path';
import { assertUsable, canonicalLimits, exceedsCeiling, parseLimits, withinGrant } from './isolation.mjs';

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

  #ceiling;

  // `ceiling` (ARCH-008) is the installation's own limit envelope, normally what
  // `noesar-sandbox --detect` reports for this container. It is optional and defaults to
  // absent: a minter without one still mints, and `isolationStatus()` reports that no ceiling
  // is being enforced rather than implying one. Passing a ceiling is what makes "no token may
  // ask for more room than the container has" a check instead of a sentence in a document.
  constructor(secret, { ceiling = null } = {}) {
    if (!Buffer.isBuffer(secret) || secret.length < 32) {
      invalid('a capability signing secret must be at least 32 bytes');
    }
    this.#secret = secret;
    this.#ceiling = ceiling ? parseLimits(ceiling) : null;
  }

  ceiling() { return this.#ceiling; }

  #sign(token) {
    const mac = createHmac('sha256', this.#secret);
    feed(mac, token.id);
    feed(mac, token.planDigest);
    feed(mac, token.stepId);
    for (const path of token.paths) feed(mac, path);
    for (const operation of token.operations) feed(mac, operation.toLowerCase());
    feed(mac, String(token.expiresAtUnix));
    feed(mac, String(token.usesGranted));
    // ARCH-008: the limits are inside the MAC, not beside it. A token whose limits could be
    // edited in transit would carry a guarantee anyone could widen, which is worse than
    // carrying none — the sandbox would faithfully apply whatever it was handed and the audit
    // trail would record the tampered figure as enforced.
    //
    // `canonicalLimits` is fed as one fixed-order string, and rust/crates/noesar-capability
    // feeds the identical string: two implementations of one rule stop agreeing the moment
    // each formats it its own way.
    feed(mac, canonicalLimits(token.limits ?? null));
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
    // The flag above is a *declaration* made by whoever built the plan, and this engine is
    // handed plans over the wire. A step naming `../etc/passwd` while declaring
    // reachesOutsideWorkspace false would otherwise mint a token for it -- a verdict supplied
    // by the caller is not a verdict. The paths are inspected here too, whatever the flag says.
    for (const path of request.paths) {
      if (isAbsolute(path) || normalize(path).split(/[\\/]/).includes('..') || path.includes(':\\')) {
        outOfScope(`path \`${path}\` leaves the workspace, whatever the step declares`);
      }
    }
    if (request.expiresAtUnix <= nowUnix) {
      invalid('a token already expired at issue is a token nobody can use or audit');
    }
    // Revoking the approval must not leave live grants behind it.
    if (request.expiresAtUnix > authorized.approval.expiresAtUnix) {
      outOfScope('a capability may not outlive the approval it descends from');
    }

    // ARCH-008. Order matters here: shape first, then the granted scope, then the container's
    // own ceiling, then usability. Each refusal names what was wrong, because a refusal an
    // operator cannot locate is a refusal they will route around.
    const limits = parseLimits(request.limits ?? null);
    if (limits) {
      // The step's own declared envelope is the grant. `withinGrant` is strict — an unset
      // dimension counts as unlimited and so never satisfies a set grant, because asking for
      // "no cap" where the plan set one is widening.
      const granted = step.blastRadius?.limits ? parseLimits(step.blastRadius.limits) : null;
      if (!withinGrant(limits, granted)) {
        outOfScope(`the requested limits exceed what step \`${step.id}\` grants`);
      }
      // The container ceiling is the *other* relation: an unset dimension is inherited from
      // the container, not granted without limit. Using the strict one here would refuse every
      // ordinary request — a defect the Rust crate actually had, found by running it.
      const over = exceedsCeiling(limits, this.#ceiling);
      if (over) {
        outOfScope(`limit \`${over}\` is wider than this installation's own ceiling; a sandbox cannot grant more than the container it runs in`);
      }
      assertUsable(limits);
    } else if (request.operations.includes('EXECUTE') && this.#ceiling) {
      // EXECUTE is the one operation that starts a process, so it is the one that cannot be
      // granted without an envelope to run it in — but only once this installation can
      // actually apply one. The condition is `this.#ceiling`, i.e. enforcement is configured.
      //
      // Requiring limits unconditionally was tried and reverted in the same phase: it broke 11
      // tests across two designs that are both correct — `D-0244`'s adapter gate grants EXECUTE
      // to `local-model-runtime`, and the executor's contract tests mint an EXECUTE token
      // precisely to prove the executor refuses it. Neither is a defect. Demanding a limit
      // before anything enforces one would have recorded a figure nothing applied, which is the
      // ceremony this project treats as worse than an honest absence.
      outOfScope('an EXECUTE capability must carry its own limits on an installation that enforces them: without them the process would run with the whole container\'s');
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
      limits,
    };
    token.mac = this.#sign(token);
    // What the registry keeps beside the counter is exactly what a person needs to decide
    // whether to withdraw this grant: which step it descends from, what it may touch, and
    // when it lapses on its own. The MAC is deliberately NOT among them — the registry is
    // read by `grants()`, which feeds a screen, and a screen that printed the MAC would turn
    // a list of grants into a list of usable tokens.
    this.#issued.set(id, {
      usesRemaining: request.uses,
      stepId: token.stepId,
      planDigest: token.planDigest,
      paths: [...token.paths],
      operations: [...token.operations],
      expiresAtUnix: token.expiresAtUnix,
      usesGranted: token.usesGranted,
      issuedAtUnix: nowUnix,
    });
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
  //
  // The signature is deliberately unchanged (`D-0577`): this class mirrors
  // rust/crates/noesar-capability, whose `revoke(&mut self, token_id) -> bool` says the same
  // thing, and a return type that drifted on one side would be the first crack in "neither is
  // the oracle for the other". A caller that needs to know WHAT it withdrew reads `grant()`
  // first — see the route in server.mjs, which does exactly that so the ledger line names the
  // paths rather than an opaque id.
  revoke(tokenId) {
    return this.#issued.delete(tokenId);
  }

  /**
   * One live grant, described — or `null` if this engine holds none under that id. Never
   * returns the MAC: describing a grant must not be a way to obtain one.
   *
   * "Live" means unspent. An entry past its own `expiresAtUnix` is still returned, flagged,
   * because an operator asking what this engine is holding is owed the lapsed ones too: a
   * grant that expired on its own and a grant that was never issued are different facts, and
   * only one of them means someone should stop worrying about it.
   */
  grant(tokenId, nowUnix = null) {
    const state = this.#issued.get(String(tokenId ?? ''));
    if (!state || state.usesRemaining <= 0) return null;
    return {
      tokenId: String(tokenId),
      stepId: state.stepId,
      planDigest: state.planDigest,
      paths: [...(state.paths ?? [])],
      operations: [...(state.operations ?? [])],
      expiresAtUnix: state.expiresAtUnix,
      usesGranted: state.usesGranted,
      usesRemaining: state.usesRemaining,
      issuedAtUnix: state.issuedAtUnix,
      expired: nowUnix === null ? null : nowUnix >= state.expiresAtUnix,
    };
  }

  /**
   * Every live grant this engine is holding, newest last. This is what makes revocation an act
   * a person can perform rather than an id they must already know: before this existed, the
   * only way to name a token was to have kept the mint response or to go read the ledger.
   */
  grants(nowUnix = null) {
    const listed = [];
    for (const id of this.#issued.keys()) {
      const grant = this.grant(id, nowUnix);
      if (grant) listed.push(grant);
    }
    return listed;
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
    // The executor exists and refuses every action without a token (step 5). D-0190/D-0191
    // wired the first product surface to it — see workspace-actions.mjs — so this is no
    // longer aspirational. It is still narrow: WRITE only, one step, one risk path (the
    // trivial path of 11_REVISIONE_E_CORREZIONI.md P6). Stated at that width, not rounded up.
    executorImplemented: true,
    executorEnforcesTokens: true,
    executorWiredToProductActions: true,
    // `D-0577`. Stated as a flag and not only in the prose below, because this is the fact a
    // shell decides what to render from: until this phase `revoke()` had no caller at all, and
    // an authority that cannot be withdrawn is an authority nobody can correct. `false` here
    // would be an honest answer on an installation that ever removed the route; it is not a
    // constant dressed up as a measurement.
    revocationReachable: true,
    reason: 'Tokens are minted only from a plan a person approved, are bound to one step, and cannot name a path that step does not. /api/v1/workspace-actions spends them through the executor to write real files in the workspace, promoted only when the shadow comparison came back clean. DELETE remains unwired. EXECUTE is wired and is a per-installation choice (ARCH-008, D-0250/D-0253): where it is enabled, a plan-declared command is granted only on the measurement token, carries its own isolation envelope inside the MAC, and runs against the shadow — never against the workspace, and never on the token that promotes into it. A live grant can be listed and withdrawn before it lapses, from either shell, and the withdrawal is a ledger line naming what it covered.',
  };
}
