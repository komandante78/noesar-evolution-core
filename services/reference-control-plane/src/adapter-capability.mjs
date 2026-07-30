// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-005 (03_ARCHITETTURA.md §4): "no adapter may grant itself a permission — a manifest
// is a request, the engine issues the tokens." This module is the seam for adapters the
// same way workspace-actions.mjs is the seam for file writes: it owns no security decision
// that capability.mjs does not already make, and it mints through the SAME TokenMinter
// instance workspace-actions.mjs spends — a second engine here would be exactly the
// "twelve concepts, twice" 03_ARCHITETTURA.md §3 rejects.
//
// ADAPTER_MANIFESTS below is the manifest 03_ARCHITETTURA §4 means: a fixed list of which
// resources exist and which operations each one may ever ASK for. Asking for an operation
// outside its own manifest is refused before any human is even asked to approve it — the
// manifest widens nothing, it only bounds what a request can be about.
//
// What this does not do: it does not decide WHETHER to grant. authorizePlan()/mint() in
// capability.mjs still make that call, exactly as they do for workspace-actions — an
// approval that has lapsed, or a step not declared destructive asking for EXECUTE, is
// refused by the same code that already refuses it there.

import { randomUUID } from 'node:crypto';
import { authorizePlan, CapabilityError } from './capability.mjs';

export const ADAPTER_MANIFESTS = Object.freeze({
  // local-model-runtime.mjs is the one adapter that exists today (03_ARCHITETTURA §6:
  // the others — VectorStoreAdapter, ObjectStoreAdapter, IndustryModuleProvider,
  // CompliancePackProvider, HostBridgeAdapter — are not yet built). `launch()` spawns a
  // real OS process and hands it GPU access; every other method here (detect/configure/
  // status/attach/complete) does not reach outside the calling process in a way this
  // manifest governs, and is deliberately left ungated — naming that rather than
  // pretending the manifest below covers more than it does.
  'local-model-runtime': Object.freeze({
    operations: Object.freeze(['EXECUTE']),
    resourcePaths: Object.freeze({ EXECUTE: 'adapter://local-model-runtime/launch' }),
    description: 'spawn the operator-configured local inference process (ModelRuntimeAdapter)',
  }),
});

const GRANT_TTL_SECONDS = 5 * 60;

export class AdapterCapabilityError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'AdapterCapabilityError';
    this.kind = kind;
  }
}
const refuse = (kind, reason) => { throw new AdapterCapabilityError(kind, reason); };

/**
 * request() -> approve() -> a spendable token. Mirrors plan()/approve() in
 * workspace-actions.mjs, minus the parts that are specific to file writes: there is no
 * shadow, no execute(), no promotion. The only artifact produced is a token; the adapter's
 * own privileged method is what presents it to the minter later, at the moment it actually
 * needs it, not before.
 */
export class AdapterGrantOrchestrator {
  #minter;
  #events;
  #runs = new Map();

  constructor({ minter, events = null }) {
    if (!minter) refuse('INVALID', 'an adapter grant orchestrator with no minter could not issue a token if it wanted to');
    this.#minter = minter;
    this.#events = events;
  }

  #record(correlationId, causationId, actor, action, details, nowUnix) {
    if (!this.#events) return null;
    const event = this.#events.append({
      id: randomUUID(),
      correlationId,
      causationId,
      actor,
      action,
      payload: JSON.stringify(details ?? {}),
      recordedAtUnix: nowUnix,
    });
    return event.id;
  }

  request({ resource, operation, actor, nowUnix }) {
    const manifest = ADAPTER_MANIFESTS[resource];
    if (!manifest) refuse('UNKNOWN_ADAPTER', `no adapter named \`${resource}\` is registered`);
    if (!manifest.operations.includes(operation)) {
      refuse('OUT_OF_SCOPE',
        `\`${resource}\` never asks for \`${operation}\` — its manifest only lists ${manifest.operations.join(', ')}`);
    }
    const resourcePath = manifest.resourcePaths[operation];
    const plan = {
      mode: 'adapter-grant',
      constraints: [],
      steps: [{
        id: 'adapter-grant-1',
        description: `${resource}: ${manifest.description}`,
        files: [resourcePath],
        commands: [],
        dependsOn: [],
        blastRadius: {
          destructive: operation === 'EXECUTE' || operation === 'DELETE',
          reachesOutsideWorkspace: false,
        },
      }],
    };
    const runId = randomUUID();
    const requestEventId = this.#record(runId, null, actor, 'adapter_grant.requested',
      { resource, operation }, nowUnix);
    this.#runs.set(runId, {
      runId, status: 'PENDING_APPROVAL', resource, operation, plan,
      createdAtUnix: nowUnix, requestEventId, actor,
    });
    return { runId, resource, operation, plan };
  }

  /** The human decision. Mints exactly one token, scoped to the resource path the request named. */
  approve({ runId, approverId, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending adapter grant \`${runId}\``);
    if (run.status !== 'PENDING_APPROVAL') refuse('ALREADY_DECIDED', `grant \`${runId}\` is already ${run.status}`);
    if (!String(approverId ?? '').trim()) refuse('NO_APPROVER', 'an approval with no approver names nobody accountable');

    const approval = { approverId, grantedAtUnix: nowUnix, expiresAtUnix: nowUnix + GRANT_TTL_SECONDS };
    let authorized;
    try {
      authorized = authorizePlan(run.plan, approval, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) refuse('NOT_AUTHORIZED', error.reason);
      throw error;
    }
    const step = run.plan.steps[0];
    let token;
    try {
      token = this.#minter.mint(authorized, {
        stepId: step.id, paths: step.files, operations: [run.operation],
        uses: 1, expiresAtUnix: approval.expiresAtUnix,
      }, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) refuse('MINT_REFUSED', error.reason);
      throw error;
    }
    this.#record(runId, run.requestEventId, approverId, 'adapter_grant.approved',
      { tokenId: token.id, resource: run.resource, operation: run.operation }, nowUnix);
    run.status = 'GRANTED';
    run.tokenId = token.id;
    run.decidedAtUnix = nowUnix;
    return { runId, resource: run.resource, operation: run.operation, token };
  }

  reject({ runId, approverId, reason, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending adapter grant \`${runId}\``);
    if (run.status !== 'PENDING_APPROVAL') refuse('ALREADY_DECIDED', `grant \`${runId}\` is already ${run.status}`);
    this.#record(runId, run.requestEventId, approverId, 'adapter_grant.rejected', { reason: reason ?? null }, nowUnix);
    run.status = 'REJECTED';
    run.decidedAtUnix = nowUnix;
    return { runId, status: 'REJECTED' };
  }

  get(runId) {
    const run = this.#runs.get(runId);
    return run ? { ...run } : null;
  }
}

export function adapterCapabilityStatus() {
  return {
    manifests: Object.fromEntries(
      Object.entries(ADAPTER_MANIFESTS).map(([id, m]) => [id, { operations: [...m.operations] }]),
    ),
    enforcedBy: 'engine',
    adaptersMaySelfGrant: false,
    grantTtlSeconds: GRANT_TTL_SECONDS,
    reason: 'A manifest only lists which operations exist to ask for. Only AdapterGrantOrchestrator.approve() mints a token, through the same TokenMinter instance workspace-actions.mjs spends through. local-model-runtime.mjs is the first, and today the only, adapter wired to require one before its privileged operation (launch, which spawns an OS process and hands it GPU access) runs — attach/complete/configure remain ungated, named rather than implied.',
  };
}
