// SPDX-License-Identifier: AGPL-3.0-or-later
//
// RFC 6455, written by hand — the product's first WebSocket, and still zero dependencies.
//
// # Why this exists rather than a package
//
// This product has no third-party runtime dependency and has never had one: every import is
// `node:*`, and even the QR encoder is hand-written (`qr.js`). `D-0404` needs a browser to hold
// a live connection to a session, and the two ways to get one are a dependency or this file.
// The design (`docs/CODEN_EVOLUTION_TERMINAL_DESIGN.md` §3, §10) chose this, with its own risk
// written down: protocol code earns adversarial tests, not a happy path. See
// `test/websocket-framing.test.mjs`, which is deliberately larger than this file.
//
// # What it is NOT
//
// Not a general WebSocket library. There is no client, no extension negotiation
// (`permessage-deflate` is not offered, so RSV must be zero and a frame that sets it is a
// protocol error rather than something to interpret), no subprotocol registry beyond an exact
// string match, and no auto-reconnect. Every one of those is a surface, and a surface nothing
// in this product needs is a surface that only an attacker has a use for.
//
// # The rules that are easy to get wrong, and are therefore stated here
//
//  - **Every client-to-server frame is masked** (§5.1). An unmasked one is not a lenient case
//    to accept; it is a protocol error, because unmasked client frames are the shape of a
//    cache-poisoning proxy attack the masking rule exists to prevent.
//  - **Server-to-client frames are never masked.** The same paragraph, the other direction.
//  - **Control frames (close, ping, pong) carry at most 125 bytes and are never fragmented**
//    (§5.5). They may arrive INTERLEAVED inside a fragmented data message, which is why the
//    assembler below keeps continuation state separate from the frame reader.
//  - **Text payloads must be valid UTF-8** (§8.1) — checked with a fatal `TextDecoder`, because
//    `Buffer#toString('utf8')` silently substitutes U+FFFD and would turn a protocol violation
//    into a corrupted message the application then has to distrust.
//  - **A 64-bit length with the high bit set is invalid** (§5.2), and any length above the cap
//    is refused before a byte of it is buffered — otherwise the length field alone is a
//    memory-exhaustion primitive against an authenticated but hostile client.

import { createHash, randomBytes } from 'node:crypto';

/** RFC 6455 §1.3. Fixed by the specification; not a secret and not configurable. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODE = Object.freeze({
  CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa,
});

/** RFC 6455 §7.4.1, plus 1009 for "message too big", which is the one this product will
 *  actually send in anger. 1005 and 1006 are deliberately absent: they are statuses the
 *  specification forbids putting on the wire. */
export const CLOSE = Object.freeze({
  NORMAL: 1000, GOING_AWAY: 1001, PROTOCOL_ERROR: 1002, UNSUPPORTED: 1003,
  INVALID_PAYLOAD: 1007, POLICY_VIOLATION: 1008, TOO_BIG: 1009, INTERNAL: 1011,
});

/** Default ceiling for one assembled message. Generous for a protocol whose largest frame is a
 *  JSON repository map, and small enough that a hostile client cannot make the process the
 *  place where the host runs out of memory. */
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

export class WebSocketProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WebSocketProtocolError';
    this.closeCode = code;
  }
}

/**
 * The `Sec-WebSocket-Accept` value for a key (RFC 6455 §4.2.2 step 5).
 *
 * SHA-1 here is not a security choice and is not ours to revisit: the specification fixes both
 * the algorithm and the GUID, and its purpose is to prove the server understood the handshake,
 * not to withstand collision search. Noted because a scanner will flag it and the dismissal
 * should be on the record rather than rediscovered every audit.
 */
export function acceptKey(key) {
  return createHash('sha1').update(`${key}${GUID}`).digest('base64');
}

/** RFC 6455 §4.1: 16 random bytes, base64. Used by the test client; the server never needs it. */
export function generateKey() {
  return randomBytes(16).toString('base64');
}

/**
 * Is this request a well-formed WebSocket upgrade? Returns a reason string when it is not, so
 * the caller can answer with something a human can debug, and `null` when it is.
 *
 * The version check is not ceremony: RFC 6455 §4.4 requires a 426 carrying
 * `Sec-WebSocket-Version` when it fails, and a client speaking an older draft that is allowed
 * to proceed will frame differently from what this file parses.
 */
export function upgradeRefusal(req) {
  const headers = req.headers ?? {};
  if (String(req.method ?? 'GET').toUpperCase() !== 'GET') return 'the upgrade must be a GET';
  if (!/\bwebsocket\b/i.test(String(headers.upgrade ?? ''))) return 'missing `Upgrade: websocket`';
  if (!/\bupgrade\b/i.test(String(headers.connection ?? ''))) return 'missing `Connection: Upgrade`';
  if (String(headers['sec-websocket-version'] ?? '') !== '13') return 'only WebSocket version 13 is supported';
  const key = String(headers['sec-websocket-key'] ?? '');
  // 16 bytes, base64-encoded, is always 24 characters ending in `==`. Checking the decoded
  // length rather than the string shape rejects padding tricks without rejecting valid keys.
  if (!key || Buffer.from(key, 'base64').length !== 16) return 'malformed `Sec-WebSocket-Key`';
  return null;
}

/** The 101 response, as raw bytes: at upgrade time there is no `ServerResponse` left to use. */
export function handshakeResponse(key, { subprotocol = null } = {}) {
  const lines = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
  ];
  // Only ever echoed when the caller has already checked it against what it offers. A server
  // that reflects whatever arrived has agreed to a protocol it does not implement.
  if (subprotocol) lines.push(`Sec-WebSocket-Protocol: ${subprotocol}`);
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'ascii');
}

/** A refusal, before the upgrade completes. Plain HTTP, because the connection is still HTTP. */
export function refusalResponse(status, reason, extraHeaders = {}) {
  const body = Buffer.from(`${reason}\n`, 'utf8');
  const headers = {
    connection: 'close',
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(body.length),
    ...extraHeaders,
  };
  const head = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n');
  return Buffer.concat([Buffer.from(`HTTP/1.1 ${status} ${statusText(status)}\r\n${head}\r\n\r\n`, 'ascii'), body]);
}

function statusText(status) {
  return { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    426: 'Upgrade Required', 429: 'Too Many Requests', 500: 'Internal Server Error' }[status] ?? 'Error';
}

/**
 * Encode one frame for sending. Server frames are never masked (§5.1).
 *
 * `payload` is a Buffer; the caller decides text or binary, because only the caller knows.
 */
export function encodeFrame(opcode, payload = Buffer.alloc(0), { fin = true } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  if (opcode >= 0x8 && body.length > 125) {
    throw new WebSocketProtocolError(CLOSE.INTERNAL, 'a control frame may not exceed 125 bytes');
  }
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = body.length;
  } else if (body.length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    // 64-bit length, high word zero: Node cannot hold a buffer near 2^32 anyway, and writing
    // the low word alone would be a silently truncated length on a huge payload.
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(body.length, 6);
  }
  header[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  return Buffer.concat([header, body]);
}

/** A close frame carrying a code and an optional reason (§5.5.1). */
export function encodeClose(code = CLOSE.NORMAL, reason = '') {
  const text = Buffer.from(String(reason), 'utf8');
  // §5.5: the whole control payload is capped at 125, and 2 of those are the code. Truncating
  // on a byte boundary would be able to split a multi-byte character and make the reason itself
  // invalid UTF-8 — a close frame that is a protocol violation, which is a genuinely confusing
  // thing to send. So the cut is made on CODE POINTS and measured in bytes after each one.
  //
  // Spread rather than `slice`: `String#slice` counts UTF-16 units, so it both splits surrogate
  // pairs and says nothing about encoded size. The first version of this line took 60
  // characters and produced 180 bytes on a reason made of `€`, which the control-frame limit
  // then rejected — caught by `websocket-framing.test.mjs`, not by reading.
  let capped = text;
  if (capped.length > 123) {
    const points = [...String(reason)];
    while (points.length > 0 && Buffer.byteLength(points.join(''), 'utf8') > 123) points.pop();
    capped = Buffer.from(points.join(''), 'utf8');
  }
  const payload = Buffer.alloc(2 + capped.length);
  payload.writeUInt16BE(code, 0);
  capped.copy(payload, 2);
  return encodeFrame(OPCODE.CLOSE, payload);
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * An incremental reader: feed it bytes, get whole messages out.
 *
 * Incremental because TCP has no message boundaries. A reader that assumed one `data` event
 * equals one frame would work on loopback and fail across a network under load — the class of
 * bug that only appears in production, which is why the tests feed it a byte at a time.
 */
export class FrameReader {
  constructor({ maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES, requireMask = true } = {}) {
    this.buffer = Buffer.alloc(0);
    this.maxMessageBytes = maxMessageBytes;
    this.requireMask = requireMask;
    this.fragments = [];
    this.fragmentOpcode = null;
    this.fragmentBytes = 0;
  }

  /** Consume bytes; return every complete message they finished, as `{opcode, payload}`.
   *  Throws `WebSocketProtocolError` on any violation — the caller closes with `closeCode`. */
  push(chunk) {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    const messages = [];
    for (;;) {
      const frame = this.#readFrame();
      if (!frame) return messages;
      const message = this.#assemble(frame);
      if (message) messages.push(message);
    }
  }

  /** One frame off the front of the buffer, or `null` when more bytes are needed. */
  #readFrame() {
    const buffer = this.buffer;
    if (buffer.length < 2) return null;
    const first = buffer[0];
    const second = buffer[1];
    const fin = (first & 0x80) !== 0;
    const rsv = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    // No extension was negotiated, so a reserved bit carries no meaning this endpoint could
    // honour. §5.2 makes that a failure rather than something to ignore.
    if (rsv !== 0) throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, 'reserved bits must be zero');
    if (![0x0, 0x1, 0x2, 0x8, 0x9, 0xa].includes(opcode)) {
      throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, `unknown opcode 0x${opcode.toString(16)}`);
    }
    const isControl = opcode >= 0x8;
    if (isControl && !fin) throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, 'a control frame may not be fragmented');
    if (isControl && length > 125) throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, 'a control frame may not exceed 125 bytes');
    if (this.requireMask && !masked) throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, 'client frames must be masked');

    if (length === 126) {
      if (buffer.length < offset + 2) return null;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length < offset + 8) return null;
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      // §5.2: the most significant bit of a 64-bit length MUST be 0. Beyond that, anything
      // with a non-zero high word is already past this cap, so it is refused by size rather
      // than reconstructed into a number JavaScript cannot hold precisely.
      if (high & 0x80000000) throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, 'the high bit of a 64-bit length must be zero');
      if (high !== 0) throw new WebSocketProtocolError(CLOSE.TOO_BIG, 'frame longer than this endpoint accepts');
      length = low;
      offset += 8;
    }

    // Checked against the DECLARED length, before buffering it. This is the whole point of
    // doing it here: waiting until the bytes arrive would mean allocating them first.
    if (length > this.maxMessageBytes) {
      throw new WebSocketProtocolError(CLOSE.TOO_BIG, `frame of ${length} bytes exceeds the ${this.maxMessageBytes}-byte limit`);
    }

    const maskLength = masked ? 4 : 0;
    if (buffer.length < offset + maskLength + length) return null;
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
    this.buffer = buffer.subarray(offset + length);
    return { fin, opcode, payload };
  }

  /** Continuation handling. Control frames pass straight through — they are allowed to
   *  interleave with a fragmented data message and must not disturb its state. */
  #assemble(frame) {
    if (frame.opcode >= 0x8) return { opcode: frame.opcode, payload: frame.payload };

    if (frame.opcode === OPCODE.CONTINUATION) {
      if (this.fragmentOpcode === null) throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, 'continuation frame with nothing to continue');
    } else if (this.fragmentOpcode !== null) {
      throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, 'a new data frame arrived while a message was still fragmented');
    } else if (!frame.fin) {
      this.fragmentOpcode = frame.opcode;
    }

    if (frame.fin && this.fragmentOpcode === null) return this.#finish(frame.opcode, frame.payload);

    this.fragments.push(frame.payload);
    this.fragmentBytes += frame.payload.length;
    // The cap applies to the ASSEMBLED message, not only to each frame: without this, a
    // thousand compliant 1 MB fragments would pass every per-frame check on the way to a
    // gigabyte in memory. That is the whole reason a fragmented protocol needs two limits.
    if (this.fragmentBytes > this.maxMessageBytes) {
      throw new WebSocketProtocolError(CLOSE.TOO_BIG, `message exceeds the ${this.maxMessageBytes}-byte limit`);
    }
    if (!frame.fin) return null;
    const opcode = this.fragmentOpcode;
    const payload = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.fragmentBytes = 0;
    return this.#finish(opcode, payload);
  }

  #finish(opcode, payload) {
    if (opcode === OPCODE.TEXT) {
      try { UTF8.decode(payload); } catch {
        throw new WebSocketProtocolError(CLOSE.INVALID_PAYLOAD, 'a text frame must be valid UTF-8');
      }
    }
    return { opcode, payload };
  }
}

/** Read a close frame's code and reason, defending against the two malformed shapes: a
 *  one-byte payload (a truncated code) and a reason that is not UTF-8. */
export function decodeClose(payload) {
  if (payload.length === 0) return { code: CLOSE.NORMAL, reason: '' };
  if (payload.length === 1) throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, 'a close payload of one byte is a truncated status code');
  const code = payload.readUInt16BE(0);
  // §7.4.1: these are reserved for local use and must never appear on the wire.
  if (code < 1000 || code === 1004 || code === 1005 || code === 1006 || (code >= 1016 && code <= 2999)) {
    throw new WebSocketProtocolError(CLOSE.PROTOCOL_ERROR, `close code ${code} may not be sent`);
  }
  let reason = '';
  try { reason = UTF8.decode(payload.subarray(2)); } catch {
    throw new WebSocketProtocolError(CLOSE.INVALID_PAYLOAD, 'a close reason must be valid UTF-8');
  }
  return { code, reason };
}
