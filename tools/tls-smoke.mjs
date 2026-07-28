// SPDX-License-Identifier: Apache-2.0
//
// TLS termination, smoked end to end against two real listeners: one with no
// certificate configured (unchanged plaintext behaviour — the default this product has
// always shipped) and one with a throwaway self-signed certificate this tool generates
// itself, via the host's own `openssl` binary (HOST_CAPABILITY_INVENTORY.md lists it as
// available; nothing new is installed, CLAUDE10 rule 45). The certificate lives in a
// mkdtemp directory outside the repository and is discarded when this process exits —
// same discipline as the throwaway NOESAR_WORKSPACE in http-smoke.mjs, for the same
// reason: nothing this tool creates belongs in the tree it is testing.
//
// unit tests already cover resolveTls()'s decision logic in isolation (tls.test.mjs).
// What only a real listener can prove: the server actually switches transport, the
// HSTS header only appears once TLS is genuinely terminating the connection, and a
// plain-HTTP client gets nothing coherent back once it has.
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Three states, not two — the convention scripts/test.sh's step_tristate() expects.
// openssl is declared available in HOST_CAPABILITY_INVENTORY.md for THIS host, but a
// tool that hard-fails on an absent binary elsewhere is a check people learn to skip
// entirely rather than one that degrades honestly.
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  console.log('TLS_SMOKE: PARTIAL — openssl not available on this host, cannot generate a test certificate');
  process.exit(2);
}

const failures = [];
function check(name, condition, detail = '') {
  if (condition) return;
  failures.push(detail ? `${name}: ${detail}` : name);
}

const certDir = mkdtempSync(join(tmpdir(), 'noesar-tls-smoke-'));
const certFile = join(certDir, 'cert.pem');
const keyFile = join(certDir, 'key.pem');
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=127.0.0.1',
], { stdio: ['ignore', 'ignore', 'ignore'] });
check('throwaway self-signed certificate generated', existsSync(certFile) && existsSync(keyFile));

// A bare re-import of server.mjs returns the module the FIRST scenario cached: Node
// keys the module cache by URL, and the module reads process.env exactly once, at
// import time. The query string forces a distinct cache entry per scenario, the same
// problem http-smoke.mjs solves by forcing NOESAR_WORKSPACE before its one static import.
async function bootServer(scenarioEnv, label) {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-tls-smoke-ws-'));
  Object.assign(process.env, { NOESAR_WORKSPACE: workspace, NOESAR_LOG_LEVEL: 'ERROR' }, scenarioEnv);
  for (const key of ['NOESAR_TLS_CERT_FILE', 'NOESAR_TLS_KEY_FILE']) {
    if (!(key in scenarioEnv)) delete process.env[key];
  }
  const mod = await import(`../services/reference-control-plane/src/server.mjs?tls-smoke-${label}`);
  mod.server.listen(0, '127.0.0.1');
  await once(mod.server, 'listening');
  return mod;
}

// --- Scenario 1: no TLS configured — the default, unchanged ---------------------
{
  const { server, tls, secureCookies } = await bootServer({}, 'plain');
  try {
    check('plaintext: tls.active is false', tls.active === false);
    check('plaintext: secureCookies stays false by default', secureCookies === false);
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/livez`);
    check('plaintext: livez status', res.status === 200, `got ${res.status}`);
    check('plaintext: no HSTS header without TLS', res.headers.get('strict-transport-security') === null);
  } finally {
    server.close();
  }
}

// --- Scenario 2: cert+key configured — the server terminates TLS itself ---------
{
  const { server, tls, secureCookies } = await bootServer(
    { NOESAR_TLS_CERT_FILE: certFile, NOESAR_TLS_KEY_FILE: keyFile },
    'https',
  );
  try {
    check('tls: tls.active is true', tls.active === true);
    check('tls: secureCookies is implied true without setting NOESAR_SECURE_COOKIES', secureCookies === true);
    const port = server.address().port;

    const priorReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    // This tool's own throwaway self-signed certificate, generated three lines above —
    // not a third party. Restored in the finally block below either way.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      const res = await fetch(`https://127.0.0.1:${port}/livez`);
      check('tls: livez status over https', res.status === 200, `got ${res.status}`);
      check('tls: HSTS header present once TLS is active', res.headers.get('strict-transport-security') !== null);
    } finally {
      if (priorReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = priorReject;
    }

    const plainAttempt = await fetch(`http://127.0.0.1:${port}/livez`).then(() => 'answered', () => 'refused');
    check('tls: a plain-HTTP client no longer gets a coherent HTTP response on the same port', plainAttempt === 'refused');
  } finally {
    server.close();
  }
}

if (failures.length) {
  console.error('TLS_SMOKE=FAIL');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('TLS_SMOKE=PASS');
}
