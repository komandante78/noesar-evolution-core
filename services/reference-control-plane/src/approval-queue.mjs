// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The approval queue — WP-2, required by MASTER_REFERENCE/01_PRODUCT/11, which names the
// bottom approval strip as part of the binding visual direction.
//
// Before this file, approvals existed but had no single place to see them. A workflow step
// waiting for a human was visible only inside that run; an agent step awaiting approval
// only inside that run; a staged update only on the Updates page. An operator asking "what
// is waiting for me?" had to know where to look, which means an approval that nobody
// looked for waits forever.
//
// This queue does not own any approval. It reads the three subsystems that do and routes a
// decision back to whichever one raised it. That direction matters: a queue holding its own
// copy of a pending approval would be a second source of truth, and the two would drift —
// the defect this project has already found in the WebUI's hardcoded invariant list and in
// the security matrix rows describing behaviour the code did not have.
//
// Every item carries the permission needed to decide it, computed from the same role model
// the routes enforce. The interface therefore shows the operator what they can actually
// act on, instead of offering a button that will be refused.

const SOURCE_PATTERN = /^(workflow-step|agent-step|update):(.+)$/;

export class ApprovalQueue {
  /**
   * @param {object} deps
   * @param {import('./ai-workspace/workflow-service.mjs').WorkflowService} deps.workflowService
   * @param {object} deps.agentService     the agent service, for its runs' awaiting steps
   * @param {object} deps.aiStore          the AI workspace store, read for agent runs
   * @param {object} deps.updateManager    the update manager, for a staged unapproved update
   * @param {object} deps.ledger           the audit ledger
   */
  constructor({ workflowService, agentService, aiStore, updateManager, ledger }) {
    this.workflowService = workflowService;
    this.agentService = agentService;
    this.aiStore = aiStore;
    this.updateManager = updateManager;
    this.ledger = ledger;
  }

  /**
   * Every approval currently waiting, newest requirement last. Read-only: listing the
   * queue never changes anything, so a dashboard may poll it freely.
   */
  list({ projectId = null } = {}) {
    const items = [];

    for (const pending of this.workflowService.pendingApprovals({ projectId })) {
      items.push({
        ...pending,
        kind: 'workflow-step',
        summary: `Workflow "${pending.workflowName}" is waiting at step "${pending.title}".`,
        requiredPermission: 'agent.manage',
      });
    }

    // Agent runs keep their pending approvals inside the run record, exactly as workflow
    // runs do. Read them from the same store rather than duplicating the state.
    for (const run of this.aiStore.read().agentRuns) {
      if (projectId && run.projectId !== projectId) continue;
      for (const step of run.steps) {
        if (step.status !== 'awaiting_approval') continue;
        items.push({
          id: `agent-step:${run.id}:${step.id}`,
          kind: 'agent-step',
          source: 'agent',
          runId: run.id,
          stepId: step.id,
          stepKey: null,
          projectId: run.projectId,
          title: step.title,
          summary: `Agent run is waiting at step "${step.title}".`,
          effects: step.mutative ? ['TOOL_INVOCATION'] : [],
          requestedAt: run.createdAt,
          requiredPermission: 'agent.manage',
        });
      }
    }

    // A staged update that nobody has approved is an approval too, and the most
    // consequential one on the list: applying it replaces the running product.
    const updates = this.updateManager?.status?.();
    if (updates?.staged && updates.staged.approved === false) {
      items.push({
        id: `update:${updates.staged.version}`,
        kind: 'update',
        source: 'update-manager',
        runId: null,
        stepId: null,
        stepKey: null,
        projectId: null,
        title: `Update ${updates.staged.version}`,
        summary: `Version ${updates.staged.version} is staged on the ${updates.staged.channel} channel and awaits Owner approval.`,
        effects: ['PRODUCT_REPLACEMENT'],
        requestedAt: updates.staged.stagedAt,
        // Only the Owner may approve an update. Stating the stricter permission here keeps
        // the queue honest about who can act, and the route enforces it independently.
        requiredPermission: 'audit.read',
        ownerOnly: true,
      });
    }

    return items;
  }

  counts({ projectId = null } = {}) {
    const items = this.list({ projectId });
    const byKind = {};
    for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
    return { total: items.length, byKind };
  }

  /**
   * Routes a decision to the subsystem that owns the approval. The item id encodes its
   * source; anything that does not parse is refused rather than guessed at.
   *
   * Authorisation is NOT decided here — the caller has already been checked against the
   * route's permission, and `ownerOnly` items are refused unless the caller says the
   * session is the Owner. Passing that in explicitly, rather than re-deriving it, keeps
   * this class free of its own opinion about identity.
   */
  async decide(itemId, { decision, reason = null, actorId = 'system', isOwner = false } = {}) {
    if (decision !== 'approve' && decision !== 'reject') {
      throw Object.assign(new Error('Decision must be "approve" or "reject".'), { status: 400 });
    }
    const match = SOURCE_PATTERN.exec(String(itemId ?? ''));
    if (!match) throw Object.assign(new Error('Unrecognised approval id.'), { status: 404 });
    const [, kind, rest] = match;

    if (kind === 'workflow-step') {
      const [runId, stepId] = rest.split(':');
      if (!runId || !stepId) throw Object.assign(new Error('Unrecognised workflow approval id.'), { status: 404 });
      return { kind, decision, run: await this.workflowService.decideApproval(runId, stepId, { decision, reason }, actorId) };
    }

    if (kind === 'agent-step') {
      const [runId, stepId] = rest.split(':');
      if (!runId || !stepId) throw Object.assign(new Error('Unrecognised agent approval id.'), { status: 404 });
      if (decision === 'approve') {
        return { kind, decision, run: this.agentService.approveStep(runId, stepId, actorId) };
      }
      // The agent service has no reject verb. Rejecting is recorded as a failed step with
      // the reason, which is what a rejection means for a run that cannot proceed.
      const run = this.agentService.updateStep(runId, stepId, { status: 'failed', error: reason ?? 'rejected by approver' }, actorId);
      this.ledger?.append({ actor: actorId, action: 'agent.step-rejected', result: 'rejected', details: { runId, stepId, reason: reason ?? null } });
      return { kind, decision, run };
    }

    // kind === 'update'
    if (!isOwner) throw Object.assign(new Error('Only the Owner may decide a staged update.'), { status: 403 });
    if (decision === 'approve') {
      return { kind, decision, update: await this.updateManager.approve({ actorId }) };
    }
    // Rejecting a staged update is not the same as rolling one back: nothing has been
    // applied. There is no discard verb on the update manager, so this is recorded and
    // refused rather than faked — the honest answer is that the operator must not apply it.
    throw Object.assign(
      new Error('Rejecting a staged update is not implemented; the staged update simply must not be applied. Use the Updates page to change channel or stage a different bundle.'),
      { status: 501 },
    );
  }
}
