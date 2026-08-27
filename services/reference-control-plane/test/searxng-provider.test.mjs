// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translation between what SearXNG answers and what the research pipeline demands. Every
// assertion here is a claim the module makes about itself in prose — this is where it has to be
// true, and the last test drives the real `validateReportPayload` so the two cannot drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearchQuery, repositoryFrom, hitToCandidate, hitsToReport, searchWith, MAX_CANDIDATES,
  priceFrom, isListingUrl,
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
