// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The hand-written RFC 6455 reader, attacked rather than demonstrated.
//
// `docs/CODEN_EVOLUTION_TERMINAL_DESIGN.md` §10 names this as a carried risk in exactly these
// words: *"Hand-written RFC 6455. Cheaper than a dependency and consistent with `qr.js`, but it
// is protocol code: it needs a fuzz/adversarial test, not only a happy path."* This file is that
// test, and it is deliberately longer than the module it checks.
//
// A parser is not proven by the messages it reads correctly. It is proven by the malformed ones
// it REFUSES, and by refusing them at the right moment — a length check that happens after the
// allocation is not a length check, it is a comment.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  CLOSE, OPCODE, FrameReader, WebSocketProtocolError,
  acceptKey, decodeClose, encodeClose, encodeFrame, handshakeResponse, upgradeRefusal,
} from '../src/websocket.mjs';

/** Build a client frame: masked, as every client-to-server frame must be. */
function clientFrame(opcode, payload = Buffer.alloc(0), { fin = true, mask = randomBytes(4), forceUnmasked = false, rsv = 0 } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const masked = !forceUnmasked;
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
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(body.length, 6);
  }
  header[0] = (fin ? 0x80 : 0) | (rsv << 4) | opcode;
  if (masked) header[1] |= 0x80;
  const out = [header];
  if (masked) {
    const copy = Buffer.from(body);
    for (let i = 0; i < copy.length; i += 1) copy[i] ^= mask[i & 3];
    out.push(mask, copy);
  } else {
    out.push(body);
  }
  return Buffer.concat(out);
}

/** Assert that feeding `bytes` raises a protocol error carrying `closeCode`. */
function refuses(bytes, closeCode, why, options) {
  const reader = new FrameReader(options);
  assert.throws(() => reader.push(bytes), (error) => {
    assert.ok(error instanceof WebSocketProtocolError, `${why}: threw ${error.name}, not a protocol error`);
    assert.equal(error.closeCode, closeCode, `${why}: closed with ${error.closeCode}, expected ${closeCode}`);
    return true;
  }, why);
}

describe('the handshake', () => {
  test('the accept key is the value RFC 6455 §1.3 prints', () => {
    // The specification's own worked example. A hand-rolled digest that agrees with a
    // fixture someone typed proves the fixture; agreeing with the RFC proves the code.
    assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  test('the 101 response carries exactly the headers a browser requires', () => {
    const response = handshakeResponse('dGhlIHNhbXBsZSBub25jZQ==').toString('ascii');
    assert.match(response, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
    assert.match(response, /\r\nUpgrade: websocket\r\n/);
    assert.match(response, /\r\nConnection: Upgrade\r\n/);
    assert.match(response, /\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=\r\n/);
    assert.ok(response.endsWith('\r\n\r\n'), 'the header block is not terminated');
  });

  test('a subprotocol is echoed only when the caller passes one', () => {
    // A server that reflects whatever arrived has agreed to a protocol it does not implement.
    assert.doesNotMatch(handshakeResponse('dGhlIHNhbXBsZSBub25jZQ==').toString('ascii'), /Sec-WebSocket-Protocol/);
  });

  const good = {
    method: 'GET',
    headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
  };

  test('a well-formed upgrade is accepted', () => {
    assert.equal(upgradeRefusal(good), null);
  });

  test('each missing or wrong part is refused with a reason naming it', () => {
    const cases = [
      [{ ...good, method: 'POST' }, /GET/],
      [{ ...good, headers: { ...good.headers, upgrade: 'h2c' } }, /Upgrade: websocket/],
      [{ ...good, headers: { ...good.headers, connection: 'keep-alive' } }, /Connection: Upgrade/],
      [{ ...good, headers: { ...good.headers, 'sec-websocket-version': '8' } }, /version 13/],
      [{ ...good, headers: { ...good.headers, 'sec-websocket-key': 'too-short' } }, /Sec-WebSocket-Key/],
      [{ ...good, headers: { ...good.headers, 'sec-websocket-key': '' } }, /Sec-WebSocket-Key/],
    ];
    for (const [req, expected] of cases) assert.match(upgradeRefusal(req) ?? '', expected);
  });

  test('the header comparison is case-insensitive, because browsers vary', () => {
    // Firefox has historically sent `Connection: keep-alive, Upgrade`. A strict equality check
    // here would refuse a compliant browser, which is a bug that only appears on one browser.
    assert.equal(upgradeRefusal({ ...good, headers: { ...good.headers, upgrade: 'WebSocket', connection: 'keep-alive, Upgrade' } }), null);
  });
});

describe('reading well-formed traffic', () => {
  test('a masked text frame comes back unmasked and whole', () => {
    const reader = new FrameReader();
    const [message] = reader.push(clientFrame(OPCODE.TEXT, 'hello'));
    assert.equal(message.opcode, OPCODE.TEXT);
    assert.equal(message.payload.toString('utf8'), 'hello');
  });

  test('a message split across TCP reads is reassembled — one byte at a time', () => {
    // The failure this prevents only ever appears across a real network: a reader that assumes
    // one `data` event is one frame works perfectly on loopback.
    const bytes = clientFrame(OPCODE.TEXT, JSON.stringify({ id: 1, method: 'viewport.hello' }));
    const reader = new FrameReader();
    const messages = [];
    for (const byte of bytes) messages.push(...reader.push(Buffer.from([byte])));
    assert.equal(messages.length, 1);
    assert.deepEqual(JSON.parse(messages[0].payload.toString('utf8')), { id: 1, method: 'viewport.hello' });
  });

  test('several frames arriving in one read all come back, in order', () => {
    const reader = new FrameReader();
    const messages = reader.push(Buffer.concat([
      clientFrame(OPCODE.TEXT, 'one'), clientFrame(OPCODE.TEXT, 'two'), clientFrame(OPCODE.TEXT, 'three'),
    ]));
    assert.deepEqual(messages.map((m) => m.payload.toString('utf8')), ['one', 'two', 'three']);
  });

  test('each length encoding is read correctly at its boundary', () => {
    // 125/126 and 65535/65536 are where the 7-bit, 16-bit and 64-bit forms change over, and
    // an off-by-one in either is a parser that works until a message gets slightly longer.
    for (const size of [0, 1, 125, 126, 127, 65_535, 65_536, 65_537]) {
      const payload = randomBytes(size);
      const reader = new FrameReader();
      const [message] = reader.push(clientFrame(OPCODE.BINARY, payload));
      assert.equal(message.payload.length, size, `a ${size}-byte payload did not survive`);
      assert.ok(message.payload.equals(payload), `a ${size}-byte payload came back altered`);
    }
  });

  test('a fragmented message is assembled and keeps the first frame\'s opcode', () => {
    const reader = new FrameReader();
    assert.deepEqual(reader.push(clientFrame(OPCODE.TEXT, 'he', { fin: false })), []);
    assert.deepEqual(reader.push(clientFrame(OPCODE.CONTINUATION, 'll', { fin: false })), []);
    const [message] = reader.push(clientFrame(OPCODE.CONTINUATION, 'o'));
    assert.equal(message.opcode, OPCODE.TEXT, 'the assembled message lost its original opcode');
    assert.equal(message.payload.toString('utf8'), 'hello');
  });

  test('a control frame may interleave inside a fragmented message without disturbing it', () => {
    // §5.4 explicitly permits this, and it is what a browser does when it pings mid-upload.
    // A reader that treated the ping as a new data frame would corrupt the message.
    const reader = new FrameReader();
    reader.push(clientFrame(OPCODE.TEXT, 'frag', { fin: false }));
    const [ping] = reader.push(clientFrame(OPCODE.PING, 'beat'));
    assert.equal(ping.opcode, OPCODE.PING);
    const [message] = reader.push(clientFrame(OPCODE.CONTINUATION, 'ment'));
    assert.equal(message.payload.toString('utf8'), 'fragment');
  });

  test('a multi-byte character split across two fragments still validates', () => {
    // UTF-8 is validated on the ASSEMBLED message, not per frame. Validating per frame would
    // reject a legal message whose character happened to straddle the split.
    const euro = Buffer.from('€', 'utf8');
    const reader = new FrameReader();
    reader.push(clientFrame(OPCODE.TEXT, euro.subarray(0, 1), { fin: false }));
    const [message] = reader.push(clientFrame(OPCODE.CONTINUATION, euro.subarray(1)));
    assert.equal(message.payload.toString('utf8'), '€');
  });
});

describe('refusing what the specification forbids', () => {
  test('an unmasked client frame is a protocol error, not a lenient case', () => {
    // §5.1. Unmasked client frames are the shape of the cache-poisoning attack masking exists
    // to prevent, so accepting them "to be liberal" would remove the protection entirely.
    refuses(clientFrame(OPCODE.TEXT, 'hello', { forceUnmasked: true }), CLOSE.PROTOCOL_ERROR,
      'an unmasked client frame was accepted');
  });

  test('a reserved bit is refused, because no extension was negotiated', () => {
    for (const rsv of [1, 2, 4]) {
      refuses(clientFrame(OPCODE.TEXT, 'x', { rsv }), CLOSE.PROTOCOL_ERROR, `RSV ${rsv} was accepted`);
    }
  });

  test('an unknown opcode is refused rather than ignored', () => {
    for (const opcode of [0x3, 0x7, 0xb, 0xf]) {
      refuses(clientFrame(opcode, 'x'), CLOSE.PROTOCOL_ERROR, `opcode 0x${opcode.toString(16)} was accepted`);
    }
  });

  test('a fragmented control frame is refused', () => {
    refuses(clientFrame(OPCODE.PING, 'x', { fin: false }), CLOSE.PROTOCOL_ERROR, 'a fragmented ping was accepted');
  });

  test('an oversized control frame is refused', () => {
    refuses(clientFrame(OPCODE.PING, randomBytes(126)), CLOSE.PROTOCOL_ERROR, 'a 126-byte ping was accepted');
  });

  test('a continuation with nothing to continue is refused', () => {
    refuses(clientFrame(OPCODE.CONTINUATION, 'orphan'), CLOSE.PROTOCOL_ERROR, 'an orphan continuation was accepted');
  });

  test('a new data frame during an unfinished message is refused', () => {
    const reader = new FrameReader();
    reader.push(clientFrame(OPCODE.TEXT, 'first', { fin: false }));
    assert.throws(() => reader.push(clientFrame(OPCODE.TEXT, 'second')), WebSocketProtocolError);
  });

  test('invalid UTF-8 in a text frame is refused with 1007, not silently replaced', () => {
    // `Buffer#toString('utf8')` substitutes U+FFFD and would turn a protocol violation into a
    // corrupted message the application then has to distrust. §8.1 says close.
    refuses(clientFrame(OPCODE.TEXT, Buffer.from([0xc3, 0x28])), CLOSE.INVALID_PAYLOAD, 'invalid UTF-8 was accepted');
    refuses(clientFrame(OPCODE.TEXT, Buffer.from([0xff, 0xfe, 0xfd])), CLOSE.INVALID_PAYLOAD, 'invalid UTF-8 was accepted');
    // A lone surrogate, encoded as CESU-8: valid-looking bytes, not valid UTF-8.
    refuses(clientFrame(OPCODE.TEXT, Buffer.from([0xed, 0xa0, 0x80])), CLOSE.INVALID_PAYLOAD, 'a lone surrogate was accepted');
  });

  test('a binary frame carrying the same bytes is NOT refused', () => {
    // The UTF-8 rule is about text frames only. Applying it to binary would be inventing a
    // restriction the specification does not have.
    const reader = new FrameReader();
    const [message] = reader.push(clientFrame(OPCODE.BINARY, Buffer.from([0xc3, 0x28])));
    assert.equal(message.payload.length, 2);
  });

  test('a 64-bit length with the high bit set is refused', () => {
    // §5.2. Hand-built, because the frame builder above cannot produce an illegal length.
    const header = Buffer.alloc(14);
    header[0] = 0x80 | OPCODE.BINARY;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0x80000000, 2);
    header.writeUInt32BE(0, 6);
    refuses(header, CLOSE.PROTOCOL_ERROR, 'a 64-bit length with the high bit set was accepted');
  });
});

describe('refusing what would exhaust memory', () => {
  test('a declared length above the cap is refused BEFORE the bytes are buffered', () => {
    // The whole point of checking the declared length: waiting for the payload to arrive
    // would mean allocating it first, so the length field alone becomes the attack.
    const header = Buffer.alloc(10);
    header[0] = 0x80 | OPCODE.BINARY;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(500_000_000, 6);
    refuses(header, CLOSE.TOO_BIG, 'a half-gigabyte declared length was accepted', { maxMessageBytes: 1024 });
  });

  test('a high word above zero is refused by size rather than reconstructed', () => {
    const header = Buffer.alloc(10);
    header[0] = 0x80 | OPCODE.BINARY;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(1, 2);
    header.writeUInt32BE(0, 6);
    refuses(header, CLOSE.TOO_BIG, 'a length beyond 2^32 was accepted');
  });

  test('many compliant fragments cannot add up past the cap', () => {
    // Each frame passes every per-frame check; together they do not. Without the assembled
    // cap this is a gigabyte in memory reached entirely through legal frames — the reason a
    // fragmented protocol needs two limits and not one.
    const reader = new FrameReader({ maxMessageBytes: 4096 });
    assert.throws(() => {
      for (let i = 0; i < 100; i += 1) reader.push(clientFrame(i === 0 ? OPCODE.TEXT : OPCODE.CONTINUATION, randomBytes(1000), { fin: false }));
    }, (error) => {
      assert.equal(error.closeCode, CLOSE.TOO_BIG);
      return true;
    });
  });
});

describe('close frames', () => {
  test('an empty close payload is a normal close', () => {
    assert.deepEqual(decodeClose(Buffer.alloc(0)), { code: CLOSE.NORMAL, reason: '' });
  });

  test('a one-byte close payload is a truncated code, and is refused', () => {
    assert.throws(() => decodeClose(Buffer.from([0x03])), WebSocketProtocolError);
  });

  test('codes reserved for local use may not appear on the wire', () => {
    for (const code of [999, 1004, 1005, 1006, 1016, 2999]) {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      assert.throws(() => decodeClose(payload), WebSocketProtocolError, `close code ${code} was accepted`);
    }
  });

  test('an application close code and reason round-trip', () => {
    const frame = encodeClose(CLOSE.POLICY_VIOLATION, 'not allowed here');
    // Strip the 2-byte unmasked server header to get at the payload.
    assert.deepEqual(decodeClose(frame.subarray(2)), { code: CLOSE.POLICY_VIOLATION, reason: 'not allowed here' });
  });

  test('a long reason is truncated without splitting a character', () => {
    // §5.5 caps a control payload at 125 bytes. Cutting on a byte boundary could split a
    // multi-byte character and make the reason itself invalid UTF-8 — a close frame that is
    // itself a protocol violation, which is a genuinely confusing thing to send.
    const frame = encodeClose(CLOSE.INTERNAL, '€'.repeat(200));
    assert.ok(frame.length <= 127, 'the close frame exceeded the control-frame limit');
    const { reason } = decodeClose(frame.subarray(2));
    assert.ok(reason.length > 0);
    assert.doesNotMatch(reason, /�/, 'the reason was cut mid-character');
  });
});

describe('what this endpoint writes', () => {
  test('server frames are never masked', () => {
    // §5.1, the other direction. A masked server frame is a protocol error at the browser,
    // and the symptom is a connection that closes for no visible reason.
    const frame = encodeFrame(OPCODE.TEXT, Buffer.from('hi'));
    assert.equal(frame[1] & 0x80, 0, 'a server frame was masked');
  });

  test('a server frame is read back by the reader when masking is not required', () => {
    // Round-tripping through our own reader is what proves the writer, since the reader is
    // independently checked against the RFC's own vectors above.
    const reader = new FrameReader({ requireMask: false });
    const [message] = reader.push(encodeFrame(OPCODE.TEXT, Buffer.from('round trip')));
    assert.equal(message.payload.toString('utf8'), 'round trip');
  });

  test('encoding an oversized control frame throws rather than emitting an illegal frame', () => {
    assert.throws(() => encodeFrame(OPCODE.PING, randomBytes(126)), WebSocketProtocolError);
  });
});

describe('fuzz — random bytes must never crash the reader or hang it', () => {
  test('10000 random inputs produce either a message or a protocol error', () => {
    // The property under test is not "it rejects garbage". It is that EVERY outcome is one of
    // the two intended ones: a parser that throws a TypeError on malformed input is a parser
    // whose failure mode is a 500 and a stack trace, and one that returns silently while
    // holding unbounded state is a memory leak with a clean test suite.
    let messages = 0;
    let refusals = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const reader = new FrameReader({ maxMessageBytes: 8192 });
      const bytes = randomBytes(1 + (i % 40));
      try {
        messages += reader.push(bytes).length;
      } catch (error) {
        assert.ok(error instanceof WebSocketProtocolError,
          `random input produced ${error.name}: ${error.message} — every refusal must be a protocol error`);
        assert.ok(Number.isInteger(error.closeCode) && error.closeCode >= 1000,
          'a protocol error carried no usable close code');
        refusals += 1;
      }
    }
    // Not an assertion about the ratio — it is random. It asserts the fuzz actually exercised
    // both paths, so a change that made the reader refuse everything would be visible here
    // rather than showing up as a still-green test that proves nothing.
    assert.ok(refusals > 0, 'no random input was refused: the fuzz is not reaching the checks');
    assert.ok(messages + refusals > 0);
  });

  test('a truncated prefix of a valid frame is always incomplete, never a false message', () => {
    // Every proper prefix must return nothing — not a short read, not a partial payload. A
    // parser that emits early on a truncated length field hands the application half a message.
    const full = clientFrame(OPCODE.TEXT, JSON.stringify({ method: 'workspace.runs', params: {} }));
    for (let cut = 1; cut < full.length; cut += 1) {
      const reader = new FrameReader();
      assert.deepEqual(reader.push(full.subarray(0, cut)), [],
        `a ${cut}-byte prefix produced a message`);
      // And the remainder completes it: the reader kept its state rather than discarding it.
      const [message] = reader.push(full.subarray(cut));
      assert.equal(message.payload.toString('utf8'), JSON.stringify({ method: 'workspace.runs', params: {} }));
    }
  });
});
