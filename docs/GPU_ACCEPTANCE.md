# GPU acceptance

> Rewritten at the Phase 4 completion gate. The previous version recorded
> `GPU_RUNTIME=NOT_IMPLEMENTED`, which was accurate for that build. The earlier text is
> preserved at
> `BACKUPS/phase4c_docs_20260725T131312Z/GPU_ACCEPTANCE.md.pre_phase4_completion.bak`.

## Verdict

```text
GPU_RUNTIME_PATH=PASS
GPU_HARDWARE_PATH=IMPLEMENTED
GPU_INFERENCE_TEST=BLOCKED_NO_LOCAL_MODEL
GPU_ALLOCATED=false
IN_PROCESS_INFERENCE=false
CPU_BASELINE=RECORDED
```

Design, containment decisions and the full requirement matrix:
`GPU_LOCAL_MODEL_RUNTIME.md`.

## What changed

Phase 4's finding was that every GPU reference in the product was inventory: detection with
nothing behind it. The runtime path now exists — profiles, selection, VRAM budgeting,
attachment to a local OpenAI-compatible server, deliberate CPU fallback, explicit GPU
error, resource release — and is verified by 20 unit tests plus three live checks.

What still does not exist is an in-process inference engine, and no document in this
repository says otherwise. Every status payload carries `inProcessInference: false`.

## Hardware, observed

```text
NVIDIA GeForce RTX 3060 · 12288 MiB total · 12158 MiB free · driver 580.173.02
compute processes at the time of measurement: none
```

The GPU was **not allocated**. No container was started with `--gpus`, no CUDA context was
created, and no other project's workload was touched — which this gate required
explicitly, and which was verified by diffing `docker ps -a` against the pre-phase
inventory.

## Why the inference test is BLOCKED, not PARTIAL

A real inference test needs a local inference server and a model. On this host:

* no model weights exist anywhere (`find` over the model directories returned nothing);
* no inference runtime is installed (`llama-server`, `llama-cli`, `ollama` all absent);
* the only inference binaries live inside another project's container image, which this
  gate forbids starting;
* downloading a model requires separate authorisation this gate does not grant.

Everything *around* the model was exercised end to end against a stub OpenAI-compatible
server: configuration, selection, attach, a full `/v1/chat/completions` round trip, launch,
release, and each failure mode. A stub is not a model, so the label stays `BLOCKED`.

`GPU_LOCAL_MODEL_RUNTIME.md` records the exact minimum runtime, model and configuration
needed to close it, and the specific tests to run once they exist.

## No GPU access without configuration

The default mode is `disabled`, and in that mode the runtime queries nothing at all —
`detect()` returns `inspected: false` without executing `nvidia-smi`. That flag is what
makes the claim checkable rather than merely asserted; a disabled runtime would otherwise
be indistinguishable from a host with no card.

Verified live on the installed image: `MU-24` (mode disabled, `inProcessInference: false`)
and `MU-25` (`inspected: false`).

## CPU baseline

| Measure | Value |
|---|---|
| Container | `noesar-evolution`, image `noesar-evolution:phase4-complete` |
| CPU envelope | `--cpus 4`, host Ryzen 5 5600X, 6c/12t, AVX2 |
| Memory envelope | `--memory 8g`; `--memory-swap` still has no effect (kernel lacks swap accounting; the host has zero swap, so the intended outcome holds anyway) |
| Full unit suite | 444 tests in ~4.7 s |
| Health | `/healthz` 17 components, 0 unhealthy |
| Database ready | ~1 s from process start to `data-plane.ready` |
| Restart to ready | 2 s observed, across a real `docker restart` |
