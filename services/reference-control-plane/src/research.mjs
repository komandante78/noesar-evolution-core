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

const MAX_OBJECTIVE_LENGTH = 500;
const MAX_CRITERIA = 12;
/** The same bound `searxng-provider.mjs` reads a page to, restated on THIS side of the wire:
 *  that module hands the material over, this one is what admits it, and a validator that
 *  trusted the producer's cap would be no validator. */
const MAX_PAGE_TEXT = 4_000;
/** How much of a page the CONTENT GATE reads. The gate is one model call with a ten-second
 *  timeout, and twenty-four thousand characters of forum markup would time it out rather than
 *  judge it — so what goes through the door is each page's opening, beside the snippet and the
 *  name that already went through it.
 *  ponytail: an opening, not a whole page. If material ever hides its point past the first
 *  paragraph, the upgrade is one gate call per source instead of one per report. */
const GATE_PAGE_CHARS = 500;
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
/** http(s) and nothing else: a javascript: or file: link rendered as a source is the oldest
 *  way a page turns somebody else content into an action on the reader machine. */
/** Only a base64 picture this server inlined itself. Built from a string so the pattern reads
 *  as what it is rather than as a thicket of escapes. */
const DATA_IMAGE = new RegExp('^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$');

function httpUrl(value) {
  try { const parsed = new URL(String(value)); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; }
  catch { return null; }
}

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
    // Owner, 2026-08-27 — «con immagini … prezzi». Whitelisted HERE, where every other field of
    // a candidate is already bounded, rather than trusted as the provider sent it.
    url: httpUrl(candidate.url),
    // Derived, never taken: the host a person reads under a link must be the host the link goes
    // to, or the label is a lie the provider could write.
    sourceHost: httpUrl(candidate.url) ? new URL(String(candidate.url)).hostname : null,
    // A price only when a source states one in its own words, kept as the string it said —
    // parsing it into a number would invent a currency and a precision nobody wrote down.
    price: candidate.price ? String(candidate.price).trim().slice(0, 40) : null,
    // AN INLINE PICTURE OR NOTHING. A remote URL here would make every later reader of a saved
    // report call out to whoever hosts it, without consenting to anything — so the field
    // structurally cannot hold one. The fetching happens once, server-side, under its own
    // switch, in searxng-provider.mjs.
    image: DATA_IMAGE.test(String(candidate.image ?? '')) ? String(candidate.image) : null,
    // Owner, 2026-08-28 — the page behind the link, when the operator turned that switch on.
    // It is MATERIAL FOR THE WRITE-UP AND NOTHING ELSE: no card renders it, because a card
    // shows what a source said about itself and this is the whole source. Bounded here, where
    // every other field of a candidate is bounded, rather than trusted at the length it arrived.
    pageText: candidate.pageText ? String(candidate.pageText).slice(0, MAX_PAGE_TEXT) : null,
  };
}

/** Six is more than any provider sends today; it is here so a provider cannot fill a page. */
const MAX_REPORT_IMAGES = 6;

/**
 * The report's own pictures (Owner: «con foto»), bounded exactly where a candidate's picture is
 * bounded and by the same pattern: an inline data: URI this server fetched itself, or nothing. A
 * remote address here would make every later reader of a saved report call out to whoever hosts
 * it, months after the search, without consenting to anything.
 *
 * A malformed row is DROPPED rather than refused: a picture is decoration on an answer, and the
 * candidates it decorates have already passed two gates. That is the opposite posture to
 * `validateCandidate`, deliberately — there, a missing field means evidence nobody checked.
 */
export function validateReportImages(payload) {
  const rows = Array.isArray(payload?.images) ? payload.images : [];
  return rows
    .filter((row) => DATA_IMAGE.test(String(row?.image ?? '')) && httpUrl(row?.sourceUrl))
    .slice(0, MAX_REPORT_IMAGES)
    .map((row) => ({
      image: String(row.image),
      title: String(row.title ?? '').slice(0, 120),
      sourceUrl: httpUrl(row.sourceUrl),
      // Derived, never taken — the same rule as a candidate's host.
      sourceHost: new URL(String(httpUrl(row.sourceUrl))).hostname,
    }));
}

export function validateReportPayload(payload) {
  if (!payload || typeof payload !== 'object') throw err('The provider answered with something that is not a report.', 502, { kind:'INTERNAL' });
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!candidates.length) throw err('The provider returned no candidates.', 502, { kind:'INTERNAL' });
  return candidates.map((candidate, index) => validateCandidate(candidate, index));
}

/**
 * The written answer — Owner, 2026-08-27 (n.16 and n.16-bis): «una pagina … con il risultato
 * elaborato dal modello», not an index of links.
 *
 * WHERE it sits is what makes it safe. It runs AFTER the content gate, on candidates that have
 * already passed it, and it is pointed at the model this installation is ALREADY running — so
 * the write-up adds no egress at all: nothing new leaves, and nothing reaches a vendor.
 *
 * `searxng-provider.mjs`'s objection ("no model in this path, on purpose") stands as an
 * objection and is answered rather than ignored: prose assembled from unverified fragments
 * reads like a conclusion while being just as unverified. So the page states who wrote it and
 * keeps every source beneath it with its own label. What that comment refuses is a model
 * writing ABOUT the web on its own; what happens here is a model writing FROM what came back.
 *
 * `complete` is injected — `(profileId, request) => Promise<{text}>` — exactly as
 * `vision-caption.mjs` takes it, so this is provable without a gateway, a vault or a socket.
 *
 * NEVER THROWS. A model that cannot be reached costs the write-up, never the report: the
 * candidates are already through both doors, and losing them to a busy GPU would be the worse
 * failure. The page then says why it has no answer on it, which is the honest half of UI-085.
 */
export const WRITEUP_MAX_OUTPUT_TOKENS = 900;
/**
 * Raised from 6000 on 2026-08-28, and the number is the model's, not a preference. This
 * installation runs `llama-server -c 16384 -np 1`: one slot, sixteen thousand tokens for the
 * instruction, the material and the answer together. Twenty-four thousand characters is roughly
 * six thousand tokens, which with the instruction (~450) and the answer (900) leaves the context
 * half empty — and costs about nine seconds of prompt processing at the 650 tok/s this machine
 * measures. Six pages at four thousand characters is exactly this, which is why
 * `MAX_PAGES_READ` is six: the cap and the number of pages read are one decision, not two.
 *
 * With snippets alone the cap never binds — ten of them come to about two thousand characters —
 * so nothing about a report made without the page switch changes.
 */
const WRITEUP_MAX_PROMPT_CHARS = 24000;

/**
 * Rewritten after the first version shipped and the Owner read it: «sembra un elenco della
 * spesa». It was — one line per source, which is an index of the sources wearing prose. Three
 * things were wrong and all three are addressed by wording, measured against the real report:
 *
 *   «refer to a source by its number»  became a per-source bullet list. Now: a number backs a
 *                                      claim, never opens a line, and never ends the answer.
 *   the shape was not stated           now it is: what the material converges on, why, what
 *                                      else to know, and one line on what stayed unconfirmed.
 *   invention                          asking for «the recommendation and what it costs»
 *                                      produced three prices that appear in no source. The
 *                                      no-invention rule is now FIRST and absolute, and the
 *                                      temperature below does the other half of the work.
 *
 * The language line names ONE language and it is the interface's, not the question's and not the
 * material's — Owner, 2026-08-28: «la lingua principale è l'inglese». A question typed in Italian
 * into an English interface is answered in English, because the language a person reads in is the
 * one they chose in the product, and the question is only how they typed it. Without any such line
 * the model answers in the language of the material, which is neither.
 */
export const WRITEUP_INSTRUCTION = [
  'You write the answer to a question, using only material collected from the web.',
  '',
  'THE ONE RULE THAT OVERRIDES EVERYTHING: every product name, model number, price, quantity and',
  'claim in your answer must appear in the material below. You may not add one from your own',
  'knowledge, not even an obvious one. If the material states no prices, your answer contains no',
  'prices. If it does not settle the question, say what it does establish and name what is',
  'missing — that is a complete answer, not a failure.',
  '',
  'LANGUAGE: write the whole answer in {{LANGUAGE}} — not in the language of the question, and',
  'not in the language of the material. Where a source says it in another language, say it in',
  '{{LANGUAGE}}.',
  '',
  'SHAPE: continuous prose, three or four short paragraphs, no headings, no bullet points, no',
  'bold. FIRST SENTENCE: name what you would choose and why, plainly. Then the practical part —',
  'what to check before deciding, what the material warns about, what to avoid. That advice is',
  'what the reader came for, so give the most of your space to it.',
  '',
  'AT MOST ONE closing line for what the material does not settle, and only if it matters to the',
  'decision. Do not write paragraphs about what is missing: if no source states a price, say',
  'nothing about prices at all rather than repeating that none was found. Never mention a detail',
  'that nobody asked about just because a source happened to carry it.',
  '',
  'Never walk the sources one by one, and never write one line per source: the',
  'material is raw search results, several of them forum questions and listing pages that state',
  'nothing, and those are to be ignored rather than described. Put a source number in brackets',
  'after a claim that needs backing, never as a marker at the start of a line. Do not end with a',
  'list of source numbers: the sources are printed under your answer already.',
].join('\n');

/**
 * The interface's two languages (`i18n-catalog.js`), named in English because the model reads
 * English. Looked UP rather than interpolated: the code arrives from a browser, and a string
 * pasted into a system instruction IS the system instruction. Anything unknown, absent or null
 * is English — the product's source language, and what "no preference" has to mean.
 */
const WRITEUP_LANGUAGE_NAMES = { en:'English', it:'Italian' };
export function writeupInstructionFor(language) {
  const name = WRITEUP_LANGUAGE_NAMES[language] ?? 'English';
  return WRITEUP_INSTRUCTION.replaceAll('{{LANGUAGE}}', () => name);
}

/** Low, because this answer must not invent. Measured: at the server's default the model priced
 *  three cards that no source mentions; at 0.2, on the same material, it priced none. */
export const WRITEUP_TEMPERATURE = 0.2;

/** The sources as the model sees them: numbered, bounded, and nothing a candidate did not carry.
 *
 *  When a candidate carries the page itself, the page IS the source and the snippet is not
 *  repeated beneath it — the snippet is an extract of that same text, and printing both would
 *  spend the context saying one thing twice. */
export function buildWriteupPrompt(objective, criteria, candidates) {
  const sources = candidates.map((candidate, index) => {
    const head = `[${index + 1}] ${candidate.name}${candidate.sourceHost ? ` — ${candidate.sourceHost}` : ''}${candidate.price ? ` — ${candidate.price}` : ''}`;
    const body = candidate.excluded
      ? [`  excluded: ${candidate.excludedReason}`]
      : candidate.pageText
        ? [`  ${candidate.pageText}`]
        : candidate.evidence.map((row) => `  ${String(row.statement).slice(0, 400)}`);
    return [head, ...body].join('\n');
  }).join('\n').slice(0, WRITEUP_MAX_PROMPT_CHARS);
  return `Question: ${objective}\n`
    + (criteria.length ? `Requirements: ${criteria.join(', ')}\n` : '')
    + `\nSources:\n${sources}`;
}

export async function writeResearchAnswer({
  complete, profileId, objective, criteria = [], candidates = [], language = null,
  maxOutputTokens = WRITEUP_MAX_OUTPUT_TOKENS,
} = {}) {
  if (typeof complete !== 'function') return { text:'', reason:'no way to reach a model was supplied' };
  try {
    const result = await complete(profileId, {
      messages: [
        { role:'system', content:writeupInstructionFor(language) },
        { role:'user', content:buildWriteupPrompt(objective, criteria, candidates) },
      ],
      maxOutputTokens,
      temperature: WRITEUP_TEMPERATURE,
    });
    // The bibliography line the model adds anyway, deleted rather than asked for again: a
    // trailing run of bare [1] [2] [3] is the sources listed twice, and the sources are already
    // printed under the answer. Only at the END, so a citation inside a sentence is untouched.
    const text = String(result?.text ?? '').trim().replace(/(?:\s*\[\d+\])+\s*$/, '').trim();
    if (!text) return { text:'', reason:'the model answered with nothing' };
    return { text, model:result?.provider?.defaultModel ?? null };
  } catch (error) {
    return { text:'', reason:error?.message ?? String(error) };
  }
}

/**
 * Saved on disk and kept until the person deletes it — Owner, 2026-08-27, reversing UI-080…089's
 * ephemeral store BY NAME rather than by accident. The Owner asked three times for the page of a
 * search to survive; a list that emptied itself on every deploy was half the thing asked for.
 *
 * What protected a report was never the expiry — it was, and remains, a session on THIS
 * installation (UI-082). The 24-hour clock protected nothing a delete button does not, and it
 * threw away work the person wanted.
 *
 * WHERE the saving happens is not here, and that is CE-014 rather than taste: this module reads
 * what came off the open web, so it must have no path to the filesystem at all — the check that
 * says so reads this file own text. It is handed a `load` and a `save` and knows nothing else.
 */
export class ResearchReportStore {
  #reports = new Map();
  #save;

  constructor({ load = null, save = null } = {}) {
    this.#save = save;
    if (typeof load !== 'function') return;
    // Whatever cannot be loaded is an empty list, never a refusal to start: the saved reports
    // are a convenience, and the product booting is not.
    try {
      for (const record of load() ?? []) this.#reports.set(record.id, Object.freeze(record));
    } catch { /* empty */ }
  }

  #persist() { if (typeof this.#save === 'function') this.#save([...this.#reports.values()]); }

  put({ id = randomUUID(), createdBy, objective, criteria, queryEcho, candidates, answer = null, images = [], nowMs = Date.now() }) {
    const record = Object.freeze({
      id, createdBy, objective, criteria: Object.freeze([...criteria]),
      queryEcho, candidates: Object.freeze(candidates),
      // n.16. `null` on every report written before there was a write-up, and on any report
      // whose model could not be asked — a reader tells the cases apart by `text` and `reason`.
      answer: answer ? Object.freeze({ ...answer }) : null,
      images: Object.freeze(Array.isArray(images) ? images : []),
      createdAt: new Date(nowMs).toISOString(),
    });
    this.#reports.set(id, record);
    this.#persist();
    return record;
  }

  /** Missing and never-existed remain ONE answer, which is what UI-082 was really buying: a
   *  caller who does not hold the report learns nothing about whether an id ever existed. */
  get(id) { return this.#reports.get(id) ?? null; }

  /** Newest first, one person only, and WITHOUT the candidates: a list is a way back to a
   *  report, not a second copy of one. */
  list({ createdBy } = {}) {
    return [...this.#reports.values()]
      .filter((record) => record.createdBy === createdBy)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(({ id, objective, criteria, createdAt, candidates }) => ({
        id, objective, criteria:[...criteria], createdAt, candidateCount: candidates.length,
      }));
  }

  /** Deleting one own report. The double confirmation the Owner asked for is the page's job;
   *  what belongs here is that nobody deletes a report that is not theirs. */
  remove(id, { createdBy = null } = {}) {
    const record = this.#reports.get(id);
    if (!record || (createdBy && record.createdBy !== createdBy)) return null;
    this.#reports.delete(id);
    this.#persist();
    return record;
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
 * The same rule as `resolveResearchTool`, asked as a question rather than asserted.
 *
 * Defect n.10, 2026-08-27: when `resolveResearchTool` stopped demanding `tool.external === true`,
 * the two Settings routes that describe the very same decision kept the old condition. The result
 * was a panel declaring "configured, awaiting consent" and zero eligible tools out of twenty-four
 * while the engine underneath was working — and sending the Owner off to register an external tool
 * that would not have helped. This project has now paid twice for relaxing a rule in one caller and
 * leaving it in the others, so the rule is asked for here instead of restated.
 *
 * The two questions are deliberately separate, because they are separate in time. `usable` is
 * "could a report run right now"; `designatable` is "may this be chosen at all" — which must stay
 * true for a tool that has not been consented yet, or the panel could never offer the tool whose
 * consent is the next thing the person is about to give.
 */
export function researchToolStatus(tools, toolId) {
  try {
    resolveResearchTool(tools, toolId);
    return { usable: true, designatable: true, kind: null, reason: null };
  } catch (error) {
    const kind = error.kind ?? 'UNCONFIGURED';
    return { usable: false, designatable: kind === 'UNCONSENTED', kind, reason: error.message };
  }
}

/**
 * The whole UI-080…096 pipeline for one request: intent gate → provider → content gate →
 * store. Every exit before "store" is a refusal or an unavailability, never a partial report.
 */
export async function runResearchReport({
  objective, criteria = [], language = null, actorId, projectId = null, can = null,
  gate, tools, executor, toolId, ledger, reportStore, refusalRegistry, writeup = null, nowMs = Date.now(),
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
  const images = validateReportImages(result);

  // Gate 2 — content, on what came back, before it is ever stored or shown (UI-091 second door).
  const contentSummary = [
    ...candidates.map((candidate) => {
      const said = candidate.excluded ? candidate.excludedReason : candidate.evidence.map((row) => row.statement).join(' | ');
      // A page this product read is text off the open web that will reach a person through the
      // write-up, so it goes through this door like everything else that came back — bounded to
      // its opening, for the reason `GATE_PAGE_CHARS` states beside itself.
      return candidate.pageText ? `${candidate.name}: ${said} | ${candidate.pageText.slice(0, GATE_PAGE_CHARS)}` : `${candidate.name}: ${said}`;
    }),
    // The pictures' own captions go through the second door with everything else: they are text
    // that came off the open web and will be shown to a person, which is the whole test.
    ...images.map((row) => row.title).filter(Boolean),
  ].join('\n');
  const content = await gate.classify(contentSummary || trimmedObjective);
  ledger.append({ actor:actorId, action:'research.gated', result:content.outcome.toLowerCase(), details:{ stage:'content', category:content.category } });
  if (content.outcome === 'REFUSE') {
    const refusal = refusalRegistry.record({ actorId, stage:'content', category:content.category, nowMs });
    return { outcome:'REFUSE', stage:'content', category:content.category, refusalId:refusal.id };
  }
  if (content.outcome === 'ASK') {
    return { outcome:'ASK', stage:'content' };
  }

  // The write-up (n.16), after the second door and never in place of it. Optional, so a caller
  // with no model to ask — and the canary tests that prove nothing leaks — keep the exact
  // three-request pipeline they had.
  const answer = typeof writeup === 'function'
    ? await writeup({ objective:trimmedObjective, criteria:normalizedCriteria, candidates, language })
    : null;

  const report = reportStore.put({ createdBy:actorId, objective:trimmedObjective, criteria:normalizedCriteria, queryEcho, candidates, answer, images, nowMs });
  ledger.append({ actor:actorId, action:'research.report-created', result:'success', details:{ reportId:report.id, candidates:candidates.length, toolId:tool.id, written:Boolean(answer?.text) } });
  return { outcome:'PROCEED', report };
}
