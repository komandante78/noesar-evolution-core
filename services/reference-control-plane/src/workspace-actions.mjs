// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The wiring D-0190 asked for: the first product surface that spends a capability token and
// changes a real file. Everything it calls already existed and was tested in isolation —
// ReferenceReasoningProvider (step 1-2), TokenMinter (step 3), ShadowWorkspace and execute()
// (steps 4-5), EventLedger (step 6) — and none of it was reachable from a request. This
// module is the seam, not a sixth mechanism: it owns no security decision that capability.mjs,
// shadow.mjs or executor.mjs already make, and duplicating one here is exactly how two
// implementations of one rule stop agreeing.
//
// WHAT execute() DOES NOT DO, WHICH IS WHY THIS FILE EXISTS. Reading executor.mjs shows the
// gap directly: `execute()` writes into `shadow.root`, a throwaway copy, and nothing carries
// an accepted result back into the real workspace before the shadow is discarded. Calling
// execute() today — which nothing did — would still leave `executorWiredToProductActions`
// false, because the write never reaches a file the product's own user can see. PROMOTION
// (copying the shadow's changed files back to the real workspace, and only when the
// comparison came back clean) is the missing half, built here.
//
// SCOPE, NAMED RATHER THAN DISCOVERED LATER. This wires the TRIVIAL risk path of
// 11_REVISIONE_E_CORREZIONI.md P6 (`interpret → plan → expect → autorizza → esegui →
// verifica`) plus promotion and restore: one step, WRITE only, no DELETE, no EXECUTE, no
// hypotheses in competition. Two things the phase-1 criterion names are deliberately NOT
// built here, and workspaceActionsStatus() says so rather than implying otherwise:
//
//   - "esegue i test" for an AI-declared test expectation. executor.mjs already declares
//     EXECUTE a PERMANENT refusal — "this layer has no execution surface, and pretending to
//     run it would be worse than refusing" — and that boundary was tested and shipped in
//     step 5. Running a plan-declared test command would mean running arbitrary code the
//     plan named, which is exactly what EXECUTE refuses. This module does not reopen that
//     boundary; it is a separate, larger decision (a real sandbox, not a wiring exercise),
//     named here rather than quietly built or quietly ignored.
//   - Because no test runs, a plan with no declared files and no declared test always fails
//     `expect()` (reasoning.mjs line ~232) exactly as the reference provider intends: it has
//     no model, so it cannot invent a file target from a request's prose. The caller of
//     `plan()` here supplies `files` explicitly — the honest form of "something upstream of
//     the reference provider decided what to touch", same posture the reference provider
//     already takes about everything it cannot derive.
//
// THE APPROVAL IS THE OWNER'S, NOT A TIMER'S. `authorizePlan` already refuses an approval
// that expires before it starts or has lapsed; this module fixes the grant to a short TTL
// (15 minutes) so a plan nobody looked at cannot be approved by staleness.
//
// PROMOTION IS ALL-OR-NOTHING. Every outcome is checked BEFORE any real file is touched:
// `execute()`'s own `ok` flag (every action performed AND the comparison ran AND it was
// clean) gates the whole run. A partially-applied edit — three files promoted, the fourth
// refused mid-loop — would be a state nobody planned for and nobody authorised.

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { ReasoningRefused } from './reasoning.mjs';
import { ReasoningRouter } from './reasoning-router.mjs';
import { authorizePlan, CapabilityError } from './capability.mjs';
import { ShadowWorkspace, contained } from './shadow.mjs';
import { execute } from './executor.mjs';
import { verifyClaims, projectionCoverage } from './verification.mjs';
import { assembleSessionProof } from './session-proof.mjs';

export const APPROVAL_TTL_SECONDS = 15 * 60;
const MAX_DIFF_BYTES = 256 * 1024;

export class WorkspaceActionError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'WorkspaceActionError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new WorkspaceActionError(kind, reason); };

function readTextIfSmall(path) {
  if (!existsSync(path)) return { available: true, content: null };
  const size = readFileSync(path).length;
  if (size > MAX_DIFF_BYTES) return { available: false, content: null, reason: `over ${MAX_DIFF_BYTES} bytes` };
  try {
    return { available: true, content: readFileSync(path, 'utf8') };
  } catch {
    return { available: false, content: null, reason: 'not valid UTF-8' };
  }
}

/**
 * One orchestrator per server process, mirroring capability.mjs's TokenMinter: state lives in
 * memory and a restart clears every pending or promoted run, which is stated in status()
 * rather than left to be discovered.
 */
export class WorkspaceActionOrchestrator {
  #workspaceRoot;
  #shadowsRoot;
  #minter;
  #events;
  #runs = new Map();
  #reasoningFor;
  #executeSandbox;
  #privacyStateFor;

  constructor({ workspaceRoot, shadowsRoot, minter, events, reasoningFor, executeSandbox = null, privacyStateFor = null }) {
    // Failed fast here once already, the wrong way: `workspace/shadows` looked like a
    // reasonable place to put shadows because the read-only status route already probes
    // there — but that route only writes a tiny probe file, never a whole-workspace shadow,
    // so the containment refusal in shadow.mjs never fired until the first real approval.
    // Checked at construction now, so a future caller finds out at startup, not on a live run.
    const workspaceResolved = resolve(workspaceRoot);
    const shadowsResolved = resolve(shadowsRoot);
    if (shadowsResolved === workspaceResolved
      || shadowsResolved.startsWith(workspaceResolved + sep)
      || workspaceResolved.startsWith(shadowsResolved + sep)) {
      throw new WorkspaceActionError('CONTAINMENT',
        `shadowsRoot (\`${shadowsResolved}\`) and workspaceRoot (\`${workspaceResolved}\`) must not contain one another — a whole-workspace shadow inside the tree it shadows would include itself`);
    }
    this.#workspaceRoot = workspaceRoot;
    this.#shadowsRoot = shadowsRoot;
    this.#minter = minter;
    this.#events = events;
    // ARCH-008 / D-0250: the client's own decision, resolved once at boot in server.mjs
    // (`resolveExecuteSandboxConfig`) and threaded through, never re-read per call — a
    // config that could change mid-run would make "the token's limits were checked against
    // the installed ceiling at mint time" stale by the time execute() spends it.
    this.#executeSandbox = executeSandbox;
    // SESS-001: the egress state sampled at points in the run's own timeline, not read once
    // at the end — a run that went local-only and then, mid-way, had a connector enabled must
    // show both, not overwrite the first with the second. `null` is honest: sessionProof()
    // reports no samples rather than inventing a state nobody asked derivePrivacy() for.
    this.#privacyStateFor = privacyStateFor;
    // A factory, not an instance: a router accumulates the provenance of the calls made
    // through it, so one shared across runs would attribute this run's surfaces to the
    // previous one's. One per call, discarded with the call.
    this.#reasoningFor = reasoningFor ?? (() => new ReasoningRouter({ workspaceRoot }));
  }

  #record(correlationId, causationId, actor, action, details, nowUnix) {
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

  // Never throws: a caller that did not wire a sampler gets an honest empty list, not a
  // missing session proof. `at` names the point in the run's lifecycle the sample was taken.
  #sampleEgress(at, nowUnix) {
    if (!this.#privacyStateFor) return null;
    try {
      const state = this.#privacyStateFor();
      return { at, nowUnix, state: state?.state ?? null, disclosures: state?.disclosures ?? [] };
    } catch {
      return { at, nowUnix, state: null, disclosures: [], reason: 'the privacy sampler threw' };
    }
  }

  get(runId) {
    const run = this.#runs.get(runId);
    return run ? { ...run } : null;
  }

  /** SESS-001: the ten-field Session Proof, assembled from this run and its causal events. */
  sessionProof(runId) {
    const run = this.#runs.get(runId);
    if (!run) return null;
    return assembleSessionProof({ run, events: this.#events.correlation(runId) });
  }

  /**
   * request → plan, through the real reasoning pipeline. `files` is the one thing the
   * reference provider cannot derive (see the module comment) and is required, not defaulted:
   * a caller with nothing to name should not reach this at all.
   */
  async plan({ request, files, projectRules = [], constraints = [], mode = 'safe', policy = 'restrictive', actor, nowUnix, claims = [] }) {
    if (!Array.isArray(files) || files.length === 0) {
      refuse('NO_FILES', 'this reference wiring takes the files to touch as part of the request; the reference provider has no model and cannot invent a target from prose alone');
    }
    if (!Array.isArray(claims)) refuse('INVALID_CLAIMS', 'claims must be an array if supplied');
    for (const file of files) {
      if (!file || typeof file.path !== 'string' || !file.path.trim()) {
        refuse('INVALID_FILE', 'every file needs a path');
      }
      if (typeof file.contents !== 'string') refuse('INVALID_FILE', `\`${file.path}\` needs string contents`);
    }
    // The router, not the reference provider directly. Until this call site changed, an
    // operator could select an external provider and this path — the only one that mints a
    // token and touches a real file — kept asking the reference one regardless. The
    // selection was real everywhere it did not matter.
    const provider = this.#reasoningFor();
    let intent; let hypotheses; let plan; let constrained; let risk; let confidence; let expectation;
    try {
      intent = await provider.interpret(request, projectRules);
      hypotheses = await provider.hypothesize(intent, []);
      const step = {
        id: 'step-1',
        description: hypotheses[0].statement,
        files: files.map((file) => file.path),
        commands: [],
        dependsOn: [],
        blastRadius: provider.blastRadius(files.map((file) => file.path), false),
      };
      plan = provider.buildPlan([step], constraints, mode);
      constrained = await provider.constrain(plan, policy);
      if (constrained.refused) refuse('CONSTRAINED_AWAY', constrained.reason);
      risk = await provider.classify(constrained.plan);
      confidence = await provider.confidence(constrained.plan, []);
      expectation = await provider.expect(constrained.plan);
    } catch (error) {
      if (error instanceof ReasoningRefused) refuse('REASONING_REFUSED', error.reason);
      // ReasoningUnavailable deliberately propagates: it is not a refusal, and dressing it
      // as one (422 "refused") would report a provider that was never reached as a decision
      // it made. The route maps it to 503.
      throw error;
    }
    // Recorded on the run, not only returned: an approver deciding on this plan tomorrow
    // needs to know which provider produced the expectation they are approving against.
    const provenance = provider.provenance();

    const runId = randomUUID();
    const rootEventId = this.#record(runId, null, actor, 'workspace_action.planned', {
      goal: intent.goal, files: files.map((file) => file.path), risk: risk.overall, provenance,
    }, nowUnix);
    this.#runs.set(runId, {
      runId, status: 'PENDING_APPROVAL',
      plan: constrained.plan, expectation, files, intent, risk, confidence, claims, provenance,
      createdAtUnix: nowUnix, planEventId: rootEventId, actor,
      // SESS-001 fixture material: the exact inputs to the decision layer. `files` above
      // already carries full contents, which is why it is not duplicated here.
      request, hypotheses, projectRules, constraints, mode, policy,
      egressSamples: [this.#sampleEgress('planned', nowUnix)].filter(Boolean),
    });
    return { runId, plan: constrained.plan, intent, expectation, risk, confidence, claims, provenance };
  }

  /**
   * What would this plan do — asked before anything is approved, and answered without minting
   * a token, without spending one, and without executing anything.
   *
   * `02_ATOM.md` marks `simulate` the contract's only optional surface and calls it the reason
   * to have an external provider at all. The reference provider answers `supported: false`,
   * which is a real answer and is reported as one: this route never invents a prediction.
   *
   * The shadow is materialised read-only for the question and discarded in `finally`, exactly
   * as `approve()` does — a prediction must not leave scratch space behind, and must not be
   * the thing that changes the workspace it is predicting about.
   */
  async simulate({ runId, actor, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending run \`${runId}\``);
    if (run.status !== 'PENDING_APPROVAL') {
      refuse('ALREADY_DECIDED', `run \`${runId}\` is already ${run.status}; a simulation of a decided run would predict a past that already happened`);
    }

    const provider = this.#reasoningFor();
    const shadowRoot = join(this.#shadowsRoot, `${runId}-simulate`);
    const shadow = ShadowWorkspace.ofWorkspace(this.#workspaceRoot, shadowRoot);
    try {
      let outcome;
      try {
        outcome = await provider.simulate(run.plan, shadow.root);
      } catch (error) {
        if (error instanceof ReasoningRefused) refuse('SIMULATION_REFUSED', error.reason);
        throw error;
      }
      this.#record(runId, run.planEventId, actor, 'workspace_action.simulated', {
        supported: outcome?.supported === true,
        predictedPaths: Array.isArray(outcome?.predictedDiff) ? outcome.predictedDiff.length : 0,
        provenance: provider.provenance(),
      }, nowUnix);
      return {
        runId,
        // Carried through unchanged rather than reshaped: `supported: false` is the reference
        // provider's honest answer and must not be flattened into an empty prediction.
        simulation: outcome,
        provenance: provider.provenance(),
        // Stated so a reader never has to infer it from an absence.
        executed: false,
      };
    } finally {
      shadow.discard();
    }
  }

  /**
   * The human decision. Mints one token covering exactly the files the plan declared,
   * materialises a whole-workspace shadow, spends the token through execute() — writing only
   * into the shadow — and promotes to the real workspace ONLY if execute()'s own `ok` is
   * true. The shadow is always discarded; it is scratch space, never the record.
   */
  approve({ runId, approverId, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending run \`${runId}\``);
    if (run.status !== 'PENDING_APPROVAL') refuse('ALREADY_DECIDED', `run \`${runId}\` is already ${run.status}`);
    if (!String(approverId ?? '').trim()) refuse('NO_APPROVER', 'an approval with no approver names nobody accountable');

    const approval = { approverId, grantedAtUnix: nowUnix, expiresAtUnix: nowUnix + APPROVAL_TTL_SECONDS };
    let authorized;
    try {
      authorized = authorizePlan(run.plan, approval, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) refuse('NOT_AUTHORIZED', error.reason);
      throw error;
    }
    const approveEventId = this.#record(runId, run.planEventId, approverId, 'workspace_action.approved',
      { approverId }, nowUnix);

    const step = run.plan.steps[0];
    let token;
    try {
      token = this.#minter.mint(authorized, {
        stepId: step.id, paths: step.files, operations: ['WRITE'],
        uses: step.files.length, expiresAtUnix: approval.expiresAtUnix,
      }, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) {
        // SESS-001 "autorità": a denial is part of the authority timeline, not only a
        // thrown error the caller happens to see. Before this, a refused mint left no trace
        // in the run's own event correlation — the causal chain answered "why did this run
        // stop" with silence between `approved` and nothing.
        this.#record(runId, approveEventId, approverId, 'capability.denied',
          { stepId: step.id, paths: step.files, kind: error.kind, reason: error.reason }, nowUnix);
        refuse('MINT_REFUSED', error.reason);
      }
      throw error;
    }
    this.#record(runId, approveEventId, approverId, 'capability.minted',
      { tokenId: token.id, paths: token.paths, operations: token.operations }, nowUnix);
    run.egressSamples.push(...[this.#sampleEgress('approved', nowUnix)].filter(Boolean));

    // Discarded exactly once, in `finally`: scratch space that must not survive the call
    // whether it finished cleanly or threw partway through.
    const shadowRoot = join(this.#shadowsRoot, runId);
    const shadow = ShadowWorkspace.ofWorkspace(this.#workspaceRoot, shadowRoot);
    try {
      const actions = run.files.map((file) => ({ kind: 'WRITE', path: file.path, contents: file.contents }));
      const result = execute({ authorized, minter: this.#minter, tokens: [token], shadow, actions, expectation: run.expectation, tests: [], nowUnix, executeSandbox: this.#executeSandbox });
      const executeEventId = this.#record(runId, approveEventId, approverId, 'executor.ran',
        { performed: result.performed, refused: result.refused, ok: result.ok }, nowUnix);
      this.#record(runId, executeEventId, approverId, 'shadow.compared',
        { clean: result.surprise?.clean ?? null, unexpected: result.surprise?.unexpected ?? null }, nowUnix);

      // Recompute verifier (CodeN Evolution construction order, step 9): claims declared
      // at plan() time are checked against the shadow's actual post-execution content --
      // not the path-touched comparison above, which knows only CREATED/MODIFIED/DELETED,
      // never what a file now contains. Run BEFORE shadow.discard() in `finally`: there is
      // nothing left to read from once this block exits.
      const claimResults = verifyClaims(run.claims ?? [], shadow.root);
      const coverage = projectionCoverage(claimResults);
      this.#record(runId, executeEventId, approverId, 'workspace_action.claims_verified',
        { declaration: coverage.declaration, total: coverage.total, recomputed: coverage.recomputed, contradicted: coverage.contradicted.length }, nowUnix);

      const diff = this.#diff(shadow, result);
      let promoted = false;
      let backups = null;
      // A clean path/test comparison is not enough on its own if a declared claim was
      // recomputed and found false: the diff touched what the plan said it would, but the
      // resulting content contradicts what was claimed about it. Coverage gaps
      // (unrecomputed claims) do NOT block promotion -- CE-009 asks for the gap to be
      // declared honestly, not for every claim to be checkable before anything can ship.
      const clean = result.ok && coverage.contradicted.length === 0;
      if (clean) {
        backups = this.#promote(shadow, result);
        promoted = true;
        this.#record(runId, executeEventId, approverId, 'workspace_action.promoted',
          { files: result.outcomes.filter((o) => o.performed).map((o) => o.path) }, nowUnix);
      } else {
        this.#record(runId, executeEventId, approverId, 'workspace_action.refused',
          { reason: result.ok ? 'a declared claim was recomputed and contradicted' : 'the run was not clean; nothing was promoted', surprise: result.surprise, contradicted: coverage.contradicted }, nowUnix);
      }

      run.status = promoted ? 'PROMOTED' : 'REFUSED';
      run.result = result;
      run.diff = diff;
      run.coverage = coverage;
      run.backups = backups;
      run.decidedAtUnix = nowUnix;
      return { runId, result, diff, promoted, coverage };
    } finally {
      shadow.discard();
    }
  }

  reject({ runId, approverId, reason, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending run \`${runId}\``);
    if (run.status !== 'PENDING_APPROVAL') refuse('ALREADY_DECIDED', `run \`${runId}\` is already ${run.status}`);
    this.#record(runId, run.planEventId, approverId, 'workspace_action.rejected', { reason: reason ?? null }, nowUnix);
    run.status = 'REJECTED';
    run.decidedAtUnix = nowUnix;
    return { runId, status: 'REJECTED' };
  }

  /** Before/after content per touched file, capped — a diff nobody can read is not a diff. */
  #diff(shadow, result) {
    const entries = [];
    for (const outcome of result.outcomes) {
      if (!outcome.performed) continue;
      const before = readTextIfSmall(contained(shadow.source, outcome.path));
      const after = readTextIfSmall(contained(shadow.root, outcome.path));
      entries.push({
        path: outcome.path, status: result.observation.changed[outcome.path] ?? 'UNKNOWN',
        before: before.available ? before.content : null,
        after: after.available ? after.content : null,
        diffAvailable: before.available && after.available,
      });
    }
    return entries;
  }

  /**
   * Copies only what execute() actually performed, from the shadow to the real workspace —
   * never the other direction. The pre-existing bytes of each real file are captured first,
   * in memory, so a restore can put them back; a file that did not exist before is restored
   * by deleting it, not by writing empty content over it.
   */
  #promote(shadow, result) {
    const backups = [];
    for (const outcome of result.outcomes) {
      if (!outcome.performed) continue;
      const realPath = contained(this.#workspaceRoot, outcome.path);
      const shadowPath = contained(shadow.root, outcome.path);
      const existedBefore = existsSync(realPath);
      const beforeContent = existedBefore ? readFileSync(realPath) : null;
      mkdirSync(dirname(realPath), { recursive: true });
      writeFileSync(realPath, readFileSync(shadowPath));
      backups.push({ path: outcome.path, existedBefore, beforeContent });
    }
    return backups;
  }

  /**
   * Writes back exactly what `#promote` captured. Restorable once: a second call finds
   * nothing left to restore and refuses rather than silently doing nothing.
   */
  restore({ runId, actor, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no run \`${runId}\``);
    if (run.status === 'RESTORED') refuse('ALREADY_RESTORED', `run \`${runId}\` was already restored at ${run.restoredAtUnix}`);
    if (run.status !== 'PROMOTED') refuse('NOT_PROMOTED', `run \`${runId}\` was never promoted, so there is nothing to restore`);
    for (const backup of run.backups ?? []) {
      const realPath = contained(this.#workspaceRoot, backup.path);
      if (backup.existedBefore) writeFileSync(realPath, backup.beforeContent);
      else if (existsSync(realPath)) unlinkSync(realPath);
    }
    this.#record(runId, run.planEventId, actor, 'workspace_action.restored',
      { files: (run.backups ?? []).map((b) => b.path) }, nowUnix);
    run.status = 'RESTORED';
    run.restoredAtUnix = nowUnix;
    return { runId, status: 'RESTORED' };
  }
}

export function workspaceActionsStatus() {
  return {
    riskPathsSupported: ['TRIVIAL'],
    operationsSupported: ['WRITE'],
    operationsNotSupported: ['DELETE', 'EXECUTE'],
    testExecution: false,
    testExecutionReason: 'executor.mjs refuses EXECUTE permanently — running a plan-declared command is arbitrary code execution and was deliberately kept out of the executor in step 5. Wiring a test runner is a separate, larger security decision, not built here.',
    filesSuppliedBy: 'caller',
    filesSuppliedByReason: 'the reference reasoning provider has no model and cannot derive a file target from a request written in prose; it says so rather than guessing.',
    approvalRequired: true,
    approvalTtlSeconds: APPROVAL_TTL_SECONDS,
    promotionAllOrNothing: true,
    restoreSupported: true,
    restoreOnce: true,
    runsPersistAcrossRestart: false,
    reason: 'This is the trivial risk path (11_REVISIONE_E_CORREZIONI.md P6): one step, WRITE only. A plan is approved by a human, mints exactly the tokens its declared files need, executes into a whole-workspace shadow, and is promoted to the real workspace only when the comparison came back clean with every action performed. Every step is recorded in the causal event ledger.',
    recomputeVerifier: true,
    recomputeVerifierReason: 'CodeN Evolution construction order step 9 (D-0209): plan() takes an optional `claims` array; approve() recomputes each against the shadow\'s post-execution content (verification.mjs) and gates promotion if any is CONTRADICTED. Coverage gaps (unrecomputed claims — most often behavioural ones, since EXECUTE stays refused) are declared, not blocking.',
    reasoningRouted: true,
    reasoningRoutedReason: 'plan() asks the ReasoningRouter, so a selected external provider is used on the one path that mints a token and touches a real file — not only on the read-only advisory route. Every run records which provider answered which surface (`provenance`). With no external provider configured every surface is the reference one and this path behaves exactly as before.',
    simulationSupported: true,
    simulationSupportedReason: '`simulate` is the contract\'s only optional surface (02_ATOM.md). POST /api/v1/workspace-actions/{runId}/simulate materialises a shadow, asks the selected provider what the plan would do, and discards the shadow — no token is minted and nothing is executed. The reference provider answers `supported: false`, which is reported as given and never flattened into an empty prediction.',
    simulationCrossProcessLimit: 'The frozen contract passes the shadow as a PATH, so a provider in another process predicts nothing unless it can read that directory. The installed daemon has no mount onto the shadow root: routed there it refuses, and the refusal is reported as a refusal. Sharing the shadow root is a mount change, named here rather than left to be discovered.',
  };
}
