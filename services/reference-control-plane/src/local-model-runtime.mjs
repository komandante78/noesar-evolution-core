// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Local model runtime: hardware profiles, accelerator selection, and a controlled
// attachment to a local OpenAI-compatible inference server.
//
// What this is not: an inference engine. This product does not link CUDA, does not load
// tensors and does not decode tokens. Phase 4 recorded that plainly and it is still true.
// What was missing, and what this adds, is the path between the two: detect what the host
// has, let the operator choose CPU or a specific GPU, hold that choice, refuse a choice
// the hardware cannot honour, attach to a local server that does the inference, fall back
// to CPU deliberately rather than by accident, and release what was taken.
//
// The default is `disabled`, and disabled means disabled: in that mode nothing here
// executes nvidia-smi, opens a device, spawns a process or reaches an endpoint. A GPU is
// touched only after an operator has written a configuration saying so.
//
// ARCH-005: `launch()` is this adapter's ModelRuntimeAdapter surface in the sense
// 03_ARCHITETTURA.md §4 means it — the one method here that spawns a real OS process and
// hands it GPU access. It refuses to run without a capability token spent through the
// SAME TokenMinter workspace-actions.mjs spends (see adapter-capability.mjs), because a
// manifest is a request and this adapter has no way to grant one to itself.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CapabilityError } from './capability.mjs';

export const RuntimeMode = Object.freeze({
  DISABLED: 'disabled',
  AUTO: 'auto',
  MANUAL: 'manual',
});

export const Backend = Object.freeze({
  CPU: 'cpu',
  CUDA: 'cuda',
});

// `D-0541`. Both are constants rather than configuration on purpose: they are a reliability
// policy, not a preference, and an installation that could set "one failure is enough" would be
// choosing to flap. The interval is a ceiling on how often the endpoint is asked, not a promise
// that it is asked that often — nothing is asked while the runtime is disabled.
const LIVENESS_INTERVAL_MS = 15_000;
const LIVENESS_FAILURES_BEFORE_DOWN = 2;

const DEFAULT_CONFIG = Object.freeze({
  mode: RuntimeMode.DISABLED,
  profileId: null,
  endpoint: null,
  model: null,
  vramLimitMiB: null,
  // An argv array, never a shell string. A command assembled as text and handed to a
  // shell is a command an operator-supplied model name can extend.
  launchCommand: null,
  launchReadyTimeoutMs: 120000,
});

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function runCommand(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

export class LocalModelRuntime {
  // ARCH-005: `minter` is the same TokenMinter instance workspace-actions.mjs spends
  // through, not a copy — a second engine would let a token minted through one door be
  // unaccountable to the other. `resourceId` matches the key this adapter is registered
  // under in adapter-capability.mjs's ADAPTER_MANIFESTS.
  constructor({ workspace, env = process.env, logger = null, minter = null, resourceId = 'local-model-runtime' } = {}) {
    this.workspace = workspace;
    this.env = env;
    this.logger = logger;
    this.minter = minter;
    this.resourceId = resourceId;
    this.configPath = path.join(workspace, 'config', 'local-model.json');
    this.launched = null;
    this.lastError = null;
    this.lastProbe = null;
    // `D-0541` — the health lane. Three fields, and each answers a different question a reader
    // has actually asked: WHEN was the endpoint last seen (`lastSeenAtMs`), how many probes have
    // failed in a row since (`consecutiveFailures`), and is one in flight right now
    // (`livenessInFlight`, so a page opened in three tabs does not become three probes of a
    // server that is busy generating — the same single-flight `refreshActiveModel` uses).
    this.lastSeenAtMs = null;
    this.consecutiveFailures = 0;
    this.livenessInFlight = null;
    this.lastLivenessAtMs = null;
  }

  /**
   * `D-0541`. Ask, cheaply and on a leash, whether the configured endpoint is still there.
   *
   * # Why this exists
   *
   * `lastProbe` was only ever written by `attach()`, which an operator calls once. In attach
   * mode — binding to a server somebody else started, which is the normal case on a host with
   * no runtime of its own — a server that died stayed `ok: true` forever, and the FIRST CHAT
   * MESSAGE after the death was what discovered it. That is the wrong thing to pay with.
   *
   * # The three properties, none of them optional
   *
   * 1. **It never blocks a reader.** It returns the knowledge already held and refreshes in the
   *    background; `status()` stays synchronous and so does everything derived from it.
   * 2. **Two consecutive failures, not one.** A single missed probe against a server that is
   *    mid-generation must not move the chat to a different provider — a liveness policy that
   *    flaps does more damage than the staleness it removes. The count is reset by one success.
   * 3. **Disabled means disabled.** With the runtime off, or with no endpoint, this performs no
   *    fetch at all — the default installation makes no request because of this method.
   */
  liveness({ nowMs = Date.now(), intervalMs = LIVENESS_INTERVAL_MS, timeoutMs = 2000 } = {}) {
    const config = this.config();
    if (config.mode === RuntimeMode.DISABLED || !config.endpoint) {
      // Not a failure: nothing was asked, so nothing is concluded. Clearing the counter here
      // means switching a runtime off and on again does not start it one strike down.
      this.consecutiveFailures = 0;
      return this.livenessReport({ nowMs });
    }
    const due = this.lastLivenessAtMs === null || (nowMs - this.lastLivenessAtMs) >= intervalMs;
    if (due && !this.livenessInFlight) {
      this.lastLivenessAtMs = nowMs;
      this.livenessInFlight = this.#probeLiveness({ timeoutMs })
        .finally(() => { this.livenessInFlight = null; });
    }
    return this.livenessReport({ nowMs });
  }

  async #probeLiveness({ timeoutMs }) {
    try {
      // `attach()` is the ONE observer of the endpoint, so it is the one place that records
      // what was observed — the counter, and the monotone "last seen". Counting again here
      // made two failures read as four, which would have halved the hysteresis in exactly the
      // path it was built for. Found by a test that asserted the number, not merely the state.
      await this.attach({ timeoutMs });
    } catch {
      // Swallowed deliberately: a background reading that throws would become an unhandled
      // rejection on a timer nobody awaits, and would end the process over a dead model.
      this.#log('warn', 'local-model.liveness-failed', {
        consecutiveFailures: this.consecutiveFailures, endpoint: this.config().endpoint,
      });
    }
  }

  /** What is known right now — no probe, no await, safe to call from any reader. */
  livenessReport({ nowMs = Date.now() } = {}) {
    const seenAt = this.lastSeenAtMs ?? (this.lastProbe?.ok ? Date.parse(this.lastProbe.at) : null);
    return {
      ok: this.consecutiveFailures < LIVENESS_FAILURES_BEFORE_DOWN,
      consecutiveFailures: this.consecutiveFailures,
      // `null` and `0` are different answers: never seen, versus seen this instant.
      ageMs: Number.isFinite(seenAt) ? Math.max(0, nowMs - seenAt) : null,
      lastSeenAt: Number.isFinite(seenAt) ? new Date(seenAt).toISOString() : null,
      failuresBeforeDown: LIVENESS_FAILURES_BEFORE_DOWN,
    };
  }

  #log(level, event, detail = {}) {
    if (this.logger?.[level]) this.logger[level](event, { component: 'local-model', ...detail });
  }

  config() {
    // The environment can only ever make the runtime MORE restrictive than the stored
    // configuration, never less: NOESAR_LOCAL_MODEL_RUNTIME=disabled wins over a stored
    // 'auto', so an operator can switch the whole capability off at the container level
    // without editing workspace state.
    const stored = fs.existsSync(this.configPath)
      ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(this.configPath, 'utf8')) }
      : { ...DEFAULT_CONFIG };
    if (String(this.env.NOESAR_LOCAL_MODEL_RUNTIME ?? '').toLowerCase() === 'disabled') {
      return { ...stored, mode: RuntimeMode.DISABLED, overriddenByEnvironment: true };
    }
    return { ...stored, overriddenByEnvironment: false };
  }

  async #writeConfig(next) {
    await fsp.mkdir(path.dirname(this.configPath), { recursive: true, mode: 0o700 });
    await fsp.writeFile(this.configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return next;
  }

  /**
   * Enumerate the accelerators the host exposes.
   *
   * Returns an empty accelerator list without running anything when the runtime is
   * disabled. That is the difference between "there is no GPU" and "we did not look",
   * and the returned `inspected` flag says which one happened.
   */
  async detect() {
    const config = this.config();
    if (config.mode === RuntimeMode.DISABLED) {
      return {
        inspected: false,
        reason: 'the local model runtime is disabled; no accelerator was queried',
        accelerators: [],
        cudaAvailable: false,
        driverVersion: null,
      };
    }
    const query = await runCommand('nvidia-smi', [
      '--query-gpu=index,name,uuid,memory.total,memory.used,memory.free,driver_version,compute_cap',
      '--format=csv,noheader,nounits',
    ]);
    if (!query.ok) {
      return {
        inspected: true,
        reason: `nvidia-smi is not available or returned an error: ${query.stderr.trim().slice(0, 200) || 'no output'}`,
        accelerators: [],
        cudaAvailable: false,
        driverVersion: null,
      };
    }
    const accelerators = query.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [index, name, uuid, total, used, free, driver, computeCap] = line.split(',').map((v) => v.trim());
      return {
        id: `cuda:${index}`,
        backend: Backend.CUDA,
        index: Number.parseInt(index, 10),
        name,
        uuid,
        memoryTotalMiB: Number.parseInt(total, 10),
        memoryUsedMiB: Number.parseInt(used, 10),
        memoryFreeMiB: Number.parseInt(free, 10),
        driverVersion: driver,
        computeCapability: computeCap ?? null,
      };
    });
    return {
      inspected: true,
      reason: accelerators.length ? null : 'nvidia-smi reported no devices',
      accelerators,
      cudaAvailable: accelerators.length > 0,
      driverVersion: accelerators[0]?.driverVersion ?? null,
    };
  }

  async profiles() {
    const detection = await this.detect();
    const cpu = {
      id: 'cpu',
      backend: Backend.CPU,
      name: 'CPU',
      // Always selectable. The CPU profile is what "fallback" means, so it must never be
      // the thing that is unavailable.
      available: true,
      memoryTotalMiB: null,
    };
    return {
      detection,
      profiles: [cpu, ...detection.accelerators.map((device) => ({
        ...device,
        available: true,
      }))],
    };
  }

  /**
   * Persist a configuration change, validating it against what the host actually has.
   * A configuration that names a device this machine does not expose is refused here
   * rather than accepted and discovered to be wrong at the first request.
   */
  async configure(patch = {}) {
    const current = this.config();
    const next = { ...DEFAULT_CONFIG, ...current, ...patch };
    delete next.overriddenByEnvironment;

    if (!Object.values(RuntimeMode).includes(next.mode)) {
      throw fail(`mode must be one of ${Object.values(RuntimeMode).join(', ')}`);
    }
    if (next.vramLimitMiB != null) {
      const limit = Number(next.vramLimitMiB);
      if (!Number.isInteger(limit) || limit < 256) {
        throw fail('vramLimitMiB must be an integer of at least 256');
      }
      next.vramLimitMiB = limit;
    }
    if (next.endpoint != null) {
      let parsed;
      try {
        parsed = new URL(String(next.endpoint));
      } catch {
        throw fail('endpoint must be an absolute URL');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw fail('endpoint must be http or https');
      }
      // A "local" model runtime that can be pointed at a remote host is a data
      // exfiltration path wearing a local name. Only loopback is accepted.
      if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
        throw fail('a local model endpoint must be on loopback; use a provider for anything remote', 400);
      }
      next.endpoint = parsed.toString();
    }
    if (next.launchCommand != null) {
      if (!Array.isArray(next.launchCommand) || next.launchCommand.length === 0
        || !next.launchCommand.every((part) => typeof part === 'string')) {
        throw fail('launchCommand must be a non-empty array of strings (argv, never a shell string)');
      }
    }

    if (next.mode === RuntimeMode.MANUAL) {
      if (!next.profileId) throw fail('manual mode requires profileId');
      const { profiles } = await this.profiles();
      const chosen = profiles.find((profile) => profile.id === next.profileId);
      if (!chosen) {
        const known = profiles.map((p) => p.id).join(', ');
        throw fail(`no such profile: ${next.profileId} (available: ${known})`, 409);
      }
      if (chosen.backend === Backend.CUDA && next.vramLimitMiB != null
        && next.vramLimitMiB > chosen.memoryTotalMiB) {
        throw fail(
          `vramLimitMiB ${next.vramLimitMiB} exceeds the ${chosen.memoryTotalMiB} MiB this device has`,
          409,
        );
      }
    }

    await this.#writeConfig(next);
    this.#log('info', 'local-model.configured', {
      mode: next.mode, profile: next.profileId, has_endpoint: Boolean(next.endpoint),
    });
    return this.status();
  }

  /**
   * Decide which profile a request would run on.
   *
   * `fellBack` is reported rather than hidden. A GPU that silently became a CPU is the
   * difference between a slow answer and a broken deployment, and only the operator can
   * decide which of those they are looking at.
   */
  async select({ requiredVramMiB = null } = {}) {
    const config = this.config();
    if (config.mode === RuntimeMode.DISABLED) {
      return {
        backend: null, profileId: null, fellBack: false,
        reason: 'the local model runtime is disabled',
      };
    }
    const { profiles, detection } = await this.profiles();

    if (config.mode === RuntimeMode.MANUAL) {
      const chosen = profiles.find((profile) => profile.id === config.profileId);
      if (!chosen) {
        // Manual means manual. Silently substituting the CPU for a GPU the operator
        // explicitly named would hide a hardware failure behind a performance change.
        this.lastError = `configured profile ${config.profileId} is not present on this host`;
        return {
          backend: null, profileId: config.profileId, fellBack: false,
          error: this.lastError,
          reason: detection.reason ?? 'the configured accelerator is not available',
        };
      }
      if (chosen.backend === Backend.CUDA) {
        const budget = config.vramLimitMiB ?? chosen.memoryFreeMiB;
        if (requiredVramMiB != null && requiredVramMiB > Math.min(budget, chosen.memoryFreeMiB)) {
          this.lastError = `the model needs ${requiredVramMiB} MiB and only ${Math.min(budget, chosen.memoryFreeMiB)} MiB is allowed or free`;
          return {
            backend: null, profileId: chosen.id, fellBack: false,
            error: this.lastError,
            reason: 'insufficient VRAM under the configured limit',
          };
        }
      }
      return {
        backend: chosen.backend, profileId: chosen.id, fellBack: false,
        vramBudgetMiB: chosen.backend === Backend.CUDA
          ? Math.min(config.vramLimitMiB ?? chosen.memoryFreeMiB, chosen.memoryFreeMiB)
          : null,
        reason: null,
      };
    }

    // Automatic: prefer the accelerator with the most free memory that satisfies the
    // budget, and fall back to CPU with the reason recorded.
    const candidates = profiles
      .filter((profile) => profile.backend === Backend.CUDA)
      .filter((profile) => {
        const budget = Math.min(config.vramLimitMiB ?? profile.memoryFreeMiB, profile.memoryFreeMiB);
        return requiredVramMiB == null || requiredVramMiB <= budget;
      })
      .sort((a, b) => b.memoryFreeMiB - a.memoryFreeMiB);

    if (candidates.length === 0) {
      return {
        backend: Backend.CPU, profileId: 'cpu', fellBack: true,
        reason: detection.cudaAvailable
          ? 'no accelerator satisfies the configured VRAM budget'
          : detection.reason ?? 'no accelerator was detected',
      };
    }
    const chosen = candidates[0];
    return {
      backend: Backend.CUDA, profileId: chosen.id, fellBack: false,
      vramBudgetMiB: Math.min(config.vramLimitMiB ?? chosen.memoryFreeMiB, chosen.memoryFreeMiB),
      reason: null,
    };
  }

  /**
   * Probe the configured local inference server. A local runtime is expected to speak the
   * OpenAI-compatible surface — /v1/models and /v1/chat/completions — which is what
   * llama.cpp's server, vLLM and Ollama all expose.
   */
  async attach({ timeoutMs = 5000 } = {}) {
    const config = this.config();
    if (config.mode === RuntimeMode.DISABLED) {
      throw fail('the local model runtime is disabled', 409);
    }
    if (!config.endpoint) throw fail('no local model endpoint is configured', 409);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL('/v1/models', config.endpoint), {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      const models = Array.isArray(body?.data) ? body.data.map((item) => item.id) : [];
      this.lastProbe = {
        at: new Date().toISOString(),
        ok: response.ok,
        status: response.status,
        models,
      };
      if (!response.ok) {
        this.lastError = `the local model endpoint answered ${response.status}`;
        throw fail(this.lastError, 502);
      }
      this.lastError = null;
      // `D-0541`: seeing the endpoint answer is the observation, wherever it came from — this
      // method is the only place that makes it, so it is the only place that records it. It is
      // MONOTONE: a later failure counts against liveness but must never erase when the model
      // was last there, which is the one fact an operator reading "it stopped answering" needs.
      // Found by a test: without this the reason read "it has never been seen answering" about
      // a model that had been answering a moment earlier.
      this.lastSeenAtMs = Date.now();
      this.consecutiveFailures = 0;
      return { attached: true, endpoint: config.endpoint, models };
    } catch (error) {
      // `D-0541`, the symmetric half: a failed attach is an OBSERVATION that the endpoint did
      // not answer, so it counts against liveness exactly as a failed background probe does.
      // Without this, the one gesture an operator performs by hand — "attach" — would be the
      // only look at the endpoint that the health lane ignored.
      this.consecutiveFailures += 1;
      if (error.status) throw error;
      this.lastError = `the local model endpoint is unreachable: ${error.message}`;
      this.lastProbe = { at: new Date().toISOString(), ok: false, status: 0, models: [] };
      throw fail(this.lastError, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Start the configured local runtime as a child process.
   *
   * Controlled in three specific ways: the command is an argv array from configuration
   * and is never passed through a shell; nothing is launched unless a command has been
   * configured, so the default installation starts no inference process at all; and the
   * child is tracked so that release() can actually reclaim the device.
   */
  async launch({ capabilityToken = null, nowUnix = Math.floor(Date.now() / 1000) } = {}) {
    const config = this.config();
    if (config.mode === RuntimeMode.DISABLED) throw fail('the local model runtime is disabled', 409);
    if (!config.launchCommand) throw fail('no launchCommand is configured', 409);
    // ARCH-005 (03_ARCHITETTURA.md §4): "no adapter may grant itself a permission — a
    // manifest is a request, the engine issues the tokens." `launch()` is the one method
    // on this adapter that spawns a real OS process and hands it GPU access, so it is the
    // one gated here. Without a minter wired in, this refuses rather than falling open —
    // a runtime nobody connected to the capability engine is not "trusted by default", it
    // is a runtime that cannot possibly hold a real token.
    if (!this.minter) {
      throw fail('no capability engine is wired to this runtime; refusing to self-authorize a launch', 500);
    }
    try {
      this.minter.spend(capabilityToken, {
        path: `adapter://${this.resourceId}/launch`, operation: 'EXECUTE',
      }, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) throw fail(`launch refused: ${error.reason}`, 403);
      throw fail(`launch refused: no valid capability token was supplied (${error.message})`, 403);
    }
    if (this.launched && !this.launched.exited) {
      return { launched: true, pid: this.launched.pid, alreadyRunning: true };
    }
    const selection = await this.select();
    if (selection.error) throw fail(selection.error, 409);

    const [command, ...args] = config.launchCommand;
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // An empty CUDA_VISIBLE_DEVICES is how a child is denied the GPU entirely. This
        // is the mechanism behind "no GPU access without configuration": a CPU selection
        // does not merely ask the runtime nicely, it removes the devices from its view.
        CUDA_VISIBLE_DEVICES: selection.backend === Backend.CUDA
          ? String(selection.profileId.split(':')[1] ?? '0')
          : '',
      },
    });
    const record = {
      pid: child.pid, child, exited: false, exitCode: null,
      startedAt: new Date().toISOString(), profileId: selection.profileId,
      recentLog: [],
    };
    const consume = (stream) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        record.recentLog.push(chunk.trimEnd());
        if (record.recentLog.length > 50) record.recentLog.shift();
      });
    };
    consume(child.stdout);
    consume(child.stderr);
    child.on('exit', (code, signal) => {
      record.exited = true;
      record.exitCode = code;
      this.#log('warn', 'local-model.exited', { code, signal, pid: record.pid });
    });
    this.launched = record;
    this.#log('info', 'local-model.launched', { pid: record.pid, profile: selection.profileId });

    if (config.endpoint) {
      const deadline = Date.now() + Number(config.launchReadyTimeoutMs ?? 120000);
      for (;;) {
        if (record.exited) {
          throw fail(
            `the local runtime exited with code ${record.exitCode}: ${record.recentLog.slice(-3).join(' | ')}`,
            502,
          );
        }
        try {
          await this.attach({ timeoutMs: 2000 });
          break;
        } catch {
          if (Date.now() > deadline) {
            throw fail('the local runtime did not become ready before the timeout', 504);
          }
          await new Promise((r) => { setTimeout(r, 500); });
        }
      }
    }
    return { launched: true, pid: record.pid, profileId: selection.profileId };
  }

  /**
   * Stop a launched runtime and release the device. SIGTERM first so the process can
   * free its VRAM allocation itself; SIGKILL only if it will not.
   */
  async release({ timeoutMs = 15000 } = {}) {
    if (!this.launched || this.launched.exited) {
      this.launched = null;
      return { released: true, alreadyStopped: true };
    }
    const record = this.launched;
    record.child.kill('SIGTERM');
    const stopped = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      record.child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    if (!stopped) {
      record.child.kill('SIGKILL');
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        record.child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    this.launched = null;
    this.#log('info', 'local-model.released', { pid: record.pid, graceful: stopped });
    return { released: true, graceful: stopped, pid: record.pid };
  }

  /**
   * Run one chat completion against the attached local runtime. Present so the runtime
   * path can be exercised end to end; the product's ordinary chat still goes through the
   * provider gateway.
   */
  async complete({ messages, model = null, timeoutMs = 120000 } = {}) {
    const config = this.config();
    if (config.mode === RuntimeMode.DISABLED) throw fail('the local model runtime is disabled', 409);
    if (!config.endpoint) throw fail('no local model endpoint is configured', 409);
    if (!Array.isArray(messages) || messages.length === 0) {
      throw fail('messages must be a non-empty array');
    }
    const selection = await this.select();
    if (selection.error) throw fail(selection.error, 409);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(new URL('/v1/chat/completions', config.endpoint), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ model: model ?? config.model ?? 'local', messages, stream: false }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw fail(`the local runtime answered ${response.status}: ${JSON.stringify(body).slice(0, 200)}`, 502);
      }
      return {
        content: body?.choices?.[0]?.message?.content ?? '',
        model: body?.model ?? model ?? config.model ?? 'local',
        backend: selection.backend,
        profileId: selection.profileId,
        fellBack: selection.fellBack,
        latencyMs: Date.now() - startedAt,
        usage: body?.usage ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  status() {
    const config = this.config();
    return {
      mode: config.mode,
      overriddenByEnvironment: Boolean(config.overriddenByEnvironment),
      // The PINNED profile, which in `auto` mode is not the one it runs on — `select()` picks
      // that one and `launched.profileId` below reports it. Defect n.9 was reading this field as
      // if it were the effective one: it said `cpu` while the model was on the GPU with `-ngl 99`,
      // and a human reading the config file had no other place to look.
      profileId: config.profileId,
      endpoint: config.endpoint,
      model: config.model,
      vramLimitMiB: config.vramLimitMiB,
      launchConfigured: Boolean(config.launchCommand),
      launched: this.launched
        ? {
          pid: this.launched.pid,
          startedAt: this.launched.startedAt,
          exited: this.launched.exited,
          profileId: this.launched.profileId,
        }
        : null,
      lastProbe: this.lastProbe,
      lastError: this.lastError,
      // `D-0541`: how fresh the evidence is, carried in the same payload everything else reads
      // from — so the router, the shells and the chips cannot each hold a different opinion
      // about whether the model is still there.
      liveness: this.livenessReport(),
      // Stated in every status payload so no reader has to infer it: this product has no
      // in-process inference backend. Acceleration is a property of the runtime it
      // attaches to, not of this process.
      inProcessInference: false,
    };
  }
}

/**
 * Switch this runtime to a model already present on this installation — the connection
 * between the catalogue (which knows WHAT is on disk, `readModelDescriptors`/
 * `readPresentModels` in `server.mjs`) and this class (which knows HOW to run a configured
 * command), which nothing in the product joined until `D-0444`: the catalogue could always
 * say a model was present, and this class could always launch a configured command, but a
 * person who wanted to switch models had no path connecting the two — the `/` menu's
 * `models` entry only ever navigated to a settings page that could show status and nothing
 * else.
 *
 * The descriptor is the one thing this function trusts for HOW to launch: `launchCommand` is
 * an OPTIONAL field on a descriptor, validated by `configure()` exactly as an operator's own
 * would be (an argv array, never a shell string), and a descriptor that does not declare one
 * is refused rather than guessed at — this function does not know what flag any particular
 * inference server uses to name a model file, and inventing one would be exactly the kind of
 * guess this project refuses to ship.
 *
 * `grants` is the SAME `AdapterGrantOrchestrator` `launch()` already requires a token from
 * (`ARCH-005`) — request then approve, in one call, because this runs inside an already-
 * authenticated, already-permission-checked request handler; a person who can reach this at
 * all already holds `model.manage`, so a second, separate human approval step here would be
 * confirming a decision already made rather than gating a new one.
 */
export async function activateModel({ descriptor, present, runtime, grants, actor, nowUnix = Math.floor(Date.now() / 1000), descriptorAuthenticity = undefined }) {
  if (!descriptor) throw fail('no such model is known to this installation', 404);
  const state = present.get(descriptor.id);
  if (!state?.verified) {
    throw fail(`\`${descriptor.id}\` is not a verified, present model on this installation`, 409);
  }
  // `D-0535` — starting is gated the way acquiring already was (`D-0523`).
  //
  // The artefact check above answers "do these bytes match the digest the descriptor declares".
  // It cannot answer "and who declared that digest": an unsigned descriptor is a document that
  // vouches for itself. Both questions, or the first one proves only internal consistency.
  //
  // `SYNTHESISED` passes deliberately — that record is the product's own account of what it is
  // running, not a publisher's claim, and refusing it would make the installation unable to
  // describe itself. That distinction is exactly what `F-MODEL-AUTH-001` was blocked on.
  //
  // `undefined` means the caller did not check. It refuses, like `planAcquisition`: an omission
  // must never read as a permission. `null` is accepted only from a caller that has no registry
  // to check against at all, and says so by passing it explicitly.
  if (descriptorAuthenticity === undefined) {
    throw fail(`\`${descriptor.id}\` was not checked against a publisher registry, and an unchecked model is not started`, 403);
  }
  if (descriptorAuthenticity !== null
      && !descriptorAuthenticity.verified
      && descriptorAuthenticity.kind !== 'SYNTHESISED') {
    throw fail(
      `\`${descriptor.id}\` is not started: ${descriptorAuthenticity.reason ?? 'its descriptor does not verify against a registered publisher'}`,
      403,
    );
  }
  if (!descriptor.launchCommand) {
    throw fail(`\`${descriptor.id}\` declares no launchCommand — this installation does not know how to start it`, 422);
  }
  const granted = grants.request({ resource: 'local-model-runtime', operation: 'EXECUTE', actor, nowUnix });
  const approved = grants.approve({ runId: granted.runId, approverId: actor, nowUnix });
  // Idempotent either way (`release()` reports `alreadyStopped` rather than failing when
  // nothing is running) — never conditioned on reading `status()` first, which would be a
  // second, race-prone source of the same fact `release()` already establishes on its own.
  await runtime.release();
  const current = runtime.config();
  const mode = current.mode === RuntimeMode.DISABLED ? RuntimeMode.MANUAL : current.mode;
  await runtime.configure({
    mode,
    // Defect n.9: this was `current.profileId ?? 'cpu'` unconditionally, so every activation
    // rewrote `cpu` into the config of an installation running in `auto` on the GPU. `auto`
    // ignores this field entirely — inventing a value for it only produced a false one for a
    // human to read. Only `MANUAL` requires it, and there `cpu` is the honest default: nothing
    // was pinned, and the CPU profile is the one that is always selectable.
    profileId: mode === RuntimeMode.MANUAL ? (current.profileId ?? 'cpu') : current.profileId,
    launchCommand: descriptor.launchCommand,
    model: descriptor.id,
    endpoint: descriptor.endpoint ?? current.endpoint ?? null,
  });
  const launched = await runtime.launch({ capabilityToken: approved.token, nowUnix });
  return { activated: true, id: descriptor.id, ...launched };
}
