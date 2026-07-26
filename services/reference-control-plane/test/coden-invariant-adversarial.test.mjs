// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SEC-003 — "Owner bypass cannot disable invariants" (acceptance-matrix.yaml, severity
// blocker). The companion file `coden-path-authorization.test.mjs` closed the forgery
// half: the authorization record can no longer be minted from a caller-supplied plan.
// It deliberately left the other half open, and this file is that half.
//
// `createPathPlan` declares SEVEN invariants as `nonBypassableInvariants`. Before this
// suite, that name appeared in exactly one place in the entire codebase — the list that
// declares it. Nothing read it, nothing enforced it, nothing tested it. An invariant
// that is only a string in an array is a claim, not a mechanism.
//
// The matrix asks a specific question, so this suite asks it the same way: enter Owner
// Bypass **for real** (owner role + password + unreplayed authenticator code, so the
// elevation gate is genuinely open) and then attempt, once per invariant, to do the
// thing that invariant says cannot be done.
//
// Two of these attempts are not attacks on code but attacks on the claim itself. Where
// no mechanism exists at this layer, the honest repair is NOT to invent a keyword
// denylist — this project's own round-3 experiment established that a textual denylist
// is defeated by any indirection (`psql -f x.sql` never contains the forbidden verb),
// so shipping one would be building the thing the evidence disproved. The repair is that
// the product must not advertise enforcement it does not perform: every declared
// invariant must name where it is enforced, and an invariant enforced at a layer that is
// switched off must say so rather than appear in a list titled non-bypassable.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-invariant-adv-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server, watchdog } = await import('../src/server.mjs');
const { createPathPlan } = await import('../src/path-auth.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;
let totpSecret = null;

async function post(path, payload, extraHeaders = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-noesar-csrf': csrf } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, json, text, headers: response.headers };
}

/** Plan a path server-side, then submit that exact plan for authorization. */
async function planAndAuthorize(planRequest, consentScope = 'ONE_OPERATION') {
  const planned = await post('/api/v1/coden/path-plan', planRequest);
  if (planned.status !== 200) return { planned, authorized: null };
  const authorized = await post('/api/v1/coden/authorize', { plan: planned.json, consentScope });
  return { planned, authorized };
}

function ledgerRecords() {
  const path = join(workspace, 'audit/events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const begun = await post('/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': SETUP_TOKEN });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);
  totpSecret = begun.json.totpSecret;

  // Confirm on step -1 so that step 0 stays unspent for the elevation below; the replay
  // guard demands strictly increasing steps.
  const confirmed = await post('/api/v1/auth/setup/confirm', {
    challenge: begun.json.challenge,
    totpCode: totpCode(totpSecret, stepStart(-1)),
  });
  assert.equal(confirmed.status, 201, `setup confirm failed: ${confirmed.text.slice(0, 200)}`);

  const setCookie = confirmed.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = confirmed.json.csrfToken;

  // Enter Owner Bypass for real. Everything below runs from a genuinely elevated
  // session — otherwise the elevation gate, not the invariant, would be what refuses,
  // and the suite would prove nothing about the invariants at all.
  const elevated = await post('/api/v1/auth/reauth', {
    password: PASSWORD,
    totpCode: totpCode(totpSecret, stepStart(0)),
  });
  assert.equal(elevated.status, 200, `strong reauthentication failed: ${elevated.text.slice(0, 200)}`);
  assert.ok(elevated.json.elevatedUntil > Date.now(), 'the session must actually be elevated');
});

after(async () => {
  watchdog.stop();
  await new Promise((resolve) => server.close(resolve));
});

describe('SEC-003 · adversarial — one attempt per declared invariant, from inside Owner Bypass', () => {
  // ---------------------------------------------------------------- invariant 1 of 7
  test('credential_theft_prevention · Owner Bypass cannot reach the owner\'s SSH keys', async () => {
    const { planned, authorized } = await planAndAuthorize({
      mode: 'OWNER_BYPASS', operation: 'write', path: join(homedir(), '.ssh', 'authorized_keys'),
    });
    assert.equal(planned.status, 403, 'planning an SSH key write must be refused even in bypass');
    assert.equal(planned.json.blocked, true);
    assert.equal(authorized, null, 'nothing may be authorized once planning is blocked');
  });

  test('credential_theft_prevention · Owner Bypass cannot reach a protected system root', async () => {
    const planned = await post('/api/v1/coden/path-plan',
      { mode: 'OWNER_BYPASS', operation: 'write', path: '/etc/shadow' });
    assert.equal(planned.status, 403, 'bypass must not unblock a protected root');
    assert.equal(planned.json.blocked, true);

    // And the same path submitted straight to authorize, skipping the planner entirely.
    const authorized = await post('/api/v1/coden/authorize', {
      plan: { requestedPath: '/etc/shadow', operation: 'write', mode: 'OWNER_BYPASS', blocked: false, canonicalPath: '/etc/shadow' },
      consentScope: 'ONE_OPERATION',
    });
    assert.equal(authorized.status, 403, 'the recomputation must refuse it regardless of mode');
  });

  // ---------------------------------------------------------------- invariant 2 of 7
  test('destructive_action_confirmation · a recursive delete cannot be granted an unattended scope', async () => {
    const { planned, authorized } = await planAndAuthorize(
      { mode: 'OWNER_BYPASS', operation: 'delete', recursive: true, path: `${workspace}/project` },
      'PERSISTENT_FOLDER',
    );
    assert.equal(planned.status, 200, 'an in-workspace delete plans; the question is what scope it may be granted');
    assert.equal(planned.json.risk, 'HIGH');
    assert.equal(planned.json.backup.required, true);

    // A recursive delete granted a persistent, folder-wide scope is a standing licence to
    // destroy, issued once. "Destructive action confirmation" cannot mean anything if the
    // confirmation can be spent once and reused unattended thereafter.
    assert.equal(authorized.status, 403,
      'a destructive operation must not be grantable an unattended, reusable consent scope');
  });

  test('destructive_action_confirmation · the consent scope must be one the plan actually offered', async () => {
    // DENY is listed in the plan's own consentOptions as the refusal. Submitting the
    // refusal must not mint an approval.
    const { authorized } = await planAndAuthorize(
      { mode: 'OWNER_BYPASS', operation: 'write', path: `${workspace}/denied.txt` },
      'DENY',
    );
    assert.equal(authorized.status, 403, 'the refusal option must not produce an approval');
    assert.equal(authorized.json?.id, undefined, 'no approval may be stored for a denial');
  });

  test('destructive_action_confirmation · an invented consent scope is refused', async () => {
    const { authorized } = await planAndAuthorize(
      { mode: 'OWNER_BYPASS', operation: 'write', path: `${workspace}/invented.txt` },
      'UNLIMITED_FOREVER',
    );
    assert.equal(authorized.status, 400,
      'a scope the plan never offered must be refused, not stored verbatim');
  });

  // ---------------------------------------------------------------- invariant 3 of 7
  test('audit_integrity · every Owner Bypass authorization is chained into the ledger', async () => {
    const before = ledgerRecords().length;
    const { authorized } = await planAndAuthorize(
      { mode: 'OWNER_BYPASS', operation: 'write', path: `${workspace}/audited.txt` },
      'ONE_OPERATION',
    );
    assert.equal(authorized.status, 201, `the legitimate bypass write must authorize: ${authorized.text.slice(0, 160)}`);

    const records = ledgerRecords();
    assert.ok(records.length > before, 'the authorization must append an audit record');
    const event = records.at(-1);
    assert.equal(event.action, 'coden.authorize');
    assert.equal(event.details.mode, 'OWNER_BYPASS',
      'the record must state that this was done under bypass');

    // The chain itself must still verify — bypass must not be able to write a record
    // that breaks the hash chain, nor to skip one.
    const { AuditLedger } = await import('../src/audit.mjs');
    const chain = new AuditLedger(join(workspace, 'audit/events.jsonl'));
    assert.equal(chain.verify(), true, 'the ledger hash chain must verify after a bypass action');
  });

  // ---------------------------------------------------------------- invariant 4 of 7
  test('signed_update_verification · an elevated owner cannot stage an unsigned update', async () => {
    const staged = await post('/api/v1/updates/stage', { source: join(workspace, 'not-a-signed-bundle') });
    assert.notEqual(staged.status, 201, 'an unsigned or absent bundle must never stage');
    assert.ok(staged.status >= 400, `expected a refusal, got ${staged.status}: ${staged.text.slice(0, 160)}`);
  });

  // -------------------------------------------------- invariants 5, 6, 7 of 7
  //
  // malware_prevention, illegal_cyberattack_prevention and physical_harm_prevention are
  // not properties of a filesystem path. They are properties of what gets executed and
  // what the model is induced to produce. This layer plans paths and issues approvals;
  // it has no execution surface at all (`executionEnabled:false`).
  //
  // So the attempt is not "does the planner catch a malicious command" — a denylist that
  // pretends to would be worse than nothing, because it converts an honest gap into a
  // false assurance. The attempt is on the claim: the product must not present, as a
  // non-bypassable invariant of this authorization, something this authorization does not
  // enforce.
  test('every declared invariant names where it is enforced', () => {
    const plan = createPathPlan({ path: `${workspace}/contract.txt`, operation: 'write' }, workspace);
    assert.ok(Array.isArray(plan.nonBypassableInvariants) && plan.nonBypassableInvariants.length > 0);
    assert.ok(plan.invariantEnforcement, 'the plan must declare where each invariant is enforced');

    for (const id of plan.nonBypassableInvariants) {
      const entry = plan.invariantEnforcement.find((item) => item.id === id);
      assert.ok(entry, `invariant "${id}" is declared with no enforcement entry — a name in a list is not a mechanism`);
      assert.ok(entry.enforcedBy, `invariant "${id}" names no enforcement point`);
      assert.ok(['ACTIVE', 'NOT_ENFORCED_AT_THIS_LAYER'].includes(entry.status),
        `invariant "${id}" has an unrecognised enforcement status "${entry.status}"`);
    }
  });

  test('an invariant this layer does not enforce is not advertised as enforced by it', () => {
    const plan = createPathPlan({ path: `${workspace}/contract2.txt`, operation: 'write' }, workspace);
    const unenforced = plan.invariantEnforcement.filter((entry) => entry.status === 'NOT_ENFORCED_AT_THIS_LAYER');

    // The three content-level commitments belong here, and each must say which layer
    // owns it rather than being presented as something path authorization guarantees.
    for (const id of ['malware_prevention', 'illegal_cyberattack_prevention', 'physical_harm_prevention']) {
      const entry = plan.invariantEnforcement.find((item) => item.id === id);
      assert.ok(entry, `${id} must still be declared — it is a real product commitment`);
      assert.equal(entry.status, 'NOT_ENFORCED_AT_THIS_LAYER',
        `${id} must not claim active enforcement by the path authorizer`);
      assert.ok(entry.enforcedBy.length > 10,
        `${id} must name the layer that owns it, not merely be marked absent`);
    }
    assert.ok(unenforced.length >= 3);
  });

  test('the enforcement declaration is the server\'s and survives onto the approval', async () => {
    const planned = await post('/api/v1/coden/path-plan',
      { mode: 'OWNER_BYPASS', operation: 'write', path: `${workspace}/survives.txt` });
    assert.equal(planned.status, 200);

    const stripped = { ...planned.json, invariantEnforcement: [], nonBypassableInvariants: [] };
    const authorized = await post('/api/v1/coden/authorize', { plan: stripped, consentScope: 'ONE_OPERATION' });
    assert.equal(authorized.status, 201, `expected the recomputed plan to authorize: ${authorized.text.slice(0, 160)}`);
    assert.deepEqual(authorized.json.nonBypassableInvariants, planned.json.nonBypassableInvariants,
      'the approval must record the server\'s invariant list, not the caller\'s');
  });

  // Negative control. A suite that also breaks the working path proves nothing.
  test('negative control · a legitimate Owner Bypass write still authorizes end to end', async () => {
    const { planned, authorized } = await planAndAuthorize(
      { mode: 'OWNER_BYPASS', operation: 'write', path: `${workspace}/legitimate.txt` },
      'ONE_OPERATION',
    );
    assert.equal(planned.status, 200);
    assert.equal(authorized.status, 201, `Owner Bypass must remain usable: ${authorized.text.slice(0, 160)}`);
    assert.equal(authorized.json.mode, 'OWNER_BYPASS');
    assert.ok(authorized.json.id);
  });
});
