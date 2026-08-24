// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The conformance suite for @noesar/spoken-intent — the specification made executable.
//
// Mirrors packages/capability-token/conformance/index.mjs on purpose: same shape, same
// discipline, so a reader of one already knows how to read the other. It imports no test runner,
// needs no network, no clock and no filesystem beyond the vectors it reads once at import time,
// and `runConformance()` returns a plain object.
//
// The point of putting the cases HERE rather than in a test file: a second implementation is
// measured by the same code, not by a second reading of the same prose. That is the only way the
// browser copy in `apps/webui-static/voice-intent.js` and this package can be said to agree.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Case family -> the `SPEC.md` requirement it measures. Enforced in both directions by
 *  `test/conformance.test.mjs`: a requirement no case measures, or a case naming a requirement
 *  that does not exist, fails this package's own tests. */
export const REQUIREMENTS = Object.freeze({
  surface: 'SI-001',
  normalise: 'SI-002',
  content: 'SI-003',
  rank: 'SI-004',
  unique: 'SI-005',
  argument: 'SI-006',
  compound: 'SI-007',
  nongoals: 'SI-008',
});

export const vectors = JSON.parse(readFileSync(fileURLToPath(new URL('./vectors.json', import.meta.url)), 'utf8'));

/** The registry every behavioural case runs against, built from the vectors so an implementation
 *  in another language reads it from JSON rather than from this file. Handles arrive already
 *  normalised, exactly as `SI-004` requires of a caller. */
export function registryFrom(source = vectors.registry) {
  return source.map((entry) => ({
    id: entry.id,
    group: entry.group ?? null,
    argument: entry.argument ?? '',
    destination: entry.destination,
    handles: {
      name: entry.handles.name ?? [],
      segment: entry.handles.segment ?? [],
      prose: entry.handles.prose ?? [],
    },
  }));
}

const FILLER = new Set(vectors.filler);
const GROUP_TITLES = vectors.groupTitles;
const destinationOf = (entry) => entry?.destination;

/** Options every behavioural case passes, so a difference between two implementations can only
 *  ever be the implementation and never the fixture. */
export const options = () => ({ entries: registryFrom(), destinationOf, filler: FILLER, groupTitles: GROUP_TITLES });

const SURFACE = ['normalise', 'contentWords', 'rankEntries', 'uniqueHit', 'resolve', 'splitCompound'];

function describeOutcome(result) {
  if (!result || typeof result !== 'object') return String(result);
  if (result.kind === 'intent') return `intent:${result.entry?.id}${result.argument ? ` (${result.argument})` : ''}`;
  if (result.kind === 'ambiguous') return `ambiguous:[${(result.candidates ?? []).map((c) => c.id).sort().join(',')}]`;
  return String(result.kind);
}

/**
 * Run every case against `implementation` and return a plain report.
 *
 * A case that THROWS is a failure with the message attached, never an exception out of this
 * function: a crippled implementation must produce a report saying what it failed, because that
 * report is how `test/conformance.test.mjs` proves the suite can actually fail.
 */
export async function runConformance(implementation) {
  const results = [];
  const record = (id, ok, detail = '') => results.push({ id, requirement: REQUIREMENTS[id.split(':')[0]] ?? null, ok, detail });
  const guard = (id, fn) => { try { fn(); } catch (error) { record(id, false, `threw: ${error.message}`); } };

  // SI-001 — surface
  for (const name of SURFACE) record(`surface:${name}`, typeof implementation?.[name] === 'function', `expected a function, got ${typeof implementation?.[name]}`);
  guard('surface:RANK', () => {
    const rank = implementation.RANK;
    const ok = rank && Object.isFrozen(rank) && Object.keys(rank).length === 8;
    record('surface:RANK', Boolean(ok), `expected a frozen RANK of 8, got ${rank ? Object.keys(rank).length : 'none'}`);
  });
  guard('surface:Outcome', () => {
    const outcome = implementation.Outcome;
    const ok = outcome && Object.isFrozen(outcome) && ['unheard', 'nothing', 'ambiguous', 'intent'].every((value) => Object.values(outcome).includes(value));
    record('surface:Outcome', Boolean(ok), 'expected a frozen Outcome carrying all four values');
  });
  // Nothing below can run without these, and reporting 40 cascading failures hides the one cause.
  if (results.some((entry) => !entry.ok)) return report(results);

  // SI-002 — normalisation
  for (const item of vectors.normalise) {
    guard(`normalise:${item.id}`, () => record(`normalise:${item.id}`, implementation.normalise(item.input) === item.expect,
      `${JSON.stringify(item.input)} -> ${JSON.stringify(implementation.normalise(item.input))}, expected ${JSON.stringify(item.expect)} (${item.why})`));
  }

  // SI-003 — content words
  for (const item of vectors.content) {
    guard(`content:${item.id}`, () => {
      // An EXPLICIT empty set, never `undefined`: what an implementation binds as its DEFAULT filler
      // is a product choice (the browser copy binds English+Italian), and measuring a default as if
      // it were a contract would fail a conforming implementation for being useful out of the box.
      const got = implementation.contentWords(item.input, item.useFiller === false ? new Set() : FILLER);
      record(`content:${item.id}`, JSON.stringify(got) === JSON.stringify(item.expect),
        `${JSON.stringify(item.input)} -> ${JSON.stringify(got)}, expected ${JSON.stringify(item.expect)} (${item.why})`);
    });
  }

  // SI-004 — the ladder
  for (const item of vectors.rank) {
    guard(`rank:${item.id}`, () => {
      const hits = implementation.rankEntries(item.phrase, registryFrom(), { filler: FILLER, groupTitles: GROUP_TITLES });
      const top = hits[0] ?? null;
      const gotRank = top ? top.rank : null;
      const gotId = top ? top.entry.id : null;
      const ok = gotRank === item.expectRank && (item.expectEntry === undefined || gotId === item.expectEntry);
      record(`rank:${item.id}`, ok, `"${item.phrase}" -> rank ${gotRank} on ${gotId}, expected rank ${item.expectRank}${item.expectEntry ? ` on ${item.expectEntry}` : ''} (${item.why})`);
    });
  }

  // SI-005 / SI-006 / SI-007 — behaviour, all through `resolve` and `splitCompound`
  for (const family of ['unique', 'argument', 'compound']) {
    for (const item of vectors[family]) {
      guard(`${family}:${item.id}`, () => {
        if (family === 'compound') {
          const got = implementation.splitCompound(item.utterance, options());
          const shown = got ? `compound:${got.intent.entry.id}|${got.tail}` : 'null';
          record(`compound:${item.id}`, shown === item.expect, `"${item.utterance}" -> ${shown}, expected ${item.expect} (${item.why})`);
          return;
        }
        const got = describeOutcome(implementation.resolve(item.utterance, options()));
        record(`${family}:${item.id}`, got === item.expect, `"${item.utterance}" -> ${got}, expected ${item.expect} (${item.why})`);
      });
    }
  }

  // SI-008 — the non-goals, measured as behaviour rather than asserted as intent
  guard('nongoals:no-fuzzy', () => {
    // One character off a real entry name must NOT resolve. This is the case that separates this
    // contract from every fuzzy matcher, so it is measured rather than promised.
    const got = implementation.resolve(vectors.nongoals.nearMiss, options());
    record('nongoals:no-fuzzy', got.kind === 'nothing', `"${vectors.nongoals.nearMiss}" -> ${got.kind}, expected nothing: a near miss must never act`);
  });
  guard('nongoals:no-vocabulary', () => {
    // An entry added to the registry is speakable immediately, with nothing else edited.
    const extended = [...registryFrom(), { id: 'brand-new', destination: 'address:brand-new', argument: '', handles: { name: ['brand-new'], segment: [], prose: ['una cosa nuovissima'] } }];
    const got = implementation.resolve('una cosa nuovissima', { ...options(), entries: extended });
    record('nongoals:no-vocabulary', got.kind === 'intent' && got.entry.id === 'brand-new', `-> ${describeOutcome(got)}, expected the new entry to be reachable with no other change`);
  });
  guard('nongoals:no-network', () => {
    // `resolve` is synchronous. Anything that consulted a network could not be.
    const got = implementation.resolve('memoria', options());
    record('nongoals:no-network', got !== null && typeof got.then !== 'function', 'resolve must be synchronous — a promise implies I/O');
  });

  return report(results);
}

function report(results) {
  const failed = results.filter((entry) => !entry.ok).length;
  return { total: results.length, failed, passed: results.length - failed, results };
}
