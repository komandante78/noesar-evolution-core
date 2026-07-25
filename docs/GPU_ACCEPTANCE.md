# Phase 4 — GPU acceptance

## Verdict

```text
GPU_RUNTIME=NOT_IMPLEMENTED
GPU_ALLOCATED=false
CPU_BASELINE=RECORDED
```

No GPU was allocated, no `--gpus` flag was used, and no probe container was created for
GPU work. The Owner's instruction for this phase was to attempt GPU validation only if the
product implements a real GPU backend. It does not.

## Why: what the code actually contains

Every GPU reference in the shipped runtime is **inventory and planning**:

- `src/hardware.mjs` shells out to `nvidia-smi --query-gpu=index,name,uuid,memory.total,driver_version`
  and to `rocminfo`, and records what it finds in an `accelerators` array.
- `recommendRuntime()` turns that array into advisory strings — `backend: 'CUDA'`,
  `strategy: 'GPU offload'`, `multiGpuDetected` — returned by
  `POST /api/v1/runtime/recommendation`.
- `src/observability.mjs` registers a `gpu` watchdog subject that is `essential: false`
  with `maxLevel: OBSERVE`, i.e. it reports and never acts.

There is no CUDA binding, no ONNX or llama runtime, no model loading, no tensor library,
and no inference code of any kind. Model inference is delegated entirely to an external
provider over HTTP. The container is `node:22-bookworm-slim` with five Debian packages and
zero third-party npm dependencies.

`nvidia-smi` being visible on the host proves the host has a GPU. It says nothing about
whether this product can use one, and reporting "GPU supported" on that basis would be
exactly the kind of unverified claim this project's rules forbid.

## CPU baseline, recorded

The baseline is the acceptance run itself, all of it CPU-only:

| Measure | Value |
|---|---|
| Container | `noesar-evolution`, image `noesar-evolution:phase4` |
| CPU envelope | `--cpus 4` (`NanoCpus=4000000000`), host is a Ryzen 5 5600X, 6c/12t, AVX2 |
| Memory envelope | `--memory 8g`; `--memory-swap` has no effect (kernel lacks swap accounting, host has zero swap) |
| Full unit suite | 351 tests in ~1.7 s |
| Health check | `/healthz` 17 components, 0 unhealthy |
| Restart to healthy | 1 s observed (REC-02) |
| Streaming chat | 9 SSE frames end to end against a local mock provider (WORK-29) |

## What would have to exist first

For a GPU acceptance to mean anything, the product would need an in-process inference
backend, or an explicit contract with a co-located GPU-backed provider container. If a
future phase adds one, the tests to run are the ones this phase deliberately did not fake:
detection, VRAM accounting, CPU fallback, resource release, error handling on a GPU fault,
and no permanent allocation. Until then the honest label is the one at the top of this
document.
