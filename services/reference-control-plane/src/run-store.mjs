// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Durable storage for workspace-action runs (D-0338).
//
// Until this existed, `WorkspaceActionOrchestrator.#runs` was a Map on one instance and the
// orchestrator's own status said so: *"a restart clears every pending or promoted run"*. An
// operator who planned a change, went to lunch and came back to a restarted container found
// the plan gone, with the shadow and the events that described it still on disk — the
// evidence of a decision surviving while the decision itself did not.
//
// ## Why one file per run, and not one file for all of them
//
// A run record is FAT: `files[].contents` carries every planned file in full, and
// `authoredContents` carries what the Author wrote for each of them. Rewriting a single
// document containing every run on every mutation would cost the total size of all runs per
// approve. Per-run files make a write O(1) in the number of runs, and they fail
// independently — a truncated record loses one run instead of the set.
//
// ## Why the codec refuses instead of degrading
//
// This is the whole reason this file is not four lines of `JSON.stringify`.
//
// `authoredContents` is a **Map** (`workspace-actions.mjs`), and `approve()` reads it with
// `run.authoredContents?.get(path)`, falling back to the file's ORIGINAL contents when the
// lookup misses. `JSON.stringify(new Map([['a','b']]))` is `'{}'` — silently, with no error.
// A naive round trip would therefore have produced a run that reloaded, looked complete,
// passed a shallow test, and made `approve()` write the original bytes instead of the ones
// the model authored. The product would have discarded its own generated code and reported
// success.
//
// So the codec is explicit about every type it can carry, and **throws on anything else**,
// naming the path. A field added later that holds a Set, a Date, a class instance or a
// BigInt fails loudly at the first write rather than arriving back as `{}` or a string.
// That refusal is the feature: silent degradation is the failure mode this store exists to
// make impossible.

import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';

export const RUN_STORE_VERSION = 1;

// Rare enough that a collision would be deliberate. A plain object carrying this key is
// refused rather than guessed at — see `encode`.
const TAG = '$noesar$';

export class RunStoreError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'RunStoreError';
    this.kind = kind;
  }
}

/**
 * Encode a value into something `JSON.stringify` carries without loss.
 *
 * Maps and Sets become tagged objects; everything else must already be JSON-safe or this
 * throws. `undefined` object properties are dropped exactly as JSON drops them, which is
 * behaviourally identical for the `?.`/`??` reads the orchestrator uses — an absent property
 * and a property holding `undefined` answer the same way.
 */
export function encode(value, path = 'run') {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    // NaN and Infinity both become `null` through JSON, which would turn a broken number
    // into a plausible-looking absence.
    if (!Number.isFinite(value)) throw new RunStoreError('UNSUPPORTED_VALUE', `${path} is ${String(value)}, which JSON cannot carry`);
    return value;
  }
  if (type === 'undefined') return undefined;
  if (Array.isArray(value)) return value.map((item, index) => encode(item, `${path}[${index}]`));
  if (value instanceof Map) {
    return { [TAG]: 'Map', entries: [...value.entries()].map(([key, item], index) => {
      if (typeof key !== 'string') throw new RunStoreError('UNSUPPORTED_VALUE', `${path} is a Map with a non-string key at ${index}`);
      return [key, encode(item, `${path}.get(${key})`)];
    }) };
  }
  if (value instanceof Set) {
    return { [TAG]: 'Set', values: [...value.values()].map((item, index) => encode(item, `${path}<${index}>`)) };
  }
  if (value instanceof Date) {
    return { [TAG]: 'Date', iso: value.toISOString() };
  }
  // Buffers, as base64 — exact bytes, not text.
  //
  // Found by the refusal above rather than by design, which is the codec earning its keep:
  // `run.backups[].beforeContent` is a Buffer holding the file's previous bytes, and it is
  // what `restore()` writes back. Two ways to get this wrong, both silent. Left unsupported,
  // every approved run failed to save and the operator's undo did not survive a restart —
  // which is what actually happened here, and what a test caught. Stored as a UTF-8 string
  // instead, a backup of a PNG or any non-UTF-8 file would come back corrupted, and the
  // restore would write damage over the original.
  if (Buffer.isBuffer(value)) {
    return { [TAG]: 'Buffer', base64: value.toString('base64') };
  }
  if (type === 'object') {
    // Only plain objects. A class instance would lose its prototype and come back as data
    // that no longer answers its own methods — the `authoredContents` failure in another
    // costume.
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RunStoreError('UNSUPPORTED_VALUE', `${path} is a ${value.constructor?.name ?? 'class'} instance, which cannot round-trip`);
    }
    if (Object.hasOwn(value, TAG)) {
      throw new RunStoreError('UNSUPPORTED_VALUE', `${path} carries the reserved key \`${TAG}\``);
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const encoded = encode(item, `${path}.${key}`);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
  }
  throw new RunStoreError('UNSUPPORTED_VALUE', `${path} is a ${type}, which cannot be stored`);
}

/** Invert `encode`. Anything carrying an unknown tag is refused, never returned as data. */
export function decode(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  const tag = value[TAG];
  if (tag === 'Map') return new Map(value.entries.map(([key, item]) => [key, decode(item)]));
  if (tag === 'Set') return new Set(value.values.map(decode));
  if (tag === 'Date') return new Date(value.iso);
  if (tag === 'Buffer') return Buffer.from(value.base64, 'base64');
  if (tag !== undefined) throw new RunStoreError('UNKNOWN_TAG', `stored value carries unknown tag \`${tag}\``);
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = decode(item);
  return out;
}

/** A runId must never be able to name a path outside the store's own directory. */
function fileNameFor(runId) {
  const id = String(runId ?? '');
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
    throw new RunStoreError('INVALID_RUN_ID', `\`${id}\` is not a storable run id`);
  }
  return `${id}.json`;
}

/**
 * Runs on disk, one file each, written atomically.
 *
 * `null` for `directory` makes this a no-op store that reports `durable:false` — the shape
 * the unit suites and any embedder that does not want a filesystem can use, and the reason
 * the orchestrator does not have to know whether it is durable.
 */
export class RunStore {
  #directory;

  constructor(directory) {
    this.#directory = directory ?? null;
    if (this.#directory) mkdirSync(this.#directory, { recursive:true, mode:0o700 });
  }

  get durable() { return this.#directory !== null; }
  get directory() { return this.#directory; }

  save(runId, record) {
    if (!this.#directory) return;
    const name = fileNameFor(runId);
    const document = { version: RUN_STORE_VERSION, runId, savedAtUnix: Math.floor(Date.now() / 1000), run: encode(record) };
    const target = join(this.#directory, name);
    // Same temp-then-rename as AtomicJsonStore: a reader either sees the previous complete
    // file or the new complete one, never a half-written run. The pid in the temp name keeps
    // two processes from colliding on the scratch path.
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(document)}\n`, { encoding:'utf8', mode:0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
  }

  delete(runId) {
    if (!this.#directory) return;
    rmSync(join(this.#directory, fileNameFor(runId)), { force:true });
  }

  /**
   * Keep the newest `keep` run files and remove the rest — `D-0346`.
   *
   * WHY IT EXISTS. `save()` has written one file per run since durability was built
   * (`D-0338`) and nothing has ever removed one. On a self-hosted installation that runs
   * for months that is a disk filling up in silence, which is the worst way for a disk to
   * fill: the product keeps working until the moment it cannot write anything at all,
   * including the audit ledger.
   *
   * WHAT IT WILL NOT DO. It never removes a run the caller named as protected. The caller
   * is the one that knows which runs are still live — a `PENDING_APPROVAL` run is somebody
   * waiting for a decision, and deleting it because it is old would answer the decision by
   * losing the question. Protection wins over both limits, always, and a protected run is
   * counted separately rather than silently occupying the budget.
   *
   * WHAT IT REMOVES IS NOT THE AUDIT TRAIL. Runs are working state; the event ledger is a
   * separate, append-only surface and nothing here touches it. Pruning a run loses the
   * ability to replay it, not the record that it happened.
   *
   * Ordering is by `savedAtUnix` from inside each file, not by filesystem mtime: a restore
   * from backup, a `cp -r`, or a container rebuild all rewrite mtimes, and pruning by them
   * would throw away the oldest RESTORED files rather than the oldest runs.
   */
  prune({ keep = 500, protectedRunIds = new Set() } = {}) {
    const result = { removed: [], kept: 0, protectedCount: 0, damagedSkipped: 0 };
    if (!this.#directory || !existsSync(this.#directory)) return result;
    if (!Number.isInteger(keep) || keep < 0) {
      throw new RunStoreError('INVALID_RETENTION', `keep must be a non-negative integer, got ${keep}`);
    }

    const candidates = [];
    for (const name of readdirSync(this.#directory)) {
      if (!name.endsWith('.json')) continue;
      let document;
      try {
        document = JSON.parse(readFileSync(join(this.#directory, name), 'utf8'));
      } catch {
        // A file this store cannot read is a file it will not delete. `loadAll()` already
        // reports it as damaged; guessing that unreadable means disposable is how evidence
        // disappears exactly when something has gone wrong.
        result.damagedSkipped += 1;
        continue;
      }
      if (protectedRunIds.has(document.runId)) { result.protectedCount += 1; continue; }
      candidates.push({ name, runId: document.runId, savedAtUnix: Number(document.savedAtUnix) || 0 });
    }

    candidates.sort((a, b) => b.savedAtUnix - a.savedAtUnix || (a.name < b.name ? 1 : -1));
    result.kept = Math.min(candidates.length, keep);
    for (const victim of candidates.slice(keep)) {
      rmSync(join(this.#directory, victim.name), { force: true });
      result.removed.push(victim.runId);
    }
    return result;
  }

  /**
   * Every stored run, plus what could not be read.
   *
   * A damaged file is REPORTED, never dropped in silence and never allowed to stop the rest
   * from loading: an installation that lost one run to a full disk must still come back with
   * the others, and must be able to say which one it lost. The caller decides what to do
   * with `damaged`; this only refuses to lie about it.
   */
  loadAll() {
    if (!this.#directory || !existsSync(this.#directory)) return { runs: [], damaged: [] };
    const runs = [];
    const damaged = [];
    for (const name of readdirSync(this.#directory).sort()) {
      if (!name.endsWith('.json')) continue;
      const full = join(this.#directory, name);
      try {
        const document = JSON.parse(readFileSync(full, 'utf8'));
        if (document.version !== RUN_STORE_VERSION) {
          throw new RunStoreError('UNSUPPORTED_VERSION', `run file version ${document.version} is not ${RUN_STORE_VERSION}`);
        }
        runs.push({ runId: document.runId, run: decode(document.run) });
      } catch (error) {
        damaged.push({ file: name, reason: error.message });
      }
    }
    return { runs, damaged };
  }
}
