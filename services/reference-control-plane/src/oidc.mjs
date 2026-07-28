// SPDX-License-Identifier: AGPL-3.0-or-later
//
// OIDC ID token verification · phase 7 step 30 ("Il mondo esterno", 09_PIANO.md §2), the
// second third of "OIDC, SAML, SCIM" (see scim.mjs for the first, and its module comment
// for why SAML is the one not attempted).
//
// This verifies a JWT ID token against a JWKS (JSON Web Key Set) using node:crypto's
// native JWK import (`createPublicKey({ key, format:'jwk' })`, supported since Node 15 --
// no dependency, no hand-rolled base64/ASN.1 key parsing). It does not perform the
// authorization-code redirect flow, does not talk to a token endpoint, and does not issue
// a session from a verified token: this environment has no real external identity
// provider it can register a client with and exchange a code against, so claiming that
// flow works would be an untested claim dressed as a feature. What is real and testable
// without one: the cryptography. A dedicated test signs a token with a locally generated
// RSA keypair (the same posture compliance-packs.mjs / technology-radar.mjs took for
// Ed25519 -- prove the primitive, do not fake the integration) and this module verifies it.
//
// Only RS256 is accepted, explicitly. Two well-known JWT footguns this refuses by
// construction: `alg: "none"` (an unsigned token that passes if the verifier ever skips
// the check) and algorithm confusion (a token claiming HS256 tricking a verifier that was
// given an RSA public key into treating that key as an HMAC secret). Neither has a code
// path here — there is no HMAC verification function in this module, and `alg` is checked
// against a single allowed value before any key lookup happens.
//
// Read-only / advisory, same posture as the Radar and the pack framework: verifies, does
// not decide who gets a session. See oidcStatus().enforced.

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export class OidcError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'OidcError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new OidcError(kind, reason); };

const ALLOWED_ALG = 'RS256';

function base64UrlDecode(segment) {
  return Buffer.from(segment, 'base64url');
}

function decodeJsonSegment(segment, label) {
  let text;
  try { text = base64UrlDecode(segment).toString('utf8'); } catch { refuse('MALFORMED', `${label} is not valid base64url`); }
  try { return JSON.parse(text); } catch { refuse('MALFORMED', `${label} is not valid JSON`); }
}

/** Splits and decodes a JWT's header and payload without verifying anything yet -- for a
 * caller (or a log) that wants to see what a token claims before deciding whether the
 * signature and claims are trusted. Never used by verifyIdToken() to make a decision. */
export function decodeTokenUnsafe(idToken) {
  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) refuse('MALFORMED', 'a JWT has exactly three dot-separated segments');
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  return {
    header: decodeJsonSegment(headerSegment, 'header'),
    payload: decodeJsonSegment(payloadSegment, 'payload'),
    signingInput: `${headerSegment}.${payloadSegment}`,
    signature: base64UrlDecode(signatureSegment),
  };
}

function findKey(jwks, kid) {
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const candidates = kid ? keys.filter((k) => k.kid === kid) : keys;
  const key = candidates.find((k) => (k.kty === 'RSA') && (!k.use || k.use === 'sig'));
  return key ?? null;
}

/**
 * Verifies signature, `iss`, `aud`, `exp`, `nbf` (if present) and that `iat` exists.
 * Refuses (throws), never returns a partial or "trust me" result — a caller either has a
 * fully verified payload or an OidcError naming exactly what failed.
 */
export function verifyIdToken(idToken, jwks, { issuer, audience, now = new Date() } = {}) {
  const { header, payload, signingInput, signature } = decodeTokenUnsafe(idToken);

  if (header.alg !== ALLOWED_ALG) refuse('UNSUPPORTED_ALG', `only ${ALLOWED_ALG} is accepted, token declared "${header.alg}"`);

  const jwk = findKey(jwks, header.kid);
  if (!jwk) refuse('KEY_NOT_FOUND', `no matching RSA signing key for kid "${header.kid}" in the JWKS`);

  let publicKey;
  try { publicKey = createPublicKey({ key: jwk, format:'jwk' }); } catch { refuse('BAD_KEY', 'the matched JWK could not be imported as an RSA public key'); }

  const verified = cryptoVerify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature);
  if (!verified) refuse('BAD_SIGNATURE', 'signature does not verify against the matched key');

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (issuer !== undefined && payload.iss !== issuer) refuse('BAD_ISSUER', `iss "${payload.iss}" does not match expected "${issuer}"`);
  if (audience !== undefined) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(audience)) refuse('BAD_AUDIENCE', `aud does not include expected "${audience}"`);
  }
  if (typeof payload.exp !== 'number') refuse('MISSING_CLAIM', 'exp is required');
  if (payload.exp <= nowSeconds) refuse('EXPIRED', 'exp has passed');
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) refuse('NOT_YET_VALID', 'nbf is in the future');
  if (typeof payload.iat !== 'number') refuse('MISSING_CLAIM', 'iat is required');

  return payload;
}

/**
 * The OIDC Discovery document's required fields (OpenID Connect Discovery 1.0 §3),
 * checked by name rather than run through the generic sector-modules/compliance-packs
 * schema validator: this document's shape (nested arrays of enum-like strings, no
 * top-level `additionalProperties:false` intent — a real discovery document legitimately
 * carries provider-specific extension fields) does not fit that validator's subset
 * cleanly, and forcing it through would mean widening that validator for one caller.
 */
export function validateDiscoveryDocument(candidate) {
  const required = ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri', 'response_types_supported', 'subject_types_supported', 'id_token_signing_alg_values_supported'];
  const errors = [];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid:false, errors:['discovery document must be a JSON object'] };
  }
  for (const field of required) {
    if (!(field in candidate)) errors.push(`missing required field "${field}"`);
  }
  if (Array.isArray(candidate.id_token_signing_alg_values_supported)
    && !candidate.id_token_signing_alg_values_supported.includes(ALLOWED_ALG)) {
    errors.push(`id_token_signing_alg_values_supported does not list ${ALLOWED_ALG}, the only algorithm this verifier accepts`);
  }
  return { valid: errors.length === 0, errors };
}

export function oidcStatus() {
  return {
    supportedAlgorithm: ALLOWED_ALG,
    verifiesIdTokens: true,
    verifiesDiscoveryDocuments: true,
    authorizationCodeFlow: false,
    tokenEndpointExchange: false,
    sessionIssuedFromToken: false,
    enforced: false,
    reason: 'Verifies a supplied ID token or discovery document. Does not perform the redirect/token-exchange flow and does not create a session from a verified token — there is no real external IdP reachable from this environment to test that flow against, and claiming it works untested would be worse than not building it.',
    rustTwin: false,
    rustTwinReason: 'Same posture as sector-modules.mjs / compliance-packs.mjs / technology-radar.mjs: verifies, does not decide or confine anything a caller can reach yet.',
  };
}
