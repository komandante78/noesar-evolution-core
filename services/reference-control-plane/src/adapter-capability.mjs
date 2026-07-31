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

// D-0252 audited the six other 03_ARCHITETTURA §4 contracts individually instead of
// leaving them as one undifferentiated "not yet built" statement, because that statement
// was imprecise in a way that matters: three of the six have real, shipped, first-party
// code (hardware.mjs, sector-modules.mjs, compliance-packs.mjs) that simply never grew a
// privileged (write/spawn/network) operation — gating them would mean minting tokens for
// operations that do not exist, which is not security work, it is a manifest that lies
// about what it bounds. The other three remain genuinely absent or out of scope, and are
// NOT given manifest entries here — see the reasons on each below and D-0252.
//
//   - VectorStoreAdapter: postgres-repository.mjs is not a pluggable surface — it is
//     first-party code with one implementation, wired directly into server.mjs behind
//     RBAC + Postgres RLS. ARCH-005's concern ("no adapter may self-grant") presumes a
//     swappable implementation that could misbehave; there isn't one to gate.
//   - ObjectStoreAdapter: no content-addressed, encrypted object store exists in the
//     product at all (store.mjs is a plain JSON key-value file). This is a missing
//     capability, not an ungated one — nothing to write a manifest for yet.
//   - HostBridgeAdapter ("the little that touches the host, always mediated"): the two
//     host-touching capabilities that exist — process spawn (local-model-runtime.launch)
//     and sandboxed EXECUTE (noesar-sandbox, ARCH-008) — are each already gated under
//     their own name. A third adapter here would re-cover ground two other capabilities
//     already cover, under a name nothing calls.
export const ADAPTER_MANIFESTS = Object.freeze({
  // launch() spawns a real OS process and hands it GPU access; every other method here
  // (detect/configure/status/attach/complete) does not reach outside the calling process
  // in a way this manifest governs, and is deliberately left ungated — named rather than
  // implied. attach()'s outbound fetch() to an operator-configured endpoint is tracked
  // separately as F4-010 (hostname-only validation, requires provider.manage/agent.manage
  // to exploit), not reopened here.
  'local-model-runtime': Object.freeze({
    operations: Object.freeze(['EXECUTE']),
    resourcePaths: Object.freeze({ EXECUTE: 'adapter://local-model-runtime/launch' }),
    description: 'spawn the operator-configured local inference process (ModelRuntimeAdapter)',
  }),
  // HardwareProbeAdapter, as built: discoverHardware()/recommendRuntime() in hardware.mjs
  // read /proc and query the GPU driver — never write, spawn, or reach the network. There
  // is no privileged operation to self-grant, so this manifest asks for nothing; any
  // request against it is refused OUT_OF_SCOPE by construction, the same as an adapter
  // whose one operation is not in scope.
  'hardware-probe': Object.freeze({
    operations: Object.freeze([]),
    resourcePaths: Object.freeze({}),
    description: 'read-only hardware discovery (HardwareProbeAdapter) — no privileged operation exists',
  }),
  // IndustryModuleProvider, as built: GET /api/v1/sector-modules[/list] and POST
  // .../validate remain read-only/dry-run and stay ungated (nothing to self-grant there).
  // D-0274 added a real write surface — install/activate/deactivate in sector-modules.mjs
  // — all three funnel through ONE operation (WRITE) and ONE resource path: they are
  // distinguished by which HTTP route and which arguments the caller presents after
  // spending the token, not by the grant itself. A single shared gate here means an owner
  // approves "a sector-modules write is about to happen" once per action, the same
  // granularity as local-model-runtime's one EXECUTE gate for launch().
  'sector-modules': Object.freeze({
    operations: Object.freeze(['WRITE']),
    resourcePaths: Object.freeze({ WRITE: 'adapter://sector-modules/write' }),
    description: 'install, activate or deactivate a sector module manifest (IndustryModuleProvider)',
  }),
  // CompliancePackProvider, as built: compliance-packs.mjs is the same shape as
  // sector-modules.mjs — loads and validates signed packs already on disk under
  // NOESAR_COMPLIANCE_PACKS, no install/activate route.
  'compliance-packs': Object.freeze({
    operations: Object.freeze([]),
    resourcePaths: Object.freeze({}),
    description: 'read/validate signed compliance packs (CompliancePackProvider) — no install route exists yet',
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
    reason: 'A manifest only lists which operations exist to ask for. Only AdapterGrantOrchestrator.approve() mints a token, through the same TokenMinter instance workspace-actions.mjs spends through. local-model-runtime.mjs (launch, spawns an OS process and hands it GPU access) and sector-modules.mjs (WRITE, install/activate/deactivate a module manifest — D-0274) are the two adapters with a privileged operation, both wired to require a token — attach/complete/configure on local-model-runtime remain ungated, named rather than implied. hardware-probe/compliance-packs are real, shipped code with zero privileged operations by design (read-only or validate-only) — their empty manifests are not a gap, they are the accurate statement that there is nothing to self-grant. VectorStoreAdapter, ObjectStoreAdapter and HostBridgeAdapter have no entry: no pluggable surface, no implemented capability, or already covered under a different name (D-0252) respectively.',
  };
}
