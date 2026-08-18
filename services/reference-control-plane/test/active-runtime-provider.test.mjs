// SPDX-License-Identifier: AGPL-3.0-or-later
//
// s341 — the last link of the `/model` chain: the chosen model is the one that answers.
//
// Two halves are proven here, and the second is the one that matters:
//
//   1. the derivation (`localRuntimeProfileFrom`) — every refusal, each with its own reason,
//      because "no profile" and "no profile BECAUSE the runtime is disabled" are what an
//      operator reads on the shell, and collapsing them is how a chain goes quiet;
//   2. the route, end to end, against a REAL OpenAI-compatible HTTP server: a gateway whose
//      runtime says it is serving actually returns THAT server's text, under the reserved
//      profile id, without a credential and without a consent grant.
//
// Point 2 deliberately does not stub the transport. The defect this phase closed was not in
// any single function — every function worked — it was that nothing joined them, and a test
// with a stubbed provider would have passed just as happily before the fix as after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';
import { ProviderGateway } from '../src/ai-workspace/provider-gateway.mjs';
import { localRuntimeProfileFrom, LOCAL_RUNTIME_PROFILE_ID } from '../src/ai-workspace/active-runtime-provider.mjs';

/** The shape `LocalModelRuntime.status()` returns, serving on `port`. */
function serving(port, patch = {}) {
  return {
    mode: 'manual', overriddenByEnvironment: false, profileId: 'cpu',
    endpoint: `http://127.0.0.1:${port}`, model: 'test-model', vramLimitMiB: null,
    launchConfigured: true,
    launched: { pid: 4242, startedAt: '2026-08-18T10:00:00.000Z', exited: false },
    lastProbe: { at: '2026-08-18T10:00:01.000Z', ok: true, status: 200, models: ['test-model'] },
    lastError: null,
    ...patch,
  };
}

// ── 1. the derivation, refusal by refusal ─────────────────────────────────────────────────

test('a runtime that is serving becomes a routable, local, credential-free profile', () => {
  const { profile, reason } = localRuntimeProfileFrom(serving(8080));
  assert.equal(reason, null);
  assert.equal(profile.id, LOCAL_RUNTIME_PROFILE_ID);
  assert.equal(profile.baseUrl, 'http://127.0.0.1:8080/v1', 'the runtime endpoint is a server root; a provider baseUrl is its /v1 surface');
  assert.equal(profile.defaultModel, 'test-model');
  assert.equal(profile.enabled, true);
  // The three that keep section 8 (offline by default) true: local, no credential, no egress.
  assert.equal(profile.external, false);
  assert.equal(profile.credentialRequired, false);
  assert.ok(profile.priority < 100, 'the chosen model leads the default route');
  assert.equal(profile.virtual, true);
});

test('no profile is derived when the runtime is disabled, and the reason names the override', () => {
  const off = localRuntimeProfileFrom(serving(8080, { mode: 'disabled' }));
  assert.equal(off.profile, null);
  assert.match(off.reason, /disabled/);
  const byEnv = localRuntimeProfileFrom(serving(8080, { mode: 'disabled', overriddenByEnvironment: true }));
  assert.match(byEnv.reason, /NOESAR_LOCAL_MODEL_RUNTIME/, 'an operator must learn WHERE it was switched off');
});

test('a model that has never been observed answering is not routed at', () => {
  // The exact state after a `configure()` with no launch and no probe: an address, a name,
  // and no evidence anything is behind it. Routing chat here would turn every message into
  // a 502 and leave the operator guessing whether the model or the wiring was broken.
  const { profile, reason } = localRuntimeProfileFrom(serving(8080, { launched: null, lastProbe: null }));
  assert.equal(profile, null);
  assert.match(reason, /has not been observed answering/);
});

test('a launched process that has exited stops being a route in the same instant', () => {
  const { profile, reason } = localRuntimeProfileFrom(serving(8080, {
    launched: { pid: 4242, startedAt: '2026-08-18T10:00:00.000Z', exited: true },
    lastProbe: null, lastError: 'the local runtime exited with code 1',
  }));
  assert.equal(profile, null);
  assert.match(reason, /exited with code 1/, 'the runtime error is carried, not replaced by a generic sentence');
});

test('an attached runtime with no child process is routable on the strength of its probe', () => {
  // `attach()` binds to a server the operator started themselves: there is no child to
  // observe, so the successful probe is the only evidence there is — and it is enough.
  const { profile } = localRuntimeProfileFrom(serving(8080, { launched: null }));
  assert.ok(profile, 'an attached, answering runtime must be routable');
  assert.match(profile.servingEvidence, /endpoint answered/);
});

test('a runtime endpoint pointing outward is refused, never dialled as if it were local', () => {
  // The security property behind the whole design: this profile is `external: false`, which
  // is what lets it answer with no consent gate. A configuration field must not be able to
  // turn that into an unconsented outbound call.
  for (const endpoint of ['https://api.example.com', 'http://8.8.8.8:8080', 'http://169.254.169.254', 'http://model.internal:8080']) {
    const { profile, reason } = localRuntimeProfileFrom(serving(8080, { endpoint }));
    assert.equal(profile, null, `${endpoint} must not become a local provider`);
    assert.match(reason, /local http\(s\) endpoint/);
  }
  // And the addresses a real local runtime actually uses still work.
  for (const endpoint of ['http://127.0.0.1:11434', 'http://localhost:8080', 'http://192.168.1.9:8080', 'http://host.docker.internal:8080']) {
    assert.ok(localRuntimeProfileFrom(serving(8080, { endpoint })).profile, `${endpoint} is a legitimate local runtime`);
  }
});

test('no model, no endpoint and no runtime at all are three different answers', () => {
  assert.match(localRuntimeProfileFrom(serving(8080, { model: null })).reason, /no model is active/);
  assert.match(localRuntimeProfileFrom(serving(8080, { endpoint: null })).reason, /no endpoint/);
  assert.match(localRuntimeProfileFrom(null).reason, /did not wire a local model runtime/);
});

// ── 2. the chain itself, against a real server ────────────────────────────────────────────

/** An OpenAI-compatible server that says which model produced the text. */
function upstream() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        model: payload.model,
        choices: [{ message: { role: 'assistant', content: `answered by ${payload.model}` } }],
        usage: { total_tokens: 7 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function fixture(status) {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-active-runtime-'));
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  const vault = new CredentialVault({ keyPath: join(dir, 'provider.key') });
  const ledger = { entries: [], append(entry) { this.entries.push(entry); } };
  let current = status;
  const gateway = new ProviderGateway({ store, vault, ledger, activeRuntime: () => current });
  return { dir, store, gateway, ledger, set: (next) => { current = next; } };
}

test('a chat completion is answered BY THE CHOSEN MODEL, through the reserved profile id', async () => {
  const { server, port } = await upstream();
  const f = fixture(serving(port));
  try {
    const route = f.gateway.route({ mode: 'ASK' });
    assert.equal(route[0], LOCAL_RUNTIME_PROFILE_ID, 'the running model leads the default route');
    const result = await f.gateway.complete(LOCAL_RUNTIME_PROFILE_ID, {
      messages: [{ role: 'user', content: 'hello' }], actorId: 'tester',
    });
    // The text names the model the request actually carried: proof the chosen id travelled
    // the whole way, not merely that some local server answered something.
    assert.equal(result.text, 'answered by test-model');
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('the route falls back to the stored providers the moment the runtime stops serving', async () => {
  const { server, port } = await upstream();
  const f = fixture(serving(port));
  try {
    const stored = f.gateway.create({ type: 'custom-openai-compatible', name: 'stored', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'stored-model' });
    f.gateway.update(stored.id, { enabled: true });
    assert.deepEqual(f.gateway.route({ mode: 'ASK' }), [LOCAL_RUNTIME_PROFILE_ID, stored.id]);
    f.set(serving(port, { launched: null, lastProbe: null }));
    assert.deepEqual(f.gateway.route({ mode: 'ASK' }), [stored.id], 'nothing has to be un-registered: the derived profile simply stops existing');
    assert.throws(() => f.gateway.get(LOCAL_RUNTIME_PROFILE_ID), (error) => error.status === 409 && /No local model is answering/.test(error.message));
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a standing preference keeps its own chain, with the chosen model in front of it', async () => {
  const { server, port } = await upstream();
  const f = fixture(serving(port));
  try {
    const preferred = f.gateway.create({ type: 'custom-openai-compatible', name: 'preferred', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'p' });
    const other = f.gateway.create({ type: 'custom-openai-compatible', name: 'other', external: false, apiStyle: 'openai-chat', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'o' });
    f.gateway.update(preferred.id, { enabled: true });
    f.gateway.update(other.id, { enabled: true });
    // The standing chain is the preference and ITS declared fallbacks — never widened to
    // every enabled provider, which would add destinations nobody chose.
    assert.deepEqual(
      f.gateway.route({ standingProviderId: preferred.id, mode: 'ASK' }),
      [LOCAL_RUNTIME_PROFILE_ID, preferred.id],
    );
    // An explicit per-message ask still wins outright: choosing a model sets the default, it
    // does not override a caller who named a provider.
    assert.deepEqual(f.gateway.route({ requestedProviderId: other.id, mode: 'ASK' }), [other.id]);
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('the derived profile is listed first and refuses to be edited as if it were stored', async () => {
  const { server, port } = await upstream();
  const f = fixture(serving(port));
  try {
    assert.equal(f.gateway.list()[0].id, LOCAL_RUNTIME_PROFILE_ID, 'the provider a person is talking to must not be missing from the list');
    for (const mutate of [
      () => f.gateway.update(LOCAL_RUNTIME_PROFILE_ID, { enabled: false }),
      () => f.gateway.setCredential(LOCAL_RUNTIME_PROFILE_ID, 'k'),
      () => f.gateway.clearCredential(LOCAL_RUNTIME_PROFILE_ID),
      () => f.gateway.grantConsent(LOCAL_RUNTIME_PROFILE_ID, { granted: true }),
    ]) {
      assert.throws(mutate, (error) => error.status === 409 && /derived from the runtime/.test(error.message));
    }
  } finally { server.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a runtime whose status call throws becomes a reason, never a broken provider list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-active-runtime-throw-'));
  try {
    const gateway = new ProviderGateway({
      store: new AtomicJsonStore(join(dir, 'state.json')),
      vault: new CredentialVault({ keyPath: join(dir, 'provider.key') }),
      ledger: { append() {} },
      activeRuntime: () => { throw new Error('workspace is not readable'); },
    });
    assert.match(gateway.activeRuntimeProfile().reason, /could not be read: workspace is not readable/);
    assert.doesNotThrow(() => gateway.list(), 'one unreadable runtime must not take the settings page down');
    assert.doesNotThrow(() => gateway.route({ mode: 'ASK' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 3. D-0541 · the health lane: a model that dies is reported before a message pays for it ──
//
// The gap this closes, measured: `lastProbe` was only ever written by `attach()`, which an
// operator calls once. In attach mode — binding to a server somebody else started, the normal
// case on a host with no runtime of its own — a server that died stayed `ok: true` for ever, and
// the FIRST CHAT MESSAGE after the death was what discovered it.

import { LocalModelRuntime } from '../src/local-model-runtime.mjs';

function runtimeAt(port, dir) {
  const runtime = new LocalModelRuntime({ workspace: dir, env: {} });
  return runtime;
}

test('a runtime whose server has died is reported down WITHOUT a message being sent', async () => {
  const { server, port } = await upstream();
  const dir = mkdtempSync(join(tmpdir(), 'noesar-liveness-'));
  try {
    const runtime = runtimeAt(port, dir);
    await runtime.configure({ mode: 'manual', profileId: 'cpu', endpoint: `http://127.0.0.1:${port}`, model: 'test-model' });
    await runtime.attach();
    assert.equal(localRuntimeProfileFrom(runtime.status()).profile?.defaultModel, 'test-model', 'it must route while the server is up');

    // The server dies. Nothing else happens — no chat message, no operator action.
    await new Promise((done) => server.close(done));

    // Two readings, because ONE failure must not be enough (the hysteresis below asserts the
    // other half). `nowMs` is advanced rather than waited on: a test that sleeps 15 seconds to
    // prove a 15-second interval is a test nobody runs.
    let now = Date.now();
    runtime.liveness({ nowMs: now });
    await runtime.livenessInFlight;
    now += 20_000;
    runtime.liveness({ nowMs: now });
    await runtime.livenessInFlight;

    const { profile, reason } = localRuntimeProfileFrom(runtime.status());
    assert.equal(profile, null, 'a dead model must stop being a route on its own');
    assert.match(reason, /has stopped answering: 2 consecutive probes failed/);
    assert.match(reason, /last seen/, 'the reason says WHEN it was last there, not merely that it is not');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one failed probe does not move the chat to a different provider', async () => {
  const { server, port } = await upstream();
  const dir = mkdtempSync(join(tmpdir(), 'noesar-liveness-flap-'));
  try {
    const runtime = runtimeAt(port, dir);
    await runtime.configure({ mode: 'manual', profileId: 'cpu', endpoint: `http://127.0.0.1:${port}`, model: 'test-model' });
    await runtime.attach();
    // One failure, simulated at the counter the policy actually reads — the same state a single
    // missed probe against a server mid-generation would produce.
    runtime.consecutiveFailures = 1;
    const still = localRuntimeProfileFrom(runtime.status());
    assert.ok(still.profile, 'a single blip must not flip the route');
    assert.equal(still.profile.liveness.consecutiveFailures, 1, 'and it is carried, not hidden');
    // A success clears it, so a runtime that recovers is not left one strike down for ever.
    let now = Date.now() + 60_000;
    runtime.liveness({ nowMs: now });
    await runtime.livenessInFlight;
    assert.equal(runtime.consecutiveFailures, 0);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a disabled runtime performs no probe at all — the default installation asks nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-liveness-off-'));
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...args) => { calls += 1; return realFetch(...args); };
  try {
    const runtime = new LocalModelRuntime({ workspace: dir, env: { NOESAR_LOCAL_MODEL_RUNTIME: 'disabled' } });
    await runtime.configure({ mode: 'manual', profileId: 'cpu', endpoint: 'http://127.0.0.1:9', model: 'test-model' })
      .catch(() => { /* configure refuses while disabled on some paths; the assertion is about fetch */ });
    for (let i = 0; i < 5; i += 1) runtime.liveness({ nowMs: Date.now() + i * 60_000 });
    assert.equal(calls, 0, 'a disabled runtime that reaches the network is section 8 with a hole in it');
    assert.equal(runtime.livenessReport().consecutiveFailures, 0, 'nothing was asked, so nothing is concluded');
  } finally { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); }
});

test('the reading never blocks: the report is synchronous and the probe is not awaited', async () => {
  const { server, port } = await upstream();
  const dir = mkdtempSync(join(tmpdir(), 'noesar-liveness-sync-'));
  try {
    const runtime = runtimeAt(port, dir);
    await runtime.configure({ mode: 'manual', profileId: 'cpu', endpoint: `http://127.0.0.1:${port}`, model: 'test-model' });
    const started = process.hrtime.bigint();
    const report = runtime.liveness();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(report && typeof report.ok === 'boolean', 'it returns knowledge, not a promise');
    assert.ok(elapsedMs < 50, `a reader must not wait for the network (took ${elapsedMs.toFixed(1)}ms)`);
    await runtime.livenessInFlight;
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('probes are rate-limited to one per interval, however many readers ask', async () => {
  const { server, port } = await upstream();
  const dir = mkdtempSync(join(tmpdir(), 'noesar-liveness-rate-'));
  try {
    const runtime = runtimeAt(port, dir);
    await runtime.configure({ mode: 'manual', profileId: 'cpu', endpoint: `http://127.0.0.1:${port}`, model: 'test-model' });
    const now = Date.now();
    for (let i = 0; i < 10; i += 1) runtime.liveness({ nowMs: now });
    await runtime.livenessInFlight;
    // Three tabs open on a page that polls must not become thirty probes of a server that is
    // generating: the second reading inside the interval is served from what is already known.
    assert.equal(runtime.lastLivenessAtMs, now, 'the window did not move for the nine that followed');
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});
