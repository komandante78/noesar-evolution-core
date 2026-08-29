// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translation between what SearXNG answers and what the research pipeline demands. Every
// assertion here is a claim the module makes about itself in prose — this is where it has to be
// true, and the last test drives the real `validateReportPayload` so the two cannot drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearchQuery, repositoryFrom, hitToCandidate, hitsToReport, searchWith, MAX_CANDIDATES,
  sourceRank, SOURCE_RANK,
  priceFrom, isListingUrl, searchImages, MAX_IMAGES,
  pageTextFrom, readPage, MAX_PAGE_CHARS, MAX_PAGES_READ,
} from '../src/searxng-provider.mjs';
import { validateReportPayload } from '../src/research.mjs';

const hit = (over = {}) => ({ url: 'https://huggingface.co/Qwen/Qwen3-8B', title: 'Qwen3-8B', content: 'An 8B open-weight model.', ...over });

test('the query is the objective and the criteria as plain words', () => {
  const query = buildSearchQuery('open-weight models', ['apache licence', 'released this year']);
  assert.equal(query, 'open-weight models apache licence released this year');
  // Capped: an engine given a 4000-character query answers about the first part of it and the
  // caller cannot tell which part.
  assert.ok(buildSearchQuery('x'.repeat(900), []).length <= 400);
});

// n.17, Owner 2026-08-27: a card showed `D` where a price goes. The pattern had lost every
// backslash — `s?d{1,3}` instead of `\\s?\\d{1,3}` — so it matched the LETTER d, and the
// unescaped `$` in the currency group anchored the end of the string. One line, never tested,
// shipped. The first assertion is the string that was on the Owner's screen.
// Owner, 2026-08-27: «con foto». A general search carries a thumbnail on about one hit in ten,
// so a report had one picture on it. The image category of the SAME instance carries one on
// every hit — same host, same consent, a second query rather than a new destination.
test('the pictures are asked of the image category, fetched once, and inlined (foto)', async () => {
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(String(url));
    if (String(url).includes('categories=images')) {
      return { ok: true, json: async () => ({ results: [
        { url: 'https://shop.test/card', title: 'A card', thumbnail_src: 'https://cdn.test/a.png' },
        { url: 'https://shop.test/other', title: 'Another', img_src: 'https://cdn.test/b.png' },
        { url: 'https://shop.test/nothing', title: 'No picture at all' },
      ] }) };
    }
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  };
  const images = await searchImages({ endpoint: 'http://search.test', objective: 'a card', fetchImpl });
  assert.equal(images.length, 2, 'a hit carrying no picture is skipped, not padded');
  assert.ok(asked[0].includes('categories=images'), 'the picture query must name the image category');
  assert.ok(images.every((row) => row.image.startsWith('data:image/png;base64,')),
    'a picture reaches a report as bytes this server fetched, never as a remote address');
  assert.equal(images[0].sourceUrl, 'https://shop.test/card');
  assert.ok(MAX_IMAGES >= images.length);
  assert.ok(PIXEL.startsWith('data:image/png'));
});

test('a picture search that fails costs the pictures, never the report', async () => {
  const failing = async () => { throw new Error('the instance is down'); };
  assert.deepEqual(await searchImages({ endpoint: 'http://search.test', objective: 'x', fetchImpl: failing }), []);
  const refusing = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.deepEqual(await searchImages({ endpoint: 'http://search.test', objective: 'x', fetchImpl: refusing }), []);
});

test('a price is a price, and the letter D is not (n.17)', () => {
  assert.equal(priceFrom('Amazon.it: Mini Pcie Raid D'), null);
  assert.equal(priceFrom('the best card is D'), null);
  assert.equal(priceFrom('nothing priced here'), null);
  assert.equal(priceFrom('costa 45,90 EUR spedito'), '45,90 EUR');
  assert.equal(priceFrom('prezzo € 1.299,00 oggi'), '€ 1.299,00');
  assert.equal(priceFrom('at 129.99 USD now'), '129.99 USD');
});

// n.18, Owner 2026-08-27: «Amazon.it: Mini Pcie Raid» was offered as a candidate to compare. It
// is Amazon's own results page — its title is the query somebody typed. Now that a model writes
// the answer from these, a listing costs twice: a slot in the ten, and a query string standing
// where a product name belongs.
test('a page of search results is not a candidate (n.18)', () => {
  assert.equal(isListingUrl('https://www.amazon.it/s?k=mini+pcie+raid'), true);
  assert.equal(isListingUrl('https://www.ebay.it/sch/i.html?_nkw=lsi+9211'), true);
  assert.equal(isListingUrl('https://duckduckgo.com/?q=hba+unraid'), true);
  assert.equal(isListingUrl('https://www.amazon.it/LSI-9207-8i/dp/B00BYGVTXP'), false);
  assert.equal(isListingUrl('https://www.reddit.com/r/unRAID/comments/abc/what_hba/'), false);
  assert.equal(isListingUrl('https://linustechtips.com/topic/1407668-what-hba-for-unraid/'), false);
  assert.equal(hitToCandidate({ url: 'https://www.amazon.it/s?k=sas+controller', title: 'Amazon.it: Sas Controller', content: 'results' }), null);
  // And the pipeline drops it rather than spending one of the ten on it.
  const report = hitsToReport([{ url: 'https://www.amazon.it/s?k=x', title: 'a listing', content: 'results' }, hit()]);
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].name, 'Qwen/Qwen3-8B');
});

test('a model page is recognised by its URL, and a documentation page is not', () => {
  assert.equal(repositoryFrom('https://huggingface.co/Qwen/Qwen3-8B'), 'Qwen/Qwen3-8B');
  assert.equal(repositoryFrom('https://huggingface.co/Qwen/Qwen3-8B/tree/main'), 'Qwen/Qwen3-8B',
    'a file listing still names the model it belongs to');
  assert.equal(repositoryFrom('https://huggingface.co/docs/transformers'), null);
  assert.equal(repositoryFrom('https://huggingface.co/blog/something'), null);
  assert.equal(repositoryFrom('https://example.com/Qwen/Qwen3-8B'), null, 'only hosts that serve model pages');
  assert.equal(repositoryFrom('not a url'), null);
});

test('a hit becomes evidence that is traceable and honestly typed', () => {
  const candidate = hitToCandidate(hit());
  assert.equal(candidate.name, 'Qwen/Qwen3-8B', 'named from the URL, never from prose about it');
  assert.equal(candidate.evidence.length, 1);
  assert.equal(candidate.evidence[0].kind, 'NOT_VERIFIED',
    'a search snippet is exactly "this came back and nobody checked it"');
  assert.match(candidate.evidence[0].statement, /An 8B open-weight model\./);
  assert.match(candidate.evidence[0].statement, /https:\/\/huggingface\.co\/Qwen\/Qwen3-8B/,
    'the URL must travel inside the statement — validateCandidate keeps no other field');
  assert.equal(candidate.evidenceQuality.reviewCount, 0, 'a search engine reports no reviews');
  assert.equal(candidate.sponsored, false);
});

test('a hit that is not a model page keeps its title, so Ricerca still gets a result', () => {
  const candidate = hitToCandidate(hit({ url: 'https://example.com/article', title: 'Six models worth trying' }));
  assert.equal(candidate.name, 'Six models worth trying');
});

test('a hit with no url, or with neither snippet nor title, is not a candidate', () => {
  assert.equal(hitToCandidate({ title: 'x', content: 'y' }), null);
  assert.equal(hitToCandidate({ url: 'https://example.com/a' }), null);
});

test('the report is deduplicated and capped, in the engine order', () => {
  const hits = [
    hit(),
    hit({ url: 'https://huggingface.co/Qwen/Qwen3-8B/tree/main', title: 'files' }),
    ...Array.from({ length: MAX_CANDIDATES + 5 }, (unused, index) =>
      hit({ url: `https://huggingface.co/pub/model-${index}`, title: `m${index}` })),
  ];
  const report = hitsToReport(hits);
  assert.equal(report.candidates.length, MAX_CANDIDATES);
  assert.equal(report.candidates[0].name, 'Qwen/Qwen3-8B');
  assert.equal(report.candidates.filter((c) => c.name === 'Qwen/Qwen3-8B').length, 1,
    'the same model at two URLs is one candidate');
});

test('nothing is invented when SearXNG answers with nothing', () => {
  assert.deepEqual(hitsToReport([]).candidates, []);
  assert.deepEqual(hitsToReport(undefined).candidates, []);
});

test('the output satisfies the pipeline it is built for — the real validator, not a copy', () => {
  // The point of this file: the two shapes cannot drift, because the second one is asserted by
  // the function the route actually calls.
  const payload = hitsToReport([hit(), hit({ url: 'https://example.com/a', title: 'An article', content: 'Prose.' })]);
  const validated = validateReportPayload(payload);
  assert.equal(validated.length, 2);
  assert.equal(validated[0].name, 'Qwen/Qwen3-8B');
  assert.equal(validated[0].evidence[0].kind, 'NOT_VERIFIED');
  assert.equal(validated[0].affiliateLink, false);
});

test('an unconfigured endpoint is a stated state, not a crash and not a guessed default', async () => {
  await assert.rejects(
    () => searchWith({ endpoint: null, objective: 'x' }),
    (error) => error.status === 503 && error.kind === 'UNCONFIGURED',
  );
});

test('the configured address goes through the executor’s own validator before anything is sent', async () => {
  let validatedWith = null;
  let requested = null;
  const report = await searchWith({
    endpoint: 'http://172.22.0.6:8080',
    objective: 'models',
    validate: (value) => { validatedWith = value; return value; },
    fetchImpl: async (url) => {
      requested = url;
      return { ok: true, json: async () => ({ results: [hit()] }) };
    },
  });
  assert.equal(validatedWith, 'http://172.22.0.6:8080', 'the validator must see the configured address');
  assert.match(requested, /\/search\?/);
  assert.match(requested, /format=json/);
  assert.equal(report.candidates.length, 1);
});

// Owner, 2026-08-28: read the pages, not their snippets. Nine of ten results are a forum
// thread's title with two lines under it, and the model was writing advice out of questions.
const PAGE = (body) => `<!doctype html><html><head><title>t</title><style>b{color:red}</style></head><body>${body}</body></html>`;
const htmlResponse = (html) => ({
  ok: true,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
  arrayBuffer: async () => Buffer.from(html, 'utf8'),
});

test('a page becomes the words on it: no tags, no scripts, no icon paths, no entities', () => {
  const text = pageTextFrom(PAGE(
    '<script>var a="<b>not text</b>";</script><svg><path d="M0 0 L9 9"/></svg>'
    + '<h1>HBA cards</h1><p>The&nbsp;9300-8i is an&nbsp;LSI card &amp; it works.</p><!-- a note -->',
  ));
  assert.equal(text, 'HBA cards The 9300-8i is an LSI card & it works.');
  assert.ok(!/<|>/.test(text), 'no markup may survive into the material a model reads');
  assert.equal(pageTextFrom(null), '', 'nothing at all is an empty string, never a crash');
});

test('a page is read once, bounded, and only when it really is a page', async () => {
  const long = PAGE(`<p>${'word '.repeat(4000)}</p>`);
  const read = await readPage('https://forum.test/thread', { fetchImpl: async () => htmlResponse(long) });
  assert.equal(read.length, MAX_PAGE_CHARS, 'a page reaches the write-up bounded, whatever its size');

  const pdf = { ok: true, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => Buffer.from('%PDF') };
  assert.equal(await readPage('https://x.test/a.pdf', { fetchImpl: async () => pdf }), null);
  assert.equal(await readPage('https://x.test/gone', { fetchImpl: async () => ({ ok: false, status: 404 }) }), null);
  assert.equal(await readPage('https://x.test/down', { fetchImpl: async () => { throw new Error('timed out'); } }), null,
    'a site that is slow or gone costs its own text and nothing else');
  // Measured on this installation, 2026-08-28: Amazon answers 200 with 226 characters of «click
  // the button below to continue shopping», trovaprezzi.it with 43 of «please enable JS», and a
  // Reddit thread with a shell that extracts to nothing at all. All three are a wall wearing a
  // page's status code, and handing one to a model as a source is worse than the snippet.
  const wall = PAGE(`<p>${'Click the button below to continue shopping. '.repeat(6)}</p>`);
  assert.ok(pageTextFrom(wall).length > 226, 'the wall this refuses must be longer than the one that was measured');
  assert.equal(await readPage('https://x.test/wall', { fetchImpl: async () => htmlResponse(wall) }), null);
  assert.equal(await readPage('https://x.test/shell', { fetchImpl: async () => htmlResponse(PAGE('<div id="app"></div>')) }), null);
  // The size the far side declares is believed before the body is pulled.
  const huge = { ok: true, headers: { get: (n) => (String(n).toLowerCase() === 'content-type' ? 'text/html' : '99999999') }, arrayBuffer: async () => { throw new Error('must not be downloaded'); } };
  assert.equal(await readPage('https://x.test/huge', { fetchImpl: async () => huge }), null);
});

test('the pages are read only when the switch is on, and the six places go to the sites that answered', async () => {
  const hits = Array.from({ length: MAX_CANDIDATES }, (_, index) => hit({
    url: `https://forum.test/thread-${index}`, title: `Thread ${index}`, content: 'two lines of snippet',
  }));
  const readable = PAGE(`<p>${'the page itself says a great deal more than a snippet does. '.repeat(20)}</p>`);
  const asked = [];
  // The measured shape of the real web, 2026-08-28: the first three results were Reddit threads
  // that answer 200 with a shell, and the sources with text on them sat further down the list.
  const fetchImpl = async (url) => {
    asked.push(String(url));
    if (String(url).includes('/search?')) return { ok: true, json: async () => ({ results: hits }) };
    return htmlResponse(/thread-[012]$/.test(String(url)) ? PAGE('<div id="app"></div>') : readable);
  };

  const off = await searchWith({ endpoint: 'http://search.test', objective: 'HBA', validate: (v) => v, fetchImpl });
  assert.equal(asked.length, 1, 'with the switch off nothing but the search instance is reached');
  assert.ok(off.candidates.every((candidate) => !candidate.pageText));

  asked.length = 0;
  const on = await searchWith({ endpoint: 'http://search.test', objective: 'HBA', validate: (v) => v, fetchImpl, withPages: true });
  assert.equal(asked.length, 1 + MAX_CANDIDATES, 'every source is asked, because which ones answer cannot be known in advance');
  const read = on.candidates.filter((candidate) => candidate.pageText);
  assert.equal(read.length, MAX_PAGES_READ, 'the shells cost their own slot, never one of the six');
  assert.deepEqual(read.map((candidate) => candidate.url), [3, 4, 5, 6, 7, 8].map((index) => `https://forum.test/thread-${index}`),
    'the six that answered, in the engine’s order — not the first six by rank');
  assert.equal(on.candidates.at(-1).pageText, undefined, 'past the six a candidate keeps its snippet and nothing else');
});

test('a provider that answers with an error says so as an error, not as an empty result', async () => {
  await assert.rejects(
    () => searchWith({
      endpoint: 'http://172.22.0.6:8080', objective: 'x',
      validate: (value) => value,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    (error) => error.status === 502 && /503/.test(error.message),
  );
});

// ── the ordering, Owner 2026-08-29 ────────────────────────────────────────────────────────
//
// «fallo cercare su fonti di unraid, fonti ufficiali o forum, o su github con recensioni alte,
// e poi metti amazon e siti verificati — non mettere tutto». An ORDERING, not a filter: the two
// filters tried before it both made the product worse by emptying the material.

test('the official site of whatever the question names ranks first, without a list to maintain', () => {
  assert.equal(sourceRank('https://forums.unraid.net/topic/1', 'miglior scheda SAS per unraid'), SOURCE_RANK.OFFICIAL);
  assert.equal(sourceRank('https://unraid.net/download', 'unraid'), SOURCE_RANK.OFFICIAL);
  // Derived from the question, so a different product needs no code change.
  assert.equal(sourceRank('https://truenas.com/docs', 'best HBA for truenas'), SOURCE_RANK.OFFICIAL);
});

test('community, code hosts and shops rank in that order, and everything else last', () => {
  assert.equal(sourceRank('https://www.reddit.com/r/homelab/x', 'scheda SAS'), SOURCE_RANK.COMMUNITY);
  assert.equal(sourceRank('https://github.com/openzfs/zfs', 'scheda SAS'), SOURCE_RANK.CODE);
  assert.equal(sourceRank('https://www.amazon.it/dp/X', 'scheda SAS'), SOURCE_RANK.SHOP);
  assert.equal(sourceRank('https://www.trovaprezzi.it/x', 'scheda SAS'), SOURCE_RANK.SHOP);
  assert.equal(sourceRank('https://some-blog.example/post', 'scheda SAS'), SOURCE_RANK.OTHER);
  assert.equal(sourceRank('not a url', 'scheda SAS'), SOURCE_RANK.OTHER);
});

test('a short word in the question cannot promote an unrelated host', () => {
  // "mini" is four letters and would match minicaravan.example. The five-letter floor is a crude
  // guard and is asserted so that loosening it is a decision rather than an accident.
  assert.equal(sourceRank('https://minicaravan.example/x', 'scheda mini SAS'), SOURCE_RANK.OTHER);
});

test('the hits are ordered before the cut, so the ten kept are the best ten', () => {
  const hit = (url, title) => ({ url, title, content: 'a statement about the thing' });
  const report = hitsToReport([
    hit('https://blog.example/a', 'A blog'),
    hit('https://www.amazon.it/dp/A', 'A card on Amazon'),
    hit('https://forums.unraid.net/t/1', 'The forum thread'),
    hit('https://github.com/x/y', 'A repository'),
  ], 'miglior scheda SAS per unraid');
  assert.deepEqual(
    report.candidates.map((candidate) => candidate.name),
    ['The forum thread', 'A repository', 'A card on Amazon', 'A blog'],
  );
});

test('within one rank the order the search engine chose is preserved', () => {
  // Its relevance is not thrown away, only outranked. Array.prototype.sort is stable (ES2019).
  const hit = (url, title) => ({ url, title, content: 'a statement about the thing' });
  const report = hitsToReport([
    hit('https://one.example/a', 'First blog'),
    hit('https://two.example/b', 'Second blog'),
  ], 'unraid');
  assert.deepEqual(report.candidates.map((candidate) => candidate.name), ['First blog', 'Second blog']);
});
