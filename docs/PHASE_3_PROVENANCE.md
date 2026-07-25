# Phase 3 — Provenance

Everything Phase 3 obtained, produced or installed, with the evidence that identifies it.

## Source

| | |
|---|---|
| Repository | `/mnt/cachec/NOESAR_EVOLUTION` |
| Commit at build time | `28c8883835ab3326187114298f6789bf2cbbecb5` (Phase 2 head) plus the Phase 3 changes, committed at the end of this phase |
| Repository manifest | `MANIFEST.sha256` — **5 630 / 5 630 OK** after the phase (5 611 before; 7 hashes updated, 19 entries added) |
| Vendored Rust | 113 crates, 5 094 files verified against `.cargo-checksum.json`, **0 corrupt, 0 missing** |

## Network access in this phase

Exactly one outbound operation, authorised by `DOCKER_IMAGE_PULL=AUTHORIZED_LIMITED`:

```text
docker pull node:22-bookworm-slim
```

plus the Debian package fetch performed by `apt-get` inside the image build
(`unzip poppler-utils tesseract-ocr ffmpeg ca-certificates`). Nothing else was
downloaded. The runtime makes no outbound call: external providers are default-deny and
the update manager contacts no portal.

## Base image

```text
BASE_IMAGE   node:22-bookworm-slim
REPO_DIGEST  sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
IMAGE_ID     sha256:bd16adabad7619222d4d0ab2d61f48391dacde03ad93f54d344683e326cbd0e2
CREATED      2026-07-14T01:48:37Z
PLATFORM     linux/amd64
SIZE         227329605 bytes
PULLED       2026-07-25T07:30:13Z
```

Node version inside the image: **v22.23.1**.

## Candidate image

```text
IMAGE      noesar-evolution:phase3
IMAGE_ID   sha256:24dfc4923536a1128bce86146db60cd0d7907a02a0e3f91a031371aea4a56844
USER       10001:10001
BUILT      2026-07-25T07:36 UTC
CONTEXT    the canonical repository root
```

Three builds were made in this phase; the first two were superseded by fixes found while
verifying the running container (the setup-token file, the timezone chain, the bind-scope
log field). Only the last one is installed.

- No build argument and no layer carries a secret.
- No `npm install` runs; there are no third-party npm dependencies to resolve.
- No unresolved `latest` tag anywhere; the base is pinned by name and recorded by digest.
- Layer scan under `/opt/noesar` for `*.pem`, `*.key`, `.env`, `*.secret` and PEM
  private-key headers: **nothing found**.
- SBOM: `sbom/` ships with the delivery, but no SBOM tool (syft, cyclonedx) exists on this
  host, so **no SBOM was generated for this image** — `[UNVERIFIED]` for this artefact
  specifically.

## Installed objects

| Object | Identity |
|---|---|
| Container | `noesar-evolution`, from `noesar-evolution:phase3` |
| Network | `noesar-evolution-net` (bridge, `f55f74343e47`) |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME`, `10001:10001`, `0700` |
| Published port | `127.0.0.1:8100 -> 8088` |

## Backup taken before any mutation

```text
/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/phase_3_20260725T065555Z
```

Contains a full `git archive` of HEAD, the pre-change Docker image / container / network /
volume / port inventories, a snapshot of `MANIFEST.sha256`, the base-image and
candidate-image provenance files, the bootstrap-probe audit evidence, and a
self-verifying `SHA256SUMS.txt` — **6 035 / 6 035 verified, exit code 0**.

A defect in the first version of that manifest was found and corrected: excluding
`SHA256SUMS.txt` by name also excluded the five `provenance/package-0N/SHA256SUMS.txt`
files, leaving them backed up but unchecksummed. The manifest now excludes only the
top-level file.

## Host state, before and after

| | Before | After |
|---|---|---|
| Containers defined | 37 | 38 (only `noesar-evolution` added) |
| Containers running | 0 | 1 (`noesar-evolution`) |
| Networks | 8 | 9 (only `noesar-evolution-net` added) |
| Volumes | — | identical list, no change |
| `noesar-local` | 0 containers | 0 containers, untouched |

A `docker ps -a` diff against the pre-install inventory shows only elapsed-time text
changes on unrelated containers plus the single new `noesar-evolution` row. Every other
container is still `Exited` on the same image.

`noesar-debuglab` was started and stopped inside this phase for the HUNT AND FIX step —
the single named exception in the operating authority — and is `Exited (0)` again.

A container named `noesar-evolution-bootstrap-probe` existed briefly on port 8101 to prove
the first-run and safe-mode behaviour without touching the real installation. It was
removed; its audit evidence is preserved in the backup directory.
