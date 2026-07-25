// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end checks over a real HTTP listener: the routes must behave as
// deployed, not merely as unit-tested modules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-http-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_LOG_LEVEL = 'INFO';
process.env.NOESAR_SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';

const moduleUnderTest = await import('../src/server.mjs');
const { server, watchdog, logger, metrics } = moduleUnderTest;

let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  watchdog.stop();
  await new Promise((resolve) => server.close(resolve));
});

async function get(path, headers = {}) {
  const response = await fetch(`${base}${path}`, { headers });
  const body = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* text response */ }
  return { status: response.status, headers: response.headers, body, json: parsed };
}

test('/livez reports the process is alive and performs no dependency check', async () => {
  const response = await get('/livez');
  assert.equal(response.status, 200);
  assert.equal(response.json.status, 'alive');
  assert.equal(typeof response.json.pid, 'number');
  assert.ok(response.json.checkedAt.endsWith('Z'));
  // Liveness must not carry component state: that is readiness' job.
  assert.equal(response.json.components, undefined);
  assert.equal(response.json.dataPlane, undefined);
});

test('/livez stays 200 while an essential dependency is failing', async () => {
  watchdog.register({ name: 'test-essential', essential: true, probe: () => ({ healthy: false }) });
  await watchdog.runOnce({ force: true });
  const live = await get('/livez');
  const ready = await get('/readyz');
  assert.equal(live.status, 200, 'a live process must not be killed for a dependency failure');
  assert.equal(ready.status, 503);
  assert.ok(ready.json.reasons.some((reason) => reason.includes('test-essential')));
  watchdog.subjects.delete('test-essential');
  await watchdog.runOnce({ force: true });
});

test('/readyz reports ready once dependencies are healthy', async () => {
  const response = await get('/readyz');
  assert.equal(response.status, 200);
  assert.equal(response.json.ready, true);
  assert.deepEqual(response.json.reasons, []);
});

test('/healthz aggregates component detail', async () => {
  const response = await get('/healthz');
  assert.equal(response.status, 200);
  assert.equal(response.json.status, 'healthy');
  assert.equal(response.json.product, 'NOESAR Evolution');
  assert.ok(Array.isArray(response.json.components));
  assert.ok(response.json.components.length >= 15, 'every watchdog subject must be reported');
  assert.ok(response.json.components.some((component) => component.name === 'data-plane'));
  assert.equal(response.json.safeMode.active, false);
  assert.equal(response.json.logging.redaction, 'on');
});

test('/metrics is served in Prometheus text format to an internal caller', async () => {
  const response = await get('/metrics');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/plain/);
  assert.match(response.body, /^# HELP noesar_up/m);
  assert.match(response.body, /noesar_up 1/);
  assert.match(response.body, /noesar_build_info\{/);
  assert.match(response.body, /noesar_http_requests_total\{/);
  assert.match(response.body, /noesar_http_request_duration_seconds_bucket/);
  assert.match(response.body, /noesar_safe_mode 0/);
});

test('metric route labels are normalised so identifiers cannot explode cardinality', async () => {
  await get('/api/v1/conversations/11111111-2222-3333-4444-555555555555');
  await get('/api/v1/conversations/66666666-7777-8888-9999-000000000000');
  const response = await get('/metrics');
  assert.match(response.body, /route="\/api\/v1\/conversations\/:id"/);
  assert.ok(!response.body.includes('11111111-2222'), 'a raw identifier must never become a label');
});

test('/diagnostics requires authentication', async () => {
  const response = await get('/diagnostics');
  assert.equal(response.status, 401);
  assert.equal(response.json.error, 'Authentication required.');
});

test('owner-only observability routes are closed to anonymous callers', async () => {
  for (const path of ['/api/v1/logs', '/api/v1/watchdog', '/api/v1/debug/status',
    '/api/v1/updates/status', '/api/v1/updates/history']) {
    const response = await get(path);
    assert.equal(response.status, 401, `${path} must require authentication`);
  }
});

test('health responses carry no secret, prompt or document material', async () => {
  for (const path of ['/livez', '/readyz', '/healthz', '/metrics']) {
    const response = await get(path);
    const lower = response.body.toLowerCase();
    // The real test: the configured setup token is a canary, and it must never
    // appear anywhere in an unauthenticated response.
    assert.ok(!response.body.includes(process.env.NOESAR_SETUP_TOKEN), `${path} leaked the setup token`);
    for (const forbidden of ['password', 'secret', 'apikey', 'api_key', 'private key', 'prompt', 'authorization', 'cookie']) {
      assert.ok(!lower.includes(forbidden), `${path} must not expose "${forbidden}"`);
    }
  }
});

test('every response carries a correlation id the operator can search on', async () => {
  const response = await get('/livez');
  const correlationId = response.headers.get('x-correlation-id');
  assert.match(correlationId, /^[0-9a-f-]{36}$/);
  const found = logger.search({ correlationId, limit: 5 }).entries;
  assert.ok(found.length >= 1, 'the request must be findable in the operational log by its correlation id');
  assert.equal(found[0].event, 'http.request');
  assert.equal(found[0].http.status, 200);
});

test('an unknown Host header is refused', async () => {
  // fetch() refuses to set Host, so this uses a raw request.
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1', port: server.address().port, path: '/livez',
      method: 'GET', headers: { host: 'evil.example' },
    }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
  assert.equal(status, 421);
});

test('security headers are present on API responses', async () => {
  const response = await get('/healthz');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('the served WebUI carries a content security policy', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy');
  assert.ok(csp, 'the HTML document must carry a CSP');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!csp.includes("'unsafe-inline'"), 'the policy must not allow inline script');
});

test('safe mode blocks state changes but keeps reading available', async () => {
  watchdog.enterSafeMode('http integration test');
  try {
    const health = await get('/healthz');
    assert.equal(health.json.status, 'safe-mode');
    const ready = await get('/readyz');
    assert.equal(ready.status, 503);
    assert.ok(ready.json.reasons.includes('safe-mode'));

    // Reads still work.
    assert.equal((await get('/livez')).status, 200);
    assert.equal((await get('/api/v1/auth/status')).status, 200);

    // A mutating route is refused before it reaches authentication.
    const blocked = await fetch(`${base}/api/v1/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(blocked.status, 503);
    const payload = await blocked.json();
    assert.match(payload.error, /safe mode/i);
    assert.ok(payload.readableInSafeMode.includes('documents'));

    const rendered = (await get('/metrics')).body;
    assert.match(rendered, /noesar_safe_mode 1/);
  } finally {
    watchdog.leaveSafeMode({ actorId: 'test' });
  }
  assert.equal((await get('/healthz')).json.status, 'healthy');
});

test('setup remains reachable in safe mode so an operator is never locked out', async () => {
  watchdog.enterSafeMode('lockout test');
  try {
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'wrong' }),
    });
    assert.notEqual(login.status, 503, 'the login route must not be blocked by safe mode');
  } finally {
    watchdog.leaveSafeMode({ actorId: 'test' });
  }
});

test('metrics count requests and record latency', async () => {
  const before = metrics.histogram.count;
  await get('/livez');
  assert.ok(metrics.histogram.count > before);
  assert.ok(metrics.histogram.sum >= 0);
});
