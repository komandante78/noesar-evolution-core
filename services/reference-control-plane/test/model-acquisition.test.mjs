// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0517` — what an acquisition does to the DISK, which is where the project's own rules bite.
//
// The transport's tests prove the bytes are handled correctly. These prove the three decisions
// the transport refuses to have an opinion about: nothing is overwritten (`CLAUDE10.md` rule 13),
// nothing is deleted (rule 12), and nothing that failed verification is left anywhere a reader
// would mistake for a model (`MC-004`).

import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcquisitionManager, AcquisitionState, artefactName, isTerminal } from '../src/model-acquisition.mjs';

const bytes = (text) => new TextEncoder().encode(text);
const sha256 = (text) => createHash('sha256').update(bytes(text)).digest('hex');

const roots = [];
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'noesar-acquire-'));
  roots.push(root);
  return { root, artefactDir: join(root, 'artefacts'), quarantineDir: join(root, 'quarantine') };
}
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

const descriptor = (extra = {}) => ({
  id: 'acme/tiny-1b', publisher: 'acme', version: '1',
  source: 'https://models.example/tiny.gguf', hashes: { sha256: sha256('weights') },
  ...extra,
});
const grantFor = (payload = 'weights', extra = {}) => ({
  modelId: 'acme/tiny-1b', publisherId: 'acme', expectedSha256: sha256(payload),
  maxBytes: 1024, operation: 'model.acquire', ...extra,
});

/** A `fetch` that serves one payload. No network, on any host. */
const serving = (payload) => async () => new Response(new ReadableStream({
  start(controller) { controller.enqueue(bytes(payload)); controller.close(); },
}), { status: 200, headers: { 'content-length': String(bytes(payload).length) } });

/** Wait for a job to reach a terminal state, with a bound so a hang fails instead of hanging. */
async function settled(manager, id, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = manager.get(id);
    if (job && isTerminal(job.state)) return job;
    if (Date.now() > deadline) throw new Error(`job ${id} never settled (state: ${job?.state})`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('a model id is not a filename', () => {
  test('an ordinary id is left byte-identical, so the common case reads as itself', () => {
    assert.equal(artefactName('llama-3.1-8b'), 'llama-3.1-8b');
  });

  test('a separator is escaped rather than turned into a directory', () => {
    assert.equal(artefactName('acme/tiny-1b'), 'acme~2ftiny-1b');
    assert.equal(artefactName('acme\\tiny'), 'acme~5ctiny');
    // Reversible and collision-free: the two ids below must not name one file.
    assert.notEqual(artefactName('a/b'), artefactName('a~2fb'));
  });

  test('an id that is only dots is refused instead of naming the directory above', () => {
    assert.throws(() => artefactName('..'));
    assert.throws(() => artefactName(''));
  });
});

describe('an acquisition that verifies', () => {
  test('lands the artefact under its own name and leaves no partial behind', async () => {
    const { artefactDir, quarantineDir } = workspace();
    const manager = new AcquisitionManager({ artefactDir, quarantineDir, fetchImpl: serving('weights') });
    const started = manager.start({ descriptor: descriptor(), grant: grantFor(), actorId: 'owner' });
    assert.equal(started.ok, true);

    const job = await settled(manager, started.job.id);
    assert.equal(job.state, AcquisitionState.COMPLETED);
    assert.equal(job.digest, sha256('weights'));
    assert.equal(job.receivedBytes, 7);
    assert.deepEqual(readdirSync(artefactDir), ['acme~2ftiny-1b.bin']);
    assert.equal(readFileSync(join(artefactDir, 'acme~2ftiny-1b.bin'), 'utf8'), 'weights');
    assert.deepEqual(readdirSync(quarantineDir), []);
  });

  test('the acquisition is written to the ledger the caller supplied', async () => {
    const { artefactDir, quarantineDir } = workspace();
    const events = [];
    const manager = new AcquisitionManager({
      artefactDir, quarantineDir, fetchImpl: serving('weights'), onEvent: (event) => events.push(event),
    });
    const started = manager.start({ descriptor: descriptor(), grant: grantFor(), actorId: 'owner' });
    await settled(manager, started.job.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'model.acquisition');
    assert.equal(events[0].result, AcquisitionState.COMPLETED);
    assert.equal(events[0].details.id, 'acme/tiny-1b');
  });
});

describe('MC-004 on disk — a mismatch never becomes a model you have', () => {
  test('the bytes are quarantined, not promoted and not deleted', async () => {
    const { artefactDir, quarantineDir } = workspace();
    const manager = new AcquisitionManager({ artefactDir, quarantineDir, fetchImpl: serving('tampered') });
    const started = manager.start({ descriptor: descriptor(), grant: grantFor('weights'), actorId: 'owner' });

    const job = await settled(manager, started.job.id);
    assert.equal(job.state, AcquisitionState.FAILED);
    assert.equal(job.kind, 'DIGEST_MISMATCH');
    // Nothing startable was produced…
    assert.deepEqual(readdirSync(artefactDir), []);
    // …and nothing was destroyed either: what arrived is still readable, under a name that says why.
    const quarantined = readdirSync(quarantineDir);
    assert.equal(quarantined.length, 1);
    assert.match(quarantined[0], /^acme~2ftiny-1b\.\d{8}T\d{6}Z\.digest_mismatch\.part$/);
    assert.equal(readFileSync(join(quarantineDir, quarantined[0]), 'utf8'), 'tampered');
    assert.equal(job.quarantinedAs, join(quarantineDir, quarantined[0]));
  });

  test('a source this installation will not fetch from is refused before any job exists', () => {
    const { artefactDir, quarantineDir } = workspace();
    const manager = new AcquisitionManager({ artefactDir, quarantineDir, fetchImpl: serving('weights') });
    const refused = manager.start({ descriptor: descriptor({ source: 'http://models.example/tiny.gguf' }), grant: grantFor() });
    assert.equal(refused.ok, false);
    assert.equal(refused.kind, 'SCHEME_NOT_ALLOWED');
    assert.equal(manager.list().length, 0);
  });
});

describe('rule 13 — an artefact already on disk is never replaced by implication', () => {
  test('acquiring over an existing artefact is refused and the file is untouched', () => {
    const { artefactDir, quarantineDir } = workspace();
    mkdirSync(artefactDir, { recursive: true });
    writeFileSync(join(artefactDir, 'acme~2ftiny-1b.bin'), 'the one already here');
    const manager = new AcquisitionManager({ artefactDir, quarantineDir, fetchImpl: serving('weights') });

    const refused = manager.start({ descriptor: descriptor(), grant: grantFor() });
    assert.equal(refused.ok, false);
    assert.equal(refused.kind, 'ALREADY_PRESENT');
    assert.equal(readFileSync(join(artefactDir, 'acme~2ftiny-1b.bin'), 'utf8'), 'the one already here');
  });
});

describe('pressing Acquire twice is one acquisition', () => {
  test('the second press is answered with the job the first one started', async () => {
    const { artefactDir, quarantineDir } = workspace();
    const manager = new AcquisitionManager({ artefactDir, quarantineDir, fetchImpl: serving('weights') });
    const first = manager.start({ descriptor: descriptor(), grant: grantFor() });
    const second = manager.start({ descriptor: descriptor(), grant: grantFor() });
    assert.equal(second.ok, true);
    assert.equal(second.alreadyRunning, true);
    assert.equal(second.job.id, first.job.id);
    await settled(manager, first.job.id);
  });
});

describe('cancelling is a decision, and it is honoured', () => {
  test('a queued acquisition ends as cancelled without ever reaching the network', async () => {
    const { artefactDir, quarantineDir } = workspace();
    let calls = 0;
    // One slot, and the first job never finishes — so the second is genuinely queued.
    const manager = new AcquisitionManager({
      artefactDir, quarantineDir, maxConcurrent: 1,
      fetchImpl: async () => { calls += 1; return new Response(new ReadableStream({ start() {} }), { status: 200 }); },
      stallTimeoutMs: 50,
    });
    const blocking = manager.start({ descriptor: descriptor(), grant: grantFor() });
    const queued = manager.start({ descriptor: descriptor({ id: 'acme/other' }), grant: grantFor('weights', { modelId: 'acme/other' }) });

    const cancelled = manager.cancel(queued.job.id, { actorId: 'owner' });
    assert.equal(cancelled.ok, true);
    assert.equal(manager.get(queued.job.id).state, AcquisitionState.CANCELLED);
    // Measured after the blocking job has run its course, not before: the count is the point,
    // and taking it too early would pass for the wrong reason — nothing had fetched YET.
    await settled(manager, blocking.job.id);
    assert.equal(calls, 1, 'only the blocking job may ever have been fetched');
    assert.deepEqual(readdirSync(artefactDir), [], 'a cancelled acquisition leaves nothing startable');
  });

  test('cancelling a finished acquisition is refused rather than pretended', async () => {
    const { artefactDir, quarantineDir } = workspace();
    const manager = new AcquisitionManager({ artefactDir, quarantineDir, fetchImpl: serving('weights') });
    const started = manager.start({ descriptor: descriptor(), grant: grantFor() });
    await settled(manager, started.job.id);
    const late = manager.cancel(started.job.id);
    assert.equal(late.ok, false);
    assert.equal(late.kind, 'ALREADY_FINISHED');
  });

  test('an unknown job id is a refusal with a name', () => {
    const { artefactDir, quarantineDir } = workspace();
    const manager = new AcquisitionManager({ artefactDir, quarantineDir, fetchImpl: serving('weights') });
    assert.equal(manager.cancel('nope').kind, 'NO_SUCH_JOB');
  });
});

describe('the registry an operator reads', () => {
  test('lists what happened, newest first, and hands out snapshots rather than the record', async () => {
    const { artefactDir, quarantineDir } = workspace();
    const manager = new AcquisitionManager({ artefactDir, quarantineDir, fetchImpl: serving('weights') });
    const started = manager.start({ descriptor: descriptor(), grant: grantFor() });
    await settled(manager, started.job.id);

    const [job] = manager.list();
    assert.equal(job.modelId, 'acme/tiny-1b');
    job.state = 'tampered-with';
    assert.equal(manager.get(started.job.id).state, AcquisitionState.COMPLETED);
  });
});
