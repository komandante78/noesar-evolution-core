// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../services/reference-control-plane/src/auth-crypto.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-auth-http-'));
const port = Number(process.env.NOESAR_SMOKE_PORT ?? 18984);
const setupToken = 'test-setup-token-value';
const child = spawn(process.execPath, ['services/reference-control-plane/src/server.mjs'], {
  cwd:root,
  env:{ ...process.env, NOESAR_WORKSPACE:workspace, NOESAR_HOST:'127.0.0.1', NOESAR_PORT:String(port), NOESAR_SETUP_TOKEN:setupToken, NOESAR_ALLOWED_HOSTS:'127.0.0.1,localhost' },
  stdio:['ignore','pipe','pipe'],
});

let cookie = '';
let csrf = '';
function captureCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const pairs = values.map((value) => value.split(';')[0]);
  if (pairs.length) cookie = pairs.join('; ');
}
async function request(path, { method='GET', value, headers={} }={}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers:{ ...(value ? {'content-type':'application/json'} : {}), ...(cookie ? {cookie} : {}), ...(csrf ? {'x-noesar-csrf':csrf} : {}), ...headers },
    body:value ? JSON.stringify(value) : undefined,
  });
  captureCookies(response);
  const data = await response.json();
  return { status:response.status, data, headers:response.headers };
}

try {
  for (let attempt=0; attempt<60; attempt+=1) {
    try { const health = await request('/healthz'); if (health.status === 200) break; } catch {}
    await sleep(100);
  }
  const unauth = await request('/api/v1/hardware');
  if (unauth.status !== 401) throw new Error(`hardware unauthenticated status ${unauth.status}`);

  const begin = await request('/api/v1/auth/setup', {
    method:'POST',
    headers:{'x-noesar-setup-token':setupToken},
    value:{ username:'owner', displayName:'Owner', password:'correct horse battery staple' },
  });
  if (begin.status !== 201) throw new Error(JSON.stringify(begin));
  const confirm = await request('/api/v1/auth/setup/confirm', {
    method:'POST', value:{ challenge:begin.data.challenge, totpCode:totpCode(begin.data.totpSecret) },
  });
  if (confirm.status !== 201) throw new Error(JSON.stringify(confirm));
  csrf = confirm.data.csrfToken;

  const bootstrap = await request('/api/v1/bootstrap');
  if (bootstrap.status !== 200 || bootstrap.data.user.role !== 'owner') throw new Error('bootstrap auth failed');

  const noCsrfValue = csrf; csrf = '';
  const csrfDenied = await request('/api/v1/runtime/recommendation', { method:'POST', value:{ modelBillions:7 } });
  if (csrfDenied.status !== 403) throw new Error(`CSRF expected 403, got ${csrfDenied.status}`);
  csrf = noCsrfValue;

  const plan = await request('/api/v1/coden/path-plan', { method:'POST', value:{ path:'project', operation:'write', mode:'OWNER_BYPASS' } });
  if (plan.status !== 200 || !plan.data.requiresStrongReauthentication) throw new Error('Owner plan failed');
  const denied = await request('/api/v1/coden/authorize', { method:'POST', value:{ plan:plan.data, consentScope:'ONE_OPERATION', durationMinutes:15 } });
  if (denied.status !== 403) throw new Error('Owner authorization should require reauth');

  const reauth = await request('/api/v1/auth/reauth', { method:'POST', value:{ password:'correct horse battery staple', totpCode:totpCode(begin.data.totpSecret) } });
  if (reauth.status !== 200) throw new Error(JSON.stringify(reauth));
  const approved = await request('/api/v1/coden/authorize', { method:'POST', value:{ plan:plan.data, consentScope:'ONE_OPERATION', durationMinutes:15 } });
  if (approved.status !== 201) throw new Error(JSON.stringify(approved));

  const audit = await request('/api/v1/audit');
  if (audit.status !== 200 || audit.data.valid !== true) throw new Error('audit verification failed');

  const authFile = readFileSync(join(workspace, 'state/auth.json'), 'utf8');
  if (authFile.includes('correct horse battery staple')) throw new Error('plaintext password detected');
  if (authFile.includes(cookie.split('=')[1]?.split(';')[0] ?? 'impossible')) throw new Error('plaintext session token detected');

  const logout = await request('/api/v1/auth/logout', { method:'POST', value:{} });
  if (logout.status !== 200) throw new Error('logout failed');
  const after = await request('/api/v1/bootstrap');
  if (after.status !== 401) throw new Error('session remained active after logout');
  console.log('AUTH_HTTP_SMOKE=PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  rmSync(workspace, { recursive:true, force:true });
}
