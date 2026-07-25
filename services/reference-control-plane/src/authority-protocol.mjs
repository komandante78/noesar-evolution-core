// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { canonicalJsonBytes } from './canonical-json.mjs';

const ACTIONS = new Set([
  'authority.health',
  'path.evaluate',
  'approval.verify',
  'capability.authorize',
  'data-plane.status',
]);

function mac(secret, body) {
  return createHmac('sha256', secret)
    .update(canonicalJsonBytes(body))
    .digest('base64url');
}

function requireSecret(secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new TypeError('authority protocol secret must be at least 32 bytes');
  }
}

export function createAuthorityEnvelope(secret, {
  actorId,
  sessionId,
  action,
  payload,
  ttlSeconds = 20,
  now = Date.now(),
  nonce = randomBytes(18).toString('base64url'),
}) {
  requireSecret(secret);
  if (!ACTIONS.has(action)) throw new Error(`unsupported authority action: ${action}`);
  if (!actorId || !sessionId) throw new Error('actorId and sessionId are required');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 30) {
    throw new Error('ttlSeconds must be between 1 and 30');
  }
  if (typeof nonce !== 'string' || nonce.length < 16) {
    throw new Error('nonce must contain at least 16 characters');
  }

  const issuedAt = Math.floor(now / 1000);
  const body = {
    schemaVersion:'1.1',
    actorId:String(actorId),
    sessionId:String(sessionId),
    action,
    payload:payload ?? {},
    nonce,
    issuedAt,
    expiresAt:issuedAt + ttlSeconds,
  };
  return { ...body, signature:mac(secret, body) };
}

export class AuthorityEnvelopeVerifier {
  constructor(secret, {
    maxClockSkewSeconds = 5,
    replayRetentionSeconds = 120,
    now = () => Date.now(),
  } = {}) {
    requireSecret(secret);
    this.secret = secret;
    this.maxClockSkewSeconds = maxClockSkewSeconds;
    this.replayRetentionSeconds = replayRetentionSeconds;
    this.now = now;
    this.usedNonces = new Map();
  }

  verify(envelope, {
    expectedActorId,
    expectedSessionId,
    expectedAction,
  } = {}) {
    const nowSeconds = Math.floor(this.now() / 1000);
    this.#prune(nowSeconds);

    const signature = envelope?.signature;
    if (typeof signature !== 'string') throw new Error('signature is required');
    const body = { ...envelope };
    delete body.signature;

    if (body.schemaVersion !== '1.1') throw new Error('unsupported schemaVersion');
    if (!ACTIONS.has(body.action)) throw new Error('unsupported authority action');
    if (!body.actorId || !body.sessionId) throw new Error('actorId and sessionId are required');
    if (typeof body.nonce !== 'string' || body.nonce.length < 16) {
      throw new Error('nonce is invalid');
    }
    if (!Number.isInteger(body.issuedAt) || !Number.isInteger(body.expiresAt)) {
      throw new Error('issuedAt and expiresAt must be integers');
    }
    if (body.expiresAt <= body.issuedAt || body.expiresAt - body.issuedAt > 30) {
      throw new Error('authority envelope lifetime is invalid');
    }
    if (body.issuedAt > nowSeconds + this.maxClockSkewSeconds) {
      throw new Error('authority envelope is from the future');
    }
    if (body.expiresAt < nowSeconds - this.maxClockSkewSeconds) {
      throw new Error('authority envelope expired');
    }
    if (this.usedNonces.has(body.nonce)) {
      throw new Error('authority envelope replay detected');
    }

    const expected = Buffer.from(mac(this.secret, body));
    const supplied = Buffer.from(signature);
    if (
      expected.length !== supplied.length
      || !timingSafeEqual(expected, supplied)
    ) {
      throw new Error('authority envelope signature mismatch');
    }

    const bindings = {
      actorId:expectedActorId,
      sessionId:expectedSessionId,
      action:expectedAction,
    };
    for (const [field, expectedValue] of Object.entries(bindings)) {
      if (expectedValue !== undefined && body[field] !== expectedValue) {
        throw new Error(`authority envelope ${field} binding mismatch`);
      }
    }

    this.usedNonces.set(
      body.nonce,
      body.expiresAt + this.replayRetentionSeconds
    );
    return body;
  }

  #prune(nowSeconds) {
    for (const [nonce, expiresAt] of this.usedNonces) {
      if (expiresAt < nowSeconds) this.usedNonces.delete(nonce);
    }
  }
}

export const AuthorityProtocolActions = Object.freeze([...ACTIONS]);
