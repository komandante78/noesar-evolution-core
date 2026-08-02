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
import { findingAsGatheredEvidence, hypothesisToEvidenceRows, TRIAGE_ROLE_INTENTS } from './debug-evolution-triage.mjs';
import { fetchRemoteTarget } from './remote-target-fetch.mjs';
import { buildProbeSpec, describeProbeSpec } from './api-target-probe.mjs';

const NOESAR_PROJECT_NAME_PREFIX = 'NOESAR EVOLUTION';
// Six requests at the toolpack's own 20s per-request ceiling, plus a TLS handshake and the
// interpreter start, with room left over. Deliberately not `callDebugEvolution`'s 30s.
const PROBE_TIMEOUT_MS = 180_000;

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
 * D-0284/D-0285: one finding, one `hypothesize()` call PER ROLE in `TRIAGE_ROLE_INTENTS`
 * (`discovery`+`skeptic` combined, then `security`, then `root-cause` — three calls, not
 * six, because `Hypothesis.contrary` already covers skeptic's half of the first). Every
 * resulting evidence row across all three is submitted, tagged with which role produced it,
 * then a single attempt at `DETECTED -> HYPOTHESIZED` — legal by `de_v2/core.py`'s own
 * `TRANSITIONS` map with no evidence gate on that specific target, so this always either
 * succeeds or fails on something Debug Evolution's own state machine decided, never on a
 * count this module invented. A role returning zero hypotheses is a real, legitimate answer
 * ("nothing to hypothesize" is not the same as a refusal) and contributes nothing rather
 * than being retried.
 */
async function triageFinding(finding, { router, token }) {
  const gathered = findingAsGatheredEvidence(finding);
  let evidenceAdded = 0;
  let totalHypotheses = 0;
  const statements = [];
  for (const { role, buildIntent } of TRIAGE_ROLE_INTENTS) {
    const hypotheses = await router.hypothesize(buildIntent(finding), gathered);
    totalHypotheses += hypotheses.length;
    for (const hypothesis of hypotheses) {
      statements.push(`${role}: ${hypothesis.statement}`);
      for (const row of hypothesisToEvidenceRows(hypothesis, role)) {
        await callDebugEvolution(`/api/v2/findings/${encodeURIComponent(finding.id)}/evidence`, { method: 'POST', token, body: row });
        evidenceAdded += 1;
      }
    }
  }
  if (!totalHypotheses) {
    return { id: finding.id, ok: true, skipped: true, reason: 'no hypothesis returned by any role', evidenceAdded: 0 };
  }
  const rationale = statements.join(' | ');
  // Attempted only from DETECTED. A finding that a probe or the sandbox already advanced to
  // HYPOTHESIZED is not stuck — it is past this step, and `HYPOTHESIZED -> HYPOTHESIZED` is
  // not a legal edge in Debug Evolution's own state machine, so asking for it would fail the
  // whole call AFTER the evidence had already been attached. The evidence is the product
  // here; the state was earned earlier by something that actually observed the system.
  if (finding.state !== 'DETECTED') {
    return { id: finding.id, ok: true, skipped: false, evidenceAdded, hypotheses: totalHypotheses,
             state: finding.state, transitioned: false,
             reason: `già oltre DETECTED (${finding.state}): allegate le ipotesi, nessuna transizione richiesta` };
  }
  const transitioned = await callDebugEvolution(`/api/v2/findings/${encodeURIComponent(finding.id)}/transition`, {
    method: 'POST', token, body: { target: 'HYPOTHESIZED', actor: 'atom', rationale },
  });
  return { id: finding.id, ok: true, skipped: false, evidenceAdded, hypotheses: totalHypotheses, state: transitioned.state, transitioned: true };
}

/**
 * D-0293: one finding, judged on demand, whatever state it is in.
 *
 * `triageUnclassifiedFindings()` below sweeps `DETECTED` findings across every project whose
 * name starts with `NOESAR EVOLUTION`. Both halves of that make it the wrong instrument for
 * a single verdict: an API target's findings are born `HYPOTHESIZED` (the probe observed
 * them, it did not guess them), so the sweep never sees one — and a sweep launched to judge
 * one finding would wake ATOM on every other `DETECTED` finding in the installation.
 *
 * So this exists beside it rather than replacing it: same roles, same evidence rows, same
 * refusal semantics, one finding.
 */
export async function triageFindingById(findingId, router) {
  const token = debugEvolutionToken();
  if (!token) {
    const error = Object.assign(new Error('NOESAR_DEBUG_EVOLUTION_TOKEN is not configured on this deployment.'), { status: 503 });
    throw error;
  }
  const court = await callDebugEvolution(`/api/v2/findings/${encodeURIComponent(findingId)}/court`, { token });
  const finding = court.finding;
  if (!finding) {
    const error = Object.assign(new Error('Finding not found in Debug Evolution.'), { status: 404 });
    throw error;
  }
  return triageFinding(finding, { router, token });
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

/**
 * D-0286: Debug Evolution's Phase 3, the second half — `remote-target-fetch.mjs` did the
 * SSH work and handed back a `.tar.gz` buffer; this uploads it to Debug Evolution's own
 * `POST /api/v2/projects/import`, the one write in this bridge whose body is not JSON, so
 * it does not go through `callDebugEvolution()` above. `slug` is the target's OWN id — a
 * `randomUUID()` is already lowercase hex and hyphens, which is exactly the alphabet Debug
 * Evolution's `SLUG_RE` accepts, and using the id (stable for the target's whole life)
 * rather than its name (which an Owner can rename) is what makes a re-fetch overwrite the
 * SAME directory instead of scattering a new one per rename.
 */
async function uploadImportToDebugEvolution({ name, slug, tarBuffer, token }) {
  const query = new URLSearchParams({ name, slug });
  const response = await fetch(`${debugEvolutionBaseUrl()}/api/v2/projects/import?${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/gzip' },
    body: tarBuffer,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
  if (!response.ok) {
    const error = Object.assign(new Error(`Debug Evolution import failed (${response.status}): ${json.error ?? text}`), { status: 502 });
    throw error;
  }
  return json;
}

/**
 * Fetches `target.remotePath` over SSH (verified against the host key pinned at
 * registration — `remote-target-fetch.mjs` never relaxes `StrictHostKeyChecking`) and
 * registers the result in Debug Evolution as a project. `privateKeyPem` is the caller's
 * concern to decrypt (`RemoteTargetRegistry.resolveCredential()`, in `server.mjs`'s route
 * handler) and to never log — this function only receives it, uses it for the one `scp`
 * call inside `fetchRemoteTarget()`, and it is gone the moment that call's own `finally`
 * cleans up its tmpfs directory.
 */
export async function fetchAndScanRemoteTarget(target, privateKeyPem) {
  const token = debugEvolutionToken();
  if (!token) {
    const error = Object.assign(new Error('NOESAR_DEBUG_EVOLUTION_TOKEN is not configured on this deployment.'), { status: 503 });
    throw error;
  }
  const tarBuffer = await fetchRemoteTarget({ target, privateKeyPem });
  const result = await uploadImportToDebugEvolution({ name: target.name, slug: target.id, tarBuffer, token });
  return { projectId: result.project?.id ?? null, findingCount: result.finding_count, nodeCount: result.node_count };
}

/**
 * D-0292: an API target (Owner s305, point C). The mirror image of the SSH case above —
 * there NOESAR does the work and the module receives the result; here the module does the
 * work, because `remote-api.pyz` lives in its image and NOESAR has no Python interpreter to
 * run it with. `api-target-probe.mjs`'s own header explains why that inversion also
 * inverts where the credential goes, and what is and is not claimed about it.
 *
 * Not routed through `callDebugEvolution()` for one measured reason: that helper's 30s
 * timeout is shorter than a probe's own worst case. Six requests at the toolpack's 20s
 * per-request ceiling, plus a TLS handshake, can legitimately exceed it, and a probe cut
 * short by NOESAR's clock would look to an Owner like a target that failed rather than a
 * caller that gave up.
 */
export async function probeApiTarget(target, credentialHeaders) {
  const token = debugEvolutionToken();
  if (!token) {
    const error = Object.assign(new Error('NOESAR_DEBUG_EVOLUTION_TOKEN is not configured on this deployment.'), { status: 503 });
    throw error;
  }
  const spec = buildProbeSpec(target, credentialHeaders);
  const response = await fetch(`${debugEvolutionBaseUrl()}/api/v2/api-probe`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(spec),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
  if (!response.ok) {
    // `describeProbeSpec` and not `spec`: an error message is exactly the kind of string
    // that ends up in a log, a ledger entry and a browser console, and the credential must
    // not be in any of them.
    const error = Object.assign(
      new Error(`Debug Evolution probe failed (${response.status}): ${json.error ?? text}`),
      { status: 502, probe: describeProbeSpec(spec) },
    );
    throw error;
  }
  return {
    projectId: json.project?.id ?? null,
    findingCount: json.finding_count ?? 0,
    steps: json.steps ?? [],
    findings: json.findings ?? [],
  };
}
