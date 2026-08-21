// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0625 — «pulsante elimina, tutto con doppia conferma prima di fare qualcosa».
//
// The requirement was recorded on 2026-08-04 and there was no delete at all: no route, no
// gesture, no module, zero occurrences in the browser shell. This suite is the oracle for the
// capability that was missing, and every row that says ORACLE reproduces a way the guard could
// fail open and asserts that it does not — because a delete that works is easy and a delete that
// REFUSES correctly is the part that has to be proven.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  previewRemoval,
  removeModel,
  artefactPathFor,
  ModelRemovalError,
} from '../src/model-removal.mjs';
import { artefactName } from '../src/model-acquisition.mjs';

function withArtefacts(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noesar-model-removal-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function place(dir, id, bytes = 'model bytes') {
  const file = path.join(dir, `${artefactName(id)}.bin`);
  fs.writeFileSync(file, bytes);
  return file;
}

test('the preview reads and deletes nothing', () => {
  withArtefacts((dir) => {
    const file = place(dir, 'acme/tiny-1b', 'twelve bytes');
    const preview = previewRemoval({ artefactDir: dir, id: 'acme/tiny-1b' });
    assert.equal(preview.present, true);
    assert.equal(preview.bytes, 12);
    assert.equal(preview.removable, true);
    assert.equal(preview.reason, null);
    assert.ok(fs.existsSync(file), 'a preview that deletes is not a preview');
  });
});

test('both confirmations together remove the artefact', () => {
  withArtefacts((dir) => {
    const file = place(dir, 'acme/tiny-1b');
    const result = removeModel({ artefactDir: dir, id: 'acme/tiny-1b', confirm: true, confirmId: 'acme/tiny-1b' });
    assert.equal(result.removed, true);
    assert.ok(result.bytesFreed > 0);
    assert.equal(fs.existsSync(file), false);
  });
});

test('ORACLE: the intent flag alone does not delete', () => {
  withArtefacts((dir) => {
    const file = place(dir, 'acme/tiny-1b');
    assert.throws(
      () => removeModel({ artefactDir: dir, id: 'acme/tiny-1b', confirm: true, confirmId: null }),
      (error) => error instanceof ModelRemovalError && error.kind === 'CONFIRMATION_MISMATCH',
    );
    assert.ok(fs.existsSync(file), 'one confirmation was enough — the second act is not enforced');
  });
});

test('ORACLE: naming the model alone does not delete', () => {
  withArtefacts((dir) => {
    const file = place(dir, 'acme/tiny-1b');
    assert.throws(
      () => removeModel({ artefactDir: dir, id: 'acme/tiny-1b', confirm: false, confirmId: 'acme/tiny-1b' }),
      (error) => error instanceof ModelRemovalError && error.kind === 'NOT_CONFIRMED',
    );
    assert.ok(fs.existsSync(file));
  });
});

test('ORACLE: confirming the WRONG model does not delete the right one', () => {
  // The failure this catches is the realistic one: the dialog is open on the row above the one
  // the person meant. Clicking twice would not catch it; naming the target does.
  withArtefacts((dir) => {
    const keep = place(dir, 'acme/tiny-1b');
    const other = place(dir, 'acme/huge-70b');
    assert.throws(
      () => removeModel({ artefactDir: dir, id: 'acme/tiny-1b', confirm: true, confirmId: 'acme/huge-70b' }),
      (error) => error instanceof ModelRemovalError && error.kind === 'CONFIRMATION_MISMATCH',
    );
    assert.ok(fs.existsSync(keep));
    assert.ok(fs.existsSync(other), 'and it certainly must not delete the one that was named');
  });
});

test('ORACLE: the model in use is refused even with both confirmations', () => {
  withArtefacts((dir) => {
    const file = place(dir, 'acme/tiny-1b');
    assert.throws(
      () => removeModel({
        artefactDir: dir, id: 'acme/tiny-1b', activeModelId: 'acme/tiny-1b',
        confirm: true, confirmId: 'acme/tiny-1b',
      }),
      (error) => error instanceof ModelRemovalError && error.kind === 'IN_USE',
    );
    assert.ok(fs.existsSync(file), 'deleting what is answering right now breaks the session asking');
  });
});

test('ORACLE: a catalogue entry that was never downloaded is refused, not reported as deleted', () => {
  // A seeded model lives in the `available` lane and has no artefact. Answering "removed" would
  // be a claim about work that never happened.
  withArtefacts((dir) => {
    assert.throws(
      () => removeModel({ artefactDir: dir, id: 'Qwen/Qwen3-235B-A22B', confirm: true, confirmId: 'Qwen/Qwen3-235B-A22B' }),
      (error) => error instanceof ModelRemovalError && error.kind === 'NOT_PRESENT',
    );
    const preview = previewRemoval({ artefactDir: dir, id: 'Qwen/Qwen3-235B-A22B' });
    assert.equal(preview.present, false);
    assert.equal(preview.removable, false);
    assert.match(preview.reason, /non e scaricato/);
  });
});

test('ORACLE: an id that tries to climb out of the artefact directory cannot', () => {
  withArtefacts((dir) => {
    const outside = path.join(dir, '..', 'outside.bin');
    fs.writeFileSync(outside, 'not a model');
    try {
      // artefactName() escapes the separators, so this resolves to a harmless name INSIDE dir.
      const resolved = artefactPathFor(dir, '../outside');
      assert.ok(resolved.startsWith(path.resolve(dir)), 'the resolved path escaped the artefact directory');
      assert.throws(
        () => removeModel({ artefactDir: dir, id: '../outside', confirm: true, confirmId: '../outside' }),
        (error) => error instanceof ModelRemovalError && error.kind === 'NOT_PRESENT',
      );
      assert.ok(fs.existsSync(outside), 'a file outside the artefact directory was deleted');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

test('an empty or absent id is refused rather than resolving to the directory itself', () => {
  withArtefacts((dir) => {
    for (const bad of ['', null, undefined, '.', '..']) {
      assert.throws(
        () => previewRemoval({ artefactDir: dir, id: bad }),
        (error) => error instanceof ModelRemovalError && error.kind === 'INVALID_ID',
        `id ${JSON.stringify(bad)} was not refused`,
      );
    }
  });
});
