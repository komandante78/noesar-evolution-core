// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class AuditLedger {
  // `lastHash` is read from disk ONCE, here, and kept in memory from then on. `append()`
  // used to call `readAll()` — parsing every line ever written — just to find the hash of
  // the ONE most recent record, making every write O(n) in the size of the whole ledger
  // (deferred debt item, phase 5). `server.mjs` constructs exactly one `AuditLedger` per
  // process and reuses it for the process's lifetime (a module-level singleton, grepped —
  // no per-request construction anywhere), so this instance is the only writer that
  // matters; a second instance opened against the same path (as several tests do, to
  // verify what a first instance wrote) still reads the file fresh at ITS OWN
  // construction, which is the one place an O(n) read is actually unavoidable.
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.lastHash = this.readAll().at(-1)?.hash ?? 'GENESIS';
  }

  readAll() {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  append(event) {
    const unsigned = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      previousHash: this.lastHash,
      ...event,
    };
    const hash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    const record = { ...unsigned, hash };
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    this.lastHash = hash;
    return record;
  }

  verify() {
    const records = this.readAll();
    let previous = 'GENESIS';
    for (const record of records) {
      const { hash, ...unsigned } = record;
      if (unsigned.previousHash !== previous) return false;
      const actual = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
      if (actual !== hash) return false;
      previous = hash;
    }
    return true;
  }
}
