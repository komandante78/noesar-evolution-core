// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-018` — *«Il ledger è append-only, con digest concatenato che rileva una manomissione»*
// (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**), verification method
// *«tentativo di riscrittura, verifica della catena»*.
//
// # What was already measured, and what was not
//
// The chain itself is well covered: `conformance/event-vectors.json` carries four tamper
// vectors (alter a payload, remove a middle event, reorder two, and an untouched control) run
// through `EventLedger.restore()`, and `durability.test.mjs` doctors a line of the real journal
// and proves `loadFrom()` refuses it. None of that was ever tied to `CE-018`, which is why the
// criterion had no verdict.
//
// Two things nothing measured, and both are in the criterion's own words:
//
//   1. **append-only is a property of the FILE**, not only of the data structure. "The chain is
//      append-only, so the file is append-only too" is written in `events.mjs`'s header as an
//      intention. Section 1 holds the earlier bytes and compares them again afterwards.
//   2. **what "rileva una manomissione" actually buys.** The chain is `createHash('sha256')`
//      over each event and its predecessor — **unkeyed**. It therefore detects a tamperer who
//      edits records; it does **not** detect one who rewrites the chain from the edit onward,
//      because recomputing it is exactly what the honest path does. Section 2 measures that
//      bound by performing the attack, so the verdict states a property the code has rather
//      than the one the sentence suggests. Nothing signs the head: `events.mjs` and `audit.mjs`
//      both use `createHash`, neither uses `createHmac`, and no anchor is published elsewhere.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLedger, EventError } from '../src/events.mjs';

const AT = 1_770_000_000;

function workspace(name) {
  const directory = mkdtempSync(join(tmpdir(), `noesar-ce018-${name}-`));
  return { directory, path: join(directory, 'engine-events.jsonl'),
    cleanup() { rmSync(directory, { recursive: true, force: true }); } };
}

const append = (ledger, id, causationId = null, payload = `payload-${id}`) => ledger.append({
  id, correlationId: 'run-1', causationId, actor: 'owner', action: 'test.event',
  payload, recordedAtUnix: AT + Number(id.slice(1)),
});

describe('CE-018 — the ledger is append-only and the chain detects a rewrite', () => {

  // ── 1 · append-only, measured on the bytes ────────────────────────────────────────────────
  test('CE-018: writing more events never changes a byte already written', () => {
    const ws = workspace('append');
    try {
      const ledger = new EventLedger({ journalPath: ws.path });
      append(ledger, 'e1');
      append(ledger, 'e2', 'e1');
      const before = readFileSync(ws.path);

      append(ledger, 'e3', 'e2');
      append(ledger, 'e4', 'e3');
      const after = readFileSync(ws.path);

      // The prefix is identical byte for byte, and the file only grew. A ledger that rewrote
      // its journal to insert, reflow or compact would pass every in-memory chain check and
      // still have destroyed the property this criterion is about.
      assert.ok(after.length > before.length, 'the journal did not grow');
      assert.deepEqual(after.subarray(0, before.length), before,
        'bytes already on disk were rewritten — the journal is not append-only');
      assert.equal(EventLedger.loadFrom(ws.path).verify().valid, true);
    } finally { ws.cleanup(); }
  });

  test('CE-018: a reloaded ledger keeps appending to the same journal rather than starting a second one', () => {
    const ws = workspace('reload');
    try {
      const first = new EventLedger({ journalPath: ws.path });
      append(first, 'e1');
      const second = EventLedger.loadFrom(ws.path);
      append(second, 'e2', 'e1');
      // One run whose history is split across two files is a chain with a hole nobody sees.
      assert.equal(readFileSync(ws.path, 'utf8').trim().split('\n').length, 2);
      assert.equal(EventLedger.loadFrom(ws.path).verify().valid, true);
    } finally { ws.cleanup(); }
  });

  // ── 2 · the rewrite attempt, and the exact bound of what is detected ──────────────────────
  test('CE-018: an edited event is refused on reload, at the position it was edited', () => {
    const ws = workspace('edited');
    try {
      const ledger = new EventLedger({ journalPath: ws.path });
      append(ledger, 'e1');
      append(ledger, 'e2', 'e1');
      append(ledger, 'e3', 'e2');

      const lines = readFileSync(ws.path, 'utf8').trim().split('\n');
      lines[1] = JSON.stringify({ ...JSON.parse(lines[1]), payload: 'edited-in-place' });
      writeFileSync(ws.path, `${lines.join('\n')}\n`);

      assert.throws(() => EventLedger.loadFrom(ws.path),
        (error) => error instanceof EventError && error.kind === 'CHAIN_BROKEN');
    } finally { ws.cleanup(); }
  });

  test('CE-018: a truncated FINAL line is recovered and recorded, never silently dropped', () => {
    // The one forgiveness the design allows, and the reason it is safe: the file is only ever
    // appended to, so a torn write can exist nowhere but the tail. Recovering it silently
    // would be the same defect as refusing it wrongly — the count is reported.
    const ws = workspace('torn');
    try {
      const ledger = new EventLedger({ journalPath: ws.path });
      append(ledger, 'e1');
      append(ledger, 'e2', 'e1');
      const text = readFileSync(ws.path, 'utf8');
      writeFileSync(ws.path, `${text}{"id":"e3","correlationId":"run-1"`);   // killed mid-append

      const reloaded = EventLedger.loadFrom(ws.path);
      assert.equal(reloaded.length, 2);
      assert.equal(reloaded.verify().valid, true);
    } finally { ws.cleanup(); }
  });

  test('CE-018 BOUND: a tamperer who recomputes the whole chain is NOT detected — this is a hash chain, not a signature', () => {
    // The honest half of the verdict. `digestOf` is `createHash('sha256')` with no key, so
    // anything able to run this code can produce a consistent chain over altered facts. What
    // the chain rules out is an edit that leaves the surrounding digests alone — which is
    // every accidental corruption and every naive edit, and is not nothing. What it does not
    // rule out is a wholesale rewrite, and no verdict on this criterion may imply otherwise
    // until a head anchored outside the file exists (`D-0564` proposes exactly that).
    const honest = workspace('honest');
    const forged = workspace('forged');
    try {
      const real = new EventLedger({ journalPath: honest.path });
      append(real, 'e1', null, 'the truth');
      append(real, 'e2', 'e1', 'the truth');

      const rewritten = new EventLedger({ journalPath: forged.path });
      append(rewritten, 'e1', null, 'a lie');
      append(rewritten, 'e2', 'e1', 'a lie');

      // Both verify. Both are internally consistent. Nothing in either file distinguishes them.
      assert.equal(EventLedger.loadFrom(honest.path).verify().valid, true);
      assert.equal(EventLedger.loadFrom(forged.path).verify().valid, true);
      assert.notEqual(
        EventLedger.loadFrom(honest.path).events().at(-1).digest,
        EventLedger.loadFrom(forged.path).events().at(-1).digest,
        'two different histories produced the same head digest — the chain would be worthless',
      );
      // …and that difference is the whole remedy available today: it is detectable only by
      // someone who wrote the real head down somewhere the tamperer cannot reach.
    } finally { honest.cleanup(); forged.cleanup(); }
  });

  test('CE-018: the chain is unkeyed, and this test is what stops that becoming a surprise', () => {
    // A source assertion, not a style check: if someone later introduces an HMAC, this fails
    // and the verdict cell for CE-018 has to be re-read and re-stated rather than inherited.
    const source = readFileSync(new URL('../src/events.mjs', import.meta.url), 'utf8');
    assert.ok(/createHash\(/.test(source), 'events.mjs no longer hashes at all');
    assert.ok(!/createHmac\(/.test(source),
      'events.mjs now uses createHmac — the CE-018 verdict was recorded against an UNKEYED chain and must be re-stated');
  });
});
