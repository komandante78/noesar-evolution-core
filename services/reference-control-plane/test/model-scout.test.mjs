// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The scout's rules, measured. Every one of these is a rule the module states about itself in
// prose above the code — this file is where the prose has to be true.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildScoutObjective, parametersFrom, functionsFrom, licenceFrom, findingToEntry,
  mergeDiscovered, SCOUT_LIMIT, SCOUT_STALE_DAYS,
} from '../src/model-scout.mjs';

const HARDWARE = { accelerators: [{ name: 'NVIDIA GeForce RTX 3060', memoryMiB: 12288 }], memory: { totalBytes: 33585311744 } };
const evidence = (...statements) => statements.map((statement) => ({ kind: 'SOURCE_FACT', statement }));

test('the scout brings no provider with it — no client, no host, no key', () => {
  // The platform law (CLAUDE10 §16) as an assertion rather than a comment: a later edit that
  // reaches for fetch() here is the edit that makes "we talk to nobody you did not register"
  // false, and it must fail this file before it ships.
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/model-scout.mjs'), 'utf8');
  for (const forbidden of [/\bfetch\s*\(/, /node:https?/, /https:\/\/(?!huggingface\.co)/, /api[_-]?key/i]) {
    assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm, ''), forbidden, `the scout must not carry ${forbidden}`);
  }
});

test('the query is about THIS machine, not the best model of the year', () => {
  const { objective, criteria } = buildScoutObjective(HARDWARE);
  assert.match(objective, /RTX 3060/);
  assert.match(objective, /12 GB of video memory/);
  assert.match(objective, /31 GB of system memory/);
  assert.ok(criteria.some((line) => /licence/i.test(line)), 'the licence must be asked for — it decides whether the model is usable at all');
});

test('a machine with no accelerator says so instead of claiming 0 GB of video memory', () => {
  const { objective } = buildScoutObjective({ memory: { totalBytes: 16 * (1024 ** 3) } });
  assert.match(objective, /no accelerator/);
  assert.doesNotMatch(objective, /0 GB of video memory/);
});

test('a size is read only when a sentence states one', () => {
  assert.equal(parametersFrom(['A 32 billion parameter model']), '32B');
  assert.equal(parametersFrom(['1.1 trillion parameters in total']), '1.1T');
  assert.equal(parametersFrom(['A very large model, excellent at code']), null,
    'no number stated means the size is undeclared, never invented');
});

test('the licence is read from a licence NAME, not from prose that mentions licensing', () => {
  assert.equal(licenceFrom(['Released under Apache-2.0']), 'Apache-2.0');
  assert.equal(licenceFrom(['The licence is restrictive and should be read carefully']), null);
});

test('what a model is for comes from what the evidence says it does', () => {
  assert.deepEqual(functionsFrom(['Strong at coding and software tasks']), ['coding']);
  assert.deepEqual(functionsFrom(['A general assistant']), ['undeclared'],
    'nothing stated is `undeclared` — the catalogue renders that honestly');
});

test('a candidate named in prose is a search result, not a catalogue entry', () => {
  const meta = { discoveredAt: '2026-08-26T00:00:00.000Z', providerId: 'tool-1' };
  assert.equal(findingToEntry({ name: 'the new Qwen model', evidence: evidence('It is good') }, meta), null);
  assert.equal(findingToEntry({ name: 'Qwen/Qwen3-8B', evidence: [] }, meta), null, 'no evidence, no entry');
  assert.equal(findingToEntry({ name: 'Qwen/Qwen3-8B', excluded: true, excludedReason: 'too large' }, meta), null);
});

test('a finding is marked as a finding, so a card can never pass it off as shipped', () => {
  const entry = findingToEntry(
    { name: 'Qwen/Qwen3-8B', evidence: evidence('An 8 billion parameter model under Apache-2.0, strong at coding.') },
    { discoveredAt: '2026-08-26T00:00:00.000Z', providerId: 'tool-1' },
  );
  assert.equal(entry.id, 'Qwen/Qwen3-8B');
  assert.equal(entry.publisher, 'Qwen');
  assert.equal(entry.parameters, '8B');
  assert.equal(entry.license, 'Apache-2.0');
  assert.deepEqual(entry.functions, ['coding']);
  assert.equal(entry.discovered, true);
  assert.equal(entry.discoveredVia, 'tool-1');
  // And nothing that would make it startable: no signature, and no launch command.
  assert.equal(entry.signature, undefined);
  assert.equal(entry.launchCommand, undefined);
});

test('a curated entry always wins over a discovered one with the same id', () => {
  const now = Date.parse('2026-08-26T00:00:00.000Z');
  const finding = { id: 'Qwen/Qwen3-8B', discoveredAt: '2026-08-26T00:00:00.000Z' };
  const merged = mergeDiscovered({ stored: [], findings: [finding], seededIds: ['Qwen/Qwen3-8B'], nowMs: now });
  assert.deepEqual(merged.entries, [], 'a model someone curated is not replaced by a search result about it');
  assert.equal(merged.added, 0);
});

test('a re-run corrects a finding instead of duplicating it', () => {
  const now = Date.parse('2026-08-26T00:00:00.000Z');
  const stored = [{ id: 'Qwen/Qwen3-8B', description: 'old', discoveredAt: '2026-08-20T00:00:00.000Z' }];
  const findings = [{ id: 'Qwen/Qwen3-8B', description: 'new', discoveredAt: '2026-08-26T00:00:00.000Z' }];
  const merged = mergeDiscovered({ stored, findings, nowMs: now });
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].description, 'new');
  assert.equal(merged.added, 0, 'the same model found again is not a new model');
});

test('a stale finding is not carried forward — it is a claim about a fast-moving field', () => {
  const now = Date.parse('2026-08-26T00:00:00.000Z');
  const old = new Date(now - (SCOUT_STALE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
  const merged = mergeDiscovered({ stored: [{ id: 'a/b', discoveredAt: old }], findings: [], nowMs: now });
  assert.deepEqual(merged.entries, []);
});

test('the cap falls on the oldest, so a quiet run cannot evict this week for last quarter', () => {
  const now = Date.parse('2026-08-26T00:00:00.000Z');
  const findings = Array.from({ length: SCOUT_LIMIT + 3 }, (unused, index) => ({
    id: `pub/model-${index}`,
    // index 0 is the oldest
    discoveredAt: new Date(now - (SCOUT_LIMIT + 3 - index) * 24 * 60 * 60 * 1000).toISOString(),
  }));
  const merged = mergeDiscovered({ stored: [], findings, nowMs: now });
  assert.equal(merged.entries.length, SCOUT_LIMIT);
  assert.equal(merged.dropped, 3);
  assert.ok(merged.entries.every((entry) => entry.id !== 'pub/model-0'), 'the oldest must be the one dropped');
  assert.ok(merged.entries.some((entry) => entry.id === `pub/model-${SCOUT_LIMIT + 2}`), 'the newest must be kept');
});
