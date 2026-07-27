// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publishing NOESAR on a LAN address changes one premise the runtime relied on.
//
// `/metrics` was served without a session to any caller whose peer address was
// private, on the reasoning — written into the code — that "the container publishes
// on loopback only, so an internal caller is already inside the trust boundary".
// Behind a published port that reasoning is load-bearing and invisible: every
// external caller arrives from the Docker bridge gateway, which is itself an RFC1918
// address, so the peer address proves nothing on its own. It happens to be a correct
// conclusion while the publish is 127.0.0.1 and a false one the moment it is not.
//
// These tests pin both halves: the pure scope logic, and the observable behaviour of
// a real listener started in each scope.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import {
  BindScope, resolveBindScope, allowsUnauthenticatedMetrics, allowsUnauthenticatedHealthDetail,
  isLoopbackAddress, isWildcardAddress, isInternalAddress, validHostHeader,
} from '../src/http-security.mjs';
import { mayReadHealthDetail } from '../src/auth.mjs';
import { publicHealth } from '../src/observability.mjs';

const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/server.mjs');

describe('exposure scope resolution', () => {
  test('an unconfigured installation is loopback', () => {
    assert.equal(resolveBindScope({}), BindScope.LOOPBACK);
    assert.equal(resolveBindScope({ bindAddress: '' }), BindScope.LOOPBACK);
    assert.equal(resolveBindScope({ bindAddress: null, bindScope: null }), BindScope.LOOPBACK);
  });

  test('the scope is derived from the published address', () => {
    assert.equal(resolveBindScope({ bindAddress: '127.0.0.1' }), BindScope.LOOPBACK);
    assert.equal(resolveBindScope({ bindAddress: '127.0.0.53' }), BindScope.LOOPBACK);
    assert.equal(resolveBindScope({ bindAddress: '::1' }), BindScope.LOOPBACK);
    assert.equal(resolveBindScope({ bindAddress: '192.168.178.100' }), BindScope.LAN);
    assert.equal(resolveBindScope({ bindAddress: '10.1.2.3' }), BindScope.LAN);
    assert.equal(resolveBindScope({ bindAddress: '0.0.0.0' }), BindScope.CUSTOM);
    assert.equal(resolveBindScope({ bindAddress: '::' }), BindScope.CUSTOM);
  });

  test('an explicit scope overrides the derivation, and rubbish does not', () => {
    assert.equal(resolveBindScope({ bindAddress: '127.0.0.1', bindScope: 'lan' }), BindScope.LAN);
    assert.equal(resolveBindScope({ bindAddress: '192.168.1.5', bindScope: 'loopback' }), BindScope.LOOPBACK);
    // An unrecognised value must not be honoured, and must not widen anything.
    assert.equal(resolveBindScope({ bindAddress: '192.168.1.5', bindScope: 'public' }), BindScope.LAN);
    assert.equal(resolveBindScope({ bindScope: 'nonsense' }), BindScope.LOOPBACK);
  });

  test('address predicates', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true);
    assert.equal(isLoopbackAddress('127.255.255.254'), true);
    assert.equal(isLoopbackAddress('128.0.0.1'), false);
    assert.equal(isLoopbackAddress('192.168.178.100'), false);
    assert.equal(isWildcardAddress('0.0.0.0'), true);
    assert.equal(isWildcardAddress('::'), true);
    assert.equal(isWildcardAddress('192.168.178.100'), false);
    assert.equal(isInternalAddress('172.22.0.1'), true, 'the docker bridge gateway is a private address');
    assert.equal(isInternalAddress('::ffff:192.168.1.9'), true);
    assert.equal(isInternalAddress('8.8.8.8'), false);
  });
});

describe('unauthenticated /metrics is scoped, not blanket', () => {
  test('allowed only on a loopback publish, and only from a private peer', () => {
    assert.equal(allowsUnauthenticatedMetrics(BindScope.LOOPBACK, '127.0.0.1'), true);
    assert.equal(allowsUnauthenticatedMetrics(BindScope.LOOPBACK, '172.22.0.1'), true);
    assert.equal(allowsUnauthenticatedMetrics(BindScope.LOOPBACK, '8.8.8.8'), false);
  });

  test('never allowed once the port is published beyond loopback', () => {
    // This is the whole point: on a LAN publish the peer is STILL the bridge gateway,
    // so the old predicate would still have said yes.
    assert.equal(allowsUnauthenticatedMetrics(BindScope.LAN, '172.22.0.1'), false);
    assert.equal(allowsUnauthenticatedMetrics(BindScope.LAN, '127.0.0.1'), false);
    assert.equal(allowsUnauthenticatedMetrics(BindScope.LAN, '192.168.178.42'), false);
    assert.equal(allowsUnauthenticatedMetrics(BindScope.CUSTOM, '172.22.0.1'), false);
    assert.equal(allowsUnauthenticatedMetrics('anything-unrecognised', '127.0.0.1'), false);
  });
});

// --- B-010 · /healthz disclosed its detail to the whole subnet ---------------
//
// /metrics was scoped four phases ago and /healthz was not, so the same class of
// exposure survived on a neighbouring route: version, authority posture, data plane
// server and extension versions, component inventory, update channel and debug
// scopes, to any host on the subnet with no session at all.
//
// The repair cannot be "authenticate it": the container healthcheck, three platform
// installers and the update manager's post-start poll all read this route anonymously,
// and a 401 there reads as a dead service. So the aggregate stays open and the detail
// moves behind the gate — which makes the redaction itself the thing to test.

describe('unauthenticated /healthz detail is scoped the same way /metrics is', () => {
  test('allowed only on a loopback publish, and only from a private peer', () => {
    assert.equal(allowsUnauthenticatedHealthDetail(BindScope.LOOPBACK, '127.0.0.1'), true);
    assert.equal(allowsUnauthenticatedHealthDetail(BindScope.LOOPBACK, '172.22.0.1'), true);
    assert.equal(allowsUnauthenticatedHealthDetail(BindScope.LOOPBACK, '8.8.8.8'), false);
  });

  test('never allowed once the port is published beyond loopback', () => {
    assert.equal(allowsUnauthenticatedHealthDetail(BindScope.LAN, '172.22.0.1'), false);
    assert.equal(allowsUnauthenticatedHealthDetail(BindScope.LAN, '127.0.0.1'), false);
    assert.equal(allowsUnauthenticatedHealthDetail(BindScope.LAN, '192.168.178.42'), false);
    assert.equal(allowsUnauthenticatedHealthDetail(BindScope.CUSTOM, '172.22.0.1'), false);
    assert.equal(allowsUnauthenticatedHealthDetail('anything-unrecognised', '127.0.0.1'), false);
  });

  test('it is the same rule as /metrics, not a second one that can drift', () => {
    for (const scope of [BindScope.LOOPBACK, BindScope.LAN, BindScope.CUSTOM, 'nonsense']) {
      for (const peer of ['127.0.0.1', '172.22.0.1', '192.168.178.42', '8.8.8.8']) {
        assert.equal(
          allowsUnauthenticatedHealthDetail(scope, peer),
          allowsUnauthenticatedMetrics(scope, peer),
          `${scope}/${peer} must resolve identically for both endpoints`,
        );
      }
    }
  });
});

describe('who may read health detail · one rule, not one per endpoint', () => {
  test('the owner may', () => {
    assert.equal(mayReadHealthDetail({ role:'owner' }), true);
  });

  // The reason this rule exists. `admin` carries audit.read, so a permission-only
  // test would have disclosed to admins exactly what the owner-only Health section
  // and the initial screen withhold from them.
  test('an admin may not, despite carrying audit.read', () => {
    assert.equal(mayReadHealthDetail({ role:'admin' }), false);
  });

  test('no other role may, and neither does an absent user', () => {
    for (const role of ['developer', 'user', 'client_restricted', 'service_account', 'nonsense']) {
      assert.equal(mayReadHealthDetail({ role }), false, `${role} must not read health detail`);
    }
    assert.equal(mayReadHealthDetail(null), false);
    assert.equal(mayReadHealthDetail(undefined), false);
    assert.equal(mayReadHealthDetail({}), false);
  });
});

describe('the redacted health body', () => {
  const FULL = Object.freeze({
    status:'degraded', local:true, checkedAt:'2026-07-27T12:00:00.000Z',
    product:'NOESAR Evolution', version:'1.0.0-complete-ai-workspace',
    authority:{ mode:'reference-node', productionReady:false },
    dataPlane:{ mode:'postgresql', serverVersion:'18.4', pgvectorVersion:'0.8.5' },
    components:[{ name:'data-plane', healthy:true }],
    degraded:['log-volume'], logging:{ bytes:1234 },
    updates:{ channel:'complete', installedVersion:'1.0.0' },
    debug:{ enabled:true, scopes:['http'] },
    safeMode:{ active:false }, crashLoop:false,
    timezone:{ effective:'Europe/Rome' },
  });

  // The three fields three consumers assert: Test-Noesar.ps1 checks status and local,
  // verify-runtime.sh checks status and local, and every probe reads the status code.
  test('keeps exactly what a prober is entitled to', () => {
    const body = publicHealth(FULL);
    assert.equal(body.status, 'degraded');
    assert.equal(body.local, true);
    assert.equal(body.checkedAt, '2026-07-27T12:00:00.000Z');
  });

  test('drops every reconnaissance field', () => {
    const body = publicHealth(FULL);
    for (const field of [
      'version', 'product', 'authority', 'dataPlane', 'components', 'degraded',
      'logging', 'updates', 'debug', 'timezone', 'safeMode', 'crashLoop',
    ]) {
      assert.equal(Object.hasOwn(body, field), false, `${field} must not survive redaction`);
    }
    // Asserted on the serialised body too: a nested value that survived by reference
    // would pass a key check and still ship the version to the subnet.
    const wire = JSON.stringify(body);
    for (const leak of ['1.0.0-complete-ai-workspace', 'reference-node', '18.4', '0.8.5', 'data-plane']) {
      assert.equal(wire.includes(leak), false, `redacted body leaked ${leak}`);
    }
  });

  test('says that detail exists and what it would take to read it', () => {
    const body = publicHealth(FULL);
    assert.equal(body.detail.disclosed, false);
    assert.equal(body.detail.requiredRole, 'owner');
    assert.equal(body.detail.requiredPermission, 'audit.read');
    assert.ok(body.detail.reason.length > 20);
  });
});

describe('the published address joins the Host allowlist', () => {
  test('a Host header naming the published address is accepted', () => {
    const allowed = new Set(['localhost', '127.0.0.1', '::1', '192.168.178.100']);
    assert.equal(validHostHeader('192.168.178.100:8100', allowed), true);
    assert.equal(validHostHeader('192.168.178.101:8100', allowed), false);
    assert.equal(validHostHeader('noesar.example:8100', allowed), false);
  });
});

// --- behaviour of a real listener ------------------------------------------

function startServer(env) {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-exposure-'));
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      NOESAR_WORKSPACE: workspace,
      NOESAR_HOST: '127.0.0.1',
      NOESAR_PORT: '0',
      NOESAR_LOG_LEVEL: 'ERROR',
      NOESAR_SETUP_TOKEN: 'test-only-setup-token-not-a-real-secret',
      NOESAR_DATA_PLANE: 'reference-json',
      NOESAR_RELEASE_CHANNEL: 'development',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child, workspace };
}

// NOESAR_PORT=0 lets the kernel choose, but the process does not print the port, so
// the listener is discovered by asking it. A fixed high port per scope is simpler and
// deterministic enough for a test that starts one server at a time.
async function withServer(env, port, fn) {
  const { child } = startServer({ ...env, NOESAR_PORT: String(port) });
  const base = `http://127.0.0.1:${port}`;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}): ${stderr}`);
      try {
        const probe = await fetch(`${base}/livez`);
        if (probe.ok) break;
      } catch { /* not listening yet */ }
      if (Date.now() > deadline) throw new Error(`server never became live: ${stderr}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    return await fn(base);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 5000); });
  }
}

test('a loopback installation still serves /metrics to a local caller', async () => {
  await withServer({}, 18131, async (base) => {
    const response = await fetch(`${base}/metrics`);
    assert.equal(response.status, 200, 'the existing loopback behaviour must not regress');
    assert.match(await response.text(), /noesar_up/);
  });
});

test('a LAN-published installation refuses /metrics without a session', async () => {
  await withServer({ NOESAR_BIND_ADDRESS: '192.168.178.100' }, 18132, async (base) => {
    const response = await fetch(`${base}/metrics`);
    assert.equal(response.status, 401,
      'on a LAN publish the exporter must be behind authentication');
    // ...while the health endpoints stay open: they are what a container runtime and
    // an operator need in order to see that the service is up at all.
    assert.equal((await fetch(`${base}/livez`)).status, 200);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    // ...and /diagnostics stays owner-only regardless of scope.
    assert.equal((await fetch(`${base}/diagnostics`)).status, 401);
  });
});

test('a LAN-published installation answers /healthz without disclosing its detail', async () => {
  await withServer({ NOESAR_BIND_ADDRESS: '192.168.178.100' }, 18135, async (base) => {
    const response = await fetch(`${base}/healthz`);
    // The status code is the contract the probes depend on and it must not move.
    assert.equal(response.status, 200, 'a probe must still be told the service is up');
    const body = await response.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.local, true);
    assert.equal(body.detail.disclosed, false);
    assert.equal(body.detail.requiredRole, 'owner');

    // The actual exposure, asserted against the wire rather than the parsed keys.
    const wire = JSON.stringify(body);
    for (const field of ['version', 'authority', 'dataPlane', 'components', 'updates', 'debug']) {
      assert.equal(Object.hasOwn(body, field), false, `${field} must not reach an anonymous LAN caller`);
    }
    for (const leak of ['reference-node', 'postgresql', 'pgvector', 'releaseChannel']) {
      assert.equal(wire.includes(leak), false, `/healthz leaked ${leak} to the subnet`);
    }
  });
});

// The negative control. Without this the test above passes just as well against a
// /healthz that returns nothing useful to anybody, and the loopback consumers — the
// runtime smokes, verify-runtime.sh, Test-Noesar.ps1 — would be broken silently.
test('a loopback installation still serves the full /healthz detail', async () => {
  await withServer({}, 18136, async (base) => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.local, true);
    assert.equal(body.product, 'NOESAR Evolution');
    assert.ok(body.version, 'the loopback behaviour must not regress');
    assert.ok(Array.isArray(body.components) && body.components.length > 0);
    assert.ok(body.authority && body.dataPlane);
    assert.equal(Object.hasOwn(body, 'detail'), false,
      'a disclosed body carries the detail itself, not a note about it');
  });
});

// `Host` is a forbidden header name for fetch(): undici drops it silently, so a
// fetch-based Host test passes no matter what the server does. This one was written
// with fetch first and "passed" while asserting nothing. node:http sends what it is
// given, which is the only way to exercise the allowlist at all.
function requestWithHost(base, path, hostHeader) {
  const url = new URL(base + path);
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest({
      host: url.hostname, port: url.port, path: url.pathname, method: 'GET',
      headers: { host: hostHeader },
    }, (res) => {
      res.resume();
      res.on('end', () => resolvePromise({ status: res.statusCode }));
    });
    req.on('error', rejectPromise);
    req.end();
  });
}

test('a LAN-published installation accepts its own address as a Host header', async () => {
  await withServer({ NOESAR_BIND_ADDRESS: '192.168.178.100' }, 18133, async (base) => {
    const accepted = await requestWithHost(base, '/livez', '192.168.178.100:8100');
    assert.equal(accepted.status, 200,
      'declaring the publish address must put it in the Host allowlist');
    const rejected = await requestWithHost(base, '/livez', 'attacker.example:8100');
    assert.equal(rejected.status, 421, 'every other Host must still be refused');
    // The negative control proves the allowlist is what accepted the first request:
    // an unrelated private address is refused just the same.
    const otherLan = await requestWithHost(base, '/livez', '192.168.178.101:8100');
    assert.equal(otherLan.status, 421, 'only the declared address is added, not its subnet');
  });
});

test('no CORS header is ever emitted, on any scope', async () => {
  await withServer({ NOESAR_BIND_ADDRESS: '192.168.178.100' }, 18134, async (base) => {
    for (const path of ['/livez', '/healthz', '/', '/api/v1/auth/status']) {
      const response = await fetch(`${base}${path}`, { headers: { origin: 'http://attacker.example' } });
      assert.equal(response.headers.get('access-control-allow-origin'), null,
        `${path} must not grant a cross-origin read`);
      assert.equal(response.headers.get('access-control-allow-credentials'), null,
        `${path} must not grant cross-origin credentials`);
    }
    // Same-origin isolation is asserted positively too, so that "no CORS" cannot be
    // mistaken for "no policy".
    const document = await fetch(`${base}/`);
    assert.equal(document.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(document.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(document.headers.get('x-frame-options'), 'DENY');
  });
});
