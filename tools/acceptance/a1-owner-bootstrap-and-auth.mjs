// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 4 acceptance — Owner bootstrap, MFA, RBAC, session, brute force, step-up.
//
// Runs against a throwaway instance. Every credential here is synthetic and is
// generated at run time; nothing is read from or written to a tracked file.
//
//   node tools/acceptance/a1-owner-bootstrap-and-auth.mjs http://127.0.0.1:8111 <workspace-dir>
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client, Results } from './client.mjs';
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:8111';
const workspace = process.argv[3];
const r = new Results('AUTH');

// Synthetic, per-run, never persisted anywhere by this script.
const OWNER = {
  username: 'acceptance-owner',
  displayName: 'Acceptance Owner',
  password: `acc-${randomBytes(18).toString('base64url')}`,
};
const setupToken = readFileSync(`${workspace}/config/first-owner-setup.token`, 'utf8').trim();

const c = new Client(base);
let totpSecret = null;

// Since F4-002 a TOTP code is single-use, so a suite that reuses one code across two
// flows now fails as a replay — correctly, but for a reason the test did not intend.
//
// Fabricating a future code does not work either: the acceptance window is +/-1 step, so
// a code two steps ahead is simply invalid. The only faithful way to obtain an unspent
// code is the one a real operator uses — wait for the authenticator to roll over. That
// costs up to 30 s per code and is worth it: it exercises the real clock, and a test that
// cheats around single-use would not be testing single-use.
const STEP_SECONDS = 30;
const currentStep = () => Math.floor(Date.now() / 1000 / STEP_SECONDS);
let lastSpentStep = null;
async function freshCode() {
  while (lastSpentStep !== null && currentStep() <= lastSpentStep) {
    const msToNextStep = (STEP_SECONDS - (Math.floor(Date.now() / 1000) % STEP_SECONDS)) * 1000 + 250;
    await new Promise((resolve) => setTimeout(resolve, msToNextStep));
  }
  lastSpentStep = currentStep();
  return totpCode(totpSecret);
}

await r.check('AUTH-01', 'unauthenticated protected route is refused', async () => {
  const res = await c.get('/api/v1/projects');
  return { verdict: res.status === 401 ? 'PASS' : 'FAIL', evidence: `GET /api/v1/projects -> ${res.status} ${res.text.slice(0, 80)}` };
});

await r.check('AUTH-02', 'setup is refused without the setup token', async () => {
  const res = await c.post('/api/v1/auth/setup', { username: OWNER.username, password: OWNER.password });
  return { verdict: res.status === 403 ? 'PASS' : 'FAIL', evidence: `no token -> ${res.status} ${res.text.slice(0, 90)}` };
});

await r.check('AUTH-03', 'setup is refused with a wrong setup token', async () => {
  const res = await c.post('/api/v1/auth/setup', { username: OWNER.username, password: OWNER.password }, {
    headers: { 'x-noesar-setup-token': randomBytes(32).toString('base64url') },
  });
  return { verdict: res.status === 403 ? 'PASS' : 'FAIL', evidence: `wrong token -> ${res.status}` };
});

await r.check('AUTH-04', 'weak password is refused by policy', async () => {
  const res = await c.post('/api/v1/auth/setup', { username: OWNER.username, password: 'short' }, {
    headers: { 'x-noesar-setup-token': setupToken },
  });
  return { verdict: res.status === 400 ? 'PASS' : 'FAIL', evidence: `weak password -> ${res.status} ${res.text.slice(0, 110)}` };
});

let challenge = null;
await r.check('AUTH-05', 'setup with the real token returns a TOTP enrolment secret', async () => {
  const res = await c.post('/api/v1/auth/setup', OWNER, { headers: { 'x-noesar-setup-token': setupToken } });
  challenge = res.json?.challenge;
  totpSecret = res.json?.totpSecret;
  const hasUri = String(res.json?.otpauthUri ?? '').startsWith('otpauth://totp/');
  return {
    verdict: res.status === 201 && challenge && totpSecret && hasUri ? 'PASS' : 'FAIL',
    evidence: `-> ${res.status}; secret length ${totpSecret?.length}; otpauth uri present ${hasUri}; expires ${res.json?.expiresAt}`,
  };
});

await r.check('AUTH-06', 'setup confirm is refused with a wrong TOTP code', async () => {
  const res = await c.post('/api/v1/auth/setup/confirm', { challenge, totpCode: '000000' });
  return { verdict: res.status === 403 ? 'PASS' : 'FAIL', evidence: `wrong code -> ${res.status}` };
});

await r.check('AUTH-07', 'setup confirm is refused with a wrong challenge', async () => {
  const res = await c.post('/api/v1/auth/setup/confirm', { challenge: randomBytes(24).toString('base64url'), totpCode: totpCode(totpSecret) });
  return { verdict: res.status === 403 ? 'PASS' : 'FAIL', evidence: `wrong challenge -> ${res.status}` };
});

await r.check('AUTH-08', 'setup confirm with the correct TOTP creates the owner and a session', async () => {
  const res = await c.post('/api/v1/auth/setup/confirm', { challenge, totpCode: await freshCode() });
  const cookieNames = (res.headers['set-cookie'] ?? []).map((v) => String(v).split('=')[0]);
  const httpOnly = (res.headers['set-cookie'] ?? []).some((v) => /noesar_session=/.test(v) && /HttpOnly/i.test(v) && /SameSite=Strict/i.test(v));
  // Setup is one of only two moments recovery codes can EVER be shown, so the assertion belongs
  // where the browser sees them and not where the service returns them. `confirmSetup` handed
  // over ten and `sessionResponse` — which builds its own body — dropped them silently; the unit
  // tests stayed green throughout, because the loss happens a floor above what they exercise
  // (D-0369). Checked here, over HTTP, which is the only place it was ever visible.
  const codes = res.json?.recoveryCodes ?? [];
  const shaped = codes.length === 10 && codes.every((code) => /^[0-9A-HJ-NP-TV-Z]{5}-[0-9A-HJ-NP-TV-Z]{5}$/.test(code));
  return {
    verdict: res.status === 201 && res.json?.user?.role === 'owner' && httpOnly && shaped ? 'PASS' : 'FAIL',
    evidence: `-> ${res.status}; role ${res.json?.user?.role}; mfaEnabled ${res.json?.user?.mfaEnabled}; cookies ${cookieNames}; session cookie HttpOnly+SameSite=Strict ${httpOnly}; recovery codes delivered ${codes.length}, well-formed ${shaped}`,
  };
});

await r.check('AUTH-09', 'the session is usable and reports the owner', async () => {
  const res = await c.get('/api/v1/auth/me');
  return { verdict: res.status === 200 && res.json?.user?.role === 'owner' ? 'PASS' : 'FAIL', evidence: `-> ${res.status} ${JSON.stringify(res.json?.user)}` };
});

await r.check('AUTH-10', 'the setup token is single-use: a second setup attempt is refused', async () => {
  const res = await c.post('/api/v1/auth/setup', { username: 'second-owner', password: `acc-${randomBytes(18).toString('base64url')}` }, {
    headers: { 'x-noesar-setup-token': setupToken },
  });
  return { verdict: res.status === 409 ? 'PASS' : 'FAIL', evidence: `replayed setup -> ${res.status} ${res.text.slice(0, 90)}` };
});

await r.check('AUTH-11', 'auth status now reports initialized and authentication required', async () => {
  const res = await c.get('/api/v1/auth/status');
  const s = res.json ?? {};
  return {
    verdict: s.initialized === true && s.authenticationRequired === true && s.setupTokenRequired === false ? 'PASS' : 'FAIL',
    evidence: JSON.stringify(s),
  };
});

await r.check('AUTH-12', 'a write without the CSRF header is refused', async () => {
  const res = await c.post('/api/v1/projects', { name: 'csrf-probe' }, { headers: { 'x-noesar-csrf': '' }, csrf: false });
  return { verdict: res.status === 403 ? 'PASS' : 'FAIL', evidence: `no csrf header -> ${res.status} ${res.text.slice(0, 90)}` };
});

await r.check('AUTH-13', 'a write with a forged CSRF header is refused', async () => {
  const res = await c.post('/api/v1/projects', { name: 'csrf-probe' }, { headers: { 'x-noesar-csrf': randomBytes(24).toString('base64url') }, csrf: false });
  return { verdict: res.status === 403 ? 'PASS' : 'FAIL', evidence: `forged csrf -> ${res.status}` };
});

await r.check('AUTH-14', 'a write with the correct CSRF header succeeds', async () => {
  const res = await c.post('/api/v1/projects', { name: 'csrf-ok' });
  return { verdict: res.status === 201 ? 'PASS' : 'FAIL', evidence: `-> ${res.status} id ${res.json?.id}` };
});

// --- login path ------------------------------------------------------------
const fresh = new Client(base);
await r.check('AUTH-15', 'login with a wrong password is refused', async () => {
  const res = await fresh.post('/api/v1/auth/login', { username: OWNER.username, password: 'definitely-not-the-password' });
  return { verdict: res.status === 401 ? 'PASS' : 'FAIL', evidence: `-> ${res.status} ${res.text.slice(0, 80)}` };
});

let loginChallenge = null;
await r.check('AUTH-16', 'login with the correct password demands MFA and does not issue a session', async () => {
  const res = await fresh.post('/api/v1/auth/login', { username: OWNER.username, password: OWNER.password });
  loginChallenge = res.json?.challenge;
  const noSession = !(res.headers['set-cookie'] ?? []).some((v) => /noesar_session=[^;]+/.test(v));
  const me = await fresh.get('/api/v1/auth/me');
  return {
    verdict: res.status === 202 && res.json?.mfaRequired === true && loginChallenge && noSession && me.status === 401 ? 'PASS' : 'FAIL',
    evidence: `-> ${res.status} mfaRequired ${res.json?.mfaRequired}; no session cookie ${noSession}; /auth/me while pending -> ${me.status}`,
  };
});

await r.check('AUTH-17', 'MFA with a wrong code is refused', async () => {
  const res = await fresh.post('/api/v1/auth/login/mfa', { challenge: loginChallenge, totpCode: '000000' });
  return { verdict: res.status === 401 ? 'PASS' : 'FAIL', evidence: `-> ${res.status}` };
});

let usedCode = null;
await r.check('AUTH-18', 'MFA with the correct code completes the login', async () => {
  usedCode = await freshCode();
  const res = await fresh.post('/api/v1/auth/login/mfa', { challenge: loginChallenge, totpCode: usedCode });
  return { verdict: res.status === 200 && res.json?.user?.role === 'owner' ? 'PASS' : 'FAIL', evidence: `-> ${res.status} user ${res.json?.user?.username}` };
});

await r.check('AUTH-19', 'a replayed TOTP code is refused (RFC 6238 section 5.2)', async () => {
  // A second, independent login with the SAME code that already succeeded once.
  const replay = new Client(base);
  const begin = await replay.post('/api/v1/auth/login', { username: OWNER.username, password: OWNER.password });
  const res = await replay.post('/api/v1/auth/login/mfa', { challenge: begin.json?.challenge, totpCode: usedCode });
  const accepted = res.status === 200;
  return {
    verdict: accepted ? 'FAIL' : 'PASS',
    evidence: `same code ${usedCode.replace(/\d/g, '*')} reused on a second login -> ${res.status}${accepted ? ' (ACCEPTED: replay window open)' : ' (rejected)'}`,
  };
});

await r.check('AUTH-20', 'the login challenge is single-use', async () => {
  const res = await fresh.post('/api/v1/auth/login/mfa', { challenge: loginChallenge, totpCode: await freshCode() });
  return { verdict: res.status === 401 ? 'PASS' : 'FAIL', evidence: `reused challenge -> ${res.status}` };
});

await r.check('AUTH-21', 'repeated failures lock the account and the limiter fires', async () => {
  const attacker = new Client(base);
  const codes = [];
  for (let i = 0; i < 10; i += 1) {
    const res = await attacker.post('/api/v1/auth/login', { username: OWNER.username, password: `wrong-${i}` });
    codes.push(res.status);
  }
  const locked = codes.filter((s) => s === 401).length;
  const limited = codes.filter((s) => s === 429).length;
  return {
    verdict: limited > 0 ? 'PASS' : 'FAIL',
    evidence: `10 wrong passwords -> ${locked}x401 then ${limited}x429; statuses ${codes.join(',')}`,
  };
});

await r.check('AUTH-22', 'a correct password is still refused while the account is locked', async () => {
  const late = new Client(base);
  const res = await late.post('/api/v1/auth/login', { username: OWNER.username, password: OWNER.password });
  return { verdict: [401, 429].includes(res.status) ? 'PASS' : 'FAIL', evidence: `correct password during lockout -> ${res.status} ${res.text.slice(0, 80)}` };
});

// --- step-up authentication for a critical action --------------------------
await r.check('AUTH-23', 'a critical action is refused without recent strong reauthentication', async () => {
  const plan = await c.post('/api/v1/coden/path-plan', { mode: 'OWNER_BYPASS', operation: 'read', path: `${workspace}/state` });
  if (plan.status !== 200) return { verdict: 'BLOCKED', evidence: `path-plan -> ${plan.status} ${plan.text.slice(0, 120)}` };
  const res = await c.post('/api/v1/coden/authorize', { plan: plan.json, consentScope: 'acceptance' });
  return {
    verdict: res.status === 403 && /reauthentication/i.test(res.text) ? 'PASS' : 'FAIL',
    evidence: `OWNER_BYPASS authorize without elevation -> ${res.status} ${res.text.slice(0, 110)}`,
  };
});

await r.check('AUTH-24', 'step-up reauthentication is refused with wrong credentials', async () => {
  // A failed attempt does not spend the step, so this may reuse the current one.
  const res = await c.post('/api/v1/auth/reauth', { password: 'wrong', totpCode: totpCode(totpSecret) });
  return { verdict: res.status === 403 ? 'PASS' : 'FAIL', evidence: `-> ${res.status}` };
});

await r.check('AUTH-25', 'step-up reauthentication elevates the session and unlocks the action', async () => {
  const up = await c.post('/api/v1/auth/reauth', { password: OWNER.password, totpCode: await freshCode() });
  if (up.status !== 200) return { verdict: 'FAIL', evidence: `reauth -> ${up.status} ${up.text.slice(0, 120)}` };
  const plan = await c.post('/api/v1/coden/path-plan', { mode: 'OWNER_BYPASS', operation: 'read', path: `${workspace}/state` });
  const res = await c.post('/api/v1/coden/authorize', { plan: plan.json, consentScope: 'acceptance' });
  return {
    verdict: res.status === 201 ? 'PASS' : 'FAIL',
    evidence: `reauth -> 200 elevatedUntil ${up.json?.expiresAt}; authorize -> ${res.status} ${res.json?.id ? 'approval issued' : res.text.slice(0, 90)}`,
  };
});

await r.check('AUTH-26', 'logout invalidates the session', async () => {
  const out = await c.post('/api/v1/auth/logout');
  const after = await c.get('/api/v1/auth/me', { cookies: true });
  return { verdict: out.status === 200 && after.status === 401 ? 'PASS' : 'FAIL', evidence: `logout -> ${out.status}; /auth/me after -> ${after.status}` };
});

await r.check('AUTH-27', 'a stolen session token is useless after logout', async () => {
  const stolen = new Client(base);
  stolen.cookies = new Map(c.cookies);
  const res = await stolen.get('/api/v1/auth/me');
  return { verdict: res.status === 401 ? 'PASS' : 'FAIL', evidence: `replayed cookie after logout -> ${res.status}` };
});

const counts = r.summary();
process.stdout.write(`TSV_START\n${r.tsv()}\nTSV_END\n`);
process.exit(counts.FAIL ? 1 : 0);
