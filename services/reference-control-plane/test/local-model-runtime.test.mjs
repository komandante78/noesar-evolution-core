// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Local model runtime: profiles, selection, fallback, limits and containment.
//
// Phase 4 recorded GPU_RUNTIME=NOT_IMPLEMENTED and gave the reason: every GPU reference
// in the product was inventory. These tests cover the path that replaces it — everything
// except the inference itself, which belongs to whatever local server the runtime
// attaches to.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalModelRuntime, RuntimeMode, Backend } from '../src/local-model-runtime.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { AdapterGrantOrchestrator } from '../src/adapter-capability.mjs';

function fresh(env = {}) {
  const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-localmodel-'));
  const minter = new TokenMinter(Buffer.alloc(32, 7));
  const grants = new AdapterGrantOrchestrator({ minter });
  return { workspace, minter, grants, runtime: new LocalModelRuntime({ workspace, env, minter }) };
}

/** ARCH-005: the same request()->approve() flow a real operator session would drive. */
function grantLaunch(grants, nowUnix = Math.floor(Date.now() / 1000)) {
  const { runId } = grants.request({
    resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'test-operator', nowUnix,
  });
  const { token } = grants.approve({ runId, approverId: 'test-owner', nowUnix });
  return token;
}

async function withStubServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the runtime is disabled by default and reports that it is not an inference engine', () => {
  const { runtime } = fresh();
  const status = runtime.status();
  assert.equal(status.mode, RuntimeMode.DISABLED);
  assert.equal(status.inProcessInference, false);
  assert.equal(status.endpoint, null);
  assert.equal(status.launchConfigured, false);
});

test('a disabled runtime queries no accelerator at all', async () => {
  const { runtime } = fresh();
  const detection = await runtime.detect();
  // The distinction between "there is no GPU" and "we did not look" is the whole point
  // of `inspected`. Without it, a disabled runtime is indistinguishable from a host with
  // no card, and "no GPU access without configuration" becomes unverifiable.
  assert.equal(detection.inspected, false);
  assert.deepEqual(detection.accelerators, []);
  assert.match(detection.reason, /disabled/);
});

test('a disabled runtime refuses to attach, launch or complete', async () => {
  const { runtime } = fresh();
  await assert.rejects(() => runtime.attach(), /disabled/);
  await assert.rejects(() => runtime.launch(), /disabled/);
  await assert.rejects(() => runtime.complete({ messages: [{ role: 'user', content: 'x' }] }), /disabled/);
  const selection = await runtime.select();
  assert.equal(selection.backend, null);
});

test('the environment can disable the runtime but never enable it', async () => {
  const { workspace } = fresh();
  const enabled = new LocalModelRuntime({ workspace, env: {} });
  await enabled.configure({ mode: RuntimeMode.AUTO });
  assert.equal(enabled.config().mode, RuntimeMode.AUTO);

  const overridden = new LocalModelRuntime({
    workspace, env: { NOESAR_LOCAL_MODEL_RUNTIME: 'disabled' },
  });
  assert.equal(overridden.config().mode, RuntimeMode.DISABLED);
  assert.equal(overridden.config().overriddenByEnvironment, true);
});

test('configuration is persisted 0600 and survives a new instance', async () => {
  const { workspace, runtime } = fresh();
  await runtime.configure({ mode: RuntimeMode.AUTO, model: 'test-model', vramLimitMiB: 4096 });
  const reloaded = new LocalModelRuntime({ workspace, env: {} });
  assert.equal(reloaded.config().model, 'test-model');
  assert.equal(reloaded.config().vramLimitMiB, 4096);
  const written = readFileSync(join(workspace, 'config/local-model.json'), 'utf8');
  assert.match(written, /"vramLimitMiB": 4096/);
});

test('a non-loopback endpoint is refused', async () => {
  const { runtime } = fresh();
  await assert.rejects(
    () => runtime.configure({ mode: RuntimeMode.AUTO, endpoint: 'http://198.51.100.10:8080' }),
    /must be on loopback/,
  );
  await assert.rejects(
    () => runtime.configure({ mode: RuntimeMode.AUTO, endpoint: 'https://models.example.com' }),
    /must be on loopback/,
  );
  await assert.rejects(
    () => runtime.configure({ mode: RuntimeMode.AUTO, endpoint: 'file:///etc/passwd' }),
    /must be http or https/,
  );
  await assert.rejects(
    () => runtime.configure({ mode: RuntimeMode.AUTO, endpoint: 'not-a-url' }),
    /absolute URL/,
  );
  // Loopback is accepted.
  await runtime.configure({ mode: RuntimeMode.AUTO, endpoint: 'http://127.0.0.1:8081' });
  assert.match(runtime.config().endpoint, /127\.0\.0\.1:8081/);
});

test('a launch command must be an argv array, never a shell string', async () => {
  const { runtime } = fresh();
  await assert.rejects(
    () => runtime.configure({ mode: RuntimeMode.AUTO, launchCommand: 'llama-server --model x' }),
    /argv, never a shell string/,
  );
  await assert.rejects(
    () => runtime.configure({ mode: RuntimeMode.AUTO, launchCommand: [] }),
    /non-empty array/,
  );
  await runtime.configure({ mode: RuntimeMode.AUTO, launchCommand: ['/bin/echo', 'ok'] });
  assert.deepEqual(runtime.config().launchCommand, ['/bin/echo', 'ok']);
});

test('a VRAM limit below the floor and a nonsensical mode are refused', async () => {
  const { runtime } = fresh();
  await assert.rejects(() => runtime.configure({ vramLimitMiB: 10 }), /at least 256/);
  await assert.rejects(() => runtime.configure({ mode: 'turbo' }), /mode must be one of/);
});

test('manual mode requires a profile that this host actually has', async () => {
  const { runtime } = fresh();
  await assert.rejects(
    () => runtime.configure({ mode: RuntimeMode.MANUAL }),
    /requires profileId/,
  );
  await assert.rejects(
    () => runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cuda:99' }),
    /no such profile/,
  );
  // The CPU profile always exists, because fallback must never be the unavailable thing.
  await runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cpu' });
  const selection = await runtime.select();
  assert.equal(selection.backend, Backend.CPU);
  assert.equal(selection.fellBack, false);
});

test('automatic mode falls back to CPU and says why, rather than failing', async () => {
  const { runtime } = fresh();
  await runtime.configure({ mode: RuntimeMode.AUTO });
  const selection = await runtime.select();
  // On a host with no visible accelerator this is a CPU fallback with a stated reason.
  // On a host with one, it is a CUDA selection. Both are correct; what must never happen
  // is a silent CPU result with no explanation.
  if (selection.backend === Backend.CPU) {
    assert.equal(selection.fellBack, true);
    assert.ok(selection.reason, 'a fallback must always carry its reason');
  } else {
    assert.equal(selection.backend, Backend.CUDA);
    assert.equal(selection.fellBack, false);
    assert.ok(selection.vramBudgetMiB > 0);
  }
});

test('a manual GPU selection does NOT silently fall back when the device is missing', async () => {
  const { workspace } = fresh();
  const runtime = new LocalModelRuntime({ workspace, env: {} });
  // Write the configuration directly: configure() would refuse a device that is not
  // present, which is correct, but the case under test is a device that disappears
  // AFTER it was configured — a card removed, a driver that stopped loading.
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(workspace, 'config'), { recursive: true });
  writeFileSync(join(workspace, 'config/local-model.json'), JSON.stringify({
    mode: RuntimeMode.MANUAL, profileId: 'cuda:47',
  }));
  const selection = await runtime.select();
  assert.equal(selection.backend, null, 'manual means manual: no silent substitution');
  assert.equal(selection.fellBack, false);
  assert.match(selection.error, /not present on this host/);
});

test('an unreachable endpoint produces an explicit error, not a hang', async () => {
  const { runtime } = fresh();
  // Port 1 on loopback: reserved, and nothing listens there.
  await runtime.configure({ mode: RuntimeMode.AUTO, endpoint: 'http://127.0.0.1:1' });
  await assert.rejects(() => runtime.attach({ timeoutMs: 2000 }), /unreachable/);
  assert.equal(runtime.status().lastProbe.ok, false);
});

test('attach reports the models an OpenAI-compatible server advertises', async () => {
  const { runtime } = fresh();
  await withStubServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'tiny-local' }, { id: 'other' }] }));
      return;
    }
    res.writeHead(404).end();
  }, async (endpoint) => {
    await runtime.configure({ mode: RuntimeMode.AUTO, endpoint });
    const attached = await runtime.attach();
    assert.equal(attached.attached, true);
    assert.deepEqual(attached.models, ['tiny-local', 'other']);
    assert.equal(runtime.status().lastError, null);
  });
});

test('a server that answers an error status is reported as an error, not as attached', async () => {
  const { runtime } = fresh();
  await withStubServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'loading' }));
  }, async (endpoint) => {
    await runtime.configure({ mode: RuntimeMode.AUTO, endpoint });
    await assert.rejects(() => runtime.attach(), /answered 503/);
  });
});

test('a completion carries the backend it ran on and whether it fell back', async () => {
  const { runtime } = fresh();
  await withStubServer((req, res) => {
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: 'tiny-local',
        choices: [{ message: { role: 'assistant', content: 'four' } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }));
      return;
    }
    res.writeHead(404).end();
  }, async (endpoint) => {
    await runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cpu', endpoint });
    const result = await runtime.complete({
      messages: [{ role: 'user', content: 'two plus two' }],
    });
    assert.equal(result.content, 'four');
    assert.equal(result.backend, Backend.CPU);
    assert.equal(result.fellBack, false);
    assert.ok(result.latencyMs >= 0);
    assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 1 });
  });
});

test('completion rejects an empty message list rather than sending it', async () => {
  const { runtime } = fresh();
  await runtime.configure({
    mode: RuntimeMode.MANUAL, profileId: 'cpu', endpoint: 'http://127.0.0.1:1',
  });
  await assert.rejects(() => runtime.complete({ messages: [] }), /non-empty array/);
});

test('launching without a configured command is refused', async () => {
  const { runtime } = fresh();
  await runtime.configure({ mode: RuntimeMode.AUTO });
  await assert.rejects(() => runtime.launch(), /no launchCommand is configured/);
});

test('a launched process is tracked and released, and releasing twice is harmless', async () => {
  const { runtime, grants } = fresh();
  // `sleep` stands in for an inference server: the point is process lifecycle, not
  // inference. No endpoint is configured, so launch() does not wait for readiness.
  await runtime.configure({
    mode: RuntimeMode.MANUAL, profileId: 'cpu', launchCommand: ['/bin/sleep', '60'],
  });
  const launched = await runtime.launch({ capabilityToken: grantLaunch(grants) });
  assert.equal(launched.launched, true);
  assert.ok(Number.isInteger(launched.pid));
  assert.equal(runtime.status().launched.exited, false);

  const released = await runtime.release();
  assert.equal(released.released, true);
  assert.equal(released.graceful, true, 'SIGTERM must be enough for a well-behaved child');
  assert.equal(runtime.status().launched, null);

  const again = await runtime.release();
  assert.equal(again.alreadyStopped, true);
});

test('a runtime that exits immediately is reported, not waited on', async () => {
  const { runtime, grants } = fresh();
  await withStubServer((req, res) => { res.writeHead(404).end(); }, async (endpoint) => {
    await runtime.configure({
      mode: RuntimeMode.MANUAL, profileId: 'cpu',
      launchCommand: ['/bin/false'], endpoint, launchReadyTimeoutMs: 5000,
    });
    await assert.rejects(
      () => runtime.launch({ capabilityToken: grantLaunch(grants) }),
      /exited with code|did not become ready/,
    );
  });
});

// ARCH-005 (03_ARCHITETTURA.md §4): "no adapter may grant itself a permission." These
// cover the refusal side of that sentence for the one adapter that exists.
test('launch refuses outright when no capability engine is wired to the runtime', async () => {
  const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-localmodel-'));
  const runtime = new LocalModelRuntime({ workspace }); // no `minter` — the default
  await runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cpu', launchCommand: ['/bin/sleep', '60'] });
  await assert.rejects(() => runtime.launch(), /no capability engine is wired/);
});

test('launch refuses with no capability token supplied, even though a minter is wired', async () => {
  const { runtime } = fresh();
  await runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cpu', launchCommand: ['/bin/sleep', '60'] });
  await assert.rejects(() => runtime.launch(), /launch refused/);
  assert.equal(runtime.status().launched, null, 'a refused launch must not have spawned anything');
});

test('launch refuses a forged token — flipping one signature byte is enough', async () => {
  const { runtime, grants } = fresh();
  await runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cpu', launchCommand: ['/bin/sleep', '60'] });
  const token = grantLaunch(grants);
  const forged = { ...token, mac: token.mac.startsWith('0') ? `1${token.mac.slice(1)}` : `0${token.mac.slice(1)}` };
  await assert.rejects(() => runtime.launch({ capabilityToken: forged }), /launch refused/);
  assert.equal(runtime.status().launched, null);
});

test('launch refuses a token this engine never issued (a different minter\'s token)', async () => {
  const { runtime } = fresh();
  await runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cpu', launchCommand: ['/bin/sleep', '60'] });
  const otherMinter = new TokenMinter(Buffer.alloc(32, 9));
  const otherGrants = new AdapterGrantOrchestrator({ minter: otherMinter });
  const strangerToken = grantLaunch(otherGrants);
  await assert.rejects(() => runtime.launch({ capabilityToken: strangerToken }), /launch refused/);
});

test('a granted token is spent by launch and cannot be replayed for a second launch', async () => {
  const { runtime, grants } = fresh();
  await runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cpu', launchCommand: ['/bin/sleep', '60'] });
  const token = grantLaunch(grants);
  const first = await runtime.launch({ capabilityToken: token });
  assert.equal(first.launched, true);
  await runtime.release();
  await assert.rejects(
    () => runtime.launch({ capabilityToken: token }),
    /launch refused/,
    'a single-use grant must not authorise a second launch',
  );
});

test('an adapter cannot mint its own token: asking outside its manifest is refused before any approval', () => {
  const { grants } = fresh();
  assert.throws(
    () => grants.request({ resource: 'local-model-runtime', operation: 'READ', actor: 'test', nowUnix: Math.floor(Date.now() / 1000) }),
    /never asks for `READ`/,
  );
});

test('an unknown adapter resource is refused, not silently granted', () => {
  const { grants } = fresh();
  assert.throws(
    () => grants.request({ resource: 'no-such-adapter', operation: 'EXECUTE', actor: 'test', nowUnix: Math.floor(Date.now() / 1000) }),
    /no adapter named/,
  );
});

test('the CPU profile is always present and always available', async () => {
  const { runtime } = fresh();
  await runtime.configure({ mode: RuntimeMode.AUTO });
  const { profiles } = await runtime.profiles();
  const cpu = profiles.find((profile) => profile.id === 'cpu');
  assert.ok(cpu);
  assert.equal(cpu.available, true);
  assert.equal(cpu.backend, Backend.CPU);
});
