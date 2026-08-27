// SPDX-License-Identifier: AGPL-3.0-or-later
//
// UI-080…089 — the Ricerca destination's real half: the intent gate (`research-gate.mjs`,
// UI-090…096) decides whether a query may leave; this module is what happens after PROCEED —
// dispatching to a real search provider and building the report `docs/WEBUI_DESIGN_V3.md`
// §19 describes.
//
// NO BUILT-IN PROVIDER, BY DESIGN (the platform law, `CLAUDE10.md` §16: self-hosted, never a
// vendor baked into the code). The provider is a `tools` connector — the SAME external-tool
// mechanism `agent-service.mjs`/`tool-executor.mjs` already built (consent-gated, HTTPS-only,
// SSRF-guarded, credential-vaulted) — designated by `state.settings.researchProviderToolId`.
// Reusing it rather than a parallel client means UI-089's "declared egress" is not new code:
// `privacy.mjs::derivePrivacy` already discloses an active external tool once consent is
// granted, so a configured-and-consented research provider is disclosed for free.
//
// TWO GATES (UI-091), the same client on both sides of the trip: `research-gate.mjs`'s
// `classify()` is asked once on the outgoing objective+criteria (intent), and once more on
// the returned report's own text (content) before it is ever stored or shown. A REFUSE on
// either side discards whatever was produced on this call — nothing partial is kept.
//
// EPHEMERAL BY DESIGN (UI-081/082): reports live in memory, not Postgres. A restart revokes
// every live link along with everything else in memory — for a report whose whole point is a
// short-lived, revocable, session-gated link, that is the declared behaviour, not a gap: it
// needs no migration, and "gone after a restart" is a stronger property than "expires in
// 24h" would be on its own. Documented, not silently assumed.

import { randomUUID } from 'node:crypto';

export const REPORT_TTL_MS = 24 * 60 * 60 * 1000; // UI-081's declared expiry
const MAX_OBJECTIVE_LENGTH = 500;
const MAX_CRITERIA = 12;
const EVIDENCE_KINDS = Object.freeze(['SOURCE_FACT', 'MEASURED_AGGREGATE', 'INFERENCE', 'NOT_VERIFIED']); // UI-084

function err(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

/** UI-088: the exact string that left the product, built only from objective+criteria — never
 * from anything else open in the workspace. Shown back to the caller verbatim. */
export function buildQueryEcho(objective, criteria) {
  return JSON.stringify({ objective, criteria: [...criteria].sort() });
}

/**
 * UI-084/085/086/087: a candidate the provider returns must already carry typed evidence,
 * declared evidence quality, an exclusion reason if filtered, and a sponsored flag — this
 * product does not manufacture any of those after the fact, because inventing evidence
 * quality for evidence it never saw would be exactly the fabrication UI-085 exists to
 * prevent. A candidate missing a required field is refused as a malformed answer (kind
 * INTERNAL, matching `research-gate.mjs`'s own vocabulary for "the far side answered but not
 * validly"), not silently patched with a default.
 */
export function validateCandidate(candidate, index) {
  const where = `candidate[${index}]`;
  if (!candidate || typeof candidate !== 'object') throw err(`${where} is not an object.`, 502, { kind:'INTERNAL' });
  if (!String(candidate.name ?? '').trim()) throw err(`${where}.name is required.`, 502, { kind:'INTERNAL' });
  if (candidate.excluded) {
    if (!String(candidate.excludedReason ?? '').trim()) {
      throw err(`${where} is excluded but names no reason (UI-086).`, 502, { kind:'INTERNAL' });
    }
    return { name:String(candidate.name), excluded:true, excludedReason:String(candidate.excludedReason) };
  }
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
  if (!evidence.length) throw err(`${where}.evidence must be a non-empty array (UI-084).`, 502, { kind:'INTERNAL' });
  const typedEvidence = evidence.map((row, rowIndex) => {
    if (!EVIDENCE_KINDS.includes(row?.kind)) {
      throw err(`${where}.evidence[${rowIndex}].kind must be one of ${EVIDENCE_KINDS.join(', ')} (UI-084).`, 502, { kind:'INTERNAL' });
    }
    if (!String(row.statement ?? '').trim()) throw err(`${where}.evidence[${rowIndex}].statement is required.`, 502, { kind:'INTERNAL' });
    return { kind:row.kind, statement:String(row.statement) };
  });
  const quality = candidate.evidenceQuality ?? {};
  if (!Number.isFinite(quality.reviewCount) || quality.reviewCount < 0) {
    throw err(`${where}.evidenceQuality.reviewCount must be a number (UI-085).`, 502, { kind:'INTERNAL' });
  }
  return {
    name: String(candidate.name),
    excluded: false,
    volatileObservedAt: candidate.volatileObservedAt ? String(candidate.volatileObservedAt) : null, // UI-083
    evidence: typedEvidence,
    evidenceQuality: {
      reviewCount: Number(quality.reviewCount),
      timeSpanDays: Number.isFinite(quality.timeSpanDays) ? Number(quality.timeSpanDays) : null,
      verifiedPurchaseShare: Number.isFinite(quality.verifiedPurchaseShare) ? Number(quality.verifiedPurchaseShare) : null,
      anomalyFlag: Boolean(quality.anomalyFlag),
      anomalyNote: quality.anomalyFlag ? String(quality.anomalyNote ?? 'Distribution flagged as anomalous by the provider.') : null,
    },
    sponsored: Boolean(candidate.sponsored), // UI-087 — declared, never an affiliate link
    affiliateLink: false, // UI-087 — structurally false; this product emits no affiliate field to violate
  };
}

export function validateReportPayload(payload) {
  if (!payload || typeof payload !== 'object') throw err('The provider answered with something that is not a report.', 502, { kind:'INTERNAL' });
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!candidates.length) throw err('The provider returned no candidates.', 502, { kind:'INTERNAL' });
  return candidates.map((candidate, index) => validateCandidate(candidate, index));
}

/** In-memory, ephemeral, revocable (UI-081/082). Not a cache of anything durable. */
export class ResearchReportStore {
  #reports = new Map();

  put({ id = randomUUID(), createdBy, objective, criteria, queryEcho, candidates, nowMs = Date.now(), ttlMs = REPORT_TTL_MS }) {
    const record = Object.freeze({
      id, createdBy, objective, criteria: Object.freeze([...criteria]),
      queryEcho, candidates: Object.freeze(candidates),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
      revoked: false,
    });
    this.#reports.set(id, record);
    return record;
  }

  /** Returns null for missing, expired or revoked — the three cases UI-081/082 collapse into
   * one "this link no longer works" answer, on purpose: distinguishing them to a caller who
   * does not hold the report would leak whether a given id ever existed. */
  get(id, { nowMs = Date.now() } = {}) {
    const record = this.#reports.get(id);
    if (!record) return null;
    if (record.revoked) return null;
    if (Date.parse(record.expiresAt) <= nowMs) return null;
    return record;
  }

  /** The reports this person can still open, newest first and WITHOUT their candidates: a list
   *  is a way back to a report, not a second copy of one. Same three-way collapse as `get` —
   *  expired, revoked and never-existed are all simply absent, and one person never sees that
   *  another ran anything. Nothing is persisted by this: what a restart forgets stays forgotten
   *  (`UI-080…089`). */
  list({ createdBy, nowMs = Date.now() } = {}) {
    return [...this.#reports.values()]
      .filter((record) => record.createdBy === createdBy && !record.revoked && Date.parse(record.expiresAt) > nowMs)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(({ id, objective, criteria, createdAt, expiresAt }) => ({ id, objective, criteria:[...criteria], createdAt, expiresAt }));
  }

  revoke(id, { actorId, nowMs = Date.now() }) {
    const record = this.#reports.get(id);
    if (!record || record.revoked) return null;
    const revoked = Object.freeze({ ...record, revoked:true, revokedAt:new Date(nowMs).toISOString(), revokedBy:actorId });
    this.#reports.set(id, revoked);
    return revoked;
  }
}

/** UI-096: a refusal is contestable. Kept apart from the audit ledger's own append-only log
 * because a contest needs to be *looked up and answered*, not just recorded — the ledger
 * remains the permanent trail (`research.gate-contested` is appended there too), this map is
 * only what lets `POST .../contest` validate that `refusalId` names a refusal that happened. */
export class RefusalRegistry {
  #refusals = new Map();
  #maxEntries;

  constructor({ maxEntries = 500 } = {}) {
    this.#maxEntries = maxEntries;
  }

  record({ id = randomUUID(), actorId, stage, category, nowMs = Date.now() }) {
    if (this.#refusals.size >= this.#maxEntries) {
      const oldest = this.#refusals.keys().next().value;
      this.#refusals.delete(oldest);
    }
    const record = { id, actorId, stage, category, at:new Date(nowMs).toISOString(), contested:false };
    this.#refusals.set(id, record);
    return record;
  }

  contest(id, { note, actorId }) {
    const record = this.#refusals.get(id);
    if (!record) throw err('No such refusal.', 404, { kind:'NOT_FOUND' });
    if (record.actorId !== actorId) throw err('A refusal may only be contested by the person it was shown to.', 403, { kind:'FORBIDDEN' });
    record.contested = true;
    record.contestNote = String(note ?? '').slice(0, 2000);
    return record;
  }
}

/**
 * The provider a search goes to — s336, and the change is which providers are eligible.
 *
 * Until now this demanded `tool.external === true`. That is why a SELF-HOSTED search engine
 * could not be the research provider: `endpoint()` refuses an external tool pointing at a
 * private address, so a metasearch running on this installation's own network was rejected by
 * one rule for satisfying the other. The product shipped no built-in vendor by design, and the
 * only kind of provider it would accept was one you had to buy.
 *
 * What has NOT been relaxed is consent, and this is the part worth being precise about. A
 * self-hosted aggregator does not keep the query inside the installation — it forwards it to
 * public engines. What running it ourselves buys is that no vendor sees the query beside an
 * account, an API key or a billing identity; it does not make the search local. So consent stays
 * mandatory for both kinds, and the report says which kind answered.
 */
export function resolveResearchTool(tools, toolId) {
  if (!toolId) throw err('No research provider is configured for this installation.', 503, { kind:'UNCONFIGURED' });
  const tool = tools.find((item) => item.id === toolId);
  if (!tool) throw err('The configured research provider no longer exists.', 503, { kind:'UNCONFIGURED' });
  if (!tool.consent?.granted) {
    throw err('The configured research provider is not consented — nothing can be sent to it.', 503, { kind:'UNCONSENTED' });
  }
  if (tool.disabled) {
    throw err('The configured research provider is disabled.', 503, { kind:'UNCONFIGURED' });
  }
  return tool;
}

/**
 * The whole UI-080…096 pipeline for one request: intent gate → provider → content gate →
 * store. Every exit before "store" is a refusal or an unavailability, never a partial report.
 */
export async function runResearchReport({
  objective, criteria = [], actorId, projectId = null, can = null,
  gate, tools, executor, toolId, ledger, reportStore, refusalRegistry, nowMs = Date.now(),
}) {
  const trimmedObjective = String(objective ?? '').trim();
  if (!trimmedObjective) throw err('An objective is required.', 400, { kind:'INVALID' });
  if (trimmedObjective.length > MAX_OBJECTIVE_LENGTH) throw err(`Objective exceeds ${MAX_OBJECTIVE_LENGTH} characters.`, 400, { kind:'INVALID' });
  const normalizedCriteria = [...new Set((Array.isArray(criteria) ? criteria : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, MAX_CRITERIA);

  const queryEcho = buildQueryEcho(trimmedObjective, normalizedCriteria);

  // Gate 1 — intent, before anything leaves (UI-091 first door).
  const intent = await gate.classify(queryEcho);
  ledger.append({ actor:actorId, action:'research.gated', result:intent.outcome.toLowerCase(), details:{ stage:'intent', category:intent.category } });
  if (intent.outcome === 'REFUSE') {
    const refusal = refusalRegistry.record({ actorId, stage:'intent', category:intent.category, nowMs });
    return { outcome:'REFUSE', stage:'intent', category:intent.category, refusalId:refusal.id }; // UI-093/UI-095 — no query is emitted
  }
  if (intent.outcome === 'ASK') {
    return { outcome:'ASK', stage:'intent' };
  }

  // PROCEED — dispatch to the designated provider tool.
  const tool = resolveResearchTool(tools, toolId);
  const { result } = await executor.execute(tool, { objective:trimmedObjective, criteria:normalizedCriteria }, { actorId, projectId, can });
  const candidates = validateReportPayload(result);

  // Gate 2 — content, on what came back, before it is ever stored or shown (UI-091 second door).
  const contentSummary = candidates.map((candidate) => `${candidate.name}: ${candidate.excluded ? candidate.excludedReason : candidate.evidence.map((row) => row.statement).join(' | ')}`).join('\n');
  const content = await gate.classify(contentSummary || trimmedObjective);
  ledger.append({ actor:actorId, action:'research.gated', result:content.outcome.toLowerCase(), details:{ stage:'content', category:content.category } });
  if (content.outcome === 'REFUSE') {
    const refusal = refusalRegistry.record({ actorId, stage:'content', category:content.category, nowMs });
    return { outcome:'REFUSE', stage:'content', category:content.category, refusalId:refusal.id };
  }
  if (content.outcome === 'ASK') {
    return { outcome:'ASK', stage:'content' };
  }

  const report = reportStore.put({ createdBy:actorId, objective:trimmedObjective, criteria:normalizedCriteria, queryEcho, candidates, nowMs });
  ledger.append({ actor:actorId, action:'research.report-created', result:'success', details:{ reportId:report.id, candidates:candidates.length, toolId:tool.id } });
  return { outcome:'PROCEED', report };
}
