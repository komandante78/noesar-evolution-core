// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { totpCode } from '../services/reference-control-plane/src/auth-crypto.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-auth-http-'));
const port = Number(process.env.NOESAR_SMOKE_PORT ?? 18984);
const setupToken = 'test-setup-token-value';
const child = spawn(process.execPath, ['services/reference-control-plane/src/server.mjs'], {
  cwd:root,
  // NOESAR_CODEV_PEER_SOCKET_PATH inside this run's own temp workspace: without it the
  // spawned server binds the PRODUCTION default (/run/codev-peer.sock) on whatever machine
  // runs this smoke test, and unlinks whatever was there. Guarded by
  // socket-path-isolation.test.mjs.
  env:{ ...process.env, NOESAR_WORKSPACE:workspace, NOESAR_HOST:'127.0.0.1', NOESAR_PORT:String(port), NOESAR_SETUP_TOKEN:setupToken, NOESAR_ALLOWED_HOSTS:'127.0.0.1,localhost', NOESAR_CODEV_PEER_SOCKET_PATH:join(workspace,'codev-peer.sock') },
  stdio:['ignore','pipe','pipe'],
});

/**
 * One request/response over the product's unix socket, framed the way the real client
 * frames it: one JSON object per newline, and the server's first line is its handshake.
 * Resolves the raw frame — a refusal is an ANSWER here, not a throw, because the checks
 * below assert on refusals as much as on successes.
 */
function socketCall(path, method, params) {
  return new Promise((resolveFrame, reject) => {
    const socket = connect(path);
    let buffer = '';
    let greeted = false;
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        if (!line) continue;
        const frame = JSON.parse(line);
        if (!greeted) {
          greeted = true;
          if (!frame.protocol) return reject(new Error('the socket did not open with a protocol handshake'));
          socket.write(`${JSON.stringify({ id:'smoke', method, params })}\n`);
          continue;
        }
        socket.end();
        return resolveFrame(frame);
      }
    });
  });
}

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

  // s336 — the model chooser's own two routes, smoked against a real listener because that is
  // the layer the defect would live in: `server.mjs` cannot be imported by a unit test (it opens
  // a listener and a workspace on import), so a route that exists in the source and answers 404
  // in reality is exactly the gap this file exists to close.
  const installed = await request('/api/v1/models/installed');
  if (installed.status !== 200) throw new Error(`models/installed expected 200, got ${installed.status}`);
  if (!Array.isArray(installed.data.models)) throw new Error('models/installed must answer with a models array');
  if (!('activeId' in installed.data)) throw new Error('models/installed must declare which model is active, even as null');
  // A throwaway workspace has no descriptors, so the honest answer is an empty list — asserted
  // as EMPTY rather than skipped, because "no models" and "the list could not be read" are the
  // two states the chooser draws differently and both must be reachable.
  if (installed.data.models.length !== 0) throw new Error('a fresh workspace should offer no startable model');

  const activateNoCsrf = (() => { const held = csrf; csrf = ''; return held; })();
  const activateDenied = await request('/api/v1/models/activate', { method:'POST', value:{ id:'anything' } });
  if (activateDenied.status !== 403) throw new Error(`models/activate without CSRF expected 403, got ${activateDenied.status}`);
  csrf = activateNoCsrf;
  const activateUnnamed = await request('/api/v1/models/activate', { method:'POST', value:{} });
  if (activateUnnamed.status !== 400) throw new Error(`models/activate with no id expected 400, got ${activateUnnamed.status}`);
  const activateUnknown = await request('/api/v1/models/activate', { method:'POST', value:{ id:'no-such-model' } });
  // 404 and not 500: an id nobody published is the caller's question answered, not a crash.
  if (activateUnknown.status !== 404) throw new Error(`models/activate with an unknown id expected 404, got ${activateUnknown.status}`);
  if (!/known to this installation/.test(activateUnknown.data.error ?? '')) {
    throw new Error(`models/activate refusal must say why: ${JSON.stringify(activateUnknown.data)}`);
  }

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
  if (capability.data.executorEnforcesTokens !== true) throw new Error('the executor exists and enforces tokens');
  // D-0190/D-0191: /api/v1/workspace-actions routes real writes through the executor now.
  if (capability.data.executorWiredToProductActions !== true) throw new Error('the status must claim the product routes changes through the executor — it does, via workspace-actions');

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
  // The claim must come from an attempt on this installation's own filesystem, and must
  // agree with the mechanism it names. Either answer is legitimate; an unmeasured one is not.
  if (shadow.data.measured !== true) throw new Error('the status must not claim an unmeasured mechanism');
  if (!['REFLINK_CLONE', 'FULL_COPY'].includes(shadow.data.mechanism)) {
    throw new Error(`unknown shadow mechanism ${shadow.data.mechanism}`);
  }
  if (shadow.data.copyOnWrite !== (shadow.data.mechanism === 'REFLINK_CLONE')) {
    throw new Error('the copy-on-write claim contradicts the mechanism it names');
  }
  if (shadow.data.coverage !== 'WHOLE_WORKSPACE') throw new Error('the shadow must cover the whole workspace');
  // D-0190/D-0191: workspace-actions executes an approved plan into a shadow like this one.
  if (shadow.data.executesPlans !== true) throw new Error('the status must claim a plan is executed into the shadow — it is, via workspace-actions');

  // F4-015: GET now serves a snapshot taken at startup rather than probing the filesystem
  // on every request. The explicit reprobe route is the only one left that writes.
  const reprobed = await request('/api/v1/shadow/reprobe', { method:'POST' });
  if (reprobed.status !== 200) throw new Error(JSON.stringify(reprobed));
  if (reprobed.data.measured !== true) throw new Error('a reprobe must not claim an unmeasured mechanism');
  if (reprobed.data.mechanism !== shadow.data.mechanism) {
    throw new Error('a reprobe of the same mount must agree with the startup probe');
  }
  const staleMethodRefused = await request('/api/v1/shadow/reprobe');
  if (staleMethodRefused.status !== 404) throw new Error('reprobe must not answer GET — that is exactly the shape this fix removes');

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

  const executor = await request('/api/v1/executor');
  if (executor.status !== 200) throw new Error(JSON.stringify(executor));
  if (executor.data.acceptsOnlyCapabilityTokens !== true) throw new Error('the executor must accept only tokens');
  if (executor.data.spendsBeforeEffect !== true) throw new Error('the token must be spent before the effect');
  if (executor.data.executionSurface !== false) throw new Error('the status must not claim an execution surface');

  const events = await request('/api/v1/events');
  if (events.status !== 200) throw new Error(JSON.stringify(events));
  if (events.data.chainValid !== true) throw new Error('the engine event chain must verify');
  // Flipped in D-0338, deliberately. It asserted `false` and was right to: the ledger lived in
  // memory. The assembled server now journals it, so `false` here would mean the wiring had
  // been lost — and `tools/restart-durability-smoke.mjs` proves the claim by actually killing
  // the process and starting it again, which is the only way this line earns its `true`.
  if (events.data.persistsAcrossRestart !== true) throw new Error('the engine ledger must survive a restart, and the status must say so');
  if (events.data.recoveredOnLoad !== null) throw new Error(`the ledger recovered a torn line on a fresh workspace: ${JSON.stringify(events.data.recoveredOnLoad)}`);
  if (events.data.replacesAuditLedger !== false) throw new Error('the engine ledger does not replace the audit trail');
  const verified = await request('/api/v1/events/verify');
  if (verified.status !== 200 || verified.data.valid !== true) throw new Error(JSON.stringify(verified));

  // D-0337 — one authentication, not two, proved END TO END against the running product:
  // minted over real HTTP by the session this smoke test has been using all along, then
  // spent on the real unix socket this same server is listening on. The unit tests prove
  // the arithmetic; only this proves the two transports are wired to the same AuthService
  // in the assembled server — the thing that can be true in auth.mjs and false in server.mjs.
  const socketPath = join(workspace, 'codev-peer.sock');
  const attachMint = await request('/api/v1/auth/attach-code', { method:'POST', value:{} });
  if (attachMint.status !== 201) throw new Error(JSON.stringify(attachMint));
  if (!/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(attachMint.data.code ?? '')) {
    throw new Error(`attach code is not in the transcription-safe alphabet: ${attachMint.data.code}`);
  }
  if (readFileSync(join(workspace, 'state/auth.json'), 'utf8').includes(attachMint.data.code)) {
    throw new Error('plaintext attach code detected in the state file');
  }

  const attached = await socketCall(socketPath, 'auth.attach', { code:attachMint.data.code });
  if (!attached.ok) throw new Error(`attach over the socket failed: ${JSON.stringify(attached)}`);
  if (attached.result.user.username !== 'owner') throw new Error('the code opened a session for the wrong account');
  if (!Array.isArray(attached.result.permissions)) throw new Error('the attached terminal was told no permission set');

  const attachedTwice = await socketCall(socketPath, 'auth.attach', { code:attachMint.data.code });
  if (attachedTwice.ok) throw new Error('a single-use attach code was spent twice');

  // The absence that IS the design: minting is an HTTP route, spending is not. A network
  // endpoint that redeemed codes would hand an unauthenticated caller something to grind
  // against, which a ticket with no address binding cannot afford.
  for (const path of ['/api/v1/auth/attach', '/api/v1/auth/attach-code/redeem']) {
    const spendOverHttp = await request(path, { method:'POST', value:{ code:attachMint.data.code } });
    if (spendOverHttp.status !== 404) throw new Error(`${path} answered ${spendOverHttp.status}; redemption must not exist over HTTP`);
  }

  // Minting mutates, so it is CSRF-guarded like every other write on this surface.
  const keepCsrf = csrf; csrf = '';
  const attachNoCsrf = await request('/api/v1/auth/attach-code', { method:'POST', value:{} });
  if (attachNoCsrf.status !== 403) throw new Error(`minting without CSRF expected 403, got ${attachNoCsrf.status}`);
  csrf = keepCsrf;

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
