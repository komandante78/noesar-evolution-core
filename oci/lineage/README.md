# Recovered build lineage — read this before trusting `oci/Dockerfile`

## What is wrong, measured 2026-08-02 (s308)

`oci/Dockerfile` is the canonical build file in this repository, and **it does not build this
product**. Rebuilding from it produces an image that boots a different system:

| | `oci/Dockerfile` says | the live image is |
|---|---|---|
| entrypoint | `node services/reference-control-plane/src/server.mjs` | `/opt/noesar/bin/noesar-supervisord` |
| data plane | `NOESAR_DATA_PLANE=reference-json` | `org.noesar.data-plane=postgresql` |
| PostgreSQL | not installed at all | 18.4-1.pgdg12+1, pgvector 0.8.5-1.pgdg12+1 |
| Rust binaries | absent | `noesar-supervisord`, `noesar-sandbox` |

This was first named in `D-0271` (s296) and left open as Thread 3. What follows is what s308
measured on top of it, which changes the shape of the problem.

## The recipe was not merely outdated — it was destroyed, and we know exactly when

The live image's own history contains **one `RUN`, 24 `COPY`, 48 `LABEL`** and, at the bottom,
a single **819 MB layer with an empty `CreatedBy`**. Everything that installs PostgreSQL,
pgvector, the Rust binaries and the supervisor is inside that layer with **no recorded
instruction**.

The cause is in the image's own labels: `org.noesar.flatten=single-layer-reset-of-phase4-update-signing-side`.
Its parent, `noesar-evolution:phase4-update-signing-side`, has **127 filesystem layers** — one
below overlay2's hard limit of 128. The flatten was not housekeeping; it was the only way to
keep building. The cost, never written down until now, is that **flattening severs source from
artefact**: `docker history` after it can no longer say how the base was made.

## Why this directory exists

Today the ability to rebuild NOESAR EVOLUTION from anything does **not** live in this
repository. It lives in ~82 `noesar-evolution:*` image tags on one host's local Docker daemon.
A `docker image prune` would delete the only surviving copy of how this product is built.

These files are that copy, taken out of the daemon and put under version control:

- `phase4-update-signing-side.instructions.tsv` — 337 instructions, **build order**, of the last
  ancestor that still carries its history (127 layers, 10 real `RUN` steps: the node base, the
  NOESAR apt step, the pgdg/PostgreSQL step, the binary `chmod`s).
- `phase4-court-triage.instructions.tsv` — 106 instructions of the image **currently running**,
  which is the flattened base plus 24 `COPY` overlays.

Format: `line<TAB>size<TAB>instruction`, oldest first. `RUN` is the literal command as the
daemon recorded it. This is a **recording, not a build file** — it is evidence, and it is what
a reconciled `oci/Dockerfile` must be written against and checked against.

## A second finding, about the image running right now

`noesar-evolution:phase4-court-triage` carries `org.noesar.phase=4-debug-evolution-api-targets`
and `org.noesar.feature=api-targets-registry-...`. Its labels describe the **previous** build,
and no Dockerfile in `oci/` is named for its tag: it was built by re-running
`Dockerfile.phase4-debug-evolution-api-targets` under a new `-t`. So the provenance recorded on
the artefact currently in production is wrong about what the artefact contains.

## What was done with this, and what is still open

`D-0294` folded these instructions and the 77 `oci/Dockerfile.phase4-*` overlays into one
`oci/Dockerfile`, and proved it by **booting it**: 295 files against the live image's 295 with
an empty `diff`, 294 of them identical by sha256, healthy in 10 s with all three ARCH-001 peers
and 19 migrations applied. These files stay as the evidence that build was written against.

Still open: the rebuilt image is **not deployed** — the running container is still the flattened
lineage. Layer depth is not urgent either way: the live image is at **26 of 128**, and the
single-lineage rebuild at **24**, so the wall that forced the flatten is far away.

Two things this rebuild found and did not fix, both real:

- the live image's `package.json` is **older than this repository's** — copied once at the first
  build and never again across 77 overlays, so it is missing three `npm` scripts;
- the production image ships `services/reference-control-plane/src/server.mjs.bak_pre_uid_separation_20260802T000554Z`,
  a stray backup of the server source, because it sits inside a copied directory.
