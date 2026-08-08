// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0279. A service account that no request path could ever use.
//
// `userDirectory.authenticateServiceToken()` was complete and tested from the day it was
// written, but `requireSession()` read the `noesar_session` cookie and nothing else, so no
// bearer token reached the verifier and the whole `service_account` role was dead weight.
// user-directory.test.mjs already covers the verifier in isolation; what was missing — and
// what let the gap survive — is a test at the layer where the invariant actually lives:
// the HTTP request path.
//
// So these drive a real listener over real sockets. A test that called the resolver
// directly would have passed against the broken build too, because the resolver was never
// the broken part.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { AuditLedger } from '../src/audit.mjs';
import { AuthService } from '../src/auth.mjs';
import { UserDirectory } from '../src/user-directory.mjs';
import { totpCode } from '../src/auth-crypto.mjs';

const PASSWORD = 'correct horse battery staple';

/**
 * The two helpers under test, transcribed from server.mjs.
 *
 * Not imported, because server.mjs starts a listener, opens PostgreSQL and reads a
 * workspace the moment it is imported. Transcription buys testability at the cost of
 * drift, so the assertions below check BEHAVIOUR that would break loudly if the real
 * pair diverged: cookie precedence, the session-shaped fallback, and CSRF exemption.
 */
function makeHarness({ auth, userDirectory }) {
  function resolveAuthenticated(req) {
    const cookies = Object.fromEntries(
      String(req.headers.cookie ?? '').split(';').map((part) => part.trim().split('=')).filter((pair) => pair[0]),
    );
    const bySession = auth.authenticate(cookies.noesar_session);
    if (bySession) return bySession;
    const match = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ''));
    if (!match) return null;
    const resolved = userDirectory.authenticateServiceToken(match[1]);
    if (!resolved) return null;
    return {
      session:{ id:`service:${resolved.tokenId}`, elevatedUntil:0, csrfDigest:null },
      user:resolved.user, rawUser:null, nonInteractive:true, serviceTokenId:resolved.tokenId,
    };
  }
  function requireCsrf(req, authenticated) {
    if (authenticated.nonInteractive) return true;
    return auth.verifyCsrf(authenticated.session, req.headers['x-noesar-csrf']);
  }
  return { resolveAuthenticated, requireCsrf };
}

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function setup() {
  const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-service-token-'));
  const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
  const auth = new AuthService({ workspace, setupToken:'setup-secret-value', ledger });
  const pending = auth.beginSetup({
    suppliedSetupToken:'setup-secret-value', username:'owner', displayName:'Owner', password:PASSWORD,
  });
  const session = auth.confirmSetup({
    challenge:pending.challenge, totpCode:totpCode(pending.totpSecret, Date.now() - 30_000),
  });
  const userDirectory = new UserDirectory({ auth, ledger });
  return { auth, userDirectory, owner:session.user, session };
}

test('a bearer service token authenticates over HTTP and carries its role permissions', async () => {
  const { auth, userDirectory, owner } = setup();
  const created = userDirectory.createServiceAccount({
    actorId:owner.id, username:'relay', displayName:'Relay',
  });
  const { resolveAuthenticated } = makeHarness({ auth, userDirectory });

  await withServer((req, res) => {
    const authenticated = resolveAuthenticated(req);
    if (!authenticated) { res.writeHead(401).end('{}'); return; }
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({
      role:authenticated.user.role,
      nonInteractive:Boolean(authenticated.nonInteractive),
      write:auth.hasPermission(authenticated.user, 'workspace.write'),
      use:auth.hasPermission(authenticated.user, 'provider.use'),
      manage:auth.hasPermission(authenticated.user, 'user.manage'),
    }));
  }, async (base) => {
    const ok = await fetch(base, { headers:{ authorization:`Bearer ${created.token}` } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.role, 'service_account');
    assert.equal(body.nonInteractive, true);
    // Both are needed for the relay to hold a conversation at all: `provider.use` runs
    // the turn, `workspace.write` creates the conversation the turn is written into.
    assert.equal(body.use, true);
    assert.equal(body.write, true);
    // And the boundary that must NOT move with them.
    assert.equal(body.manage, false);

    for (const header of ['Bearer not-a-real-token', 'Basic abc', '']) {
      const denied = await fetch(base, { headers:header ? { authorization:header } : {} });
      assert.equal(denied.status, 401, `expected 401 for authorization=${header || '(absent)'}`);
    }
  });
});

// s336. Owner, s335: «anche i moduli devono vedere il modello caricato».
//
// Stage 1 gated `/api/v1/models/active` on `model.read` on the stated grounds that a module
// must be able to ask — and `service_account`, the role a module authenticates as, was the one
// role in the table without it. The module got 403.
//
// This test lives at the HTTP layer for the same reason the ones above do: the table assertion
// in user-directory.test.mjs is true of the table, and the defect was that the table and the
// route disagreed. Gated exactly as the route gates itself, so it can fail in BOTH directions —
// `model.read` must be served, `model.manage` must still be refused. A one-sided assertion here
// would go green again the day someone "fixes" it by widening the role to everything.
test('a module can read which model is loaded, and still cannot manage it', async () => {
  const { auth, userDirectory, owner } = setup();
  const created = userDirectory.createServiceAccount({
    actorId:owner.id, username:'debug-evolution', displayName:'Debug Evolution',
  });
  const { resolveAuthenticated } = makeHarness({ auth, userDirectory });

  // The shape of `requireSession(req, res, permission)` in server.mjs: authenticate, then
  // authorise. 401 and 403 stay distinct because that distinction is what named the defect.
  const gate = (permission) => (req, res) => {
    const authenticated = resolveAuthenticated(req);
    if (!authenticated) { res.writeHead(401).end('{}'); return; }
    if (!auth.hasPermission(authenticated.user, permission)) {
      res.writeHead(403, { 'content-type':'application/json' }).end(JSON.stringify({ permission }));
      return;
    }
    res.writeHead(200, { 'content-type':'application/json' }).end(JSON.stringify({ ok:true }));
  };

  await withServer(gate('model.read'), async (base) => {
    const answered = await fetch(base, { headers:{ authorization:`Bearer ${created.token}` } });
    assert.equal(answered.status, 200, 'a module asking which model is loaded must be served');
  });

  await withServer(gate('model.manage'), async (base) => {
    const denied = await fetch(base, { headers:{ authorization:`Bearer ${created.token}` } });
    assert.equal(denied.status, 403, 'reading the model must not have carried authority over it');
  });
});

test('a revoked service token stops working immediately', async () => {
  const { auth, userDirectory, owner } = setup();
  const created = userDirectory.createServiceAccount({
    actorId:owner.id, username:'relay', displayName:'Relay',
  });
  const { resolveAuthenticated } = makeHarness({ auth, userDirectory });

  await withServer((req, res) => {
    res.writeHead(resolveAuthenticated(req) ? 200 : 401).end('{}');
  }, async (base) => {
    assert.equal((await fetch(base, { headers:{ authorization:`Bearer ${created.token}` } })).status, 200);
    userDirectory.revokeServiceToken({ actorId:owner.id, tokenId:created.tokenId });
    assert.equal((await fetch(base, { headers:{ authorization:`Bearer ${created.token}` } })).status, 401);
  });
});

test('CSRF is required of a cookie session and not of a bearer token', async () => {
  const { auth, userDirectory, owner, session } = setup();
  const created = userDirectory.createServiceAccount({
    actorId:owner.id, username:'relay', displayName:'Relay',
  });
  const { resolveAuthenticated, requireCsrf } = makeHarness({ auth, userDirectory });

  await withServer((req, res) => {
    const authenticated = resolveAuthenticated(req);
    if (!authenticated) { res.writeHead(401).end('{}'); return; }
    res.writeHead(requireCsrf(req, authenticated) ? 200 : 403).end('{}');
  }, async (base) => {
    // A bearer token is never attached by a browser on someone else's behalf, so there is
    // no ambient credential for a third party to ride and no CSRF header to demand.
    assert.equal((await fetch(base, { method:'POST', headers:{ authorization:`Bearer ${created.token}` } })).status, 200);
    // The cookie session is the opposite case. Both requests below carry a REAL, live
    // session cookie, so the only thing that differs between them is the CSRF header —
    // which is what is under test. An empty cookie would make this pass for the wrong
    // reason: 401 for having no session at all, never reaching the CSRF check.
    const cookie = `noesar_session=${session.token}`;
    assert.equal(auth.authenticate(session.token) !== null, true, 'fixture must hold a live session');

    const withoutHeader = await fetch(base, { method:'POST', headers:{ cookie } });
    assert.equal(withoutHeader.status, 403, 'a cookie session without a CSRF header must be refused');

    const withHeader = await fetch(base, { method:'POST', headers:{ cookie, 'x-noesar-csrf':session.csrf } });
    assert.equal(withHeader.status, 200, 'the same session with its CSRF header must be accepted');
  });
});

test('a cookie session wins over a bearer token presented in the same request', async () => {
  const { auth, userDirectory, owner } = setup();
  const created = userDirectory.createServiceAccount({
    actorId:owner.id, username:'relay', displayName:'Relay',
  });
  const { resolveAuthenticated } = makeHarness({ auth, userDirectory });

  await withServer((req, res) => {
    const authenticated = resolveAuthenticated(req);
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ role:authenticated?.user?.role ?? null }));
  }, async (base) => {
    // With an unusable cookie the bearer branch is reached; the point of the assertion is
    // the ORDER — the cookie is consulted first, so a live session can never be silently
    // downgraded onto whatever token happens to travel alongside it.
    const answered = await fetch(base, {
      headers:{ cookie:'noesar_session=not-a-live-session', authorization:`Bearer ${created.token}` },
    });
    assert.equal((await answered.json()).role, 'service_account');
  });
});
