// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue must not re-read a model file that has not changed (2026-09-21: 45-93 s of a
// frozen server, on every visit to the Models page), must re-read one that has — including one
// rewritten within the same timestamp tick, which the first version of this module got wrong —
// and must be able to learn a digest without stopping the event loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { artefactDigest, warmDigests, digestCounters, digestTiming } from '../src/artefact-digest.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
// The production window is 2 s; a short one keeps the suite fast and tests the same rule.
digestTiming.settleMs = 20;
const settle = () => sleep(60);

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-digest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('an unchanged artefact is read once, however many times the catalogue asks', async (t) => {
  const file = join(scratch(t), 'model.bin');
  writeFileSync(file, 'weights, version one');
  await settle();
  const before = digestCounters.hashed;
  for (let i = 0; i < 3; i += 1) assert.equal(artefactDigest(file), sha('weights, version one'));
  assert.equal(digestCounters.hashed - before, 1, 'the second and third answers must come from memory');
});

test('a same-size file rewritten within the same timestamp tick is never vouched for by the old digest', (t) => {
  const file = join(scratch(t), 'model.bin');
  writeFileSync(file, 'original weights');
  assert.equal(artefactDigest(file), sha('original weights'));
  writeFileSync(file, 'tampered weights'); // same length, same inode, very likely the same tick
  assert.equal(artefactDigest(file), sha('tampered weights'));
});

test('a file replaced after its digest was remembered is hashed again', async (t) => {
  const file = join(scratch(t), 'model.bin');
  writeFileSync(file, 'original weights');
  await settle();
  assert.equal(artefactDigest(file), sha('original weights'));
  writeFileSync(file, 'tampered weights');
  assert.equal(artefactDigest(file), sha('tampered weights'));
});

test('warming learns every artefact without holding the event loop, and the catalogue then reads nothing', async (t) => {
  const dir = scratch(t);
  const big = Buffer.alloc(48 * 1024 * 1024, 7);
  writeFileSync(join(dir, 'a.bin'), big);
  writeFileSync(join(dir, 'not-an-artefact.txt'), 'ignored');
  await settle();
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  await warmDigests(dir);
  clearInterval(timer);
  assert.ok(ticks > 1, `other work must run while 48 MiB are hashed (timer ran ${ticks} times)`);
  const before = digestCounters.hashed;
  assert.equal(artefactDigest(join(dir, 'a.bin')), sha(big));
  assert.equal(digestCounters.hashed, before, 'after warming, the catalogue must not read the file again');
});

test('warming a directory that does not exist is a no-op, not a crash at boot', async () => {
  await warmDigests(join(tmpdir(), `noesar-no-such-dir-${Date.now()}`));
});
