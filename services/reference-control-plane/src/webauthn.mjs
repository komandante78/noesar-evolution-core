// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A from-scratch, minimal WebAuthn verifier. NOESAR EVOLUTION carries zero npm
// dependencies by design, so there is no @simplewebauthn/server here — this is the
// CBOR/COSE parsing and signature verification that library would otherwise provide,
// scoped to exactly what the product's Owner authorised: attestation 'none' and the
// ES256 (P-256) algorithm only. No attestation certificate chain, no other algorithm,
// no indefinite-length CBOR (browsers do not emit it for these structures).
//
// Pure functions only: no state, no store access, no randomness. auth.mjs owns the
// challenge lifecycle and credential storage; this module only decodes what the
// browser sent and says whether it checks out.
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

export const COSE_ALG_ES256 = -7;

// A real authenticator's output here is small — none-attestation ES256 authenticatorData
// is well under 200 bytes, a DER ECDSA P-256 signature under 80. 8 KiB is generous
// headroom for every field this product accepts, decoded and rejected in well under a
// millisecond. Enforced BEFORE any CBOR/JSON parsing: the decoder's own cost scales with
// input size (a flat CBOR array iterates once per byte-sized item, measured at ~650ms for
// a 20 MB payload on a single Node event loop), and these fields arrive at
// POST /api/v1/auth/login/passkey before any authentication — a cap here is the
// difference between "reject a malformed request" and "block the whole process for
// every concurrent user with one unauthenticated POST".
const MAX_FIELD_BYTES = 8192;

function decodeField(name, value) {
  const buffer = Buffer.from(String(value ?? ''), 'base64url');
  if (buffer.length > MAX_FIELD_BYTES) throw new Error(`${name} exceeds the maximum accepted size.`);
  return buffer;
}

export function base64urlToBuffer(value) {
  return Buffer.from(String(value ?? ''), 'base64url');
}

export function bufferToBase64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

// --- CBOR (RFC 8949), definite-length subset only ---------------------------------
//
// WebAuthn requires authenticators to emit CBOR in the CTAP2 canonical form, which is
// always definite-length. Refusing indefinite-length items (major type 2/3/4/5 with
// additional info 31) is not a missing feature: accepting them would mean guessing at
// a length instead of trusting one a conforming authenticator always provides.

function readLength(buffer, offset, additionalInfo) {
  if (additionalInfo < 24) return { length: additionalInfo, next: offset };
  if (additionalInfo === 24) return { length: buffer.readUInt8(offset), next: offset + 1 };
  if (additionalInfo === 25) return { length: buffer.readUInt16BE(offset), next: offset + 2 };
  if (additionalInfo === 26) return { length: buffer.readUInt32BE(offset), next: offset + 4 };
  if (additionalInfo === 27) {
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR length exceeds the safe integer range.');
    return { length: Number(big), next: offset + 8 };
  }
  throw new Error('Indefinite-length CBOR is not accepted.');
}

function decodeCborAt(buffer, offset) {
  if (offset >= buffer.length) throw new Error('Unexpected end of CBOR data.');
  const initial = buffer[offset];
  const majorType = initial >> 5;
  const additionalInfo = initial & 0x1f;
  const cursor = offset + 1;

  if (majorType === 0) {
    const { length, next } = readLength(buffer, cursor, additionalInfo);
    return { value: length, offset: next };
  }
  if (majorType === 1) {
    const { length, next } = readLength(buffer, cursor, additionalInfo);
    return { value: -1 - length, offset: next };
  }
  if (majorType === 2) {
    const { length, next } = readLength(buffer, cursor, additionalInfo);
    return { value: buffer.subarray(next, next + length), offset: next + length };
  }
  if (majorType === 3) {
    const { length, next } = readLength(buffer, cursor, additionalInfo);
    return { value: buffer.toString('utf8', next, next + length), offset: next + length };
  }
  if (majorType === 4) {
    const { length: count, next } = readLength(buffer, cursor, additionalInfo);
    const items = [];
    let pos = next;
    for (let index = 0; index < count; index += 1) {
      const decoded = decodeCborAt(buffer, pos);
      items.push(decoded.value);
      pos = decoded.offset;
    }
    return { value: items, offset: pos };
  }
  if (majorType === 5) {
    const { length: count, next } = readLength(buffer, cursor, additionalInfo);
    const map = new Map();
    let pos = next;
    for (let index = 0; index < count; index += 1) {
      const key = decodeCborAt(buffer, pos);
      const value = decodeCborAt(buffer, key.offset);
      map.set(key.value, value.value);
      pos = value.offset;
    }
    return { value: map, offset: pos };
  }
  if (majorType === 6) {
    // A semantic tag. Its number carries no meaning any structure here relies on, so
    // it is consumed and the tagged value is returned as if the tag were absent.
    const { next } = readLength(buffer, cursor, additionalInfo);
    return decodeCborAt(buffer, next);
  }
  if (majorType === 7) {
    if (additionalInfo === 20) return { value: false, offset: cursor };
    if (additionalInfo === 21) return { value: true, offset: cursor };
    if (additionalInfo === 22) return { value: null, offset: cursor };
    throw new Error('Unsupported CBOR simple value (floats are not used by these structures).');
  }
  throw new Error('Unsupported CBOR major type.');
}

/** Decode a single CBOR item from the start of `buffer`. Trailing bytes are ignored. */
export function decodeCbor(buffer) {
  return decodeCborAt(buffer, 0).value;
}

// --- authenticatorData (WebAuthn L2 6.1) -------------------------------------------

function parseAuthenticatorData(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 37) throw new Error('Authenticator data is too short.');
  const rpIdHash = buffer.subarray(0, 32);
  const flagsByte = buffer[32];
  const flags = {
    up: Boolean(flagsByte & 0x01),
    uv: Boolean(flagsByte & 0x04),
    at: Boolean(flagsByte & 0x40),
    ed: Boolean(flagsByte & 0x80),
  };
  const signCount = buffer.readUInt32BE(33);
  let credentialId = null;
  let credentialPublicKey = null;
  if (flags.at) {
    let cursor = 37 + 16; // skip AAGUID; this product does not consult a metadata service
    if (buffer.length < cursor + 2) throw new Error('Attested credential data is truncated.');
    const idLength = buffer.readUInt16BE(cursor);
    cursor += 2;
    if (buffer.length < cursor + idLength) throw new Error('Attested credential data is truncated.');
    credentialId = buffer.subarray(cursor, cursor + idLength);
    cursor += idLength;
    const decoded = decodeCborAt(buffer, cursor);
    credentialPublicKey = decoded.value;
  }
  return { rpIdHash, flags, signCount, credentialId, credentialPublicKey };
}

/**
 * A COSE_Key (RFC 9053 EC2) to a JWK node:crypto can import. Restricted to exactly
 * what this product was authorised to support: kty EC2, alg ES256, curve P-256. Any
 * other key — Ed25519, RSA, a P-384 curve reusing alg -7 by mistake — is refused
 * rather than guessed at.
 */
function coseKeyToJwk(coseKey) {
  if (!(coseKey instanceof Map)) throw new Error('Credential public key is not a COSE map.');
  const kty = coseKey.get(1);
  const alg = coseKey.get(3);
  const crv = coseKey.get(-1);
  const x = coseKey.get(-2);
  const y = coseKey.get(-3);
  if (kty !== 2 || alg !== COSE_ALG_ES256 || crv !== 1) {
    throw new Error('Only an ES256 (P-256) EC2 credential key is supported.');
  }
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
    throw new Error('Malformed EC2 public key coordinates.');
  }
  return { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') };
}

/**
 * Verify a registration (`navigator.credentials.create()`) response. Attestation
 * format is required to be 'none' — the Owner's choice — so there is no certificate
 * chain to validate; the check is that the browser and authenticator agree with what
 * the server asked for, and that the authenticator actually verified the user rather
 * than merely observing a touch.
 */
export function verifyRegistration({ clientDataJSON, attestationObject, expectedChallenge, expectedOrigin, rpId }) {
  const clientDataBuffer = decodeField('clientDataJSON', clientDataJSON);
  const clientData = JSON.parse(clientDataBuffer.toString('utf8'));
  if (clientData.type !== 'webauthn.create') throw new Error('Unexpected ceremony type.');
  if (clientData.challenge !== expectedChallenge) throw new Error('Challenge mismatch.');
  if (clientData.origin !== expectedOrigin) throw new Error('Origin mismatch.');

  const attestation = decodeCbor(decodeField('attestationObject', attestationObject));
  if (!(attestation instanceof Map)) throw new Error('Malformed attestation object.');
  if (attestation.get('fmt') !== 'none') throw new Error('Only "none" attestation is accepted.');
  const authDataBuffer = attestation.get('authData');
  if (!Buffer.isBuffer(authDataBuffer)) throw new Error('Malformed attestation object.');
  const authData = parseAuthenticatorData(authDataBuffer);

  const expectedRpIdHash = createHash('sha256').update(rpId).digest();
  if (!expectedRpIdHash.equals(authData.rpIdHash)) throw new Error('Relying party ID mismatch.');
  if (!authData.flags.up) throw new Error('User presence was not confirmed.');
  if (!authData.flags.uv) throw new Error('User verification was not confirmed.');
  if (!authData.credentialId || !authData.credentialPublicKey) throw new Error('No credential was attested.');

  return {
    credentialId: bufferToBase64url(authData.credentialId),
    publicKeyJwk: coseKeyToJwk(authData.credentialPublicKey),
    signCount: authData.signCount,
  };
}

/**
 * Verify an authentication (`navigator.credentials.get()`) response against a
 * previously stored credential. Signature bytes from a WebAuthn ES256 assertion are
 * already ASN.1 DER-encoded ECDSA — the same encoding node:crypto's `verify` expects
 * by default — so no re-encoding step is needed.
 */
export function verifyAssertion({
  clientDataJSON, authenticatorData, signature,
  expectedChallenge, expectedOrigin, rpId, publicKeyJwk, lastSignCount,
}) {
  const clientDataBuffer = decodeField('clientDataJSON', clientDataJSON);
  const clientData = JSON.parse(clientDataBuffer.toString('utf8'));
  if (clientData.type !== 'webauthn.get') throw new Error('Unexpected ceremony type.');
  if (clientData.challenge !== expectedChallenge) throw new Error('Challenge mismatch.');
  if (clientData.origin !== expectedOrigin) throw new Error('Origin mismatch.');

  const authDataBuffer = decodeField('authenticatorData', authenticatorData);
  const authData = parseAuthenticatorData(authDataBuffer);
  const expectedRpIdHash = createHash('sha256').update(rpId).digest();
  if (!expectedRpIdHash.equals(authData.rpIdHash)) throw new Error('Relying party ID mismatch.');
  if (!authData.flags.up) throw new Error('User presence was not confirmed.');
  if (!authData.flags.uv) throw new Error('User verification was not confirmed.');
  // A counter of 0 on both sides means the authenticator does not implement one — true
  // of most platform authenticators backed by a secure enclave, which re-verify the
  // user by biometric/PIN on every use instead. That case is not comparable and not a
  // clone signal by itself. Any nonzero count must strictly increase; one that does
  // not is the classic sign of a cloned credential replaying an old assertion.
  if (authData.signCount !== 0 && authData.signCount <= lastSignCount) {
    throw new Error('Signature counter did not increase; possible cloned authenticator.');
  }

  const clientDataHash = createHash('sha256').update(clientDataBuffer).digest();
  const signedData = Buffer.concat([authDataBuffer, clientDataHash]);
  const publicKey = createPublicKey({ key: publicKeyJwk, format: 'jwk' });
  if (!cryptoVerify('sha256', signedData, publicKey, decodeField('signature', signature))) {
    throw new Error('Signature verification failed.');
  }
  return { signCount: authData.signCount };
}
