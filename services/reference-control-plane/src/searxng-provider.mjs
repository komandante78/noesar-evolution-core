// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The research provider this installation can actually have — Owner, 2026-08-26, after asking
// how the agents search and being told: they cannot, because nobody registered a provider.
//
// # What was missing, exactly
//
// `research.mjs` is complete: two gates, a ledger entry on each, an ephemeral store. What it
// never had on this installation is a PROVIDER — `settings.researchProviderToolId` was `null`,
// so Ricerca and the model scout both stopped at `resolveResearchTool` with 503. Meanwhile a
// SearXNG instance has been running beside the product on the operator's own machine, answering
// JSON, reachable, and unused: the one thing needed was between the two, not at either end.
//
// SearXNG answers `{ query, results: [{ url, title, content }] }`. `validateReportPayload`
// demands `{ candidates: [{ name, evidence: [{ kind, statement }], evidenceQuality }] }`. This
// module is that translation and nothing else.
//
// # Why there is no model in this path
//
// The obvious build is to hand the hits to the local model and ask for structure. This does not,
// and the reason is what the evidence kinds are for: `NOT_VERIFIED` means "this came back and
// nobody checked it", which is precisely and completely what a search snippet is. A model asked
// to summarise those snippets produces prose that reads like a finding while remaining exactly
// as unverified — the same claim with its uncertainty laundered out of it. Deriving the fields
// mechanically keeps the honest label attached to the honest content, and it cannot hallucinate
// a model that does not exist.
//
// The model scout gets the same benefit for free: `findingToEntry` only accepts a candidate
// named `publisher/name`, and this derives that name from the URL of a model page rather than
// from prose about one. A search hit that is an article ABOUT a model is named by its title and
// is therefore dropped by the scout, while still being a perfectly good result for Ricerca.

/** How many hits become candidates. SearXNG will return far more; a research report is read by a
 *  person, and the gate downstream classifies every statement in it. */
export const MAX_CANDIDATES = 10;

/** What SearXNG is asked. Criteria are appended as plain words rather than as operators: an
 *  operator syntax differs per engine, and a query that silently means something else on the
 *  engine the operator chose is worse than a broad one. */
export function buildSearchQuery(objective, criteria = []) {
  const parts = [String(objective ?? '').trim(), ...(Array.isArray(criteria) ? criteria : []).map((value) => String(value).trim())];
  return parts.filter(Boolean).join(' ').slice(0, 400);
}

/**
 * The model repository this URL names, or null.
 *
 * Only the two hosts that serve model pages under `/<publisher>/<name>`, and only that exact
 * depth: `huggingface.co/docs/transformers` is not a model, and neither is a URL with a third
 * segment (`/Qwen/Qwen3-8B/tree/main` is a file listing, whose id is still the first two).
 */
export function repositoryFrom(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return null; }
  if (!['huggingface.co', 'www.huggingface.co', 'modelscope.cn'].includes(parsed.hostname.toLowerCase())) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  const reserved = new Set(['docs', 'blog', 'papers', 'datasets', 'spaces', 'models', 'collections', 'organizations']);
  if (segments.length < 2 || reserved.has(segments[0].toLowerCase())) return null;
  const id = `${segments[0]}/${segments[1]}`;
  return /^[\w.-]+\/[\w.-]+$/.test(id) ? id : null;
}

/**
 * One SearXNG hit as a research candidate.
 *
 * The URL travels INSIDE the statement, not beside it: evidence nobody can trace back is not
 * evidence, and `validateCandidate` keeps only `kind` and `statement` from each row — a source
 * field added here would be dropped on the way through and the trace lost silently.
 */
export function hitToCandidate(hit) {
  const url = String(hit?.url ?? '').trim();
  if (!url) return null;
  const snippet = String(hit?.content ?? '').trim();
  const title = String(hit?.title ?? '').trim();
  if (!snippet && !title) return null;
  return {
    name: repositoryFrom(url) ?? (title || url),
    evidence: [{ kind: 'NOT_VERIFIED', statement: `${snippet || title} — ${url}` }],
    evidenceQuality: {
      // Zero, and honestly so: a search engine reports no reviews. Writing anything else here
      // would put a number the provider never gave in front of a person weighing the result.
      reviewCount: 0,
      timeSpanDays: null,
      verifiedPurchaseShare: null,
      anomalyFlag: false,
    },
    // UI-087. SearXNG marks nothing as sponsored and this product emits no affiliate field at
    // all, so both are structurally false rather than defaulted.
    sponsored: false,
    // Owner, 2026-08-27. The URL now travels BESIDE the statement as well as inside it, because
    // `validateCandidate` was taught to keep it and derive the host from it. Inside the
    // statement it stays: that is the trace, and a card is a rendering, not the record.
    url,
    price: priceFrom(snippet),
    // The address of a picture, never the picture. Consumed and DELETED in `searchWith` — it
    // must not reach a report, where it would become a third-party request on every read.
    thumbnailUrl: String(hit?.thumbnail ?? hit?.img_src ?? '').trim() || null,
  };
}

/** A price ONLY when a source states one, kept as the string it used. Measured against this
 *  installation on 2026-08-27: a query with the word `prezzo` returned zero of them, because a
 *  general web search carries no price field. That is the honest result — a number assembled
 *  from parts nobody wrote is the row a person would trust most and should trust least. */
export function priceFrom(text) {
  const match = /(?:[€$£]s?d{1,3}(?:[.,]d{3})*(?:[.,]d{2})?)|(?:d{1,3}(?:[.,]d{3})*(?:[.,]d{2})?s?(?:€|$|£|EUR|USD|GBP))/i.exec(String(text ?? ''));
  return match ? match[0].trim() : null;
}

/** A thumbnail fetched ONCE, here, and inlined into the report — never linked from it. A saved
 *  report that reached out to whoever hosts a picture every time somebody opened it would be an
 *  egress nobody consented to, months after the search. A failure is silent and simply means no
 *  picture: no report is worth failing over a thumbnail. */
export async function inlineThumbnail(url, { fetchImpl = fetch, timeoutMs = 5_000, maxBytes = 120_000 } = {}) {
  try {
    const response = await fetchImpl(String(url), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const type = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch { return null; }
}

/** The report payload for a set of hits: deduplicated by name, capped, order preserved because
 *  the engine's ranking is the only ranking anyone here has. */
export function hitsToReport(hits) {
  const seen = new Set();
  const candidates = [];
  for (const hit of Array.isArray(hits) ? hits : []) {
    const candidate = hitToCandidate(hit);
    if (!candidate || seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    candidates.push(candidate);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return { candidates };
}

/**
 * Ask the configured SearXNG for one query.
 *
 * `fetchImpl` and `validate` are injected: the tests drive this without a socket, and the
 * endpoint validator is the executor's OWN — the one that refuses credentials in a URL, metadata
 * addresses, and a "local" tool pointing at the public internet. Reusing it rather than writing
 * a second check here is the difference between one rule and two that agree until they do not.
 */
export async function searchWith({ endpoint, objective, criteria = [], fetchImpl = fetch, validate, timeoutMs = 20_000, withImages = false }) {
  if (!endpoint) {
    const error = new Error('No search endpoint is configured for this installation.');
    error.status = 503; error.kind = 'UNCONFIGURED';
    throw error;
  }
  const base = typeof validate === 'function' ? validate(endpoint, false) : endpoint;
  const url = new URL('./search', base.endsWith('/') ? base : `${base}/`);
  url.searchParams.set('q', buildSearchQuery(objective, criteria));
  url.searchParams.set('format', 'json');
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(Math.min(timeoutMs, 60_000)),
  });
  if (!response.ok) {
    const error = new Error(`The search provider answered ${response.status}.`);
    error.status = 502; error.kind = 'INTERNAL';
    throw error;
  }
  const payload = await response.json();
  const report = hitsToReport(payload?.results);
  // `thumbnailUrl` dies here whatever the switch says: the only way a picture reaches a report
  // is as bytes this server already fetched and looked at.
  await Promise.all(report.candidates.map(async (candidate) => {
    const thumbnail = candidate.thumbnailUrl;
    delete candidate.thumbnailUrl;
    if (withImages && thumbnail) candidate.image = await inlineThumbnail(thumbnail, { fetchImpl });
  }));
  return report;
}
