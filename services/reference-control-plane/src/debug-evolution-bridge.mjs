// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0278: Debug Evolution as a real, usable tool — not a sidebar bookmark. Owner
// feedback, verbatim: "debug funziona con tutte le chat? anche con coden evolution?...
// devi collegarlo a tutto noesar". Debug Evolution already exposes a real HTTP API
// (`/api/v2/*`, Bearer-token authenticated) — this module is the one piece that API
// cannot do generically: rebuild ALL of NOESAR Evolution's already-registered projects in
// one call, because Debug Evolution's own `POST /api/v2/projects/{id}/genome/rebuild`
// takes one project id in the URL PATH, and the generic tool executor
// (`ai-workspace/tool-executor.mjs`) calls one FIXED endpoint per registered tool with no
// per-call path parameter. Everything else (list projects, all findings, SARIF) needs no
// bridge at all — those are registered as plain HTTP tools straight at Debug Evolution's
// API, credential-vaulted, usable from both Agents and Workflows (the two destinations
// that already share this same tool-execution engine — see `agent-service.mjs`/
// `workflow-service.mjs`).
//
// Chat itself has no autonomous tool-calling loop in this reference implementation, for
// ANY tool, not only this one — `POST /api/v1/conversations/:id/messages` is a message
// store, not an LLM function-calling engine. Registering Debug Evolution as a tool makes
// it a first-class citizen of the ONE tool system this product actually has (Agents +
// Workflows), the most honest reading of "collegato a tutto noesar" this codebase
// supports today.

import { ReasoningUnavailable } from './reasoning-router.mjs';
import { ReasoningRefused } from './reasoning.mjs';
import { findingAsGatheredEvidence, findingAsIntent, hypothesisToEvidenceRows } from './debug-evolution-triage.mjs';

const NOESAR_PROJECT_NAME_PREFIX = 'NOESAR EVOLUTION';

function debugEvolutionBaseUrl() {
  return String(process.env.NOESAR_DEBUG_EVOLUTION_URL ?? 'http://192.168.178.100:8787').replace(/\/$/, '');
}

function debugEvolutionToken() {
  return process.env.NOESAR_DEBUG_EVOLUTION_TOKEN ?? null;
}

async function callDebugEvolution(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${debugEvolutionBaseUrl()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
  if (!response.ok) {
    const error = Object.assign(new Error(`Debug Evolution request failed (${response.status}): ${json.error ?? text}`), { status: 502 });
    throw error;
  }
  return json;
}

/**
 * Rebuilds every already-registered NOESAR EVOLUTION sub-project (14 of them, one per
 * source area — see D-0273's live inventory) and returns a summary per project. Debug
 * Evolution's own `register()`/`rebuild()` are synchronous (no job queue), so this is a
 * sequential loop, not a fan-out — a large tree would make this slow, named rather than
 * hidden behind a fire-and-forget response.
 */
export async function rescanNoesarEvolutionProjects() {
  const token = debugEvolutionToken();
  if (!token) {
    const error = Object.assign(new Error('NOESAR_DEBUG_EVOLUTION_TOKEN is not configured on this deployment.'), { status: 503 });
    throw error;
  }
  const { projects } = await callDebugEvolution('/api/v2/projects', { token });
  const targets = projects.filter((project) => String(project.name ?? '').startsWith(NOESAR_PROJECT_NAME_PREFIX));
  const results = [];
  for (const project of targets) {
    try {
      const result = await callDebugEvolution(`/api/v2/projects/${encodeURIComponent(project.id)}/genome/rebuild`, { method: 'POST', token });
      results.push({ id: project.id, name: project.name, ok: true, findingCount: result.finding_count, nodeCount: result.node_count });
    } catch (error) {
      results.push({ id: project.id, name: project.name, ok: false, error: error.message });
    }
  }
  return { rescanned: results.length, succeeded: results.filter((r) => r.ok).length, results };
}

/**
 * D-0284: one finding, one call to `hypothesize()` (discovery + skeptic in the same answer —
 * see `debug-evolution-triage.mjs`'s header), every resulting evidence row submitted, then a
 * single attempt at `DETECTED -> HYPOTHESIZED` — legal by `de_v2/core.py`'s own `TRANSITIONS`
 * map with no evidence gate on that specific target, so this always either succeeds or fails
 * on something Debug Evolution's own state machine decided, never on a count this module
 * invented. `hypotheses.length === 0` is a real, legitimate answer ("nothing to hypothesize"
 * is not the same as a refusal) and is reported as skipped rather than retried blindly by a
 * caller that cannot tell the two apart.
 */
async function triageFinding(finding, { router, token }) {
  const intent = findingAsIntent(finding);
  const gathered = findingAsGatheredEvidence(finding);
  const hypotheses = await router.hypothesize(intent, gathered);
  if (!hypotheses.length) {
    return { id: finding.id, ok: true, skipped: true, reason: 'no hypothesis returned', evidenceAdded: 0 };
  }
  let evidenceAdded = 0;
  for (const hypothesis of hypotheses) {
    for (const row of hypothesisToEvidenceRows(hypothesis)) {
      await callDebugEvolution(`/api/v2/findings/${encodeURIComponent(finding.id)}/evidence`, { method: 'POST', token, body: row });
      evidenceAdded += 1;
    }
  }
  const rationale = hypotheses.map((hypothesis) => hypothesis.statement).join(' | ');
  const transitioned = await callDebugEvolution(`/api/v2/findings/${encodeURIComponent(finding.id)}/transition`, {
    method: 'POST', token, body: { target: 'HYPOTHESIZED', actor: 'atom', rationale },
  });
  return { id: finding.id, ok: true, skipped: false, evidenceAdded, hypotheses: hypotheses.length, state: transitioned.state };
}

/**
 * Every `DETECTED` finding across every already-registered NOESAR EVOLUTION project (same
 * `NOESAR_PROJECT_NAME_PREFIX` filter and the same sequential-loop reasoning as
 * `rescanNoesarEvolutionProjects()` above: Debug Evolution's own endpoints have no job
 * queue). One finding failing does not stop the rest. `router` is the caller's
 * `ReasoningRouter` (constructed with the product's own `workspaceRoot`, same idiom as
 * `POST /api/v1/reasoning/plan`) rather than one built here — this module has no opinion
 * about workspace roots, only about findings.
 */
export async function triageUnclassifiedFindings(router) {
  const token = debugEvolutionToken();
  if (!token) {
    const error = Object.assign(new Error('NOESAR_DEBUG_EVOLUTION_TOKEN is not configured on this deployment.'), { status: 503 });
    throw error;
  }
  const { projects } = await callDebugEvolution('/api/v2/projects', { token });
  const targets = projects.filter((project) => String(project.name ?? '').startsWith(NOESAR_PROJECT_NAME_PREFIX));
  const results = [];
  for (const project of targets) {
    const { findings } = await callDebugEvolution(`/api/v2/findings?project_id=${encodeURIComponent(project.id)}`, { token });
    for (const finding of findings.filter((item) => item.state === 'DETECTED')) {
      try {
        results.push(await triageFinding(finding, { router, token }));
      } catch (error) {
        if (error instanceof ReasoningRefused) {
          results.push({ id: finding.id, ok: false, reason: `atom refused: ${error.reason}` });
        } else if (error instanceof ReasoningUnavailable) {
          results.push({ id: finding.id, ok: false, reason: `atom unavailable: ${error.reason}` });
        } else {
          results.push({ id: finding.id, ok: false, reason: error.message });
        }
      }
    }
  }
  return { triaged: results.length, succeeded: results.filter((r) => r.ok).length, results };
}
