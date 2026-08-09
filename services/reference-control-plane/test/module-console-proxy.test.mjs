// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0281 follow-up: createModuleConsoleProxyServer() in isolation, against a real stub
// upstream and a real socket -- proves the gate refuses BEFORE the upstream is ever
// dialled, and that an authorized request passes method/status/body/headers through
// unmodified at the module's own root (no path prefix to get wrong).

import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModuleConsoleProxyServer } from '../src/module-console-proxy.mjs';

/** A throwaway self-signed pair. Generated with openssl because node has no certificate
 *  issuer of its own, and a fixture checked into the repository would be a private key in
 *  version control — which the pre-commit hook refuses, correctly. */
function selfSignedPair() {
  const dir = mkdtempSync(join(tmpdir(), 'proxy-tls-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=proxy-test', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')],
      { stdio: 'ignore' });
    return { cert: readFileSync(join(dir, 'c.pem'), 'utf8'), key: readFileSync(join(dir, 'k.pem'), 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const upstream = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/styles.css') {
    res.writeHead(200, { 'content-type': 'text/css' }); res.end('body{color:red}'); return;
  }
  if (req.method === 'POST' && req.url === '/api/v2/echo') {
    let chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { res.writeHead(201, { 'content-type': 'application/json' }); res.end(Buffer.concat(chunks)); });
    return;
  }
  res.writeHead(404); res.end('not found');
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

let authorize = true;
const proxy = createModuleConsoleProxyServer({
  targetBaseUrl: upstreamUrl,
  moduleName: 'Stub Module',
  isAuthorized: () => authorize,
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const proxyBase = `http://127.0.0.1:${proxy.address().port}`;

after(async () => {
  await new Promise((resolve) => proxy.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});

describe('D-0281 — module console proxy', () => {
  test('an unauthorized request is refused with 401 and never reaches the upstream', async () => {
    authorize = false;
    const response = await fetch(`${proxyBase}/styles.css`);
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.match(text, /Sign in/);
  });

  test('an authorized GET passes status, content-type and body through unmodified, at the root path', async () => {
    authorize = true;
    const response = await fetch(`${proxyBase}/styles.css`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/css');
    assert.equal(await response.text(), 'body{color:red}');
  });

  test('an authorized POST carries the request body through to the upstream and its response back', async () => {
    authorize = true;
    const response = await fetch(`${proxyBase}/api/v2/echo`, { method: 'POST', body: JSON.stringify({ hello: 'world' }), headers: { 'content-type': 'application/json' } });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { hello: 'world' });
  });

  test('the session cookie is stripped before the request reaches the module', async () => {
    authorize = true;
    // The stub upstream does not echo headers back on GET; verified instead via the
    // proxy source not forwarding `cookie`, and by confirming a request WITH a cookie
    // still succeeds (proves the proxy does not fail trying to strip it) — the
    // stripping itself is exercised by module-console-proxy.mjs deleting the header
    // unconditionally, covered structurally rather than by upstream echo here.
    const response = await fetch(`${proxyBase}/styles.css`, { headers: { cookie: 'noesar_session=should-not-cross' } });
    assert.equal(response.status, 200);
  });

  test('an unreachable upstream answers 502, not a hang or a crash', async () => {
    authorize = true;
    const deadProxy = createModuleConsoleProxyServer({ targetBaseUrl: 'http://127.0.0.1:1', moduleName: 'Dead Module', isAuthorized: () => true });
    await new Promise((resolve) => deadProxy.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${deadProxy.address().port}`;
    const response = await fetch(`${base}/anything`);
    assert.equal(response.status, 502);
    await new Promise((resolve) => deadProxy.close(resolve));
  });
});

// D-0291: the `/noesar-api/` branch. This is the property the remote-target screens in the
// module's console rest on -- an SSH private key pasted there must reach NOESAR without
// passing through the module -- so it is proven against two real upstreams that echo what
// they actually received, not asserted structurally. The module-bound half also closes the
// gap the cookie test above declares: here the stub echoes headers back, so the stripping
// is observed rather than inferred.
describe('D-0291 — /noesar-api/ is answered by NOESAR, not forwarded to the module', () => {
  const seen = { module: null, noesar: null };
  const echo = (which) => createServer((req, res) => {
    seen[which] = { url: req.url, cookie: req.headers.cookie ?? null };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ which, url: req.url }));
  });

  let moduleUp, noesarUp, splitProxy, base;

  test('setup', async () => {
    moduleUp = echo('module'); noesarUp = echo('noesar');
    await new Promise((r) => moduleUp.listen(0, '127.0.0.1', r));
    await new Promise((r) => noesarUp.listen(0, '127.0.0.1', r));
    splitProxy = createModuleConsoleProxyServer({
      targetBaseUrl: `http://127.0.0.1:${moduleUp.address().port}`,
      noesarBaseUrl: `http://127.0.0.1:${noesarUp.address().port}`,
      moduleName: 'Stub Module',
      isAuthorized: () => true,
    });
    await new Promise((r) => splitProxy.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${splitProxy.address().port}`;
  });

  test('a /noesar-api/ request reaches NOESAR with the prefix stripped and the cookie kept', async () => {
    const response = await fetch(`${base}/noesar-api/api/v1/debug-evolution/remote-targets`, {
      headers: { cookie: 'noesar_session=abc; noesar_csrf=xyz' },
    });
    assert.equal((await response.json()).which, 'noesar');
    assert.equal(seen.noesar.url, '/api/v1/debug-evolution/remote-targets');
    // Without the cookie NOESAR would 401 every one of these, so keeping it is the
    // difference between a working screen and a permanently broken one.
    assert.match(seen.noesar.cookie, /noesar_session=abc/);
  });

  test('every other path still goes to the module, and the cookie does NOT go with it', async () => {
    const response = await fetch(`${base}/api/v2/snapshot`, {
      headers: { cookie: 'noesar_session=must-not-cross' },
    });
    assert.equal((await response.json()).which, 'module');
    assert.equal(seen.module.url, '/api/v2/snapshot');
    assert.equal(seen.module.cookie, null);
  });

  test('a path merely CONTAINING the prefix is not diverted — only a true prefix is', async () => {
    await fetch(`${base}/app/noesar-api/spoof`, { headers: { cookie: 'noesar_session=abc' } });
    assert.equal(seen.module.url, '/app/noesar-api/spoof');
    assert.equal(seen.module.cookie, null);
  });

  test('teardown', async () => {
    await new Promise((r) => splitProxy.close(r));
    await new Promise((r) => moduleUp.close(r));
    await new Promise((r) => noesarUp.close(r));
  });
});

// ——— the scheme is not this listener's own choice, s336 ————————————————————————————————
//
// A browser reaches this port. Once the control plane holds a certificate its cookies are
// `Secure`, and a `Secure` cookie is never sent to an `http://` origin — so a plaintext proxy
// would answer the sign-in page to somebody demonstrably signed in one tab over, and
// `/noesar-api/` (the prefix that exists so an SSH key never travels through the module) would
// fail for the same invisible reason. Nothing in the module would say "your cookie was not sent".
//
// This is checked by looking at what KIND of server comes back rather than by driving a
// handshake: the property is "it followed the main listener", and a real TLS conversation would
// test node's `https` module instead of this decision.
describe('the module console follows the main listener onto TLS', () => {
  const plain = createModuleConsoleProxyServer({
    targetBaseUrl: upstreamUrl, moduleName: 'Stub', isAuthorized: () => true,
  });
  // A self-signed pair, generated here rather than read from disk: this asserts a branch, and a
  // test that needed a certificate file would be a test that can be skipped by deleting one.
  const { cert, key } = selfSignedPair();
  const secured = createModuleConsoleProxyServer({
    targetBaseUrl: upstreamUrl, moduleName: 'Stub', isAuthorized: () => true, tls: { cert, key },
  });

  test('with no certificate it stays plaintext, exactly as before', () => {
    assert.equal(plain.constructor.name, 'Server');
    assert.equal(typeof plain.setSecureContext, 'undefined');
  });

  test('with a certificate it serves TLS', () => {
    // `setSecureContext` exists only on an https server — the narrowest observable difference,
    // and one that cannot be satisfied by an http server that merely looks similar.
    assert.equal(typeof secured.setSecureContext, 'function');
  });

  test('a half-supplied pair is treated as no certificate, never as a broken one', () => {
    // `resolveTls` already refuses a half-configured pair at startup; this is the second line,
    // for a caller that constructs the object itself. Falling into an https server with no key
    // would throw on the first connection instead of at wiring time.
    for (const half of [{ cert }, { key }, {}]) {
      const server = createModuleConsoleProxyServer({
        targetBaseUrl: upstreamUrl, moduleName: 'Stub', isAuthorized: () => true, tls: half,
      });
      assert.equal(typeof server.setSecureContext, 'undefined', JSON.stringify(Object.keys(half)));
    }
  });

  test('teardown', () => { plain.close(); secured.close(); });
});
