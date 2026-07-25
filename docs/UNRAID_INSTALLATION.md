# Unraid Installation

How NOESAR Evolution is installed on this host, exactly as it was done in Phase 3.

## Host facts that shape the installation

Unraid 7.3.2, kernel 6.18.38 · Ryzen 5 5600X, 6c/12t, **AVX2 only** · 31 GiB RAM,
**no swap** · RTX 3060 12 GiB, idle and **not allocated to this product** ·
Docker 29.5.3, overlay2, cgroup v2 · **AppArmor and SELinux both absent**, so seccomp is
the only MAC layer · host timezone `Europe/Berlin`, **`/etc/timezone` absent** ·
no `python3`, no `cargo`, no `psql`, no `gh`, no `gitleaks` on the host.

## Parameters

```text
PROJECT_ROOT   = /mnt/cachec/NOESAR_EVOLUTION
RUNTIME_ROOT   = /mnt/cachec/NOESAR_EVOLUTION_RUNTIME
ARTIFACT_ROOT  = /mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS
IMAGE          = noesar-evolution:phase3
CONTAINER      = noesar-evolution
NETWORK        = noesar-evolution-net
BIND           = 127.0.0.1:8100  ->  container 8088
```

**Port 8100, not the product default 8088.** 8088 is already claimed twice on this host
(`fridayn-model-factory`, `nova-ai`). Found by enumerating `docker inspect` bindings — a
live port scan would have shown 8088 free, because every one of those containers is
stopped.

**A dedicated network, never `noesar-local`.** That network belongs to the unrelated
NOESAR V3 stack on this host.

## Steps

### 1. Runtime root

```bash
R=/mnt/cachec/NOESAR_EVOLUTION_RUNTIME
mkdir -p "$R"/{data,config,projects,logs,audit,updates,backups,diagnostics,tmp,state}
chown -R 10001:10001 "$R"
chmod 0700 "$R" "$R"/*
```

The `chown` is not optional. The container runs as non-root `10001`; an Unraid share
defaults to `99:100`, and without this the container starts and then cannot persist. The
delivered installer only `chmod`s.

### 2. Base image

```bash
docker pull node:22-bookworm-slim
```

Recorded digest: `sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`.
Only `node:20` and `node:20-slim` were present locally; the Dockerfile requires 22 and
`package.json` declares `engines.node >= 22`. This is the one bounded network step —
**do not silently fall back to node:20**.

### 3. Build

```bash
cd /mnt/cachec/NOESAR_EVOLUTION
docker build --pull=false -f oci/Dockerfile -t noesar-evolution:phase3 .
```

Needs network for five Debian packages (`unzip poppler-utils tesseract-ocr ffmpeg
ca-certificates`). No `npm install` runs — the product has **zero** third-party npm
dependencies. The **runtime** is fully offline.

### 4. Network

```bash
docker network create noesar-evolution-net
```

### 5. Run

```bash
docker run -d --name noesar-evolution \
  --restart=unless-stopped \
  --network noesar-evolution-net \
  --publish 127.0.0.1:8100:8088 \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m \
  --tmpfs /run:rw,nosuid,nodev,noexec,size=16m \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  --memory=8g --memory-swap=8g --cpus=4 --pids-limit=512 \
  --user=10001:10001 \
  --env NOESAR_RELEASE_CHANNEL=complete \
  --env NOESAR_AUTHORITY_MODE=reference-node \
  --env NOESAR_DATA_PLANE=reference-json \
  --env NOESAR_ALLOWED_HOSTS=localhost,127.0.0.1,::1 \
  --env NOESAR_SECURE_COOKIES=false \
  --env NOESAR_SETUP_TOKEN_FILE=/workspace/config/first-owner-setup.token \
  --env TZ=Europe/Berlin \
  --mount type=bind,src=/mnt/cachec/NOESAR_EVOLUTION_RUNTIME,dst=/workspace,readonly=false \
  noesar-evolution:phase3
```

Three details that matter, each of them a defect found and fixed in Phase 3:

- **No `--security-opt seccomp=`.** The shipped profile is allow-by-default and weaker
  than the Docker builtin it would replace. See `CONTAINER_SECURITY_PROFILE.md`.
- **`readonly=false`, not `rw`.** Docker 29 rejects a bare `rw` field in `--mount`
  (`invalid field 'rw' must be a key=value pair`). Every delivered installer used `rw` and
  would have failed on this host.
- **`--publish 127.0.0.1:8100`, with the address.** Publishing without a bind address
  means `0.0.0.0`, i.e. the whole LAN, with no TLS.

Expect `WARNING: Your kernel does not support swap limit capabilities`. That is accurate:
`--memory-swap` does not take effect here. The host has zero swap, so the intended
outcome holds anyway.

### 6. Bootstrap

See `OWNER_BOOTSTRAP.md`. Read the token from
`RUNTIME_ROOT/config/first-owner-setup.token`; never from `docker exec`, never into a
file, a log or a commit.

### 7. Verify

```bash
curl -s http://127.0.0.1:8100/livez
curl -s http://127.0.0.1:8100/readyz
curl -s http://127.0.0.1:8100/healthz
bash INSTALLATION/verify-installation.sh
```

## Using the shipped installers instead

`INSTALLATION/install-unraid.sh` and `deployment/unraid/install-complete.sh` now produce
an equivalent result. Both were repaired in Phase 3 and are covered by
`tools/test-installer-hardening.mjs`, which runs them against a stub `docker` and asserts
every hardening flag actually arrives. Relevant variables:

```text
NOESAR_BIND_ADDRESS   default 127.0.0.1
NOESAR_PORT           default 8088 — set 8100 on this host
NOESAR_NETWORK        set noesar-evolution-net; never noesar-local
NOESAR_WORKSPACE      set /mnt/cachec/NOESAR_EVOLUTION_RUNTIME
```

## Not installed

PostgreSQL/pgvector · the Rust authority daemon and control-plane binaries · GPU
allocation · any external AI provider · any `noesar.com` connectivity · TLS or remote
publication. Each is a separate decision with its own acceptance.

## Uninstalling

See `PHASE_3_ROLLBACK.md`. In short: remove only `noesar-evolution`, then
`noesar-evolution-net`, then the image; move `RUNTIME_ROOT` aside rather than deleting it.
