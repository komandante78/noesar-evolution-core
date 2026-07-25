# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. This file is the human-readable resume point.**
A cold session should be able to continue from this file alone, together with
`PROJECT_STATE.json`.

---

## Current position

| Field | Value |
|---|---|
| Phase just completed | **3 — Implementation and Unraid installation** |
| Phase status | `COMPLETED` |
| **Next phase** | **4 — Acceptance** (`docs/PHASE_4_ACCEPTANCE_PLAN.md`) |
| `NEXT_PHASE` | `4_READY` |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Updated (UTC) | 2026-07-25 |

**The product is installed and running.** Container `noesar-evolution`, image
`noesar-evolution:phase3`, on `127.0.0.1:8100`, healthy, un-bootstrapped.

---

## What Phase 3 did

1. **Implemented** everything Phase 2 designed plus the Update Manager core: structured
   logging, timezone and locale, `/livez` `/readyz` `/healthz` `/diagnostics` `/metrics`,
   owner-only debug mode with a TTL, watchdog levels 0–5 with safe mode, a signed local
   update manager, a file-backed bootstrap token, and structural prompt-injection
   containment.
2. **Repaired nine defects**, six of them in the delivered product (see below).
3. **Built one image** from the canonical repository after an authorised base-image pull.
4. **Installed it** in isolation: dedicated network, loopback-only port, non-root,
   read-only rootfs, all capabilities dropped, Docker's builtin seccomp.
5. **Verified it live**, restarted it, and confirmed persistence.

## What was verified, and how

| Claim | Evidence |
|---|---|
| Tests pass | **317 / 317** (`npm test`), up from the 137 delivered |
| Installers are actually hardened | **48 / 48** — each installer run against a stub `docker`, flags inspected |
| Vendored Rust intact | 113 crates, 5 094 files, **0 corrupt, 0 missing** |
| Repository intact | `MANIFEST.sha256` **5 630 / 5 630 OK** |
| Backup restorable | `phase_3_20260725T065555Z`, **6 035 / 6 035**, exit code 0 |
| Container hardened | read-only rootfs, `CapDrop=[ALL]`, `no-new-privileges`, uid 10001, no Docker socket, one bind mount |
| Loopback only | `127.0.0.1:8100` answers; `192.168.178.100:8100` refused |
| Health | `/livez` 200, `/readyz` ready, `/healthz` healthy — 17 components, 0 degraded |
| Restart and persistence | healthy in seconds, `RestartCount=0`, state and token unchanged |
| Safe mode and crash loop | proven live on a probe container: 3 restarts in the window → safe mode, `/livez` 200, `/readyz` 503, writes refused, Owner able to leave |
| Bootstrap | token file `0600`, fingerprint matches the log, wrong/absent token refused and audited; full flow including single use and MFA proven on the probe |
| Nothing else touched | `docker ps -a`, `network ls`, `volume ls` all diffed against the pre-install inventory |

## What was NOT done — and must not be assumed

- **No Owner account exists.** Username, password and TOTP are the Owner's interactive
  choices, which §10 of the phase specification forbids making on their behalf. Steps are
  in `docs/OWNER_BOOTSTRAP.md`.
- **PostgreSQL/pgvector is not installed.** Neither is the Rust authority daemon.
- **No GPU is allocated.** The RTX 3060 is reported as present and unallocated.
- **No external provider, no TLS, no `noesar.com` connectivity.**
- **No SBOM was generated for the image** — no SBOM tool exists on this host.
- **`--memory-swap` did not take effect.** The kernel lacks swap accounting; the host has
  zero swap, so the intended outcome holds anyway. Stated, not glossed.
- **`FOSS_CORE_DEPENDS_ON_ATOM=false` is still `[UNVERIFIED]` at runtime** until the
  Phase-4 ATOM-absent acceptance run.
- **Prompt-injection containment is structural, not proven complete.** Adversarial
  evaluation is Phase 4.

---

## Defects repaired in this phase

| # | Defect | Severity |
|---|---|---|
| F-002 | all three installers passed the weakened seccomp profile to Docker | high |
| F-003 | both Unraid installers published on `0.0.0.0`, i.e. the whole LAN | high |
| F-004 | retrieved document text was injected into the `system` message | high |
| F-005 | the documented bootstrap token file was never read by any code | medium |
| F-006 | log rotation overwrote archives within a millisecond, losing records | medium |
| F-007 | all three installers fail on Docker 29 (`--mount …,rw` is invalid) | medium |
| F-008 | the installer's `TZ` was silently ignored inside the container | low |

Plus two found in code written this phase: `Logger.child()` threw on every call, and a
comment placed inside a `docker run` line continuation silently truncated the command —
caught before commit by running the installers, which is why
`tools/test-installer-hardening.mjs` now exists.

Findings dismissed as false positives, each with its evidence, are listed in
`docs/PHASE_3_IMPLEMENTATION_AND_INSTALL_REPORT.md` §3.

---

## Open blockers — unchanged, neither blocking

### B-001 — no GitHub remote · medium
`gh` is not installed and no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. The local
repository is complete and committed. Resolve by installing `gh` and running
`gh repo create NOESAR-EVOLUTION --private --source . --remote origin --push`, or by
creating the private repository manually and adding `origin`. **Must be private.**

### B-002 — heuristic secret scanning on the host · low
`gitleaks`/`trufflehog` are unavailable and installing tooling is forbidden. Corroborated
by `detect-secrets` and `semgrep` run through `noesar-debuglab`, which reported **zero**
findings across the whole first-party surface including everything written this phase.
Re-scan the **full history** if a real scanner appears, before the repository is ever made
public.

---

## Deferred, classified

| Item | Classification |
|---|---|
| WebUI settings pane for timezone and locale (picker, mismatch notice, shared formatter) | `DEFERRED` — server contract exists and is tested |
| Update signing side and portal; entitlement binding for the `owner` channel | `DEFERRED` — offline channel is fully functional |
| SBOM for the built image | `DEFERRED` — needs a tool this host does not have |
| Audit ledger `append` is O(n): the whole file is re-read to find the last hash | `DEFERRED` — correctness is fine, cost grows with history |
| `tools/verify-package.py` imports `sys` unused (ruff F401) | `DEFERRED_TO_PHASE_5` |
| 4 compiled `wit-bindgen` fragments excluded from Git, preserved in `$ARTIFACT_ROOT` | `DEFERRED` — unchanged since Phase 1 |
| First-party licence declarations, root `LICENSE`, SPDX headers, three-way licence split | `DEFERRED_TO_PHASE_5` |
| ATOM-absent acceptance run | `DEFERRED_TO_PHASE_4` |

---

## Useful facts for Phase 4

- **Health endpoints to drive acceptance from:** `/livez` (no dependency checks — the
  container `HEALTHCHECK` uses this), `/readyz` (dependencies plus safe mode), `/healthz`
  (17 components), `/diagnostics` (owner-only, redacted), `/metrics` (Prometheus text,
  authenticated or internal-network).
- **Safe mode can be induced deterministically** by writing three restart entries inside a
  ten-minute window into `state/watchdog.json` and restarting the container. That is how it
  was proven; do it on a probe, not on the installation.
- **The update manager has no signing key.** Phase 4 acceptance must generate a test key
  pair, install the public key with `installChannelKey`, and drop a bundle in
  `updates/inbox/`. Nothing signs artefacts today, by design.
- **Owner-only routes** need a session **and** the `x-noesar-csrf` header on writes, and
  `updates/apply` additionally needs recent strong reauthentication.
- **The probe pattern works well**: a disposable container on port 8101 with a throwaway
  workspace proves behaviour without touching the installation. Remove it afterwards.
- `noesar-debuglab` (`:8099`, `x-debuglab-token`) is the only place on this host carrying
  semgrep, bandit, ruff, detect-secrets and shellcheck. Start it for HUNT AND FIX, stop it
  in the same phase.

---

## Exact next action

**Phase 4 — Acceptance.** Do not start it without an explicit instruction from the Owner.

Before the acceptance matrix runs, two things are worth settling, in whichever order the
Owner prefers:

1. **Complete the Owner bootstrap** (`docs/OWNER_BOOTSTRAP.md`). Most of the acceptance
   matrix needs an authenticated owner session.
2. **Decide whether the GPU is allocated** for Phase 4, which the Phase 3 specification
   deliberately left to a separate test.

When authorised, follow the skill cycle from step 1: `READ STATE` (this file,
`PROJECT_STATE.json`, `docs/PHASE_4_ACCEPTANCE_PLAN.md`, `docs/INSTALLATION_LEDGER.md`,
`docs/DECISION_LOG.md`), then `VERIFY INPUTS`, `ASSESS RISKS`, `BACKUP`, and onward.

Rollback for anything Phase 3 installed is in `docs/PHASE_3_ROLLBACK.md`; the verified
pre-install backup is `phase_3_20260725T065555Z`.
