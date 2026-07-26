# NOESAR EVOLUTION — Installation Ledger

Append-only record of every action that touched the workspace or the host.
Never rewrite a past entry; correct it with a new entry.

---

## Phase 0 — Bootstrap, governance, persistent state and private Git repository

**UTC:** 2026-07-25T01:13:11Z
**Result:** see `docs/SESSION_HANDOFF.md`

### Environment observed

| Item | Value |
|---|---|
| Host | Unraid, Linux 6.18.38 |
| `PROJECT_ROOT` | `/mnt/cachec/NOESAR_EVOLUTION` (did not exist; created) |
| Free space on `/mnt/cachec` | 325 GB available of 466 GB |
| `git` | 2.55.0 — available |
| `gh` (GitHub CLI) | **not installed** (`command not found`) |
| `gitleaks` | **not installed** |
| `trufflehog` | **not installed** |
| `node` / `npm` | available (`/usr/local/bin`) |

### Source archive verification (no extraction performed)

Location: `/mnt/user/downloads/NOESAR_EVOLUTION_FINAL`
Method: `sha256sum` over each `.zip`, compared to the expected values supplied with
the phase specification and to the vendor manifest `SHA256SUMS(2).txt`.

| # | Archive | SHA-256 | Match |
|---|---|---|---|
| 01 | `NOESAR_EVOLUTION_01_COMPLETE_PRODUCT_SOURCE_V4_FINAL(2).zip` | `0b128b16…8b8a033c` | OK |
| 02 | `NOESAR_EVOLUTION_02_RUNTIME_AND_DEPLOYMENT_V4_FINAL(2).zip` | `c15193ee…6e5d5ffb` | OK |
| 03 | `NOESAR_EVOLUTION_03_CAPABILITIES_AND_SDK_V4_FINAL(2).zip` | `e6a68bf1…1724f2de76` | OK |
| 04 | `NOESAR_EVOLUTION_04_SECURITY_AND_ACCEPTANCE_V4_FINAL(2).zip` | `4ffb0d4f…5ff4a1ed72` | OK |
| 05 | `NOESAR_EVOLUTION_05_FINAL_RELEASE_AND_OPERATIONS_V4_FINAL(2).zip` | `7a58bdda…ad01424c5` | OK |

**5 of 5 checksums match exactly.** Archive count is exactly 5, as required.

**Deviation recorded (content-neutral):** all five files on disk carry a ` (2)`
suffix before the extension — a browser duplicate-download artifact. The names in
the phase specification and in the vendor manifest have no suffix. Content is
byte-identical to the manifest, so the deviation is naming only. The files were
**not** renamed: renaming source archives is a mutation outside the Phase 0 scope
and outside `PROJECT_ROOT`. Phase 1 must resolve the names by glob or by an explicit
rename instruction from the owner.

Two non-archive files also present and left untouched: `FINAL_PACKAGE_INDEX(2).md`,
`FINAL_PACKAGING_REPORT(2).txt`.

### Workspace created

```text
/mnt/cachec/NOESAR_EVOLUTION/
├── CLAUDE.md
├── CLAUDE10.md
├── PROJECT_STATE.json
├── .gitignore
├── .claude/skills/noesar-evolution/SKILL.md
└── docs/
    ├── SESSION_HANDOFF.md
    ├── INSTALLATION_LEDGER.md
    ├── DECISION_LOG.md
    ├── PROJECT_SUMMARY_FROM_INCEPTION.md
    ├── PHASE_PLAN.md
    ├── FUNDING_ALIGNMENT.md
    ├── LICENSE_STRATEGY.md
    └── ATOM_PUBLIC_PRIVATE_BOUNDARY.md
```

No pre-existing directory was found at `PROJECT_ROOT`, so no inventory or ownership
verification of prior content was required.

### Prohibitions honoured in this phase

| Prohibition | Observed |
|---|---|
| `PRODUCT_EXTRACTION` | false — no archive opened |
| `DOCKER_BUILD` | false |
| `CONTAINER_START` | false |
| `DATABASE_MUTATION` | false |
| `INSTALLATION` | false |
| `PRODUCTION_TOUCHED` | false — no existing container, service, or dataset read or written |
| `ZIP_REPACKAGING` | false |

### Git — local repository

`git init -b main` inside `PROJECT_ROOT`. 12 files staged and committed; the five
archives are excluded by `.gitignore` and were never staged.

Staged-set audit before commit:

- `git ls-files` → 12 files.
- `file(1)` on each → all plain UTF-8 text or JSON. **No binary of any kind.**
- Pattern check for `.zip|.tar|.gz|.7z|.exe|.dll|.so|.dylib|.sqlite|.db|.pem|.key|.env`,
  `secrets/`, `credentials/`, `BACKUPS/` in the staged set → **no match**.
- Absolute paths published: only `/mnt/cachec/NOESAR_EVOLUTION` (the project root)
  and `/mnt/user/downloads/NOESAR_EVOLUTION_FINAL` (the archive location). Both are
  technically necessary for the state/handoff mechanism to resume across sessions,
  per rule 29. No third-party infrastructure, hostname, or credential path exposed.
- `git diff --cached --stat` → 12 files, 976 insertions, 0 deletions.

**Commit 1:** `c3ad683e977c44e421a9141a3c7640720c48f84d`
`chore(phase-0): bootstrap NOESAR Evolution governance and resumable workflow`

**Commit 2:** state and handoff (this update), committed separately as an atomic
follow-up because the state file must record the SHA of commit 1.

### Secret scan — heuristic, declared

`gitleaks` and `trufflehog` are both absent from this host, and rule 45 forbids
installing new tooling to satisfy the scan. A **heuristic scan** was run instead.

Five patterns over the staged set, all returning **zero matches**:

| # | Pattern | Result |
|---|---|---|
| 1 | credential keyword (`api_key`/`secret`/`token`/`password`/`cookie`/`bearer`/…) followed by an assignment to a quoted value ≥6 chars | no match |
| 2 | `BEGIN … PRIVATE KEY` / `BEGIN CERTIFICATE` blocks | no match |
| 3 | known provider token shapes (`ghp_`/`gho_`/`sk-`/`xox*-`/`AKIA…`/`AIza…`) | no match |
| 4 | credential-bearing connection strings (`scheme://user:pass@host`) | no match |
| 5 | contiguous hex runs ≥40 chars (possible key material) | no match |

**Detector self-test:** the patterns were run against a synthetic canary file written
outside the repository containing an api-key assignment, a `ghp_` token, a
credential-bearing URL, and a private-key header. **All four were flagged**, then the
canary was removed. The zero-match result on the staged set is therefore meaningful
rather than a silently broken check.

An initial scan attempt placed `--cached` after the pattern, which git interpreted as
a revision; it errored and produced misleading "no match" output. This was caught and
the scan was re-run with correct argument order. The results above are from the
corrected run.

### GitHub — blocked

`gh` is **not installed** on this host. Verified by `command -v gh`, by checking
`/usr/local/bin`, `/usr/bin`, `/opt/gh/bin`, `/root/.local/bin`, `/mnt/user/appdata/gh`,
and by a bounded `find` over `/usr/local`, `/usr/bin`, `/opt` — absent everywhere.
No `GH_TOKEN`, `GITHUB_TOKEN`, or `GH_ENTERPRISE_TOKEN` is set in the environment
(checked by variable name only; no value was printed).

Consequently `gh repo create NOESAR-EVOLUTION --private --source . --remote origin --push`
could not be executed. Recorded as `GITHUB_STATUS=BLOCKED_AUTHENTICATION` (blocker
B-001). **No token was written to any file** and no remote was configured
(`git remote -v` → empty). The local repository was completed regardless, as the
phase specification requires.

### Phase 0 outcome

`COMPLETE_WITH_BLOCKER` — all local objectives met; the GitHub remote (B-001) and
real secret scanning (B-002) remain open. Neither blocks Phase 1.
`NEXT_PHASE=1`. Phase 1 was **not** started.

---

## Phase 1 — Canonical extraction and repository construction

**UTC:** 2026-07-25T01:49:50Z
**Result:** `COMPLETED` (1 new blocker recorded, upstream origin)
**Main commit:** `f6140d86257a7fccb3db8fca7448213473552208`

### Entry state

`current_phase=0`, `next_phase=1`, working tree clean at `ce34bf4`, all 13 Phase-0
files unmodified. The specification expected the label `CURRENT_PHASE=0_COMPLETED`
while the state file said `COMPLETE_WITH_BLOCKER`; these are substantively the same
(both Phase-0 blockers carry `blocks_phase_1: false`, and that status is exactly what
Phase 0's own specification prescribed when `gh` is absent). Recorded, proceeded.

### Archive identification — by hash, never by name

| Role | SHA-256 | Real filename | Size | Entries |
|---|---|---|---|---|
| PACKAGE_01_SOURCE | `0b128b16…a033c` | `…01_COMPLETE_PRODUCT_SOURCE_V4_FINAL(2).zip` | 18,186,438 | 5,663 |
| PACKAGE_02_RUNTIME | `c15193ee…d5ffb` | `…02_RUNTIME_AND_DEPLOYMENT_V4_FINAL(2).zip` | 1,232,478 | 134 |
| PACKAGE_03_SDK | `e6a68bf1…2de76` | `…03_CAPABILITIES_AND_SDK_V4_FINAL(2).zip` | 196,014 | 176 |
| PACKAGE_04_SECURITY | `4ffb0d4f…1ed72` | `…04_SECURITY_AND_ACCEPTANCE_V4_FINAL(2).zip` | 160,315 | 129 |
| PACKAGE_05_OPERATIONS | `7a58bdda…424c5` | `…05_FINAL_RELEASE_AND_OPERATIONS_V4_FINAL(2).zip` | 1,616,521 | 203 |

5/5 matched. Originals never renamed, modified, or repackaged.

### Safe extraction

Pre-extraction, per archive: `unzip -t` PASS; 0 absolute paths; 0 `../` traversal;
0 symlinks/devices/FIFOs/sockets; 0 nested archives; 0 case-insensitive collisions;
exactly one internal root directory. Extracted to `$STAGING/PHASE_1/<package>/`,
never into the Git root. 6,305 files, 0 non-regular files after extraction.

### Integrity evidence

- Per-package `SHA256SUMS.txt`: **6,300 / 6,300 OK**.
- Product `MANIFEST.sha256` at repository root: **5,606 / 5,606 OK** — independent
  proof the canonical placement is correct.
- Vendored crates vs `.cargo-checksum.json`: **5,090 OK, 0 corrupt, 4 missing**.
- `rust/Cargo.lock` matches the delivered provenance hash `6cbc6d32…`.

### Canonical construction

Package 01 `SOURCE/PRODUCT/` → repository root, no wrapper level. Packages 02–05
contributed role material; envelopes preserved under `provenance/package-0N/`.

| Outcome | Count |
|---|---|
| Unique canonical destinations written | 5,989 |
| Identical duplicates collapsed | 281 destinations |
| Differing paths, all explicitly resolved | 4 |
| Excluded from Git (compiled binaries) → `$ARTIFACT_ROOT` | 5 |
| Unmapped | **0** |
| Collisions with Phase-0 protected paths | **0** |

All 13 Phase-0 files byte-compared against the pre-merge backup
(`BACKUPS/phase1_pre_merge_20260725T012849Z/`): unchanged.

### Defects

- **FIXED_IN_PHASE_1** — the Phase-0 `.gitignore`, written before any product was
  visible, used un-anchored patterns (`build/`, `bin/`, `out/`, `cache/`, `.cargo/`,
  `*.pem`) that silently excluded **real source**: `rust/.cargo/config.toml` (the
  vendoring configuration, listed as a required artefact in the delivery's own
  `BUILD_ARTIFACTS.tsv`), vendored `build/`, `src/cache/` and `bin/` source
  directories, and a **public** Ed25519 key needed by the signature examples.
  Patterns anchored to the repository root; `.cargo/` replaced by
  `**/.cargo/credentials*`; `*public*.pem` negated. Verified: zero private-key
  material exists anywhere in the product.
- **DEFERRED_TO_PHASE_2** — 4 compiled fragments in `wit-bindgen-0.57.1` (`.a`,
  2×`.o`, `.wasm`) are checksummed by cargo but forbidden by `CLAUDE10.md` §33.
  Excluded from Git, preserved byte-identical in
  `$ARTIFACT_ROOT/vendor-binary-fragments/` with `SHA256SUMS.txt` and a restore
  procedure. Reachable only via `wasip2`; not built for linux-x86_64.
- **B-003, DEFERRED_TO_PHASE_2** — `rust/vendor/cc-1.3.0/src/target/` is missing four
  source files declared by `src/target.rs`. The packaging `target/` filter stripped a
  legitimate source directory; zero `/target/` paths exist in any ZIP. Contradicts the
  delivery's `vendorManifestAggregate` (5,207 vs 5,203) and its `B001` "complete
  vendor snapshot" claim. **Not fixed — fabricating upstream source is forbidden.**
- **DEFERRED_TO_PHASE_5** — root `README.md` claims "57 files PASS" for JS syntax; the
  merged repository has 87, all passing. Product documentation was not rewritten.

### Static checks

JSON **121/121** valid · `bash -n` **46/46** clean · `node --check` **87/87** clean ·
product manifest **5,606/5,606** · nested archives **0** · old-workspace absolute
paths **0** · `PREVIEW|DRAFT|SKELETON|RELEASE_CANDIDATE = true` assertions **0** ·
product blocker `B001` open **no** · `.gitignore` effective, only 4 intended
exclusions remain. **No build or installation performed.**

### Secret scan — heuristic, declared

Over the staged set (5,984 files at main-commit time): private keys **0**, provider tokens **0**, credential URLs
**0**, credential-keyword hits **2** (both the xkcd passphrase
`correct horse battery staple` in `tools/auth-http-smoke.mjs`, a deliberate
smoke-test fixture). Forbidden artefacts staged: archives **0**, `.env` **0**,
databases **0**, shared libraries **0**, ELF executables **0**. Remaining 29
non-text files: 3 product design PNGs, 1 vendor SVG icon, 25 crypto test vectors.

### ATOM boundary

**PASS.** Only `private-boundary/atom-provider.schema.json` (a public JSON-Schema
contract) and boundary documentation. `atomic-store.mjs` and 26 vendored
atomics-related files are false positives on the substring "atom". No quarantine
required. `FOSS_CORE_MUST_REMAIN_AUTONOMOUS` holds by design but stays
`[UNVERIFIED]` until the Phase-4 ATOM-absent run.

### Licensing — inventory only, nothing relicensed

113 vendored crates, **all permissive**, **zero copyleft-only**. Gap: no first-party
licence declarations (12 crates + 2 Node packages), no root `LICENSE`, 86 sources
without SPDX headers. Readiness: **NOT READY**, no blocking obstacle. The delivered
licensing matrix independently matches the Phase-0 proposal.

### Git

Main commit `f6140d8` (5,995 files changed, 1,681,617 insertions). State commit
follows. **`GIT_PUSH=BLOCKED_NO_REMOTE`** — no `origin` configured (B-001); no push
attempted, `gh` not installed, no token requested.

### Prohibitions honoured

`DOCKER_BUILD` · `CONTAINER_START` · `INSTALLATION` · `DATABASE_MUTATION` ·
`NETWORK_CONFIGURATION` · `PRODUCTION_TOUCHED` · `ZIP_REPACKAGING` ·
`LICENSE_RELICENSING` — all **false**. Nothing outside `PROJECT_ROOT`,
`$STAGING` and `$ARTIFACT_ROOT` was written.

---

## Phase 1 — B-003 vendor repair (`NOESAR_PHASE_1_B003_VENDOR_REPAIR`)

**UTC:** 2026-07-25T05:15:00Z
**Result:** REPAIRED AND VERIFIED — `B-003 = CLOSED`, `B001 = CLOSED`
**Network used: NO.** Phase 2 not started.

### Entry state
`current_phase=1 COMPLETED`, working tree clean at `290ed5a`, B-003 open, all four
`cc-1.3.0/src/target/*.rs` confirmed still missing.

### Backup (before any mutation)
`/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/pre_b003_repair_20260725T050034Z/` —
full export of git HEAD + the crate as-was + `SHA256SUMS.txt` (6,027 entries,
self-verified PASS) + `ROLLBACK.md`. 6,034 files, 91 MB.

### Authoritative recovery — no network
Two independent copies were already on this server, so the authorised temporary
network access was **never used**:
- primary: `NOESAR_EVOLUTION_CANONICAL_V1/BUILD_ARTIFACTS/RUST_MANIFEST_REMEDIATION_V1/staging/rust/vendor/cc-1.3.0/`
  (the delivery's own build staging — the phase named in its `PROVENANCE.json`)
- corroborating: `NOESAR_EVOLUTION_CANONICAL_V1/WORKSPACE/CANONICAL_CANDIDATE_V1/PRODUCT/rust/vendor/cc-1.3.0/`

The two are byte-identical. All four files hash-match the crates.io-published
`.cargo-checksum.json`; `cc 1.3.0` package checksum matches `Cargo.lock`
(`c89588d0…`); `diff -rq` against the authoritative copy showed **only** the missing
`src/target` directory — no unexplained differences. Only the four official files
were promoted.

### Filter correction — the same defect was live in this repository
`git check-ignore` proved all four restored files were ignored by `.gitignore:31`
(`target/`): the repair would never have been committed, and a fresh clone would have
reproduced B-003.
- `.gitignore`: `target/` → `/target/`, `/rust/target/`, `/rust/*/target/` + negations for `**/vendor/**`
- `tools/create-rust-build-provenance.py:28`: `"target" not in path.parts` →
  `not is_build_output(path.relative_to(workspace).parts)`, which also fixes a latent
  absolute-path bug
- new `tools/test-packaging-filters.mjs`: **19/19 PASS** (12 gitignore cases via real
  `git check-ignore`, 7 against the actual Python predicate, run in-container because
  `python3` is absent on the host)

No other packaging filter in the repository uses that idiom. The script that built the
original ZIPs is **not on this host** and could not be corrected at its origin —
recorded as residual.

### Offline validation (isolated container, `--network=none`, empty `CARGO_HOME`)
Toolchain `rustc/cargo 1.97.1` — identical to the delivery's recorded provenance, and
the local `rust:1-bookworm` digest matches the recorded image ID.

| Gate | Result |
|---|---|
| `cargo metadata --locked --offline` | PASS — 125 packages, 12 workspace members |
| `cargo tree --locked --offline` | PASS — 252 lines |
| `cargo test --workspace --locked --offline` | PASS — 5 passed, 0 failed (thin suite: 21/24 binaries have no tests) |
| `cargo build --workspace --release --locked --offline` | PASS — 9.20s, 0 warnings |
| authority daemon / control plane | both built |

`--workspace` is not accepted by `cargo metadata`; the correct equivalent was used and
the discrepancy recorded. `cc` reachability measured, not assumed: absent from the host
graph, present only via `iana-time-zone-haiku` on the Haiku target.

### Vendor completeness
113 crates, **5,094 files OK, 0 missing, 0 corrupt** (was 4 missing). File count
**5,207**, matching the delivered provenance. Byte-for-byte identical to the
authoritative staging (`diff -rq` → 0). `rust/.cargo/config.toml` proven active.

The recorded `vendorManifestAggregate` still does not reproduce (7 conventions tried)
— proven to be an upstream record defect, since it does not reproduce from the
delivery's own build staging either.

### Manifest updates (authorised)
`MANIFEST.sha256` was generated from the damaged tree (5,203 vendor files, zero
`cc-1.3.0/src/target/` entries). Updated: 1 corrected hash
(`tools/create-rust-build-provenance.py`, `dfe9c0eb…` → `e530f2cf…`) + 4 added entries
at their official upstream hashes. Now **5,610/5,610 OK**, still sorted, diff of
exactly 6 lines.

### Licensing
Untouched. `LICENSE_RELICENSING=false`. The four gaps remain registered verbatim.

### Prohibitions honoured
`PHASE_2_START` · `DOCKER_BUILD_PRODUCT` · `CONTAINER_START` · `INSTALLATION` ·
`DATABASE_MUTATION` · `PRODUCTION_TOUCHED` · `ZIP_REPACKAGING` · `LICENSE_RELICENSING`
— all false. The only container used was an ephemeral `--rm --network=none`
toolchain container for verification; no product image was built and no service started.

---

## Phase 2 — Host preflight and installation design

**UTC:** 2026-07-25T06:30:00Z
**Result:** `COMPLETED` — `NEXT_PHASE=3_READY`
**Host mutations: NONE.** No container started or stopped, no network or dataset changed.

### Entry state
`current_phase=1 COMPLETED`, `B001=CLOSED`, `B-003=CLOSED`, `next_phase=2`, tree clean at `ccca61b`.

### Host inventory (read-only)
Unraid 7.3.2 / kernel 6.18.38 / Ryzen 5 5600X 6c-12t (AVX2, no AVX-512, AES+SHA-NI) /
31 GiB RAM, 24 GiB free, **NO SWAP** / RTX 3060 12 GiB idle, `nvidia` runtime + CDI /
`/mnt/cachec` 324 G free, `/var/lib/docker` 144 G free / Docker 29.5.3, overlay2,
cgroup v2 / **37 containers, 0 running**, 99 images / seccomp available, **AppArmor and
SELinux both ABSENT** / TZ `Europe/Berlin`, ntpd running, `/etc/timezone` absent /
absent tooling: python3, cargo, rustc, psql, gh, gitleaks.

23 host ports are reserved by existing container configuration — derived from
`docker inspect`, because with every container stopped a live port scan shows nothing.

### Installability verdict
Build context complete; zero old-workspace dependencies in code or config; zero
third-party npm dependencies. `/healthz` implemented, `/livez` `/readyz` `/metrics`
`/diagnostics` missing. Data plane defaults to file-backed `reference-json`; the full
Postgres+pgvector schema exists but is a separate installation. Update manager absent.
Runtime is fully offline; **build is not** (`node:22-bookworm-slim` absent locally,
plus `apt-get` for 5 packages).

### Defect found and FIXED
`INSTALLATION/install-unraid.sh` hardcoded `RUNTIME_ROOT="$PACKAGE_ROOT/RUNTIME_SOURCE"`
(the package-02 layout) and aborted at its own `test -f "$RUNTIME_ROOT/oci/Dockerfile"`
guard on a canonical checkout — a certain installation blocker, statically fixable.
Backup `.../backups/pre_phase2_fix_20260725T060825Z/` (checksummed), minimal layout
detection applied, `bash -n` clean on all 10 installer scripts, dry evaluation confirms
both guards pass. `deployment/unraid/install-complete.sh` was already correct and was
verified, not modified.

### Key design decisions
Host port **8100** (product default 8088 already claimed twice by `fridayn-model-factory`
and `nova-ai`) · **loopback-only** binding · dedicated **`noesar-evolution-net`** instead
of the installer default `noesar-local`, which belongs to the unrelated NOESAR V3 stack ·
runtime root on `/mnt/cachec` rather than the `/mnt/user` FUSE overlay, **not created in
this phase** · workspace **`chown 10001:10001`** because the container is non-root and
Unraid shares default to 99:100 · limits 8 G / 4 CPU / 512 pids, explicit because the
host has no swap · **Docker builtin seccomp profile instead of the shipped one**, which
is allow-by-default with a 24-syscall denylist and therefore weaker than the
deny-by-default builtin it would replace.

### Security matrix
41 requirements: 20 IMPLEMENTED, 9 PARTIAL, 5 UNVERIFIED, 4 MISSING, 1 NOT_APPLICABLE,
1 IMPLEMENTED_BY_DESIGN, 1 BROKEN. Highest residual risk: prompt injection (direct and
indirect, PARTIAL), user/project isolation (implemented, unproven at runtime), update
package signing (MISSING), seccomp (BROKEN, mitigated by configuration).

### Licences and ATOM
Nothing relicensed. The four gaps remain open verbatim. `FOSS_CORE_DEPENDS_ON_ATOM=false`
and `PRIVATE_ATOM_IMPLEMENTATION_PRESENT=false` re-verified; still `[UNVERIFIED]` at
runtime until the Phase-4 ATOM-absent acceptance. **No VPS contacted.**

### Verification
`bash -n` 10/10 · `MANIFEST.sha256` 5610/5610 · vendor 113 crates / 5,094 files / 0
missing / 0 corrupt · packaging filters 12/12 + 7/7 · heuristic secret scan 0 findings
with detector self-test.

### Prohibitions honoured
`DOCKER_BUILD` · `CONTAINER_START` · `INSTALLATION` · `DATABASE_MUTATION` ·
`NETWORK_MUTATION` · `VPS_ACCESS` · `PRODUCTION_TOUCHED` · `ZIP_REPACKAGING` ·
`LICENSE_RELICENSING` — all false. `PROPOSED_RUNTIME_ROOT` deliberately **not** created.

---

## Post-Phase-2 — first `HUNT AND FIX` sweep (owner-requested)

**UTC:** 2026-07-25T07:00:00Z
**Result:** 1 real defect found (`F-001`, fix designed, **not applied** — awaiting
authorisation). Policy amended so future phases repair rather than file.

`noesar-debuglab` was started for the scan and **stopped again**; the host is back to
0 running containers of 37, exactly as before. It mounts the host read-only. No product
container was built or started, nothing was installed.

**Tooling used** (none of it exists on the host): semgrep, bandit, ruff,
detect-secrets, shellcheck, mypy — image `noesar-debuglab:project-scanner-v7`.

**Found:** `gcm-no-tag-length` ×4 (credential vault + auth-crypto) — recorded as
`F-001` in `PROJECT_STATE.json.open_findings`.

**Dismissed after per-item triage:** SC1007 ×5 (`CDPATH= cd` is the correct idiom),
`insecure-file-permissions` ×2 (0o700 is *more* restrictive than the suggested 0o644),
B105 (test canary `must-not-leak`), `insecure-object-assign` (literal keys on a fresh
`Error`), B603/B607/S603/S607 ×34 (tests and build tooling).

**Secret scan:** repository-wide `detect-secrets`, 5,148 raw hits / 303 files,
**zero real secrets** — 5,078 were SHA-256 checksums; two hits were this project's own
documentation of the scan pattern. Independently corroborates every heuristic scan from
Phases 0–2 and materially strengthens blocker B-002.

**Clean:** `rust/crates/` 0, `oci/` 0, `INSTALLATION/` 0 (shellcheck, verified with a
canary self-test that fired 3 issues, so the clean result is meaningful).

**Governance amended:** phase cycle 13 → 14 steps; `CLAUDE10.md` §16 and the skill's
standing rules gained a narrow exception permitting `noesar-debuglab` for step 7,
started and stopped within the same phase. Nothing else was loosened.

---

## F-001 — `gcm-no-tag-length` fixed (owner-authorised)

**UTC:** 2026-07-25T07:20:00Z · **Result:** CLOSED

**Reproduced before fixing.** A standalone harness using the exact shape of the
shipped code showed Node accepting a **4-byte** GCM tag and decrypting successfully —
authentication strength 32 bits instead of 128. Not taken on semgrep's word.

**Fix, 4 sites** (backup: `.../backups/pre_f001_gcm_fix_20260725T064102Z/`, self-verified):
`GCM_TAG_BYTES = 16` pinned via `{ authTagLength: GCM_TAG_BYTES }` on both
`createCipheriv` and `createDecipheriv`, plus an explicit decoded-tag-length check
before `setAuthTag`:

- `services/reference-control-plane/src/auth-crypto.mjs` (`encryptSecret`/`decryptSecret`)
- `services/reference-control-plane/src/ai-workspace/credential-vault.mjs`
- `ai-workspace/credential-vault.mjs`
- `ai-workspace/runtime/credential-vault.mjs`

The three `credential-vault.mjs` copies were byte-identical before and remain
byte-identical after (single md5 across all three).

**Evidence:**
- 8 new regression tests, `services/reference-control-plane/test/gcm-tag-length.test.mjs`
  — 8/8 pass; they reject 4/8/12/13/14/15-byte tags, a flipped tag byte and a tampered
  ciphertext, and assert the round-trip and the 16-byte tag are unchanged.
- Full product suite **137/137 pass, 0 fail** (delivery recorded 129; +8 new).
- semgrep re-scan of `services/` and `ai-workspace/`: **0** `gcm-no-tag-length`
  findings, 0 findings overall. `noesar-debuglab` was started for the re-scan and
  **stopped again**; host back to 0 running containers of 37.
- `MANIFEST.sha256` updated (2 hashes + 1 new entry) → **5611/5611 OK**, still sorted.

**Note:** the two top-level `ai-workspace/` copies are not covered by
`MANIFEST.sha256` — that manifest tracks the package-01 product tree, while those
copies originate from packages 03/04. Expected, recorded so it is not mistaken for
manifest drift later.

---

# Phase 3 — Implementation and installation (2026-07-25)

`PHASE_3 = COMPLETED` · `NEXT_PHASE = 4_READY` · `PHASE_3_ROLLBACK = NOT_REQUIRED`

## What was done, in order

1. **Pre-flight** — working tree clean; `MANIFEST.sha256` 5 611/5 611; vendor 113 crates /
   5 094 files / 0 corrupt / 0 missing; container name free; network name free; port 8100
   free; 144 G free on `/var/lib/docker`, 324 G on `/mnt/cachec`. `happy_bhaskara` does not
   exist on this host at all — recorded rather than assumed.
2. **Backup** — `ARTIFACT_ROOT/backups/phase_3_20260725T065555Z`, `git archive` of HEAD plus
   full Docker inventories, self-verifying at **6 035 / 6 035**.
3. **Implementation** — logging, timezone/locale, health + metrics, debug mode, watchdog +
   safe mode, update manager, bootstrap token, prompt-injection containment.
4. **Test** — 137 → **317 / 317** passing, plus 48/48 installer hardening and 12/12
   packaging filters (Python half unverifiable here).
5. **HUNT AND FIX** — `noesar-debuglab` started, semgrep / detect-secrets / ruff / bandit /
   shellcheck run over the first-party surface, findings triaged, container stopped again.
6. **Base image** — `docker pull node:22-bookworm-slim`, digest recorded.
7. **Build** — `noesar-evolution:phase3`.
8. **Runtime root** — created, `10001:10001`, `0700`, nothing world-writable.
9. **Network** — `noesar-evolution-net` created; `noesar-local` untouched.
10. **Run** — container started with the full hardening set; `Up (healthy)`.
11. **Verify** — every §11 check; controlled restart; persistence; no crash loop.
12. **Bootstrap** — mechanism verified on the real installation, full flow proven on a
    disposable probe, no Owner account created.
13. **Document, secret-scan, commit.**

## Defects found and repaired in this phase

| # | Defect | Where |
|---|---|---|
| D1 | log rotation overwrote archives inside the same millisecond, losing records | `src/logging.mjs` |
| D2 | `Logger.child()` threw on every call | `src/logging.mjs` |
| D3 | all three installers passed the weakened seccomp profile to Docker | installers |
| D4 | two installers published on `0.0.0.0`, i.e. the whole LAN | Unraid installers |
| D5 | all three installers fail on Docker 29 (`--mount …,rw` invalid) | installers |
| D6 | retrieved document text was injected into the `system` message | `chat-orchestrator.mjs` |
| D7 | the documented bootstrap token file was never read by any code | `server.mjs` |
| D8 | the installer's `TZ` was silently ignored inside the container | `timezone.mjs` |
| D9 | a comment inside a line continuation truncated `docker run` (self-inflicted, caught before commit) | installers |

Full detail, including what was dismissed as a false positive and on what evidence, in
`PHASE_3_IMPLEMENTATION_AND_INSTALL_REPORT.md`.

## Installed state

```text
container   noesar-evolution        running, healthy, RestartCount=0
image       noesar-evolution:phase3 sha256:24dfc492…
base        node:22-bookworm-slim   sha256:6c74791e…
network     noesar-evolution-net    bridge f55f74343e47
port        127.0.0.1:8100 -> 8088  loopback only, LAN probe refused
runtime     /mnt/cachec/NOESAR_EVOLUTION_RUNTIME  10001:10001 0700
health      /livez 200  /readyz ready  /healthz healthy, 17 components, 0 degraded
timezone    Europe/Berlin, tier 4 (installer TZ)
updates     NOTIFY_ONLY, channel offline, no portal configured
owner       NOT created — interactive choice, see OWNER_BOOTSTRAP.md
```

## Host impact

Containers defined 37 → 38, running 0 → 1. Networks 8 → 9. Volumes unchanged. No
pre-existing container, image, network, volume or share was modified.
`noesar-debuglab` was started and stopped within the phase under the one named exception,
and is `Exited (0)` again.

## Not done, and why

PostgreSQL/pgvector, the Rust authority daemon, GPU allocation, external providers, TLS
and any `noesar.com` connectivity are all out of scope for Phase 3 by specification. The
WebUI settings pane for timezone and locale is not built; the server contract it needs is.
No SBOM was generated for the image — no SBOM tool exists on this host.
`--memory-swap` did not take effect: the kernel lacks swap accounting, and the host has
zero swap.

---

# Phase 4 — end-to-end acceptance, remediation, security and rollback

**Executed 2026-07-25. Status `COMPLETED`. `NEXT_PHASE=5_READY`.**

## Pre-flight

| Gate | Result |
|---|---|
| `PHASE_3=COMPLETED`, `NEXT_PHASE=4` | PASS, read from `PROJECT_STATE.json` |
| Working tree clean | PASS, `git status --short` empty at `0a434eb` |
| Container present and healthy | PASS, `noesar-evolution` Up (healthy) on `noesar-evolution:phase3` |
| Product blocker `B001` closed | PASS (vendor completeness / offline build; distinct from project blocker `B-001`, the missing GitHub remote, which remains open) |
| `B-003` closed | PASS (`cc-1.3.0` vendor repair) |
| `MANIFEST.sha256` | PASS, 5630/5630 |
| Delivered test baseline | PASS, 317/317 before any change |

## Backup

`$ARTIFACT_ROOT/backups/phase_4_20260725T111435Z` — tracked HEAD **6058/6058 verified**
(`sha256sum -c`, rc=0) plus the live runtime 7/7, with Docker container, image, network,
volume and port inventories captured before any mutation. A second backup,
`pre_phase4_swap_20260725T121648Z` (7/7 verified), was taken immediately before the
installation was swapped.

## Mutations performed

| Object | Change |
|---|---|
| `noesar-evolution:phase4` | new image, built twice, offline, from the Phase 3 image |
| `noesar-evolution` | stopped, preserved as `noesar-evolution.rollback-phase3-20260725T121648Z`, recreated on `noesar-evolution:phase4` with identical hardening flags |
| `noesar-evolution-probe4` | disposable probe on port 8101, created and **removed** |
| `noesar-debuglab` | started for HUNT AND FIX, **stopped in the same phase** |
| Repository | 7 source files changed, 6 test files added, 6 tool files added, 12 documents written or updated |
| `NOESAR_EVOLUTION_RUNTIME` | untouched by the swap: token fingerprint, state digest and audit count all identical before and after |

Everything else on the host is unchanged, verified by diffing `docker ps -a`,
`docker network ls` and `docker volume ls` against the pre-phase inventories. The only
differences are the phase-4 container and its preserved rollback.

## Results

**136 acceptance checks: 132 PASS, 3 PARTIAL, 1 BLOCKED, 0 FAIL** across five suites —
AUTH 27, WORK 35, SEC 41, SBX 20, REC 13. Unit tests **351/351**, up from the 317 delivered.
Installer hardening regression **48/48**.

**13 findings raised.** Three high (a malformed request terminating the service; streaming
chat non-functional; TOTP replay), three medium, three low, three informational, one
withdrawn as a misdiagnosis. **All high and medium findings fixed with regression tests**;
four low/informational accepted and recorded with reasoning. Full detail in
`docs/OPEN_FINDINGS.tsv` and `docs/REMEDIATION_LOG.md`.

## Standing labels resolved

- `FOSS_CORE_DEPENDS_ON_ATOM=false` — **VERIFIED**, no longer `[UNVERIFIED]`.
- `GPU_RUNTIME=NOT_IMPLEMENTED` — recorded, no GPU allocated.
- `B005=OPEN` — PostgreSQL/pgvector not installed; the runtime fails closed rather than
  substituting SQLite. Blocks production promotion, not Phase 5.
- `B-006=OPEN` — no linter with a `no-undef` rule on this host; two findings of that class
  reached production code.
- Security matrix: 41 requirements, **no BROKEN rows**; six rows corrected to match reality.

## A note on the MANIFEST diff

`MANIFEST.sha256` shows a large diff (~1 293 lines) for a small change. The content change
is exactly 6 refreshed hashes and 15 new entries, 5630 → **5645**; the rest is re-ordering,
because the regeneration sorted paths with `localeCompare` rather than preserving the
delivered order. Verified lossless: **0 entries removed, 15 added, 0 duplicates**, and
`sha256sum -c` passes 5645/5645. Recorded because a reviewer seeing that diff should not have
to wonder.

---

# Phase 4 completion gate — installation

## Image

```text
tag        noesar-evolution:phase4-complete
id         sha256:ec2ac8bd45510c782041ae3970d860faa6f5a5bfe48b0a3f8d4822077c5caa05
dockerfile oci/Dockerfile.phase4-complete
lineage    node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
             -> noesar-evolution:phase3   (preserved, not modified)
             -> noesar-evolution:phase4   (preserved, not modified)
             -> noesar-evolution:phase4-complete
size       824 MB  (730 MB at :phase4; the delta is PostgreSQL 18 and pgvector)
network    required for this build, unlike the Phase 4 overlay — the PostgreSQL 18
           packages are not in the Debian bookworm archive
```

Packages added, each pinned to an exact version:

```text
postgresql-18            18.4-1.pgdg12+1
postgresql-client-18     18.4-1.pgdg12+1
postgresql-18-pgvector   0.8.5-1.pgdg12+1
repository               https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main
signing key              oci/keys/apt.postgresql.org.asc (public)
                         sha256 0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76
```

`create_main_cluster = false` is written before the packages install, so
postgresql-common does not provision a cluster under `/var/lib/postgresql`. This product's
cluster lives under the persistent workspace and is created by the runtime supervisor; a
package-created one would be dead weight inside a read-only root filesystem.

## Installation

```text
timestamp        20260725T142301Z
container        noesar-evolution
previous         renamed to noesar-evolution.rollback-phase4-20260725T142301Z (Exited 0, image :phase4)
also preserved   noesar-evolution.rollback-phase3-20260725T121648Z (Exited 0, image :phase3)
port             127.0.0.1:8100 -> 8088          loopback only
network          noesar-evolution-net            unchanged
mount            /mnt/cachec/NOESAR_EVOLUTION_RUNTIME -> /workspace
restart policy   unless-stopped
```

Hardening, unchanged from Phase 3 and re-verified:

```text
--read-only            --cap-drop ALL          --security-opt no-new-privileges:true
--user 10001:10001     --pids-limit 512        --memory 8g   --cpus 4
--shm-size 64m         tmpfs /run and /tmp with nosuid,nodev,noexec
no Docker socket       no --gpus               no privileged flags
```

## Backups taken before mutation

```text
$ARTIFACT_ROOT/backups/phase4_completion_20260725T131312Z/     6400/6400 files verified
    NOESAR_EVOLUTION (full repository, including .git)
    NOESAR_EVOLUTION_RUNTIME
$ARTIFACT_ROOT/backups/runtime_pre_install_20260725T142301Z/   7/7 files verified
    NOESAR_EVOLUTION_RUNTIME
BACKUPS/phase4c_migrations_20260725T131312Z/    migration 0012 and MIGRATIONS.json
BACKUPS/phase4c_lint_fixes_20260725T131312Z/    every file touched by a lint or redaction fix
BACKUPS/phase4c_docs_20260725T131312Z/          every document rewritten in this gate
```

## Post-install verification

| Check | Result |
|---|---|
| `/livez` | 200 |
| `/readyz` | `ready: true`, no reasons |
| `/healthz` | healthy, 17 components, 0 degraded |
| LAN probe to `192.168.178.100:8100` | refused |
| PostgreSQL | 18.4, pgvector 0.8.5, 16 migrations, 15 RLS tables, `production_ready=true` |
| Time to ready | ~1 s from process start |
| `tools/acceptance/post-install-checks.mjs` | **15/15 PASS** |
| Controlled restart | ready again in 2 s, `RestartCount=0`, clean PostgreSQL shutdown (`clean: true`) |
| Persistence across restart | 16 migrations and 4 backup files intact |
| Rollback | both phase 3 and phase 4 containers preserved, `Exited (0)` |
| Owner account | **not created** — `initialized: false`, by design |

The post-install checks ran from a **sidecar** container sharing the same workspace mount,
not by `docker exec` into the installed container: `docker cp` cannot write into a
read-only root filesystem, and a sidecar reaches the same cluster over the same unix socket
without touching the running product.

## Host impact

`docker ps -a`, `docker network ls` and `docker volume ls` were captured before any
mutation and diffed afterwards.

```text
containers   38 -> 39   (the new phase-4 rollback container)
             the noesar-evolution container's image changed :phase4 -> :phase4-complete
networks     identical
volumes      identical
other 37 containers   untouched, still Exited
```

No pre-existing container, image, network, volume or share was modified or removed.
`noesar-debuglab` was **not** started in this gate.

## MANIFEST.sha256

```text
entries before        5645
hashes corrected        14   (the files this gate modified)
entries appended        32   (the files this gate created)
entries after         5677
verification        5677/5677 OK
```

Two files this gate created are **not** in the manifest: `.githooks/pre-commit` and
`eslint.config.mjs`. Both sit at repository roots the manifest has never covered, and
widening what an integrity manifest describes is a change of meaning, not a bookkeeping
detail. A first attempt appended every tracked file under an already-covered root, which
would have silently added ~102 pre-existing files the manifest deliberately did not list;
that was reverted and the scope restricted to this gate's own additions.

---

## Phase 4 LAN access gate — 2026-07-25

The installation was recreated twice: once to move the publish, once to deploy the fix
that move made necessary. Nothing was reinstalled from scratch, and the runtime root was
never replaced.

```text
before   noesar-evolution:phase4-complete       127.0.0.1:8100->8088
step 1   noesar-evolution:phase4-complete       192.168.178.100:8100->8088
after    noesar-evolution:phase4-complete-lan   192.168.178.100:8100->8088
```

### Backup

`/backups/phase_4_lan_access_20260725T151501Z/`

```text
files hashed                  1886
manifest verification    1886/1886 OK
diff vs live runtime             0 differences (byte-identical)
database dump               113080 bytes, sha256 5632cca8…, 226 TOC entries
0600 modes on secrets      preserved, owner 10001:10001
```

The logical dump was taken while the cluster ran (MVCC-coherent); the physical copy was
taken after a clean shutdown (`postgres.stopped clean:true`, `postmaster.pid` removed),
so it is a consistent data directory rather than a smear across a checkpoint.

### Image

```text
noesar-evolution:phase4-complete-lan   sha256:4e26c950a3d1…
  FROM noesar-evolution:phase4-complete (sha256:52987fbbb7b5…)
  build network   none          pull   disabled
  files changed      2          apt steps   0
```

Two source files, nothing else. Built offline so the OS package set of the audited image
is inherited rather than re-resolved (`D-0053`).

### Containers

```text
created    noesar-evolution                                            :phase4-complete-lan
preserved  noesar-evolution.rollback-lan-phase4complete-20260725T153133Z  :phase4-complete
preserved  noesar-evolution.rollback-phase4-20260725T142301Z              :phase4
preserved  noesar-evolution.rollback-phase3-20260725T121648Z              :phase3
```

`noesar-debuglab` was started for the HUNT AND FIX step and **stopped in the same
phase**, as the cycle requires. Nothing else on this host was touched: `docker network
ls` and `docker volume ls` diff **identical** against the pre-gate inventories, and the
37 unrelated containers are the same set, none started and none removed.

### Verification

```text
LIVEZ 200   READYZ 200   HEALTHZ 200   WEBUI 200
METRICS 401 (was 200)    DIAGNOSTICS 401
AUTH_INITIALIZED false   DATABASE_CONNECTED true
POSTGRESQL 18.4          PGVECTOR 0.8.5          SAFE_MODE false
migrations 16/16         RLS forced 15           audit chain 11 records, 0 broken links
uid 10001  CapEff 0  Seccomp 2  rootfs read-only  1 mount  no docker socket
RestartCount 0           persistence identical across two restarts
```

### Not done

The Owner account was **not** created. `OWNER_BOOTSTRAP=AWAITING_OWNER_INTERACTION`.
The setup token was verified (`db1cf03ef221`, `0600`, `10001:10001`, unused, 7.9 h of
72) and deliberately **not** rotated, because it has not expired.

### MANIFEST

```text
entries before        5677
hashes refreshed         6   (the tracked files this gate modified)
entries appended         5   (the files this gate created)
entries after         5682
verification        5682/5682 OK
removed                  0   duplicates 0
```

Two modified files are **not** in the manifest and were not added:
`INSTALLATION/install-unraid.sh` and `PROJECT_STATE.json` sit at roots the manifest has
never covered.

A first pass appended nine **pre-existing** documents — `SESSION_HANDOFF.md`,
`DECISION_LOG.md`, `OPEN_FINDINGS.tsv` and the rest — because they live under `docs/`,
which is a covered root. That was reverted. They were deliberately never listed: they
change in every phase, and hashing them would make the integrity manifest churn on every
commit and stop meaning anything. This is the same mistake the completion gate recorded
and reverted, made again here from the same reasoning and caught by the same check.

## Phase 4 — WebUI completion (2026-07-25)

Ten sections built, `B-007` closed. Source and verification only up to the deploy step
recorded below.

### Backups taken before any mutation

```text
BACKUPS/webui_pages_20260725T171426Z          7/7 verified (index.html, app.js, styles.css,
                                              qr.js, i18n.js, server.mjs, auth.mjs)
BACKUPS/MANIFEST.sha256.pre_webui_pages_*     the manifest as it stood before refresh
```

Disclosed: the first `MANIFEST.sha256` written inside that backup directory included
itself and therefore could not verify. It was regenerated excluding itself, in the same
step, before anything was changed. The file removed was an artefact created seconds
earlier by the failed step, not project content.

### Verification

```text
browser acceptance     174/174    digest-pinned Puppeteer, disposable probe
unit tests             507/507    488 before; +6 role permissions, +13 markup structure
eslint                 143 files, 0 errors, 0 warnings, 0 no-undef
installer hardening    100/100    unchanged
MANIFEST               5690/5690  5 refreshed, 4 appended, 0 removed, 0 duplicates
```

The ESLint configuration gained one entry, for `tools/browser-e2e.mjs`: it is a Node
program that also carries code destined for the page, and linting it as pure Node
reported six `no-undef` errors on `document` inside `page.evaluate` callbacks — all
correct code. A check that cries wolf is a check people learn to skip, so the rule was
corrected rather than the instances silenced. **Negative control:** a deliberate
undefined identifier was appended to that file, ESLint reported `ESLINT_NO_UNDEF=1`, and
the file was restored byte-identical and re-linted clean.

### HUNT AND FIX

`noesar-debuglab` was started for the scan and **stopped in the same phase**.

```text
apps/webui-static                  1 finding   — false positive, dismissed with evidence
services/reference-control-plane   0 findings
tools                             12 findings  — all pre-existing, out of scope
tools/browser-e2e.mjs, run-browser-e2e.sh      0 findings
```

The dismissal: `semgrep insecure-object-assign` at `app.js:85` is `Object.assign` on a
freshly constructed `Error` with three literal keys. Prototype pollution requires
attacker-controlled keys; there are none. The twelve `tools` hits are subprocess warnings
in two Python files last modified in Phase 1 and untouched here, one of which is the
`F401` already deferred as `D-0039`.

Every defect that mattered was found by execution, not by the scanners — including
`F4W-008`, which had survived a full acceptance phase and a WebUI remediation phase.

### Containers, networks and images

```text
started/stopped   noesar-debuglab                                (analysis only, same phase)
created           noesar-evolution.e2e-probe-<stamp>       x11   all Exited, preserved
created           noesar-evolution.e2e-runner-<stamp>      x11   all Exited, preserved
created           noesar-evolution:webui-e2e-<stamp>       x11   images, preserved
created           noesar-e2e-<stamp> networks              x11   preserved (see D-0066)
created           noesar-e2e-net                                 the stable network from now on
```

Nothing was removed. `docker volume ls` diffs **identical**. No unrelated container was
started, stopped or modified, and the real installation was not driven by any test.

## Container hygiene cleanup — 2026-07-26 (owner-instructed, outside the phase cycle)

**Governance amended:** phase cycle 14 → 15 steps (`CLEAN UP` added between `PUSH` and
`WRITE HANDOFF`); `CLAUDE10.md` gains §5a and carve-outs in rules 12 and 16; `D-0068`
supersedes `D-0066`. Backup taken first:
`BACKUPS/container_hygiene_amendment_20260725T225702Z/`.
Pre-cleanup inventory: `EVIDENCE/docker_inventory_pre_cleanup_20260725T225542Z.txt`.

### Removed

```text
containers  30   11x e2e-probe, 11x e2e-runner, 1x shot, 2x gate probe,
                 3x superseded rollback (phase3, phase4, lan-phase4complete)
image tags  14   12x noesar-evolution:webui-e2e-<stamp>, :webui-probe,
                 :phase4-complete-probe   (4 real images; the rest were tag aliases
                 of :phase4-webui, so untagging freed no layers)
networks    11   noesar-e2e-<stamp>, all with zero attached containers
```

### Kept

```text
container   noesar-evolution                                        running installation
container   noesar-evolution.rollback-lan-webui-20260725T175916Z    :phase4-complete-lan
images      :phase4-webui  :phase4-complete-lan  :phase4-complete  :phase4  :phase3
images      ghcr.io/puppeteer/puppeteer:latest                      e2e harness base
networks    noesar-evolution-net, noesar-e2e-net
```

The three superseded rollback **containers** were removed but their images were not, so
every rollback path recorded above still works — recreate the container from the run
command with the tag named in the relevant phase entry.

### Verification

```text
docker containers   69 -> 39      non-project containers 37 -> 37   unchanged
docker networks     14 -> 3 noesar-*   noesar-local (NOESAR V3) untouched
docker volumes      diff vs pre-cleanup inventory: IDENTICAL
noesar-evolution    running / healthy / RestartCount=0
GET /livez          HTTP 200
GET /readyz         HTTP 200
```

No `prune` command was used at any point; every removal named its targets explicitly. No
container, network or volume belonging to any other project was touched.

## WP-0 and SEC-003 — 2026-07-26

No container was created, started, stopped or removed in this work. The installation
`noesar-evolution` ran untouched throughout on `noesar-evolution:phase4-webui`
(`Up 14 hours (healthy)`, uptime 52116 s at close, `/livez` alive). Docker inventory at
close: 39 containers total, exactly two named `noesar-evolution*` — the installation and
the single kept rollback `noesar-evolution.rollback-lan-webui-20260725T175916Z` — and the
networks `noesar-evolution-net`, `noesar-e2e-net`, `noesar-local` (the last belongs to
NOESAR V3 and was not touched). Nothing to clean up under §5a because nothing transient
was created.

**WP-0.** `NOESAR_EVOLUTION_MASTER_PROJECT_V4.zip` verified at
`c8d536f5f7515c0f7e05436009fe677d3de3721f58281e6fa3b9bf959c33528a`, matching the value
already recorded; extracted to a staging directory outside the repository; internal
`MANIFEST.sha256` verified **120/120**. The 75 files already in `MASTER_REFERENCE/` were
confirmed **byte-identical** rather than assumed. 44 files imported, the two nested
`REFERENCES/*.zip` archives placed in `$ARTIFACT_ROOT/master_spec_nested_archives_<UTC>/`
with checksums that match their tracked sidecars exactly. All 119 tracked files
re-compared after the copy: 119 identical, 0 divergent. Backup taken first at
`BACKUPS/wp0_master_reference_20260726T081821Z/`.

**SEC-003.** Found by writing the test the matrix had always required and nobody had
written; the requirement turned out to be false rather than merely unproven. Three of five
attacks landed against the unfixed code. Fixed by recomputing the plan server-side.
Evidence produced in session: unit suite 507 → **513, 0 failures**; ESLint 147 files,
**0 errors, 0 warnings, 0 no-undef**; heuristic secret scan (declared heuristic — no
gitleaks on this host) over the new file set, no matches beyond the test canary
`test-only-setup-token-not-a-real-secret`; no archive, binary, database or env file
staged. Detail in `D-0069` and `D-0070`.

**Not deployed.** The fix is in the source tree only. The live installation still runs the
image built before it and therefore still serves the vulnerable endpoint. Deployment is an
installation phase and needs the Owner's explicit authorisation.
