# Build Context Contract — CANONICAL_CANDIDATE_V1 / PRODUCT

Established during BUILD_PREPARATION_V1 (static preparation only — no build,
no container run, no database, no dependency install was executed to produce
this document).

```text
BUILD_CONTEXT_ROOT=PRODUCT
OCI_DOCKERFILE=oci/Dockerfile
OCI_CONTAINERFILE=oci/Containerfile
RUNTIME_SOURCE_ROOT=PRODUCT
LEGACY_RUNTIME_ROOT=runtime/noesar
LEGACY_RUNTIME_ROOT_SUPPORTED=false
```

## Rationale for RUNTIME_SOURCE_ROOT=PRODUCT

`runtime/noesar/` does not exist anywhere in this candidate and was never
carried into it (see `evidence` grep and prior consolidation pass notes in
`REPORTS/CODE_CONSOLIDATION_V1/11_OPEN_BLOCKERS.txt`). The actual runnable
Node service is `services/reference-control-plane/src/server.mjs`. This is
established with certainty (not guessed) by four independent, mutually
corroborating sources already present in the product before this pass:

1. `package.json` → `"scripts".start = "node services/reference-control-plane/src/server.mjs"`
2. `scripts/run-reference.sh` → `cd "$ROOT" && exec node services/reference-control-plane/src/server.mjs`
3. `services/reference-control-plane/src/server.mjs` itself resolves
   `repoRoot` as three directories above its own `src/` (i.e. the PRODUCT
   root) and reads its static web assets from `repoRoot/apps/webui-static`.
4. `deployment/windows/Start-Noesar.ps1` (already present, unedited apart
   from removing one dead line — see below) already `Set-Location`s into the
   copied `noesar` directory and runs the exact relative path
   `services\reference-control-plane\src\server.mjs` from inside it — proving
   the intended internal layout of the old `runtime/noesar/` payload was
   already `<payload-root>/services/reference-control-plane/...`, not a
   different implementation.

Consequently `oci/Dockerfile`, `oci/Containerfile`,
`deployment/linux/install-portable.sh`, `deployment/linux/noesar-evolution.service`,
`deployment/macos/install-portable.sh` and `deployment/windows/Install-Noesar.ps1`
were corrected in this pass to copy/launch:

```text
package.json
services/reference-control-plane/
apps/webui-static/
```

with the entry point always `services/reference-control-plane/src/server.mjs`.

## Files required in the build context

```text
package.json
services/reference-control-plane/src/**
services/reference-control-plane/test/**   (not copied into the image; present in context only)
apps/webui-static/**
oci/Dockerfile | oci/Containerfile
```

## Files excluded from the runtime image

Everything else in PRODUCT is build-context-adjacent documentation, tests,
tooling, evidence, and non-Node subsystems (Rust workspace, Python
capability/database tooling, docs, evidence, sbom) — none of it is `COPY`'d
into the image. In particular the `.dockerignore` equivalent should exclude
(not currently enforced by an explicit `.dockerignore` file — none exists in
this candidate; noted here, not fabricated):

```text
evidence/
docs/
tests/
tools/
rust/
database/
packages/
capabilities/
sbom/
.git (if present)
```

## Runtime directories

```text
RUNTIME_WORKDIR=/opt/noesar               (image, non-persistent code)
RUNTIME_WORKSPACE=/workspace              (volume, persistent state)
RUNTIME_WORKSPACE_STATE=/workspace/state/state.json
RUNTIME_WORKSPACE_AUDIT=/workspace/audit/events.jsonl
RUNTIME_WORKSPACE_SETUP_TOKEN=/workspace/config/first-owner-setup.token
```

## Secrets

No secret material is baked into `oci/Dockerfile` / `oci/Containerfile`. The
first-owner setup token is generated at runtime under `/workspace` (a
volume), not embedded in the image. `NOESAR_SETUP_TOKEN_FILE` is set as an
`ENV` default path, not a value.

## Socket / authority

The Rust authority daemon (Unix-domain socket, SO_PEERCRED) is **not**
included in this image build — its source exists under `rust/` but is
unbuilt (B001, no cargo/rustc on this host). The current image runs only the
Node reference-control-plane, which operates in `reference-node` /
`reference-json` fallback mode per its own `authority.mjs` / `data-plane.mjs`
guards. This is unchanged by this pass.

## Health / readiness

```text
HEALTH_ENDPOINT=GET /healthz   (implemented in server.mjs; returns 200 status:"healthy")
READINESS_ENDPOINT=NOT_IMPLEMENTED in services/reference-control-plane
```

The `HEALTHCHECK` in `oci/Dockerfile` / `oci/Containerfile` was corrected in
this pass to call `/healthz` directly via `node -e` (no external `curl`/`wget`
dependency, no new file), mirroring the existing
`deployment/windows/Test-Noesar.ps1` pattern (`Invoke-RestMethod
http://127.0.0.1:$Port/healthz`). Note: earlier `runtime/noesar`-era smoke
tests (`tests/runtime/runtime-v0{30,40,50}-smoke.mjs`,
`tests/runtime/secure-runtime-smoke.mjs`) assert on a `/readyz` endpoint,
a `runtime-preflight.json` state file, and a `0.5.0-runtime-implementation`
version string that `services/reference-control-plane` does **not**
implement. Those four tests describe a different, richer, historical runtime
contract that was never imported into this candidate; they remain BLOCKED
and were intentionally left untouched (see
`REPORTS/BUILD_PREPARATION_V1/03_PATH_DECISIONS.tsv`). Do not treat the
`/healthz`-only contract above as a superset of what those tests expect.

## External dependencies (build time)

```text
NODE_IMAGE=node:22-bookworm-slim   (pulled from a registry — not pulled by this pass)
NPM_DEPENDENCIES=none              (package.json declares no "dependencies")
```

## Toolchain needed for a real build (not run by this pass)

See `REPORTS/BUILD_PREPARATION_V1/10_TOOLCHAIN_BUILD_PLAN.md`.

## Blockers preventing a production-ready build

```text
B001  Rust authority daemon unbuilt (no cargo/rustc/Cargo.lock on this host)
B003  No OS-level sandbox enforcement (seccomp/landlock/App Sandbox) — and
      deployment/docker/run.sh references a security/seccomp-noesar.json
      seccomp profile that does not exist anywhere in this candidate
      (BLOCKED_PATH_DECISION — a security policy file, not fabricated)
B004  Only the Linux SO_PEERCRED authority transport exists; Windows
      named-pipe and macOS peer-credential transports are NOT_IMPLEMENTED.
      No container has been built or run (constraint: DOCKER_TOUCHED=false).
B005  No live PostgreSQL/pgvector server has ever run against the 12-migration
      schema (constraint: POSTGRES_STARTED=false, DATABASE_TOUCHED=false).
B006  Master V4 scope is partial by design (see MASTER_V4_TRACEABILITY.tsv).
```

`org.noesar.production-ready="false"` remains correct and unchanged in both
`oci/Dockerfile` and `oci/Containerfile`. This document does not claim the
image is production-ready; it documents what a build would need.
