// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonStore {
  constructor(path) { this.path = path; mkdirSync(dirname(path), { recursive: true }); }
  read() {
    if (!existsSync(this.path)) return { schemaVersion: 1, approvals: [], settings: {} };
    return JSON.parse(readFileSync(this.path, 'utf8'));
  }
  write(value) {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.path);
  }
  addApproval(approval) {
    const state = this.read();
    state.approvals.push(approval);
    this.write(state);
    return approval;
  }
}
