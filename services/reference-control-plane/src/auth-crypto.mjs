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

export function verifyTotp(secret, supplied, timestamp = Date.now(), window = 1) {
  const candidate = String(supplied ?? '').trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = totpCode(secret, timestamp + offset * 30_000);
    if (equalBuffers(Buffer.from(expected), Buffer.from(candidate))) return true;
  }
  return false;
}

export function encryptSecret(secret, masterKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
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
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
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
