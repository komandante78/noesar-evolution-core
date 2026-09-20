// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The fixtures are not invented: they are the shape the live API returned on 2026-09-20 for
// `bartowski/microsoft_Phi-4-reasoning-GGUF`, trimmed to the fields this code reads. A fixture
// copied from a guess would prove the code agrees with the guess.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDescriptorFromHuggingFace,
  huggingFaceApiUrls,
  listArtefacts,
  HuggingFaceRefusal,
} from '../src/huggingface-descriptor.mjs';

const DIGEST = '8f95954f051c3dc06eef892228dcc9503feb48a824631d72b8055601965122e9';

const info = {
  id: 'bartowski/microsoft_Phi-4-reasoning-GGUF',
  author: 'bartowski',
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  lastModified: '2025-05-01T03:04:18.000Z',
  gated: false,
  cardData: { license: 'mit' },
};

const tree = [
  { type: 'file', oid: 'd3b39e3a', size: 3426, path: '.gitattributes' },
  { type: 'file', oid: '3ce2ccdc', size: 15418, path: 'README.md' },
  {
    type: 'file',
    oid: '0bf7d05ca37615d8a3c77bcf5288a8a556cecd07',
    size: 6913837024,
    lfs: { oid: DIGEST, size: 6913837024, pointerSize: 135 },
    path: 'microsoft_Phi-4-reasoning-IQ3_M.gguf',
  },
  // A GGUF stored WITHOUT LFS: small enough that the repository committed it directly, so the
  // publisher declares no SHA-256 for it. This is the row the refusal below exists for.
  { type: 'file', oid: 'aaaaaaaa', size: 1024, path: 'tiny-no-lfs.gguf' },
];

const now = () => new Date('2026-09-20T12:00:00.000Z');
const build = (over = {}) => buildDescriptorFromHuggingFace({
  repository: 'bartowski/microsoft_Phi-4-reasoning-GGUF',
  file: 'microsoft_Phi-4-reasoning-IQ3_M.gguf',
  info,
  tree,
  now,
  ...over,
});

test('the digest comes from the publisher API, and the descriptor is held to it', () => {
  const result = build();
  assert.equal(result.ok, true);
  assert.equal(result.descriptor.hashes.sha256, DIGEST);
  assert.equal(
    result.descriptor.source,
    'https://huggingface.co/bartowski/microsoft_Phi-4-reasoning-GGUF/resolve/main/microsoft_Phi-4-reasoning-IQ3_M.gguf?download=true',
  );
  assert.equal(result.descriptor.license, 'mit');
  assert.deepEqual(result.descriptor.formats, ['gguf']);
});

test('nothing here claims to be signed, and the document says what was trusted instead', () => {
  const { descriptor } = build();
  assert.equal(Object.hasOwn(descriptor, 'signature'), false, 'a fabricated signature would be the only real lie available');
  assert.equal(descriptor.provenance.signed, false);
  assert.equal(descriptor.provenance.kind, 'publisher-api-digest');
  assert.equal(descriptor.provenance.digestFrom, huggingFaceApiUrls('bartowski/microsoft_Phi-4-reasoning-GGUF').tree);
  assert.equal(descriptor.provenance.sizeBytes, 6913837024);
});

test('the descriptor carries every field the schema requires', () => {
  const { descriptor } = build();
  for (const key of ['id', 'version', 'publisher', 'source', 'license', 'hashes', 'formats', 'workloads', 'resource_profiles']) {
    assert.ok(Object.hasOwn(descriptor, key), `${key} is required by schemas/model-descriptor.schema.json`);
  }
  assert.equal(descriptor.publisher, 'bartowski');
});

test('a file the publisher declares no SHA-256 for is REFUSED, not acquired without one', () => {
  // The oracle. A commitment made after the bytes arrive is not a commitment, so this is the
  // one case where being useful and being honest disagree, and honesty wins.
  const result = build({ file: 'tiny-no-lfs.gguf' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, HuggingFaceRefusal.NO_DIGEST);
});

test('a gated repository is refused before the download, not during it', () => {
  const result = build({ info: { ...info, gated: true } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, HuggingFaceRefusal.GATED);
});

test('a file that is not there is refused, and the refusal names what is', () => {
  const result = build({ file: 'not-in-this-repository.gguf' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, HuggingFaceRefusal.FILE_NOT_FOUND);
  assert.match(result.reason, /microsoft_Phi-4-reasoning-IQ3_M\.gguf/);
});

test('a repository that declares no licence is not installed by implication', () => {
  const result = build({ info: { ...info, cardData: {} } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, HuggingFaceRefusal.NO_LICENSE);
});

test('a name that is not owner/name is refused before any document is read', () => {
  for (const repository of ['', 'no-slash', '/leading', 'trailing/', '../escape/x']) {
    const result = buildDescriptorFromHuggingFace({ repository, file: 'x.gguf', info, tree, now });
    assert.equal(result.ok, false, `${repository} should be refused`);
    assert.equal(result.kind, HuggingFaceRefusal.REPO_INVALID);
  }
});

test('listArtefacts reads only GGUF files, and only trusts a 64-hex LFS oid', () => {
  const artefacts = listArtefacts(tree);
  assert.deepEqual(artefacts.map((a) => a.path), ['microsoft_Phi-4-reasoning-IQ3_M.gguf', 'tiny-no-lfs.gguf']);
  assert.equal(artefacts[0].sha256, DIGEST);
  assert.equal(artefacts[1].sha256, null);
  // A short oid is a git object id, not a SHA-256 of the content, and must never be read as one.
  assert.equal(listArtefacts([{ type: 'file', path: 'a.gguf', lfs: { oid: 'abc123' } }])[0].sha256, null);
});
