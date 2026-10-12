// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-12: "dai modo di ripulire i logs ed eliminarli" (Settings > Health and logs).
//
// The operational logs are a store of their own: the logger refuses to live under an audit path, so deleting
// them cannot touch the audit ledger. What has to hold is that the deletion is not a way to make something
// disappear: it is the Owner's act (session AND CSRF AND the data permission, never an ambient cookie), the
// fresh log opens with a record that says it happened, and the audit ledger names who did it.
//
// Every refusal below is paired with the legitimate deletion in the last test: a suite that only proves the
// door is shut proves the feature is unreachable, not that it works.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { totpCode } from '../src/auth-crypto.mjs';
import { freshTempDir } from './support/workspace.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = freshTempDir('noesar-logs-clear-');
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'INFO';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server, logger } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;

async function raw(path, { method = 'GET', payload, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, json, text };
}
function authed(path, opts = {}) {
  return raw(path, { ...opts, headers: { cookie, 'x-noesar-csrf': csrf, ...(opts.headers ?? {}) } });
}
// Enough lines to be worth deleting, moved into an archive so there is something besides the active file.
function fill() {
  for (let index = 0; index < 30; index += 1) logger.info('unit.fill', { msg: 'x'.repeat(80), index });
  logger.rotate();
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const begun = await raw('/api/v1/auth/setup', {
    method: 'POST',
    payload: { username: 'owner', displayName: 'Owner', password: PASSWORD },
    headers: { 'x-noesar-setup-token': SETUP_TOKEN },
  });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);

  const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: begun.json.challenge, totpCode: totpCode(begun.json.totpSecret, stepStart()) }),
  });
  assert.equal(response.status, 201, 'setup confirm failed');
  const confirmed = await response.json();

  const setCookie = response.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = confirmed.csrfToken;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('deleting the operational logs — guarded like every other mutating route, and it really deletes', () => {
  test('no session at all cannot delete them', async () => {
    fill();
    const kept = logger.archives().length;
    assert.ok(kept >= 1, 'the fixture has an archive to lose');
    const attempt = await raw('/api/v1/logs/clear', { method: 'POST', payload: {} });
    assert.ok([401, 403].includes(attempt.status), `an anonymous POST must be refused, got ${attempt.status}`);
    assert.equal(logger.archives().length, kept, 'the refused attempt must not have removed anything');
  });

  test('a valid session cookie with no CSRF header cannot delete them', async () => {
    fill();
    const kept = logger.archives().length;
    const attempt = await raw('/api/v1/logs/clear', { method: 'POST', payload: {}, headers: { cookie } });
    assert.equal(attempt.status, 403, `an ambient cookie alone must not be enough: ${attempt.text.slice(0, 160)}`);
    assert.equal(logger.archives().length, kept, 'the refused attempt must not have removed anything');
  });

  test('the log search carries what is on disk, so the page can say how much there is to delete', async () => {
    const listed = await authed('/api/v1/logs?limit=5');
    assert.equal(listed.status, 200, listed.text.slice(0, 160));
    assert.equal(listed.json.stats.archiveCount, logger.archives().length);
    assert.equal(typeof listed.json.stats.bytes, 'number');
    assert.equal(typeof listed.json.stats.quotaBytes, 'number');
  });

  // Negative control. Everything above proves the door is shut; this proves there is a door.
  test('the Owner deletes them: the archives go, the fresh log says so, and the audit record names who', async () => {
    fill();
    assert.ok(logger.archives().length >= 1);
    const result = await authed('/api/v1/logs/clear', { method: 'POST', payload: {} });
    assert.equal(result.status, 200, `the deletion must work: ${result.text.slice(0, 160)}`);
    assert.ok(result.json.archivesRemoved >= 1, JSON.stringify(result.json));
    assert.ok(result.json.bytesFreed > 0, JSON.stringify(result.json));
    assert.deepEqual(logger.archives(), []);

    const listed = await authed('/api/v1/logs?limit=1000');
    const events = listed.json.entries.map((entry) => entry.event);
    assert.ok(events.includes('logs.cleared'), 'the fresh log opens with the record of the deletion');
    assert.ok(!events.includes('unit.fill'), 'what was there before is gone');

    const audit = await authed('/api/v1/audit');
    assert.equal(audit.status, 200, audit.text.slice(0, 160));
    assert.ok(audit.text.includes('logs.cleared'), 'the audit ledger records that the logs were deleted');
  });
});
