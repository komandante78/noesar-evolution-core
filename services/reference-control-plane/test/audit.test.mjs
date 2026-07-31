// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLedger } from '../src/audit.mjs';

test('audit ledger verifies its hash chain', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'noesar-audit-'));
  const ledger = new AuditLedger(join(root, 'events.jsonl'));
  ledger.append({ actor:'test', action:'one', result:'ok' });
  ledger.append({ actor:'test', action:'two', result:'ok' });
  assert.equal(ledger.verify(), true);
});

// Deferred debt item (phase 5): append() used to call readAll() — parsing every line ever
// written — on every single write, just to find the previous hash. Proves the fix without
// timing the ledger's own file I/O (unreliable in CI): readAll() is called exactly once,
// at construction, no matter how many events are appended afterward.
test('append() reads the whole ledger from disk once, at construction — never again per write', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'noesar-audit-'));
  const ledger = new AuditLedger(join(root, 'events.jsonl'));
  let readAllCalls = 0;
  const originalReadAll = ledger.readAll.bind(ledger);
  ledger.readAll = (...args) => { readAllCalls += 1; return originalReadAll(...args); };
  for (let i = 0; i < 50; i += 1) ledger.append({ actor: 'test', action: `event-${i}`, result: 'ok' });
  assert.equal(readAllCalls, 0, 'append() must not call readAll() at all once lastHash is cached');
  assert.equal(ledger.verify(), true);
});

test('a second instance opened on the same path picks up the real last hash, not GENESIS', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'noesar-audit-'));
  const path = join(root, 'events.jsonl');
  const first = new AuditLedger(path);
  const written = first.append({ actor: 'test', action: 'one', result: 'ok' });
  const second = new AuditLedger(path); // simulates a process restart re-opening the same file
  const chained = second.append({ actor: 'test', action: 'two', result: 'ok' });
  assert.equal(chained.previousHash, written.hash);
  assert.equal(second.verify(), true);
});
