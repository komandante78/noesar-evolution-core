// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `/shared/` is served, and it is served safely — proven against a real listener.
//
// `D-0405` slice 1 moved the two modules BOTH shells import out of `apps/webui-static/`, so
// that slice 4 can delete the web CodeN without taking the terminal's command set and address
// space with it. The terminal now imports them off disk, which needs no server at all. The
// browser does not: `app.js` says `../shared/coden/agent-commands.js`, and if the server does
// not serve that path the page dies on its first import with a 404 — every surface, not just
// CodeN, because it is the entry module of the whole WebUI that carries the import.
//
// That failure is invisible to every other test in this repository. The unit suites import the
// file off disk, where it plainly exists; the parity tests read source text and find the
// specifier; ESLint resolves nothing over HTTP. All of them stay green against a server that
// answers 404. So this file starts the real server and asks it, which is the only question
// that was ever in doubt.
//
// The traversal cases are not decoration. A second served root is a second chance to get
// containment wrong, and the guard was rewritten to take the root as a variable — the exact
// shape of edit where a check keeps running but stops checking what it used to. Here the
// answers are read from a socket rather than reasoned about from the source. See `raw()` for
// what those cases actually reach, and what they therefore do and do not prove: the honest
// answer was measured, and it is not the flattering one.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(here, '../src/server.mjs');
const repoRoot = resolve(here, '../../..');

// A fixed high port, like lan-exposure.test.mjs: NOESAR_PORT=0 lets the kernel choose but the
// process never prints what it chose, and one server at a time is deterministic enough.
const PORT = 39_517;
const base = `http://127.0.0.1:${PORT}`;

let child;
let stderr = '';

/** A GET whose path reaches the SOCKET exactly as written — no client-side normalisation.
 *
 *  `fetch` collapses `..` before it opens the connection, so a traversal case written with it
 *  asks the server a question that contains no traversal, and would pass against a server with
 *  no containment at all. `http.request` sends the path verbatim, which is what a hostile
 *  client does.
 *
 *  What that does and does not prove, measured rather than assumed: the request arrives intact,
 *  but `server.mjs:1267` parses it with `new URL()`, and the WHATWG parser normalises `..` out
 *  of `pathname` before any route is matched. So the traversal is already gone by the time
 *  `serveStatic` runs, and the `startsWith(root)` check inside it is defence in depth, not the
 *  active defence. Proven by deleting that check and re-running this file: still 9/9 green.
 *  It is kept — and this test is kept — because the day someone routes on `req.url` instead,
 *  the structural defence disappears silently and these cases become the only thing looking. */
function raw(path) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = httpRequest({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolveRequest({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

before(async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-shared-static-'));
  child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      NOESAR_WORKSPACE: workspace,
      NOESAR_HOST: '127.0.0.1',
      NOESAR_PORT: String(PORT),
      NOESAR_LOG_LEVEL: 'ERROR',
      NOESAR_SETUP_TOKEN: 'test-only-setup-token-not-a-real-secret',
      NOESAR_DATA_PLANE: 'reference-json',
      NOESAR_RELEASE_CHANNEL: 'development',
      // Kept inside this test's own temp workspace. Without it the spawned server binds the
      // PRODUCTION default (/run/codev-peer.sock) on the machine running the suite — which on
      // a native install is the running product's terminal transport. Guarded by
      // socket-path-isolation.test.mjs; repeated here because the hazard is per-spawn.
      NOESAR_CODEV_PEER_SOCKET_PATH: join(workspace, 'codev-peer.sock'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}): ${stderr}`);
    try {
      if ((await fetch(`${base}/livez`)).ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`server never became live: ${stderr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(async () => {
  child?.kill('SIGTERM');
  await new Promise((r) => { child?.once('exit', r); setTimeout(r, 5000); });
});

describe('the shared modules are reachable over HTTP, as the browser will ask for them', () => {
  test('the slash-command registry is served at the path app.js imports', async () => {
    const response = await fetch(`${base}/shared/coden/agent-commands.js`);
    assert.equal(response.status, 200, 'the WebUI entry module would 404 on its first import');
    assert.match(response.headers.get('content-type') ?? '', /javascript/,
      'served with a content-type no browser will execute as a module');
    const served = await response.text();
    // The bytes on disk, not merely "some JavaScript": the point of the move is one file, and
    // a served copy that had drifted would be the two-copies defect wearing a 200.
    assert.equal(served, readFileSync(join(repoRoot, 'apps/shared/coden/agent-commands.js'), 'utf8'));
    assert.match(served, /export const AGENT_COMMANDS/, 'the registry itself is not in the response');
  });

  test('the address declaration is served too', async () => {
    const response = await fetch(`${base}/shared/coden/coden-addresses.js`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(),
      readFileSync(join(repoRoot, 'apps/shared/coden/coden-addresses.js'), 'utf8'));
  });

  test('the specifier app.js actually writes resolves to that URL', async () => {
    // Not a restatement of the test above. This asserts the pair: what the source says, and
    // what a browser does with it. `new URL()` is the same resolution the browser performs,
    // so a future edit that changes the specifier without changing the route fails here
    // rather than in someone's console.
    const app = readFileSync(join(repoRoot, 'apps/webui-static/app.js'), 'utf8');
    const specifier = app.match(/from '(\.\.\/shared\/[^']+agent-commands\.js)'/)?.[1];
    assert.ok(specifier, 'app.js no longer imports the shared registry by a relative specifier');
    const resolved = new URL(specifier, `${base}/app.js`);
    assert.equal(resolved.pathname, '/shared/coden/agent-commands.js');
    assert.equal((await fetch(resolved)).status, 200);
  });

  test('the WebUI it was moved out of still serves', async () => {
    // The regression the move could cause: a second root that swallows the first.
    for (const path of ['/', '/index.html', '/app.js']) {
      assert.equal((await fetch(`${base}${path}`)).status, 200, `${path} stopped serving`);
    }
  });
});

describe('the second root is contained as tightly as the first', () => {
  test('it does not become a way to read the repository', async () => {
    // RAW requests, not `fetch`. `fetch` resolves the URL before it sends, so
    // `/shared/../../package.json` leaves the client as `/package.json` and the server never
    // sees a traversal at all — a test written with `fetch` here proves only that WHATWG URL
    // normalisation works. Measured while writing this: every `..` case "passed" for that
    // reason, and one of them appeared to fail for an unrelated one. `http.request` sends the
    // path verbatim, which is what a hostile client does.
    const outside = readFileSync(join(repoRoot, 'package.json'), 'utf8');
    for (const path of [
      '/shared/../../package.json',
      '/shared/coden/../../../package.json',
      '/shared/%2e%2e/%2e%2e/package.json',
      '/shared/..%2f..%2fpackage.json',
      '/shared/....//....//package.json',
      '/shared/../webui-static/../../../etc/passwd',
    ]) {
      const { body } = await raw(path);
      // The assertion is about CONTENT, not status. An extensionless path falls through to the
      // application shell with a 200 by design, so "status is not 200" would be a check that
      // passes for the wrong reason on half these inputs and could never fail on the other.
      assert.notEqual(body, outside, `${path} served a file from outside the shared root`);
      assert.doesNotMatch(body, /"name"\s*:\s*"noesar/, `${path} leaked package.json`);
      assert.doesNotMatch(body, /^root:/m, `${path} leaked a host file`);
    }
  });

  test('it serves no directory listing', async () => {
    // `/shared` and `/shared/` answer 200 with the application shell — the pre-existing
    // fallback every extensionless path gets, unchanged by this slice and deliberately not
    // altered by it. What matters is that neither enumerates the tree: `statSync().isFile()`
    // is the only thing that produces a static response, so a directory can never be one.
    for (const path of ['/shared', '/shared/', '/shared/coden', '/shared/coden/']) {
      const { body } = await raw(path);
      assert.doesNotMatch(body, /agent-commands\.js/, `${path} enumerated the shared tree`);
    }
  });

  test('it invents no file', async () => {
    // A path with an extension gets a real answer rather than the shell, so these are the
    // inputs where a 404 is the meaningful assertion.
    for (const path of ['/shared/nope.js', '/shared/coden/nope.js']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, `${path} did not 404`);
    }
  });

  test('a path that merely starts with the same letters is not the shared root', async () => {
    // `/sharedcoden/…` must not be read as `/shared` + `coden/…`. The prefix test is written
    // against `/shared/` and the exact string `/shared`, and this is what pins that.
    assert.equal((await fetch(`${base}/sharedcoden/agent-commands.js`)).status, 404);
  });

  test('the shared root carries the same security headers as the rest', async () => {
    const response = await fetch(`${base}/shared/coden/agent-commands.js`);
    // A new route that forgot the header set would be a hole opened by an addition, which is
    // the class of defect a second root invites.
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.ok(response.headers.get('x-content-type-options'), 'nosniff header missing');
  });
});
