// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Workflows — WP-2, specified by MASTER_REFERENCE/04_AI_PLATFORM/46:
//
//   "Workflows use typed steps, retries, compensation, idempotency, timeout,
//    cancellation, human approval, evidence and replay where possible."
//
// `/api/v1/bootstrap` advertised `Workflows` while no page, no route and no engine
// existed. `test/bootstrap-feature-claims.test.mjs` is what caught that, and it now
// stops any feature being advertised before it exists.
//
// ## Typed steps declare their effects; they do not describe them
//
// A step's type is a closed vocabulary, and each type declares the effects it can have
// and whether this build can execute it. That shape is deliberate and was decided
// empirically on this project: a textual denylist over free-form commands is defeated by
// any indirection (`psql -f x.sql` never contains the forbidden verb), while a declared
// effect cannot be smuggled past a check because it is not derived from the text at all.
//
// The honest consequence is that `host_mutation` is **not executable here**. This layer
// has `executionEnabled:false` and no execution surface. Rather than pretend, such a step
// fails closed and names the layer that owns it — the same choice made for the three
// CodeN invariants that this build cannot enforce. A workflow that claimed to perform
// host mutations it cannot perform would be exactly the defect this file exists to fix.
//
// ## What is deterministic
//
// `transform` steps compute from a fixed operation registry — no dynamic evaluation, no
// user-supplied code. That is what makes replay meaningful: a workflow of `transform`
// steps replays to the same outcomes, and a test asserts it.
import { randomUUID } from 'node:crypto';

function now() { return new Date().toISOString(); }
function err(message, status = 400) { return Object.assign(new Error(message), { status }); }
function find(items, id, label) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw err(`${label} not found.`, 404);
  return item;
}

// ---------------------------------------------------------------------------------
// Typed step vocabulary
// ---------------------------------------------------------------------------------

export const STEP_TYPES = Object.freeze({
  transform: {
    effects: [],
    executable: true,
    description: 'Computes a value from its input using a fixed operation. No side effects.',
  },
  human_approval: {
    effects: ['APPROVAL_GATE'],
    executable: true,
    description: 'Suspends the run until a human with agent.manage approves or rejects it.',
  },
  wait: {
    effects: [],
    executable: true,
    description: 'Waits for a bounded duration, then continues.',
  },
  tool_call: {
    effects: ['TOOL_INVOCATION', 'NETWORK_EGRESS'],
    executable: true,
    // Consent is default-deny for every registered tool, so this fails closed until an
    // operator grants it explicitly. That is the existing tool policy, not a new one.
    requires: 'a registered tool whose consent has been granted',
    description: 'Invokes a registered tool through the tool executor.',
  },
  host_mutation: {
    effects: ['HOST_WRITE'],
    executable: false,
    enforcedBy: 'execution layer (not present in this build: executionEnabled=false)',
    description: 'Mutates the host filesystem. Declared so a workflow can express it; refused here.',
  },
});

// `transform` operations. A closed registry, because the alternative — evaluating a
// user-supplied expression — would hand every workflow author the execution surface this
// build deliberately does not have.
const TRANSFORM_OPS = Object.freeze({
  identity: (input) => input,
  constant: (input, config) => config.value ?? null,
  merge: (input, config) => ({ ...(config.base ?? {}), ...(input && typeof input === 'object' && !Array.isArray(input) ? input : {}) }),
  pick: (input, config) => {
    const keys = Array.isArray(config.keys) ? config.keys.map(String) : [];
    const source = input && typeof input === 'object' ? input : {};
    return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
  },
  count: (input) => ({ count: Array.isArray(input) ? input.length : input && typeof input === 'object' ? Object.keys(input).length : 0 }),
});

const RUN_TERMINAL = Object.freeze(new Set(['completed', 'failed', 'cancelled', 'rejected', 'compensation_failed']));

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

// A timeout that is always cleared. An uncleared timer keeps the event loop alive and a
// test process that should exit hangs instead; this project has already paid for a timer
// whose lifecycle was wrong once.
async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(err(`${label} exceeded its ${timeoutMs}ms timeout.`, 504)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeStep(input, index) {
  const type = String(input.type ?? 'transform');
  if (!(type in STEP_TYPES)) throw err(`Unknown step type: ${type}. Known types: ${Object.keys(STEP_TYPES).join(', ')}.`);
  // The key is the stable identity of a step across versions and replays. Ids are
  // regenerated per definition edit; keys are not, so evidence stays comparable.
  const key = String(input.key ?? `step-${index + 1}`).trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(key)) throw err(`Step key "${key}" must be 1-64 characters of letters, digits, dot, dash or underscore.`);
  const step = {
    id: randomUUID(),
    index,
    key,
    type,
    title: String(input.title ?? key),
    description: String(input.description ?? ''),
    operation: type === 'transform' ? String(input.operation ?? 'identity') : null,
    config: input.config && typeof input.config === 'object' ? input.config : {},
    toolId: input.toolId ?? null,
    input: input.input ?? null,
    // A step declaring an effect beyond the empty set requires approval unless the author
    // says otherwise; a pure step does not. Explicit `requiresApproval` always wins.
    requiresApproval: input.requiresApproval === undefined
      ? STEP_TYPES[type].effects.length > 0
      : Boolean(input.requiresApproval),
    retry: {
      maxAttempts: clampInt(input.retry?.maxAttempts, 1, 1, 5),
      backoffMs: clampInt(input.retry?.backoffMs, 0, 0, 60_000),
    },
    timeoutMs: clampInt(input.timeoutMs, 30_000, 10, 600_000),
    durationMs: type === 'wait' ? clampInt(input.durationMs, 0, 0, 60_000) : null,
    compensation: null,
  };
  if (type === 'transform' && !(step.operation in TRANSFORM_OPS)) {
    throw err(`Unknown transform operation: ${step.operation}. Known operations: ${Object.keys(TRANSFORM_OPS).join(', ')}.`);
  }
  if (type === 'tool_call' && !step.toolId) throw err(`Step "${key}" is a tool_call and must name a toolId.`);
  if (input.compensation) {
    const compensationType = String(input.compensation.type ?? 'transform');
    if (!(compensationType in STEP_TYPES)) throw err(`Unknown compensation step type: ${compensationType}.`);
    const operation = compensationType === 'transform' ? String(input.compensation.operation ?? 'identity') : null;
    if (compensationType === 'transform' && !(operation in TRANSFORM_OPS)) {
      throw err(`Unknown compensation transform operation: ${operation}.`);
    }
    step.compensation = {
      type: compensationType,
      operation,
      config: input.compensation.config && typeof input.compensation.config === 'object' ? input.compensation.config : {},
      toolId: input.compensation.toolId ?? null,
      timeoutMs: clampInt(input.compensation.timeoutMs, 30_000, 10, 600_000),
      description: String(input.compensation.description ?? ''),
    };
  }
  return step;
}

export class WorkflowService {
  constructor({ store, ledger, executor = null }) {
    this.store = store;
    this.ledger = ledger;
    this.executor = executor;
    // Two HTTP requests can ask the same run to advance at the same time. The store's
    // transactions are synchronous but step execution is not, so without this guard both
    // callers would read the same pending step and execute it twice. One process, one
    // set — stated rather than assumed, because it is only sound while that holds.
    this.advancing = new Set();
  }

  // -- definitions ----------------------------------------------------------------

  stepTypes() {
    return Object.entries(STEP_TYPES).map(([type, meta]) => ({ type, ...meta }));
  }

  createWorkflow(input = {}, actorId = 'system') {
    const name = String(input.name ?? '').trim();
    if (!name) throw err('Workflow name is required.');
    const rawSteps = Array.isArray(input.steps) ? input.steps : [];
    if (!rawSteps.length) throw err('A workflow needs at least one step.');
    if (rawSteps.length > 50) throw err('A workflow may declare at most 50 steps.');
    const steps = rawSteps.map((step, index) => normalizeStep(step, index));
    const duplicateKey = steps.map((step) => step.key).find((key, index, all) => all.indexOf(key) !== index);
    if (duplicateKey) throw err(`Step keys must be unique within a workflow; "${duplicateKey}" is repeated.`);
    return this.store.transact((state) => {
      const workflow = {
        id: randomUUID(),
        projectId: input.projectId ?? null,
        name,
        description: String(input.description ?? ''),
        version: 1,
        steps,
        archived: false,
        createdAt: now(),
        updatedAt: now(),
      };
      state.workflows.push(workflow);
      this.ledger?.append({ actor: actorId, action: 'workflow.created', result: 'success', details: { workflowId: workflow.id, steps: steps.length } });
      return workflow;
    });
  }

  updateWorkflow(workflowId, patch = {}, actorId = 'system') {
    const steps = patch.steps === undefined ? null : (() => {
      const raw = Array.isArray(patch.steps) ? patch.steps : [];
      if (!raw.length) throw err('A workflow needs at least one step.');
      const normalized = raw.map((step, index) => normalizeStep(step, index));
      const duplicate = normalized.map((step) => step.key).find((key, index, all) => all.indexOf(key) !== index);
      if (duplicate) throw err(`Step keys must be unique within a workflow; "${duplicate}" is repeated.`);
      return normalized;
    })();
    return this.store.transact((state) => {
      const workflow = find(state.workflows, workflowId, 'Workflow');
      if (patch.name !== undefined) {
        const name = String(patch.name).trim();
        if (!name) throw err('Workflow name is required.');
        workflow.name = name;
      }
      if (patch.description !== undefined) workflow.description = String(patch.description);
      if (patch.archived !== undefined) workflow.archived = Boolean(patch.archived);
      if (steps) {
        workflow.steps = steps;
        // Editing the steps is a new version. Runs snapshot the definition they started
        // from, so a run in flight and a replay of it are unaffected by this edit.
        workflow.version += 1;
      }
      workflow.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'workflow.updated', result: 'success', details: { workflowId, version: workflow.version } });
      return workflow;
    });
  }

  listWorkflows({ projectId = null, includeArchived = false } = {}) {
    return this.store.read().workflows
      .filter((workflow) => (includeArchived || !workflow.archived) && (!projectId || workflow.projectId === projectId));
  }

  getWorkflow(workflowId) {
    return find(this.store.read().workflows, workflowId, 'Workflow');
  }

  // -- runs -----------------------------------------------------------------------

  /**
   * Starts a run. `idempotencyKey` makes this safe to retry: a second call with the same
   * key on the same workflow returns the run the first call created, marked
   * `deduplicated`, instead of starting a second one. A retried POST is the ordinary
   * case — a dropped response, a double-clicked button — not an exotic one.
   */
  createRun({ workflowId, input = null, idempotencyKey = null, projectId = null } = {}, actorId = 'system') {
    const key = idempotencyKey === null || idempotencyKey === undefined ? null : String(idempotencyKey).trim() || null;
    return this.store.transact((state) => {
      const workflow = find(state.workflows, workflowId, 'Workflow');
      if (workflow.archived) throw err('An archived workflow cannot be run.', 409);
      if (key) {
        const existing = state.workflowRuns.find((run) => run.workflowId === workflowId && run.idempotencyKey === key);
        if (existing) {
          this.ledger?.append({ actor: actorId, action: 'workflow.run-deduplicated', result: 'success', details: { runId: existing.id, idempotencyKey: key } });
          return { ...existing, deduplicated: true };
        }
      }
      const run = this.#newRun({ workflow, input, idempotencyKey: key, projectId, replayOf: null, actorId });
      state.workflowRuns.push(run);
      return run;
    });
  }

  #newRun({ workflow, input, idempotencyKey, projectId, replayOf, actorId }) {
    const run = {
      id: randomUUID(),
      workflowId: workflow.id,
      // The definition travels with the run. Without this snapshot, editing a workflow
      // would silently rewrite the history of everything that already ran from it, and a
      // replay would not replay what happened.
      definition: { name: workflow.name, version: workflow.version, steps: structuredClone(workflow.steps) },
      projectId: projectId ?? workflow.projectId ?? null,
      status: 'pending',
      input,
      output: null,
      idempotencyKey,
      replayOf,
      error: null,
      cancellationRequested: false,
      steps: workflow.steps.map((step) => ({
        id: randomUUID(),
        key: step.key,
        index: step.index,
        type: step.type,
        title: step.title,
        status: 'pending',
        attempts: [],
        output: null,
        error: null,
        approval: step.requiresApproval ? { required: true, decision: null, decidedBy: null, decidedAt: null, reason: null } : { required: false, decision: null, decidedBy: null, decidedAt: null, reason: null },
        compensation: step.compensation ? { status: 'not_required', at: null, error: null } : null,
        startedAt: null,
        completedAt: null,
      })),
      evidence: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.#evidence(run, { stepKey: null, event: 'run.created', detail: { workflowVersion: workflow.version, replayOf } });
    this.ledger?.append({ actor: actorId, action: 'workflow.run-created', result: 'success', details: { runId: run.id, workflowId: workflow.id, replayOf } });
    return run;
  }

  // Evidence is append-only and sequenced. It records what happened, including the
  // attempts that failed — a log that only keeps successes cannot explain an outcome.
  #evidence(run, { stepKey, event, detail = {} }) {
    run.evidence.push({ seq: run.evidence.length + 1, at: now(), stepKey, event, detail });
    if (run.evidence.length > 2000) throw err('Run evidence exceeded 2000 records; refusing to grow further.', 507);
  }

  listRuns({ projectId = null, workflowId = null, status = null } = {}) {
    return this.store.read().workflowRuns.filter((run) =>
      (!projectId || run.projectId === projectId)
      && (!workflowId || run.workflowId === workflowId)
      && (!status || run.status === status));
  }

  getRun(runId) {
    return find(this.store.read().workflowRuns, runId, 'Workflow run');
  }

  cancelRun(runId, { reason = 'cancelled by operator' } = {}, actorId = 'system') {
    const cancelled = this.store.transact((state) => {
      const run = find(state.workflowRuns, runId, 'Workflow run');
      if (RUN_TERMINAL.has(run.status)) throw err(`Run is already ${run.status}.`, 409);
      run.cancellationRequested = true;
      run.status = 'cancelling';
      run.updatedAt = now();
      for (const step of run.steps) {
        if (step.status === 'pending' || step.status === 'awaiting_approval') {
          step.status = 'cancelled';
          step.completedAt = now();
        }
      }
      this.#evidence(run, { stepKey: null, event: 'run.cancellation-requested', detail: { reason, actorId } });
      this.ledger?.append({ actor: actorId, action: 'workflow.run-cancelled', result: 'cancelled', details: { runId, reason } });
      return run;
    });
    // Cancelling is not the end of the story: work that already completed may need
    // undoing. Compensation runs on the way out, in reverse order.
    return this.#compensate(cancelled.id, 'cancelled', reason, actorId);
  }

  /**
   * Replays a run: a new run from the same definition snapshot and the same input,
   * linked to the original. The original is never mutated — a replay that overwrote its
   * own evidence would destroy the only record of what it is being compared against.
   */
  replayRun(runId, actorId = 'system') {
    return this.store.transact((state) => {
      const original = find(state.workflowRuns, runId, 'Workflow run');
      if (!RUN_TERMINAL.has(original.status)) throw err(`Only a finished run can be replayed; this one is ${original.status}.`, 409);
      const workflow = { id: original.workflowId, name: original.definition.name, version: original.definition.version, steps: original.definition.steps, projectId: original.projectId, archived: false };
      const replay = this.#newRun({
        workflow,
        input: structuredClone(original.input),
        // A replay is a deliberate re-execution, so it does not inherit the original's
        // idempotency key — that key exists to prevent an accidental second run.
        idempotencyKey: null,
        projectId: original.projectId,
        replayOf: original.id,
        actorId,
      });
      state.workflowRuns.push(replay);
      return replay;
    });
  }

  // -- approvals ------------------------------------------------------------------

  pendingApprovals({ projectId = null } = {}) {
    const runs = this.store.read().workflowRuns;
    const pending = [];
    for (const run of runs) {
      if (projectId && run.projectId !== projectId) continue;
      for (const step of run.steps) {
        if (step.status !== 'awaiting_approval') continue;
        pending.push({
          id: `workflow-step:${run.id}:${step.id}`,
          source: 'workflow',
          runId: run.id,
          stepId: step.id,
          stepKey: step.key,
          workflowId: run.workflowId,
          workflowName: run.definition.name,
          projectId: run.projectId,
          title: step.title,
          effects: STEP_TYPES[step.type]?.effects ?? [],
          requestedAt: step.startedAt ?? run.createdAt,
        });
      }
    }
    return pending;
  }

  decideApproval(runId, stepId, { decision, reason = null } = {}, actorId = 'system') {
    if (decision !== 'approve' && decision !== 'reject') throw err('Decision must be "approve" or "reject".');
    const decided = this.store.transact((state) => {
      const run = find(state.workflowRuns, runId, 'Workflow run');
      const step = find(run.steps, stepId, 'Workflow step');
      if (step.status !== 'awaiting_approval') throw err(`Step is not awaiting approval (status ${step.status}).`, 409);
      step.approval = { required: true, decision, decidedBy: actorId, decidedAt: now(), reason: reason === null ? null : String(reason) };
      step.status = decision === 'approve' ? 'pending' : 'rejected';
      if (decision === 'reject') {
        step.completedAt = now();
        run.status = 'rejecting';
      }
      run.updatedAt = now();
      this.#evidence(run, { stepKey: step.key, event: `step.${decision}ed`, detail: { actorId, reason } });
      this.ledger?.append({ actor: actorId, action: 'workflow.step-decision', result: decision === 'approve' ? 'approved' : 'rejected', details: { runId, stepKey: step.key } });
      return { run, rejected: decision === 'reject' };
    });
    if (decided.rejected) {
      return this.#compensate(runId, 'rejected', reason ?? 'rejected by approver', actorId);
    }
    return this.advance(runId, actorId);
  }

  // -- execution ------------------------------------------------------------------

  /**
   * Drives a run forward until it finishes, needs an approval, or fails. Each step's
   * status change is its own transaction, so a crash between two steps leaves a run whose
   * recorded state is exactly what actually happened.
   */
  async advance(runId, actorId = 'system') {
    if (this.advancing.has(runId)) throw err('This run is already being advanced.', 409);
    this.advancing.add(runId);
    try {
      // A step left `running` by a process that died is reconciled before anything else.
      //
      // Without this, such a step was silently SKIPPED: `next` only looks for `pending` or
      // `awaiting_approval`, so an interrupted step fell through and, if every other step
      // had finished, the run was reported `completed` — a run that reported success while
      // one of its steps never finished. The guard above guarantees no advance is in flight
      // for this run in this process, so a `running` step here is always an orphan.
      this.#reconcileInterrupted(runId, actorId);
      for (;;) {
        const run = this.getRun(runId);
        if (RUN_TERMINAL.has(run.status)) return run;
        if (run.cancellationRequested) return await this.#compensate(runId, 'cancelled', 'cancellation requested', actorId);

        const interrupted = run.steps.find((step) => step.status === 'interrupted');
        if (interrupted) {
          return await this.#compensate(runId, 'failed', `Step "${interrupted.key}" was interrupted before it finished.`, actorId);
        }

        const next = run.steps.find((step) => step.status === 'pending' || step.status === 'awaiting_approval');
        if (!next) return this.#finishRun(runId, 'completed', null, actorId);

        const definition = run.definition.steps.find((step) => step.key === next.key);
        if (!definition) return this.#finishRun(runId, 'failed', `Step "${next.key}" has no definition in the run snapshot.`, actorId);

        // An approval-gated step stops here and waits for a human. The run is not failed
        // and not running — it is suspended, and the approval queue is where it surfaces.
        if (definition.requiresApproval && next.approval.decision !== 'approve') {
          if (next.status !== 'awaiting_approval') {
            this.store.transact((state) => {
              const current = find(state.workflowRuns, runId, 'Workflow run');
              const step = find(current.steps, next.id, 'Workflow step');
              step.status = 'awaiting_approval';
              step.startedAt = step.startedAt ?? now();
              current.status = 'awaiting_approval';
              current.updatedAt = now();
              this.#evidence(current, { stepKey: step.key, event: 'step.awaiting-approval', detail: { effects: STEP_TYPES[step.type]?.effects ?? [] } });
            });
          }
          return this.getRun(runId);
        }

        const outcome = await this.#runStepWithRetries(runId, next.id, definition, actorId);
        if (!outcome.ok) {
          return await this.#compensate(runId, 'failed', outcome.error, actorId);
        }
      }
    } finally {
      this.advancing.delete(runId);
    }
  }

  // Marks steps abandoned mid-flight by a previous process. It records what it found in
  // the evidence rather than quietly repairing the record: "this step was interrupted" and
  // "this step failed on its own" are different facts and an operator needs to tell them
  // apart. Nothing is retried automatically — the run is failed and compensated, because
  // an interrupted step's effects are by definition unknown.
  #reconcileInterrupted(runId, actorId) {
    const run = this.getRun(runId);
    if (!run.steps.some((step) => step.status === 'running')) return;
    this.store.transact((state) => {
      const current = find(state.workflowRuns, runId, 'Workflow run');
      for (const step of current.steps) {
        if (step.status !== 'running') continue;
        step.status = 'interrupted';
        step.error = 'The process running this step stopped before it finished.';
        step.completedAt = now();
        const open = step.attempts.find((attempt) => !attempt.endedAt);
        if (open) { open.endedAt = now(); open.result = 'interrupted'; }
        this.#evidence(current, { stepKey: step.key, event: 'step.interrupted', detail: { actorId } });
      }
      current.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'workflow.run-interrupted', result: 'interrupted', details: { runId } });
    });
  }

  async #runStepWithRetries(runId, stepId, definition, actorId) {
    const maxAttempts = definition.retry.maxAttempts;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = now();
      // The attempt is recorded when it STARTS, not when it ends. An attempt written only
      // on completion leaves no trace at all if the process dies mid-step, so the record
      // would show a step that was never tried — and `#reconcileInterrupted` would have
      // nothing to close.
      this.store.transact((state) => {
        const run = find(state.workflowRuns, runId, 'Workflow run');
        const step = find(run.steps, stepId, 'Workflow step');
        step.status = 'running';
        step.startedAt = step.startedAt ?? now();
        step.attempts.push({ attempt, startedAt, endedAt: null, result: 'running', error: null });
        run.status = 'running';
        run.updatedAt = now();
        this.#evidence(run, { stepKey: step.key, event: 'step.attempt-started', detail: { attempt, maxAttempts } });
      });

      try {
        const stepInput = this.#stepInput(runId, definition);
        const output = await withTimeout(this.#executeStep(definition, stepInput, { runId, actorId }), definition.timeoutMs, `Step "${definition.key}"`);
        this.store.transact((state) => {
          const run = find(state.workflowRuns, runId, 'Workflow run');
          const step = find(run.steps, stepId, 'Workflow step');
          const record = step.attempts.find((entry) => entry.attempt === attempt) ?? step.attempts[step.attempts.length - 1];
          Object.assign(record, { endedAt: now(), result: 'completed', error: null });
          step.status = 'completed';
          step.output = output ?? null;
          step.completedAt = now();
          if (step.compensation) step.compensation.status = 'pending';
          run.updatedAt = now();
          this.#evidence(run, { stepKey: step.key, event: 'step.completed', detail: { attempt } });
        });
        return { ok: true };
      } catch (error) {
        lastError = error.message;
        const willRetry = attempt < maxAttempts;
        this.store.transact((state) => {
          const run = find(state.workflowRuns, runId, 'Workflow run');
          const step = find(run.steps, stepId, 'Workflow step');
          const record = step.attempts.find((entry) => entry.attempt === attempt) ?? step.attempts[step.attempts.length - 1];
          Object.assign(record, { endedAt: now(), result: error.status === 504 ? 'timed_out' : 'failed', error: error.message });
          step.error = error.message;
          if (!willRetry) {
            step.status = 'failed';
            step.completedAt = now();
          }
          run.updatedAt = now();
          this.#evidence(run, { stepKey: step.key, event: willRetry ? 'step.attempt-failed' : 'step.failed', detail: { attempt, error: error.message } });
        });
        if (willRetry && definition.retry.backoffMs > 0) {
          await new Promise((resolve) => { const timer = setTimeout(resolve, definition.retry.backoffMs); timer.unref?.(); });
        }
        // A cancellation that arrives between attempts is honoured instead of retrying
        // into work the operator has already asked to stop.
        if (willRetry && this.getRun(runId).cancellationRequested) return { ok: false, error: 'cancelled during retry backoff' };
      }
    }
    return { ok: false, error: lastError };
  }

  // A step reads the output of the previous completed step, or the run input if it is
  // first. Explicit `input` on the definition overrides that.
  #stepInput(runId, definition) {
    const run = this.getRun(runId);
    if (definition.input !== null && definition.input !== undefined) return definition.input;
    const ordered = run.steps.filter((step) => step.index < definition.index && step.status === 'completed');
    const previous = ordered[ordered.length - 1];
    return previous ? previous.output : run.input;
  }

  async #executeStep(definition, input, { runId, actorId }) {
    const type = STEP_TYPES[definition.type];
    if (!type) throw err(`Unknown step type: ${definition.type}.`);
    if (type.executable === false) {
      throw err(`Step type "${definition.type}" is not executable in this build; it is owned by the ${type.enforcedBy}.`, 501);
    }
    switch (definition.type) {
      case 'transform':
        return TRANSFORM_OPS[definition.operation](input, definition.config);
      case 'wait':
        if (definition.durationMs > 0) {
          await new Promise((resolve) => { const timer = setTimeout(resolve, definition.durationMs); timer.unref?.(); });
        }
        return input;
      case 'human_approval':
        // Reaching here means the approval was granted; the gate is in `advance`.
        return { approved: true, input };
      case 'tool_call': {
        if (!this.executor) throw err('Tool execution is unavailable on this installation.', 503);
        const tool = find(this.store.read().tools, definition.toolId, 'Tool');
        if (tool.disabled) throw err(`Tool "${tool.name}" is disabled.`, 409);
        if (!tool.consent?.granted) throw err(`Tool "${tool.name}" has no granted consent; every tool is default-deny.`, 403);
        return await this.executor.execute(tool, input, { actorId, projectId: this.getRun(runId).projectId });
      }
      default:
        throw err(`Step type "${definition.type}" has no executor.`, 501);
    }
  }

  // -- compensation ---------------------------------------------------------------

  /**
   * Undoes completed work in reverse order. A compensation that fails is recorded and the
   * run ends `compensation_failed` — never swallowed, because a half-undone run that
   * reports success is worse than one that reports the truth.
   */
  async #compensate(runId, terminalStatus, reason, actorId) {
    const toCompensate = this.getRun(runId).steps
      .filter((step) => step.status === 'completed' && step.compensation && step.compensation.status === 'pending')
      .sort((left, right) => right.index - left.index);

    let compensationFailed = false;
    for (const step of toCompensate) {
      const definition = this.getRun(runId).definition.steps.find((candidate) => candidate.key === step.key);
      const compensation = definition?.compensation;
      if (!compensation) continue;
      try {
        const output = await withTimeout(
          this.#executeStep({ ...compensation, key: `${step.key}:compensation`, index: step.index, input: step.output, durationMs: 0 }, step.output, { runId, actorId }),
          compensation.timeoutMs,
          `Compensation for "${step.key}"`,
        );
        this.store.transact((state) => {
          const run = find(state.workflowRuns, runId, 'Workflow run');
          const record = find(run.steps, step.id, 'Workflow step');
          record.compensation = { status: 'compensated', at: now(), error: null, output: output ?? null };
          run.updatedAt = now();
          this.#evidence(run, { stepKey: step.key, event: 'step.compensated', detail: {} });
        });
      } catch (error) {
        compensationFailed = true;
        this.store.transact((state) => {
          const run = find(state.workflowRuns, runId, 'Workflow run');
          const record = find(run.steps, step.id, 'Workflow step');
          record.compensation = { status: 'failed', at: now(), error: error.message, output: null };
          run.updatedAt = now();
          this.#evidence(run, { stepKey: step.key, event: 'step.compensation-failed', detail: { error: error.message } });
        });
      }
    }
    return this.#finishRun(runId, compensationFailed ? 'compensation_failed' : terminalStatus, reason, actorId);
  }

  #finishRun(runId, status, error, actorId) {
    return this.store.transact((state) => {
      const run = find(state.workflowRuns, runId, 'Workflow run');
      run.status = status;
      run.error = error ?? null;
      const completed = run.steps.filter((step) => step.status === 'completed');
      run.output = status === 'completed' && completed.length ? completed[completed.length - 1].output : run.output;
      run.updatedAt = now();
      this.#evidence(run, { stepKey: null, event: `run.${status}`, detail: { error: error ?? null } });
      this.ledger?.append({ actor: actorId, action: 'workflow.run-finished', result: status, details: { runId, error: error ?? null } });
      return run;
    });
  }
}
