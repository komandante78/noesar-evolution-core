# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. This file is the human-readable resume point.**
A cold session should be able to continue from this file alone, together with
`PROJECT_STATE.json`.

---

## Current position

| Field | Value |
|---|---|
| Phase just completed | **1 — Canonical extraction and repository construction** |
| Phase status | `COMPLETED` |
| **Next phase** | **2 — Host preflight and installation design** |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Last commit | `f6140d8` (main) + the state commit that follows it |
| Updated (UTC) | 2026-07-25T01:49:50Z |
| Canonical repository | **constructed** — 5,984 tracked files, 90 MB |

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

### B-003 — `cc-1.3.0` is missing 4 upstream source files (NEW) · medium
`rust/vendor/cc-1.3.0/src/target.rs` declares `mod apple; mod generated; mod llvm;
mod parser;` and **none of the four files ship in any archive**. The packaging filter
that strips `target/` build output removed a legitimate source directory — there are
zero `/target/` paths anywhere in the ZIPs.

This contradicts two of the delivery's own claims: the recorded
`vendorManifestAggregate` counts 5,207 vendor files where 5,203 ship, and the `B001`
closure evidence asserts a "complete vendor snapshot".

**Origin: upstream packaging defect, not introduced here. Deliberately not fixed.**
Impact is bounded — `cc` is reachable only through `iana-time-zone-haiku` (Haiku OS)
and is not compiled for linux-x86_64. **Phase 2 must decide**: re-vendor from
crates.io, request a corrected archive, or accept the gap with the platform
restriction documented.

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
