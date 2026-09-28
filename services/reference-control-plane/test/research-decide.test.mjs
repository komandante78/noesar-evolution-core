// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Web research with typed decisions (`NOESAR_DECIDE=on`): every source is JUDGED — «does it address
// the question?» — never summarised, and the write-up reads the most relevant pages instead of the
// first six the engine happened to list.
//
// THE ORACLE: against the tree before this file, `searchWith` takes no `decide`, no candidate has a
// `relevance`, and the eighth source can never be among the pages read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWith, MAX_PAGES_READ } from '../src/searxng-provider.mjs';
import { validateCandidate } from '../src/research.mjs';
import { DecisionUnavailable } from '../src/decide.mjs';

const SITES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].map((name) => `https://${name}.example/article`);
const PAGE = `<html><body><p>${'A long and genuinely readable article body. '.repeat(40)}</p></body></html>`;

function fetchImpl(url) {
  const address = String(url);
  if (address.startsWith('http://search.local/')) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: SITES.map((site, index) => ({ url: site, title: `Source ${index + 1}`, content: `snippet ${index + 1}` })) }) });
  }
  return Promise.resolve({
    ok: true, status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    arrayBuffer: async () => Buffer.from(PAGE),
  });
}
const search = (extra = {}) => searchWith({ endpoint: 'http://search.local/', objective: 'which card fits', criteria: [], fetchImpl, withPages: true, ...extra });
const favour = (site) => async ({ context }) => {
  const yes = context.includes(site) ? 0.95 : 0.2;
  return { abstained: false, answer: yes > 0.5 ? 0 : 1, probabilities: [yes, 1 - yes], confidence: 0.9, mass: 1, record: {} };
};

test('without decisions the six pages read are the engine\'s first six, and no source carries a number', async () => {
  const report = await search();
  const read = report.candidates.filter((c) => c.pageText).map((c) => c.url);
  assert.deepEqual(read, SITES.slice(0, MAX_PAGES_READ));
  assert.ok(report.candidates.every((c) => !('relevance' in c)));
});

test('with decisions every source is judged, and the write-up reads the most relevant pages', async () => {
  const report = await search({ decide: favour(SITES[7]) });
  assert.ok(report.candidates.every((c) => typeof c.relevance === 'number'), 'every source judged');
  const read = report.candidates.filter((c) => c.pageText).map((c) => c.url);
  assert.equal(read.length, MAX_PAGES_READ);
  assert.ok(read.includes(SITES[7]), 'the eighth source, judged most relevant, is now read');
  assert.equal(report.candidates.find((c) => c.url === SITES[7]).evidence[0].kind, 'NOT_VERIFIED', 'the label stays: a number is added, nothing is verified');
});

test('a decider that cannot answer leaves the report of before', async () => {
  const report = await search({ decide: async () => { throw new DecisionUnavailable('down'); } });
  const read = report.candidates.filter((c) => c.pageText).map((c) => c.url);
  assert.deepEqual(read, SITES.slice(0, MAX_PAGES_READ));
});

test('the report keeps a relevance only when it is a probability', () => {
  const base = { name: 'x', evidence: [{ kind: 'NOT_VERIFIED', statement: 's' }], evidenceQuality: { reviewCount: 0 }, url: 'https://x.example/' };
  assert.equal(validateCandidate({ ...base, relevance: 0.7 }, 0).relevance, 0.7);
  assert.equal('relevance' in validateCandidate({ ...base, relevance: 1.5 }, 0), false);
  assert.equal('relevance' in validateCandidate(base, 0), false, 'absent without a decision: the shape of before');
});
