// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export const AI_STATE_VERSION = 4;

// Every collection the current version requires. Adding a name here is a schema change
// and needs a migration below — a state file written before the name existed does not
// have it, and `state.<name>.push(...)` on `undefined` is a crash on the first write.
const REQUIRED_COLLECTIONS = Object.freeze([
  'projects','conversations','messages','branches','memories','artifacts','sources',
  'knowledgeChunks','providerProfiles','tools','agents','agentRuns','tasks',
  'workflows','workflowRuns','reviewSamples','closures','remoteTargets',
]);

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
    workflows: [],
    workflowRuns: [],
    reviewSamples: [],
    closures: [],
    // D-0286, Debug Evolution Phase 3: no secret ever lives in this record — `encryptedCredential`
    // holds the SSH private key exactly the way `providerProfiles` holds a provider API key
    // (same CredentialVault, same shape). `pinnedHostKey` is the host's OWN public key, not a
    // secret, captured at registration time and used to verify every later connection.
    remoteTargets: [],
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
  for (const key of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(state[key])) throw new Error(`AI workspace state.${key} must be an array.`);
  }
  return state;
}

// Forward migrations, applied in order on read. Each one takes state at version N and
// returns state at version N+1; the key is registered under the version it upgrades FROM.
//
// This exists because of a defect already found on this project: migration 0012 could
// never be applied to any cluster, which was proof the SQL had never been executed. A
// version bump with no migration beside it is the same defect in a different file — the
// installed workspace carries `schemaVersion: 1`, so bumping the constant alone would
// make the AI workspace refuse to load on the next deployment.
const MIGRATIONS = Object.freeze({
  // 1 -> 2: workflows and their runs (WP-2). Purely additive: two empty collections.
  1: (state) => ({ ...state, schemaVersion: 2, workflows: state.workflows ?? [], workflowRuns: state.workflowRuns ?? [] }),
  // 2 -> 3: the review-time samples behind the product metric (UI-070…UI-072), the
  // closures that carry the NOT DONE box (UI-036), and the two fields a session needs to
  // be archivable and binnable (UI-011, UI-012).
  //
  // The collection is additive; the conversation fields are not, quite: a record written
  // before this version has neither, and `conversation.deletedAt` reading `undefined`
  // would make a session look alive to one check and dead to another depending on which
  // operator was used. Filling them in here means every record answers the same way.
  2: (state) => ({
    ...state,
    schemaVersion: 3,
    reviewSamples: state.reviewSamples ?? [],
    closures: state.closures ?? [],
    conversations: (state.conversations ?? []).map((item) => ({
      ...item,
      deletedAt: item.deletedAt ?? null,
      purgeAfter: item.purgeAfter ?? null,
    })),
  }),
  // 3 -> 4: D-0286, Debug Evolution Phase 3 (remote targets over SSH). Purely additive:
  // one empty collection, same posture as 1->2's workflows/workflowRuns.
  3: (state) => ({ ...state, schemaVersion: 4, remoteTargets: state.remoteTargets ?? [] }),
});

export function migrateAiState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('AI workspace state must be an object.');
  let state = input;
  // A file from the future is refused rather than guessed at: an older build must not
  // operate on state whose invariants it does not know, because it would not corrupt
  // loudly — it would corrupt quietly.
  if (state.schemaVersion > AI_STATE_VERSION) {
    throw new Error(`AI workspace state is version ${state.schemaVersion}, newer than this build supports (${AI_STATE_VERSION}).`);
  }
  while (state.schemaVersion !== AI_STATE_VERSION) {
    const migrate = MIGRATIONS[state.schemaVersion];
    if (!migrate) throw new Error(`No migration from AI workspace schemaVersion ${state.schemaVersion}.`);
    const before = state.schemaVersion;
    state = migrate(state);
    if (state.schemaVersion === before) throw new Error(`Migration from schemaVersion ${before} did not advance the version.`);
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
    return validateState(migrateAiState(JSON.parse(readFileSync(this.path, 'utf8'))));
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
