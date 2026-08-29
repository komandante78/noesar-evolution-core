// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Local model runtime: profiles, selection, fallback, limits and containment.
//
// Phase 4 recorded GPU_RUNTIME=NOT_IMPLEMENTED and gave the reason: every GPU reference
// in the product was inventory. These tests cover the path that replaces it — everything
// except the inference itself, which belongs to whatever local server the runtime
// attaches to.

import test, { describe } from 'node:test';

import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LocalModelRuntime, RuntimeMode, Backend, activateModel,
  withGpuLayers, effectiveGpuLayers, placementOf, recommendPlacement, declaredSize, withoutReasoning } from '../src/local-model-runtime.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { AdapterGrantOrchestrator } from '../src/adapter-capability.mjs';
import { freshTempDir } from './support/workspace.mjs';

// D-0535: activateModel now refuses a caller that did not check the descriptor against a
// publisher registry at all — an omission must never read as a permission. Every call below
// therefore states what it checked, exactly as the server does.
const SIGNED = Object.freeze({ verified: true, kind: 'VERIFIED', signedBy: 'test-publisher' });

function fresh(env = {}) {
  const workspace = freshTempDir('noesar-localmodel-');
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
  const workspace = freshTempDir('noesar-localmodel-');
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

// --- GPU, RAM, or both — Owner, 2026-08-28 ------------------------------------------------
//
// «devi far girare i modelli sia su gpu che su ram o ibrido». The whole of it is llama.cpp's
// `-ngl`, which every descriptor already carried; what did not exist was a way to say a number
// other than the descriptor's, and a launch that did not blank the GPU whenever the selection
// was not called CUDA. These four tests are the placement, and nothing here needs a GPU to run.
describe('placement: gpu, ram, hybrid', () => {
  test('the layer count is put into an argv without ever being appended twice', () => {
    const argv = ['llama-server', '-m', 'x.gguf', '-ngl', '99', '-c', '16384'];
    assert.deepEqual(withGpuLayers(argv, 0), ['llama-server', '-m', 'x.gguf', '-ngl', '0', '-c', '16384']);
    assert.deepEqual(withGpuLayers(argv, 36), ['llama-server', '-m', 'x.gguf', '-ngl', '36', '-c', '16384']);
    // The long spelling is the same flag, and a descriptor is free to use it.
    assert.deepEqual(withGpuLayers(['s', '--n-gpu-layers', '99'], 8), ['s', '--n-gpu-layers', '8']);
    // Absent: appended once.
    assert.deepEqual(withGpuLayers(['s', '-m', 'x'], 12), ['s', '-m', 'x', '-ngl', '12']);
    // Null is "the descriptor decides", and must not touch the command at all.
    assert.deepEqual(withGpuLayers(argv, null), argv);
  });

  test('the effective placement is read from the descriptor when nothing was set', () => {
    // A model installed before this feature existed carries its own -ngl and keeps behaving so.
    assert.equal(effectiveGpuLayers({ launchCommand: ['s', '-ngl', '99'] }), 99);
    assert.equal(effectiveGpuLayers({ launchCommand: ['s', '-ngl', '0'] }), 0);
    // The setting wins over the descriptor.
    assert.equal(effectiveGpuLayers({ gpuLayers: 36, launchCommand: ['s', '-ngl', '99'] }), 36);
    // Nothing anywhere means nothing on the card, which is the safe reading.
    assert.equal(effectiveGpuLayers({ launchCommand: ['s', '-m', 'x'] }), 0);
    assert.equal(effectiveGpuLayers({}), 0);
    assert.equal(placementOf(0), 'ram');
    assert.equal(placementOf(36, 65), 'hybrid');
    assert.equal(placementOf(65, 65), 'gpu');
    assert.equal(placementOf(99), 'gpu');
  });

  test('a nonsensical layer count is refused rather than passed to the runtime', async () => {
    const { runtime } = fresh();
    await assert.rejects(() => runtime.configure({ mode: RuntimeMode.AUTO, gpuLayers: -1 }), /0 or more/);
    await assert.rejects(() => runtime.configure({ mode: RuntimeMode.AUTO, gpuLayers: 2.5 }), /0 or more/);
    // 99 is NOT refused: llama.cpp reads any number above the layer count as "all of them", and
    // every descriptor already installed says exactly that.
    await runtime.configure({ mode: RuntimeMode.AUTO, gpuLayers: 99 });
    assert.equal(runtime.config().gpuLayers, 99);
  });

  test('status reports where the model runs, not merely what was configured', async () => {
    const { runtime } = fresh();
    await runtime.configure({ mode: RuntimeMode.AUTO, launchCommand: ['/bin/sleep', '60', '-ngl', '99'] });
    assert.equal(runtime.status().gpuLayers, null, 'nothing was set');
    assert.equal(runtime.status().effectiveGpuLayers, 99, 'so the descriptor decides');
    assert.equal(runtime.status().placement, 'gpu');

    await runtime.configure({ gpuLayers: 0 });
    assert.equal(runtime.status().placement, 'ram');
    await runtime.configure({ gpuLayers: 36 });
    assert.equal(runtime.status().placement, 'hybrid');
  });

  // The recommendation is arithmetic, and these are the numbers measured on this installation on
  // 2026-08-28 — Qwen3.8-27B, 65 layers, 15.33 GiB, on a 12 GiB card. A recommendation that could
  // not be checked against a real machine would be a preference wearing a number's clothes.
  test('the recommendation is worked out from the model and the card, and says so', () => {
    const model = { layers: 65, bytes: 16464440224 };
    const tight = recommendPlacement({ ...model, freeVramMiB: 12158 });
    assert.equal(tight.known, true);
    assert.equal(tight.fitsEntirely, false, '15.3 GiB of weights do not fit on a 12 GiB card');
    assert.ok(tight.maxLayers > 0 && tight.maxLayers < 65, `expected a partial split, got ${tight.maxLayers}`);
    assert.equal(tight.recommended, tight.maxLayers);
    assert.match(tight.reason, /do not fit/);

    // The same model on a card that holds it: all of them, and the reason says why.
    const roomy = recommendPlacement({ ...model, freeVramMiB: 24576 });
    assert.equal(roomy.fitsEntirely, true);
    assert.equal(roomy.recommended, 65);
    assert.match(roomy.reason, /all 65 layers fit/);

    // A card with nothing spare holds nothing, and that is RAM — not a negative number.
    assert.equal(recommendPlacement({ ...model, freeVramMiB: 512 }).maxLayers, 0);
  });

  test('an unknown model is reported as unknown rather than given an invented recommendation', () => {
    for (const missing of [{}, { layers: 65 }, { bytes: 1e9 }, { layers: 65, bytes: 1e9 }]) {
      const answer = recommendPlacement({ ...missing, freeVramMiB: missing.layers && missing.bytes ? null : 12158 });
      assert.equal(answer.known, false);
      assert.equal(answer.recommended, null);
      assert.match(answer.reason, /does not declare|nothing can be worked out/);
    }
    // And a descriptor that never carried the numbers reads as absent, not as zero.
    assert.deepEqual(declaredSize({ resource_profiles: [{ name: 'gpu' }] }), { layers: null, bytes: null });
    assert.deepEqual(declaredSize({ resource_profiles: [{ name: 'gpu', layers: 65, bytes: 42 }] }), { layers: 65, bytes: 42 });
  });

  // The defect the Owner reasoned out from the surface before it ever bit anyone: one setting for
  // the whole installation means the model you placed yesterday places the one you load today.
  test('each model keeps its own placement, and does not inherit the previous one', async () => {
    const { runtime, grants } = fresh();
    await runtime.configure({ mode: RuntimeMode.AUTO, launchCommand: ['/bin/sleep', '60'] });
    await runtime.configure({ placeModel: { id: 'big-one', gpuLayers: 0 } });
    await runtime.configure({ placeModel: { id: 'small-one', gpuLayers: 99 } });
    assert.deepEqual(runtime.status().placements, { 'big-one': 0, 'small-one': 99 });

    const present = new Map([
      ['big-one', { verified: true }], ['small-one', { verified: true }], ['never-placed', { verified: true }],
    ]);
    const start = async (id) => activateModel({
      descriptor: { id, launchCommand: ['/bin/sleep', '60'] },
      present, runtime, grants, actor: 'test-owner', descriptorAuthenticity: SIGNED,
    });

    await start('big-one');
    assert.equal(runtime.config().gpuLayers, 0, 'the big one was put in RAM');
    await runtime.release();

    await start('small-one');
    assert.equal(runtime.config().gpuLayers, 99, 'and the small one must NOT inherit RAM from it');
    await runtime.release();

    // A model nobody placed hands the decision back to its own descriptor rather than keeping
    // whatever the last model was given.
    await start('never-placed');
    assert.equal(runtime.config().gpuLayers, null);
    await runtime.release();
  });

  test('placing one model does not require rewriting the whole map, and is validated', async () => {
    const { runtime } = fresh();
    await runtime.configure({ mode: RuntimeMode.AUTO });
    await assert.rejects(() => runtime.configure({ placeModel: { id: '', gpuLayers: 0 } }), /must be a model id/);
    await assert.rejects(() => runtime.configure({ placeModel: { id: 'x', gpuLayers: -3 } }), /0 or more/);
    await assert.rejects(() => runtime.configure({ placements: [] }), /object of model id/);
    // null is allowed and means "let the descriptor decide" — it is not the same as 0.
    await runtime.configure({ placeModel: { id: 'x', gpuLayers: null } });
    assert.deepEqual(runtime.status().placements, { x: null });
    // `placeModel` is consumed, never persisted as a field of its own.
    assert.equal(runtime.config().placeModel, undefined);
  });
});

// --- activateModel — the connection D-0444 adds between the catalogue and this class -------
//
// Owner report, 2026-08-14: the `/models` menu entry only ever navigated to a settings page
// that could show status and never let a present model actually be loaded. Proved here with a
// fake descriptor + a real `/bin/sleep` standing in for an inference server, since this
// installation's own catalogue is empty (`/workspace/models` does not exist) — the mechanism
// is what is under test, not any particular model.

test('activateModel launches a present, described model end to end', async () => {
  const { runtime, grants } = fresh();
  const descriptor = { id: 'test-model', launchCommand: ['/bin/sleep', '60'] };
  const present = new Map([['test-model', { verified: true }]]);
  const result = await activateModel({ descriptor, present, runtime, grants, actor: 'test-owner', descriptorAuthenticity: SIGNED });
  assert.equal(result.activated, true);
  assert.equal(result.id, 'test-model');
  assert.ok(Number.isInteger(result.pid));
  assert.equal(runtime.status().model, 'test-model');
  assert.equal(runtime.status().launched.exited, false);
  await runtime.release();
});

// Defect n.9, seen live on 2026-08-27: the Owner swapped the served model from the interface and
// `/workspace/config/local-model.json` still read `"profileId": "cpu"` while the model ran on the
// GPU with `-ngl 99`. `activateModel` rewrote the constant on every activation, and `status()`
// reported that pinned field as if it were the effective one. Both halves are pinned here.
test('activateModel does not write a pinned CPU profile into an automatic runtime', async () => {
  const { runtime, grants } = fresh();
  await runtime.configure({ mode: RuntimeMode.AUTO, launchCommand: ['/bin/sleep', '60'] });
  const descriptor = { id: 'test-model-3', launchCommand: ['/bin/sleep', '60'] };
  const present = new Map([['test-model-3', { verified: true }]]);
  await activateModel({ descriptor, present, runtime, grants, actor: 'test-owner', descriptorAuthenticity: SIGNED });
  const status = runtime.status();
  assert.equal(status.mode, RuntimeMode.AUTO);
  assert.equal(status.profileId, null, 'automatic mode pins nothing; a written `cpu` here is the defect');
  // Deliberately not a literal: on a host with a card this is `cuda:0`, on one without it is
  // `cpu`, and pinning either would make the test a statement about the CI machine instead of
  // about the product. What must hold on every host is that the effective profile is REPORTED
  // and is not merely an echo of the pinned field — which is the whole of defect n.9.
  assert.ok(status.launched.profileId, 'the profile it actually runs on must be reported');
  assert.notEqual(status.launched.profileId, status.profileId);
  await runtime.release();
});

// Owner report, 2026-08-29: the page showed "46 of 65 layers on the card" and llama-server still
// died with `allocating 14806.05 MiB on device 0: cudaMalloc failed: out of memory` — the whole
// model. The saved choice was 65, from before the card was measured; the browser clamped it for
// DISPLAY and the runtime launched the 65 anyway. The clamp belongs on the start path, where the
// number the person reads and the number the process gets become the same number.
test('activateModel brings a saved placement down to what the card holds', async () => {
  const { runtime, grants } = fresh();
  await runtime.configure({ mode: RuntimeMode.AUTO, launchCommand: ['/bin/sleep', '60'] });
  await runtime.configure({ placeModel: { id: 'test-model-oom', gpuLayers: 65 } });
  const descriptor = { id: 'test-model-oom', launchCommand: ['/bin/sleep', '60'] };
  const present = new Map([['test-model-oom', { verified: true }]]);
  await activateModel({
    descriptor, present, runtime, grants, actor: 'test-owner',
    descriptorAuthenticity: SIGNED, maxGpuLayers: 46,
  });
  assert.equal(runtime.status().gpuLayers, 46, 'a stored 65 on a card that holds 46 must launch as 46');
  await runtime.release();
  // And a card that could not be measured decides nothing: the saved choice is obeyed as it is.
  await runtime.configure({ placeModel: { id: 'test-model-oom', gpuLayers: 30 } });
  await activateModel({
    descriptor, present, runtime, grants, actor: 'test-owner',
    descriptorAuthenticity: SIGNED, maxGpuLayers: null,
  });
  assert.equal(runtime.status().gpuLayers, 30);
  await runtime.release();
});

test('activateModel replaces whatever was already running, not run alongside it', async () => {
  const { runtime, grants } = fresh();
  await runtime.configure({ mode: RuntimeMode.MANUAL, profileId: 'cpu', launchCommand: ['/bin/sleep', '60'] });
  const first = await runtime.launch({ capabilityToken: grantLaunch(grants) });
  const descriptor = { id: 'test-model-2', launchCommand: ['/bin/sleep', '60'] };
  const present = new Map([['test-model-2', { verified: true }]]);
  const second = await activateModel({ descriptor, present, runtime, grants, actor: 'test-owner', descriptorAuthenticity: SIGNED });
  assert.notEqual(second.pid, first.pid, 'a new process must actually have been spawned');
  assert.equal(runtime.status().launched.pid, second.pid, 'only the new process is tracked as running');
  await runtime.release();
});

test('activateModel refuses a model this installation does not know about', async () => {
  const { runtime, grants } = fresh();
  await assert.rejects(
    () => activateModel({ descriptor: null, present: new Map(), runtime, grants, actor: 'test-owner', descriptorAuthenticity: SIGNED }),
    /no such model is known/,
  );
});

test('activateModel refuses a model that is not present and verified', async () => {
  const { runtime, grants } = fresh();
  const descriptor = { id: 'not-here', launchCommand: ['/bin/sleep', '60'] };
  await assert.rejects(
    () => activateModel({ descriptor, present: new Map(), runtime, grants, actor: 'test-owner', descriptorAuthenticity: SIGNED }),
    /not a verified, present model/,
  );
  await assert.rejects(
    () => activateModel({
      descriptor, present: new Map([['not-here', { verified: false }]]), runtime, grants, actor: 'test-owner',
    }),
    /not a verified, present model/,
  );
});

test('activateModel refuses a descriptor with no declared launchCommand, rather than guessing one', async () => {
  const { runtime, grants } = fresh();
  const descriptor = { id: 'no-launch-command' };
  const present = new Map([['no-launch-command', { verified: true }]]);
  await assert.rejects(
    () => activateModel({ descriptor, present, runtime, grants, actor: 'test-owner', descriptorAuthenticity: SIGNED }),
    /declares no launchCommand/,
  );
  assert.equal(runtime.status().launched, null, 'a refused activation must not have spawned anything');
});

// ── D-0535 · starting is gated by WHO said so, not only by WHAT the bytes hash to ───────────
//
// The artefact check answers "do these bytes match the digest the descriptor declares". It
// cannot answer "and who declared that digest" — an unsigned descriptor vouches for itself.
// Three conditions, and the third is the one `F-MODEL-AUTH-001` was blocked on.
describe('D-0535 — an unchecked or unattested model is not started', () => {
  const startable = {
    id: 'test-model', launchCommand: ['node', '-e', 'setTimeout(()=>{},1000)'],
  };
  const present = new Map([['test-model', { verified: true }]]);
  const stubs = () => ({
    runtime: { release: async () => {}, config: () => ({ mode: 'manual', profileId: 'cpu' }), configure: async () => {}, launch: async () => ({ pid: 1 }) },
    grants: { request: () => ({ runId: 'r' }), approve: () => ({ token: 't' }) },
  });

  test('a caller that did not check at all is refused — an omission is not a permission', async () => {
    const { runtime, grants } = stubs();
    await assert.rejects(
      () => activateModel({ descriptor: startable, present, runtime, grants, actor: 'owner' }),
      /was not checked against a publisher registry/,
    );
  });

  test('a descriptor nobody signed is refused, and the refusal carries its reason', async () => {
    const { runtime, grants } = stubs();
    await assert.rejects(
      () => activateModel({
        descriptor: startable, present, runtime, grants, actor: 'owner',
        descriptorAuthenticity: { verified: false, kind: 'NO_SIGNATURE', reason: 'nobody signed it' },
      }),
      /nobody signed it/,
    );
  });

  test('a descriptor whose publisher key was revoked is refused', async () => {
    const { runtime, grants } = stubs();
    await assert.rejects(
      () => activateModel({
        descriptor: startable, present, runtime, grants, actor: 'owner',
        descriptorAuthenticity: { verified: false, kind: 'KEY_NOT_TRUSTED', reason: 'the key was revoked' },
      }),
      /the key was revoked/,
    );
  });

  test('SYNTHESISED starts — the product describing what it runs is not a publisher claim', async () => {
    // The carve-out that makes the gate installable. Refusing this would make an installation
    // unable to re-activate the model it is already running, which is why F-MODEL-AUTH-001
    // stayed open: the fix was never the gate, it was the distinction the gate needed.
    const { runtime, grants } = stubs();
    const result = await activateModel({
      descriptor: startable, present, runtime, grants, actor: 'owner',
      descriptorAuthenticity: { verified: false, kind: 'SYNTHESISED', reason: 'this installation wrote this record' },
    });
    assert.equal(result.activated, true);
  });

  test('a verified descriptor starts', async () => {
    const { runtime, grants } = stubs();
    const result = await activateModel({
      descriptor: startable, present, runtime, grants, actor: 'owner', descriptorAuthenticity: SIGNED,
    });
    assert.equal(result.activated, true);
  });

  test('an explicit null starts — a caller with no registry says so instead of staying silent', async () => {
    const { runtime, grants } = stubs();
    const result = await activateModel({
      descriptor: startable, present, runtime, grants, actor: 'owner', descriptorAuthenticity: null,
    });
    assert.equal(result.activated, true);
  });
});

// ── the launch door decides whether the model thinks ──────────────────────────────────────
//
// Owner, 2026-08-29: the research gate answered INTERNAL "unparseable answer" and the page said
// reasoning_unavailable, about an engine that was answering 200 in under four seconds. The 27B
// spends its budget in reasoning_content and returns content: "". The gateway had already been
// taught to ask for no thinking — but the gate is asked by atomd, which is Rust and calls the
// model itself, so the JavaScript switch never touched it. One flag on the shared process does.

test('a launch argv is given --reasoning off', () => {
  assert.deepEqual(
    withoutReasoning(['llama-server', '-m', '/models/x.gguf']),
    ['llama-server', '-m', '/models/x.gguf', '--reasoning', 'off'],
  );
});

test('a descriptor that already decided is left alone, in either spelling', () => {
  // Same posture as withGpuLayers: this settles only what nobody settled. A second --reasoning
  // would leave the answer to whichever one llama.cpp happens to read last.
  const on = ['llama-server', '--reasoning', 'on'];
  assert.deepEqual(withoutReasoning(on), on);
  const short = ['llama-server', '-rea', 'auto'];
  assert.deepEqual(withoutReasoning(short), short);
});

test('it does not accumulate when applied twice', () => {
  const once = withoutReasoning(['llama-server']);
  assert.deepEqual(withoutReasoning(once), once);
});

test('the argv is not mutated in place', () => {
  const argv = ['llama-server'];
  withoutReasoning(argv);
  assert.deepEqual(argv, ['llama-server'], 'a caller must not find its own array changed');
});
