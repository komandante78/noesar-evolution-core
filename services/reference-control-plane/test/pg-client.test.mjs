// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit tests for the PostgreSQL wire-protocol client.
//
// These cover the parts that can be tested without a server: SCRAM-SHA-256 against the
// published RFC 7677 test vector, parameter encoding, result decoding, and message
// framing. The parts that need a live cluster are covered by
// tools/acceptance/postgres-integration.mjs, which runs inside the product image.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { PgConnection, PgPool, PgInternals, PostgresError } from '../src/pg-client.mjs';

const { decodeValue, encodeParameter, parseScramMessage, scramProof, xorBuffers, OID } = PgInternals;

test('SCRAM-SHA-256 reproduces the RFC 7677 test vector', () => {
  // RFC 7677 section 3: user "user", password "pencil", with the nonces and salt from
  // the document. If this drifts, authentication is broken against every real server.
  const clientFirstBare = 'n=user,r=rOprNGfwEbeRWgbNEkqO';
  const serverFirst = 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,'
    + 's=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
  const proof = scramProof({
    password: 'pencil',
    serverFirst,
    clientFirstBare,
    gs2Header: 'n,,',
  });
  assert.equal(
    proof.clientFinal,
    'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,'
    + 'p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
  );
  assert.equal(
    proof.serverSignature.toString('base64'),
    '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=',
  );
});

test('SCRAM refuses an iteration count below the RFC floor', () => {
  // A server asking for fewer rounds is either broken or making an offline attack on the
  // stored key cheaper. Complying quietly is the failure mode.
  assert.throws(
    () => scramProof({
      password: 'pencil',
      serverFirst: 'r=abcdef,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=1',
      clientFirstBare: 'n=,r=abc',
      gs2Header: 'n,,',
    }),
    /iteration count below 4096/,
  );
});

test('SCRAM refuses a server that omits the salt or the nonce', () => {
  assert.throws(
    () => scramProof({
      password: 'p', serverFirst: 's=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
      clientFirstBare: 'n=,r=abc', gs2Header: 'n,,',
    }),
    /did not send a nonce/,
  );
  assert.throws(
    () => scramProof({
      password: 'p', serverFirst: 'r=abcdef,i=4096',
      clientFirstBare: 'n=,r=abc', gs2Header: 'n,,',
    }),
    /did not send a salt/,
  );
});

test('scram message parsing keeps values containing "="', () => {
  const parsed = parseScramMessage('r=abc,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096');
  assert.equal(parsed.s, 'W22ZaJ0SNY7soEsUEjb6gQ==');
  assert.equal(parsed.i, '4096');
});

test('xorBuffers refuses a length mismatch instead of truncating', () => {
  assert.throws(() => xorBuffers(Buffer.alloc(4), Buffer.alloc(5)), /length mismatch/);
});

test('int8 outside the safe integer range is returned as a string, not a rounded number', () => {
  // 9007199254740993 is Number.MAX_SAFE_INTEGER + 2. As a Number it becomes ...992.
  const big = '9007199254740993';
  assert.equal(decodeValue(Buffer.from(big), OID.INT8), big);
  assert.equal(decodeValue(Buffer.from('42'), OID.INT8), 42);
  assert.equal(typeof decodeValue(Buffer.from('42'), OID.INT8), 'number');
});

test('result decoding maps the types it claims to map', () => {
  assert.equal(decodeValue(Buffer.from('t'), OID.BOOL), true);
  assert.equal(decodeValue(Buffer.from('f'), OID.BOOL), false);
  assert.equal(decodeValue(Buffer.from('7'), OID.INT4), 7);
  assert.equal(decodeValue(Buffer.from('1.5'), OID.FLOAT8), 1.5);
  assert.deepEqual(decodeValue(Buffer.from('{"a":1}'), OID.JSONB), { a: 1 });
  assert.equal(decodeValue(null, OID.INT4), null);
  // numeric keeps full precision by staying a string
  assert.equal(decodeValue(Buffer.from('0.1000000000000000001'), 1700), '0.1000000000000000001');
  // an unknown OID stays a string rather than being guessed at
  assert.equal(decodeValue(Buffer.from('anything'), 999999), 'anything');
});

test('malformed json in a json column falls back to the raw text', () => {
  assert.equal(decodeValue(Buffer.from('{not json'), OID.JSON), '{not json');
});

test('parameter encoding covers every type the client accepts and rejects the rest', () => {
  assert.equal(encodeParameter(null), null);
  assert.equal(encodeParameter(undefined), null);
  assert.equal(encodeParameter(true), 't');
  assert.equal(encodeParameter(false), 'f');
  assert.equal(encodeParameter(42), '42');
  assert.equal(encodeParameter(10n), '10');
  assert.equal(encodeParameter('text'), 'text');
  assert.equal(encodeParameter(Buffer.from([0xde, 0xad])), '\\xdead');
  assert.equal(encodeParameter(new Date('2026-07-25T00:00:00.000Z')), '2026-07-25T00:00:00.000Z');
  assert.equal(encodeParameter({ a: 1 }), '{"a":1}');
  assert.throws(() => encodeParameter(Number.NaN), /non-finite/);
  assert.throws(() => encodeParameter(Symbol('x')), /unsupported parameter type/);
});

test('a connection requires a user, a database and somewhere to connect', () => {
  assert.throws(() => new PgConnection({ database: 'd', socketPath: '/x' }), /user is required/);
  assert.throws(() => new PgConnection({ user: 'u', socketPath: '/x' }), /database is required/);
  assert.throws(() => new PgConnection({ user: 'u', database: 'd' }), /socketPath or host is required/);
});

test('PostgresError carries the fields a caller needs to act on', () => {
  const error = new PostgresError({ severity: 'ERROR', code: '42501', message: 'permission denied' });
  assert.equal(error.code, '42501');
  assert.equal(error.severity, 'ERROR');
  assert.match(error.message, /permission denied/);
  assert.ok(error instanceof Error);
});

test('a connection to an unreachable socket fails rather than hanging', async () => {
  const connection = new PgConnection({
    socketPath: '/nonexistent/.s.PGSQL.5432',
    user: 'u', database: 'd', password: 'p', connectTimeoutMs: 2000,
  });
  await assert.rejects(() => connection.connect(), /ENOENT|timed out/);
});

test('the pool refuses to hand out connections once it is ending', async () => {
  const pool = new PgPool({ socketPath: '/nonexistent/.s.PGSQL.5432', user: 'u', database: 'd' });
  await pool.end();
  await assert.rejects(() => pool.connect(), /shutting down/);
});

/**
 * Start a throwaway backend on a unix socket and guarantee it is gone afterwards.
 *
 * Tracking the accepted sockets matters: net.Server#close waits for open connections, so
 * a fixture that only calls close() leaves the closing promise pending, the event loop
 * drains, and node:test reports "Promise resolution is still pending" — a fixture defect
 * that reads exactly like a product hang.
 */
async function withFakeBackend(onConnection, run) {
  const socketPath = `/tmp/noesar-pgtest-${crypto.randomBytes(6).toString('hex')}.sock`;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // The client destroys its end on a failed handshake, which arrives here as
    // ECONNRESET. An unhandled 'error' on a socket is a thrown exception.
    socket.on('error', () => {});
    onConnection(socket);
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    return await run(socketPath);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a server that demands md5 is refused rather than obliged', async () => {
  // A fake backend that answers the startup packet with AuthenticationMD5Password. The
  // client is only ever pointed at a cluster this product configured for SCRAM, so being
  // asked for md5 means the far end is not that cluster.
  await withFakeBackend((socket) => {
    socket.once('data', () => {
      // AuthenticationMD5Password: tag 'R', length 12 (itself + Int32 code + 4 salt
      // bytes), so the frame on the wire is 13 bytes. Getting this wrong is how the
      // first version of this fixture made the client wait for bytes that never came.
      const message = Buffer.alloc(13);
      message.writeUInt8(0x52, 0); // 'R'
      message.writeInt32BE(12, 1);
      message.writeInt32BE(5, 5); // AuthenticationMD5Password
      Buffer.from([1, 2, 3, 4]).copy(message, 9);
      socket.write(message);
    });
  }, async (socketPath) => {
    const connection = new PgConnection({
      socketPath, user: 'u', database: 'd', password: 'p', connectTimeoutMs: 3000,
    });
    await assert.rejects(
      () => connection.connect(),
      /weaker authentication method than SCRAM-SHA-256/,
    );
  });
});

test('a peer that accepts and then says nothing is timed out, not waited on forever', async () => {
  // The connect timeout only covers the TCP handshake. Without a separate deadline on
  // authentication, a wedged or wrong service on the socket path leaves the runtime
  // hanging at startup with no error and no log line.
  await withFakeBackend(() => { /* accept, then say nothing at all */ }, async (socketPath) => {
    const connection = new PgConnection({
      socketPath, user: 'u', database: 'd', password: 'p', connectTimeoutMs: 700,
    });
    const startedAt = Date.now();
    await assert.rejects(() => connection.connect(), /did not complete authentication/);
    assert.ok(Date.now() - startedAt < 5000, 'the timeout must actually fire');
  });
});

test('an ErrorResponse during the handshake is surfaced as a PostgresError', async () => {
  await withFakeBackend((socket) => {
    socket.once('data', () => {
      const fields = Buffer.concat([
        Buffer.from('SFATAL\0', 'utf8'),
        Buffer.from('C28000\0', 'utf8'),
        Buffer.from('Mrole "u" does not exist\0', 'utf8'),
        Buffer.from([0]),
      ]);
      const message = Buffer.alloc(5 + fields.length);
      message.writeUInt8(0x45, 0); // 'E'
      message.writeInt32BE(4 + fields.length, 1);
      fields.copy(message, 5);
      socket.write(message);
    });
  }, async (socketPath) => {
    const connection = new PgConnection({
      socketPath, user: 'u', database: 'd', password: 'p', connectTimeoutMs: 3000,
    });
    await assert.rejects(() => connection.connect(), (error) => {
      assert.ok(error instanceof PostgresError);
      assert.equal(error.code, '28000');
      assert.match(error.message, /does not exist/);
      return true;
    });
  });
});
