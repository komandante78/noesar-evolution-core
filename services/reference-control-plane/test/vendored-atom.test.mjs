// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The vendored `atomd` and its provenance must not drift apart (s335).
//
// ATOM ships inside this product now, as a built artefact with a recorded origin. An artefact
// whose provenance file says something else is worse than no provenance at all: it reads as
// verified. These rows fail on either half moving without the other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const BINARY = join(ROOT, 'oci/vendor/atom/atomd');
const PROVENANCE = join(ROOT, 'oci/vendor/atom/atomd.provenance.json');

test('the vendored binary is present and executable', () => {
  const stat = statSync(BINARY);
  assert.ok(stat.isFile(), 'oci/vendor/atom/atomd must exist — the image ships it');
  // Copied without its mode, the image would carry a file it cannot execute, and the failure
  // would arrive as a spawn error at boot rather than here.
  assert.ok((stat.mode & 0o111) !== 0, 'the vendored binary must be executable');
});

test('the binary and its provenance agree, in both directions', () => {
  const declared = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
  const bytes = readFileSync(BINARY);
  const actual = createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual, declared.sha256, 'a binary swapped without its provenance is a silent ship');
  assert.equal(bytes.length, declared.sizeBytes, 'the recorded size must describe the recorded artefact');
});

test('the provenance names an origin a person can actually go and check', () => {
  const declared = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
  assert.match(declared.sourceRepository, /^https:\/\/\S+\.git$/, 'a repository, not a description of one');
  // A commit, not a date or a tag: a date cannot be checked out, and a tag can be moved.
  assert.match(declared.sourceCommit, /^[0-9a-f]{40}$/, 'a full commit id');
  assert.ok(String(declared.builtWith ?? '').includes('--offline'), 'the recorded build must be the offline one');
  assert.ok(String(declared.decision ?? '').length > 0, 'the decision that put it here is part of the provenance');
});
