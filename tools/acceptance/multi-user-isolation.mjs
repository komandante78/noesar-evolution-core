// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end multi-user acceptance against a live server.
//
// Phase 4 could not run this: no route created a second user, so "isolation" had nothing
// to isolate. It bootstraps an Owner, invites an Admin and two ordinary users, and then
// checks the things that must hold between four real, separately-authenticated sessions.
//
//   node tools/acceptance/multi-user-isolation.mjs http://127.0.0.1:8101 <setup-token>

import crypto from 'node:crypto';
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:8101';
const setupToken = process.argv[3];
if (!setupToken) {
  process.stderr.write('usage: multi-user-isolation.mjs <base-url> <setup-token>\n');
  process.exit(2);
}

const results = [];
let failures = 0;

function check(id, description, condition, evidence = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ id, description, status: ok ? 'PASS' : 'FAIL', evidence: String(evidence).slice(0, 300) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${id} ${description}${evidence ? ` :: ${String(evidence).slice(0, 180)}` : ''}\n`);
}

class Session {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrf = null;
    this.user = null;
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    if (this.cookies.has('noesar_csrf')) this.csrf = this.cookies.get('noesar_csrf');
  }

  async request(method, path, body = null) {
    const headers = { accept: 'application/json' };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (body !== null) headers['content-type'] = 'application/json';
    if (this.csrf && method !== 'GET') headers['x-noesar-csrf'] = this.csrf;
    if (this.setupToken) headers['x-noesar-setup-token'] = this.setupToken;
    const response = await fetch(`${base}${path}`, {
      method, headers, body: body === null ? undefined : JSON.stringify(body),
    });
    this.absorb(response);
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, json, text };
  }
}

const PASSWORD_OWNER = 'owner passphrase for acceptance only';
const PASSWORD_OTHER = 'another passphrase entirely for acceptance';

async function main() {
  // ---- MU-01..MU-03 : Owner bootstrap ------------------------------------------
  const owner = new Session('owner');
  const status = await owner.request('GET', '/api/v1/auth/status');
  check('MU-01', 'the installation reports it is awaiting first-owner setup',
    status.json?.initialized === false, JSON.stringify(status.json));

  owner.setupToken = setupToken;
  const begun = await owner.request('POST', '/api/v1/auth/setup', {
    username: 'acceptance-owner', displayName: 'Acceptance Owner', password: PASSWORD_OWNER,
  });
  check('MU-02', 'the setup token is accepted and MFA enrolment is offered',
    begun.status === 201 && Boolean(begun.json?.totpSecret),
    `status=${begun.status}`);

  const confirmed = await owner.request('POST', '/api/v1/auth/setup/confirm', {
    challenge: begun.json.challenge,
    totpCode: totpCode(begun.json.totpSecret, Date.now() - 30_000),
  });
  owner.user = confirmed.json?.user;
  check('MU-03', 'the Owner account is created with MFA and a session',
    confirmed.status === 201 && confirmed.json?.user?.role === 'owner',
    `status=${confirmed.status} role=${confirmed.json?.user?.role}`);

  const replay = new Session('replay');
  replay.setupToken = setupToken;
  const reused = await replay.request('POST', '/api/v1/auth/setup', {
    username: 'second-owner', displayName: 'Second', password: PASSWORD_OWNER,
  });
  check('MU-04', 'the setup token cannot create a second owner once setup is complete',
    reused.status === 409 || reused.status === 403, `status=${reused.status}`);

  // ---- MU-05..MU-09 : invitations and roles -------------------------------------
  async function invite(username, role) {
    const created = await owner.request('POST', '/api/v1/admin/invitations', {
      username, displayName: username, role,
    });
    return created;
  }

  const adminInvite = await invite('acceptance-admin', 'admin');
  check('MU-05', 'the Owner can invite an administrator and receives a one-time token',
    adminInvite.status === 201 && Boolean(adminInvite.json?.token),
    `status=${adminInvite.status}`);

  const admin = new Session('admin');
  const adminAccept = await admin.request('POST', '/api/v1/auth/invitation/accept', {
    token: adminInvite.json.token, password: PASSWORD_OTHER,
  });
  check('MU-06', 'an administrator must enrol MFA before the account exists',
    adminAccept.json?.mfaRequired === true, `mfaRequired=${adminAccept.json?.mfaRequired}`);
  const adminConfirm = await admin.request('POST', '/api/v1/auth/invitation/confirm', {
    challenge: adminAccept.json.challenge,
    totpCode: totpCode(adminAccept.json.totpSecret),
  });
  check('MU-07', 'the administrator account is created after MFA enrolment',
    adminConfirm.status === 201 && adminConfirm.json?.user?.role === 'admin',
    `status=${adminConfirm.status}`);

  const users = {};
  for (const name of ['alice', 'bob']) {
    const invited = await invite(`acceptance-${name}`, 'user');
    const session = new Session(name);
    const accepted = await session.request('POST', '/api/v1/auth/invitation/accept', {
      token: invited.json.token, password: PASSWORD_OTHER,
    });
    const confirmedUser = await session.request('POST', '/api/v1/auth/invitation/confirm', {
      challenge: accepted.json.challenge,
      totpCode: totpCode(accepted.json.totpSecret),
    });
    users[name] = { session, accepted, confirmed: confirmedUser, secret: accepted.json.totpSecret };
  }
  check('MU-08', 'two ordinary users are created, each enrolling MFA',
    users.alice.confirmed.status === 201 && users.bob.confirmed.status === 201
    && users.alice.confirmed.json?.user?.role === 'user',
    `alice=${users.alice.confirmed.status} bob=${users.bob.confirmed.status}`);

  // A full password + TOTP login, which is the path that would have been impossible for a
  // credential-less account: completeLogin decrypts the TOTP envelope unconditionally.
  const aliceSession = new Session('alice-live');
  const aliceChallenge = await aliceSession.request('POST', '/api/v1/auth/login', {
    username: 'acceptance-alice', password: PASSWORD_OTHER,
  });
  const aliceLoggedIn = await aliceSession.request('POST', '/api/v1/auth/login/mfa', {
    challenge: aliceChallenge.json?.challenge,
    totpCode: totpCode(users.alice.secret, Date.now() + 30_000),
  });
  users.alice.session = aliceSession;
  check('MU-08b', 'an ordinary user can complete a real password and TOTP login',
    aliceLoggedIn.status === 200 && aliceLoggedIn.json?.user?.username === 'acceptance-alice',
    `login=${aliceChallenge.status} mfa=${aliceLoggedIn.status} ${aliceLoggedIn.json?.error ?? ''}`);

  const listed = await owner.request('GET', '/api/v1/admin/users');
  check('MU-09', 'the directory now holds four accounts across three roles',
    listed.json?.users?.length === 4,
    (listed.json?.users ?? []).map((u) => `${u.username}:${u.role}`).join(', '));

  // ---- MU-10..MU-12 : privilege containment --------------------------------------
  const adminMakesOwner = await admin.request('POST', '/api/v1/admin/invitations', {
    username: 'escalated', displayName: 'Escalated', role: 'owner',
  });
  check('MU-10', 'an administrator cannot invite an owner',
    adminMakesOwner.status === 403, `status=${adminMakesOwner.status} ${adminMakesOwner.json?.error ?? ''}`);

  const userAdmins = await users.alice.session.request('GET', '/api/v1/admin/users');
  check('MU-11', 'an ordinary user cannot read the account directory',
    userAdmins.status === 401 || userAdmins.status === 403,
    `status=${userAdmins.status}`);

  const anonymous = await new Session('anon').request('GET', '/api/v1/admin/users');
  check('MU-12', 'an unauthenticated caller cannot read the account directory',
    anonymous.status === 401 || anonymous.status === 403, `status=${anonymous.status}`);

  // ---- MU-13..MU-16 : service accounts ------------------------------------------
  const service = await owner.request('POST', '/api/v1/admin/service-accounts', {
    username: 'acceptance-bot', displayName: 'CI',
  });
  check('MU-13', 'a service account is created with a one-time bearer token',
    service.status === 201 && Boolean(service.json?.token), `status=${service.status}`);

  const botLogin = await new Session('bot').request('POST', '/api/v1/auth/login', {
    username: 'acceptance-bot', password: PASSWORD_OTHER,
  });
  check('MU-14', 'a service account cannot log in interactively',
    botLogin.status === 401, `status=${botLogin.status}`);

  const revoked = await owner.request('DELETE', `/api/v1/admin/service-tokens/${service.json.tokenId}`);
  check('MU-15', 'a service token can be revoked', revoked.status === 200, `status=${revoked.status}`);

  // ---- MU-17..MU-20 : lifecycle -------------------------------------------------
  const aliceId = listed.json.users.find((u) => u.username === 'acceptance-alice')?.id;
  const disabled = await owner.request('POST', `/api/v1/admin/users/${aliceId}/disable`, {
    reason: 'acceptance',
  });
  check('MU-16', 'the Owner can disable a user', disabled.status === 200 && disabled.json?.status === 'disabled',
    `status=${disabled.status}`);

  const afterDisable = await users.alice.session.request('GET', '/api/v1/auth/me');
  check('MU-17', "a disabled user's live session stops working immediately",
    afterDisable.status === 401 || afterDisable.status === 403,
    `status=${afterDisable.status}`);

  const disabledLogin = await new Session('alice2').request('POST', '/api/v1/auth/login', {
    username: 'acceptance-alice', password: PASSWORD_OTHER,
  });
  check('MU-18', 'a disabled user cannot log in', disabledLogin.status === 401,
    `status=${disabledLogin.status}`);

  const reinstated = await owner.request('POST', `/api/v1/admin/users/${aliceId}/reinstate`, {});
  check('MU-19', 'a disabled user can be reinstated',
    reinstated.status === 200 && reinstated.json?.status === 'active', `status=${reinstated.status}`);

  const ownerId = owner.user?.id;
  const selfDisable = await owner.request('POST', `/api/v1/admin/users/${ownerId}/disable`, {});
  check('MU-20', 'the last owner cannot disable itself',
    selfDisable.status === 409, `status=${selfDisable.status} ${selfDisable.json?.error ?? ''}`);

  // ---- MU-21..MU-23 : export, erasure and audit ----------------------------------
  const bobId = listed.json.users.find((u) => u.username === 'acceptance-bob')?.id;
  const exported = await owner.request('GET', `/api/v1/admin/users/${bobId}/export`);
  check('MU-21', 'a per-user export is produced and excludes credentials',
    exported.status === 200 && exported.json?.credentialsIncluded === false
    && !exported.text.includes(PASSWORD_OTHER),
    `status=${exported.status}`);

  const erased = await owner.request('DELETE', `/api/v1/admin/users/${bobId}`, { reason: 'acceptance' });
  check('MU-22', 'a user can be erased and is anonymised in place',
    erased.status === 200 && erased.json?.anonymisedInPlace === true, `status=${erased.status}`);

  const events = await owner.request('GET', '/api/v1/admin/events?limit=200');
  const actions = new Set((events.json?.events ?? []).map((e) => e.action));
  check('MU-23', 'every administrative action is in the administrative audit trail',
    ['user.invited', 'user.created', 'user.disabled', 'user.reinstated', 'user.erased']
      .every((action) => actions.has(action)),
    [...actions].join(', '));

  // ---- MU-24..MU-26 : local model runtime ----------------------------------------
  const modelStatus = await owner.request('GET', '/api/v1/runtime/local-model');
  check('MU-24', 'the local model runtime is disabled by default on a fresh installation',
    modelStatus.json?.mode === 'disabled' && modelStatus.json?.inProcessInference === false,
    JSON.stringify(modelStatus.json));

  const profiles = await owner.request('GET', '/api/v1/runtime/local-model/profiles');
  check('MU-25', 'no accelerator is queried while the runtime is disabled',
    profiles.json?.detection?.inspected === false,
    `inspected=${profiles.json?.detection?.inspected} reason=${profiles.json?.detection?.reason}`);

  const remoteEndpoint = await owner.request('PUT', '/api/v1/runtime/local-model', {
    mode: 'auto', endpoint: 'http://198.51.100.10:8080',
  });
  check('MU-26', 'a non-loopback local model endpoint is refused',
    remoteEndpoint.status === 400, `status=${remoteEndpoint.status} ${remoteEndpoint.json?.error ?? ''}`);

  // ---- MU-27..MU-28 : database surface --------------------------------------------
  const database = await owner.request('GET', '/api/v1/database/status');
  check('MU-27', 'the database reports PostgreSQL 18 with pgvector and RLS',
    database.json?.health?.serverVersionNumber >= 180000
    && Boolean(database.json?.health?.pgvectorVersion)
    && database.json?.health?.checks?.rowLevelSecurity === true,
    `${database.json?.health?.serverVersion} pgvector=${database.json?.health?.pgvectorVersion} rls=${database.json?.health?.rlsTables}`);

  const userDatabase = await users.bob.session.request('GET', '/api/v1/database/status');
  check('MU-28', 'an ordinary user cannot read database internals',
    userDatabase.status === 401 || userDatabase.status === 403, `status=${userDatabase.status}`);
}

main()
  .then(() => {
    const passed = results.filter((r) => r.status === 'PASS').length;
    process.stdout.write(`\nMULTI_USER_ACCEPTANCE ${passed}/${results.length} PASS, ${failures} FAIL\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    process.stdout.write(`\nFATAL ${error?.stack ?? error}\n`);
    process.exit(2);
  });
