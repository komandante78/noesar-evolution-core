// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Card D of the s313/s317 addendum: an address like /coden/bench/diff has to answer when
// typed straight into the browser bar, not only through the app's own in-page `/` box. This
// is the server half — the client half (bootstrapPathIntoHash in app.js, converting the path
// into the hash the existing router reads) is exercised by browser-e2e.mjs, which is the only
// place a real DOM/router exists to observe it land on the right panel.
//
// End-to-end over a real HTTP listener, same fixture shape as observability-http.test.mjs:
// the fallback must behave as deployed, not merely as a unit-tested branch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-http-coden-spa-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_LOG_LEVEL = 'INFO';
process.env.NOESAR_SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';

const moduleUnderTest = await import('../src/server.mjs');
const { server, watchdog } = moduleUnderTest;
const indexHtml = readFileSync(new URL('../../../apps/webui-static/index.html', import.meta.url), 'utf8');

let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  watchdog.stop();
  await new Promise((resolve) => server.close(resolve));
});

async function get(path) {
  const response = await fetch(`${base}${path}`);
  const body = await response.text();
  return { status: response.status, contentType: response.headers.get('content-type'), body };
}

test('a client route typed into the address bar answers with the SPA shell, not a 404', async () => {
  const response = await get('/coden/bench/diff');
  assert.equal(response.status, 200);
  assert.match(response.contentType, /text\/html/);
  assert.equal(response.body, indexHtml, 'must be the exact same shell / serves, not a second copy');
});

test('a nested, multi-segment client route falls back the same way', async () => {
  const response = await get('/coden/agent/plan');
  assert.equal(response.status, 200);
  assert.match(response.contentType, /text\/html/);
});

test('the root path is unaffected — still the same shell it always served', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.equal(response.body, indexHtml);
});

test('a real API path that does not exist is still a plain 404, never swallowed into HTML', async () => {
  const response = await get('/api/v1/this-endpoint-does-not-exist');
  assert.equal(response.status, 404);
  assert.match(response.contentType, /application\/json/);
});

test('a path with a file extension that does not exist stays a 404, not a false-positive page', async () => {
  const response = await get('/coden/bench/not-a-real-asset.png');
  assert.equal(response.status, 404);
  assert.match(response.contentType, /application\/json/);
});

test('a genuinely missing asset with a known extension is not masked by the fallback', async () => {
  const response = await get('/does-not-exist.js');
  assert.equal(response.status, 404);
});
