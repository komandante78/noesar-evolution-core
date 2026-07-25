// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 32, maxmem: 128 * 1024 * 1024 });
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function equalBuffers(left, right) {
  if (!Buffer.isBuffer(left)) left = Buffer.from(left);
  if (!Buffer.isBuffer(right)) right = Buffer.from(right);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(String(password), salt, SCRYPT.keyLength, SCRYPT);
  return {
    scheme: 'scrypt',
    salt: salt.toString('base64'),
    hash: derived.toString('base64'),
    parameters: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keyLength: SCRYPT.keyLength },
  };
}

export function verifyPassword(password, descriptor) {
  if (!descriptor || descriptor.scheme !== 'scrypt') return false;
  const salt = Buffer.from(descriptor.salt, 'base64');
  const params = descriptor.parameters ?? SCRYPT;
  const actual = scryptSync(String(password), salt, Number(params.keyLength ?? 32), {
    N: Number(params.N ?? SCRYPT.N),
    r: Number(params.r ?? SCRYPT.r),
    p: Number(params.p ?? SCRYPT.p),
    maxmem: SCRYPT.maxmem,
  });
  return equalBuffers(actual, Buffer.from(descriptor.hash, 'base64'));
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function tokenDigest(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  const normalized = String(text).replace(/=+$/,'').replace(/\s+/g,'').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function createTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret, timestamp = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

/**
 * Verify a TOTP code and report WHICH time step matched.
 *
 * The step is what makes single-use enforcement possible. RFC 6238 section 5.2 requires
 * that a code be accepted at most once: without knowing the step, a caller can only ask
 * "is this code currently valid", and a code observed by anyone — over the operator's
 * shoulder, in a screenshot, in a proxy log — stays valid for the whole acceptance
 * window and can be replayed on a second, independent login.
 *
 * @returns {{valid: boolean, step: number|null}} step is the counter value that matched.
 */
export function verifyTotpStep(secret, supplied, timestamp = Date.now(), window = 1, stepSeconds = 30) {
  const candidate = String(supplied ?? '').trim();
  if (!/^\d{6}$/.test(candidate)) return { valid: false, step: null };
  for (let offset = -window; offset <= window; offset += 1) {
    const at = timestamp + offset * stepSeconds * 1000;
    const expected = totpCode(secret, at, stepSeconds);
    if (equalBuffers(Buffer.from(expected), Buffer.from(candidate))) {
      return { valid: true, step: Math.floor(at / 1000 / stepSeconds) };
    }
  }
  return { valid: false, step: null };
}

export function verifyTotp(secret, supplied, timestamp = Date.now(), window = 1) {
  return verifyTotpStep(secret, supplied, timestamp, window).valid;
}

const GCM_TAG_BYTES = 16;

export function encryptSecret(secret, masterKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: GCM_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(value, masterKey) {
  if (!value || value.algorithm !== 'aes-256-gcm') throw new Error('Unsupported secret envelope');
  // GCM_TAG_BYTES is pinned and the decoded tag length is checked before use. Node
  // accepts GCM tags of 4-16 bytes, so a stored envelope carrying a truncated tag
  // would authenticate with as little as 32 bits instead of 128.
  const tag = Buffer.from(value.tag, 'base64');
  if (tag.length !== GCM_TAG_BYTES) throw new Error('Invalid authentication tag length');
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(value.iv, 'base64'), {
    authTagLength: GCM_TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function passwordPolicy(password) {
  const value = String(password ?? '');
  const common = new Set(['passwordpassword','12345678901234','qwertyqwertyqwerty','noesarnoesar']);
  const reasons = [];
  if (value.length < 14) reasons.push('Password or passphrase must be at least 14 characters.');
  if (value.length > 256) reasons.push('Password exceeds the supported maximum length.');
  if (common.has(value.toLowerCase())) reasons.push('Password is too common.');
  if (/^\s+$/.test(value)) reasons.push('Password cannot contain only whitespace.');
  return { valid: reasons.length === 0, reasons };
}
