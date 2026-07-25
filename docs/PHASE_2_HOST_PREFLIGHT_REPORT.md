# Phase 2 — Host Preflight and Installation Design: Report

**Phase:** `NOESAR_INSTALLATION_PHASE_2_HOST_PREFLIGHT_AND_DESIGN` (2 of 6)
**Result:** `COMPLETED` — **`NEXT_PHASE=3_READY`**
**Nothing was installed, built, started, or reconfigured.** One source defect was found
and fixed statically.

---

## 1. Entry state

`current_phase=1 COMPLETED`, `B001=CLOSED`, `B-003=CLOSED`, `next_phase=2`, working tree
clean at `ccca61b`. All preconditions satisfied.

## 2. Host inventory (read-only)

Full detail in `docs/HOST_CAPABILITY_INVENTORY.md`. Headlines:

| | |
|---|---|
| Unraid **7.3.2**, kernel `6.18.38`, x86_64 | AMD Ryzen 5 5600X, 6c/12t, **AVX2, no AVX-512**, AES + SHA-NI |
| RAM 31 GiB, **24 GiB free, NO SWAP** | GPU RTX 3060 12 GiB, driver 580.173.02, **idle**, `nvidia` runtime + CDI present |
| `/mnt/cachec` 324 G free (XFS/NVMe) | `/var/lib/docker` 144 G free |
| Docker **29.5.3**, overlay2, **cgroup v2** | **37 containers, 0 running**; 99 images |
| seccomp available | **AppArmor ABSENT, SELinux ABSENT** |
| Host TZ `Europe/Berlin`, ntpd running | locale `en_US.UTF-8` |
| Present: docker, git, node, jq, curl, openssl, sqlite3 | **Absent: python3, cargo/rustc, psql, gh, gitleaks** |

Three host facts materially shaped the design:

1. **No swap** — an overrun is an instant OOM kill, so the memory cap is explicit.
2. **No AppArmor and no SELinux** — seccomp is the *only* MAC layer, which makes the
   shipped seccomp profile a real issue (§5).
3. **All containers are stopped**, so live port scans show nothing. Reserved ports were
   derived from **container configuration** instead — 23 host ports are spoken for.

## 3. Product installability

Area-by-area, with evidence:

| Area | Status | Evidence |
|---|---|---|
| Build context complete | **IMPLEMENTED** | `oci/Dockerfile` COPYs `package.json`, `services/reference-control-plane/`, `apps/webui-static/` — all present |
| No old-workspace dependencies | **IMPLEMENTED** | absolute host paths appear only in 4 EVIDENCE reports and 2 governance docs; **zero in code or config** |
| Single external container | **IMPLEMENTED** | one image, one entrypoint |
| Internal process supervisor | **NOT PRESENT** (by design) | single-process entrypoint; Docker `--restart unless-stopped` is the supervisor |
| WebUI | **IMPLEMENTED** | `apps/webui-static/` (html/js/css/i18n) |
| API | **IMPLEMENTED** | 39 distinct `/api/v1/*` routes in `server.mjs` |
| Authority daemon | **IMPLEMENTED (separate)** | Rust crates build offline; **not in the Node image** |
| Persistent storage | **IMPLEMENTED** | `/workspace` volume |
| Database + pgvector | **PARTIAL** | full schema `0001–0007` incl. `CREATE EXTENSION` and RLS, but the default data plane is `reference-json`; Postgres is a separate install |
| Vector store | **PARTIAL** | present via the workspace/context graph; not independently benchmarked |
| Sandbox | **IMPLEMENTED** | `capabilities/reference/noesar_capabilities/sandbox.py` + attestation + tests; container runs non-root 10001 |
| Health / readiness | **PARTIAL** | `/healthz` only; `/livez`, `/readyz`, `/metrics`, `/diagnostics` **MISSING** |
| Hardware detection | **IMPLEMENTED** | `src/hardware.mjs`, `/api/v1/hardware`, `/api/v1/runtime/recommendation` |
| Local + external providers | **IMPLEMENTED, default-deny** | `ai-workspace/provider-gateway.mjs` |
| Required files/dirs | **IMPLEMENTED** | verified against both installers |
| Install / uninstall / verify | **IMPLEMENTED** (after fix) | `deployment/unraid/install-complete.sh` was already layout-correct; `INSTALLATION/install-unraid.sh` was not — fixed, §6 |
| Update / rollback | **MISSING** | no update manager; designed in `docs/UPDATE_MANAGER_DESIGN.md` |
| Fully offline operation | **PARTIAL** | **runtime** is fully offline; **build** needs the base image + apt |

### Two dependency facts worth stating

- **Zero third-party npm dependencies** — every import is a `node:` builtin or relative,
  so no `npm install` runs and no registry is contacted at build time.
- **`node:22-bookworm-slim` is not present locally** (only `node:20`, `node:20-slim`),
  and the Dockerfile `apt-get install`s five packages. So the build needs a bounded,
  authorised network step. Both installers already fail loudly rather than auto-pulling,
  which is the correct behaviour.

## 4. Ports, storage, network

| Decision | Value | Reason |
|---|---|---|
| Host port | **8100** | the product default **8088 is already taken twice** (`fridayn-model-factory`, `nova-ai`) |
| Binding | **`127.0.0.1` only** | private by default; TLS later via the existing nginx |
| Network | **new `noesar-evolution-net`** | the installer default `noesar-local` belongs to the unrelated NOESAR V3 stack |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` | direct XFS/NVMe rather than the `/mnt/user` FUSE overlay; **not created in this phase** |
| Workspace owner | **`chown 10001:10001`** | container is non-root 10001; Unraid shares default to 99:100 and the container would start but be unable to persist |
| Limits | 8 G memory, 4 CPUs, 512 pids | no swap on this host |

Full table: `docs/RESOURCE_AND_PORT_PLAN.tsv` (28 rows).

## 5. Security

Full matrix: `docs/SECURITY_IMPLEMENTATION_MATRIX.tsv` — 41 requirements, each with
STATUS / SOURCE_PATH / TEST_PATH / RISK / PHASE_3_ACTION / PHASE_4_ACCEPTANCE.

```text
IMPLEMENTED 20 · PARTIAL 9 · UNVERIFIED 5 · MISSING 4 · NOT_APPLICABLE 1
IMPLEMENTED_BY_DESIGN 1 · BROKEN 1
```

Stronger than expected: real login lockout (`auth.mjs` — `loginAttempts`,
`failedLoginCount`, `lockedUntil`, per IP+username, 15-minute window), TOTP MFA,
credential vault, redaction wired into the provider gateway, egress control, RLS in the
Postgres schema, and a genuinely hardened `docker run` (read-only rootfs, `cap-drop
ALL`, `no-new-privileges`, hardened tmpfs, pids/memory/cpu caps).

### The one BROKEN item — the shipped seccomp profile is weaker than the default

`security/seccomp-noesar.json` is `defaultAction: SCMP_ACT_ALLOW` with a 24-syscall
denylist. Passing it via `--security-opt seccomp=` **replaces** Docker's builtin
profile, which is deny-by-default with a ~350-syscall allowlist and already blocks all
24 of those syscalls **and more**. Using it therefore *weakens* the container — on a
host with **no AppArmor and no SELinux**, where seccomp is the only MAC layer.

**Decision:** Phase 3 omits `--security-opt seccomp=` and uses the builtin profile. The
file is left in place, unmodified, with the reasoning recorded — this is a
configuration choice, not a source edit, and it is reversible.

### Highest residual risks

`HIGH` — prompt injection direct and indirect (`PARTIAL`), user/project isolation
(implemented but unproven at runtime), update package signing (`MISSING`), and the
seccomp item above. All carry a Phase-4 acceptance test.

## 6. Defect found and fixed

**`INSTALLATION/install-unraid.sh` could not install from the canonical repository.**
It hardcoded `RUNTIME_ROOT="$PACKAGE_ROOT/RUNTIME_SOURCE"` — the delivered package-02
layout. In the canonical repo that directory does not exist, so the script aborted at
its own `test -f "$RUNTIME_ROOT/oci/Dockerfile"` guard before doing anything.

Certain to block installation, fixable without starting a container, so it was fixed
under §2 of the phase specification:

- backup: `.../backups/pre_phase2_fix_20260725T060825Z/` (checksummed);
- minimal change: detect the layout — use `RUNTIME_SOURCE/` when present, otherwise
  `PACKAGE_ROOT`. Both layouts now work;
- static tests: `bash -n` clean on **all 10** installer scripts; dry evaluation
  resolves `RUNTIME_ROOT` correctly and both `test -f` guards pass.

`deployment/unraid/install-complete.sh` already used `RUNTIME_ROOT="$PACKAGE_ROOT"` and
was never affected — it was verified, not changed.

**Not fixed (correctly):** the missing health endpoints, the absent update manager, and
the seccomp profile. None of them *certainly blocks installation*, and the phase
forbids fixing hypothetical problems.

## 7. Timezone, locale

The product has **no timezone handling at all** — zero matches for `timezone`, `IANA`,
`Intl.` or `tz` across `services/`, `ai-workspace/` and `apps/`. i18n exists with
`en`/`it`.

Designed in `docs/TIMEZONE_AND_LOCALIZATION_DESIGN.md`: the 5-tier chain
(manual → browser IANA → host OS → installer `TZ` → UTC+warning), UTC-only storage with
local rendering, DST via the IANA database, browser-vs-server mismatch notice, ledger
entries on change, and **no IP/GPS geolocation**. One host-specific trap recorded:
`/etc/timezone` is **absent** on Unraid, so the implementation must read the
`/etc/localtime` symlink target or it will fall through to a lower tier.

## 8. Update Manager

Does not exist — `updates/` holds only a README and `verify-offline-update.py`.
Designed in `docs/UPDATE_MANAGER_DESIGN.md`: notify-only default, owner approval
mandatory, five channels with **separate signing keys**, current/previous/staging slots,
signed and freshness-checked metadata, Ed25519 package signatures, anti-rollback,
verified backup before migration, health-gated promotion, automatic rollback, a
fully-offline path using the same verification code, and a strictly minimal
`installation_id / version / channel / os-arch` data set — **never** conversations,
documents, memory, prompts or credentials.

## 9. Logging, debug, watchdog

Designed in `docs/LOGGING_DEBUG_WATCHDOG_DESIGN.md`. Redaction and audit already exist;
structured logging, debug mode and the watchdog are greenfield.

Operationally the most important design point: `/livez` and `/readyz` must be split.
Today both roles collapse onto `/healthz`, so a transient dependency failure can restart
a perfectly alive process. Level 4 recovery (deliberate non-zero exit, Docker restarts)
is the correct mechanism precisely because there is no internal supervisor, and crash-loop
detection must stop escalating into **safe mode** rather than restarting forever.

## 10. Licences and ATOM

**Nothing relicensed.** The four gaps stay open verbatim (12 Rust crates, 2 Node
packages, root LICENSE, 86 SPDX headers) — all owner decisions.

Re-verified: `FOSS_CORE_DEPENDS_ON_ATOM=false` and
`PRIVATE_ATOM_IMPLEMENTATION_PRESENT=false`. Only the public contract and boundary docs
exist. It remains `[UNVERIFIED]` in the strict sense until the Phase-4 ATOM-absent
acceptance (§J) executes it. Plan and portal contract in
`docs/LICENSING_AND_PORTAL_INTERFACE.md`. **No VPS was contacted.**

## 11. Verification performed in this phase

| Check | Result |
|---|---|
| `bash -n` on all 10 installer scripts | **10/10 clean** |
| Installer layout fix, dry evaluation | resolves correctly; both `test -f` guards pass |
| `MANIFEST.sha256` | **5610/5610 OK** |
| Vendor integrity | 113 crates, **5,094 files, 0 missing, 0 corrupt** |
| Packaging filter regression | gitignore **12/12**; python predicate **7/7** in-container |
| Heuristic secret scan on staged set | **0 findings**, detector self-tested |
| Host mutations | **none** — no container started/stopped, no network or dataset changed |

## 12. Conclusion

No blocker prevents build and installation. Paths, ports, network, storage, identity
and limits are defined; backup and rollback are designed; the one certain blocker was
found and fixed; the remaining dependency (the `node:22` base image) is available
through an authorised bounded network step already written into the plan.

```text
NEXT_PHASE=3_READY
```

Phase 3 was **not** started.
