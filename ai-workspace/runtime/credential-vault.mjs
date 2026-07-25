// SPDX-License-Identifier: AGPL-3.0-or-later
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const GCM_TAG_BYTES = 16;

export class CredentialVault {
  constructor({ keyPath }) {
    this.keyPath = keyPath;
    this.ephemeral = new Map();
    this.key = this.#loadKey();
  }
  #loadKey() {
    mkdirSync(dirname(this.keyPath), { recursive:true, mode:0o700 });
    if (!existsSync(this.keyPath)) {
      writeFileSync(this.keyPath, randomBytes(32), { mode:0o600 });
      chmodSync(this.keyPath, 0o600);
    }
    const key = readFileSync(this.keyPath);
    if (key.length !== 32) throw new Error('Provider credential key must be 32 bytes.');
    return key;
  }
  encrypt(value) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: GCM_TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return { v:1, alg:'A256GCM', iv:iv.toString('base64url'), tag:cipher.getAuthTag().toString('base64url'), ciphertext:ciphertext.toString('base64url') };
  }
  decrypt(record) {
    // GCM_TAG_BYTES is pinned and the decoded tag length is checked before use. Node
    // accepts GCM tags of 4-16 bytes, so a stored record carrying a truncated tag would
    // authenticate with as little as 32 bits instead of 128.
    const tag = Buffer.from(record.tag, 'base64url');
    if (tag.length !== GCM_TAG_BYTES) throw new Error('invalid authentication tag length');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(record.iv, 'base64url'), { authTagLength: GCM_TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }
  setEphemeral(profileId, value) { this.ephemeral.set(profileId, String(value)); }
  clearEphemeral(profileId) { this.ephemeral.delete(profileId); }
  resolve(profile) {
    if (this.ephemeral.has(profile.id)) return this.ephemeral.get(profile.id);
    if (profile.encryptedCredential) return this.decrypt(profile.encryptedCredential);
    return null;
  }
}
