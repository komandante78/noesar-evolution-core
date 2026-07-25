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
