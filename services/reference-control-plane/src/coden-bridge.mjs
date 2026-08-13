// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `WS /ws/coden` — the same session, reached from a browser.
//
// `D-0404` collapses CodeN Evolution into ONE surface: the TUI, rendered natively over `ssh`
// and in a browser by a terminal emulator. This file is the second door onto the engine. The
// first is `startUnixSocketServer()` in `session-protocol.mjs`, and the two share the thing
// that matters — `dispatch`, with the same `SESSION_METHOD_POLICY` and the same `can` check.
//
// **A transport is added here. Authority is not.** Every method still goes through the one
// dispatch, still asks the same `auth.hasPermission`, and no method exists on this transport
// that does not exist on the other. If this file ever needs a capability of its own, that is
// the signal that the engine is missing one — not that the bridge should grow it.
//
// # No PTY, and therefore no shell
//
// The design (§3) rejects `node-pty` for two reasons, and the second is the one that matters:
// a PTY is a general-purpose command surface, and behind a socket a browser can reach, it is
// an arbitrary-execution primitive one authorisation bug away from being used. There is no
// shell behind this socket. What crosses it is `{id, method, params}` against a fixed method
// table, exactly as on the unix socket. `workspace.plan` cannot become `rm -rf` however it is
// spelled, because nothing here can spell anything but a method name.
//
// # Why the authentication is different here, deliberately
//
// On the unix socket the FILESYSTEM answers "who may knock" — 0600, one uid — before the first
// byte. That is what makes `auth.resume` (a ninety-day terminal token) and `auth.attach` (a
// minted code) safe to answer there. Neither is answerable here, and the refusal is explicit
// below rather than implied by omission: a long-lived bearer token that can be presented from
// the network is a different object from one that can only be presented by a local uid, and
// this transport must never be the place that difference is discovered.
//
// The browser has already signed in. It arrives holding a session cookie, so the handshake
// authenticates and there is no login exchange on this socket at all. Three gates, in order,
// before a single frame is read: the Origin must be this installation, the caller's address
// must not be grinding, and the cookie must resolve to a live session.
//
// # One session, N viewports
//
// A PTY has one geometry and two clients fight over it. This product's renderer is pure and
// width-parametric (`tui-screen.mjs`), so rendering happens in each client at that client's
// own size: `ssh` at 80 columns and a browser at 200, at the same time, from one engine
// session. The registry below is therefore small on purpose — it holds who is attached and how
// big they are, and nothing about how anything looks.
//
// What it does own is the part that makes "live at the same time" true rather than claimed: a
// mutating call in one viewport broadcasts `session.changed` to its siblings. Without that, N
// viewports means N pollers that disagree for as long as their timers are out of phase.

import { randomUUID } from 'node:crypto';
import {
  CLOSE, OPCODE, FrameReader, WebSocketProtocolError,
  decodeClose, encodeClose, encodeFrame, handshakeResponse, refusalResponse, upgradeRefusal,
} from './websocket.mjs';
// The engine's own method table. Imported rather than mirrored: see `mutates()`.
import { SESSION_METHOD_POLICY } from './session-protocol.mjs';

/** The route. One path, matched exactly — a prefix match would make `/ws/codenXYZ` this too. */
export const BRIDGE_PATH = '/ws/coden';

/** Bumped when a client would have to change. The frame envelope carries it so a viewport can
 *  refuse a server it does not understand instead of misreading one, which is the extension
 *  point `D-0404` means by "a versioned frame/event contract" — the L5 readiness, present as a
 *  seam rather than as a second implementation nothing asks for yet. */
export const BRIDGE_PROTOCOL = 'noesar-coden-bridge/1';

/** The engine protocol this bridge carries, unchanged from the unix socket. Announced so the
 *  two transports can be compared by a test rather than by reading both files. */
export const CARRIED_PROTOCOL = 'noesar-tui/1';

/** Methods that exist on the unix socket and are REFUSED here. Not "unimplemented" — refused,
 *  by name, with a reason, so that a future edit adding one has to delete a line that says why
 *  it must not. See the header: these are safe behind a 0600 socket and not from a network. */
export const REFUSED_METHODS = Object.freeze([
  'auth.login', 'auth.mfa', 'auth.attach', 'auth.resume', 'auth.remember', 'auth.forget',
]);

/** Methods this transport adds. They are about the VIEWPORT — the client's own attachment —
 *  and never about the work, which is why they are not engine methods and carry no permission:
 *  a caller that reached here has already proven a session, and resizing one's own window is
 *  not an authority. */
const VIEWPORT_METHODS = Object.freeze(['viewport.hello', 'viewport.resize', 'viewport.list']);

const DEFAULTS = Object.freeze({
  maxMessageBytes: 1024 * 1024,
  heartbeatMs: 30_000,
  idleTimeoutMs: 120_000,
  maxViewportsPerUser: 8,
  handshakeBudget: 20,
  handshakeWindowMs: 60_000,
  maxColumns: 1000,
  maxRows: 400,
});

/**
 * A fixed-window failure budget, per address.
 *
 * Modelled on the four already in `auth.mjs` rather than invented: same shape, same 429. It
 * counts REFUSED handshakes, not successful ones — rate-limiting a signed-in user's legitimate
 * reconnects would turn a flaky network into a lockout, while an unauthenticated grinder is
 * exactly what a budget should stop.
 */
class HandshakeBudget {
  constructor({ budget, windowMs }) {
    this.budget = budget;
    this.windowMs = windowMs;
    this.byAddress = new Map();
  }

  /** True when this address has already spent its budget. */
  exhausted(address, now) {
    const entries = (this.byAddress.get(address) ?? []).filter((at) => now - at < this.windowMs);
    if (entries.length === 0) this.byAddress.delete(address); else this.byAddress.set(address, entries);
    return entries.length >= this.budget;
  }

  spend(address, now) {
    const entries = (this.byAddress.get(address) ?? []).filter((at) => now - at < this.windowMs);
    entries.push(now);
    this.byAddress.set(address, entries);
  }
}

/**
 * One attached client.
 *
 * `geometry` is what the client told us it has, clamped. It is carried so the OTHER shells can
 * see it (`viewport.list`) — a person on `ssh` should be able to tell that a browser is looking
 * at the same session — and for nothing else. This process never renders.
 */
class Viewport {
  constructor({ id, socket, userId, sessionId, label, remoteAddress }) {
    this.id = id;
    this.socket = socket;
    this.userId = userId;
    this.sessionId = sessionId;
    this.label = label;
    this.remoteAddress = remoteAddress;
    this.columns = 80;
    this.rows = 24;
    this.attachedAt = Date.now();
    this.lastSeen = Date.now();
    this.awaitingPong = false;
    this.closed = false;
  }

  describe() {
    return {
      id: this.id, label: this.label, columns: this.columns, rows: this.rows,
      attachedAt: new Date(this.attachedAt).toISOString(),
    };
  }

  send(frame) {
    if (this.closed) return;
    try { this.socket.write(encodeFrame(OPCODE.TEXT, Buffer.from(JSON.stringify(frame), 'utf8'))); } catch {
      // A client that went away mid-write is not a server fault, and is already being torn
      // down by the socket's own error/close handlers.
    }
  }

  close(code, reason) {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.write(encodeClose(code, reason)); } catch { /* already gone */ }
    // `end()` rather than `destroy()`: the close frame must reach the peer, and destroying the
    // socket in the same tick discards it. The socket's own timeout is the backstop.
    try { this.socket.end(); } catch { /* already gone */ }
  }
}

/**
 * The bridge.
 *
 * `resolveAuthenticated` and `expectedOrigin` are injected rather than imported: `server.mjs`
 * owns both — the first because a session can arrive as a cookie or a service token, the second
 * because behind a reverse proxy only the request knows its own scheme. Passing them keeps this
 * file testable without a cookie jar and keeps the two definitions from drifting into three.
 */
export function createCodenBridge({
  dispatch, auth, ledger, logger = null, resolveAuthenticated, expectedOrigin,
  options = {}, methodPolicy = SESSION_METHOD_POLICY,
}) {
  const config = { ...DEFAULTS, ...options };
  const budget = new HandshakeBudget({ budget: config.handshakeBudget, windowMs: config.handshakeWindowMs });
  /** @type {Map<string, Set<Viewport>>} userId -> its attached viewports. */
  const byUser = new Map();
  let heartbeat = null;

  const note = (level, message, detail) => { try { logger?.[level]?.(message, detail); } catch { /* logging must never break the socket */ } };

  function register(viewport) {
    if (!byUser.has(viewport.userId)) byUser.set(viewport.userId, new Set());
    byUser.get(viewport.userId).add(viewport);
  }

  function unregister(viewport) {
    const set = byUser.get(viewport.userId);
    if (!set) return;
    set.delete(viewport);
    if (set.size === 0) byUser.delete(viewport.userId);
  }

  function siblings(viewport) {
    return [...(byUser.get(viewport.userId) ?? [])].filter((other) => other !== viewport && !other.closed);
  }

  /** Tell the other viewports of the same account that the session moved under them.
   *
   *  Scoped to one user on purpose. Broadcasting a change to every attached client would leak
   *  the fact that another account is working, and the engine is per-actor anyway. */
  function broadcastChange(viewport, method) {
    const frame = { protocol: BRIDGE_PROTOCOL, type: 'session.changed', method, by: viewport.id,
      at: new Date().toISOString() };
    for (const other of siblings(viewport)) other.send(frame);
  }

  /**
   * Handle an upgrade. Returns true when this bridge owned the request — including when it
   * refused it — so the caller can fall through to its own 404 for anything else.
   */
  function handleUpgrade(req, socket, head) {
    const path = String(req.url ?? '').split('?')[0];
    if (path !== BRIDGE_PATH) return false;

    // Anything already buffered past the handshake is a client that started framing before it
    // was accepted. Nothing in this protocol permits it, and feeding it to the reader would be
    // trusting bytes that arrived before authentication.
    if (head && head.length > 0) return refuse(socket, 400, 'no data may precede the handshake');

    const address = socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    if (budget.exhausted(address, now)) {
      // Not spent again here: a client being told to slow down should not have its window
      // extended by being told, or a burst becomes a permanent lockout.
      return refuse(socket, 429, 'too many refused connections; try again later');
    }

    const malformed = upgradeRefusal(req);
    if (malformed) {
      budget.spend(address, now);
      // §4.4 requires the version header on a version refusal; harmless on the others.
      return refuse(socket, 426, malformed, { 'sec-websocket-version': '13' });
    }

    // Origin BEFORE the session. A cookie is sent by the browser whatever page asked, so the
    // cookie alone cannot distinguish this installation's own page from any other site that
    // opened a socket to it — that is precisely what cross-site WebSocket hijacking is, and
    // the same-origin policy that protects `fetch` does not apply to this handshake.
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== expectedOrigin(req)) {
      budget.spend(address, now);
      note('warn', 'coden bridge refused a foreign origin', { origin, address });
      return refuse(socket, 403, 'this socket only accepts connections from its own installation');
    }

    const authenticated = resolveAuthenticated(req);
    if (!authenticated?.user) {
      budget.spend(address, now);
      return refuse(socket, 401, 'sign in before attaching a viewport');
    }

    const existing = byUser.get(authenticated.user.id)?.size ?? 0;
    if (existing >= config.maxViewportsPerUser) {
      budget.spend(address, now);
      return refuse(socket, 429, `at most ${config.maxViewportsPerUser} viewports may be attached at once`);
    }

    socket.setNoDelay(true);
    // The socket outlives every request timeout the HTTP server applies; a long-lived
    // connection that inherits a 2-minute request timeout is closed mid-session for no reason.
    socket.setTimeout(0);
    socket.write(handshakeResponse(req.headers['sec-websocket-key']));

    const viewport = new Viewport({
      id: randomUUID(),
      socket,
      userId: authenticated.user.id,
      sessionId: authenticated.session?.id ?? null,
      label: labelFor(req),
      remoteAddress: address,
    });
    register(viewport);
    attach(viewport, authenticated);
    return true;
  }

  function attach(viewport, authenticated) {
    const reader = new FrameReader({ maxMessageBytes: config.maxMessageBytes });

    // The greeting mirrors the unix socket's `{protocol}` line, and adds what only this
    // transport can know: which viewport you are, and who else is already here. A client that
    // reconnects after a reload reads its siblings from this and needs no extra round trip.
    viewport.send({
      protocol: BRIDGE_PROTOCOL,
      carries: CARRIED_PROTOCOL,
      type: 'welcome',
      viewport: viewport.describe(),
      user: authenticated.user,
      permissions: auth.permissionsFor(authenticated.user.role),
      siblings: siblings(viewport).map((other) => other.describe()),
    });
    ledger.append({
      actor: viewport.userId, action: 'coden.viewport-attached', result: 'success',
      details: { transport: 'websocket', viewport: viewport.id },
    });
    for (const other of siblings(viewport)) {
      other.send({ protocol: BRIDGE_PROTOCOL, type: 'viewport.attached', viewport: viewport.describe() });
    }

    const fail = (code, reason) => {
      note('warn', 'coden bridge closed a viewport', { viewport: viewport.id, code, reason });
      teardown(code, reason);
    };

    let teardownDone = false;
    function teardown(code, reason) {
      if (teardownDone) return;
      teardownDone = true;
      unregister(viewport);
      viewport.close(code, reason);
      for (const other of siblings(viewport)) {
        other.send({ protocol: BRIDGE_PROTOCOL, type: 'viewport.detached', viewport: viewport.id });
      }
      ledger.append({
        actor: viewport.userId, action: 'coden.viewport-detached', result: 'success',
        details: { transport: 'websocket', viewport: viewport.id, code },
      });
    }

    viewport.socket.on('data', async (chunk) => {
      viewport.lastSeen = Date.now();
      let messages;
      try {
        messages = reader.push(chunk);
      } catch (error) {
        const code = error instanceof WebSocketProtocolError ? error.closeCode : CLOSE.PROTOCOL_ERROR;
        return fail(code, error.message);
      }
      for (const message of messages) {
        if (viewport.closed) return;
        if (message.opcode === OPCODE.CLOSE) {
          let code = CLOSE.NORMAL;
          try { ({ code } = decodeClose(message.payload)); } catch (error) {
            return fail(error.closeCode ?? CLOSE.PROTOCOL_ERROR, error.message);
          }
          return teardown(code, 'closing as requested');
        }
        if (message.opcode === OPCODE.PING) {
          try { viewport.socket.write(encodeFrame(OPCODE.PONG, message.payload)); } catch { /* gone */ }
          continue;
        }
        if (message.opcode === OPCODE.PONG) { viewport.awaitingPong = false; continue; }
        if (message.opcode === OPCODE.BINARY) {
          // Every message this protocol defines is JSON. Accepting binary "just in case" would
          // be accepting a shape with no reader, which is how a parser gets written later by
          // whoever first needs one, without the rules above.
          return fail(CLOSE.UNSUPPORTED, 'this bridge speaks JSON text frames only');
        }
        await handle(viewport, message.payload.toString('utf8'), authenticated, fail);
      }
    });

    viewport.socket.on('error', () => teardown(CLOSE.GOING_AWAY, 'socket error'));
    viewport.socket.on('close', () => teardown(CLOSE.GOING_AWAY, 'socket closed'));
  }

  async function handle(viewport, text, authenticated, fail) {
    let request;
    try { request = JSON.parse(text); } catch {
      return viewport.send({ protocol: BRIDGE_PROTOCOL, id: null, ok: false,
        error: { kind: 'INVALID_JSON', reason: 'each message must be one JSON object' } });
    }
    const { id = null, method, params } = request ?? {};
    const reply = (ok, payload) => viewport.send(ok
      ? { protocol: BRIDGE_PROTOCOL, id, ok: true, result: payload }
      : { protocol: BRIDGE_PROTOCOL, id, ok: false,
        error: { kind: payload.kind ?? payload.name ?? 'ERROR', reason: payload.message ?? String(payload) } });

    if (typeof method !== 'string' || method.length === 0) {
      return reply(false, { kind: 'INVALID_REQUEST', reason: '`method` is required' });
    }
    if (REFUSED_METHODS.includes(method)) {
      // Refused loudly. A silent "unknown method" would leave a client author guessing, and
      // would leave the next reader of this file unaware that the omission is a decision.
      return reply(false, { kind: 'REFUSED_ON_THIS_TRANSPORT',
        reason: `${method} is answerable only on the local terminal socket, never from the network` });
    }

    if (method === 'viewport.hello') {
      return reply(true, { viewport: viewport.describe(), siblings: siblings(viewport).map((other) => other.describe()) });
    }
    if (method === 'viewport.resize') {
      const columns = Math.trunc(Number(params?.columns));
      const rows = Math.trunc(Number(params?.rows));
      if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns < 1 || rows < 1) {
        return reply(false, { kind: 'INVALID_GEOMETRY', reason: 'columns and rows must be positive integers' });
      }
      // Clamped rather than refused: a browser reporting a silly size after a zoom should get a
      // usable session, not an error. Bounded because these numbers are echoed to other clients.
      viewport.columns = Math.min(columns, config.maxColumns);
      viewport.rows = Math.min(rows, config.maxRows);
      for (const other of siblings(viewport)) {
        other.send({ protocol: BRIDGE_PROTOCOL, type: 'viewport.resized', viewport: viewport.describe() });
      }
      return reply(true, viewport.describe());
    }
    if (method === 'viewport.list') {
      return reply(true, { viewports: [viewport, ...siblings(viewport)].map((each) => each.describe()) });
    }

    try {
      // The one engine door, with the same authority check the unix socket makes. `can` reads
      // the user object captured at handshake; a session revoked mid-connection is handled by
      // the sweep below rather than by trusting this closure to notice.
      const result = await dispatch(method, params, viewport.userId,
        (permission) => auth.hasPermission(authenticated.user, permission));
      reply(true, result);
      // After the reply, and only on success: a viewport must never learn about a change that
      // did not happen, and the caller must never wait on its siblings' sockets to get its own
      // answer.
      if (mutates(method)) broadcastChange(viewport, method);
    } catch (error) {
      if (error instanceof WebSocketProtocolError) return fail(error.closeCode, error.message);
      reply(false, error);
    }
  }

  /** A method that changes the session, and therefore concerns the other viewports.
   *
   *  Read from `SESSION_METHOD_POLICY` — the engine's own table — because a method requiring
   *  `workspace.write` is by definition one that changes something. `closure.record` is the case
   *  that proves the point: nothing about its name says "mutating", and the policy already knows
   *  that it is.
   *
   *  **This was written twice and the first version was wrong**, which is why it is spelled out
   *  here. It first read `auth.methodRequiresWrite?.(method) ?? WRITE_METHODS.has(method)` over a
   *  hand-typed set, with a comment claiming it derived from the policy and a second comment
   *  citing a test that kept it in step. `auth` has no such method, so the hand-typed set was
   *  what always ran; the set already omitted `workspace.plan`, which the policy gates on
   *  `workspace.write`; and the test did not exist. That is `PANEL_NAMES` again — a list only
   *  ever compared to itself — reintroduced by the file whose header argues against it. */
  function mutates(method) {
    return methodPolicy[method]?.permission === 'workspace.write';
  }

  /** Ping every attached viewport; drop the ones that stopped answering.
   *
   *  A half-open TCP connection is invisible to both ends — the peer is gone and nothing says
   *  so. Without this, a laptop that closed its lid holds a viewport slot until the OS gives
   *  up, which on some hosts is hours, and `maxViewportsPerUser` becomes a lockout. */
  function sweep() {
    const now = Date.now();
    for (const set of [...byUser.values()]) {
      for (const viewport of [...set]) {
        if (viewport.closed) { unregister(viewport); continue; }
        if (now - viewport.lastSeen > config.idleTimeoutMs) {
          unregister(viewport);
          viewport.close(CLOSE.GOING_AWAY, 'idle');
          continue;
        }
        if (viewport.awaitingPong) {
          unregister(viewport);
          viewport.close(CLOSE.GOING_AWAY, 'no response to heartbeat');
          continue;
        }
        viewport.awaitingPong = true;
        try { viewport.socket.write(encodeFrame(OPCODE.PING, Buffer.alloc(0))); } catch { /* the close handler will run */ }
      }
    }
  }

  function start() {
    if (heartbeat) return;
    heartbeat = setInterval(sweep, config.heartbeatMs);
    // Never hold the process open: a heartbeat is not a reason for the server not to exit.
    heartbeat.unref?.();
  }

  function stop() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    for (const set of [...byUser.values()]) {
      for (const viewport of [...set]) { unregister(viewport); viewport.close(CLOSE.GOING_AWAY, 'server stopping'); }
    }
  }

  return {
    handleUpgrade,
    start,
    stop,
    sweep,
    viewportsFor: (userId) => [...(byUser.get(userId) ?? [])].map((viewport) => viewport.describe()),
    attachedCount: () => [...byUser.values()].reduce((total, set) => total + set.size, 0),
    viewportMethods: VIEWPORT_METHODS,
  };
}

/** A refusal on a socket that has not been upgraded: still HTTP, so answer in HTTP and go. */
function refuse(socket, status, reason, extraHeaders) {
  try { socket.write(refusalResponse(status, reason, extraHeaders)); } catch { /* already gone */ }
  try { socket.destroy(); } catch { /* already gone */ }
  return true;
}

/** A human-readable name for the viewport, for the other shells' benefit. Deliberately coarse:
 *  the full user-agent is fingerprinting material to show another session, and the question a
 *  person actually has is "is that my browser or my terminal". */
function labelFor(req) {
  const agent = String(req.headers['user-agent'] ?? '');
  if (/edg\//i.test(agent)) return 'browser (Edge)';
  if (/chrome\//i.test(agent)) return 'browser (Chrome)';
  if (/firefox\//i.test(agent)) return 'browser (Firefox)';
  if (/safari\//i.test(agent)) return 'browser (Safari)';
  return agent ? 'browser' : 'viewport';
}
