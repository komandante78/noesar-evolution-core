// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0632. The acquisition gate gained a third origin, and the test that matters is not the one
// proving the new path works — it is the one proving the old path did not open. A descriptor
// that simply LACKS a signature must still be refused; only a descriptor that declares, in
// itself, that it was built from a publisher API may take the new branch, and only with a digest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planAcquisition } from '../src/model-catalog.mjs';

const DIGEST = 'e02aea7b191055b8d9a5ca7d58a99214a6dc87be8759cf97089814163bda5042';

const base = {
  id: 'bartowski/repo/file',
  publisher: 'bartowski',
  source: 'https://huggingface.co/bartowski/repo/resolve/main/file.gguf',
  license: 'mit',
  hashes: { sha256: DIGEST },
  formats: ['gguf'],
  workloads: ['text'],
  resource_profiles: [{ name: 'x', note: 'y' }],
};

const fromApi = {
  ...base,
  provenance: { kind: 'publisher-api-digest', signed: false, digestFrom: 'https://huggingface.co/api/models/bartowski/repo/tree/main' },
};

// A registry that knows nobody, which is the real state of an installation that has registered
// no publisher — the case the new branch has to work in.
const emptyRegistry = { status: () => ({ publishers: [] }) };

const plan = (descriptor, over = {}) => planAcquisition({
  descriptor, registry: emptyRegistry, runtime: { mode: 'auto' }, egressAllowed: true,
  maxBytes: 64 * 1024 ** 3, descriptorAuthenticity: null, ...over,
});

test('a descriptor built from a publisher API is allowed without a signature', () => {
  const result = plan(fromApi);
  assert.equal(result.allowed, true, `refused as ${result.kind}: ${result.reason}`);
});

test('the same descriptor without a digest is refused: there would be nothing to hold it to', () => {
  const result = plan({ ...fromApi, hashes: {} });
  assert.equal(result.allowed, false);
  assert.equal(result.kind, 'NO_DIGEST');
});

test('THE ORACLE: a descriptor that merely lacks a signature is still refused', () => {
  // No `provenance`, so nothing in the document claims the digest came from anywhere. This is
  // the shape a forged or careless descriptor has, and it must not reach the new branch.
  const result = plan(base);
  assert.equal(result.allowed, false);
  assert.equal(result.kind, 'PUBLISHER_NOT_REGISTERED');
});

test('claiming the provenance while claiming to be signed does not take the branch either', () => {
  // `signed: true` with no signature is a contradiction; the branch requires the document to
  // admit it is unsigned, so this falls back to the registered-publisher path and is refused.
  const result = plan({ ...fromApi, provenance: { ...fromApi.provenance, signed: true } });
  assert.equal(result.allowed, false);
  assert.equal(result.kind, 'PUBLISHER_NOT_REGISTERED');
});

test('egress consent still comes first, before any origin is considered', () => {
  const result = plan(fromApi, { egressAllowed: false });
  assert.equal(result.allowed, false);
  assert.equal(result.kind, 'EGRESS_NOT_CONSENTED');
});

test('a signed descriptor from a registered publisher is unaffected by any of this', () => {
  const registry = { status: () => ({ publishers: [{ publisherId: 'acme', keys: [{ revokedAtUnix: null }] }] }) };
  const signed = { ...base, publisher: 'acme', source: 'https://acme.example/model.gguf' };
  const result = planAcquisition({
    descriptor: signed, registry, runtime: { mode: 'auto' }, egressAllowed: true,
    maxBytes: 64 * 1024 ** 3, descriptorAuthenticity: { verified: true, kind: 'SIGNED' },
  });
  assert.equal(result.allowed, true, `refused as ${result.kind}: ${result.reason}`);
});
