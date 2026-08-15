// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression test for finding F-001 (semgrep `gcm-no-tag-length`).
//
// Both AES-256-GCM decrypt paths used to call createDecipheriv() without pinning
// `authTagLength`, then hand setAuthTag() a tag decoded straight from stored data.
// Node accepts GCM tags of 4, 8, 12, 13, 14, 15 or 16 bytes, so a stored envelope
// carrying a truncated tag authenticated with as little as 32 bits instead of 128.
// Reproduced before the fix: a 4-byte tag still decrypted successfully.
//
// These tests fail if either path ever stops rejecting a short tag.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../src/auth-crypto.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';
import { freshTempDir } from './support/workspace.mjs';

const SHORT_TAG_LENGTHS = [4, 8, 12, 13, 14, 15];

test('auth-crypto: encrypt/decrypt round-trip is unchanged', () => {
  const key = randomBytes(32);
  const envelope = encryptSecret('sk-live-provider-key', key);
  assert.equal(decryptSecret(envelope, key), 'sk-live-provider-key');
});

test('auth-crypto: emits a full 16-byte authentication tag', () => {
  const envelope = encryptSecret('value', randomBytes(32));
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
});

test('auth-crypto: rejects every truncated authentication tag', () => {
  const key = randomBytes(32);
  const envelope = encryptSecret('sk-live-provider-key', key);
  const full = Buffer.from(envelope.tag, 'base64');
  for (const length of SHORT_TAG_LENGTHS) {
    assert.throws(
      () => decryptSecret({ ...envelope, tag: full.subarray(0, length).toString('base64') }, key),
      new RegExp('tag length|Unsupported|authenticate', 'i'),
      `a ${length}-byte tag must be rejected`,
    );
  }
});

test('auth-crypto: rejects a corrupted tag and a tampered ciphertext', () => {
  const key = randomBytes(32);
  const envelope = encryptSecret('sk-live-provider-key', key);

  const tag = Buffer.from(envelope.tag, 'base64');
  tag[0] ^= 0xff;
  assert.throws(() => decryptSecret({ ...envelope, tag: tag.toString('base64') }, key));

  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[0] ^= 0xff;
  assert.throws(() => decryptSecret({ ...envelope, ciphertext: ciphertext.toString('base64') }, key));
});

function vault() {
  return new CredentialVault({ keyPath: join(freshTempDir('noesar-vault-'), 'key.bin') });
}

test('credential vault: encrypt/decrypt round-trip is unchanged', () => {
  const v = vault();
  assert.equal(v.decrypt(v.encrypt('sk-vault-secret')), 'sk-vault-secret');
});

test('credential vault: emits a full 16-byte authentication tag', () => {
  const v = vault();
  assert.equal(Buffer.from(v.encrypt('value').tag, 'base64url').length, 16);
});

test('credential vault: rejects every truncated authentication tag', () => {
  const v = vault();
  const record = v.encrypt('sk-vault-secret');
  const full = Buffer.from(record.tag, 'base64url');
  for (const length of SHORT_TAG_LENGTHS) {
    assert.throws(
      () => v.decrypt({ ...record, tag: full.subarray(0, length).toString('base64url') }),
      /tag length|authenticate/i,
      `a ${length}-byte tag must be rejected`,
    );
  }
});

test('credential vault: rejects a corrupted tag', () => {
  const v = vault();
  const record = v.encrypt('sk-vault-secret');
  const tag = Buffer.from(record.tag, 'base64url');
  tag[0] ^= 0xff;
  assert.throws(() => v.decrypt({ ...record, tag: tag.toString('base64url') }));
});
