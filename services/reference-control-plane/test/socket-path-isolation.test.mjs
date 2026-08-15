// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A unix socket path must never be taken from a process that is still using it — and no
// test run may ever bind the product's PRODUCTION socket path on the machine running it.
//
// Why this file exists, measured rather than imagined (s326): `npm test` was recreating
// /run/codev-peer.sock on the host every run — inode 588147 → 588957, birth time moving with
// each suite. Two suites spawn the real server.mjs as a child process, which makes
// `process.argv[1]` the server and therefore fires its entrypoint guard; they isolated
// workspace, port and token file into temp directories and left this one input on its
// production default. `startUnixSocketServer` then did `if (existsSync(p)) unlinkSync(p)` —
// delete first, ask never.
//
// On this host that was invisible: the product runs in a container whose /run is a private
// tmpfs, so the suite's socket and the product's socket were two different files that
// happened to share a name. The platform law is what makes it a real defect — NOESAR
// EVOLUTION must run on any machine, including a NATIVE install with no container, where
// /run/codev-peer.sock IS the running product's terminal transport. There, every `npm test`
// would have cut every attached terminal and left a dead file, with nothing logged.
//
// Two halves, and both are needed:
//   1. the INVARIANT — a live socket cannot be unlinked by anyone, ever. Behavioural, and
//      the half that holds even when a future caller forgets everything below.
//   2. the ISOLATION — no spawner may leave the socket path on its production default.
//      Source-derived, so a NEW spawner is caught the day it is written.
//
// The source half strips comments before it reads anything. This file's own prose contains
// the literal `NOESAR_CODEV_PEER_SOCKET_PATH` many times, and so do the fixed suites' new
// comments — a scanner that counted those would pass on the explanation of the bug while
// the bug itself returned. That is not hypothetical: s322 recorded three separate stumbles
// from guards reading comments as if they were code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { freshTempDir } from './support/workspace.mjs';

import {
  reclaimSocketPath, socketPathIsLive, startUnixSocketServer, ProtocolError,
} from '../src/session-protocol.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function tempDir() { return freshTempDir('noesar-sockguard-'); }

/** A listener that is genuinely accepting connections, closed by the returned handle. */
async function liveListener(socketPath) {
  const server = createServer((socket) => socket.end());
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(socketPath, res);
  });
  return { close: () => new Promise((res) => server.close(res)) };
}

/**
 * A genuinely STALE socket: a real listener whose process was killed, leaving the file.
 * Not simulated with a regular file — `net.Server#close()` unlinks the path, so the only
 * way to produce the real thing is to end the process without letting it clean up.
 */
async function staleSocketFrom(socketPath) {
  const child = spawn(process.execPath, ['-e', `
    const { createServer } = require('node:net');
    createServer(() => {}).listen(${JSON.stringify(socketPath)}, () => console.log('up'));
  `], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((res) => child.stdout.once('data', res));
  child.kill('SIGKILL');
  await new Promise((res) => child.once('exit', res));
  assert.equal(existsSync(socketPath), true, 'the killed child should have left its socket file behind');
}

describe('the invariant: a live socket is never stolen', () => {
  test('socketPathIsLive tells a live listener from a corpse', async () => {
    const dir = tempDir();
    const live = join(dir, 'live.sock');
    const stale = join(dir, 'stale.sock');

    const listener = await liveListener(live);
    assert.equal(await socketPathIsLive(live), true, 'a listening socket must read as live');
    await listener.close();

    await staleSocketFrom(stale);
    assert.equal(await socketPathIsLive(stale), false, 'a killed process leaves a corpse, not a live socket');
  });

  test('reclaimSocketPath REFUSES a live path and leaves it untouched', async () => {
    const dir = tempDir();
    const socketPath = join(dir, 'busy.sock');
    const listener = await liveListener(socketPath);
    try {
      await assert.rejects(
        () => reclaimSocketPath(socketPath),
        (error) => error instanceof ProtocolError && error.kind === 'SOCKET_PATH_IN_USE',
        'a live socket must be refused, not deleted',
      );
      // The refusal is only worth anything if the victim survived it.
      assert.equal(existsSync(socketPath), true, 'the live socket file must still exist after a refusal');
      assert.equal(await socketPathIsLive(socketPath), true, 'the live socket must still be serving after a refusal');
    } finally {
      await listener.close();
    }
  });

  test('reclaimSocketPath reclaims a stale path, and reports a free one', async () => {
    const dir = tempDir();
    const stale = join(dir, 'stale.sock');
    await staleSocketFrom(stale);
    assert.equal(await reclaimSocketPath(stale), 'reclaimed');
    assert.equal(existsSync(stale), false, 'a corpse must actually be cleared, or nothing can rebind');
    assert.equal(await reclaimSocketPath(join(dir, 'never-existed.sock')), 'free');
  });

  test('startUnixSocketServer refuses to start on a path a live peer owns', async () => {
    const dir = tempDir();
    const socketPath = join(dir, 'taken.sock');
    const listener = await liveListener(socketPath);
    try {
      await assert.rejects(
        () => startUnixSocketServer({
          socketPath,
          dispatch: async () => ({}),
          auth: { beginLogin: () => ({}), completeLogin: () => ({}), permissionsFor: () => [], hasPermission: () => true },
          ledger: { append: () => {} },
        }),
        (error) => error.kind === 'SOCKET_PATH_IN_USE',
      );
      assert.equal(await socketPathIsLive(socketPath), true, 'the incumbent must still be serving');
    } finally {
      await listener.close();
    }
  });

  test('a stale path is rebindable end to end — the refusal must not become a deadlock', async () => {
    const dir = tempDir();
    const socketPath = join(dir, 'recycled.sock');
    await staleSocketFrom(socketPath);
    const server = await startUnixSocketServer({
      socketPath,
      dispatch: async () => ({}),
      auth: { beginLogin: () => ({}), completeLogin: () => ({}), permissionsFor: () => [], hasPermission: () => true },
      ledger: { append: () => {} },
    });
    try {
      // The promise resolving must mean "accepting connections", not "on its way to it".
      const handshake = await new Promise((res, rej) => {
        const probe = connect(socketPath);
        probe.once('data', (chunk) => { probe.end(); res(chunk.toString()); });
        probe.once('error', rej);
      });
      assert.match(handshake, /noesar-tui/, 'a rebound socket must speak the protocol immediately');
    } finally {
      await new Promise((res) => server.close(res));
    }
  });
});

describe('the isolation: nothing binds the production socket path while testing', () => {
  // Comments are not code. Stripped before any of the assertions below look at a byte —
  // this file, and the two suites this phase fixed, all mention the variable in prose.
  function stripComments(source) {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n');
  }

  function sourceFiles() {
    const roots = [
      join(repoRoot, 'services/reference-control-plane/test'),
      join(repoRoot, 'services/reference-control-plane/bin'),
      join(repoRoot, 'tools'),
      join(repoRoot, 'tools/acceptance'),
    ];
    const files = [];
    for (const dir of roots) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.mjs') && !name.endsWith('.js')) continue;
        files.push(join(dir, name));
      }
    }
    return files;
  }

  /**
   * The argument text of every `spawn(...)` call in a source, by counting parentheses.
   *
   * Co-occurrence is not a call. The first version of this asked only "does the file
   * contain `spawn(` somewhere AND `server.mjs` somewhere", and immediately produced two
   * false positives: remote-target-http.test.mjs spawns `/usr/sbin/sshd` while separately
   * doing `await import('../src/server.mjs')` — an in-process import, which is precisely
   * the case the server's entrypoint guard is designed to let through untouched.
   * Accusing it would have taught the next reader to loosen this guard.
   */
  function spawnCallArguments(code) {
    const calls = [];
    const pattern = /\bspawn\s*\(/g;
    let match = pattern.exec(code);
    while (match !== null) {
      let depth = 1;
      let index = match.index + match[0].length;
      const start = index;
      while (index < code.length && depth > 0) {
        const char = code[index];
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        index += 1;
      }
      calls.push(code.slice(start, index - 1));
      match = pattern.exec(code);
    }
    return calls;
  }

  // Derived, never listed: a file added tomorrow is examined without editing this test.
  function spawnersOfTheServer() {
    const found = [];
    for (const file of sourceFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // A local binding that holds a server.mjs path — `spawn(execPath, [serverPath])` is
      // the idiom two of the three real spawners use, so matching only the literal would
      // miss them.
      const serverPathBindings = [...code.matchAll(/(?:const|let|var)\s+(\w+)\s*=[^;]*server\.mjs[^;]*;/g)]
        .map((m) => m[1]);
      // argv[1] is server.mjs — the shape that makes the server's own
      // `process.argv[1] === import.meta.url` entrypoint guard fire.
      const spawnsServer = spawnCallArguments(code).some((args) =>
        /server\.mjs/.test(args) || serverPathBindings.some((name) => new RegExp(`\\b${name}\\b`).test(args)));
      if (spawnsServer) found.push(file);
    }
    return found;
  }

  test('the derivation actually finds the spawners (a guard that matches nothing proves nothing)', () => {
    const spawners = spawnersOfTheServer().map((f) => relative(repoRoot, f));
    assert.ok(spawners.length >= 3,
      `expected the known server spawners to be found, got ${spawners.length}: ${spawners.join(', ')}`);
  });

  test('every spawner of server.mjs isolates the codev peer socket path', () => {
    const offenders = [];
    for (const file of spawnersOfTheServer()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!/NOESAR_CODEV_PEER_SOCKET_PATH\s*:/.test(code)) offenders.push(relative(repoRoot, file));
    }
    assert.deepEqual(offenders, [],
      'these spawn the real server.mjs without isolating NOESAR_CODEV_PEER_SOCKET_PATH, so they bind '
      + 'the production default on the machine running them');
  });

  test('the comment-stripping is real, or this whole guard is decoration', () => {
    // Deliberately NOT written to a file that looks like a spawner: this suite is itself
    // scanned by the derivation above, and a fixture containing a literal server.mjs spawn
    // would make this file accuse itself. The stripping is what is under test, so the
    // stripping is what is called.
    const proseOnly = [
      '// NOESAR_CODEV_PEER_SOCKET_PATH: we should really set this one day',
      '/* NOESAR_CODEV_PEER_SOCKET_PATH: honestly, any day now */',
      'const env = { NOESAR_WORKSPACE: workspace };',
    ].join('\n');
    const stripped = stripComments(proseOnly);
    assert.equal(/NOESAR_CODEV_PEER_SOCKET_PATH\s*:/.test(stripped), false,
      'a mention inside a comment must not satisfy the isolation check');
    // And the stripping must not eat real code along with the prose.
    assert.match(stripped, /NOESAR_WORKSPACE\s*:\s*workspace/, 'stripping must leave code intact');
    // A URL inside a string is not a comment — the naive /\/\/.*$/ rule ate these.
    assert.match(stripComments("const u = 'https://example.invalid/x'; // gone"), /https:\/\/example\.invalid\/x/);
  });

  test('server.mjs still defaults to the production path — this phase isolates callers, it does not move production', async () => {
    const source = readFileSync(join(repoRoot, 'services/reference-control-plane/src/server.mjs'), 'utf8');
    assert.match(source, /NOESAR_CODEV_PEER_SOCKET_PATH\s*\?\?\s*'\/run\/codev-peer\.sock'/,
      'the live container sets no such variable and relies on this default; changing it is a deploy, not a fix');
    await sleep(0);
  });
});
