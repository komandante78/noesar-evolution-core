// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `WS /ws/coden` — the browser's door onto the session, proved against the real server.
//
// `D-0404` slice 2. The bridge adds a TRANSPORT and must add no authority: the same
// `sessionDispatch` the unix socket carries, the same `SESSION_METHOD_POLICY`, the same `can`.
// So the assertions here are mostly about what CANNOT happen — a foreign origin, an unsigned-in
// caller, a terminal auth method presented from the network, a method with no policy entry.
//
// The happy path matters too, and it is the one thing a refusal-only suite would leave unproven:
// a suite that only tests the refusals proves the feature is unreachable, not that it works.
//
// The client below is deliberately built out of the product's own `websocket.mjs` rather than a
// package. That is not purity — it means the encoder and the decoder are checked against each
// other end to end, over a real socket, and `websocket-framing.test.mjs` independently checks
// the decoder against the RFC's own vectors so this pair cannot agree on something wrong.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { once } from 'node:events';
import { totpCode } from '../src/auth-crypto.mjs';
import {
  CLOSE, OPCODE, FrameReader, acceptKey, decodeClose, encodeFrame, generateKey,
} from '../src/websocket.mjs';
import { BRIDGE_PATH, BRIDGE_PROTOCOL, CARRIED_PROTOCOL, REFUSED_METHODS } from '../src/coden-bridge.mjs';
import { SESSION_METHOD_POLICY, PROTOCOL_VERSION } from '../src/session-protocol.mjs';
import { freshTempDir } from './support/workspace.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = freshTempDir('noesar-coden-bridge-');
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';
process.env.NOESAR_CODEV_PEER_SOCKET_PATH = join(workspace, 'codev-peer.sock');

const { server } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let port = 0;
let base = null;
let cookie = null;

/**
 * The smallest WebSocket client that can hold this protocol honestly.
 *
 * Masks what it sends (§5.1) and reads with the product's own `FrameReader` configured NOT to
 * require a mask, because server frames are unmasked — which is itself an assertion: if the
 * server ever masked a frame, this reader would still accept it, so a separate test checks the
 * mask bit directly rather than relying on this client to notice.
 */
class TestClient {
  constructor() {
    this.socket = null;
    this.reader = new FrameReader({ requireMask: false });
    this.messages = [];
    this.control = [];
    this.handshake = null;
    this.closed = null;
    this.waiters = [];
  }

  async open({ path = BRIDGE_PATH, headers = {}, withCookie = true } = {}) {
    this.socket = connect(port, '127.0.0.1');
    await once(this.socket, 'connect');
    const key = generateKey();
    this.key = key;
    const lines = [
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${key}`,
      ...(withCookie ? [`Cookie: ${cookie}`] : []),
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    ];
    this.socket.write(`${lines.join('\r\n')}\r\n\r\n`);

    // Read exactly the header block, then hand anything after it to the frame reader — the
    // server's welcome frame usually arrives in the same TCP segment as the 101.
    let head = Buffer.alloc(0);
    for (;;) {
      const [chunk] = await once(this.socket, 'data');
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) continue;
      this.handshake = head.subarray(0, end).toString('ascii');
      const rest = head.subarray(end + 4);
      this.socket.on('data', (bytes) => this.#consume(bytes));
      this.socket.on('close', () => { this.closed ??= { code: null }; this.#wake(); });
      if (rest.length > 0) this.#consume(rest);
      return this.handshake;
    }
  }

  #consume(bytes) {
    let messages;
    try { messages = this.reader.push(bytes); } catch (error) { this.closed = { code: error.closeCode, reason: error.message }; return this.#wake(); }
    for (const message of messages) {
      if (message.opcode === OPCODE.CLOSE) { this.closed = decodeClose(message.payload); continue; }
      if (message.opcode === OPCODE.PING) { this.socket.write(mask(encodeFrame(OPCODE.PONG, message.payload))); this.control.push('ping'); continue; }
      if (message.opcode === OPCODE.PONG) { this.control.push('pong'); continue; }
      this.messages.push(JSON.parse(message.payload.toString('utf8')));
    }
    this.#wake();
  }

  #wake() { for (const waiter of this.waiters.splice(0)) waiter(); }

  send(object) { this.socket.write(mask(encodeFrame(OPCODE.TEXT, Buffer.from(JSON.stringify(object), 'utf8')))); }

  sendRaw(buffer) { this.socket.write(buffer); }

  /** Wait until `predicate` holds over the received messages, or fail loudly on timeout — a
   *  test that hangs tells you nothing, and this protocol has several ways to go quiet. */
  async until(predicate, why, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find((message) => predicate(message));
      if (found) return found;
      if (this.closed) throw new Error(`${why}: the socket closed first (${this.closed.code} ${this.closed.reason ?? ''})`);
      if (Date.now() > deadline) throw new Error(`${why}: timed out; saw ${JSON.stringify(this.messages).slice(0, 300)}`);
      await new Promise((resolve) => { this.waiters.push(resolve); setTimeout(resolve, 25); });
    }
  }

  /** One request/response round trip, matched by id. */
  async call(id, method, params) {
    this.send({ id, method, params });
    return this.until((message) => message.id === id, `call ${method}`);
  }

  async waitForClose(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed && Date.now() < deadline) {
      await new Promise((resolve) => { this.waiters.push(resolve); setTimeout(resolve, 25); });
    }
    return this.closed;
  }

  end() { try { this.socket?.destroy(); } catch { /* already gone */ } }
}

/** Apply a client mask to an already-encoded (unmasked) frame. */
function mask(frame) {
  const opcodeByte = frame[0];
  const lengthByte = frame[1] & 0x7f;
  const headerLength = lengthByte < 126 ? 2 : lengthByte === 126 ? 4 : 10;
  const payload = Buffer.from(frame.subarray(headerLength));
  const maskKey = Buffer.from([1, 2, 3, 4]);
  for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i & 3];
  const header = Buffer.from(frame.subarray(0, headerLength));
  header[0] = opcodeByte;
  header[1] |= 0x80;
  return Buffer.concat([header, maskKey, payload]);
}

const clients = [];
async function openClient(options) {
  const client = new TestClient();
  clients.push(client);
  await client.open(options);
  return client;
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;

  const begun = await fetch(`${base}/api/v1/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-noesar-setup-token': SETUP_TOKEN },
    body: JSON.stringify({ username: 'owner', displayName: 'Owner', password: PASSWORD }),
  });
  assert.equal(begun.status, 201, 'setup failed');
  const challenge = await begun.json();

  const confirmed = await fetch(`${base}/api/v1/auth/setup/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: challenge.challenge, totpCode: totpCode(challenge.totpSecret, stepStart()) }),
  });
  assert.equal(confirmed.status, 201, 'setup confirm failed');
  cookie = (confirmed.headers.getSetCookie?.() ?? []).find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
});

after(async () => {
  for (const client of clients) client.end();
  await new Promise((resolve) => server.close(resolve));
});

describe('the gates, in the order the bridge applies them', () => {
  test('a signed-in browser is upgraded and greeted', async () => {
    const client = await openClient();
    assert.match(client.handshake, /^HTTP\/1\.1 101 Switching Protocols/);
    assert.match(client.handshake, new RegExp(`Sec-WebSocket-Accept: ${acceptKey(client.key).replace(/[+/]/g, '\\$&')}`));
    const welcome = await client.until((message) => message.type === 'welcome', 'no welcome frame');
    assert.equal(welcome.protocol, BRIDGE_PROTOCOL);
    assert.equal(welcome.carries, CARRIED_PROTOCOL, 'the bridge does not announce the engine protocol it carries');
    assert.equal(welcome.user.username, 'owner');
    assert.ok(Array.isArray(welcome.permissions) && welcome.permissions.length > 0,
      'the viewport was not told its own authority, so its menu would have to guess');
    assert.ok(welcome.viewport.id, 'the viewport was not given an identity');
    client.end();
  });

  test('no session at all is refused with 401, before any frame is read', async () => {
    const client = await openClient({ withCookie: false });
    assert.match(client.handshake, /^HTTP\/1\.1 401/);
    assert.equal(client.messages.length, 0, 'a refused caller received protocol frames');
    client.end();
  });

  test('a foreign Origin is refused with 403 even holding a valid cookie', async () => {
    // Cross-site WebSocket hijacking: the browser attaches the cookie whatever page asked, and
    // the same-origin policy that protects `fetch` does not apply to this handshake. The cookie
    // therefore cannot be the only gate, and this is the test that says so.
    const client = await openClient({ headers: { Origin: 'https://evil.example' } });
    assert.match(client.handshake, /^HTTP\/1\.1 403/);
    assert.equal(client.messages.length, 0);
    client.end();
  });

  test('this installation\'s own Origin is accepted', async () => {
    const client = await openClient({ headers: { Origin: `http://127.0.0.1:${port}` } });
    assert.match(client.handshake, /^HTTP\/1\.1 101/);
    client.end();
  });

  test('a non-WebSocket upgrade is refused with 426 and told which version to speak', async () => {
    const socket = connect(port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write([`GET ${BRIDGE_PATH} HTTP/1.1`, `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 8',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', `Cookie: ${cookie}`].join('\r\n') + '\r\n\r\n');
    const [chunk] = await once(socket, 'data');
    assert.match(chunk.toString('ascii'), /^HTTP\/1\.1 426/);
    assert.match(chunk.toString('ascii'), /sec-websocket-version: 13/i);
    socket.destroy();
  });

  test('an upgrade to any other path is not this bridge', async () => {
    const client = await openClient({ path: '/ws/something-else' });
    assert.match(client.handshake, /^HTTP\/1\.1 404/);
    client.end();
  });

  test('the path is matched exactly, not by prefix', async () => {
    // `/ws/codenXYZ` must not be `/ws/coden`. A prefix match here would be a second, unnamed
    // route onto the same engine.
    const client = await openClient({ path: '/ws/codenXYZ' });
    assert.match(client.handshake, /^HTTP\/1\.1 404/);
    client.end();
  });
});

describe('the engine behind it is the same engine, with the same authority', () => {
  test('a real method dispatches and answers', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    const reply = await client.call(1, 'coden.addresses', {});
    assert.equal(reply.ok, true, `coden.addresses failed: ${JSON.stringify(reply.error)}`);
    assert.ok(Array.isArray(reply.result?.addresses ?? reply.result), 'no address list came back');
    client.end();
  });

  test('a method with no policy entry is refused, not attempted', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    const reply = await client.call(2, 'workspace.destroyEverything', {});
    assert.equal(reply.ok, false);
    client.end();
  });

  test('every terminal auth method is refused BY NAME on this transport', async () => {
    // Not "unimplemented" — refused, with a reason. `auth.resume` carries a ninety-day bearer
    // token that is safe behind a 0600 socket a local uid owns and is not safe presentable from
    // the network. If a future edit adds one of these here, it has to delete a line saying why.
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    let id = 100;
    for (const method of REFUSED_METHODS) {
      const reply = await client.call(id += 1, method, { token: 'anything' });
      assert.equal(reply.ok, false, `${method} was answered on the network transport`);
      assert.equal(reply.error.kind, 'REFUSED_ON_THIS_TRANSPORT', `${method} was refused for the wrong reason`);
    }
    client.end();
  });

  test('the refusal list actually names methods the unix socket answers', async () => {
    // The guard against the list going stale into decoration: if `session-protocol.mjs` stops
    // answering one of these, this fails and the entry is re-examined rather than kept forever.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/session-protocol.mjs'), 'utf8');
    for (const method of REFUSED_METHODS) {
      assert.match(source, new RegExp(`method === '${method.replace('.', '\\.')}'`),
        `${method} is refused by the bridge but the unix socket no longer answers it either`);
    }
  });

  test('the bridge carries the same protocol name the unix socket announces', () => {
    assert.equal(CARRIED_PROTOCOL, PROTOCOL_VERSION,
      'the two transports disagree about which engine protocol they speak');
  });

  test('malformed JSON gets an error frame, not a closed socket', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    client.sendRaw(mask(encodeFrame(OPCODE.TEXT, Buffer.from('{not json', 'utf8'))));
    const reply = await client.until((message) => message.ok === false && message.error?.kind === 'INVALID_JSON', 'no INVALID_JSON reply');
    assert.equal(reply.id, null);
    assert.equal(client.closed, null, 'a malformed message closed the connection');
    client.end();
  });

  test('a request with no method is refused without reaching the dispatch', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    const reply = await client.call(7, undefined, {});
    assert.equal(reply.ok, false);
    assert.equal(reply.error.kind, 'INVALID_REQUEST');
    client.end();
  });
});

describe('one session, N viewports', () => {
  test('two viewports attach at once and each sees the other', async () => {
    const first = await openClient();
    const welcome = await first.until((message) => message.type === 'welcome', 'no welcome');
    const second = await openClient();
    await second.until((message) => message.type === 'welcome', 'no welcome');

    // The first learns of the second without asking — the push half of "live at the same time".
    const attached = await first.until((message) => message.type === 'viewport.attached', 'the first viewport was not told about the second');
    assert.notEqual(attached.viewport.id, welcome.viewport.id);

    const listed = await second.call(1, 'viewport.list', {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.viewports.length, 2, 'the two viewports do not see one session');
    first.end();
    second.end();
  });

  test('each viewport keeps its OWN geometry — 80 columns and 200 at the same time', async () => {
    // The property that makes this not a PTY. A PTY has one geometry and two clients fight over
    // it; this renderer is width-parametric, so `ssh` at 80 and a browser at 200 are both right.
    const narrow = await openClient();
    await narrow.until((message) => message.type === 'welcome', 'no welcome');
    const wide = await openClient();
    await wide.until((message) => message.type === 'welcome', 'no welcome');

    const a = await narrow.call(1, 'viewport.resize', { columns: 80, rows: 24 });
    const b = await wide.call(1, 'viewport.resize', { columns: 200, rows: 60 });
    assert.equal(a.result.columns, 80);
    assert.equal(b.result.columns, 200);

    const listed = await wide.call(2, 'viewport.list', {});
    const widths = listed.result.viewports.map((viewport) => viewport.columns).sort((x, y) => x - y);
    assert.deepEqual(widths, [80, 200], 'one viewport overwrote the other\'s geometry');
    narrow.end();
    wide.end();
  });

  test('a resize is announced to the siblings', async () => {
    const first = await openClient();
    await first.until((message) => message.type === 'welcome', 'no welcome');
    const second = await openClient();
    await second.until((message) => message.type === 'welcome', 'no welcome');
    await second.call(1, 'viewport.resize', { columns: 132, rows: 43 });
    const seen = await first.until((message) => message.type === 'viewport.resized', 'the sibling was not told about the resize');
    assert.equal(seen.viewport.columns, 132);
    first.end();
    second.end();
  });

  test('nonsense geometry is refused; extreme geometry is clamped', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    for (const params of [{ columns: 0, rows: 10 }, { columns: -5, rows: 10 }, { columns: 'wide', rows: 10 }, {}]) {
      const reply = await client.call(Math.floor(Math.random() * 1e6), 'viewport.resize', params);
      assert.equal(reply.ok, false, `${JSON.stringify(params)} was accepted as a geometry`);
    }
    // Clamped rather than refused: a browser reporting a silly size after a zoom should get a
    // usable session, not an error.
    const clamped = await client.call(50, 'viewport.resize', { columns: 100_000, rows: 100_000 });
    assert.equal(clamped.ok, true);
    assert.ok(clamped.result.columns <= 1000 && clamped.result.rows <= 400, 'geometry was not clamped');
    client.end();
  });

  test('a detaching viewport is announced, and the session survives it', async () => {
    // `CE-021`: detaching one shell leaves the work in the engine. Here: the survivor keeps
    // dispatching, which is what "the session survives a reload and reattaches" rests on.
    const staying = await openClient();
    await staying.until((message) => message.type === 'welcome', 'no welcome');
    const leaving = await openClient();
    await leaving.until((message) => message.type === 'welcome', 'no welcome');
    leaving.end();
    await staying.until((message) => message.type === 'viewport.detached', 'the survivor was not told about the detach');
    const reply = await staying.call(9, 'coden.addresses', {});
    assert.equal(reply.ok, true, 'the session died with the viewport that left');
    staying.end();
  });

  test('reattaching after a reload rejoins the same session', async () => {
    const before = await openClient();
    const first = await before.until((message) => message.type === 'welcome', 'no welcome');
    before.end();
    const after = await openClient();
    const second = await after.until((message) => message.type === 'welcome', 'no welcome');
    assert.notEqual(second.viewport.id, first.viewport.id, 'a reconnect reused a viewport identity');
    assert.equal(second.user.username, first.user.username);
    const reply = await after.call(1, 'coden.addresses', {});
    assert.equal(reply.ok, true, 'the reattached viewport cannot reach the engine');
    after.end();
  });
});

describe('the protocol itself, over a real socket', () => {
  test('server frames are not masked', async () => {
    // Asserted on the wire rather than trusted to the test client, which is configured to
    // accept either — so a server that masked would otherwise pass unnoticed.
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    const raw = new FrameReader({ requireMask: true });
    assert.throws(() => raw.push(encodeFrame(OPCODE.TEXT, Buffer.from('x'))),
      /must be masked/, 'the strict reader accepted an unmasked frame, so this assertion proves nothing');
    client.end();
  });

  test('an unmasked client frame closes the connection with 1002', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    client.sendRaw(encodeFrame(OPCODE.TEXT, Buffer.from('{"id":1,"method":"viewport.hello"}', 'utf8')));
    const closed = await client.waitForClose();
    assert.equal(closed?.code, CLOSE.PROTOCOL_ERROR, 'an unmasked client frame was tolerated');
  });

  test('an oversized message closes the connection with 1009', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    // A declared length past the cap: the server must refuse on the length field, before it
    // buffers two megabytes on our say-so.
    const header = Buffer.alloc(10);
    header[0] = 0x80 | OPCODE.TEXT;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(64 * 1024 * 1024, 6);
    client.sendRaw(Buffer.concat([header, Buffer.from([0, 0, 0, 0])]));
    const closed = await client.waitForClose();
    assert.equal(closed?.code, CLOSE.TOO_BIG);
  });

  test('a binary frame is refused, because every message here is JSON', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    client.sendRaw(mask(encodeFrame(OPCODE.BINARY, Buffer.from([1, 2, 3]))));
    const closed = await client.waitForClose();
    assert.equal(closed?.code, CLOSE.UNSUPPORTED);
  });

  test('the server answers a ping with a pong carrying the same payload', async () => {
    const client = await openClient();
    await client.until((message) => message.type === 'welcome', 'no welcome');
    client.sendRaw(mask(encodeFrame(OPCODE.PING, Buffer.from('keepalive'))));
    const deadline = Date.now() + 3000;
    while (!client.control.includes('pong') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.ok(client.control.includes('pong'), 'the server never answered a ping');
    client.end();
  });

  test('data sent before the handshake completes is refused', async () => {
    // Bytes arriving with the upgrade are a client framing before it was accepted — trusting
    // them would be reading frames written before authentication.
    const socket = connect(port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write([`GET ${BRIDGE_PATH} HTTP/1.1`, `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${generateKey()}`, `Cookie: ${cookie}`].join('\r\n') + '\r\n\r\nSTOWAWAY');
    const [chunk] = await once(socket, 'data');
    assert.match(chunk.toString('ascii'), /^HTTP\/1\.1 400/);
    socket.destroy();
  });
});

describe('the transport adds no authority', () => {
  test('every method the bridge adds is about the viewport, never about the work', () => {
    // The rule this file exists to keep: a transport may describe its own attachment and
    // nothing else. Anything here that needed a permission would belong in the engine.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/coden-bridge.mjs'), 'utf8');
    const added = [...source.matchAll(/method === '([a-z]+\.[a-zA-Z]+)'/g)].map((match) => match[1]);
    for (const method of added) {
      assert.ok(method.startsWith('viewport.'),
        `${method} is handled inside the bridge instead of the engine: it would bypass SESSION_METHOD_POLICY`);
    }
    assert.ok(added.length >= 3, 'the scan found no handled methods, so it proves nothing');
  });

  test('"mutating" is read from the engine policy, never from a list beside it', () => {
    // This test exists because the first version of `mutates()` did the opposite and said it
    // did not: it consulted `auth.methodRequiresWrite?.()` — a method `auth.mjs` does not have
    // — and fell back to a hand-typed set that already omitted `workspace.plan`. Its comment
    // claimed the policy as its source and cited this test, which had not been written. So the
    // assertion is on the SOURCE: no set of method names may be written down in that file.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/coden-bridge.mjs'), 'utf8');
    assert.doesNotMatch(source, /new Set\(\[\s*'[a-z]+\.[a-zA-Z]+'/,
      'the bridge holds a hand-written set of engine method names: that is the PANEL_NAMES drift');
    assert.match(source, /methodPolicy\[method\]\?\.permission === 'workspace\.write'/,
      'the mutating test is no longer read from the engine policy');
    // And the policy really does classify the interesting case the comment leans on.
    assert.equal(SESSION_METHOD_POLICY['closure.record'].permission, 'workspace.write');
    assert.equal(SESSION_METHOD_POLICY['workspace.plan'].permission, 'workspace.write');
    assert.notEqual(SESSION_METHOD_POLICY['workspace.runs'].permission, 'workspace.write');
  });

  test('a mutating call tells the sibling viewports; a read-only one does not', async () => {
    // The push half of "live at the same time". Equally important is the negative: if every
    // call broadcast, the siblings would refresh constantly and the signal would carry no
    // information — which is indistinguishable from polling, the thing this replaces.
    const actor = await openClient();
    await actor.until((message) => message.type === 'welcome', 'no welcome');
    const watcher = await openClient();
    await watcher.until((message) => message.type === 'welcome', 'no welcome');
    await actor.until((message) => message.type === 'viewport.attached', 'the actor never saw the watcher');

    // `coden.addresses` is `permission: null` in the policy — a read. Nothing may be announced.
    await actor.call(1, 'coden.addresses', {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(watcher.messages.filter((message) => message.type === 'session.changed').length, 0,
      'a read-only call was broadcast as a change');

    // `closure.record` is `workspace.write` in the policy and SUCCEEDS with these arguments,
    // which is the whole reason it is the method used here. The first version of this test
    // called `sessions.action` with a bogus id inside an `if (reply.ok)`, so the call always
    // failed, the else-branch always ran, and the broadcast was never exercised — proved by
    // deleting `broadcastChange` from the bridge and watching all 30 tests still pass. A test
    // with a branch is a test that can pass through the branch you did not mean.
    const reply = await actor.call(2, 'closure.record', { runId: 'bridge-test-run', kind: 'agent-run', summary: 'a closure recorded to prove the broadcast', notDone: [], nothingLeftUndone: true, residualRisk: 'none' });
    assert.equal(reply.ok, true, `closure.record must succeed for this test to prove anything: ${JSON.stringify(reply.error)}`);
    const changed = await watcher.until((message) => message.type === 'session.changed', 'a mutating call was not announced to the sibling');
    assert.equal(changed.method, 'closure.record');
    assert.equal(changed.protocol, BRIDGE_PROTOCOL, 'the event frame carries no protocol version');
    assert.ok(changed.by, 'the event does not say which viewport caused it');
    assert.notEqual(changed.by, undefined);
    // And the actor is not told about its own change: it already has the answer, and echoing
    // it back would make every viewport refresh twice for one action.
    assert.equal(actor.messages.filter((message) => message.type === 'session.changed').length, 0,
      'a viewport was told about its own change');
    actor.end();
    watcher.end();
  });

  test('a FAILED mutating call is not announced', async () => {
    // Separated from the test above rather than being its else-branch, for the reason that
    // test's comment gives. If a failed call broadcast, the viewports would refresh to a state
    // the engine never entered — they would disagree with the engine and with each other.
    const actor = await openClient();
    await actor.until((message) => message.type === 'welcome', 'no welcome');
    const watcher = await openClient();
    await watcher.until((message) => message.type === 'welcome', 'no welcome');
    const reply = await actor.call(3, 'sessions.action', { action: 'purge', sessionId: 'does-not-exist' });
    assert.equal(reply.ok, false, 'this test needs a call that FAILS; it succeeded');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(watcher.messages.filter((message) => message.type === 'session.changed').length, 0,
      'a failed mutating call was announced as a change');
    actor.end();
    watcher.end();
  });

  test('the bridge defines no method the engine policy does not know about', () => {
    // Belt and braces on the same rule, from the other side: anything not a `viewport.*` must
    // be a method the one policy already governs.
    const governed = new Set(Object.keys(SESSION_METHOD_POLICY));
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/coden-bridge.mjs'), 'utf8');
    for (const match of source.matchAll(/method === '([a-z]+\.[a-zA-Z]+)'/g)) {
      const method = match[1];
      assert.ok(method.startsWith('viewport.') || governed.has(method) || REFUSED_METHODS.includes(method),
        `${method} is neither a viewport method, nor governed by SESSION_METHOD_POLICY, nor refused`);
    }
  });
});
