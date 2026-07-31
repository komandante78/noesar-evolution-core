// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0279. Mint a NOESAR service-account bearer token from the command line.
//
// `POST /api/v1/admin/service-accounts` needs an owner or admin session, `user.manage`,
// and a CSRF header — three things a person cannot reasonably assemble with curl by hand,
// which is why the capability existed and nobody used it. This walks the real login flow
// (password, then TOTP) over plain HTTP, exactly as the browser does, and prints the token
// once. Nothing is stored: no session file, no token file, no history entry beyond what
// the shell itself keeps.
//
// The token is shown ONCE, by the server's own design. Put it straight into the consuming
// deployment's environment; it cannot be read back afterwards, only revoked and reissued.
//
// Usage:
//   node tools/mint-service-token.mjs --base http://192.168.178.100:8100 \
//        --username koma78 --name "debug-evolution"
//
// The password and the TOTP code are read from the terminal, never from argv — an
// argument is visible in the process table to every other user on the machine.

import { createInterface } from 'node:readline';
import { stdin, stdout, argv, exit } from 'node:process';

function arg(name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  return index > -1 && argv[index + 1] ? argv[index + 1] : fallback;
}

const BASE = String(arg('base', 'http://127.0.0.1:8088')).replace(/\/$/, '');
const USERNAME = arg('username');
const TOKEN_NAME = arg('name', 'service');
const TTL_DAYS = arg('ttl-days');

if (!USERNAME) {
  console.error('usage: node tools/mint-service-token.mjs --base <url> --username <owner> [--name <label>] [--ttl-days <n>]');
  exit(2);
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input:stdin, output:stdout, terminal:true });
    if (hidden) {
      // Suppress the echo of what is typed without suppressing the prompt itself.
      const write = rl._writeToOutput?.bind(rl);
      rl._writeToOutput = (chunk) => {
        if (chunk.includes(question)) write?.(chunk);
        else stdout.write('');
      };
    }
    rl.question(question, (value) => { rl.close(); if (hidden) stdout.write('\n'); resolve(value.trim()); });
  });
}

async function call(path, { method = 'GET', body = null, cookie = null, csrf = null } = {}) {
  const headers = { 'content-type':'application/json' };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-noesar-csrf'] = csrf;
  const response = await fetch(`${BASE}${path}`, {
    method, headers, body:body ? JSON.stringify(body) : undefined,
    signal:AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw:text }; }
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${payload.error ?? text.slice(0, 300)}`);
  }
  return { payload, setCookie:response.headers.getSetCookie?.() ?? [] };
}

const password = await ask('NOESAR password: ', { hidden:true });
const begun = await call('/api/v1/auth/login', { method:'POST', body:{ username:USERNAME, password } });
if (!begun.payload.challenge) throw new Error('the server did not issue a login challenge');

const totpCode = await ask('TOTP code: ');
const completed = await call('/api/v1/auth/login/mfa', {
  method:'POST', body:{ challenge:begun.payload.challenge, totpCode },
});

// The session cookie the browser would keep, reduced to the name=value pairs a
// subsequent request must send back.
const cookie = completed.setCookie.map((item) => item.split(';')[0]).join('; ');
const csrf = completed.payload.csrfToken;
if (!cookie || !csrf) throw new Error('login succeeded but returned no session cookie or CSRF token');
console.error(`authenticated as ${completed.payload.user.username} (${completed.payload.user.role})`);

const created = await call('/api/v1/admin/service-accounts', {
  method:'POST', cookie, csrf,
  body:{ username:TOKEN_NAME, displayName:TOKEN_NAME, name:TOKEN_NAME, ttlDays:TTL_DAYS ? Number(TTL_DAYS) : null },
});

await call('/api/v1/auth/logout', { method:'POST', cookie, csrf }).catch(() => {});

// Everything the operator needs, and the token on its own line so it can be piped.
console.error(JSON.stringify({ ...created.payload, token:'[printed below]' }, null, 2));
console.log(created.payload.token ?? created.payload.serviceToken ?? '');
