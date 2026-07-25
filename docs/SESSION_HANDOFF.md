# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. A cold session should be able to resume from this
file and `PROJECT_STATE.json` alone.**

---

## Current position

| Field | Value |
|---|---|
| Phase just completed | **4 — end-to-end acceptance, remediation, security and rollback** |
| Phase status | `COMPLETED` |
| **Next phase** | **5 — documentation, licensing audit, release and final packaging** |
| `NEXT_PHASE` | `5_READY` |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Updated (UTC) | 2026-07-25 |

**The product is installed, running and accepted.** Container `noesar-evolution`, image
`noesar-evolution:phase4`, on `127.0.0.1:8100`, healthy — and **still un-bootstrapped by
design**.

---

## What Phase 4 did

Ran 136 acceptance checks against the live system across five suites, found 13 defects, fixed
every high and medium one with regression tests, rebuilt and reinstalled the image twice, and
closed the `[UNVERIFIED]` label that had stood on ATOM independence since Phase 1.

```text
acceptance      136 checks: 132 PASS, 3 PARTIAL, 1 BLOCKED, 0 FAIL
unit tests      351/351   (317 delivered baseline + 34 added)
installers      48/48
findings        13 raised: 3 high, 3 medium, 3 low, 3 informational, 1 withdrawn
                9 closed (every high and medium), 4 open (all low/informational)
```

### The three that mattered

1. **One malformed request killed the whole service** (F4-004). `POST /api/v1/chat/stream`
   was called without `await`, so a rejection became an unhandled rejection and Node exited.
   A missing `content` field, from any session with `provider.use`, was enough. It killed
   three harness servers before it was understood.
2. **Streaming chat had never worked** (F4-006). `streamWithFallback()` referenced an
   identifier that does not exist in its scope, throwing on the first delta of every stream.
   Every streaming reply had always been two SSE frames — `run`, then `error`. It is nine now.
3. **A TOTP code could be replayed** (F4-002) for up to 90 seconds, so a code seen once
   authenticated a second, independent login. Reproduced live, then fixed with per-user
   single-use enforcement across all three flows, persisted across restarts.

Full register: `docs/OPEN_FINDINGS.tsv`. Narrative and dismissals:
`docs/REMEDIATION_LOG.md`. Everything else: `docs/PHASE_4_ACCEPTANCE_REPORT.md`.

---

## What was verified, and how

| Claim | Evidence |
|---|---|
| Auth, MFA, session, step-up | **27/27** — includes replayed-code rejection, single-use setup token, lockout, stolen-cookie-after-logout |
| Chat, projects, memory, RAG, files, artifacts, providers | **35/35** — fork/merge/compare/undo, three memory scopes, canary-verified project isolation, 5 artifact types with versioning |
| Web/API security, SSRF, files, injection, secrets, audit | **41 checks: 38 PASS, 2 PARTIAL, 1 BLOCKED, 0 FAIL** (in-container) |
| Container sandbox | **20/20** — uid 10001, `CapEff: 0` , `Seccomp: 2` builtin, read-only rootfs, `noexec` tmpfs, no Docker socket, `pids.max=512` proven by a refused fork storm |
| Restart, recovery, crash loop, safe mode, updates | **13 checks** — safe mode induced live, `/livez` 200 with `/readyz` 503, no data loss across five restarts |
| Prompt injection | **0 bypasses**, 10 committed regression tests across text, HTML, CSV, JSON and PDF |
| Backup and restore | 25/25 files restore byte-identical from a checksummed archive |
| ATOM absence | zero references in everything the image ships; 351/351 tests pass with nothing proprietary present |
| Test determinism | **352/352, with one observed unreproduced flake** in 1 of 14 runs — see `docs/PHASE_4_ACCEPTANCE_REPORT.md` §8b. Fails closed, so it cannot mask a defect |
| Nothing else touched | `docker ps -a` / `network ls` / `volume ls` diffed against pre-phase inventories; only the phase-4 container and its rollback differ |

---

## What was NOT done — do not assume otherwise

- **No Owner account exists on the real installation.** This was the Owner's own choice
  (D-0031). See the next section.
- **PostgreSQL/pgvector is not installed** (`B005=OPEN`). The runtime *fails closed* rather
  than substituting SQLite. Blocks production promotion, not Phase 5.
- **No GPU** (`GPU_RUNTIME=NOT_IMPLEMENTED`). There is no GPU workload in the product to test.
- **No TLS, no external provider contacted, no `noesar.com` connectivity.** Every credential
  used in this phase was synthetic and generated at run time.
- **No SBOM** — a declared-`PARTIAL` component inventory instead (`docs/SBOM_STATUS.md`).
- **No end-to-end update apply against the installation** (D-0037). The unit matrix covers it.
- **No independent penetration test.** The same party wrote the fixes and the tests.
- **Multi-user is unsupported.** Per-project isolation is verified; per-user isolation is
  neither implemented nor reachable in the reference data plane (F4-008).
- **`--memory-swap` still has no effect** — the kernel lacks swap accounting. The host has
  zero swap, so the intended outcome holds anyway. Stated, not glossed.

---

## The one thing waiting for the Owner

The installation is bound to `127.0.0.1` on the Unraid host, so from another machine:

```bash
ssh -L 8100:127.0.0.1:8100 root@192.168.178.100
# then open http://127.0.0.1:8100 in a LOCAL browser
```

Read the one-time token from
`/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/config/first-owner-setup.token` (mode `0600`, owner
`10001`, fingerprint `af6f7ca93c31`) and follow `docs/OWNER_BOOTSTRAP.md`. Choose the
password yourself. Keep the TOTP seed and recovery material in a password manager — none of
it should reach this repository, a log, or a chat transcript.

The token has a 72-hour TTL and will be regenerated on restart if it expires, so if setup
fails with "Invalid setup token", re-read the file.

---

## Open blockers

### B-001 — no GitHub remote · medium · unchanged
`gh` is not installed and no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. The local repository
is complete and committed. Resolve with `gh repo create NOESAR-EVOLUTION --private --source .
--remote origin --push`, or by creating the private repository manually and adding `origin`.
**Must be private.**

### B-002 — heuristic secret scanning · low · unchanged
No `gitleaks` or `trufflehog`, and installing tooling is forbidden. Corroborated by
`detect-secrets` and `semgrep` through `noesar-debuglab`, both reporting **zero** across the
whole first-party surface including everything written in this phase. Re-scan the **full
history** if a real scanner appears, before the repository is ever made public.

### B-005 — PostgreSQL/pgvector not installed · medium · NEW
Blocks production promotion, not Phase 5. Detail and the exact closing procedure:
`docs/DATABASE_ACCEPTANCE.md`.

### B-006 — no linter with a `no-undef` rule · low · NEW
Two Phase 4 findings were that class, and one meant streaming chat had never worked.
`node --check` cannot see it — the syntax is valid. A homegrown checker was written and
rejected as unsound (D-0034). Mitigated by success-path coverage and process-level guards,
not eliminated. Run `eslint` with `no-undef` before publication, on a host where installing
it is allowed.

---

## Open findings, all accepted and recorded

| ID | Sev | What |
|---|---|---|
| F4-010 | low | URL validation checks the hostname string, not the resolved address (DNS rebinding). Owner/admin only. |
| F4-011 | low | extraction routed by declared MIME, no content sniffing. Correctness, not execution risk. |
| F4-012 | info | the 48 MiB ingestion limit is unreachable through the API — the 64 MiB body cap fires first. |
| F4-013 | info | a full workspace backup is unencrypted and contains the auth master key: an operator duty Phase 5 must document. |

---

## Exact next action

**Phase 5 — documentation, licensing audit, release and final packaging.** Do not start it
without an explicit instruction from the Owner.

Worth settling first, in whatever order the Owner prefers:

1. **Complete the Owner bootstrap** (above). Nothing in Phase 5 requires it, but the
   installation is not usable until it happens.
2. **Decide on B-001.** Phase 5 produces a release; a release with no remote is a local
   artefact. If the repository is to be published, the licensing gaps below must be closed
   first, and the full Git history re-scanned with a real secret scanner.

Phase 5 inherits a specific licensing backlog, unchanged since Phase 1 and still open: 12
first-party Rust crates and 2 Node packages with no declared licence, no root `LICENSE`, 86
first-party source files without an SPDX header, and the proposed three-way split
(AGPL-3.0-or-later core / Apache-2.0 SDK / CC-BY-SA-4.0 docs) still a *proposal* recorded in
`docs/LICENSE_STRATEGY.md`, not a legal determination. `docs/DUAL_LICENSE_READINESS.md` has
the detail.

Also for Phase 5 packaging: rebuild the image from `oci/Dockerfile` with a recorded network
step rather than inheriting the Phase 3 apt layer (D-0033), and generate a real SBOM if a tool
becomes available (`docs/SBOM_STATUS.md` §"How to close it").

When authorised, follow the skill cycle from step 1: `READ STATE` (this file,
`PROJECT_STATE.json`, `docs/PHASE_PLAN.md`, `docs/INSTALLATION_LEDGER.md`,
`docs/DECISION_LOG.md`), then `VERIFY INPUTS`, `ASSESS RISKS`, `BACKUP`, and onward.

## Rollback

- **Container:** `noesar-evolution.rollback-phase3-20260725T121648Z` is stopped and intact on
  `noesar-evolution:phase3`. Both images are on disk and the bind mount is shared, so rollback
  is: stop the phase-4 container, `docker start` the preserved one.
- **Data:** `$ARTIFACT_ROOT/backups/pre_phase4_swap_20260725T121648Z` (7/7 verified) and
  `$ARTIFACT_ROOT/backups/phase_4_20260725T111435Z` (tracked HEAD 6058/6058 verified).
- **Procedure:** `docs/PHASE_3_ROLLBACK.md`, unchanged and still valid.

## Useful facts carried forward

- **Acceptance drivers live in `tools/acceptance/`** and are re-runnable: `a1` auth, `a2`
  workspace and chat, `a3` security, `a4` container sandbox, `a5` recovery and updates, plus
  `mock-provider.mjs`, which speaks all three provider wire styles and MCP-over-HTTP with
  switches for slow, failing, hostile and echoing behaviour.
- **Run `a3` in-container, not on the host.** `pdftotext`, `tesseract` and `ffprobe` exist in
  the image and not on this host, so the host run reports them absent — honestly, but it
  cannot exercise PDF or OCR paths.
- **The mock needs two addresses** when the product is containerised: the suite reaches it on
  loopback, the product dials it on the bridge gateway (D-0040).
- **Safe mode induction:** write three `{at, reason}` objects into `state/watchdog.json` —
  **objects, not bare timestamps**, or the filter silently drops them — and restart.
- **`freshCode()` in `a1` waits for the real TOTP rollover.** Since F4-002 a code is
  single-use, and fabricating a future code walks outside the ±1-step window.
- **Put fork-pressure tests last.** Spawned shells hold pids-cgroup slots, so anything exec'd
  after them cannot fork and reports a false negative.
- `noesar-debuglab` (`:8099`, `x-debuglab-token`, `GET /api/analyze?kind=code&target=…`,
  SSE) is the only place on this host with semgrep, bandit, ruff, detect-secrets, shellcheck
  and mypy. Start it for HUNT AND FIX, stop it in the same phase.
