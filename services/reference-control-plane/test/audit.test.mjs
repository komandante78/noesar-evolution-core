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
