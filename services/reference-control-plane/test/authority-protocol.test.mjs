import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthorityEnvelopeVerifier,
  createAuthorityEnvelope,
} from '../src/authority-protocol.mjs';

const secret = Buffer.alloc(32, 7);
const now = 1_800_000_000_000;

test('authority envelope is created with bounded fields', () => {
  const value = createAuthorityEnvelope(secret, {
    actorId:'owner',
    sessionId:'session',
    action:'authority.health',
    payload:{ probe:true },
    now,
    nonce:'0123456789abcdef',
  });
  assert.equal(value.schemaVersion, '1.1');
  assert.equal(value.expiresAt - value.issuedAt, 20);
  assert.ok(value.signature.length >= 32);
});

test('canonical payload ordering produces the same signature', () => {
  const a = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'path.evaluate',
    payload:{ b:2, a:1 }, now, nonce:'0123456789abcdef',
  });
  const b = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'path.evaluate',
    payload:{ a:1, b:2 }, now, nonce:'0123456789abcdef',
  });
  assert.equal(a.signature, b.signature);
});

test('short protocol secret is rejected', () => {
  assert.throws(
    () => createAuthorityEnvelope(Buffer.alloc(8), {
      actorId:'owner', sessionId:'session', action:'authority.health',
    }),
    /at least 32 bytes/
  );
});

test('unsupported action is rejected', () => {
  assert.throws(
    () => createAuthorityEnvelope(secret, {
      actorId:'owner', sessionId:'session', action:'host.execute',
    }),
    /unsupported authority action/
  );
});

test('lifetime above 30 seconds is rejected', () => {
  assert.throws(
    () => createAuthorityEnvelope(secret, {
      actorId:'owner', sessionId:'session', action:'authority.health',
      ttlSeconds:31,
    }),
    /between 1 and 30/
  );
});

test('valid envelope verifies', () => {
  const envelope = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'approval.verify',
    payload:{ planHash:'a'.repeat(64) }, now,
    nonce:'0123456789abcdef',
  });
  const verifier = new AuthorityEnvelopeVerifier(secret, { now:() => now });
  assert.equal(verifier.verify(envelope).actorId, 'owner');
});

test('payload tampering is rejected', () => {
  const envelope = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'approval.verify',
    payload:{ allowed:false }, now, nonce:'0123456789abcdef',
  });
  envelope.payload.allowed = true;
  const verifier = new AuthorityEnvelopeVerifier(secret, { now:() => now });
  assert.throws(() => verifier.verify(envelope), /signature mismatch/);
});

test('nonce replay is rejected', () => {
  const envelope = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'data-plane.status',
    now, nonce:'0123456789abcdef',
  });
  const verifier = new AuthorityEnvelopeVerifier(secret, { now:() => now });
  verifier.verify(envelope);
  assert.throws(() => verifier.verify(envelope), /replay/);
});

test('expired envelope is rejected', () => {
  const envelope = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'authority.health',
    now, ttlSeconds:1, nonce:'0123456789abcdef',
  });
  const verifier = new AuthorityEnvelopeVerifier(secret, {
    maxClockSkewSeconds:0,
    now:() => now + 2_000,
  });
  assert.throws(() => verifier.verify(envelope), /expired/);
});

test('future envelope is rejected', () => {
  const envelope = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'authority.health',
    now:now + 10_000, nonce:'0123456789abcdef',
  });
  const verifier = new AuthorityEnvelopeVerifier(secret, {
    maxClockSkewSeconds:0,
    now:() => now,
  });
  assert.throws(() => verifier.verify(envelope), /future/);
});

test('actor and session are required', () => {
  assert.throws(
    () => createAuthorityEnvelope(secret, {
      actorId:'', sessionId:'session', action:'authority.health',
    }),
    /required/
  );
});

test('signature is required', () => {
  const verifier = new AuthorityEnvelopeVerifier(secret, { now:() => now });
  assert.throws(
    () => verifier.verify({
      schemaVersion:'1.1',
      actorId:'owner',
      sessionId:'session',
      action:'authority.health',
      payload:{},
      nonce:'0123456789abcdef',
      issuedAt:Math.floor(now / 1000),
      expiresAt:Math.floor(now / 1000) + 20,
    }),
    /signature is required/
  );
});


test('actor binding mismatch is rejected', () => {
  const envelope = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'authority.health',
    now, nonce:'fedcba9876543210',
  });
  const verifier = new AuthorityEnvelopeVerifier(secret, { now:() => now });
  assert.throws(
    () => verifier.verify(envelope, { expectedActorId:'other' }),
    /actorId binding mismatch/
  );
});

test('session binding mismatch is rejected', () => {
  const envelope = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'authority.health',
    now, nonce:'fedcba9876543211',
  });
  const verifier = new AuthorityEnvelopeVerifier(secret, { now:() => now });
  assert.throws(
    () => verifier.verify(envelope, { expectedSessionId:'other' }),
    /sessionId binding mismatch/
  );
});

test('action binding mismatch is rejected', () => {
  const envelope = createAuthorityEnvelope(secret, {
    actorId:'owner', sessionId:'session', action:'authority.health',
    now, nonce:'fedcba9876543212',
  });
  const verifier = new AuthorityEnvelopeVerifier(secret, { now:() => now });
  assert.throws(
    () => verifier.verify(envelope, { expectedAction:'path.evaluate' }),
    /action binding mismatch/
  );
});
