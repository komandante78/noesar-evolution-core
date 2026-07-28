// SPDX-License-Identifier: AGPL-3.0-or-later
// Phase 7 step 30 (OIDC third): ID token verification. No Rust twin (see the module
// comment in src/oidc.mjs), so this is a plain test suite, not a shared-vectors run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  OidcError, decodeTokenUnsafe, verifyIdToken, validateDiscoveryDocument, oidcStatus,
} from '../src/oidc.mjs';

function issueRsaKeypair() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

function makeToken({ privateKey, kid = 'k1', alg = 'RS256', claims = {} }) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg, kid, typ:'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:'https://idp.example', aud:'noesar-client', sub:'user-1',
    exp: now + 3600, iat: now, ...claims,
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function jwksFor(publicKey, kid = 'k1') {
  const jwk = publicKey.export({ format:'jwk' });
  jwk.kid = kid;
  jwk.use = 'sig';
  return { keys:[jwk] };
}

test('decodeTokenUnsafe: refuses a string that is not three dot-separated segments', () => {
  assert.throws(() => decodeTokenUnsafe('not-a-jwt'), OidcError);
  assert.throws(() => decodeTokenUnsafe('a.b.c.d'), OidcError);
});

test('decodeTokenUnsafe: reads header/payload without checking the signature', () => {
  const { privateKey } = issueRsaKeypair();
  const token = makeToken({ privateKey });
  const decoded = decodeTokenUnsafe(token);
  assert.equal(decoded.header.alg, 'RS256');
  assert.equal(decoded.payload.iss, 'https://idp.example');
});

test('verifyIdToken: a validly signed, current token verifies and returns its claims', () => {
  const { privateKey, publicKey } = issueRsaKeypair();
  const token = makeToken({ privateKey });
  const claims = verifyIdToken(token, jwksFor(publicKey), { issuer:'https://idp.example', audience:'noesar-client' });
  assert.equal(claims.sub, 'user-1');
});

test('verifyIdToken: a token whose payload was tampered with after signing is rejected', () => {
  const { privateKey, publicKey } = issueRsaKeypair();
  const token = makeToken({ privateKey });
  const [header, payload, signature] = token.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), sub:'attacker' })).toString('base64url');
  const tampered = `${header}.${tamperedPayload}.${signature}`;
  assert.throws(() => verifyIdToken(tampered, jwksFor(publicKey), { issuer:'https://idp.example', audience:'noesar-client' }), OidcError);
});

test('verifyIdToken: alg "none" is refused before any key lookup', () => {
  const { publicKey } = issueRsaKeypair();
  const header = Buffer.from(JSON.stringify({ alg:'none', typ:'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss:'https://idp.example', aud:'noesar-client', exp:9999999999, iat:1 })).toString('base64url');
  const unsigned = `${header}.${payload}.`;
  assert.throws(
    () => verifyIdToken(unsigned, jwksFor(publicKey), { issuer:'https://idp.example', audience:'noesar-client' }),
    (error) => error instanceof OidcError && error.kind === 'UNSUPPORTED_ALG',
  );
});

test('verifyIdToken: HS256 (algorithm-confusion shape) is refused, not silently accepted', () => {
  const { publicKey } = issueRsaKeypair();
  const header = Buffer.from(JSON.stringify({ alg:'HS256', kid:'k1', typ:'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss:'https://idp.example', aud:'noesar-client', exp:9999999999, iat:1 })).toString('base64url');
  const forged = `${header}.${payload}.Zm9yZ2Vk`;
  assert.throws(
    () => verifyIdToken(forged, jwksFor(publicKey), { issuer:'https://idp.example', audience:'noesar-client' }),
    (error) => error instanceof OidcError && error.kind === 'UNSUPPORTED_ALG',
  );
});

test('verifyIdToken: no key matches the declared kid', () => {
  const { privateKey, publicKey } = issueRsaKeypair();
  const token = makeToken({ privateKey, kid:'other-key' });
  assert.throws(
    () => verifyIdToken(token, jwksFor(publicKey, 'k1'), { issuer:'https://idp.example', audience:'noesar-client' }),
    (error) => error instanceof OidcError && error.kind === 'KEY_NOT_FOUND',
  );
});

test('verifyIdToken: wrong issuer is rejected', () => {
  const { privateKey, publicKey } = issueRsaKeypair();
  const token = makeToken({ privateKey });
  assert.throws(
    () => verifyIdToken(token, jwksFor(publicKey), { issuer:'https://not-the-idp.example', audience:'noesar-client' }),
    (error) => error instanceof OidcError && error.kind === 'BAD_ISSUER',
  );
});

test('verifyIdToken: audience not in aud array is rejected, aud as array is supported', () => {
  const { privateKey, publicKey } = issueRsaKeypair();
  const token = makeToken({ privateKey, claims:{ aud:['other-client', 'a-third-client'] } });
  assert.throws(
    () => verifyIdToken(token, jwksFor(publicKey), { issuer:'https://idp.example', audience:'noesar-client' }),
    (error) => error instanceof OidcError && error.kind === 'BAD_AUDIENCE',
  );
  const good = makeToken({ privateKey, claims:{ aud:['noesar-client', 'a-third-client'] } });
  const claims = verifyIdToken(good, jwksFor(publicKey), { issuer:'https://idp.example', audience:'noesar-client' });
  assert.deepEqual(claims.aud, ['noesar-client', 'a-third-client']);
});

test('verifyIdToken: an expired token is rejected', () => {
  const { privateKey, publicKey } = issueRsaKeypair();
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ privateKey, claims:{ exp: now - 10 } });
  assert.throws(
    () => verifyIdToken(token, jwksFor(publicKey), { issuer:'https://idp.example', audience:'noesar-client' }),
    (error) => error instanceof OidcError && error.kind === 'EXPIRED',
  );
});

test('verifyIdToken: a not-yet-valid nbf is rejected', () => {
  const { privateKey, publicKey } = issueRsaKeypair();
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ privateKey, claims:{ nbf: now + 3600 } });
  assert.throws(
    () => verifyIdToken(token, jwksFor(publicKey), { issuer:'https://idp.example', audience:'noesar-client' }),
    (error) => error instanceof OidcError && error.kind === 'NOT_YET_VALID',
  );
});

test('validateDiscoveryDocument: a well-formed document listing RS256 passes', () => {
  const doc = {
    issuer:'https://idp.example', authorization_endpoint:'https://idp.example/authorize',
    token_endpoint:'https://idp.example/token', jwks_uri:'https://idp.example/jwks',
    response_types_supported:['code'], subject_types_supported:['public'],
    id_token_signing_alg_values_supported:['RS256'],
  };
  assert.deepEqual(validateDiscoveryDocument(doc), { valid:true, errors:[] });
});

test('validateDiscoveryDocument: missing required fields are named', () => {
  const result = validateDiscoveryDocument({});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('issuer')));
  assert.ok(result.errors.some((e) => e.includes('jwks_uri')));
});

test('validateDiscoveryDocument: a document that never lists RS256 is flagged', () => {
  const doc = {
    issuer:'https://idp.example', authorization_endpoint:'https://idp.example/authorize',
    token_endpoint:'https://idp.example/token', jwks_uri:'https://idp.example/jwks',
    response_types_supported:['code'], subject_types_supported:['public'],
    id_token_signing_alg_values_supported:['ES256'],
  };
  const result = validateDiscoveryDocument(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('RS256')));
});

test('oidcStatus declares what is verified and what is not wired', () => {
  const status = oidcStatus();
  assert.equal(status.supportedAlgorithm, 'RS256');
  assert.equal(status.verifiesIdTokens, true);
  assert.equal(status.authorizationCodeFlow, false);
  assert.equal(status.sessionIssuedFromToken, false);
  assert.equal(status.enforced, false);
  assert.equal(status.rustTwin, false);
});
