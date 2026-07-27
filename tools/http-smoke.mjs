// SPDX-License-Identifier: Apache-2.0
//
// The UNAUTHENTICATED surface, smoked end to end against a real listener.
//
// This tool asserted, for several phases, that /api/v1/privacy and /api/v1/bootstrap
// answer an anonymous caller with content. Both were correctly moved behind
// authentication later, so it crashed on `privacy.banner.detail` of a 401 body — and
// nobody noticed, because nothing ran it: it was in no npm script and in no step of
// scripts/test.sh. Its sibling auth-http-smoke.mjs was broken by the same class of
// change and was repaired when it landed; this one was missed by that sweep.
//
// It is now wired into scripts/test.sh, and it asserts the boundary rather than
// assuming the far side of it: what an anonymous caller may read, what it may not, and
// that "may not" comes back as 401 rather than as content.
//
// The workspace is forced to a throwaway directory BEFORE the server module is
// imported. server.mjs falls back to <repoRoot>/.workspace when NOESAR_WORKSPACE is
// unset, so running this from the repository root used to materialise a runtime
// workspace — state, audit ledger, logs and two generated keys — inside the repository.
// The import is dynamic for exactly that reason: a static import is hoisted above the
// assignment and would read the environment too early.
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NOESAR_WORKSPACE ??= mkdtempSync(join(tmpdir(), 'noesar-http-smoke-'));
process.env.NOESAR_LOG_LEVEL ??= 'ERROR';

const { server } = await import('../services/reference-control-plane/src/server.mjs');

const failures = [];
function check(name, condition, detail = '') {
  if (condition) return;
  failures.push(detail ? `${name}: ${detail}` : name);
}

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

try {
  // --- readable without a session, on purpose ------------------------------
  // The container healthcheck, the platform installers and the update manager's
  // post-start poll all read this anonymously; a 401 here reads as a dead service.
  const health = await fetch(`${base}/healthz`);
  check('healthz status', health.status === 200, `got ${health.status}`);
  const healthBody = await health.json();
  check('healthz reports healthy', healthBody.status === 'healthy', `got ${healthBody.status}`);
  check('healthz reports locality', healthBody.local === true);

  // This smoke runs on the default loopback scope, where the detail IS disclosed.
  // The redaction that applies off loopback is a different contract and is covered by
  // the real-listener tests in test/lan-exposure.test.mjs, which start a LAN-scoped
  // server. Asserting disclosure here keeps THIS file honest about which scope it is
  // exercising, instead of implying it proved the redaction too.
  check('healthz discloses detail on a loopback publish',
    Array.isArray(healthBody.components) && healthBody.components.length > 0);

  const livez = await fetch(`${base}/livez`);
  check('livez status', livez.status === 200, `got ${livez.status}`);

  // The application shell is served to an anonymous browser: it has to be, because it
  // is what renders the login screen.
  const page = await fetch(base);
  check('webui status', page.status === 200, `got ${page.status}`);
  const html = await page.text();
  check('webui serves the application shell', html.includes('NOESAR') && html.length > 1000);

  // --- NOT readable without a session --------------------------------------
  // The point of the smoke. Each of these once answered anonymously; a regression that
  // reopened one would otherwise be invisible until an audit.
  for (const path of ['/api/v1/privacy', '/api/v1/bootstrap', '/api/v1/home', '/diagnostics']) {
    const response = await fetch(`${base}${path}`);
    check(`${path} requires a session`, response.status === 401, `got ${response.status}`);
  }
} finally {
  server.close();
}

if (failures.length) {
  console.error('HTTP_SMOKE=FAIL');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('HTTP_SMOKE=PASS');
}
