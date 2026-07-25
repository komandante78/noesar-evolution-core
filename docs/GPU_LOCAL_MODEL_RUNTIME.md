# GPU and local model runtime

**Status:** `GPU_RUNTIME_PATH=PASS` · `GPU_INFERENCE_TEST=BLOCKED_NO_LOCAL_MODEL`
**Supersedes:** the Phase 4 verdict `GPU_RUNTIME=NOT_IMPLEMENTED`.

---

## What was wrong with the previous state, precisely

Phase 4's assessment was correct and is worth restating: every GPU reference in the
shipped runtime was **inventory and planning**. `hardware.mjs` shelled out to `nvidia-smi`
and recorded what it found; `recommendRuntime()` turned that into advisory strings; a
watchdog subject reported and never acted. There was no CUDA binding, no model loading and
no inference code, and reporting "GPU supported" on the strength of `nvidia-smi` being
visible would have been an unverified claim.

The gate's requirement is explicit that detection alone does not satisfy it. What was
missing is the **path** between detection and use: choose a device, hold that choice,
refuse one the hardware cannot honour, attach to something that does the inference, fall
back to CPU deliberately rather than by accident, and release what was taken.

That path now exists. What still does not exist — and this document does not pretend
otherwise — is an in-process inference engine. This product delegates inference over HTTP,
and every status payload says so in a field named `inProcessInference: false`.

## Requirements and where each is met

| Requirement | Implementation | Verified by |
|---|---|---|
| Hardware detection | `detect()` parses `nvidia-smi --query-gpu=…`, returning index, name, uuid, total/used/free VRAM, driver, compute capability | `local-model-runtime.test.mjs` |
| CPU profile | always present, always available — fallback must never be the unavailable thing | test 20 |
| NVIDIA CUDA profile | one profile per device, `cuda:<index>` | live probe below |
| Available GPU memory | `memoryFreeMiB` per device, refreshed on every `profiles()` call | live probe below |
| Automatic or manual selection | `mode: auto \| manual \| disabled` | tests 9–11 |
| Local OpenAI-compatible provider | `attach()` probes `/v1/models`; `complete()` posts `/v1/chat/completions` | tests 13–15 |
| Controlled start or attach | `launchCommand` is an argv array, never a shell string; nothing is launched unless configured | tests 7, 17, 18 |
| CPU fallback | automatic mode falls back and **reports that it did**, with the reason | test 10 |
| Explicit GPU error | manual mode never silently substitutes CPU for a named device | test 11 |
| Resource release | `release()` SIGTERM then SIGKILL, tracked child, idempotent | test 18 |
| VRAM limits | `vramLimitMiB`, refused above the device's total, enforced in selection | tests 8, 9 |
| No GPU access without configuration | default `disabled`; in that mode nothing executes `nvidia-smi`, spawns a process or opens a socket | tests 1–4, live `MU-24`, `MU-25` |

## No GPU access without configuration

This is the requirement most easily faked, so it is implemented as a hard property rather
than a policy: when the mode is `disabled`, `detect()` returns

```json
{ "inspected": false, "reason": "the local model runtime is disabled; no accelerator was queried", "accelerators": [] }
```

without running anything at all. The `inspected` flag is what makes the claim checkable —
without it, a disabled runtime is indistinguishable from a host with no card.

The environment can only ever make the runtime **more** restrictive than stored
configuration: `NOESAR_LOCAL_MODEL_RUNTIME=disabled` overrides a stored `auto`, never the
other way round, so an operator can switch the capability off at the container level
without editing workspace state. The shipped image sets it to `disabled`.

When a CPU profile is selected, a launched child is given `CUDA_VISIBLE_DEVICES=''` — the
devices are removed from its view rather than the runtime being asked nicely.

The installed container is started **without `--gpus`**, so it has no device nodes at all.
That is the default and it is intentional: enabling acceleration is an explicit operator
action that changes the container's runtime profile.

## Containment decisions

* **A local endpoint must be on loopback.** `127.0.0.1`, `localhost`, `::1`. A "local
  model runtime" that can be pointed at a remote host is a data exfiltration path wearing
  a local name; anything remote belongs to the provider gateway, which has its own
  controls.
* **`launchCommand` is an argv array.** A command assembled as text and handed to a shell
  is a command an operator-supplied model name can extend.
* **Nothing is launched by default.** No `launchCommand` is configured out of the box, so
  a default installation starts no inference process.

## Live hardware verification

The host carries one accelerator, and the detection path was exercised against it:

```text
NVIDIA GeForce RTX 3060, 12288 MiB total, 12158 MiB free, driver 580.173.02
compute processes at the time of measurement: none
```

`nvidia-smi` was run in the same form the runtime uses. The GPU was idle and remained
idle: no container was given `--gpus`, no CUDA context was created, and no other
project's workload was disturbed — which the gate required explicitly.

## GPU_INFERENCE_TEST = BLOCKED_NO_LOCAL_MODEL

No real inference test was performed, and none is claimed.

**Why.** A real test needs a local OpenAI-compatible inference server and a model. Neither
exists in a form this phase may use:

* No GGUF or other model weights exist anywhere on this host — `find` over
  `/mnt/user/FRIDAYN/models` and `/mnt/cachec` returned nothing, and the CodeN Ultra model
  store directory does not exist.
* No inference runtime binary is installed on the host: no `llama-server`, no `llama-cli`,
  no `ollama`.
* The only inference binaries on this machine live inside another project's container
  image. Starting it is forbidden by this gate (`UNRELATED_CONTAINERS_TOUCHED=false`) and
  by CLAUDE10 rule 16.
* Downloading a model is out of scope: the gate requires separate authorisation for it.

What **was** verified end to end is the entire path around the model: configuration,
selection, VRAM budgeting, attach against a real OpenAI-compatible HTTP surface, a full
`/v1/chat/completions` round trip returning content with the backend and fallback state
attached, process launch and release, and the failure modes (unreachable endpoint, error
status, immediate child exit). Those ran against a stub server, and a stub server is not a
model — so the label stays `BLOCKED`, not `PARTIAL`.

### The minimum needed to close it

```text
runtime   llama.cpp server (llama-server) with an OpenAI-compatible /v1 surface,
          or vLLM, or Ollama — any of the three satisfies the contract
model     one small instruction-tuned GGUF that fits well inside 12 GiB,
          e.g. a 7B-class model at Q4_K_M (~4.4 GiB) or smaller
config    NOESAR_LOCAL_MODEL_RUNTIME unset (or not 'disabled'),
          mode=manual, profileId=cuda:0, vramLimitMiB<=11000,
          endpoint=http://127.0.0.1:<port>,
          launchCommand=["/path/to/llama-server","-m","/path/to/model.gguf",
                         "--host","127.0.0.1","--port","<port>","-ngl","99"]
container --gpus all (or --gpus device=0) plus the NVIDIA container runtime
```

With those present the tests to run are the ones this phase deliberately did not fake:
detection, VRAM accounting under a real allocation, CPU fallback when the budget is
exceeded, resource release verified against `nvidia-smi`, error handling on a GPU fault,
and confirmation that no allocation persists after `release()`.

## API surface

```text
GET  /api/v1/runtime/local-model             hardware.read   current status
GET  /api/v1/runtime/local-model/profiles    hardware.read   detected profiles
GET  /api/v1/runtime/local-model/selection   hardware.read   what a request would run on
PUT  /api/v1/runtime/local-model             model.manage    configure (validated)
POST /api/v1/runtime/local-model/attach      model.manage    probe the endpoint
POST /api/v1/runtime/local-model/launch      model.manage    start the configured runtime
POST /api/v1/runtime/local-model/release     model.manage    stop it and release the device
POST /api/v1/runtime/local-model/complete    provider.use    one chat completion
```

`model.manage` is held by owner and admin only.

## Evidence

| Suite | Result |
|---|---|
| `test/local-model-runtime.test.mjs` | **20/20 PASS** |
| `tools/acceptance/multi-user-isolation.mjs` `MU-24`…`MU-26` (live) | **PASS** |
| Live `nvidia-smi` detection against the RTX 3060 | recorded above |
| Real model inference | **BLOCKED_NO_LOCAL_MODEL** |
