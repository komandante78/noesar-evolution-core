// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The product's own voice resolver, held to `@noesar/spoken-intent`'s contract.
//
// **This file is the reason the package is worth anything.** A specification with one
// implementation is a description of that implementation. `packages/spoken-intent` earns the word
// "contract" only if a second, independently written implementation answers the same cases — and
// the second one here is not a demonstration, it is the code the product actually ships to the
// browser (`apps/webui-static/voice-intent.js`).
//
// The two are genuinely different: the browser copy knows about entry shapes, injected
// translators, i18n sentences and the product's navigate/run distinction; the package knows about
// none of that and takes handles pre-normalised. The adapter below is exactly that difference,
// written out — and its size is the honest measure of how much of the algorithm was extractable.
//
// The same discipline `packages/capability-token` uses for Rust and Python, applied where the
// second implementation happens to also be JavaScript.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { runConformance, vectors, registryFrom } from '../../../packages/spoken-intent/conformance/index.mjs';
import * as browser from '../../../apps/webui-static/voice-intent.js';

/**
 * The browser resolver, dressed in the package's surface.
 *
 * Everything here is a shape difference, never a behaviour one. If a case only passes because
 * this adapter did some of the work, the adapter is lying — so each mapping below is a rename or
 * a re-shape and nothing else, and the two that are NOT (`handlesFor`, `destinationOf`) are the
 * product-specific seams the SPEC deliberately leaves to the caller.
 */
function adapter() {
  const filler = new Set(vectors.filler);
  // The package takes handles pre-normalised on the entry; the browser copy derives them from an
  // entry's own fields through an injected translator. Feeding the vectors' handles straight
  // through is the honest equivalent: same strings, same three buckets.
  const asBrowserEntry = (entry) => ({
    name: entry.handles.name[0] ?? entry.id,
    address: entry.handles.name[0] ?? entry.id,
    summary: entry.handles.prose[0] ?? '',
    argument: entry.argument,
    kind: entry.destination.startsWith('address:') ? 'address' : 'command',
    group: entry.group,
    __vector: entry,
  });

  return {
    normalise: browser.normalise,
    contentWords: (text, set) => browser.contentWords(text, set),
    RANK: browser.RANK,
    Outcome: browser.VoiceIntent,
    rankEntries: (phrase, entries, options = {}) => browser.rankEntries(
      phrase, entries.map(asBrowserEntry), (value) => value, options.groupTitles ?? {},
    ).map((hit) => ({ entry: hit.entry.__vector, rank: hit.rank })),
    uniqueHit: (hits, destinationOf) => {
      if (!hits.length) return null;
      const best = hits.filter((hit) => hit.rank === hits[0].rank);
      return new Set(best.map((hit) => destinationOf(hit.entry))).size === 1 ? best[0].entry : null;
    },
    resolve: (utterance, options = {}) => shape(browser.resolveUtterance(utterance, {
      entries: (options.entries ?? []).map(asBrowserEntry), translate: (value) => value,
      groupTitles: options.groupTitles ?? {},
    })),
    splitCompound: (utterance, options = {}) => {
      const result = browser.resolveCompound(utterance, {
        entries: (options.entries ?? []).map(asBrowserEntry), translate: (value) => value,
        groupTitles: options.groupTitles ?? {},
      });
      return result ? { head: '', tail: result.tail, intent: shape(result.intent) } : null;
    },
    filler,
  };
}

/** The browser resolver returns product-shaped results; the package's outcomes are the same four
 *  names with the entry unwrapped back to the vector it came from. */
function shape(result) {
  if (result?.kind === 'intent') return { kind: 'intent', heard: result.heard, entry: result.entry.__vector, argument: result.argument ?? '' };
  if (result?.kind === 'ambiguous') return { kind: 'ambiguous', heard: result.heard, candidates: result.candidates.map((entry) => entry.__vector) };
  return { kind: result?.kind, heard: result?.heard };
}

describe('the shipped browser resolver conforms to @noesar/spoken-intent', () => {
  test('every conformance case passes against apps/webui-static/voice-intent.js', async () => {
    const report = await runConformance(adapter());
    const failures = report.results.filter((entry) => !entry.ok).map((entry) => `${entry.id}: ${entry.detail}`);
    assert.deepEqual(failures, [], `${report.failed} of ${report.total} cases failed against the SHIPPED resolver`);
    assert.ok(report.total >= 45, `expected the full suite, ran ${report.total}`);
  });

  // Without this, the test above could pass because the adapter quietly implemented the contract
  // itself. Breaking the BROWSER module must break the report.
  test('the report tracks the browser module, not the adapter', async () => {
    const crippled = { ...adapter(), normalise: (text) => String(text ?? '').toLowerCase() };
    const report = await runConformance(crippled);
    assert.ok(report.results.some((entry) => entry.id.startsWith('normalise:') && !entry.ok),
      'if this still passes, the cases are not reaching the module under test');
  });

  test('the two implementations agree on the same registry, utterance by utterance', async () => {
    const reference = await import('../../../packages/spoken-intent/src/index.mjs');
    const entries = registryFrom();
    const options = { entries, destinationOf: (entry) => entry.destination, filler: new Set(vectors.filler), groupTitles: vectors.groupTitles };
    const disagreements = [];
    for (const utterance of [
      ...vectors.unique.map((item) => item.utterance),
      ...vectors.argument.map((item) => item.utterance),
      ...vectors.compound.map((item) => item.utterance),
      'memoria', 'plan', 'coden/agent/plan', 'perché', 'flussi di lavoro', 'approvazioni', 'impostaziony',
    ]) {
      const a = reference.resolve(utterance, options);
      const b = adapter().resolve(utterance, options);
      const key = (result) => `${result.kind}:${result.entry?.id ?? ''}:${result.argument ?? ''}:${(result.candidates ?? []).map((c) => c.id).sort().join('|')}`;
      if (key(a) !== key(b)) disagreements.push(`"${utterance}": reference ${key(a)} vs browser ${key(b)}`);
    }
    assert.deepEqual(disagreements, [], 'two implementations of one contract must not disagree');
  });
});
