// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export const AI_STATE_VERSION = 1;

export function defaultAiState() {
  return {
    schemaVersion: AI_STATE_VERSION,
    projects: [],
    conversations: [],
    messages: [],
    branches: [],
    memories: [],
    artifacts: [],
    sources: [],
    knowledgeChunks: [],
    providerProfiles: [],
    tools: [],
    agents: [],
    agentRuns: [],
    tasks: [],
    settings: {
      defaultProviderId: null,
      externalEgressDefault: 'deny',
      retentionDays: 365,
      semanticSearchEnabled: true,
    },
  };
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('AI workspace state must be an object.');
  if (state.schemaVersion !== AI_STATE_VERSION) throw new Error(`Unsupported AI workspace schemaVersion: ${state.schemaVersion}`);
  for (const key of ['projects','conversations','messages','branches','memories','artifacts','sources','knowledgeChunks','providerProfiles','tools','agents','agentRuns','tasks']) {
    if (!Array.isArray(state[key])) throw new Error(`AI workspace state.${key} must be an array.`);
  }
  return state;
}

export class AtomicJsonStore {
  constructor(path, initialFactory = defaultAiState) {
    this.path = path;
    this.initialFactory = initialFactory;
    mkdirSync(dirname(path), { recursive:true, mode:0o700 });
  }

  read() {
    if (!existsSync(this.path)) return this.initialFactory();
    return validateState(JSON.parse(readFileSync(this.path, 'utf8')));
  }

  write(state) {
    validateState(state);
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding:'utf8', mode:0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
    chmodSync(this.path, 0o600);
    return state;
  }

  transact(mutator) {
    const state = structuredClone(this.read());
    const result = mutator(state);
    this.write(state);
    return result;
  }
}
