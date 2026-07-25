# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. This file is the human-readable resume point.**
A cold session should be able to continue from this file alone, together with
`PROJECT_STATE.json`.

---

## Current position

| Field | Value |
|---|---|
| Phase just completed | **2 — Host preflight and installation design** |
| Phase status | `COMPLETED` |
| **Next phase** | **3 — Isolated build and Unraid installation** |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Last commit | see `PROJECT_STATE.json.last_commit` |
| Updated (UTC) | 2026-07-25T06:30:00Z |
| Canonical repository | **constructed** — 6,007 tracked files, 90 MB |

---

## What was done

1. **Re-verified all five archives by SHA-256** (never by filename — all carry a
   ` (2)` suffix). 5/5 exact. Mapped hash → role, recorded in
   `docs/SOURCE_ARCHIVE_MAP.tsv`.
2. **Safety-scanned every archive before opening it** — `unzip -t` PASS ×5, and
   zero absolute paths, traversal, symlinks, device files, nested archives or
   case-collisions. Each has exactly one internal root directory.
3. **Extracted to `$STAGING/PHASE_1/`**, one directory per package, never into the
   Git root. 6,305 files, reconciling exactly with ZIP entry counts.
4. **Constructed the canonical repository**: package 01's `SOURCE/PRODUCT/` at the
   repository root with no artificial wrapper level; packages 02–05 contributed
   role material only; package envelopes preserved under `provenance/package-0N/`.
5. **Resolved every path conflict explicitly** — 281 identical duplicates collapsed,
   4 differing paths resolved and recorded, **0 unmapped**, **0 collisions** with
   Phase-0 files.
6. **Relocated binaries out of Git** to `$ARTIFACT_ROOT`, with checksums and a
   documented restore procedure.
7. **Ran the static checks, the secret scan and the ATOM boundary audit**, and wrote
   the full Phase-1 documentation set.

## What was verified, and how

| Claim | Evidence |
|---|---|
| Archives authentic | 5/5 SHA-256 exact, re-verified this phase (Phase-0's result not taken on trust) |
| Extraction faithful | per-package `SHA256SUMS.txt`: **6,300 / 6,300 OK** |
| **Canonical placement correct** | product `MANIFEST.sha256` verifies **5,606 / 5,606** at repository root — its paths are product-relative and all resolve |
| Vendored tree intact | every crate vs `.cargo-checksum.json`: **5,090 OK, 0 corrupt, 4 missing** (B-003) |
| `Cargo.lock` authentic | matches the hash in the delivered `PROVENANCE.json` |
| Phase-0 files untouched | all 13 byte-compared against a pre-merge backup: unchanged |
| Static correctness | JSON **121/121**, `bash -n` **46/46**, `node --check` **87/87**, nested archives **0** |
| No secrets | heuristic scan: 0 private keys, 0 provider tokens, 0 credential URLs; 2 benign hits (xkcd test passphrase). Zero private-key material in the product |
| No forbidden artefacts | staged set: 0 archives, 0 `.env`, 0 databases, 0 shared libraries, 0 ELF executables |
| ATOM boundary | **PASS** — public JSON-Schema contract + boundary docs only; no implementation |

## What was NOT done — and must not be assumed

- **Nothing was built, compiled, installed, started, or executed.** No container, no
  database, no network configuration, no production system was touched.
- **The core has not been proven to run without ATOM.** It holds *by design* (a
  functional `ReferenceReasoningProvider` ships in the core), but stays
  **`[UNVERIFIED]`** until the Phase-4 ATOM-absent acceptance run.
- **Nothing was relicensed.** Licensing remains a proposal.
- **No GitHub remote exists**, so nothing was pushed.
- **The 4 missing `cc-1.3.0` files were not recreated** — fabricating upstream source
  is forbidden.

---

## Open blockers

### B-001 — no GitHub remote (`GITHUB_STATUS=BLOCKED_AUTHENTICATION`) · medium
`gh` is not installed and no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. The local
repository is complete and committed. Resolve by installing `gh` and running
`gh repo create NOESAR-EVOLUTION --private --source . --remote origin --push`, or by
creating the private repo manually and adding `origin`. **Must be private.**
Does not block Phase 2.

### B-002 — heuristic secret scanning only · low
`gitleaks`/`trufflehog` unavailable; installing new tooling is forbidden. Relevance
rose this phase because 5,976 third-party files entered the repository, but the scan
found no key material. Re-scan the **full history** if a real scanner appears, before
the repository is ever made public.

### B-003 — CLOSED (repaired 2026-07-25)

The four missing `cc-1.3.0/src/target/*.rs` files were recovered from **two
independent authoritative copies already on this server** — the delivery own build
staging (`RUST_MANIFEST_REMEDIATION_V1`) and the canonical candidate tree, which are
byte-identical to each other. **No network was used.** Every file hash-matches the
crates.io-published `.cargo-checksum.json`; the package checksum matches
`Cargo.lock`; the crate verifies 26/26; the whole vendor tree is byte-for-byte
identical to the authoritative staging (5,207 files, `diff -rq` → 0).

The **same defect was live in this repository** — `.gitignore` was ignoring the
restored files, and `tools/create-rust-build-provenance.py` carried the same idiom.
Both fixed and locked down by a 19/19 regression test.

Offline validation in an isolated container (no network, empty `CARGO_HOME`):
metadata, tree, tests (5 passed / 0 failed) and release build all PASS; both binaries
produced. **`B001 = CLOSED`, `B-003 = CLOSED`.**

Full detail: `docs/PHASE_1_B003_VENDOR_REPAIR_REPORT.md`.

---

## Deferred items (classified, not forgotten)

| Item | Classification |
|---|---|
| 4 compiled `wit-bindgen` fragments excluded from Git, preserved in `$ARTIFACT_ROOT` — decide whether to restore, re-vendor, or leave out | `DEFERRED_TO_PHASE_2` |
| B-003 `cc-1.3.0` resolution | `DEFERRED_TO_PHASE_2` |
| Root `README.md` claims "57 files PASS" for JS syntax; the merged repository actually has 87, all passing | `DEFERRED_TO_PHASE_5` |
| No first-party licence declarations, no root `LICENSE`, 86 sources without SPDX headers | `DEFERRED_TO_PHASE_5` |
| Verbatim third-party notices; record the selected option for disjunctive licences (notably `r-efi`) | `DEFERRED_TO_PHASE_5` |
| Adopt the product's three-way licence split (AGPL core / Apache-2.0 SDK / CC-BY-SA-4.0 docs) into `docs/LICENSE_STRATEGY.md` | `DEFERRED_TO_PHASE_5` |
| ATOM-absent acceptance run to close `FOSS_CORE_MUST_REMAIN_AUTONOMOUS` | `DEFERRED_TO_PHASE_4` |

---

## Useful facts for Phase 2

- **Shape of the product**: only **12 first-party Rust crates (13 `.rs` files)** plus
  **113 vendored crates (5,203 files, ~80 MB)**. 87% of the repository is vendored
  third-party source, kept deliberately so the workspace builds offline.
- **Offline build entry point**: `cd rust && cargo build --workspace --release
  --locked --offline`. It depends on `rust/.cargo/config.toml` — which the Phase-0
  `.gitignore` was silently deleting until this phase fixed it.
- **Recorded toolchain** (from the delivery, not re-verified): `rust:1-bookworm`,
  rustc/cargo `1.97.1`.
- **Prebuilt Linux binaries** already exist in `$ARTIFACT_ROOT/prebuilt/linux-x86_64/`
  (`noesar-authority-daemon`, `noesar-control-plane`) with provenance — Phase 2 can
  choose to install these or rebuild from source.
- **The delivery declares** `productionReady=false` and
  `targetServerInstallationValidated=false` on all five packages, and names the
  outstanding work: first target Unraid installation, live PostgreSQL/pgvector
  acceptance, sandbox validation, platform execution matrix.
- Product work packages already scoped: `DOCUMENTATION/B003_SANDBOX_WORK_PACKAGE.md`,
  `B004_PLATFORM_ACCEPTANCE_PLAN.md`, `B005_POSTGRES_PGVECTOR_ACCEPTANCE_PLAN.md`.
  **Note the collision of identifiers**: the product's `B001`/`B003` are unrelated to
  this project's `B-001`/`B-003`.

---

## Exact next action

**Phase 2 — Host preflight and installation design.** Do not start it without an
explicit instruction from the owner.

When authorized, follow the skill cycle from step 1:

1. `READ STATE` — this file, `PROJECT_STATE.json`, `docs/PHASE_PLAN.md`,
   `docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md`, plus the Phase-1 outputs
   (`docs/PHASE_1_CANONICAL_EXTRACTION_REPORT.md`, `docs/REPOSITORY_LAYOUT.md`,
   `docs/INSTALLABLE_ARTIFACT_MAP.md`).
2. `VERIFY INPUTS` — confirm the working tree is clean and the canonical repository
   still verifies (`sha256sum -c MANIFEST.sha256` should give 5,606/5,606).
3. `ASSESS RISKS` — Phase 2 is **design only**: nothing is installed, no container is
   built or started, no database is touched.
4. Continue through `BACKUP`, `EXECUTE MINIMAL SCOPE`, `TEST`, `DOCUMENT`,
   `SECRET SCAN`, `GIT DIFF REVIEW`, `COMMIT`, `PUSH`, `WRITE HANDOFF`, `STOP`.

**Decide early in Phase 2:** the B-003 resolution and the `wit-bindgen` fragment
question, because both affect whether an offline build is viable on the target host.

---

## Addendum — B-003 vendor repair (2026-07-25)

**`B-003` and the product's own `B001` are both CLOSED.** All seven gates pass:

```text
VENDOR_COMPLETENESS=PASS      CARGO_CHECKSUMS=PASS       OFFLINE_METADATA=PASS
OFFLINE_TREE=PASS             OFFLINE_TESTS=PASS         OFFLINE_RELEASE_BUILD=PASS
PACKAGING_FILTER_REGRESSION=PASS
```

### What changed in the repository
- `rust/vendor/cc-1.3.0/src/target/{apple,generated,llvm,parser}.rs` — restored,
  official, hash-verified.
- `.gitignore` — `target/` anchored (`/target/`, `/rust/target/`, `/rust/*/target/`)
  plus negations for `**/vendor/**`.
- `tools/create-rust-build-provenance.py` — `is_build_output()` replaces the
  name-fragment test and now works on workspace-relative paths.
- `tools/test-packaging-filters.mjs` — **new**, 19/19.
- `MANIFEST.sha256` — 1 corrected hash + 4 added entries → **5,610/5,610 OK**.
- New docs: `PHASE_1_B003_VENDOR_REPAIR_REPORT.md`, `PACKAGING_FILTER_SAFETY_RULES.md`.

### Facts worth carrying into Phase 2
- **The offline build works and is verified**, in a container with no network and an
  empty `CARGO_HOME`, on `rustc/cargo 1.97.1` — the exact versions in the delivery's
  provenance, from a local `rust:1-bookworm` whose digest matches the recorded image ID.
  Release build: 9.20s, 0 warnings, both binaries produced.
- **The Rust test suite is thin** — 5 tests total, 21 of 24 binaries empty. Treat
  `OFFLINE_TESTS=PASS` as a weak signal; the substantial suites are the Node ones.
- **`cc` reachability is now measured**: absent from the host build graph, present only
  via `iana-time-zone-haiku` on the Haiku target.
- The `wit-bindgen` compiled-fragment question (Phase-2 deferred item) is **unaffected**
  and still open — those 4 files remain excluded from Git and preserved in
  `$ARTIFACT_ROOT/vendor-binary-fragments/`.

### Residual items (recorded, not fixed)
1. **The upstream packaging script is not on this host** — the ZIPs were built
   elsewhere, so the filter could not be corrected at its origin. A future archive from
   that pipeline could reintroduce the defect; `tools/test-packaging-filters.mjs` plus
   the §4 procedure in `docs/PACKAGING_FILTER_SAFETY_RULES.md` will catch it.
2. **`vendorManifestAggregate` is not reproducible** by its documented method — proven
   to be an upstream record defect (it does not reproduce from the delivery's own build
   staging either). Phase 5 should correct or drop it.
3. **Release binaries are not bit-identical** to the delivered prebuilt ones — expected,
   different build paths; bit-reproducibility is not claimed.

### Exact next action
**Phase 2 — Host preflight and installation design.** Not started, and not to be
started without an explicit instruction from the owner. `NEXT_PHASE=2_READY`.

Backup for this repair: `/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/pre_b003_repair_20260725T050034Z/`
(6,034 files, self-verified, `ROLLBACK.md` included).

---

## Addendum — Phase 2 complete (2026-07-25) · `NEXT_PHASE=3_READY`

Host preflight and full installation design are done. **Nothing was installed, built,
started, or reconfigured; no container, network or dataset on the host was touched.**

### The four decisions that change how Phase 3 must be run

1. **Host port is 8100, not 8088.** The product default is already claimed twice
   (`fridayn-model-factory`, `nova-ai`). Found by enumerating `docker inspect` bindings
   — with all 37 containers stopped, a live port scan shows 8088 as free.
2. **A dedicated network `noesar-evolution-net`**, never the installer default
   `noesar-local`, which belongs to the unrelated NOESAR V3 stack on this host.
3. **`chown 10001:10001` on the workspace.** The container is non-root 10001, Unraid
   shares default to 99:100, and the delivered installer only `chmod`s. Without this the
   container starts and then cannot persist.
4. **Do not pass `--security-opt seccomp=`.** The shipped profile is allow-by-default
   with a 24-syscall denylist — weaker than the Docker builtin it would replace, on a
   host with no AppArmor and no SELinux.

### Host facts worth carrying

Unraid 7.3.2 · Ryzen 5 5600X 6c/12t, **AVX2 only** · 31 GiB RAM, **no swap** (so the
memory cap is explicit) · RTX 3060 12 GiB idle, not claimed by this product ·
`/mnt/cachec` 324 G free · Docker 29.5.3, cgroup v2 · **37 containers, all stopped** ·
**AppArmor and SELinux both absent** · host TZ `Europe/Berlin`, `/etc/timezone` absent ·
**no python3, no cargo/rustc, no psql, no gh, no gitleaks** on the host.

### Defect fixed in this phase

`INSTALLATION/install-unraid.sh` hardcoded the package-02 `RUNTIME_SOURCE/` layout and
aborted at its own guard on a canonical checkout. Fixed with layout detection; `bash -n`
clean on all 10 installer scripts. `deployment/unraid/install-complete.sh` was already
correct and was verified, not modified.

### Build needs one bounded network step

`node:22-bookworm-slim` is **not** present locally (only `node:20`), and the Dockerfile
`apt-get`s five packages. The **runtime** is fully offline and there are **zero
third-party npm dependencies** — but the build is not offline. Both installers already
fail loudly rather than auto-pulling, which is correct. Phase 3 step 3 is that
authorised pull.

### What Phase 3 installs — and does not

Installs: the single Node container, `reference-json` data plane, loopback only.
Does **not** install: PostgreSQL/pgvector (separate, own acceptance), the Rust authority
daemon, any GPU allocation, any external provider, any `noesar.com` connectivity, TLS.

Phase 3 also **implements** (all designed, none blocking install): `/livez` `/readyz`
`/metrics` `/diagnostics`, structured logging with correlation IDs, debug mode with TTL,
watchdog levels 0–4 plus safe mode, and the timezone chain.

### Open blockers — unchanged

**B-001** no GitHub remote (`gh` absent, `GIT_PUSH=BLOCKED_NO_REMOTE`) · **B-002**
heuristic secret scanning only. Neither blocks Phase 3.

### Standing `[UNVERIFIED]`

`FOSS_CORE_DEPENDS_ON_ATOM=false` is re-verified at source level but stays
`[UNVERIFIED]` until the Phase-4 ATOM-absent acceptance (§J) actually runs it.

### Exact next action

**Phase 3 — Isolated build and Unraid installation.** Do not start without explicit
owner authorisation, which must cover **both** the installation and the bounded
build-time network step. Follow `docs/PHASE_3_EXECUTION_PLAN.md` from its pre-flight
gates; every step has a stop criterion and rollback is in
`docs/ROLLBACK_AND_RECOVERY_PLAN.md`.
