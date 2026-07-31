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

const NOESAR_PROJECT_NAME_PREFIX = 'NOESAR EVOLUTION';

function debugEvolutionBaseUrl() {
  return String(process.env.NOESAR_DEBUG_EVOLUTION_URL ?? 'http://192.168.178.100:8787').replace(/\/$/, '');
}

function debugEvolutionToken() {
  return process.env.NOESAR_DEBUG_EVOLUTION_TOKEN ?? null;
}

async function callDebugEvolution(path, { method = 'GET', token } = {}) {
  const response = await fetch(`${debugEvolutionBaseUrl()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
