# Phase 3 — Execution Plan

Ordered, executable, with a stop criterion at every step.
**Not executed in Phase 2.** Requires explicit owner authorisation to begin.

Every step states what it does, how to verify it worked, and when to stop.
**If a step's verification fails, stop — do not proceed to the next step.**

---

## Pre-flight gates (must all hold before step 1)

| Gate | Check |
|---|---|
| Working tree clean | `git -C /mnt/cachec/NOESAR_EVOLUTION status --porcelain` empty |
| Manifest intact | `sha256sum -c MANIFEST.sha256` → 5610/5610 OK |
| Vendor intact | 113 crates, 5,094 files, 0 missing, 0 corrupt |
| Packaging filters | `node tools/test-packaging-filters.mjs` → PASS |
| Name free | `docker container inspect noesar-evolution` → not found |
| Port free | nothing bound on host `8100` |
| Disk | ≥5 G free in `/var/lib/docker`, ≥10 G on `/mnt/cachec` |
| Authorisation | owner has authorised **both** Phase 3 and the bounded build-time network |

---

## Step 1 — Backup

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
BK=/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/pre_phase3_install_$TS
mkdir -p "$BK"
git -C /mnt/cachec/NOESAR_EVOLUTION archive --format=tar HEAD | (mkdir -p "$BK/tracked_head" && tar -x -C "$BK/tracked_head")
git -C /mnt/cachec/NOESAR_EVOLUTION rev-parse HEAD > "$BK/HEAD.txt"
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' > "$BK/images_before.txt"
docker ps -a --format '{{.Names}} {{.Status}}' > "$BK/containers_before.txt"
(cd "$BK" && find . -type f ! -name SHA256SUMS.txt -exec sha256sum {} + | sort -k2 > SHA256SUMS.txt)
```

**Verify:** `sha256sum -c SHA256SUMS.txt` passes.
**Stop if:** the backup cannot be created or verified.

## Step 2 — Create the runtime root (first time only)

```bash
mkdir -p /mnt/cachec/NOESAR_EVOLUTION_RUNTIME/workspace
chown -R 10001:10001 /mnt/cachec/NOESAR_EVOLUTION_RUNTIME/workspace
chmod 0700 /mnt/cachec/NOESAR_EVOLUTION_RUNTIME/workspace
```

**Verify:** `stat -c '%U:%G %a' …/workspace` → `10001:10001 700` (may print numeric).
**Why explicit:** the container runs as non-root `10001`; an Unraid share defaults to
`99:100` and the container would start but fail to persist. The delivered installer
does `chmod` but never `chown`.
**Stop if:** ownership cannot be set.

## Step 3 — Obtain the base image (bounded network)

```bash
docker pull node:22-bookworm-slim
docker image inspect node:22-bookworm-slim --format '{{.Id}}'
```

**Why:** only `node:20` and `node:20-slim` are present locally; the Dockerfile requires
22 and `package.json` declares `engines.node >= 22`.
**Verify:** image present; record the digest in the ledger.
**Stop if:** the pull is not authorised — do **not** silently fall back to node:20.

## Step 4 — Build the image

```bash
cd /mnt/cachec/NOESAR_EVOLUTION
docker build --pull=false -f oci/Dockerfile -t noesar-evolution:v4-complete .
```

Needs network for `apt-get` (5 Debian packages). No `npm install` runs — the product
has zero third-party npm dependencies.

**Verify:** image exists; `docker run --rm --entrypoint node noesar-evolution:v4-complete --version` → v22.x.
**Stop if:** the build fails. Do not patch source to force a build without recording it
as a defect first.

## Step 5 — Create the dedicated network

```bash
docker network create noesar-evolution-net
```

**Verify:** `docker network inspect noesar-evolution-net` succeeds.
**Do not** use `noesar-local` — it belongs to the unrelated NOESAR V3 stack.
**Stop if:** creation fails.

## Step 6 — Start the container

```bash
docker run -d --name noesar-evolution \
  --restart unless-stopped \
  --network noesar-evolution-net \
  --publish 127.0.0.1:8100:8088 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /run:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 512 --memory 8g --cpus 4 \
  --env NOESAR_RELEASE_CHANNEL=complete \
  --env NOESAR_AUTHORITY_MODE=reference-node \
  --env NOESAR_DATA_PLANE=reference-json \
  --env NOESAR_ALLOWED_HOSTS=localhost,127.0.0.1,::1 \
  --env NOESAR_SECURE_COOKIES=false \
  --env TZ=Europe/Berlin \
  --mount type=bind,src=/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/workspace,dst=/workspace,rw \
  noesar-evolution:v4-complete
```

**Note the deliberate omission of `--security-opt seccomp=`** — Docker's builtin
profile (deny-by-default) is used instead of the shipped
`security/seccomp-noesar.json`, which is allow-by-default and therefore weaker than the
profile it would replace. This host has no AppArmor and no SELinux, so seccomp is the
only MAC layer.

**Verify:** container is `running`; `docker inspect` confirms read-only rootfs, dropped
capabilities, limits, and the loopback-only publish.
**Stop if:** it exits, restarts repeatedly, or binds beyond loopback.

## Step 7 — Health

```bash
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8100/healthz && break; sleep 1; done
docker inspect --format '{{.State.Health.Status}}' noesar-evolution
```

**Verify:** `/healthz` returns 200 with `status: healthy`; container health `healthy`.
**Stop if:** unhealthy after 60 s — capture `docker logs --tail 200` and stop.

## Step 8 — First-owner bootstrap

Read the setup token **from the workspace bind mount** (never `docker exec`, never
copied into the repo, a log, or a commit):

```bash
cat /mnt/cachec/NOESAR_EVOLUTION_RUNTIME/workspace/config/first-owner-setup.token
```

Complete setup via `/api/v1/auth/setup` → `/api/v1/auth/setup/confirm`, then enable TOTP.

**Verify:** owner can log in; a second setup attempt is rejected.
**Stop if:** the token is absent or setup can be replayed.
**Never** paste the token into any tracked file or command log.

## Step 9 — Post-install verification

```bash
bash INSTALLATION/verify-installation.sh   # layout fix from Phase 2 applies
```

Plus manual checks: WebUI at `http://127.0.0.1:8100/` renders; `/api/v1/auth/status`
responds; workspace files are owned by 10001; the container cannot write outside
`/workspace`.

**Verify:** all pass.
**Stop if:** any fails — go to `docs/ROLLBACK_AND_RECOVERY_PLAN.md`.

## Step 10 — Record

Update `PROJECT_STATE.json`, `docs/INSTALLATION_LEDGER.md` (image digest, base-image
digest, container ID, ports, paths, timestamps), `docs/SESSION_HANDOFF.md`, and commit.
**No secret, no token, no credential in any of it.**

---

## Implementation work also belonging to Phase 3

Beyond installing, Phase 3 is where these get built (all designed in Phase 2, none
blocking installation):

| Work | Design |
|---|---|
| `/livez`, `/readyz`, `/metrics`, `/diagnostics` | `LOGGING_DEBUG_WATCHDOG_DESIGN.md` §4 |
| Structured JSON logging + correlation ID + rotation/quota | same, §2 |
| Debug mode with TTL and audit | same, §3 |
| Watchdog levels 0–4 and safe mode | same, §4 |
| Timezone resolution chain + locale API/UI | `TIMEZONE_AND_LOCALIZATION_DESIGN.md` §8 |

The Update Manager is **not** Phase 3 — it is a subsystem of its own.

## Explicitly out of scope for Phase 3

PostgreSQL/pgvector · the Rust authority daemon and control-plane binaries · GPU
allocation · any external AI provider · any `noesar.com` connectivity · TLS/remote
publication · relicensing.

## Stop criteria (any one halts the phase)

1. A pre-flight gate fails.
2. The backup cannot be verified.
3. The base image is unavailable and the network step is unauthorised.
4. The build fails for a reason needing a source change (record as a defect first).
5. The container will not stay healthy.
6. Anything would have to bind beyond loopback, join `noesar-local`, or run as root.
7. Any existing container, network, or dataset on the host would have to be modified.
8. A secret would have to be written into a tracked file.
