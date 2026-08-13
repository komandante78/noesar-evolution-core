// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0426`. These exist because the defect they pin was found by the Owner LOOKING at the
// product, after a deployment that every other instrument called green.
//
// The CodeN terminal attached and then reported `Disconnected: closed (1006)` in a loop. The
// installation's log said why, twelve times: `coden bridge refused a foreign origin`, with
// `origin: https://<host>:8443`. The expected origin was being built as
// `${x-forwarded-proto ?? 'http'}://${host}` — correct behind a reverse proxy, wrong on this
// product's own TLS listener, where nothing sets that header and the connection is encrypted
// anyway. So the bridge compared `https://host:8443` against `http://host:8443` and refused
// every handshake the browser made over HTTPS.
//
// Why no test saw it: every suite in this repository drives the product over plain HTTP. The
// browser probe reaches its container by name over `http://`, where the buggy fallback happens
// to give the right answer. A defect that only exists on the transport nobody tests is a defect
// that ships — so the fallback is asserted here directly, and `tools/tls-smoke.mjs` now drives
// a real TLS handshake for the end-to-end half.
//
// WebAuthn signs over the same value, so the same line broke passkeys over HTTPS. Both are
// asserted below, because a helper two features depend on has two ways to be wrong.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { requestScheme, requestOrigin } from '../src/request-origin.mjs';

const req = (headers, { encrypted = false } = {}) => ({ headers, socket: { encrypted } });

describe('request origin · D-0426', () => {
  test('a TLS connection with no proxy header is https — the defect itself', () => {
    // This is the case that shipped: the LAN TLS listener, reached directly by a browser.
    assert.equal(requestScheme(req({ host: 'box:8443' }, { encrypted: true })), 'https');
    assert.equal(requestOrigin(req({ host: 'box:8443' }, { encrypted: true })), 'https://box:8443');
  });

  test('a plain connection with no proxy header is http', () => {
    assert.equal(requestScheme(req({ host: 'box:8100' })), 'http');
    assert.equal(requestOrigin(req({ host: 'box:8100' })), 'http://box:8100');
  });

  test('the proxy header still wins where it is present — trust is unchanged, not widened', () => {
    assert.equal(requestOrigin(req({ host: 'box', 'x-forwarded-proto': 'https' })), 'https://box');
    // A proxy chain reports the CLIENT's scheme first.
    assert.equal(requestScheme(req({ host: 'box', 'x-forwarded-proto': 'https, http' })), 'https');
    // Case and padding are a proxy's business, not a reason to compute a third answer.
    assert.equal(requestScheme(req({ host: 'box', 'x-forwarded-proto': ' HTTPS ' })), 'https');
  });

  test('a nonsense proxy header falls back to the connection rather than to a guess', () => {
    assert.equal(requestScheme(req({ host: 'box', 'x-forwarded-proto': 'gopher' }, { encrypted: true })), 'https');
    assert.equal(requestScheme(req({ host: 'box', 'x-forwarded-proto': '' })), 'http');
  });

  test('the origin carries the port, because that is what a browser sends', () => {
    // `Origin: https://host:8443` — the port is part of the origin, and comparing without it
    // would accept a socket opened from a different port on the same host.
    assert.equal(requestOrigin(req({ host: 'box:8443' }, { encrypted: true })), 'https://box:8443');
    assert.notEqual(
      requestOrigin(req({ host: 'box:8443' }, { encrypted: true })),
      requestOrigin(req({ host: 'box:8100' })),
    );
  });

  test('the server hands this same function to both consumers', async () => {
    // A source guard: the bridge and WebAuthn must not drift into two definitions, which is how
    // one of them would keep the old fallback.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../src/server.mjs'), 'utf8');
    assert.match(source, /const webauthnOrigin = requestOrigin;/);
    assert.doesNotMatch(source, /x-forwarded-proto'\] \?\? 'http'/,
      'the old inline fallback is back in server.mjs');
    assert.match(source, /expectedOrigin: webauthnOrigin/, 'the bridge no longer gets it');
  });
});
