# Installation Design

The exact shape of the NOESAR EVOLUTION installation on this Unraid host.
**Design only — nothing here was executed in Phase 2.** Execution is Phase 3, and only
on explicit owner authorisation.

---

## 1. Shape of the thing being installed

One container, one process. The delivered image is **Node-only**:

- base `node:22-bookworm-slim`, plus `unzip poppler-utils tesseract-ocr ffmpeg ca-certificates`;
- entrypoint `node services/reference-control-plane/src/server.mjs` — a single process,
  **no internal supervisor** (no s6, supervisord, tini);
- **zero third-party npm dependencies** — every import is a `node:` builtin or relative,
  so no `npm install` runs at build time;
- runs as **`10001:10001`**, non-root, with `/workspace` as the only writable volume.

The Rust workspace (12 first-party crates → `noesar-authority-daemon`,
`noesar-control-plane`) is **not part of this image**. It builds and passes offline
(verified in the B-003 repair) but is a separate deployable. Phase 3 installs the Node
container only; the Rust authority daemon is deliberately out of scope until Phase 4
has an acceptance for it.

## 2. Paths

| Purpose | Path | Notes |
|---|---|---|
| Source of truth | `/mnt/cachec/NOESAR_EVOLUTION` | the canonical git repo; **never** the runtime |
| Build context | same as above | `oci/Dockerfile` at `RUNTIME_ROOT` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` | **to be created in Phase 3**, not before |
| Container workspace (bind) | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/workspace` → `/workspace` | persistent state |
| Backups | `/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/` | already in use |
| Prebuilt binaries | `/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/prebuilt/linux-x86_64/` | not installed by default |

**Deliberate deviation from the delivered default.** The installers default to
`NOESAR_WORKSPACE=/mnt/user/appdata/noesar-evolution`. The design puts the runtime on
`/mnt/cachec` instead:

- `/mnt/user` is a FUSE (`shfs`) overlay — extra indirection and weaker fsync semantics
  for a database-like workload;
- `/mnt/cachec` is direct XFS-on-NVMe with 324 G free, and already hosts the project;
- it keeps source, artifacts and runtime on one device, so backup and rollback are one
  consistent operation.

`/mnt/user/appdata/noesar-evolution` does not currently exist, so either choice is free
of collisions. The override is set explicitly via `NOESAR_WORKSPACE`.

## 3. Ports

| Role | Host port | Container port |
|---|---|---|
| WebUI + API (HTTP) | **8100** | 8088 |

**The product's default host port 8088 cannot be used.** It is already claimed on this
host by two containers (`fridayn-model-factory` and `nova-ai` — themselves a
pre-existing double allocation). `8100` is free, sits just outside the existing
NOESAR 8080–8099 band, and does not collide with any of the 23 container-reserved
ports inventoried. The container-internal port stays 8088; only the host mapping moves.

Binding: **`127.0.0.1:8100:8088`** — loopback only. Remote access, if ever wanted, goes
through the existing Unraid nginx as a TLS reverse proxy, never by exposing the
container port to the LAN. This satisfies "rete privata per default".

## 4. Network

A **dedicated bridge network: `noesar-evolution-net`**, created in Phase 3.

The installers default to `NOESAR_NETWORK=noesar-local`. That network already belongs
to the unrelated NOESAR V3 stack on this host, where container-to-network binding is
known to be load-bearing (moving `noesar-webui` off it breaks its login with a 502).
Joining it would put an unrelated product on a shared L2 segment for no benefit and
create a dependency between two products that must stay independent. A dedicated
network also gives egress control a meaningful boundary.

## 5. Identity and permissions

| Item | Value |
|---|---|
| Container user | `10001:10001` (from the image, non-root) |
| Workspace owner on host | must be `chown 10001:10001` at install time |
| Workspace mode | `0700` |

This is an explicit Phase-3 step. The Unraid share convention is `99:100`
(`nobody:users`); the container runs as 10001 and **will fail to write** to a workspace
left at the default ownership. The delivered installer does `chmod 0700` but never
`chown`, so on this host it would produce a container that starts and then cannot
persist — recorded as a Phase-3 action, not a source defect.

## 6. Runtime hardening (kept from the delivered installer)

The delivered `docker run` invocation is already well hardened and the design keeps it:

```text
--read-only
--tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m
--tmpfs /run:rw,noexec,nosuid,nodev,size=16m
--cap-drop ALL
--security-opt no-new-privileges:true
--security-opt seccomp=<profile>
--pids-limit 512
--memory 8g            (host has 31 GiB total, 24 GiB free, NO SWAP)
--cpus 4               (host has 12 threads)
--restart unless-stopped
```

**One change: the seccomp profile.** The shipped `security/seccomp-noesar.json` is
`defaultAction: SCMP_ACT_ALLOW` with a 24-syscall denylist. Passing it to
`--security-opt seccomp=` **replaces** Docker's builtin profile, which is
deny-by-default with a ~350-syscall allowlist. The custom profile therefore permits
every syscall it does not name — a strictly weaker posture than the default it
displaces, on a host with no AppArmor and no SELinux.

Phase 3 default: **use Docker's builtin seccomp profile** (omit `--security-opt
seccomp=`), which already blocks every syscall in the custom denylist and more.
Revisit only if a builtin-blocked syscall turns out to be required, in which case the
correct fix is a deny-by-default profile derived from Docker's, not an allow-by-default
one. Full reasoning in `docs/SECURITY_IMPLEMENTATION_MATRIX.tsv` (`seccomp` row).

## 7. Environment

Non-secret, set explicitly:

```text
NOESAR_RELEASE_CHANNEL=complete
NOESAR_AUTHORITY_MODE=reference-node
NOESAR_DATA_PLANE=reference-json
NOESAR_HOST=0.0.0.0            # inside the container only; host binding is loopback
NOESAR_PORT=8088
NOESAR_ALLOWED_HOSTS=localhost,127.0.0.1,::1
NOESAR_SECURE_COOKIES=false    # true once behind TLS; see below
NOESAR_WORKSPACE=/workspace
TZ=Europe/Berlin               # matches host; display only, storage stays UTC
```

`NOESAR_SECURE_COOKIES=false` is correct **only** for loopback HTTP. The moment the
service is published through the nginx TLS proxy it must become `true`, or session
cookies travel without the `Secure` attribute. Recorded as a gate in the Phase-3 plan.

### Secrets

No secret is baked into the image, the compose file, or any tracked file. The only
sensitive value at install time is the **first-owner setup token**, which the product
generates itself into `/workspace/config/first-owner-setup.token`
(`NOESAR_SETUP_TOKEN_FILE`). Phase 3 reads it once, from inside the workspace, with
`docker exec`-free access via the host bind mount, and never copies it into the repo,
a log, or a commit message. Any future provider API keys go into the product's own
credential vault (`ai-workspace/credential-vault.mjs`), not into environment variables.

## 8. Data plane and database

`NOESAR_DATA_PLANE=reference-json` — the delivered default is a **file-backed JSON data
plane** inside `/workspace`. No PostgreSQL, no pgvector, and no external database is
required to install or start.

The repository does ship a full PostgreSQL schema (`database/postgres/0001…0007`,
including `CREATE EXTENSION` for pgvector and row-level security) plus baselines for
v0.4.0/v0.5.0 and a documented acceptance plan
(`DOCUMENTATION/B005_POSTGRES_PGVECTOR_ACCEPTANCE_PLAN.md`). That is a **later,
separate installation** with its own container, credentials and acceptance. Phase 3
installs the JSON data plane only, which keeps `DATABASE_MUTATION=false` true by
construction and gives the first install no external dependency at all.

## 9. Offline posture

| Aspect | State |
|---|---|
| npm dependencies | none — nothing to fetch |
| Rust vendor tree | complete and verified offline (B-003 repair) |
| Base image `node:22-bookworm-slim` | **not present locally** — only `node:20` and `node:20-slim` |
| `apt-get install` in the Dockerfile | requires network **at build time** |

So the build is **not** fully offline today: it needs the base image and five Debian
packages. Both installers already guard the base image (`docker image inspect … || exit`
with `--pull=false` on the build), which is the right behaviour — they fail loudly
rather than silently pulling.

Phase 3 therefore has an explicit, owner-authorised, **bounded network step**: pull
`node:22-bookworm-slim` and allow apt during `docker build`. Runtime remains fully
offline — the container needs no network to start or serve, and external AI providers
are default-deny. This is stated as a gate, not assumed.

## 10. Health and lifecycle

| Concern | Current state |
|---|---|
| Container `HEALTHCHECK` | present, polls `/healthz` every 30 s |
| `/healthz` | **implemented** (`server.mjs:147`) |
| `/livez`, `/readyz`, `/metrics`, `/diagnostics` | **not implemented** |
| Restart policy | `unless-stopped` |
| Internal supervisor | none — single process; Docker is the supervisor |

The four missing endpoints are required by this phase's own specification and are
designed in `docs/LOGGING_DEBUG_WATCHDOG_DESIGN.md`. They are **not** installation
blockers: `/healthz` alone is enough for the container healthcheck and for Phase-3
verification. They are Phase-3 implementation work with Phase-4 acceptance.

## 11. Install / update / uninstall / rollback

| Operation | Asset | State |
|---|---|---|
| Install | `deployment/unraid/install-complete.sh` | works with the canonical layout |
| Install (alt) | `INSTALLATION/install-unraid.sh` | **fixed in Phase 2** — see below |
| Verify | `INSTALLATION/verify-installation.sh` | present |
| Uninstall | `INSTALLATION/uninstall-unraid.sh`, `deployment/linux/uninstall-portable.sh` | present |
| Unraid template | `deployment/unraid/noesar-evolution.xml` | present |
| Update | — | **no update manager exists**; designed in `docs/UPDATE_MANAGER_DESIGN.md` |
| Rollback | — | designed in `docs/ROLLBACK_AND_RECOVERY_PLAN.md` |

`INSTALLATION/install-unraid.sh` hardcoded `RUNTIME_ROOT="$PACKAGE_ROOT/RUNTIME_SOURCE"`
— the package-02 layout. In the canonical repository that directory does not exist, so
the script aborted at its own `test -f "$RUNTIME_ROOT/oci/Dockerfile"` guard before
doing anything. It now detects the layout. This was a certain installation blocker,
fixable statically, so it was fixed under §2 of the phase specification.

## 12. What is deliberately NOT installed in Phase 3

- PostgreSQL / pgvector (separate installation, own acceptance);
- the Rust authority daemon and control-plane binaries;
- any GPU allocation — the container does not need it and the GPU is shared host-wide;
- any external AI provider (all default-deny until the owner enables one);
- `noesar.com` connectivity of any kind.
