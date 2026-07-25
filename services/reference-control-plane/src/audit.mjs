// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class AuditLedger {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  readAll() {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  append(event) {
    const records = this.readAll();
    const previousHash = records.at(-1)?.hash ?? 'GENESIS';
    const unsigned = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      previousHash,
      ...event,
    };
    const hash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    const record = { ...unsigned, hash };
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
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
