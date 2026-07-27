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

  // A TOTP code is accepted at most once (RFC 6238 5.2), so reauthentication cannot reuse the
  // code the login above already spent: within one 30s step totpCode() returns the same digits
  // and the server correctly rejects it as a replay. Ask for the NEXT step instead — a
  // different code, still inside the server's +/-1 step window, and no 30-second sleep here.
  const reauth = await request('/api/v1/auth/reauth', { method:'POST', value:{ password:'correct horse battery staple', totpCode:totpCode(begin.data.totpSecret, Date.now() + 30_000) } });
  if (reauth.status !== 200) throw new Error(JSON.stringify(reauth));
  const approved = await request('/api/v1/coden/authorize', { method:'POST', value:{ plan:plan.data, consentScope:'ONE_OPERATION', durationMinutes:15 } });
  if (approved.status !== 201) throw new Error(JSON.stringify(approved));

  const audit = await request('/api/v1/audit');
  if (audit.status !== 200 || audit.data.valid !== true) throw new Error('audit verification failed');

  // The reasoning seam, against a real running server. A unit test proves the provider
  // computes; only this proves the product answers.
  const reasoning = await request('/api/v1/reasoning');
  if (reasoning.status !== 200) throw new Error(JSON.stringify(reasoning));
  if (reasoning.data.mode !== 'reference-node') throw new Error('reasoning mode is not the reference');
  if (reasoning.data.atomRequired !== false) throw new Error('the core must not require ATOM');
  if (reasoning.data.mandatorySurfaces?.length !== 11) throw new Error('eleven surfaces are mandatory');

  const reasoned = await request('/api/v1/reasoning/plan', {
    method:'POST',
    value:{ request:'Repair the parser. It drops trailing commas.', policy:'restrictive' },
  });
  if (reasoned.status !== 200) throw new Error(JSON.stringify(reasoned));
  if (reasoned.data.intent?.goal !== 'Repair the parser') throw new Error('the goal must be quoted, not paraphrased');
  if (reasoned.data.hypotheses?.[0]?.contrary !== 'NOT_SOUGHT') throw new Error('nothing looked for a counter-example and it must say so');
  if (!(reasoned.data.confidence?.value <= 0.6)) throw new Error('a provider with no model must not approach certainty');
  // This plan names no file and no test, so nothing about it could turn out to be false.
  // The refusal is the correct answer and must be reported, not swallowed into a null.
  if (!reasoned.data.expectationRefused) throw new Error('an unfalsifiable plan must say so');

  const refused = await request('/api/v1/reasoning/plan', { method:'POST', value:{ request:'   ' } });
  if (refused.status !== 422) throw new Error('an empty request must be refused, not answered');

  // Capability tokens, against the running server.
  const capability = await request('/api/v1/capability');
  if (capability.status !== 200) throw new Error(JSON.stringify(capability));
  if (capability.data.adaptersMaySelfGrant !== false) throw new Error('an adapter must not be able to self-grant');
  if (capability.data.executorEnforcesTokens !== false) throw new Error('the status must not claim an executor that does not exist');

  const nowUnix = Math.floor(Date.now() / 1000);
  const capPlan = {
    mode:'safe', constraints:[],
    steps:[{ id:'a', description:'repair', files:['src/a.rs'], commands:[], dependsOn:[],
      blastRadius:{ paths:['src/a.rs'], reachesOutsideWorkspace:false, destructive:false } }],
  };
  const capApproval = { approverId:'owner-001', grantedAtUnix:nowUnix, expiresAtUnix:nowUnix + 3600, scopeNote:'smoke' };

  const minted = await request('/api/v1/capability/mint', { method:'POST', value:{
    plan:capPlan, approval:capApproval,
    request:{ stepId:'a', paths:['src/a.rs'], operations:['WRITE'], uses:1, expiresAtUnix:nowUnix + 600 },
  } });
  if (minted.status !== 201) throw new Error(JSON.stringify(minted));
  if (!minted.data.token?.mac) throw new Error('a token must carry its MAC');

  // Widening the token by hand is the obvious attack; the MAC is what answers it.
  const forged = { ...minted.data.token, paths:[...minted.data.token.paths, 'src/secret.rs'] };
  const forgedSpend = await request('/api/v1/capability/spend', { method:'POST', value:{
    token:forged, attempt:{ path:'src/secret.rs', operation:'WRITE' } } });
  if (forgedSpend.status !== 422) throw new Error('a token edited after issue must not verify');

  const spend = await request('/api/v1/capability/spend', { method:'POST', value:{
    token:minted.data.token, attempt:{ path:'src/a.rs', operation:'WRITE' } } });
  if (spend.status !== 200 || spend.data.spent !== true) throw new Error(JSON.stringify(spend));
  const again = await request('/api/v1/capability/spend', { method:'POST', value:{
    token:minted.data.token, attempt:{ path:'src/a.rs', operation:'WRITE' } } });
  if (again.status !== 422) throw new Error('a single-use token must not spend twice');

  // A path the step never named must not be mintable, whatever the caller asks for.
  const widened = await request('/api/v1/capability/mint', { method:'POST', value:{
    plan:capPlan, approval:capApproval,
    request:{ stepId:'a', paths:['src/secret.rs'], operations:['READ'], uses:1, expiresAtUnix:nowUnix + 600 },
  } });
  if (widened.status !== 422 || widened.data.kind !== 'OUT_OF_SCOPE') throw new Error(JSON.stringify(widened));

  // Shadow execution, against the running server.
  const shadow = await request('/api/v1/shadow');
  if (shadow.status !== 200) throw new Error(JSON.stringify(shadow));
  if (shadow.data.copyOnWrite !== false) throw new Error('the status must not claim copy-on-write');
  if (shadow.data.executesPlans !== false) throw new Error('the status must not claim an executor that does not exist');

  const clean = await request('/api/v1/shadow/compare', { method:'POST', value:{
    expectation:{ pathsTheDiffMustTouch:['src/a.rs'], testsExpectedToPass:['cargo test'], testsExpectedToFail:[] },
    observation:{ changed:{ 'src/a.rs':'MODIFIED' }, tests:[{ name:'cargo test', passed:true }] },
  } });
  if (clean.status !== 200 || clean.data.clean !== true) throw new Error(JSON.stringify(clean));

  // The dangerous direction: something happened that nobody declared.
  const surprised = await request('/api/v1/shadow/compare', { method:'POST', value:{
    expectation:{ pathsTheDiffMustTouch:['src/a.rs'], testsExpectedToPass:[], testsExpectedToFail:[] },
    observation:{ changed:{ 'src/a.rs':'MODIFIED', 'src/secret.rs':'MODIFIED' }, tests:[] },
  } });
  if (surprised.status !== 200 || surprised.data.clean !== false) throw new Error(JSON.stringify(surprised));
  if (surprised.data.unexpected?.[0] !== 'src/secret.rs') throw new Error('an undeclared change must be named');

  const nothing = await request('/api/v1/shadow/compare', { method:'POST', value:{
    expectation:{ pathsTheDiffMustTouch:['src/a.rs'], testsExpectedToPass:[], testsExpectedToFail:[] },
    observation:{ changed:{}, tests:[] },
  } });
  if (nothing.status !== 422) throw new Error('an observation of nothing must be refused, not called clean');

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
