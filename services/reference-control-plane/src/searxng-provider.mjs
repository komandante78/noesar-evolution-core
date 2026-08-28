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
/**
 * Is this URL a page of search results rather than a thing?
 *
 * n.18, Owner 2026-08-27: «Amazon.it: Mini Pcie Raid» and «Amazon.it: Sas Controller» were
 * offered as candidates to compare. They are Amazon's own results pages — their title is the
 * query somebody typed, and there is no product behind them. Since the report is now read BY A
 * MODEL as well as by a person, a listing costs twice: it takes a slot in the ten, and it puts
 * a query string where a product name belongs.
 *
 * ponytail: a heuristic on the address, not a fetch — the path segments and query keys the big
 * catalogues use for their own search. It cannot recognise a listing that hides behind a pretty
 * URL; if one shows up, the upgrade is to look at the page, which costs a request per hit.
 */
export function isListingUrl(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return false; }
  if (/(?:^|\/)(?:s|sch|search|find|results?)(?:\/|$)/i.test(parsed.pathname)) return true;
  return ['q', 'k', 'query', 'search', 'keyword', 'keywords', 'text', '_nkw'].some((key) => parsed.searchParams.has(key));
}

export function hitToCandidate(hit) {
  const url = String(hit?.url ?? '').trim();
  if (!url) return null;
  if (isListingUrl(url)) return null;
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
 *  from parts nobody wrote is the row a person would trust most and should trust least.
 *
 *  n.17, Owner 2026-08-27: a card showed `D` as a price. The pattern had lost every backslash —
 *  `s?d{1,3}` for `\\s?\\d{1,3}` — so it matched the LETTER d, and the unescaped `$` in the
 *  currency group anchored the end of the string. `D` at the end of a snippet was therefore a
 *  perfect match. It is one line and it was never tested; the test beside it now names the
 *  exact string that shipped. A wrong price is worse than no price, which is why this reads
 *  from the source's own words in the first place. */
export function priceFrom(text) {
  const match = /(?:[€$£]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)|(?:\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s?(?:€|£|\$|EUR|USD|GBP))/i.exec(String(text ?? ''));
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

/**
 * Reading the page instead of its snippet — Owner, 2026-08-28, and it is the lever the two
 * previous closures both named. A general web search returns ~200 characters per hit, and nine
 * of the ten are the TITLE of a forum thread with two lines under it: the model was writing
 * advice out of other people's questions, and filling the rest in. That is not a size-of-model
 * problem — on ten forum titles a 32B writes the same little, better. It is a material problem.
 *
 * # Why this is its own switch and not the picture one
 *
 * The pictures switch buys reaching whoever HOSTS a picture. This buys reaching, in full, every
 * SITE a search returned. They are different acts and one gesture standing for both is how
 * consent stops meaning anything — the same sentence `researchImageEgress` was created with.
 *
 * # What is deliberately not here
 *
 * No robots.txt read, and no parser. This makes one plain GET of a page the operator's own
 * search instance just returned, at the operator's explicit request, and turns the markup into
 * the words on it with four substitutions. A boilerplate-stripping reader (Readability) would
 * give the model cleaner material, and it is a dependency this repository does not have and does
 * not need to have to answer better than a snippet does.
 */
export const MAX_PAGE_CHARS = 4_000;

/** How many pages fit the write-up's context — the six of `WRITEUP_MAX_PROMPT_CHARS`, and six
 *  that ANSWERED rather than the first six by rank. Measured on this installation, 2026-08-28,
 *  for «Scheda HBA per Unraid»: of the first six results four were Reddit threads, which answer
 *  200 with an empty shell and draw themselves with script; the two sources that had readable
 *  text sat at positions four and six, and two more sat at eight and ten, never tried. Asking
 *  ten and keeping six costs four more requests in parallel and no extra wall-clock time. */
export const MAX_PAGES_READ = 6;

/** A page must be worth more than the snippet it replaces. Measured, 2026-08-28: a Reddit thread
 *  extracts to 0 characters, trovaprezzi.it to «Please enable JS and disable any ad blocker»
 *  (43), and Amazon's bot wall to 226 of «click the button below to continue shopping» — which
 *  is why this floor is not 200. A real page came to thousands.
 *  ponytail: a length, not a reader. It cannot tell a long consent page from a long article; if
 *  one ever gets through, the upgrade is a boilerplate reader (Readability), which is a
 *  dependency this repository does not have. */
const MIN_PAGE_CHARS = 800;

/**
 * The words on a page, from its markup. Not a parser: the tags come out, the invisible elements
 * come out with their content, the handful of entities that survive tag-stripping become the
 * characters they name, and the whitespace collapses. `<svg>` goes with the rest because a page's
 * icon set is a kilobyte of path data that reads to a model as noise.
 */
export function pageTextFrom(html) {
  const ENTITIES = { nbsp:' ', amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", '#39':"'", '#x27':"'" };
  return String(html ?? '')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]{1,6}|[a-z]+);/gi, (whole, name) => ENTITIES[String(name).toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One source, read once, at the moment of the search — never linked to and never fetched again,
 * exactly like `inlineThumbnail` above and for the same reason: what a report holds must be what
 * this server already looked at.
 *
 * A failure is silent and costs that source its text, never the report: a site that is slow, gone
 * or serving a PDF is an ordinary Tuesday on the open web, and losing ten candidates to one of
 * them would be the worse failure.
 */
export async function readPage(url, { fetchImpl = fetch, timeoutMs = 8_000, maxBytes = 600_000, maxChars = MAX_PAGE_CHARS } = {}) {
  try {
    const response = await fetchImpl(String(url), {
      headers: { accept: 'text/html,text/plain' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const type = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(type)) return null;
    // Refused BEFORE the body when the far side declares a size: a 40 MB page announced as one
    // is not worth downloading to find out. Without the header the cap below still holds.
    if (Number(response.headers.get('content-length')) > maxBytes) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) return null;
    const text = pageTextFrom(bytes.toString('utf8'));
    // A page that yielded little is a cookie wall, a bot wall, or a shell that draws itself with
    // script — all three answer 200 and all three were measured doing it. Nothing is better than
    // «click the button below to continue shopping» handed to a model as a source.
    return text.length >= MIN_PAGE_CHARS ? text.slice(0, maxChars) : null;
  } catch { return null; }
}

/** How many pictures a report carries. Four is what fits across the page above the answer. */
export const MAX_IMAGES = 4;

/**
 * The pictures — Owner, 2026-08-27: «con foto». A general web search carries a thumbnail on
 * about one hit in ten, which is why a report had one picture on it and looked like a list.
 * SearXNG has an image category and answers it from the SAME instance, on the SAME consent:
 * this is a second query to the host already agreed to, not a new destination.
 *
 * The picture itself is fetched ONCE, here, and inlined — `inlineThumbnail`'s whole reason. The
 * remote address never reaches the report, so opening a saved page months later reaches nobody.
 * The switch that governs all of it is the one that already existed (`researchImageEgress`).
 *
 * Never throws and never blocks a report: no picture is worth failing a search over.
 */
export async function searchImages({ endpoint, objective, criteria = [], fetchImpl = fetch, validate, timeoutMs = 20_000, max = MAX_IMAGES }) {
  let payload;
  try {
    const base = typeof validate === 'function' ? validate(endpoint, false) : endpoint;
    const url = new URL('./search', base.endsWith('/') ? base : `${base}/`);
    url.searchParams.set('q', buildSearchQuery(objective, criteria));
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', 'images');
    const response = await fetchImpl(url.toString(), {
      method: 'GET', headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 60_000)),
    });
    if (!response.ok) return [];
    payload = await response.json();
  } catch { return []; }
  const images = [];
  for (const hit of Array.isArray(payload?.results) ? payload.results : []) {
    if (images.length >= max) break;
    const sourceUrl = String(hit?.url ?? '').trim();
    // The engine's own thumbnail first: it is small, already resized, and served by the
    // aggregator's upstream rather than by the shop. The full picture only if there is none.
    const remote = String(hit?.thumbnail_src ?? hit?.thumbnail ?? hit?.img_src ?? '').trim();
    if (!remote || !sourceUrl) continue;
    const image = await inlineThumbnail(remote, { fetchImpl });
    if (image) images.push({ image, title: String(hit?.title ?? '').slice(0, 120), sourceUrl });
  }
  return images;
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
export async function searchWith({ endpoint, objective, criteria = [], fetchImpl = fetch, validate, timeoutMs = 20_000, withImages = false, withPages = false }) {
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
  // The pictures ride on the same switch and the same instance as the thumbnails below, and
  // they are asked for only when it is on.
  report.images = withImages
    ? await searchImages({ endpoint, objective, criteria, fetchImpl, validate, timeoutMs })
    : [];
  // `thumbnailUrl` dies here whatever the switch says: the only way a picture reaches a report
  // is as bytes this server already fetched and looked at.
  await Promise.all(report.candidates.map(async (candidate) => {
    const thumbnail = candidate.thumbnailUrl;
    delete candidate.thumbnailUrl;
    if (withImages && thumbnail) candidate.image = await inlineThumbnail(thumbnail, { fetchImpl });
    if (withPages) candidate.pageText = await readPage(candidate.url, { fetchImpl });
  }));
  // Every source is asked, and the ones that ANSWERED fill the six places the write-up has —
  // in the engine's order, which is still the only ranking anyone here has. See
  // `MAX_PAGES_READ` for the measurement that put the loop here rather than in the map above.
  let kept = 0;
  for (const candidate of report.candidates) {
    if (!candidate.pageText) continue;
    if (kept < MAX_PAGES_READ) kept += 1;
    else delete candidate.pageText;
  }
  return report;
}
