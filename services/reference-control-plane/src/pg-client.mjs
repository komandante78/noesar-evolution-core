// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A PostgreSQL frontend/backend protocol v3 client, written in-tree.
//
// Why in-tree rather than a dependency:
//
//   * The shipped image has zero third-party npm packages and the build is offline.
//     Adding `pg` would pull in seven transitive packages, put a network step into
//     the build, and move a security-relevant surface outside this repository's audit.
//   * The alternative — shelling out to `psql` for every statement — cannot express
//     the extended query protocol, so every value would have to be interpolated into
//     SQL text. This product runs Row Level Security off session GUCs supplied by the
//     caller. Interpolating those is exactly the injection surface RLS exists to close.
//
// Scope, stated so it is not mistaken for a general-purpose driver: unix-domain and
// TCP sockets, SCRAM-SHA-256 only, text result format, one in-flight statement per
// connection. Anything outside that raises rather than degrading.

import net from 'node:net';
import crypto from 'node:crypto';

const PROTOCOL_VERSION_3 = 196608;

// Backend message tags, spelled out because a bare character literal in a switch is
// unreadable six months later.
const BACKEND = Object.freeze({
  AUTHENTICATION: 0x52, // R
  BACKEND_KEY_DATA: 0x4b, // K
  BIND_COMPLETE: 0x32, // 2
  CLOSE_COMPLETE: 0x33, // 3
  COMMAND_COMPLETE: 0x43, // C
  DATA_ROW: 0x44, // D
  EMPTY_QUERY: 0x49, // I
  ERROR_RESPONSE: 0x45, // E
  NO_DATA: 0x6e, // n
  NOTICE_RESPONSE: 0x4e, // N
  NOTIFICATION: 0x41, // A
  PARAMETER_DESCRIPTION: 0x74, // t
  PARAMETER_STATUS: 0x53, // S
  PARSE_COMPLETE: 0x31, // 1
  PORTAL_SUSPENDED: 0x73, // s
  READY_FOR_QUERY: 0x5a, // Z
  ROW_DESCRIPTION: 0x54, // T
});

const AUTH = Object.freeze({
  OK: 0,
  CLEARTEXT_PASSWORD: 3,
  MD5_PASSWORD: 5,
  SASL: 10,
  SASL_CONTINUE: 11,
  SASL_FINAL: 12,
});

// Type OIDs whose text representation is decoded into a JavaScript value. Everything
// not listed stays a string, which is the only lossless default: a driver that guesses
// at a type it does not know is how a numeric silently becomes a rounded float.
const OID = Object.freeze({
  BOOL: 16,
  BYTEA: 17,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  OID: 26,
  JSON: 114,
  FLOAT4: 700,
  FLOAT8: 701,
  JSONB: 3802,
});

export class PostgresError extends Error {
  constructor(fields) {
    super(fields.message ?? 'PostgreSQL error');
    this.name = 'PostgresError';
    this.severity = fields.severity ?? null;
    this.code = fields.code ?? null;
    this.detail = fields.detail ?? null;
    this.hint = fields.hint ?? null;
    this.position = fields.position ?? null;
    this.schema = fields.schema ?? null;
    this.table = fields.table ?? null;
    this.column = fields.column ?? null;
    this.constraint = fields.constraint ?? null;
    this.routine = fields.routine ?? null;
  }
}

function decodeValue(raw, dataTypeId) {
  if (raw === null) return null;
  const text = raw.toString('utf8');
  switch (dataTypeId) {
    case OID.BOOL:
      return text === 't';
    case OID.INT2:
    case OID.INT4:
    case OID.OID:
      return Number.parseInt(text, 10);
    case OID.INT8: {
      // int8 exceeds Number.MAX_SAFE_INTEGER. Returning a silently rounded Number for
      // a bigint id is a correctness bug that only shows up on large installations.
      const asBigInt = BigInt(text);
      return (asBigInt >= BigInt(Number.MIN_SAFE_INTEGER)
        && asBigInt <= BigInt(Number.MAX_SAFE_INTEGER))
        ? Number(asBigInt)
        : text;
    }
    case OID.FLOAT4:
    case OID.FLOAT8:
      return Number.parseFloat(text);
    case OID.JSON:
    case OID.JSONB:
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    case OID.BYTEA:
      return text.startsWith('\\x')
        ? Buffer.from(text.slice(2), 'hex')
        : Buffer.from(text, 'utf8');
    default:
      return text;
  }
}

function encodeParameter(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('a non-finite number cannot be a SQL parameter');
    }
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  throw new TypeError(`unsupported parameter type: ${typeof value}`);
}

class MessageWriter {
  constructor(tag) {
    this.tag = tag;
    this.chunks = [];
    this.length = 0;
  }

  push(buffer) {
    this.chunks.push(buffer);
    this.length += buffer.length;
    return this;
  }

  int16(value) {
    const b = Buffer.allocUnsafe(2);
    b.writeInt16BE(value, 0);
    return this.push(b);
  }

  int32(value) {
    const b = Buffer.allocUnsafe(4);
    b.writeInt32BE(value, 0);
    return this.push(b);
  }

  cstring(value) {
    return this.push(Buffer.concat([
      Buffer.from(String(value), 'utf8'),
      Buffer.from([0]),
    ]));
  }

  bytes(buffer) {
    return this.push(buffer);
  }

  finish() {
    const header = this.tag === null
      ? Buffer.allocUnsafe(4)
      : Buffer.allocUnsafe(5);
    let offset = 0;
    if (this.tag !== null) {
      header.writeUInt8(this.tag, 0);
      offset = 1;
    }
    header.writeInt32BE(this.length + 4, offset);
    return Buffer.concat([header, ...this.chunks]);
  }
}

function readCString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (end === -1) throw new Error('malformed backend message: unterminated string');
  return { value: buffer.toString('utf8', offset, end), offset: end + 1 };
}

function parseErrorFields(payload) {
  const fields = {};
  let offset = 0;
  while (offset < payload.length) {
    const code = payload[offset];
    if (code === 0) break;
    offset += 1;
    const read = readCString(payload, offset);
    offset = read.offset;
    switch (String.fromCharCode(code)) {
      case 'S': fields.severity = read.value; break;
      case 'C': fields.code = read.value; break;
      case 'M': fields.message = read.value; break;
      case 'D': fields.detail = read.value; break;
      case 'H': fields.hint = read.value; break;
      case 'P': fields.position = read.value; break;
      case 's': fields.schema = read.value; break;
      case 't': fields.table = read.value; break;
      case 'c': fields.column = read.value; break;
      case 'n': fields.constraint = read.value; break;
      case 'R': fields.routine = read.value; break;
      default: break;
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// SCRAM-SHA-256 (RFC 5802 / RFC 7677)
// ---------------------------------------------------------------------------

function scramClientFirst(nonce) {
  return { gs2Header: 'n,,', bare: `n=,r=${nonce}` };
}

function parseScramMessage(text) {
  const out = {};
  for (const part of text.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

function xorBuffers(a, b) {
  if (a.length !== b.length) throw new Error('SCRAM: buffer length mismatch');
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

function scramProof({ password, serverFirst, clientFirstBare, gs2Header }) {
  const attrs = parseScramMessage(serverFirst);
  const combinedNonce = attrs.r;
  const salt = Buffer.from(attrs.s ?? '', 'base64');
  const iterations = Number.parseInt(attrs.i ?? '0', 10);

  if (!combinedNonce) throw new Error('SCRAM: server did not send a nonce');
  if (salt.length === 0) throw new Error('SCRAM: server did not send a salt');
  if (!Number.isInteger(iterations) || iterations < 4096) {
    // RFC 7677 sets 4096 as the floor. A server asking for fewer is either broken or
    // trying to make an offline attack on the stored key cheaper.
    throw new Error(`SCRAM: refusing an iteration count below 4096 (got ${iterations})`);
  }

  const saltedPassword = crypto.pbkdf2Sync(
    Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256',
  );
  const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const clientFinalWithoutProof = `c=${Buffer.from(gs2Header, 'utf8').toString('base64')},r=${combinedNonce}`;
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
  const clientSignature = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
  const clientProof = xorBuffers(clientKey, clientSignature);
  const serverKey = crypto.createHmac('sha256', saltedPassword).update('Server Key').digest();
  const serverSignature = crypto.createHmac('sha256', serverKey).update(authMessage).digest();

  return {
    combinedNonce,
    clientFinal: `${clientFinalWithoutProof},p=${clientProof.toString('base64')}`,
    serverSignature,
  };
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export class PgConnection {
  constructor(options = {}) {
    if (!options.user) throw new TypeError('user is required');
    if (!options.database) throw new TypeError('database is required');
    if (!options.socketPath && !options.host) {
      throw new TypeError('socketPath or host is required');
    }
    this.options = {
      user: String(options.user),
      database: String(options.database),
      password: options.password == null ? null : String(options.password),
      socketPath: options.socketPath ?? null,
      host: options.host ?? null,
      port: options.port ?? 5432,
      applicationName: options.applicationName ?? 'noesar-control-plane',
      connectTimeoutMs: options.connectTimeoutMs ?? 10000,
      statementTimeoutMs: options.statementTimeoutMs ?? 30000,
    };
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.parameters = new Map();
    this.processId = null;
    this.secretKey = null;
    this.transactionStatus = null;
    this.connected = false;
    this.closed = false;
    // A single queue: one statement in flight at a time. The protocol allows
    // pipelining; this client deliberately does not, because out-of-order completion
    // and RLS session GUCs are a combination that fails quietly when it fails.
    this.pending = null;
    this.destroyError = null;
  }

  async connect() {
    if (this.connected) return this;
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.removeListener('error', onError);
        this.socket.removeListener('connect', onConnect);
      };

      this.socket = this.options.socketPath
        ? net.connect({ path: this.options.socketPath })
        : net.connect({ host: this.options.host, port: this.options.port });
      this.socket.setNoDelay(true);
      const timer = setTimeout(() => {
        onError(new Error(`connection timed out after ${this.options.connectTimeoutMs} ms`));
        this.socket.destroy();
      }, this.options.connectTimeoutMs);
      this.socket.once('error', onError);
      this.socket.once('connect', onConnect);
    });

    this.socket.on('data', (chunk) => this.#onData(chunk));
    this.socket.on('error', (error) => this.#fail(error));
    this.socket.on('close', () => {
      this.#fail(this.destroyError ?? new Error('connection closed by the server'));
    });

    await this.#handshake();
    this.connected = true;
    if (this.options.statementTimeoutMs > 0) {
      await this.query(
        `SET statement_timeout = ${Number.parseInt(String(this.options.statementTimeoutMs), 10)}`,
      );
    }
    return this;
  }

  #fail(error) {
    this.closed = true;
    this.connected = false;
    const pending = this.pending;
    this.pending = null;
    if (pending) pending.reject(error);
  }

  #send(buffer) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('cannot write to a closed PostgreSQL connection');
    }
    this.socket.write(buffer);
  }

  #onData(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    // Backend messages are tag(1) + length(4, inclusive of itself) + payload.
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (length < 4) {
        this.#fail(new Error('malformed backend message: length below minimum'));
        return;
      }
      const total = length + 1;
      if (this.buffer.length < total) return;
      const tag = this.buffer[0];
      const payload = this.buffer.subarray(5, total);
      this.buffer = this.buffer.subarray(total);
      try {
        this.#dispatch(tag, payload);
      } catch (error) {
        this.#fail(error);
        return;
      }
    }
  }

  #dispatch(tag, payload) {
    const handler = this.pending?.onMessage;
    switch (tag) {
      case BACKEND.PARAMETER_STATUS: {
        const key = readCString(payload, 0);
        const value = readCString(payload, key.offset);
        this.parameters.set(key.value, value.value);
        return;
      }
      case BACKEND.BACKEND_KEY_DATA:
        this.processId = payload.readInt32BE(0);
        this.secretKey = payload.readInt32BE(4);
        return;
      case BACKEND.NOTICE_RESPONSE:
      case BACKEND.NOTIFICATION:
        return;
      case BACKEND.READY_FOR_QUERY:
        this.transactionStatus = String.fromCharCode(payload[0]);
        break;
      default:
        break;
    }
    if (handler) handler(tag, payload);
  }

  async #handshake() {
    const startup = new MessageWriter(null);
    startup.int32(PROTOCOL_VERSION_3);
    startup.cstring('user').cstring(this.options.user);
    startup.cstring('database').cstring(this.options.database);
    startup.cstring('application_name').cstring(this.options.applicationName);
    startup.cstring('client_encoding').cstring('UTF8');
    startup.push(Buffer.from([0]));

    await new Promise((resolve, reject) => {
      const nonce = crypto.randomBytes(24).toString('base64');
      const { gs2Header, bare } = scramClientFirst(nonce);
      let expectedServerSignature = null;

      // The connect timeout covers only the TCP handshake. A peer that accepts the
      // connection and then says nothing — a half-open socket, a wrong service on the
      // path, a server wedged before it can authenticate — would otherwise leave this
      // promise pending forever, and with it the runtime's startup.
      const deadline = setTimeout(() => {
        this.pending = null;
        this.socket?.destroy();
        reject(new Error(
          `the server accepted the connection but did not complete authentication within ${this.options.connectTimeoutMs} ms`,
        ));
      }, this.options.connectTimeoutMs);
      const settle = (fn) => (value) => { clearTimeout(deadline); fn(value); };
      const resolveOnce = settle(resolve);
      // A handshake that fails must also close the socket. Leaving it open leaks a file
      // descriptor per failed attempt and, on the far side, holds the server's
      // connection slot until something else times it out.
      const rejectOnce = settle((error) => {
        this.closed = true;
        this.socket?.destroy();
        reject(error);
      });

      this.pending = {
        reject: rejectOnce,
        onMessage: (tag, payload) => {
          try {
            if (tag === BACKEND.ERROR_RESPONSE) {
              throw new PostgresError(parseErrorFields(payload));
            }
            if (tag === BACKEND.READY_FOR_QUERY) {
              this.pending = null;
              resolveOnce();
              return;
            }
            if (tag !== BACKEND.AUTHENTICATION) return;

            const code = payload.readInt32BE(0);
            if (code === AUTH.OK) return;
            if (code === AUTH.CLEARTEXT_PASSWORD || code === AUTH.MD5_PASSWORD) {
              // Refusing rather than complying: this client is only ever pointed at a
              // cluster this product configured, and that cluster is configured for
              // scram-sha-256. Being asked for md5 means the far end is not it.
              throw new Error(
                'refusing a weaker authentication method than SCRAM-SHA-256',
              );
            }
            if (code === AUTH.SASL) {
              const mechanisms = [];
              let offset = 4;
              for (;;) {
                const read = readCString(payload, offset);
                offset = read.offset;
                if (read.value === '') break;
                mechanisms.push(read.value);
              }
              if (!mechanisms.includes('SCRAM-SHA-256')) {
                throw new Error(
                  `server offered no SCRAM-SHA-256 mechanism (offered: ${mechanisms.join(', ') || 'none'})`,
                );
              }
              if (this.options.password == null) {
                throw new Error('the server requires a password and none was supplied');
              }
              const initial = Buffer.from(`${gs2Header}${bare}`, 'utf8');
              const message = new MessageWriter(0x70); // p
              message.cstring('SCRAM-SHA-256');
              message.int32(initial.length);
              message.bytes(initial);
              this.#send(message.finish());
              return;
            }
            if (code === AUTH.SASL_CONTINUE) {
              const serverFirst = payload.toString('utf8', 4);
              const proof = scramProof({
                password: this.options.password,
                serverFirst,
                clientFirstBare: bare,
                gs2Header,
              });
              if (!proof.combinedNonce.startsWith(nonce)) {
                throw new Error('SCRAM: the server nonce does not extend the client nonce');
              }
              expectedServerSignature = proof.serverSignature;
              const message = new MessageWriter(0x70); // p
              message.bytes(Buffer.from(proof.clientFinal, 'utf8'));
              this.#send(message.finish());
              return;
            }
            if (code === AUTH.SASL_FINAL) {
              const attrs = parseScramMessage(payload.toString('utf8', 4));
              const received = Buffer.from(attrs.v ?? '', 'base64');
              if (expectedServerSignature === null
                || received.length !== expectedServerSignature.length
                || !crypto.timingSafeEqual(received, expectedServerSignature)) {
                // Mutual authentication is the half of SCRAM that a client is free to
                // skip and must not: without it the client has proved itself to an
                // unauthenticated peer.
                throw new Error('SCRAM: server signature verification failed');
              }
              return;
            }
            throw new Error(`unsupported authentication request: ${code}`);
          } catch (error) {
            this.pending = null;
            rejectOnce(error);
          }
        },
      };
      this.#send(startup.finish());
    });
  }

  async query(text, params = []) {
    if (this.closed) throw new Error('this PostgreSQL connection is closed');
    if (this.pending) throw new Error('a statement is already in flight on this connection');
    if (typeof text !== 'string' || text.length === 0) {
      throw new TypeError('query text must be a non-empty string');
    }
    if (!Array.isArray(params)) throw new TypeError('params must be an array');

    return params.length === 0 && !/\$\d/.test(text)
      ? this.#simpleQuery(text)
      : this.#extendedQuery(text, params);
  }

  // The simple query protocol is the only one that accepts several statements in one
  // round trip, which is what a migration file is. It cannot carry parameters, so it is
  // used only when the caller supplied none and the text contains no placeholder.
  #simpleQuery(text) {
    return new Promise((resolve, reject) => {
      const results = [];
      let fields = [];
      let rows = [];
      let command = null;
      let failure = null;

      const message = new MessageWriter(0x51); // Q
      message.cstring(text);

      this.pending = {
        reject,
        onMessage: (tag, payload) => {
          switch (tag) {
            case BACKEND.ROW_DESCRIPTION:
              fields = this.#readRowDescription(payload);
              rows = [];
              return;
            case BACKEND.DATA_ROW:
              rows.push(this.#readDataRow(payload, fields));
              return;
            case BACKEND.COMMAND_COMPLETE: {
              command = readCString(payload, 0).value;
              results.push({ command, fields, rows, rowCount: rows.length });
              fields = [];
              rows = [];
              return;
            }
            case BACKEND.EMPTY_QUERY:
              results.push({ command: null, fields: [], rows: [], rowCount: 0 });
              return;
            case BACKEND.ERROR_RESPONSE:
              failure = new PostgresError(parseErrorFields(payload));
              return;
            case BACKEND.READY_FOR_QUERY: {
              this.pending = null;
              if (failure) { reject(failure); return; }
              resolve(results.length === 1
                ? results[0]
                : { command: null, fields: [], rows: [], rowCount: 0, results });
              return;
            }
            default:
          }
        },
      };
      this.#send(message.finish());
    });
  }

  #extendedQuery(text, params) {
    return new Promise((resolve, reject) => {
      let fields = [];
      const rows = [];
      let command = null;
      let failure = null;

      const parse = new MessageWriter(0x50); // P
      parse.cstring('').cstring(text).int16(0);

      const bind = new MessageWriter(0x42); // B
      bind.cstring('').cstring('');
      bind.int16(0); // all parameters in text format
      bind.int16(params.length);
      for (const param of params) {
        const encoded = encodeParameter(param);
        if (encoded === null) {
          bind.int32(-1);
        } else {
          const bytes = Buffer.from(encoded, 'utf8');
          bind.int32(bytes.length).bytes(bytes);
        }
      }
      bind.int16(0); // all results in text format

      const describe = new MessageWriter(0x44); // D
      describe.push(Buffer.from('P', 'ascii')).cstring('');

      const execute = new MessageWriter(0x45); // E
      execute.cstring('').int32(0);

      const sync = new MessageWriter(0x53); // S

      this.pending = {
        reject,
        onMessage: (tag, payload) => {
          switch (tag) {
            case BACKEND.ROW_DESCRIPTION:
              fields = this.#readRowDescription(payload);
              return;
            case BACKEND.NO_DATA:
              fields = [];
              return;
            case BACKEND.DATA_ROW:
              rows.push(this.#readDataRow(payload, fields));
              return;
            case BACKEND.COMMAND_COMPLETE:
              command = readCString(payload, 0).value;
              return;
            case BACKEND.ERROR_RESPONSE:
              failure = new PostgresError(parseErrorFields(payload));
              return;
            case BACKEND.READY_FOR_QUERY:
              this.pending = null;
              if (failure) { reject(failure); return; }
              resolve({ command, fields, rows, rowCount: rows.length });
              return;
            default:
          }
        },
      };

      this.#send(Buffer.concat([
        parse.finish(), bind.finish(), describe.finish(), execute.finish(), sync.finish(),
      ]));
    });
  }

  #readRowDescription(payload) {
    const count = payload.readInt16BE(0);
    let offset = 2;
    const fields = [];
    for (let i = 0; i < count; i += 1) {
      const name = readCString(payload, offset);
      offset = name.offset;
      const tableId = payload.readInt32BE(offset);
      const columnId = payload.readInt16BE(offset + 4);
      const dataTypeId = payload.readInt32BE(offset + 6);
      offset += 18;
      fields.push({ name: name.value, tableId, columnId, dataTypeId });
    }
    return fields;
  }

  #readDataRow(payload, fields) {
    const count = payload.readInt16BE(0);
    let offset = 2;
    const row = {};
    for (let i = 0; i < count; i += 1) {
      const length = payload.readInt32BE(offset);
      offset += 4;
      const field = fields[i];
      const name = field?.name ?? `column${i}`;
      if (length === -1) {
        row[name] = null;
      } else {
        row[name] = decodeValue(payload.subarray(offset, offset + length), field?.dataTypeId ?? 0);
        offset += length;
      }
    }
    return row;
  }

  async end() {
    if (this.closed || !this.socket) {
      this.closed = true;
      return;
    }
    this.closed = true;
    try {
      const terminate = new MessageWriter(0x58); // X
      this.#send(terminate.finish());
    } catch {
      // The socket may already be gone; Terminate is a courtesy, not a requirement.
    }
    await new Promise((resolve) => {
      this.socket.once('close', resolve);
      this.socket.end();
      setTimeout(resolve, 1000).unref?.();
    });
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

class PooledClient {
  constructor(pool, connection) {
    this.pool = pool;
    this.connection = connection;
    this.released = false;
    this.poisoned = false;
  }

  async query(text, params = []) {
    if (this.released) throw new Error('this client was already released to the pool');
    try {
      return await this.connection.query(text, params);
    } catch (error) {
      // A connection that failed mid-transaction cannot be handed to the next caller
      // with its transaction state unknown. Poison it and let the pool discard it.
      if (!(error instanceof PostgresError)) this.poisoned = true;
      throw error;
    }
  }

  release() {
    if (this.released) return;
    this.released = true;
    this.pool._release(this);
  }
}

export class PgPool {
  constructor(options = {}) {
    this.options = options;
    this.max = options.max ?? 8;
    this.idle = [];
    this.size = 0;
    this.waiting = [];
    this.ending = false;
  }

  async connect() {
    if (this.ending) throw new Error('the pool is shutting down');

    const reusable = this.idle.pop();
    if (reusable) {
      if (!reusable.closed) return new PooledClient(this, reusable);
      this.size -= 1;
    }

    if (this.size >= this.max) {
      const connection = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = this.waiting.findIndex((w) => w.resolve === resolve);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(new Error('timed out waiting for a pooled PostgreSQL connection'));
        }, this.options.acquireTimeoutMs ?? 15000);
        this.waiting.push({
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
      });
      return new PooledClient(this, connection);
    }

    this.size += 1;
    try {
      const connection = new PgConnection(this.options);
      await connection.connect();
      return new PooledClient(this, connection);
    } catch (error) {
      this.size -= 1;
      throw error;
    }
  }

  _release(client) {
    const { connection } = client;
    if (this.ending || client.poisoned || connection.closed
      || connection.transactionStatus === 'E') {
      this.size -= 1;
      connection.end().catch(() => {});
      // A waiter must not be left hanging because the connection being returned was
      // unusable; open a replacement for it instead.
      this.#serveNextWaiter();
      return;
    }
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter.resolve(connection);
      return;
    }
    this.idle.push(connection);
  }

  #serveNextWaiter() {
    const waiter = this.waiting.shift();
    if (!waiter) return;
    this.size += 1;
    const connection = new PgConnection(this.options);
    connection.connect()
      .then(() => waiter.resolve(connection))
      .catch((error) => { this.size -= 1; waiter.reject(error); });
  }

  async query(text, params = []) {
    const client = await this.connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }

  async end() {
    this.ending = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(new Error('the pool is shutting down'));
    }
    const connections = this.idle.splice(0);
    this.size -= connections.length;
    await Promise.all(connections.map((c) => c.end().catch(() => {})));
  }
}

export const PgInternals = Object.freeze({
  decodeValue,
  encodeParameter,
  parseScramMessage,
  scramProof,
  xorBuffers,
  MessageWriter,
  readCString,
  parseErrorFields,
  OID,
  BACKEND,
});
