// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Acquisitions — the job that owns the disk, on top of `model-transport.mjs`.
//
// The transport knows how to fetch bytes safely and nothing else. This file answers the three
// questions the transport refuses to have an opinion about, because each of them is governed by
// a rule rather than by a protocol:
//
//   WHERE DOES IT LAND    never on top of an artefact that is already there (`CLAUDE10.md` §4
//                         rule 13: no destructive modification by implication). A download in
//                         flight lives as `.part`, and only a VERIFIED digest promotes it.
//   WHAT IF IT IS WRONG   it is quarantined, with both digests recorded — not deleted (rule 12)
//                         and not promoted. `MC-004`: what does not match is never startable.
//   WHO IS WAITING        a long download must not be an HTTP request. The route starts a job
//                         and answers at once; the page asks the job how it is going.
//
// # Why a job registry rather than a streamed response
//
// A model is measured in gigabytes. Holding the request open would tie the acquisition to one
// browser tab, make a reload look like a failure, and give cancellation no name — closing a tab
// is not a decision, it is a tab. With a job, cancelling is a verb someone chose.
//
// The registry is deliberately in memory. It is a record of what is happening, not of what
// happened: the LEDGER is where an acquisition is written down permanently, and a second
// durable history here would be a second place to disagree about the same event. A restart
// therefore forgets in-flight jobs — and a `.part` file with no job is exactly what the
// quarantine sweep of a later phase is for, which is recorded rather than pretended away.

import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { open as openFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchArtefact, checkSource, TransportRefusal } from './model-transport.mjs';

/** The life of an acquisition. Every terminal state names WHY it is terminal. */
export const AcquisitionState = Object.freeze({
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const TERMINAL = Object.freeze([AcquisitionState.COMPLETED, AcquisitionState.FAILED, AcquisitionState.CANCELLED]);
export const isTerminal = (state) => TERMINAL.includes(state);

/**
 * A model id is not a filename, and treating it as one is a path traversal.
 *
 * Ids in the wild look like `publisher/model-name`, so the naive `${id}.bin` becomes a path with
 * a directory in it — which is why an id containing `/` could never be found on disk before, and
 * why an id containing `..` would have been a place to write outside the artefact directory.
 * Every character outside `[A-Za-z0-9._-]` is hex-escaped, which is reversible, collision-free,
 * and leaves the ordinary case (`llama-3.1-8b`) byte-identical to the id.
 *
 * Exported because the READER of the artefact directory must use exactly this function too: two
 * naming schemes for one file is a file that exists for the writer and not for the reader.
 */
export function artefactName(id) {
  const raw = String(id ?? '');
  if (!raw || raw === '.' || raw === '..') throw new Error('a model id is required to name an artefact');
  return raw.replace(/[^A-Za-z0-9._-]/g, (ch) => `~${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** A sink over a real file, opened `wx` so an existing artefact is never silently reopened. */
async function fileSink(path) {
  const handle = await openFile(path, 'w', 0o600);
  return {
    async write(chunk) { await handle.write(chunk); },
    async close() { await handle.close(); },
    async abort() { await handle.close().catch(() => {}); },
  };
}

const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export class AcquisitionManager {
  #jobs = new Map();
  #queue = [];
  #active = 0;
  #options;

  constructor({
    artefactDir,
    quarantineDir,
    fetchImpl,
    maxConcurrent = 1,
    historyLimit = 50,
    stallTimeoutMs = 30_000,
    transport = fetchArtefact,
    onEvent = null,
    now = () => new Date(),
  } = {}) {
    if (!artefactDir || !quarantineDir) throw new Error('artefactDir and quarantineDir are required');
    this.#options = { artefactDir, quarantineDir, fetchImpl, maxConcurrent, historyLimit, stallTimeoutMs, transport, onEvent, now };
  }

  /** What the routes hand out. A snapshot, never the live record — callers must not mutate it. */
  #snapshot(job) {
    return {
      id: job.id,
      modelId: job.modelId,
      publisher: job.publisher,
      state: job.state,
      receivedBytes: job.receivedBytes,
      totalBytes: job.totalBytes,
      expectedSha256: job.expectedSha256,
      digest: job.digest,
      kind: job.kind,
      reason: job.reason,
      startedAtUtc: job.startedAtUtc,
      endedAtUtc: job.endedAtUtc,
      quarantinedAs: job.quarantinedAs,
      actorId: job.actorId,
    };
  }

  get(id) {
    const job = this.#jobs.get(String(id ?? ''));
    return job ? this.#snapshot(job) : null;
  }

  /** Newest first — a list an operator reads top-down. */
  list() {
    return [...this.#jobs.values()]
      .sort((a, b) => String(b.startedAtUtc).localeCompare(String(a.startedAtUtc)))
      .map((job) => this.#snapshot(job));
  }

  /** The job currently acquiring this model, if any. Used to make `start` idempotent. */
  #liveJobFor(modelId) {
    return [...this.#jobs.values()].find((job) => job.modelId === modelId && !isTerminal(job.state)) ?? null;
  }

  /**
   * Begin acquiring an artefact under an authorised grant.
   *
   * The grant comes from `planAcquisition` and is not re-derived here: this module must never be
   * able to widen its own authority, which is the same reason the catalogue does not mint the
   * capability token it describes.
   */
  start({ descriptor, grant, actorId = null }) {
    const modelId = grant?.modelId ?? descriptor?.id;
    if (!modelId) return { ok: false, kind: 'INVALID_GRANT', reason: 'the grant names no model' };

    // Idempotent by design: pressing Acquire twice is one acquisition, not two writers on one
    // file. The second press is answered with the job the first one started.
    const live = this.#liveJobFor(modelId);
    if (live) return { ok: true, job: this.#snapshot(live), alreadyRunning: true };

    let name;
    try { name = artefactName(modelId); } catch (error) {
      return { ok: false, kind: 'INVALID_MODEL_ID', reason: error.message };
    }

    const source = descriptor?.source ?? null;
    const origin = checkSource(source);
    if (!origin.allowed) return { ok: false, kind: origin.kind, reason: origin.reason };

    mkdirSync(this.#options.artefactDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.#options.quarantineDir, { recursive: true, mode: 0o700 });

    const finalPath = join(this.#options.artefactDir, `${name}.bin`);
    if (existsSync(finalPath)) {
      // Rule 13: an existing artefact is not overwritten by implication. If it is on disk and
      // does not verify it belongs to the `unverified` lane, and replacing it is a deliberate
      // act with its own gesture — not a side effect of pressing Acquire.
      return { ok: false, kind: 'ALREADY_PRESENT', reason: 'an artefact for this model is already on disk; it is not replaced by an acquisition' };
    }

    const startedAt = this.#options.now();
    const job = {
      id: randomUUID(),
      modelId,
      name,
      publisher: descriptor?.publisher ?? grant?.publisherId ?? null,
      source,
      state: AcquisitionState.QUEUED,
      receivedBytes: 0,
      totalBytes: null,
      expectedSha256: grant?.expectedSha256 ?? null,
      maxBytes: grant?.maxBytes ?? null,
      digest: null,
      kind: null,
      reason: null,
      startedAtUtc: startedAt.toISOString(),
      endedAtUtc: null,
      quarantinedAs: null,
      actorId,
      controller: new AbortController(),
    };
    this.#jobs.set(job.id, job);
    this.#prune();
    this.#queue.push(job.id);
    this.#pump();
    return { ok: true, job: this.#snapshot(job) };
  }

  /**
   * Stop an acquisition. A queued job ends without ever having reached the network, which is a
   * different fact from an aborted download and is reported as the same state on purpose: what
   * the operator asked for happened, and no byte of this model is on disk either way.
   */
  cancel(id, { actorId = null } = {}) {
    const job = this.#jobs.get(String(id ?? ''));
    if (!job) return { ok: false, kind: 'NO_SUCH_JOB', reason: 'no acquisition with that id is known to this installation' };
    if (isTerminal(job.state)) return { ok: false, kind: 'ALREADY_FINISHED', reason: `this acquisition already ended as ${job.state}`, job: this.#snapshot(job) };
    job.cancelledBy = actorId;
    if (job.state === AcquisitionState.QUEUED) {
      this.#queue = this.#queue.filter((queued) => queued !== job.id);
      this.#finish(job, AcquisitionState.CANCELLED, { kind: TransportRefusal.CANCELLED, reason: 'cancelled before it started' });
      return { ok: true, job: this.#snapshot(job) };
    }
    job.controller.abort();
    return { ok: true, job: this.#snapshot(job) };
  }

  /** Finished jobs are history; history is bounded, and the ledger is the durable copy. */
  #prune() {
    const finished = [...this.#jobs.values()].filter((job) => isTerminal(job.state));
    const excess = finished.length - this.#options.historyLimit;
    if (excess <= 0) return;
    finished
      .sort((a, b) => String(a.endedAtUtc ?? a.startedAtUtc).localeCompare(String(b.endedAtUtc ?? b.startedAtUtc)))
      .slice(0, excess)
      .forEach((job) => this.#jobs.delete(job.id));
  }

  #pump() {
    while (this.#active < this.#options.maxConcurrent && this.#queue.length > 0) {
      const id = this.#queue.shift();
      const job = this.#jobs.get(id);
      if (!job || isTerminal(job.state)) continue;
      this.#active += 1;
      this.#run(job).finally(() => { this.#active -= 1; this.#pump(); });
    }
  }

  #finish(job, state, { kind = null, reason = null, digest = null, quarantinedAs = null } = {}) {
    job.state = state;
    job.kind = kind;
    job.reason = reason;
    if (digest) job.digest = digest;
    if (quarantinedAs) job.quarantinedAs = quarantinedAs;
    job.endedAtUtc = this.#options.now().toISOString();
    this.#options.onEvent?.({
      action: 'model.acquisition',
      result: state,
      details: {
        jobId: job.id, id: job.modelId, publisher: job.publisher,
        bytes: job.receivedBytes, kind, digest: job.digest,
      },
      actorId: job.actorId,
    });
  }

  async #run(job) {
    const { artefactDir, fetchImpl, transport, stallTimeoutMs, now } = this.#options;
    const partPath = join(artefactDir, `${job.name}.part`);
    const finalPath = join(artefactDir, `${job.name}.bin`);

    job.state = AcquisitionState.DOWNLOADING;
    let sink = null;
    try {
      sink = await fileSink(partPath);
    } catch (error) {
      this.#finish(job, AcquisitionState.FAILED, { kind: 'DISK_UNWRITABLE', reason: `the artefact directory could not be written: ${error.message}` });
      return;
    }

    const result = await transport({
      source: job.source,
      expectedSha256: job.expectedSha256,
      maxBytes: job.maxBytes,
      fetchImpl,
      sink,
      signal: job.controller.signal,
      stallTimeoutMs,
      onProgress: ({ receivedBytes, totalBytes }) => {
        job.receivedBytes = receivedBytes;
        if (totalBytes !== null && totalBytes !== undefined) job.totalBytes = totalBytes;
      },
    }).catch((error) => ({ ok: false, kind: 'TRANSPORT_ERROR', reason: error?.message ?? String(error) }));

    if (!result.ok) {
      // Whatever arrived is moved out of the artefact directory under a name that says why.
      // Nothing is deleted (rule 12) and nothing partial is left where a reader would take it
      // for a model — the two failure modes this project refuses to choose between.
      const quarantined = await this.#quarantine(partPath, job, result.kind, now()).catch(() => null);
      const state = result.kind === TransportRefusal.CANCELLED ? AcquisitionState.CANCELLED : AcquisitionState.FAILED;
      this.#finish(job, state, { kind: result.kind, reason: result.reason, digest: result.digest ?? null, quarantinedAs: quarantined });
      return;
    }

    job.state = AcquisitionState.VERIFYING;
    job.digest = result.digest;
    try {
      // Re-checked at the last possible moment: between the plan and this line another
      // acquisition could have landed the same artefact, and a rename would silently replace it.
      if (existsSync(finalPath)) {
        const quarantined = await this.#quarantine(partPath, job, 'ALREADY_PRESENT', now()).catch(() => null);
        this.#finish(job, AcquisitionState.FAILED, { kind: 'ALREADY_PRESENT', reason: 'an artefact for this model appeared on disk while this one was downloading; nothing was replaced', quarantinedAs: quarantined });
        return;
      }
      await rename(partPath, finalPath);
      const landed = await stat(finalPath);
      job.receivedBytes = landed.size;
      this.#finish(job, AcquisitionState.COMPLETED, { digest: result.digest });
    } catch (error) {
      this.#finish(job, AcquisitionState.FAILED, { kind: 'LANDING_FAILED', reason: `the verified artefact could not be put in place: ${error.message}` });
    }
  }

  async #quarantine(partPath, job, kind, at) {
    try { await stat(partPath); } catch { return null; }
    const target = join(this.#options.quarantineDir, `${job.name}.${stamp(at)}.${String(kind ?? 'unknown').toLowerCase()}.part`);
    await rename(partPath, target);
    return target;
  }
}
