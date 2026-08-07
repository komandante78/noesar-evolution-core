// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync,
} from 'node:fs';
import { dirname } from 'node:path';

function emptyState() {
  return {
    schemaVersion: 2,
    initialized: false,
    pendingOwner: null,
    users: [],
    sessions: [],
    loginChallenges: [],
    // Terminal attach codes (D-0337). Defaulted here rather than migrated: `read()` spreads
    // this object UNDER the parsed file, so a state file written before this field existed
    // gets an empty array instead of `undefined` — which is what every `.filter` on it
    // depends on. No schemaVersion bump, because there is no migration to perform: a
    // version number that moves without a migration behind it is a claim, not a fact.
    attachCodes: [],
  };
}

export class AuthStore {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  read() {
    if (!existsSync(this.path)) return emptyState();
    const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
    return { ...emptyState(), ...parsed };
  }

  write(value) {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding:'utf8', mode:0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
  }

  update(mutator) {
    const state = this.read();
    const result = mutator(state);
    this.write(state);
    return result;
  }
}
