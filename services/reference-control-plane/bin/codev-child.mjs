#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-001, the `codev` peer: MASTER_PROJECT/03_ARCHITETTURA.md §1/§10 wants "un solo
// container OCI, un supervisore sottile come PID 1 e tre figli pari (postgres, api,
// codev)". This is that third child.
//
// What it deliberately does NOT contain: any part of the session protocol
// (services/reference-control-plane/src/session-protocol.mjs) — no dispatch, no auth, no
// WorkspaceActionOrchestrator. docs/CODEN_EVOLUTION_DESIGN_V1.md §17 draws one engine
// (owned exclusively by `api`, the only process that constructs those instances) reached
// by every shell, WebUI or terminal, through the SAME running dispatch. Constructing a
// second copy here — even a thin one — would give a real terminal a run history the
// WebUI cannot see, exactly the "second client with its own state" session-protocol.mjs's
// own header comment rejects.
//
// So `codev` carries no business logic at all: it is a byte-transparent relay between the
// externally-reachable socket real terminals connect to (NOESAR_TUI_SOCKET_PATH — the
// SAME path and bind mount `tools/tui-client.mjs` and the WebUI's runtime have always
// used, `/workspace/tui.sock`) and the internal-only socket `api` now listens on instead
// (NOESAR_CODEV_PEER_SOCKET_PATH, under /run — the tmpfs INST-004 restores: container-
// local, never bind-mounted, gone on restart). One relayed TCP-level connection per
// external client; the JSON-per-newline protocol itself is never parsed here, only piped.
//
// Why this still satisfies ARCH-001/ARCH-002 as a real OS-level peer, not decoration: if
// this process crashes, noesar-supervisord restarts IT ALONE (ARCH-002) — `api` and
// `postgres` are untouched, and existing terminal connections to `api`'s internal socket
// (opened through a now-dead relay) simply see their pipe close, the same failure mode any
// TCP hop between two peers has. If `api` is down, a NEW terminal connection fails fast
// with a clear error (see the connect-timeout below) instead of hanging silently.
//
// `createRelay()` is exported and guarded like server.mjs's own entrypoint check: a test
// importing this module gets a function to call with its own temp socket paths, not a
// socket file it did not ask for and would have to clean up.

import { createServer, connect } from 'node:net';
import { existsSync, unlinkSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function defaultLog(level, event, detail = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, component: 'codev-relay', ...detail });
  process.stdout.write(`${line}\n`);
}

/**
 * Starts the relay. Returns the listening `net.Server` — callers own its lifecycle
 * (`server.close()`), matching `startUnixSocketServer`'s own return convention in
 * session-protocol.mjs.
 */
export function createRelay({ externalSocketPath, internalSocketPath, connectTimeoutMs = 10000, log = defaultLog }) {
  if (existsSync(externalSocketPath)) unlinkSync(externalSocketPath);

  const server = createServer((external) => {
    // Nothing the client sends before the internal leg is up should be lost — the
    // protocol is server-speaks-first (a handshake line), so a real client will not send
    // anything this early, but pausing costs nothing and removes the assumption.
    external.pause();

    const internal = connect(internalSocketPath);
    const timer = setTimeout(() => {
      internal.destroy(new Error(`timed out connecting to ${internalSocketPath}`));
    }, connectTimeoutMs);

    internal.once('connect', () => {
      clearTimeout(timer);
      external.pipe(internal);
      internal.pipe(external);
      external.resume();
    });

    internal.once('error', (error) => {
      clearTimeout(timer);
      log('warn', 'relay.internal_unavailable', { message: error.message });
      // No handshake line was ever sent — closing with no data lets a correctly-written
      // client (tools/tui-client.mjs's connectSocket) tell "closed before any data
      // arrived" apart from "connected and working", rather than waiting forever for a
      // hello that will never come.
      external.destroy();
    });

    external.once('error', () => internal.destroy());
    external.once('close', () => internal.destroy());
    internal.once('close', () => external.destroy());
  });

  server.on('error', (error) => {
    log('error', 'relay.listen_failed', { message: error.message });
  });

  server.listen(externalSocketPath, () => {
    // 0600: the same single-uid posture session-protocol.mjs's own listener already
    // applied to this path before this phase moved the listener here.
    try { chmodSync(externalSocketPath, 0o600); } catch { /* best-effort on filesystems that ignore it */ }
    log('info', 'relay.listening', { externalSocketPath, internalSocketPath });
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workspace = process.env.NOESAR_WORKSPACE ?? '/workspace';
  const server = createRelay({
    externalSocketPath: process.env.NOESAR_TUI_SOCKET_PATH ?? `${workspace}/tui.sock`,
    internalSocketPath: process.env.NOESAR_CODEV_PEER_SOCKET_PATH ?? '/run/codev-peer.sock',
    connectTimeoutMs: Number(process.env.NOESAR_CODEV_CONNECT_TIMEOUT_MS ?? 10000),
  });
  // A failure to even bind the external socket (path unwritable, already held by a
  // process not cleaned up) is fatal for this peer's whole purpose — exit so
  // noesar-supervisord's restart-with-backoff applies, rather than staying up doing
  // nothing.
  server.on('error', () => process.exit(1));

  let stopping = false;
  function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    defaultLog('info', 'codev-child.signal', { signal });
    server.close(() => {
      defaultLog('info', 'codev-child.stopped', {});
      process.exit(0);
    });
    // server.close() only stops accepting NEW connections and waits for in-flight ones to
    // end on their own — bound that wait so a stuck relayed connection cannot block
    // container shutdown past the supervisor's own graceful-stop timeout.
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
