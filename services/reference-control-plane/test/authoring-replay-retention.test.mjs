// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Retention for the replay store — `D-0598` asked, `D-0606` answered.
//
// The first test in this file is the one that matters, and it is a defect oracle, not a feature
// test: `referencedDigests()` named `answerDigest` where the store is keyed by
// `answerRecordDigest`. For a TEXT answer the two coincide, which is why nothing caught it; for
// a STRUCTURED answer — what a real provider produces — they diverge, and a sweep would have
// deleted the recorded answer of every structured call while keeping its prompt. The ledger line
// would have gone on claiming the call was replayable while `replayFromStore` answered
// UNRESOLVABLE. It was latent only because `sweep()` had no product caller.
//
// So the case is built from the SHAPE THE PRODUCT WRITES — `put(prompt)` and `put(answerRecord)`
// — never from a hand-made pair chosen to pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { AuthoringReplayStore, referencedDigests } from '../src/authoring-replay-store.mjs';

const sha = (text) => createHash('sha256').update(String(text)).digest('hex');
const store = () => new AuthoringReplayStore(mkdtempSync(join(tmpdir(), 'noesar-replay-')));

/**
 * A fixture of the shape `author.mjs` writes for a STRUCTURED answer, plus the two objects
 * `workspace-actions.mjs` puts in the store for it. `answerDigest` is the digest of the model's
 * CONTENT and `answerRecordDigest` the digest of the record kept — deliberately different since
 * `D-0597`, which is the whole hazard.
 */
function structuredCall({ prompt, contents, discardedPaths = [] }) {
  const answerRecord = JSON.stringify({ contents, discardedPaths });
  return {
    prompt,
    answerRecord,
    fixture: {
      path: 'src/a.rs',
      promptDigest: sha(prompt),
      answerDigest: sha(contents),
      answerKind: 'structured',
      answerRecordDigest: sha(answerRecord),
    },
  };
}

test('a structured call survives a sweep — the live set names the digest the store is keyed by', () => {
  const replay = store();
  const call = structuredCall({ prompt: 'rewrite src/a.rs', contents: 'fn main() {}', discardedPaths: ['src/b.rs'] });

  // Exactly what the orchestrator does: put the prompt, put the answer RECORD.
  replay.put(call.prompt);
  replay.put(call.answerRecord);
  assert.equal(readdirSync(replay.directory).length, 2);

  // The two digests are genuinely different here — if they were not, this test could pass
  // while the defect was present, which is the trap the text-answer case fell into.
  assert.notEqual(call.fixture.answerDigest, call.fixture.answerRecordDigest);

  const live = referencedDigests([call.fixture]);
  const result = replay.sweep(live, { apply: true });

  assert.equal(result.removed, 0, 'a sweep must not remove the recorded answer of a live call');
  assert.equal(result.kept, 2);
  assert.equal(replay.get(call.fixture.answerRecordDigest), call.answerRecord);
  assert.equal(replay.get(call.fixture.promptDigest), call.prompt);
});

test('a pre-D-0597 fixture — answerDigest only, no answerRecordDigest — survives too', () => {
  // Back then the stored object WAS named by `answerDigest`. Dropping that field to "fix" the
  // list would have traded one silent deletion for another, on exactly the oldest records.
  const replay = store();
  const prompt = 'an older call';
  const answer = 'the raw text the model returned';
  replay.put(prompt);
  replay.put(answer);

  const legacy = { promptDigest: sha(prompt), answerDigest: sha(answer) };
  const result = replay.sweep(referencedDigests([legacy]), { apply: true });

  assert.equal(result.removed, 0);
  assert.equal(result.kept, 2);
});

test('an object no fixture references IS removed — the sweep still sweeps', () => {
  const replay = store();
  const call = structuredCall({ prompt: 'live', contents: 'kept' });
  replay.put(call.prompt);
  replay.put(call.answerRecord);
  const orphan = replay.put('bytes from a run that was pruned');

  const result = replay.sweep(referencedDigests([call.fixture]), { apply: true });

  assert.equal(result.removed, 1);
  assert.equal(result.kept, 2);
  assert.equal(replay.get(orphan), null);
  // The negative control: without it, "removed 0" would satisfy this file even if the sweep
  // had quietly become a no-op, and every assertion above would still be green.
});

test('the dry run names what it would remove and removes nothing', () => {
  const replay = store();
  const call = structuredCall({ prompt: 'live', contents: 'kept' });
  replay.put(call.prompt);
  replay.put(call.answerRecord);
  const orphan = replay.put('sweepable');

  const dry = replay.sweep(referencedDigests([call.fixture]));   // apply defaults to false

  assert.equal(dry.apply, false);
  assert.equal(dry.removed, 0, 'a dry run removes nothing');
  assert.deepEqual(dry.removable, [orphan]);
  assert.equal(replay.get(orphan), 'sweepable', 'the bytes are still there after a dry run');
  assert.equal(readdirSync(replay.directory).length, 3);
});

test('the default is the dry run, not the deletion', () => {
  // Asserted on its own because it is a safety property of the SIGNATURE, and a signature is
  // changed by someone who is not reading this file.
  const replay = store();
  const orphan = replay.put('nothing references this');
  replay.sweep(new Set());
  assert.equal(replay.get(orphan), 'nothing references this');
});

test('a store this installation does not keep reports durable:false, not a cheerful zero', () => {
  const absent = new AuthoringReplayStore(null);
  const result = absent.sweep(new Set(), { apply: true });
  assert.equal(result.durable, false);
  assert.equal(result.removed, 0);
});

test('the sweep never touches a file it did not name', () => {
  // The directory is the product's, but a full disk, a backup tool or an operator can leave
  // something in it. Only 64-hex names are this file's own.
  const replay = store();
  writeFileSync(join(replay.directory, 'README'), 'not ours');
  writeFileSync(join(replay.directory, 'deadbeef.tmp'), 'a half-written put');
  const orphan = replay.put('sweepable');

  const result = replay.sweep(new Set(), { apply: true });

  assert.equal(result.removed, 1, 'only the digest-named object is removable');
  assert.equal(replay.get(orphan), null);
  const left = readdirSync(replay.directory).sort();
  assert.deepEqual(left, ['README', 'deadbeef.tmp']);
});
