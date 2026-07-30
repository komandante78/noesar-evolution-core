// SPDX-License-Identifier: AGPL-3.0-or-later
// ARCH-001: `codev` (bin/codev-child.mjs) is a byte-transparent relay, not a second
// dispatch — this file proves that against a real pair of unix sockets, not a mock. A fake
// "internal peer" stands in for `api`'s own session-protocol listener (already covered end
// to end by session-protocol.test.mjs) so this file only has to prove one thing:
// bytes written on one side of the relay arrive unmodified on the other, in both
// directions, and a missing internal peer fails fast instead of hanging.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { createRelay } from '../bin/codev-child.mjs';

let dir, externalSocketPath, internalSocketPath;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'noesar-codev-relay-'));
  externalSocketPath = join(dir, 'external.sock');
  internalSocketPath = join(dir, 'internal.sock');
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('codev relay — byte-transparent, not a second dispatch', () => {
  test('a handshake and a request/response round trip pass through unmodified in both directions', async () => {
    // Stands in for api's startUnixSocketServer: writes a handshake on connect, then
    // echoes back whatever line it receives, wrapped as a fake "response" — enough to
    // prove the relay does not touch payload bytes, without duplicating session-protocol
    // logic that session-protocol.test.mjs already exercises directly.
    const fakeInternalPeer = createServer((socket) => {
      socket.write(`${JSON.stringify({ protocol: 'noesar-tui/1' })}\n`);
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf('\n');
          if (line.trim()) {
            const request = JSON.parse(line);
            socket.write(`${JSON.stringify({ id: request.id, ok: true, result: { echoed: request.method } })}\n`);
          }
        }
      });
    });
    await new Promise((resolve) => fakeInternalPeer.listen(internalSocketPath, resolve));

    const relay = createRelay({ externalSocketPath, internalSocketPath, log: () => {} });
    if (!relay.listening) await new Promise((resolve) => relay.once('listening', resolve));

    const client = connect(externalSocketPath);
    try {
      const hello = await new Promise((resolve) => client.once('data', (chunk) => resolve(JSON.parse(chunk.toString('utf8').split('\n')[0]))));
      assert.equal(hello.protocol, 'noesar-tui/1', 'the handshake written by the FAKE INTERNAL peer must reach the external client untouched');

      const response = await new Promise((resolve) => {
        client.once('data', (chunk) => resolve(JSON.parse(chunk.toString('utf8').split('\n').find(Boolean))));
        client.write(`${JSON.stringify({ id: '1', method: 'status', params: {} })}\n`);
      });
      assert.equal(response.ok, true);
      assert.equal(response.result.echoed, 'status', 'the method name sent by the external client must reach the internal peer untouched');
    } finally {
      client.destroy();
      await new Promise((resolve) => relay.close(resolve));
      await new Promise((resolve) => fakeInternalPeer.close(resolve));
    }
  });

  test('a connection is accepted but closed with no data when the internal peer is unreachable, not left hanging', async () => {
    // No fake internal peer listening this time — internalSocketPath names a socket
    // nothing has bound.
    const unreachablePath = join(dir, 'nobody-listens-here.sock');
    const relay = createRelay({ externalSocketPath: join(dir, 'external2.sock'), internalSocketPath: unreachablePath, connectTimeoutMs: 500, log: () => {} });
    if (!relay.listening) await new Promise((resolve) => relay.once('listening', resolve));

    const client = connect(join(dir, 'external2.sock'));
    try {
      const closedWithNoData = await new Promise((resolve) => {
        let gotData = false;
        let timer;
        client.once('data', () => { gotData = true; });
        client.once('close', () => { clearTimeout(timer); resolve(!gotData); });
        timer = setTimeout(() => resolve(false), 3000); // fails the assertion below instead of hanging the test itself
      });
      assert.equal(closedWithNoData, true, 'an unreachable internal peer must close fast with no handshake, never hang the caller');
    } finally {
      client.destroy();
      await new Promise((resolve) => relay.close(resolve));
    }
  });

  test('the external socket file is created with 0600 permissions', async () => {
    const path = join(dir, 'external3.sock');
    const fakeInternalPeer = createServer(() => {});
    const internalPath = join(dir, 'internal3.sock');
    await new Promise((resolve) => fakeInternalPeer.listen(internalPath, resolve));
    // `server.listening` flips true synchronously for a unix socket, before the listen
    // callback (which does the chmod) has actually run — waiting on the flag races the
    // chmod. Waiting on the relay's own "it is now listening" log line does not, since that
    // line is logged from inside the same callback, after the chmod call.
    const listeningLogged = new Promise((resolve) => {
      const relay = createRelay({
        externalSocketPath: path, internalSocketPath: internalPath,
        log: (level, event, detail) => { if (event === 'relay.listening') resolve(relay); },
      });
    });
    const relay = await listeningLogged;

    try {
      const { statSync } = await import('node:fs');
      const mode = statSync(path).mode & 0o777;
      assert.equal(mode, 0o600);
    } finally {
      await new Promise((resolve) => relay.close(resolve));
      await new Promise((resolve) => fakeInternalPeer.close(resolve));
    }
  });
});
