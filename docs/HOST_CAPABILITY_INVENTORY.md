# Host Capability Inventory

Read-only inventory of the target Unraid server, taken in Phase 2.
**Nothing on the host was modified, started, stopped, or reconfigured.**

Captured: 2026-07-25 (UTC). Host: `Koma78`.

---

## 1. Platform

| Item | Value |
|---|---|
| Unraid | **7.3.2** |
| Kernel | `6.18.38-Unraid`, `x86_64`, PREEMPT_DYNAMIC |
| Uptime at capture | 5h 39m, load 0.39 / 0.27 / 0.24 (idle) |

## 2. CPU

| Item | Value |
|---|---|
| Model | **AMD Ryzen 5 5600X**, 6 cores / 12 threads, 1 socket |
| Max clock | 4654 MHz · L3 32 MiB · AMD-V virtualisation |
| Instruction set | `sse4_2`, `avx`, **`avx2`**, `aes`, `sha_ni` — **no AVX-512** |

**Relevance:** AVX2 (not AVX-512) is the ceiling for any local inference build. `aes`
and `sha_ni` mean crypto and hashing are hardware-accelerated.

## 3. Memory

| Item | Value |
|---|---|
| Total | 31 GiB |
| Available at capture | **24 GiB** |
| Swap | **0 B — none configured** |

**Relevance:** with no swap, an OOM condition is an immediate kill, not a slowdown. The
container memory cap must therefore be set deliberately (see
`docs/RESOURCE_AND_PORT_PLAN.tsv`), not left unbounded.

## 4. Storage

| Mount | FS | Size | Free | Role |
|---|---|---|---|---|
| `/mnt/cachec` | XFS on NVMe | 466 G | **324 G** | `PROJECT_ROOT`, artifacts, proposed runtime root |
| `/mnt/cache` | XFS on NVMe | 477 G | 146 G | Unraid cache, `appdata` |
| `/mnt/user` | fuse.shfs | 11 T | 4.3 T | merged user share |
| `/mnt/disk1..3` | XFS | 3.7 T each | 1.3–1.5 T | array |
| `/var/lib/docker` | XFS on loop | 250 G | **144 G** | image/layer store |
| `/` (rootfs) | tmpfs-backed | 16 G | 14 G | **RAM-backed — never write project data here** |

**Relevance:** the image build and layers land in `/var/lib/docker` (144 G free —
ample for a ~200 MB Node image). Writing to `/` consumes RAM, a known way to break
this host; the design keeps everything on `/mnt/cachec` and `appdata`.

## 5. GPU and accelerators

| Item | Value |
|---|---|
| GPU | **NVIDIA GeForce RTX 3060**, 12 GiB VRAM |
| Driver | 580.173.02 · compute capability **8.6** |
| In use at capture | **0 MiB** — fully free |
| Docker runtimes | `runc` (default), **`nvidia`** |
| CDI | `/etc/cdi/nvidia.yaml` present |
| Integrated graphics | `/dev/dri/card0`, `renderD128` present |
| AMD / Intel / NPU accelerators | none detected |

**Relevance:** GPU passthrough is available two ways (`--runtime=nvidia` or CDI).
NOESAR EVOLUTION's delivered container is Node-only and does **not** require the GPU;
GPU is relevant only if a local inference provider is added later. The GPU is
currently idle but is historically shared with other projects on this host — Phase 3
must not claim it by default.

## 6. Docker

| Item | Value |
|---|---|
| Engine | **29.5.3** |
| Storage driver | `overlay2` |
| cgroups | **v2**, driver `cgroupfs`; controllers `cpuset cpu io memory hugetlb pids` |
| Default runtime | `runc`; also `nvidia`, `io.containerd.runc.v2` |
| Security options | `seccomp` (builtin profile), `cgroupns` |
| Root dir | `/var/lib/docker` |
| Containers | **37 total, 0 running** |
| Images | 99 |

### Networks

| Network | Driver | Note |
|---|---|---|
| `bridge`, `host`, `none` | builtin | — |
| `br0` | macvlan | host LAN bridge |
| `noesar-local` | bridge | **in use by the unrelated NOESAR V3 stack** |
| `coden-bridge`, `coden-local` | bridge | unrelated CodeN stack |
| `deploy_default` | bridge | unrelated |

**Relevance:** the delivered installers default to `NOESAR_NETWORK=noesar-local`, which
already belongs to a different product on this host. The design overrides this — see
`docs/INSTALLATION_DESIGN.md` §4.

## 7. Kernel security features

| Feature | State |
|---|---|
| seccomp | **available** (Docker builtin profile active by default) |
| AppArmor | **ABSENT** (`/sys/kernel/security/apparmor` not present) |
| SELinux | **ABSENT** |
| User namespaces | available (`max_user_namespaces = 127784`) |
| cgroup v2 | active, with `memory` + `pids` controllers for limits |

**Relevance:** seccomp is the **only** mandatory-access-control layer on this host.
That raises the importance of the seccomp profile actually being restrictive — see the
finding in `docs/PHASE_2_HOST_PREFLIGHT_REPORT.md` §5.

## 8. Identity and permissions

| Item | Value |
|---|---|
| Executing user | `uid=0(root)` |
| Unraid share owner convention | `nobody:users` = **99:100** |
| `/mnt/cachec` | `nobody:users (99:100)`, mode 777 |
| `PROJECT_ROOT` | `root:root (0:0)`, mode 777 |
| Container user (from Dockerfile) | **`10001:10001`** (`noesar`), non-root |

**Relevance:** the container runs as 10001 but the bind-mounted workspace lives on an
Unraid share owned by 99:100. Ownership of the workspace directory must be set
explicitly at install time or the non-root container cannot write to it. This is
called out as a Phase-3 step, not left to chance.

## 9. Host ports already allocated

Derived from **container configuration**, not from live listeners — all containers are
currently stopped, so `ss` shows none of them. They would conflict on restart.

| Port | Owner |
|---|---|
| 80, 443 | nginx (Unraid WebUI) |
| 139, 445 | smbd |
| 2223 | sshd |
| 53 | dnsmasq (libvirt bridges) |
| 5700, 5900 | qemu VM |
| 16509 | libvirtd |
| 6333 | noesar-qdrant |
| 8080 | noesar-core |
| 8081 | Krusader |
| 8082 | noesar-webui |
| **8088** | **fridayn-model-factory AND nova-ai** (pre-existing double allocation) |
| 8091–8094 | noesar-gateway, TEI embedder/reranker, NLLB |
| 8096 | coden-benchmark-lab |
| 8099 | noesar-debuglab |
| 8210 | coden-ultra-full-product (+2 rollback containers) |
| 8240, 8250, 8260, 8270, 8300, 8420 | trainer, brainlab, stats-hub, ai-lab, nous-simulator, schema-service |

**Relevance:** the product's default port **8088 is already taken twice**. The design
assigns a free port instead — see §5 of the preflight report.

## 10. Time, locale, NTP

| Item | Value |
|---|---|
| Host timezone | **`Europe/Berlin`** (`/etc/localtime` → `/usr/share/zoneinfo/Europe/Berlin`) |
| Local time at capture | `Sat 25 Jul 2026 08:05 CEST` (UTC+2, DST active) |
| UTC at capture | `06:05 UTC` |
| `/etc/timezone` | **absent** (Unraid uses the symlink only) |
| `TZ` environment variable | **unset** |
| NTP | **running** — `ntpd -g -u ntp:ntp` (pid 2193) |
| Locale | `LANG=en_US.UTF-8` |

**Relevance:** the host has a valid IANA zone and working NTP, so it is a trustworthy
tier-3 source for the timezone chain. `/etc/timezone` being absent means a design that
reads that file would silently fall through — the chain must read the symlink.

## 11. Tooling present / absent

| Available | Absent |
|---|---|
| `docker`, `git` 2.55.0, `node`, `npm`, `jq`, `curl`, `wget`, `openssl`, `sha256sum`, `unzip`, `zip`, `tar`, `sqlite3` | **`python3`**, **`cargo`/`rustc`**, `psql`, **`gh`**, **`gitleaks`** |

**Relevance and consequences:**
- **`python3` absent** — several of the product's own `npm run verify:*` targets invoke
  `python3` and cannot run on the host. They run inside a container instead.
- **`cargo`/`rustc` absent** — Rust work requires the pinned `rust:1-bookworm` image,
  which is present locally and whose digest matches the delivery's recorded provenance.
- **`gh` absent** — blocker B-001, no GitHub remote.
- **`gitleaks` absent** — blocker B-002, secret scanning stays heuristic.

## 12. Backup and rollback capability

| Capability | State |
|---|---|
| Free space for a full pre-install backup | 324 G on `/mnt/cachec` — ample |
| Existing artifact/backup area | `/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/` in use |
| Git rollback | available — local repository, clean tree |
| Container rollback pattern | proven on this host (rename-and-keep, used repeatedly by other projects) |
| Image rollback | image tags retained; 99 images present, disk allows keeping N-1 |

Backups are viable and rollback is designed in `docs/ROLLBACK_AND_RECOVERY_PLAN.md`.
