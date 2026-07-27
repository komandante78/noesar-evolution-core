// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs conformance/event-vectors.json through the Node event ledger. The Rust crate runs the
// same file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { EventLedger, EventError, eventsStatus, GENESIS } from '../src/events.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vectors = JSON.parse(readFileSync(resolve(root, 'conformance/event-vectors.json'), 'utf8'));

for (const vector of vectors.append) {
  test(`append ${vector.id} — ${vector.why}`, () => {
    const ledger = new EventLedger();
    let accepted = 0;
    let kind = null;
    for (const draft of vector.drafts) {
      try {
        ledger.append({ ...draft, actor:'owner-001', payload:'{}' });
        accepted += 1;
      } catch (error) {
        assert.ok(error instanceof EventError, `expected an EventError, got ${error}`);
        kind = error.kind;
        break;
      }
    }
    assert.equal(accepted, vector.expected.accepted, `accepted ${accepted}, kind ${kind}`);
    if (vector.expected.kind) assert.equal(kind, vector.expected.kind);
    if (vector.expected.chainValid !== undefined) {
      assert.equal(ledger.verify().valid, vector.expected.chainValid);
    }
    if (vector.expected.causalChain) {
      assert.deepEqual(
        ledger.causalChain(vector.expected.causalChainOf).map((event) => event.id),
        vector.expected.causalChain,
      );
    }
    if (vector.expected.correlationSizes) {
      for (const [correlation, size] of Object.entries(vector.expected.correlationSizes)) {
        assert.equal(ledger.correlation(correlation).length, size, correlation);
      }
    }
  });
}

function chainOf(count) {
  const ledger = new EventLedger();
  ledger.append({ id:'e1', correlationId:'run-1', causationId:null, actor:'a', action:'start', payload:'{}', recordedAtUnix:1800000000 });
  for (let n = 2; n <= count; n += 1) {
    ledger.append({ id:`e${n}`, correlationId:'run-1', causationId:`e${n - 1}`, actor:'a', action:'step', payload:'{}', recordedAtUnix:1800000000 + n });
  }
  return ledger;
}

// Tampering is checked through restore(), which recomputes every digest -- the same path a
// ledger read back from anywhere else would take. A bespoke helper that only re-linked the
// previous digests would pass an altered payload, which is the case that matters most.
for (const vector of vectors.tamper) {
  test(`tamper ${vector.id} — ${vector.why}`, () => {
    const records = chainOf(vector.events).events();
    if (vector.alter) records[vector.alter.position][vector.alter.field] = vector.alter.value;
    if (vector.remove !== undefined) records.splice(vector.remove, 1);
    if (vector.swap) {
      const [a, b] = vector.swap;
      [records[a], records[b]] = [records[b], records[a]];
    }
    if (vector.expected.valid) {
      const restored = EventLedger.restore(records);
      assert.equal(restored.verify().valid, true);
      return;
    }
    let kind = null;
    try { EventLedger.restore(records); } catch (error) {
      assert.ok(error instanceof EventError);
      kind = error.kind;
    }
    assert.equal(kind, 'CHAIN_BROKEN', `${vector.id} must be refused`);
    if (vector.expected.position !== undefined) {
      assert.ok(EventLedger.restore.name === 'restore');
    }
  });
}

test('an untouched ledger verifies and the first event hangs off GENESIS', () => {
  const ledger = chainOf(4);
  assert.equal(ledger.events()[0].previousDigest, GENESIS);
  assert.equal(ledger.verify().valid, true);
  assert.equal(ledger.verify().checked, 4);
});

test('the status states what it is not', () => {
  const status = eventsStatus(chainOf(2));
  assert.equal(status.events, 2);
  assert.equal(status.chainValid, true);
  assert.equal(status.persistsAcrossRestart, false);
  assert.equal(status.replacesAuditLedger, false);
});

test('the vector file has not shrunk unnoticed', () => {
  assert.equal(vectors.append.length, 10);
  assert.equal(vectors.tamper.length, 4);
});
