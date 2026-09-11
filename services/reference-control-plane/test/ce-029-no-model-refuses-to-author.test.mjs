// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-029` — *«Un'installazione senza modello **rifiuta di autorare dicendo perché**, e non
// degrada a un rifiuto muto né a un contenuto vuoto»*
// (`MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` §11, severity **C**),
// verification method *«installazione senza provider configurato, ispezione della risposta»*.
//
// # Three claims, and each one has its own way of failing quietly
//
//   refuses to author       nothing is written that a model did not write
//   saying why              the reason is ON the answer, in words, not an absence to infer
//   no silent refusal       the request is ANSWERED, not dropped — an operator who asked for a
//                           change gets a plan and a stated reason, never a blank or a 500
//   no empty content        neither the engine nor a model that returned nothing may put empty
//                           bytes where a file's contents should be
//
// The verification method is *inspection of the response*, so that is what this file inspects:
// the response of a real listener started with **no `NOESAR_AUTHORING_ENDPOINT`** — which is
// what `buildAuthor()` (server.mjs) reads to decide there is nothing underneath — and the
// response of the orchestrator with no Author at all.
//
// # Declared width
//
// This is the criterion's own method and nothing wider. **How the two shells RENDER
// `authoring.reason` is not covered here** and is not claimed: measured this session, no file
// under `apps/` reads that field at all, so the reason reaches the API and stops there. That is
// recorded as `F-AUTH-UI-001`, separately, rather than folded into this verdict.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  Author, AuthoringUnavailable, AuthoringRefused, extractBody, openAiChatGenerator,
} from '../src/author.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { freshTempDir } from './support/workspace.mjs';

const NOW = 1_800_000_000;
const CALLER_BYTES = 'the caller wrote this line themselves\n';

function fixture({ author = null } = {}) {
  const ws = freshTempDir('noesar-ce029-ws-');
  const shadows = freshTempDir('noesar-ce029-sh-');
  writeFileSync(join(ws, '.seed'), 'seed');
  writeFileSync(join(ws, 'a.txt'), 'original\n');
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), env: {}, author,
  });
  return { ws, orch };
}
const planOnce = (orch) => orch.plan({
  request: 'change a line', files: [{ path: 'a.txt', contents: CALLER_BYTES }],
  actor: 'owner-001', nowUnix: NOW,
});

describe('CE-029 — an installation with no model refuses to author, and says why', () => {

  // ── 1 · the reason itself, in the words it will be shown in ───────────────────────────────
  test('the reason is a sentence, not a code — it names what is missing and what will not happen', () => {
    const reason = Author.NO_MODEL_REASON;
    assert.equal(typeof reason, 'string');
    assert.ok(reason.trim().length > 40, `a reason of ${reason.length} characters explains nothing: ${reason}`);
    // The three things an operator reading this needs: what is absent, what still works, and
    // the promise this criterion's second half is about.
    assert.match(reason, /no model is configured/i);
    assert.match(reason, /plan/i);
    assert.match(reason, /empty contents/i);
  });

  test('an Author with nothing underneath reports itself unavailable and refuses by name', async () => {
    const author = new Author({ generate: null });
    assert.equal(author.available, false);
    await assert.rejects(
      () => author.author({ goal: 'g', step: 's', files: [{ path: 'a.txt', contents: 'x' }] }),
      (error) => error instanceof AuthoringUnavailable && error.reason === Author.NO_MODEL_REASON,
    );
  });

  test('a generator built on an empty endpoint refuses at construction, with the same reason', () => {
    // `buildAuthor()` returns `null` before reaching this, but the two guards must agree: an
    // installation that half-configured a model must not get a different story from each.
    assert.throws(
      () => openAiChatGenerator({ endpoint: '' }),
      (error) => error instanceof AuthoringUnavailable && error.reason === Author.NO_MODEL_REASON,
    );
  });

  // ── 2 · the response of an orchestrator with no Author ────────────────────────────────────
  test('plan() answers, and the answer carries `available:false` with the reason', async () => {
    const fx = fixture({ author: null });
    const planned = await planOnce(fx.orch);

    // Not a silent refusal: the request is ANSWERED. A plan exists, with a status.
    assert.equal(planned.status, 'PENDING_APPROVAL');
    assert.ok(planned.plan.steps.length >= 1);
    // And it says why, on the answer, without being asked a second question.
    assert.equal(planned.authoring.available, false);
    assert.equal(planned.authoring.reason, Author.NO_MODEL_REASON);
    assert.equal(planned.authoring.authored, 0);
  });

  test('nothing is authored: the engine adds no content of its own, empty or otherwise', async () => {
    const fx = fixture({ author: null });
    const planned = await planOnce(fx.orch);
    // `plan()` answers with a SUMMARY, not the stored run — `authoredContents` is deliberately
    // not on it (workspace-actions.mjs:789, and the comment above `#runs`). So the claim is
    // made where it is observable: the answer says nothing was authored, and the only bytes
    // this run can promote are the caller's, proven in the next test.
    assert.equal(planned.authoring.authored, 0);
    assert.equal(planned.authoring.available, false);
    assert.equal(planned.authoring.failed ?? false, false,
      'an absent Author is not a failed one: the two are different facts and must not collapse');
  });

  test('promotion writes the caller\'s own bytes exactly — never empty, never fabricated', async () => {
    const fx = fixture({ author: null });
    const planned = await planOnce(fx.orch);
    fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });

    assert.equal(approved.promoted, true);
    const written = readFileSync(join(fx.ws, 'a.txt'), 'utf8');
    assert.equal(written, CALLER_BYTES);
    assert.notEqual(written.trim(), '', 'an empty file is the outcome this criterion forbids');
  });

  // ── 3 · the other way to reach empty content: a model that answers with nothing ───────────
  test('a model that returns an empty file is refused by name — EMPTY, not written', () => {
    assert.throws(
      () => extractBody('```\n\n```', 'a.txt'),
      (error) => error instanceof AuthoringRefused && error.code === 'EMPTY',
    );
    assert.throws(
      () => extractBody('```\n   \n\t\n```', 'a.txt'),
      (error) => error instanceof AuthoringRefused && error.code === 'EMPTY',
    );
  });

  test('an authoring request declares a token budget and turns thinking off', async () => {
    // Measured live 2026-09-11: with neither bound, a real rewrite ran for minutes and every
    // authoring request aborted at the old fixed 120s timeout - unbounded output asked of a
    // model that also spends hundreds of tokens thinking before it writes a line of code.
    let seenBody;
    const generate = openAiChatGenerator({
      endpoint: 'http://127.0.0.1:9', maxTokens: 1000,
      fetchImpl: async (url, init) => {
        seenBody = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
      },
    });
    await generate({ prompt: 'p' });
    assert.equal(seenBody.max_tokens, 1000);
    assert.deepEqual(seenBody.chat_template_kwargs, { enable_thinking: false });
  });

  test('a reachable model that answers with no content is unavailable, not a source of empty bytes', async () => {
    const generate = openAiChatGenerator({
      endpoint: 'http://127.0.0.1:9',
      fetchImpl: async () => ({
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: '   \n  ' } }] }),
      }),
    });
    await assert.rejects(
      () => generate({ prompt: 'p' }),
      (error) => error instanceof AuthoringUnavailable && /returned no content/.test(error.reason),
    );
  });

  test('a configured model whose every answer is empty still writes nothing, and the run says so', async () => {
    // The nastiest shape of this criterion: a model IS configured, so `available` is true —
    // and the run must still not present empty contents as a result.
    const author = new Author({ generate: async () => '```\n\n```', model: 'stub' });
    const fx = fixture({ author });
    const planned = await planOnce(fx.orch);

    assert.equal(planned.authoring.available, true);
    assert.equal(planned.authoring.authored, 0);
    assert.ok((planned.authoring.refusals ?? []).some((refusal) => refusal.code === 'EMPTY'),
      `the empty answer must be refused by name: ${JSON.stringify(planned.authoring.refusals)}`);

    fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });
    assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), CALLER_BYTES);
  });

  // Negative control: a working model DOES author, or the six tests above prove only that this
  // fixture never writes anything.
  test('negative control · a model that answers properly authors the file, and the run says so', async () => {
    const authored = 'the model wrote this line\n';
    const author = new Author({ generate: async () => `\`\`\`\n${authored}\`\`\``, model: 'stub' });
    const fx = fixture({ author });
    const planned = await planOnce(fx.orch);

    assert.equal(planned.authoring.available, true);
    assert.equal(planned.authoring.reason, null);
    assert.equal(planned.authoring.authored, 1, JSON.stringify(planned.authoring));

    fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });
    assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), authored);
  });
});

// ── 4 · the criterion's own method: a real installation with no provider configured ─────────
//
// `NOESAR_AUTHORING_ENDPOINT` is deliberately never set for this process. That single absence
// is what `buildAuthor()` reads to decide this installation has nothing to author with, so the
// listener below IS "un'installazione senza provider configurato" — not a stub of one.
const httpWorkspace = freshTempDir('noesar-ce029-http-');
process.env.NOESAR_WORKSPACE = httpWorkspace;
process.env.NOESAR_SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';
delete process.env.NOESAR_AUTHORING_ENDPOINT;
delete process.env.NOESAR_RUST_REASONING_ENDPOINT;

const { server } = await import('../src/server.mjs');
const { totpCode } = await import('../src/auth-crypto.mjs');

const STEP_MS = 30_000;
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
const authed = (path, opts = {}) =>
  raw(path, { ...opts, headers: { cookie, 'x-noesar-csrf': csrf, ...(opts.headers ?? {}) } });

describe('CE-029 · the response of an installation with no provider configured', () => {
  before(async () => {
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${server.address().port}`;
    const begun = await raw('/api/v1/auth/setup', {
      method: 'POST',
      payload: { username: 'owner', displayName: 'Owner', password: 'correct horse battery staple 42' },
      headers: { 'x-noesar-setup-token': process.env.NOESAR_SETUP_TOKEN },
    });
    assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);
    const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challenge: begun.json.challenge,
        totpCode: totpCode(begun.json.totpSecret, Math.floor(Date.now() / STEP_MS) * STEP_MS),
      }),
    });
    assert.equal(response.status, 201, 'setup confirm failed');
    const confirmed = await response.json();
    cookie = (response.headers.getSetCookie?.() ?? [])
      .find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
    csrf = confirmed.csrfToken;
  });

  after(async () => { await new Promise((done) => server.close(done)); });

  test('the plan response carries the refusal and its reason, and is a 201, not a silence', async () => {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST',
      payload: { request: 'ce-029 fixture', files: [{ path: 'ce029.txt', contents: CALLER_BYTES }] },
    });

    // 201, because the plan itself succeeded. A 500 or a 503 here would be the "rifiuto muto":
    // an operator would learn that something failed, never that a model is what is missing.
    assert.equal(planned.status, 201, `the plan must be answered: ${planned.text.slice(0, 200)}`);
    assert.equal(planned.json.authoring.available, false,
      'this installation has no NOESAR_AUTHORING_ENDPOINT, so the answer must say the Author is absent');
    assert.equal(planned.json.authoring.reason, Author.NO_MODEL_REASON);
    assert.equal(planned.json.authoring.authored, 0);
  });

  test('the installation writes the caller\'s bytes, never empty ones — measured on disk', async () => {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST',
      payload: { request: 'ce-029 bytes', files: [{ path: 'ce029-bytes.txt', contents: CALLER_BYTES }] },
    });
    assert.equal(planned.status, 201, planned.text.slice(0, 200));
    assert.equal(planned.json.authoring.available, false);

    const runId = planned.json.runId;
    const measured = await authed(`/api/v1/workspace-actions/${runId}/measure`, { method: 'POST', payload: {} });
    assert.equal(measured.status, 200, `measure must succeed: ${measured.text.slice(0, 200)}`);
    const approved = await authed(`/api/v1/workspace-actions/${runId}/approve`, { method: 'POST', payload: {} });
    assert.equal(approved.status, 200, `approve must succeed: ${approved.text.slice(0, 200)}`);
    assert.equal(approved.json.promoted, true);

    // The bytes, on the real workspace of a real installation that has no model. Exactly what
    // the caller supplied — nothing invented, and above all nothing empty.
    const written = readFileSync(join(httpWorkspace, 'ce029-bytes.txt'), 'utf8');
    assert.equal(written, CALLER_BYTES);
  });
});
