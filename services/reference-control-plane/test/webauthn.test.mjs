// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This module is a from-scratch CBOR decoder and WebAuthn verifier — there is no
// upstream library's test suite backing it. Fixtures below are built with a tiny
// CBOR ENCODER (test-only; production code only ever needs to decode what a browser
// sends) so that registration/assertion tests exercise the real byte layout an
// authenticator produces, not a shortcut through it.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';
import { decodeCbor, verifyAssertion, verifyRegistration } from '../src/webauthn.mjs';

function sha256(buffer) { return createHash('sha256').update(buffer).digest(); }

// --- minimal CBOR encoder, fixtures only -------------------------------------------

function cborTypeLength(majorType, length) {
  const prefix = majorType << 5;
  if (length < 24) return Buffer.from([prefix | length]);
  if (length < 256) return Buffer.from([prefix | 24, length]);
  return Buffer.from([prefix | 25, (length >> 8) & 0xff, length & 0xff]);
}
function cborEncode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([cborTypeLength(2, value.length), value]);
  if (typeof value === 'string') {
    const buf = Buffer.from(value, 'utf8');
    return Buffer.concat([cborTypeLength(3, buf.length), buf]);
  }
  if (typeof value === 'number') {
    return value >= 0 ? cborTypeLength(0, value) : cborTypeLength(1, -1 - value);
  }
  if (Array.isArray(value)) return Buffer.concat([cborTypeLength(4, value.length), ...value.map(cborEncode)]);
  if (value instanceof Map) {
    const parts = [cborTypeLength(5, value.size)];
    for (const [key, val] of value) { parts.push(cborEncode(key)); parts.push(cborEncode(val)); }
    return Buffer.concat(parts);
  }
  throw new Error('Unsupported fixture value type');
}

// --- WebAuthn fixture builders -------------------------------------------------

function buildAuthenticatorData({ rpId, up = true, uv = true, signCount = 0, attested = null }) {
  const rpIdHash = sha256(Buffer.from(rpId, 'utf8'));
  const flagsByte = (up ? 0x01 : 0) | (uv ? 0x04 : 0) | (attested ? 0x40 : 0);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount, 0);
  const parts = [rpIdHash, Buffer.from([flagsByte]), counter];
  if (attested) {
    const aaguid = Buffer.alloc(16);
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(attested.credentialId.length, 0);
    const coseKeyMap = new Map([
      [1, 2], [3, attested.alg ?? -7], [-1, 1],
      [-2, Buffer.from(attested.publicKeyJwk.x, 'base64url')],
      [-3, Buffer.from(attested.publicKeyJwk.y, 'base64url')],
    ]);
    parts.push(aaguid, credIdLen, attested.credentialId, cborEncode(coseKeyMap));
  }
  return Buffer.concat(parts);
}
function buildAttestationObject(authData, fmt = 'none') {
  return cborEncode(new Map([['fmt', fmt], ['attStmt', new Map()], ['authData', authData]]));
}
function buildClientDataJSON(type, challenge, origin) {
  return Buffer.from(JSON.stringify({ type, challenge, origin }), 'utf8').toString('base64url');
}

const RP_ID = 'noesar.example';
const ORIGIN = 'https://noesar.example';

function freshKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

describe('CBOR decoder — RFC 8949 Appendix A vectors', () => {
  const cases = [
    ['00', 0], ['01', 1], ['0a', 10], ['17', 23], ['1818', 24], ['1819', 25],
    ['1864', 100], ['20', -1], ['29', -10], ['3863', -100],
    ['80', []], ['83010203', [1, 2, 3]],
    ['a201020304', new Map([[1, 2], [3, 4]])],
    ['f4', false], ['f5', true], ['f6', null],
    ['60', ''], ['6161', 'a'], ['6449455446', 'IETF'],
  ];
  for (const [hex, expected] of cases) {
    test(`decodes ${hex}`, () => {
      const decoded = decodeCbor(Buffer.from(hex, 'hex'));
      if (expected instanceof Map) assert.deepEqual([...decoded], [...expected]);
      else assert.deepEqual(decoded, expected);
    });
  }
  test('refuses indefinite-length items', () => {
    assert.throws(() => decodeCbor(Buffer.from([0x5f])), /[Ii]ndefinite/);
  });
});

describe('verifyRegistration', () => {
  test('accepts a well-formed none-attestation ES256 registration', () => {
    const { jwk } = freshKeypair();
    const credentialId = randomBytes(16);
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, ORIGIN);
    const authData = buildAuthenticatorData({ rpId: RP_ID, attested: { credentialId, publicKeyJwk: jwk } });
    const attestationObject = buildAttestationObject(authData).toString('base64url');
    const result = verifyRegistration({ clientDataJSON, attestationObject, expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID });
    assert.equal(result.credentialId, credentialId.toString('base64url'));
    assert.equal(result.publicKeyJwk.x, jwk.x);
    assert.equal(result.publicKeyJwk.y, jwk.y);
    assert.equal(result.signCount, 0);
  });

  test('rejects a challenge that does not match the one the server issued', () => {
    const { jwk } = freshKeypair();
    const credentialId = randomBytes(16);
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, ORIGIN);
    const authData = buildAuthenticatorData({ rpId: RP_ID, attested: { credentialId, publicKeyJwk: jwk } });
    const attestationObject = buildAttestationObject(authData).toString('base64url');
    assert.throws(() => verifyRegistration({
      clientDataJSON, attestationObject, expectedChallenge: randomBytes(32).toString('base64url'), expectedOrigin: ORIGIN, rpId: RP_ID,
    }), /[Cc]hallenge/);
  });

  test('rejects an origin other than this installation\'s own', () => {
    const { jwk } = freshKeypair();
    const credentialId = randomBytes(16);
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, 'https://attacker.example');
    const authData = buildAuthenticatorData({ rpId: RP_ID, attested: { credentialId, publicKeyJwk: jwk } });
    const attestationObject = buildAttestationObject(authData).toString('base64url');
    assert.throws(() => verifyRegistration({
      clientDataJSON, attestationObject, expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
    }), /[Oo]rigin/);
  });

  test('rejects attestation formats other than "none" — the only one this installation was authorised to accept', () => {
    const { jwk } = freshKeypair();
    const credentialId = randomBytes(16);
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, ORIGIN);
    const authData = buildAuthenticatorData({ rpId: RP_ID, attested: { credentialId, publicKeyJwk: jwk } });
    const attestationObject = buildAttestationObject(authData, 'packed').toString('base64url');
    assert.throws(() => verifyRegistration({
      clientDataJSON, attestationObject, expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
    }), /attestation/i);
  });

  test('rejects a credential public key whose algorithm is not ES256', () => {
    const { jwk } = freshKeypair();
    const credentialId = randomBytes(16);
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, ORIGIN);
    const authData = buildAuthenticatorData({ rpId: RP_ID, attested: { credentialId, publicKeyJwk: jwk, alg: -257 } });
    const attestationObject = buildAttestationObject(authData).toString('base64url');
    assert.throws(() => verifyRegistration({
      clientDataJSON, attestationObject, expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
    }), /ES256/);
  });

  test('rejects a response for a different relying party ID', () => {
    const { jwk } = freshKeypair();
    const credentialId = randomBytes(16);
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, ORIGIN);
    const authData = buildAuthenticatorData({ rpId: 'attacker.example', attested: { credentialId, publicKeyJwk: jwk } });
    const attestationObject = buildAttestationObject(authData).toString('base64url');
    assert.throws(() => verifyRegistration({
      clientDataJSON, attestationObject, expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
    }), /[Rr]elying party/);
  });

  test('rejects an oversized attestationObject before it ever reaches the CBOR decoder — the DoS vector this size cap closes', () => {
    // The content does not matter here: the size check runs BEFORE decodeCbor is ever
    // called, on exactly the shape that made decodeCbor measurably slow (~650ms for a
    // 20MB flat CBOR array) before this cap existed. Only the size is the point.
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, ORIGIN);
    const attestationObject = Buffer.alloc(200_000, 0x00).toString('base64url');
    const start = process.hrtime.bigint();
    assert.throws(() => verifyRegistration({
      clientDataJSON, attestationObject, expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
    }), /exceeds the maximum accepted size/);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 50, `size check must reject before doing real parsing work (took ${ms}ms)`);
  });

  test('rejects a registration where user verification was not performed', () => {
    const { jwk } = freshKeypair();
    const credentialId = randomBytes(16);
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, ORIGIN);
    const authData = buildAuthenticatorData({ rpId: RP_ID, uv: false, attested: { credentialId, publicKeyJwk: jwk } });
    const attestationObject = buildAttestationObject(authData).toString('base64url');
    assert.throws(() => verifyRegistration({
      clientDataJSON, attestationObject, expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
    }), /verification/i);
  });
});

describe('verifyAssertion', () => {
  function signedAssertion({ privateKey, signCount, challenge = randomBytes(32).toString('base64url'), origin = ORIGIN, rpId = RP_ID, type = 'webauthn.get' }) {
    const clientDataJSON = buildClientDataJSON(type, challenge, origin);
    const authenticatorData = buildAuthenticatorData({ rpId, signCount });
    const clientDataHash = sha256(Buffer.from(clientDataJSON, 'base64url'));
    const signature = cryptoSign('sha256', Buffer.concat([authenticatorData, clientDataHash]), privateKey).toString('base64url');
    return { clientDataJSON, authenticatorData: authenticatorData.toString('base64url'), signature, challenge };
  }

  test('accepts a correctly signed assertion and reports the new counter', () => {
    const { privateKey, jwk } = freshKeypair();
    const { clientDataJSON, authenticatorData, signature, challenge } = signedAssertion({ privateKey, signCount: 5 });
    const result = verifyAssertion({
      clientDataJSON, authenticatorData, signature,
      expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID, publicKeyJwk: jwk, lastSignCount: 4,
    });
    assert.equal(result.signCount, 5);
  });

  test('rejects a counter that did not increase — the clone signal', () => {
    const { privateKey, jwk } = freshKeypair();
    const { clientDataJSON, authenticatorData, signature, challenge } = signedAssertion({ privateKey, signCount: 5 });
    assert.throws(() => verifyAssertion({
      clientDataJSON, authenticatorData, signature,
      expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID, publicKeyJwk: jwk, lastSignCount: 5,
    }), /counter/i);
  });

  test('accepts a counter of zero on both sides — authenticators without one, not a clone signal', () => {
    const { privateKey, jwk } = freshKeypair();
    const { clientDataJSON, authenticatorData, signature, challenge } = signedAssertion({ privateKey, signCount: 0 });
    const result = verifyAssertion({
      clientDataJSON, authenticatorData, signature,
      expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID, publicKeyJwk: jwk, lastSignCount: 0,
    });
    assert.equal(result.signCount, 0);
  });

  test('rejects a tampered signature', () => {
    const { privateKey, jwk } = freshKeypair();
    const { clientDataJSON, authenticatorData, signature, challenge } = signedAssertion({ privateKey, signCount: 1 });
    const tampered = Buffer.from(signature, 'base64url');
    tampered[0] ^= 0xff;
    assert.throws(() => verifyAssertion({
      clientDataJSON, authenticatorData, signature: tampered.toString('base64url'),
      expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID, publicKeyJwk: jwk, lastSignCount: 0,
    }), /[Ss]ignature/);
  });

  test('rejects a response signed for a different account\'s public key', () => {
    const attacker = freshKeypair();
    const victim = freshKeypair();
    const { clientDataJSON, authenticatorData, signature, challenge } = signedAssertion({ privateKey: attacker.privateKey, signCount: 1 });
    assert.throws(() => verifyAssertion({
      clientDataJSON, authenticatorData, signature,
      expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID, publicKeyJwk: victim.jwk, lastSignCount: 0,
    }), /[Ss]ignature/);
  });

  test('rejects an oversized authenticatorData before it ever reaches the CBOR decoder', () => {
    const { jwk } = freshKeypair();
    const oversized = Buffer.alloc(200_000, 0x00).toString('base64url');
    const challenge = randomBytes(32).toString('base64url');
    const clientDataJSON = buildClientDataJSON('webauthn.get', challenge, ORIGIN);
    const start = process.hrtime.bigint();
    assert.throws(() => verifyAssertion({
      clientDataJSON, authenticatorData: oversized, signature: randomBytes(64).toString('base64url'),
      expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID, publicKeyJwk: jwk, lastSignCount: 0,
    }), /exceeds the maximum accepted size/);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 50, `size check must reject before doing real parsing work (took ${ms}ms)`);
  });

  test('rejects a client data ceremony type mismatch (a create() response replayed as get())', () => {
    const { privateKey, jwk } = freshKeypair();
    const { authenticatorData, signature, challenge } = signedAssertion({ privateKey, signCount: 1, type: 'webauthn.create' });
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, ORIGIN);
    assert.throws(() => verifyAssertion({
      clientDataJSON, authenticatorData, signature,
      expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID, publicKeyJwk: jwk, lastSignCount: 0,
    }), /ceremony/i);
  });
});
