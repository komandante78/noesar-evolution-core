// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0397. `PATCH /api/v1/agents/:id` is the route that makes an agent removable from the
// operator's screen at all: before it, `createAgent` wrote `archived:false`, the list route
// filtered on `!item.archived`, and nothing in the entire product could ever set that field.
//
// It is a mutating route, so it is proved to be guarded like every other mutating route here
// — session AND CSRF, not an ambient cookie — and proved to actually archive, so the guard is
// not the only thing that works. A suite that only tests the refusals proves the feature is
// unreachable, not that it is correct.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-agents-archive-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server } = await import('../src/server.mjs');

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
async function listedIds() {
  const listed = await authed('/api/v1/agents');
  assert.equal(listed.status, 200, `listing agents must work: ${listed.text.slice(0, 160)}`);
  return listed.json.agents.map((item) => item.id);
}
async function newAgent(name) {
  const created = await authed('/api/v1/agents', { method: 'POST', payload: { name, instructions: 'You review releases.' } });
  assert.equal(created.status, 201, `agent creation must succeed: ${created.text.slice(0, 160)}`);
  return created.json;
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

describe('agents archive HTTP — guarded like every other mutating route, and it really archives', () => {
  test('no session at all cannot archive an agent', async () => {
    const agent = await newAgent('Unauthenticated target');
    const attempt = await raw(`/api/v1/agents/${agent.id}`, { method: 'PATCH', payload: { archived: true } });
    assert.ok([401, 403].includes(attempt.status), `an anonymous PATCH must be refused, got ${attempt.status}`);
    assert.ok((await listedIds()).includes(agent.id), 'the refused attempt must not have archived anything');
  });

  test('a valid session cookie with no CSRF header cannot archive an agent', async () => {
    const agent = await newAgent('Ambient cookie target');
    const attempt = await raw(`/api/v1/agents/${agent.id}`, { method: 'PATCH', payload: { archived: true }, headers: { cookie } });
    assert.equal(attempt.status, 403, `an ambient cookie alone must not be enough: ${attempt.text.slice(0, 160)}`);
    assert.ok((await listedIds()).includes(agent.id), 'the refused attempt must not have archived anything');
  });

  test('a wrong CSRF value is refused exactly like a missing one', async () => {
    const agent = await newAgent('Wrong CSRF target');
    const attempt = await raw(`/api/v1/agents/${agent.id}`, {
      method: 'PATCH', payload: { archived: true }, headers: { cookie, 'x-noesar-csrf': 'not-the-real-token' },
    });
    assert.equal(attempt.status, 403, 'a guessed or stale CSRF value must be refused, not merely an absent one');
    assert.ok((await listedIds()).includes(agent.id), 'the refused attempt must not have archived anything');
  });

  test('an unknown agent id answers 404 rather than inventing a record', async () => {
    const attempt = await authed('/api/v1/agents/00000000-0000-4000-8000-000000000000', { method: 'PATCH', payload: { archived: true } });
    assert.equal(attempt.status, 404, `an unknown id must be a 404: ${attempt.text.slice(0, 160)}`);
  });

  // Negative control. Everything above proves the door is shut; this proves there is a door.
  test('the legitimate archive works, and the agent leaves the list', async () => {
    const agent = await newAgent('Release reviewer');
    assert.ok((await listedIds()).includes(agent.id), 'a fresh agent must be listed before it is archived');

    const archived = await authed(`/api/v1/agents/${agent.id}`, { method: 'PATCH', payload: { archived: true } });
    assert.equal(archived.status, 200, `the legitimate archive must succeed: ${archived.text.slice(0, 160)}`);
    assert.equal(archived.json.archived, true);
    assert.ok(!(await listedIds()).includes(agent.id), 'an archived agent must disappear from the list');

    // The screen does not read `/api/v1/agents` — it reads the bootstrap payload. An archive
    // that only hid the agent from a route nothing renders would be a lie told to the operator.
    const bootstrap = await authed('/api/v1/ai/bootstrap');
    assert.equal(bootstrap.status, 200, `bootstrap must answer: ${bootstrap.text.slice(0, 160)}`);
    assert.ok(!bootstrap.json.agents.map((item) => item.id).includes(agent.id),
      'the payload the Agents screen actually renders must not carry an archived agent');
  });

  test('editing an agent in place works through the same route', async () => {
    const agent = await newAgent('Typo');
    const renamed = await authed(`/api/v1/agents/${agent.id}`, { method: 'PATCH', payload: { name: 'Corrected name' } });
    assert.equal(renamed.status, 200, `renaming must succeed: ${renamed.text.slice(0, 160)}`);
    assert.equal(renamed.json.name, 'Corrected name');
    assert.ok((await listedIds()).includes(agent.id), 'renaming must not archive anything');
  });
});
