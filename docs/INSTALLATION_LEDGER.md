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

## WP-1 · SEC-003 residual — the invariants themselves (2026-07-26)

Source and verification only. **Nothing was deployed, no product container was created,
started or stopped, and the live installation was not touched.**

The previous session closed the forgery half of `SEC-003` and stated plainly that the
other half was open: seven invariants declared, and no enforcement mechanism found for
six of them. This work is that half — the adversarial suite the matrix asks for, one
attempt per invariant, from inside Owner Bypass.

### The attempts, run against the unfixed code first

Each attempt runs from a genuinely elevated session — owner role, real password, an
unreplayed authenticator code — so that the invariant answers rather than the elevation
gate. A suite that is refused one step early proves nothing about invariants.

```text
credential_theft_prevention     write ~/.ssh/authorized_keys      403  held
credential_theft_prevention     write /etc/shadow, both routes    403  held
audit_integrity                 bypass action, then chain verify  ok   held
signed_update_verification      stage an unsigned bundle          4xx  held
destructive_action_confirmation recursive delete + PERSISTENT_FOLDER  201  LANDED
destructive_action_confirmation consentScope "DENY"                    201  LANDED
destructive_action_confirmation consentScope "UNLIMITED_FOREVER"       201  LANDED
malware_prevention              — no mechanism exists to attack
illegal_cyberattack_prevention  — no mechanism exists to attack
physical_harm_prevention        — no mechanism exists to attack
negative control                ordinary bypass write             201  correct
```

Three attacks produced a **stored approval**. The consent scope was copied from the
request onto the approval with no validation of any kind, so the plan's own refusal
option minted an approval, an invented scope was stored verbatim, and a recursive delete
could be granted a standing, reusable licence. Detail and reasoning in `D-0072`.

### What was changed

```text
src/path-auth.mjs        INVARIANT_ENFORCEMENT — each invariant names status + enforcedBy
                         checkConsentScope / isDestructive — the scope is now enforced
src/server.mjs           authorize checks the scope against the RECOMPUTED plan; refusals
                         are appended to the ledger; bootstrap carries the declaration
apps/webui-static/*      the invariant panel renders from the server, not five hardcoded
                         list items that matched neither the code nor each other
tools/browser-e2e.mjs    four checks that the panel is populated and states enforcement
test/coden-invariant-adversarial.test.mjs   the suite above, 11 tests, negative control
```

Deliberately **not** done: no keyword denylist over `commands`. It would let the planner
claim malware and cyberattack prevention it does not perform, and the round-3 experiment
in this repository already showed textual denylists are defeated by any indirection.
`D-0071` records the reasoning.

### Verification — produced in this session

```text
adversarial suite       11/11    5 failing against the unfixed code, 0 after the fix
unit tests             524/524   513 before; +11 this suite; 0 failures
eslint                 148 files, 0 errors, 0 warnings, 0 no-undef
browser acceptance     178/178   174 before; +4 invariant panel, real browser, real box
MANIFEST              5692/5692  7 refreshed, 2 appended, 0 removed, 0 duplicates
static analysis        src/ 0 findings (semgrep, bandit, ruff, detect-secrets)
```

`noesar-debuglab` was started for the hunt step and **stopped again in the same phase**,
as `CLAUDE10.md` §5 requires. Container inventory unchanged at 39 throughout, exactly two
`noesar-evolution*` containers, networks and volumes untouched. The browser suite removed
its own probe, runner and image on exit.

### Findings triaged and dismissed, with the evidence

```text
semgrep insecure-object-assign  app.js:85   FALSE POSITIVE — the target is a freshly
                                            created local Error with three fixed literal
                                            keys; no mass assignment, no redirect.
                                            Pre-existing; this phase's change is at 962+.
bandit/ruff B603 S603 B404      tools/*.py  Pre-existing, files not touched here.
                                            subprocess with hardcoded argv, not untrusted
                                            input.
bandit/ruff B607 S607           tools/*.py  Partial executable path. A real hardening nit,
                                            pre-existing, out of this phase's scope.
ruff F401 sys unused            verify-package.py   Already recorded as D-0039.
```

### MANIFEST drift found on entry

`sha256sum -c MANIFEST.sha256` did **not** pass when this phase opened, though the
handoff reported `5690/5690`. One entry had been stale since s261 and one file created by
s262 was never appended. Both repaired; the manifest now verifies clean. `MASTER_REFERENCE/`
remains outside the manifest's scope — stated, not widened. `D-0074`.

**Not deployed.** Everything above is source-tree only. The live installation still runs
`:phase4-webui`, built before both this work and the s262 fix, and therefore still serves
the forgeable endpoint *and* the unvalidated consent scope. Deployment is an installation
phase and requires the Owner's explicit authorisation.

## WP-1 · OPS-002 — cross-platform installation (2026-07-26)

Source and verification only. **Nothing was deployed, no product container was created,
started or stopped, and the live installation was not touched.**

`OPS-002` is `severity: blocker` in the master acceptance matrix. The hardening regression
covered four scripts, all on the Docker/Unraid path; `deployment/` also carries `linux/`,
`macos/`, `windows/` and `podman/`, and none of those had ever been executed or tested.

### What this host can honestly verify

Linux, with `docker`. No macOS, no Windows, no PowerShell, no `podman`, and rule 45
forbids installing tooling to satisfy a rule. The split is stated up front and is printed
by the tool itself rather than left for a reader to infer from a green result.

```text
EXECUTED   deployment/linux/install-portable.sh    a real install into a pinned temp HOME
EXECUTED   deployment/macos/install-portable.sh    POSIX sh; default path contains a space
EXECUTED   deployment/podman/run.sh                against a podman stub
EXECUTED   deployment/{docker,podman}/build.sh     against stubs
NOT RUN    deployment/windows/*.ps1                structural assertions only
```

### Two defects found, both in the Podman path, both repaired

**`D-0075` — the Podman installer had never installed anything.** `run.sh` referenced
`$RELEASE_CHANNEL` and never assigned it; under `set -eu` that aborts:

```text
deployment/podman/run.sh: line 19: RELEASE_CHANNEL: unbound variable   EXIT=1
podman calls observed: "network inspect noesar-local", and nothing further
```

It died after the network probe and before `podman run`. `bash -n` accepts the file and
could not have caught this — the stub technique could, and did.

**`D-0076` — the Podman build file carried a defect the Docker one had fixed.**
`oci/Containerfile` still health-checked `/healthz` while `oci/Dockerfile` had been
corrected to `/livez`, because `/healthz` and `/readyz` report dependency state and would
restart a live process whenever a dependency was briefly degraded. Propagated, and the
regression now asserts the two files **agree** rather than checking each alone.

### Verification — produced in this session

```text
cross-platform regression   73/73    6 failures against the unfixed files, 0 after
installer hardening        100/100   unchanged, no regression
unit tests                 524/524   unchanged
eslint                     149 files, 0 errors, 0 warnings, 0 no-undef
MANIFEST                  5693/5693  3 refreshed, 1 appended, 0 removed, 0 duplicates
shellcheck                 6 findings, all SC1007, all dismissed (see below)
```

The regression was run against the **unfixed** files first and produced 6 failures naming
both defects; a clean run that has never been shown to fail proves only that it is quiet.

### Findings triaged and dismissed, with the evidence

```text
SC1007 x6        deployment/*, INSTALLATION/*   FALSE POSITIVE — all six are the correct
                 `CDPATH= cd --` idiom, which clears CDPATH for the duration of one cd so
                 that cd cannot print or jump elsewhere. shellcheck reads it as a botched
                 assignment. This exact dismissal is already recorded on this project.
                 No shellcheck code other than SC1007 was reported at -S warning.
Test-Noesar.ps1  asserts $result.status -eq "healthy" and $result.local. VERIFIED CORRECT
                 against the running installation: /healthz returns status "healthy" and
                 local true. Dismissed on evidence rather than on reading.
semgrep/bandit/ruff over deployment/ and INSTALLATION/   0 findings.
```

### Recorded, deliberately not repaired

- `Install-Noesar.ps1` has no equivalent of the `rm -rf "$DESTINATION/noesar"` the Linux
  and macOS installers perform before copying. PowerShell `Copy-Item -Recurse` into an
  existing destination copies the source *into* it, so a reinstall is expected to nest the
  tree. **Not reproduced** — no PowerShell here — so not repaired blind. `D-0077`.
- `Start-Noesar.ps1` sets `NOESAR_RELEASE_CHANNEL="development"` while every other
  platform uses `complete`. Valid, but Windows runs a different channel.
- `Uninstall-Noesar.ps1` removes nothing; it prints two advisory lines.
- `Start-Noesar.ps1` references `REPORTS/BUILD_PREPARATION_V1/03_PATH_DECISIONS.tsv`,
  which this repository does not contain.
- `deployment/podman/run.sh` still uses the bare `rw` field in `--mount`, the form Docker
  29 rejects. Whether Podman accepts it cannot be tested here, so it was left alone rather
  than changed on a guess.

### Disclosed: a write outside PROJECT_ROOT, by me, during the hunt

A first exploratory run of `linux/install-portable.sh` passed only a destination, so
`BIN_DIR` fell back to `$HOME/.local/bin` and the installer wrote a launcher there —
outside `PROJECT_ROOT`, which rule 19 makes read-only. `$HOME/.local/bin` and the launcher
did not exist beforehand and nothing was overwritten; both were removed immediately and
`$HOME/.local` was confirmed to contain only its pre-existing `share/`. The harness now
pins `HOME` and `XDG_BIN_HOME` into a temporary directory so the class cannot recur.
`D-0078`.

### Container use

`noesar-debuglab` was started for the hunt and **stopped again in the same phase**. Two
read-only `docker exec` calls were made into it to reach `shellcheck`, which the HTTP
`kind=code` route does not invoke — declared here because §5 rule 16's exception is worded
around *starting* that container. Nothing was written, and no other container was touched.
Inventory 39 throughout, exactly two `noesar-evolution*`.

**Not deployed.** `OPS-002` remains **OPEN**: four of five platforms are now exercised at
the script level, one platform's scripts have never been run at all, and no installation
was performed on any platform other than this one.

---

## WP-2 — Workflows and the approval queue (2026-07-26)

**Source only. Nothing was deployed and no product container was created, started or
stopped.** The live installation still runs `:phase4-webui`.

### The starting point was a test, and it failed

`/api/v1/bootstrap` advertised `Workflows` in its feature list while no page, no route and
no engine existed. Before building anything,
`test/bootstrap-feature-claims.test.mjs` was written to assert that every advertised feature
has a route behind it, and run against the unmodified code:

```text
# tests 19   # pass 18   # fail 1
error: '"Workflows" is advertised by /api/v1/bootstrap but its route answered 404 —
        the claim is not honoured'
```

That is the honest starting point, and it also established that the other sixteen claims
were already true. The probe map lives in the test rather than beside the feature list on
purpose: kept together, one edit could add a feature and its own proof in the same breath.
Adding a feature to the server now fails this test with "no probe defined".

### What was built

| Requirement (`04_AI_PLATFORM/46`) | Where |
|---|---|
| typed steps | `STEP_TYPES`, five types, each declaring effects and executability |
| retries | per-step `maxAttempts` (clamped 1–5) with per-attempt records |
| compensation | reverse-order over completed steps, on failure **and** cancellation |
| idempotency | `(workflowId, idempotencyKey)`; a repeat returns the first run with 200 |
| timeout | per-step, `timed_out` recorded distinctly from `failed` |
| cancellation | honoured between attempts and while suspended; compensates on the way out |
| human approval | `human_approval` suspends the run; the queue is where it surfaces |
| evidence | append-only sequenced record per run, including failed attempts |
| replay | new run from the run's **definition snapshot**; the original is never mutated |

`01_PRODUCT/11`'s bottom approval strip replaces the static status bar, and is permanent —
it states the count even at zero, because a strip that appears only when something is
pending gives no way to tell "nothing waiting" from "this stopped working". Two destinations
were added, `Workflows` and `Approvals`, with a nav badge carrying the pending count.

Permissions reuse the existing model: `workspace.read` to read, `agent.manage` to define,
run, cancel, replay and decide — the same permission the agent runs already use. The work
plan lists the role model itself as a separate open item and it was **not** quietly changed.

### Verified in this phase

```text
unit tests             600/600   524 before; +76 across five new suites; 0 failures
  bootstrap claims      19/19    1 failed against the unfixed code
  workflow engine       31/31    4 seeded mutations each caught by exactly 1 test
  state migration        9/9     5 failed with the version bumped and no migration
  approval queue        10/10
  interrupted step       7/7     5 failed with the reconciliation removed
eslint                 156 files, 0 errors, 0 warnings, 0 no-undef   (149 before)
browser acceptance    213/213   178 before; +35, real browser, real boxes
installer hardening   100/100   unchanged
cross-platform          0 failures, unchanged
MANIFEST             5700/5700  0 failed, 0 duplicates
static analysis        src/, apps/, tools/ — no new finding
```

Every new suite was run against the unfixed code and **observed failing** first. Where no
"unfixed code" existed — the engine is new — the property was instead seeded with a
deliberate defect and the suite shown to catch it: compensation reversed to forward order,
replay reading the live definition instead of the snapshot, a non-executable step type
allowed to run, and the idempotency check disabled. Each was caught by exactly one test, and
the file was restored and re-verified clean after each.

### Two defects of my own, found and fixed before commit

`fillProjectSelect` did not exist and `toast` takes an options object, not a string — both
written by me while wiring the WebUI, both in code paths a passing test suite would not have
touched. Also `.status-bad` and `.status-warn` were written by the new code and **absent from
the stylesheet**, so a failure would have rendered in ordinary body text: a class the
application sets and the presentation layer does not honour is the same defect shape as a
declared protection nothing enforces. All three fixed; ESLint `no-undef` is what would have
caught the first, and it is the tool `B-006` exists to keep in the loop.

### A defect no scanner could see

`advance()` skipped a step left `running` by a dead process and could report the run
`completed`. Found by reading the engine, fixed, and pinned by a suite that drives the
service directly — there is no route that leaves a step `running`, and there should not be.
`D-0083`.

### Findings triaged and dismissed, with evidence

- `app.js:85 insecure-object-assign` (semgrep, MEDIUM) — pre-existing and already dismissed
  in the previous phase; the target is a freshly created local `Error` with three fixed
  literal keys. Confirmed still pre-existing by checking this phase's backup copy.
- `tools/*.py` `B603`/`B607`/`S603`/`S607` (7 critical, 2 high) — pre-existing, hardcoded
  argv, no untrusted input. `F401 sys` unused is `D-0039`.
- **Evidence for `B-002`, not a dismissal:** the detector was proved to fire before its clean
  result was trusted — a canary outside the repository with `eval()`, a command injection and
  an AWS key was scanned, and semgrep reported the `eval` as CRITICAL. But
  **`detect-secrets` reported 0 findings on a literal `AKIA…` key and a matching
  `aws_secret_access_key` line.** The heuristic secret scan is weaker than its name suggests,
  which strengthens rather than resolves `B-002`. The canary was removed.

### Container use

`noesar-debuglab` was started for the hunt and **stopped again in the same phase**. Three
read-only `docker exec` calls were made into it to read its own route table and endpoint
signature, because its API is undocumented on this host; nothing was written. The browser
acceptance suite created its own disposable probe, runner and image and removed all three on
exit, twice — the suite was re-run after the engine changed, because the first 213/213
described code that no longer existed. Inventory 39 containers throughout, exactly two
`noesar-evolution*`, networks and volumes untouched, live product `livez`/`readyz` 200 and
`/metrics` 401 after the work.

### Not done

`WP-2` also lists passkeys/WebAuthn, OIDC, SAML, SCIM, the six-role model, the seven privacy
states, compliance evidence packs, the Industry Module Framework, ML-BOM and WCAG 2.2 AA.
**None of those were touched.** Workflows and the approval queue were taken first because one
of them was a claim the API already made.

---

## WCAG 2.2 AA — measured, then repaired (2026-07-26)

**Source only. Nothing deployed, no product container created, started or stopped.**

`01_PRODUCT/15` targets WCAG 2.2 AA. The work plan's entry was *"never tested, no evidence
either way"* — the only row of WP-2 in that state rather than simply absent, which is why it
was taken next: cheap to measure now, expensive after WP-3 redraws the interface.

### The measurement, against the untouched interface

`npm run test:accessibility` — a new driver, reusing the existing disposable-probe apparatus
rather than copying 160 lines of container plumbing (`tools/run-browser-e2e.sh` now takes
`NOESAR_E2E_DRIVER`).

```text
FAIL  skip link before the navigation                    2.4.1  — absent
FAIL  visible focus indicator                            2.4.7  — 23 of 783 controls
FAIL  target size 24x24                                  2.5.8  — 18 in views + 1 in chrome
FAIL  contrast minimum                                   1.4.3  — 21 distinct, over 832 measured
FAIL  identity fields declare input purpose              1.3.5  — reauthPassword
FAIL  !important colours neutralised in forced-colors     —     — 6 declarations
FAIL  RTL-ready layout                                   1.3.2  — horizontal overflow
```

### Repaired, each against the criterion that failed

- **2.4.1** a skip link, hidden by clipping (see below), with `#mainContent` as its target.
- **2.4.7** the cause was `.command input{outline:0}` with no replacement — the global search
  box, on all 23 routes. A single `:focus-visible` indicator is now defined for every
  focusable element rather than per control, so a control added later cannot arrive without
  one. 0 of 783 now fail.
- **2.5.8** `.text-button` measured 19px high and `#toolExternal` / `#toolMutative` 13x13.
  Minimum 24px applied to text buttons, checkboxes, radios and the toast close button.
- **1.4.3** white on `linear-gradient(135deg,#3e71ff,#7859ff)` measured **4.19:1** against
  its blue stop. Replaced with `#2f5ae0 -> #6442d6`, measuring **5.74** and **6.38** —
  computed, not eyeballed. Same for the brand mark badge. `.nav-group` measured 2.90 and
  needed to clear the body's radial-gradient stop `#142443`, not just the sidebar colour;
  `#8d9ab0` gives 5.42 there.
- **1.3.5** `autocomplete="current-password"` on `reauthPassword`, the one identity field of
  eight without a token.
- **forced colours** a `@media (forced-colors: active)` block that re-declares the six
  meaning-carrying colours to system colours, at equal specificity and importance, declared
  later so it wins.
- **1.3.2 RTL** six `margin-left:auto` rules replaced with `margin-inline-start`, plus
  direction-aware overrides for the nav indicator, citations border and chat message
  alignment.
- **2.3.3** a `prefers-reduced-motion: reduce` block was added even though the check already
  passed, so a future animation inherits the answer rather than reintroducing the question.

### Result

```text
A11Y_TOTAL=26   A11Y_PASS=26   A11Y_FAIL=0
```

Regression after the visual changes: unit **600/600**, eslint **157 files, 0 errors, 0
no-undef**, browser acceptance **213/213**, MANIFEST **5701/5701, 0 duplicates**.

### Three of the findings were mine, and one was caught by my own audit

Triaged out **before** repairing, because a false positive "fixed" is a real regression for
nothing:

- form fields wrapped in a `<label>` were reported as having no accessible name. They have
  one; the check now defers to the label logic for form fields.
- the audit's sign-in navigated by hash only, which is a same-document navigation, so the
  application never re-read the session it had just been given and every gated route resolved
  to access-denied. Five checks were failing on the harness, not the product.

Found by the audit, in my own new code:

- the skip link I added was hidden with `left:-9999px`. **In RTL that extends the scrollable
  area to 11439px**, so the page then required horizontal scrolling — breaking the very
  criterion the skip link was added to help. Now hidden by clipping. The RTL check was also
  improved to name the outermost offending elements, because `overflow=true` alone cannot be
  acted on without guessing.

And ESLint's `no-undef` objected to a `KeyboardEvent` global, which exposed something worse
than a lint error: that check dispatched a **synthetic** keyboard event, which no browser
translates into an activation, so it would have passed on a button the keyboard cannot
operate. It now presses a real key through the browser's input pipeline. This is the second
time `no-undef` has paid for itself here, which is what `B-006` exists for.

### Declared limits

The audit prints these every run so a clean result is never mistaken for conformance: no real
screen reader (only the accessibility tree), no human judgement of link purpose, heading
meaning or reading order, no cognitive-load or plain-language review, not 1.4.12 text spacing
or 1.4.13 content on hover, not 2.5.7 dragging (no drag interaction exists to test), not
3.2.6 / 3.3.7 across multi-step flows, no time-based media (this build ships none), and
`forced-colors` emulation is refused by this Chromium so only the static stylesheet checks
hold. **WCAG 2.2 AA is therefore measured and materially improved, not certified.**

---

## WP-2 · the local-first privacy indicator (`01_PRODUCT/12`) — 2026-07-26

Source-only. No container was created, started or stopped for this work; the installation on
`192.168.178.100:8100` was not touched and still runs `:phase4-webui`.

### Measured first, against the unmodified code

`services/reference-control-plane/test/privacy-states.test.mjs` was written before any change
and run against the shipped implementation. It measures the three separable claims of the
ten-line specification: seven named states, an external state disclosing eight named
elements, and telemetry off with no user content in licence or update metadata.

```text
# tests 25   # pass 7   # fail 18
```

The seven passes included the four published `EGRESS` conformance vectors, which is why they
are asserted here: the fix had to leave them intact.

Three of the eighteen initial failures were defects in my own harness and were triaged out
**before** anything was repaired — the wrong key for the conformance file (`vectors` for
`cases`), the wrong field on the providers response (`items` for `providers`), and the wrong
verb for granting consent (`POST` for `PUT`). A false positive "fixed" is a real regression
introduced for nothing.

### The sharpest finding was not a missing feature

`REMOTE_MODEL_ACTIVE` was reported by an installation where the remote-model request had
just been **refused**. The state lived in a module-level variable assigned from whatever
egress plan any authenticated caller last evaluated, and it initialised to
`LOCAL_ONLY_VERIFIED` — "verified" — before anything had been verified. `D-0087`.

### What was built

- Seven states, each with a producer the test exercises; a named state nothing can produce is
  decoration, exactly as an advertised feature with no route is a false claim.
- `derivePrivacy()`, computing the state from enabled providers and consented connectors.
  `evaluateEgress()` is kept separate and unchanged, and its published vectors are asserted.
- Eight disclosure elements per external destination, with retention at the destination
  declared unknowable rather than invented (`D-0089`).
- `POST /api/v1/privacy/revoke`, and a disclosure that reports whether **this** caller may
  use it (`D-0091`).
- `updateCheckMetadata()` as the single bounded producer of update metadata, with the
  disclosure derived from its keys (`D-0090`).
- A declared telemetry posture defended by a source-level test (`D-0092`).
- The WebUI now renders the server's verdict. It previously wrote `● Local-only verified`
  into the footer directly from the provider dropdown — a privacy guarantee asserted by a
  `<select>` element.

### One defect of my own, caught by my own test

The first `derivePrivacy` treated any registered external provider as pending. Because
`ProviderGateway.seed()` registers OpenAI, Anthropic and Kimi in every workspace, **a fresh
installation would have reported `EXTERNAL_CONNECTOR_PENDING` for ever and could never once
say `LOCAL_ONLY_VERIFIED`** — a permanent false alarm, which would have made the indicator
worse than none. Fixed, and kept out by both a named unit regression and a real-browser
check. `D-0088`.

Two further defects were mine and both were in the browser harness, not the product: waiting
on a native checkbox's `checked` (true before the round trip completed, so the next click hit
a stale client copy and the UI correctly refused it), then waiting only on the server's
answer (which raced the client's re-render, detaching the node mid-click). The barrier now
marks the node before acting, so it can only clear when a re-render has replaced it.

### Verified

```text
unit tests                600/600 → 627/627   0 failures
  privacy states           30/30    18 of 25 failed against the unfixed code
eslint                    158 files, 0 errors, 0 warnings, 0 no-undef
accessibility              26/26    unchanged with the new markup
browser acceptance        see below, real browser, real box
static analysis           services/ 0 findings; apps/ 1 pre-existing MEDIUM, dismissed
MANIFEST                  see below
```

Five deliberate defects were seeded one at a time and each was caught: any registered
external provider counted as pending, `observed:false` assuming local-only, the metadata
producer spreading its caller's object, the revoke control advertised regardless of
permission, and the indicator stored again from the caller's plan. The three source files
were restored and confirmed byte-identical to their pre-seed copies after every round.

### Dismissed with evidence

`apps/webui-static/app.js:85 insecure-object-assign` (semgrep, MEDIUM) — pre-existing and
dismissed in the two previous phases. Re-confirmed here by diffing line 85 against this
phase's own backup copy: byte-identical, untouched by this work. The target is a freshly
created local `Error` with three fixed literal keys, not a user-controlled assignment.

### Found in the diff review, after the tests were already green

`lastPolicyViolation` was declared and only ever cleared, so `POLICY_VIOLATION_BLOCKED` could
be produced by the pure function and never by the running product. Wired to real refused
external sends — not to refused *plans*, which would hand the indicator back to any caller —
with a 15-minute visibility window and an HTTP-level test. `D-0093`.

### Also dismissed with evidence

`tools/verify-package.py` and `tools/create-rust-build-provenance.py` — `B603`/`B607`/`S603`/
`S607` (bandit/ruff, reported CRITICAL/HIGH by the scanner) and `B404`/`F401`. Pre-existing
and unchanged by this phase, neither file staged. Verified at the flagged lines: every call
uses the argv-list form with no `shell=True` and a fixed command name; the only variable part
is a path from a local `rglob` walk, not untrusted input. `B607` (partial executable path)
is a hardening nit in a developer-side tool. `F401 sys` is `D-0039`.

---

## Deployment · `:phase4-wp2` — 2026-07-26, on the Owner's explicit authorisation

Authorised in session with the words *"autorizzo tutti i fix"*, in direct answer to the
handoff's statement that four fixes were in the source, not in the installation, and that
deployment required explicit authorisation.

### What was verified before anything was stopped

The image is an overlay `FROM noesar-evolution:phase4-webui`, built `--network=none
--pull=false`. Before building, the running image's `/opt/noesar` was hashed against this
repository to establish that the two COPY trees really are the whole delta:

```text
database/       byte-identical  → no new SQL migration is carried
package.json    differs only in developer-side test scripts no runtime path reads
```

After building, the image's contents were hashed against the repository again:

```text
services/reference-control-plane/src/   matches the repository exactly
apps/webui-static/                      matches the repository exactly
```

That matters because it is what connects the deployed artifact to the evidence: this is the
same tree that passed 631 unit tests, 233 real-browser checks and 26/26 accessibility checks
in this session.

### Sequence

1. Image built and content-verified, with the service still running — no downtime yet.
2. `docker stop -t 60`. Clean shutdown confirmed in the log, not assumed:
   `postgres.stopped clean:true`, exit code 0.
3. **Full runtime backup taken with the service stopped**, so the PostgreSQL copy is
   consistent: `BACKUPS/runtime_pre_wp2_deploy_20260726T155330Z/` (75 MB, all 12 directories).
   `state/ai-workspace.json` verified byte-identical to the live file and still
   `"schemaVersion": 1`.
4. Old container renamed aside to `noesar-evolution.rollback-webui-20260726T155330Z`.
5. New container started with the configuration read back from the old one rather than from
   memory: uid 10001, read-only rootfs, `cap-drop ALL`, `no-new-privileges`, pids 512,
   memory 8 GiB, `noesar-evolution-net`, `192.168.178.100:8100->8088`, the same bind mount,
   both `noexec` tmpfs mounts, and the three container-level environment variables that are
   not baked into the image (`NOESAR_BIND_SCOPE`, `NOESAR_BIND_ADDRESS`,
   `NOESAR_ALLOWED_HOSTS`).

### Verified after

```text
state=running  health=healthy  restarts=0  image=noesar-evolution:phase4-wp2
livez 200 · readyz 200 · /metrics 401      LAN hardening preserved
postgres.ready   18.4, pgvector 0.8.5, migrations 16, rls_tables 15, production_ready
data-plane.ready postgresql
owner account    1, role owner — the bootstrapped identity survived
WebUI            / and /app.js 200; the new privacy disclosure markup is served
```

Route existence, tested without credentials by the 401-versus-404 distinction — a route that
exists demands a session, a route that does not answers 404:

```text
GET  /api/v1/workflows            401   (this endpoint answered 404 before the deployment)
GET  /api/v1/approvals            401
POST /api/v1/coden/authorize      401
POST /api/v1/privacy/revoke       401   (new this session)
POST /api/v1/no-such-post-route   404   (the control: 401 above is meaningful)
```

### Stated plainly: what was NOT verified on the live installation

The behaviour of three of the four fixes — the recalculated authorization plan, the consent
scope refusing `DENY`, and the privacy indicator refusing to be repainted — requires an
authenticated Owner session, and these sessions hold no Owner credentials. What is proven on
the live box is that the routes exist and are gated, and that the deployed bytes are
identical to the tree whose behaviour the suites exercised. The end-to-end proof of those
three behaviours **on this installation** is an Owner action, and belongs with the other
gate items only the Owner can close.

### Rollback, and the point at which it gets more expensive

`state/ai-workspace.json` was still `"schemaVersion": 1` after the new build came up healthy,
because a read alone does not rewrite it. **Until the first write, rolling back is just
starting the old container.** After the first write the file is version 2 and every older
image refuses to read it — deliberately, since an older build operating on state whose
invariants it does not know would corrupt quietly rather than fail loudly. From that point
rollback also requires restoring `state/ai-workspace.json` (or the whole directory) from
`BACKUPS/runtime_pre_wp2_deploy_20260726T155330Z/`.

### Cleanup

§5a: exactly two containers survive a phase. The new deployment produced a third, so the
older rollback `noesar-evolution.rollback-lan-webui-20260725T175916Z` was removed — the
**container only**; its image `:phase4-complete-lan` stays on disk, so every rollback path
documented here still works. Networks and volumes diffed against
`EVIDENCE/docker_inventory_pre_cleanup_20260726T155449Z.txt`: unchanged. Non-project
containers: 37 before, 37 after. No `prune` of any kind was used.

---

## 2026-07-26 · Fase 0 · Il nome, e tre difetti che si nascondevano a vicenda

**Nessuna mutazione dell'installazione.** Il container `noesar-evolution` non è stato creato,
avviato, fermato né toccato: resta `running · healthy · RestartCount=0 · :phase4-wp2`, con
`/livez` 200, `/readyz` 200 e `/metrics` 401. Tutto il lavoro è sul sorgente.

### 1 · Il prodotto dichiarava di contenere un altro prodotto

Per istruzione dell'Owner il nome è **CodeN Evolution**, mai un altro. Il nome sbagliato non era
un'etichetta: stava nella **feature list di `/api/v1/bootstrap`**, quindi il prodotto lo
*dichiarava di sé stesso*, e un test certificava quella dichiarazione.

Rinominati insieme la dichiarazione, la sua prova e lo smoke test — 5 occorrenze in 4 file, zero
residui nel codice. Nessuna dipendenza da un altro prodotto è mai esistita: nessuna chiamata di
rete, nessun import, solo il nome.

*Prova:* seminato il nome vecchio nella dichiarazione → `bootstrap-feature-claims` fallisce 2/19.
Ripristinato → 19/19.

### 2 · `verify-source.mjs` falliva su ogni esecuzione, e nascondeva cinque passi

Trovato **eseguendo** `npm run verify` per aggiornare il manifesto — nessuna lettura l'avrebbe
visto, perché il codice è sintatticamente corretto e la sua intenzione è giusta.

Il check leggeva `manifest.migrations.length !== 12`: il **conteggio della release V0.6.0**,
congelato. Quando sono arrivate le migrazioni `0013`-`0016` ha cominciato a lanciare a ogni giro.

**La conseguenza è più grave della causa.** `scripts/test.sh` girava sotto `set -eu` con questo
come **secondo di sette passi**: i **cinque passi successivi non sono mai stati eseguiti** da
quando `0013` è atterrata. Fra questi `auth-http-smoke`, che infatti era rotto a sua volta (§3) e
nessuno poteva accorgersene.

**Riparata l'intenzione, non il numero:** le dodici migrazioni della V0.6.0 devono essere ancora
presenti, **non riordinate e non rimosse**, e il totale è libero di crescere. È strettamente più
forte del controllo precedente e non si rompe aggiungendo una migrazione.

*Prove:* baseline riordinata → spara nominando la posizione; baseline accorciata a 8 → spara
nominando il conteggio; ripristinata → `SOURCE_VERIFY=PASS migrations=16 baseline=12/12 intact`,
file byte-identico.

### 3 · `auth-http-smoke.mjs` era rotto da una riparazione di sicurezza corretta

Usava **lo stesso codice TOTP** per il login e per la ri-autenticazione. Entro un passo da 30
secondi è lo stesso codice, e la difesa contro il replay — corretta, e voluta — lo rifiutava.
Il difetto era nello strumento, non nel prodotto. Ora chiede il codice del **passo successivo**:
diverso, dentro la finestra ±1 del server, e senza dormire 30 secondi.

*Prova:* `AUTH_HTTP_SMOKE=PASS`.

### 4 · Riparata la regola, non solo le istanze

Il difetto che conta non è il numero 12: è che **uno script a sette passi sotto `set -eu`
nasconde l'esistenza di tutto ciò che segue il primo passo non eseguibile**. `scripts/test.sh`
ora nomina ogni passo e chiude con un riepilogo:

```text
STEP unit = PASS            STEP pg-migrations   = UNAVAILABLE (no python3 on this host)
STEP source-verify = PASS   STEP pg-contract     = UNAVAILABLE
STEP auth-smoke = PASS      STEP rust-source     = UNAVAILABLE
                            STEP rust-provenance = UNAVAILABLE
TEST_SUMMARY pass=3 fail=0 unavailable=4
UNAVAILABLE (declared, NOT passed): pg-migrations pg-contract rust-source rust-provenance
```

**Un passo che non può girare è DICHIARATO, mai contato come passato.** I quattro passi Python
restano non eseguibili: `python3` non è su questo host e la regola 45 vieta di installarlo.

*Prova:* seminato un fallimento in `verify-source` → `STEP source-verify = FAIL`,
`fail=1`, **uscita 1**. Ripristinato → `pass=3 fail=0`, uscita 0. Uno script che non può più
fallire sarebbe stato un difetto peggiore di quello riparato.

### Verifiche prodotte in sessione

```text
unit                    631/631   0 falliti
scripts/test.sh         3 PASS · 0 FAIL · 4 UNAVAILABLE dichiarati (prima: si fermava al 2°)
eslint                  158 file · 0 errori · 0 warning · 0 no-undef
MANIFEST              5721/5721   0 falliti · 0 duplicati
difetti seminati        5, ognuno catturato, ogni file ripristinato byte-identico
installazione           intoccata · healthy · RestartCount=0 · livez/readyz 200 · metrics 401
```

---

## 2026-07-27 · Grafica, passo 1: la struttura — NESSUNA INSTALLAZIONE

Fase di sola sorgente. **Nessun container di prodotto è stato creato, avviato o fermato**;
l'installazione viva non è stata toccata e continua a servire `:phase4-wp2`, cioè l'interfaccia a
**ventitré** destinazioni. La struttura a dodici esiste **solo nel sorgente**.

```text
installazione   noesar-evolution · running · healthy · RestartCount=0 · :phase4-wp2
bind            192.168.178.100:8100 -> 8088   (NON loopback: un controllo contro 127.0.0.1
                restituisce 000 e sembra un servizio morto mentre il servizio e sano)
endpoint        livez 200 · readyz 200 · metrics 401 (hardening LAN intatto)
igiene          due soli container noesar-evolution* a fine fase, come impone §5a
                noesar-debuglab avviato per la caccia ai difetti e RIFERMATO nella stessa fase
                sonde e runner e2e rimossi dai loro stessi script, tre giri, nessun residuo
                reti e volumi invariati · 172 righe di inventario in EVIDENCE/
```

### Contenitori usa-e-getta creati e rimossi in questa fase

Tre giri della suite in browser (`tools/run-browser-e2e.sh`), ognuno con la propria sonda, il
proprio runner e la propria immagine overlay, più un giro dell'audit di accessibilità. Tutti
rimossi dal loro stesso script, passati o falliti. Il primo e il secondo giro **hanno fallito** —
è il motivo per cui esistono: 4 fallimenti al primo giro, 7 al secondo (di cui uno era un difetto
reale che avevo introdotto io), 0 al terzo.

### Il deploy resta da autorizzare

Portare questa struttura sull'installazione è una **fase di installazione** e richiede
l'autorizzazione esplicita dell'Owner. Prima va letta la nota sul **costo di rollback dello
schema** (`D-0082`): l'immagine precedente non rilegge un `state/ai-workspace.json` già riscritto
dalla build nuova.

---

## 2026-07-27 · La struttura è INSTALLATA — `:phase4-structure`

**Autorizzazione dell'Owner, esplicita e con un emendamento della regola**: *"è inutile che
prepari e non installi… preferisco che installi e verifichi subito"*. Registrata in
`CLAUDE10.md` **§3a** (`11a…11e`): una fase che cambia il prodotto **installa e verifica nella
stessa fase**. La sezione precedente di questo registro — *«NESSUNA INSTALLAZIONE»* — descriveva
lo stato di poche ore prima ed è **superata da questa**.

### Immagine

`noesar-evolution:phase4-structure`, overlay costruito **offline** (`--network=none
--pull=false`) su `:phase4-wp2`, da `oci/Dockerfile.phase4-structure`. Lignaggio **otto** livelli.

**Contenuto provato, non assunto** — i due alberi copiati sono stati ricalcolati dentro
l'immagine e confrontati con il repository:

```text
apps/webui-static/                       0eb713eb…  = repository
services/reference-control-plane/src/    d25d3657…  = repository
```

È ciò che lega l'artefatto installato alle prove: **questo** è l'albero che ha passato 635 unit,
265 controlli in browser reale e 26/26 di accessibilità in questa sessione.

### Schema — nessun costo di rollback questa volta, e il perché

`AI_STATE_VERSION` è **invariato** rispetto a `:phase4-wp2`. `state/ai-workspace.json` è stato
verificato prima del build, dopo il backup e dopo l'avvio: legge **ancora `"schemaVersion": 1`**,
perché la base non ha mai eseguito la sua prima scrittura. **Finché resta 1, tornare indietro è
solo riavviare il container vecchio.** Il backup completo è stato preso comunque.

### Sequenza

1. Immagine costruita e verificata **a servizio ancora in funzione** — nessun fermo, ancora.
2. `docker stop -t 60`. Arresto pulito **confermato nel log, non assunto**:
   `runtime.stopping signal=SIGTERM`, `postgres.stopped clean:true`, exit code **0**.
3. **Backup completo del runtime a servizio fermo**, così la copia di PostgreSQL è coerente:
   `BACKUPS/runtime_pre_structure_deploy_20260727T090127Z/` — 75 MB, tutte e 12 le directory,
   `state/ai-workspace.json` byte-identico al file vivo e ancora `"schemaVersion": 1`.
4. Container precedente rinominato da parte: `noesar-evolution.rollback-wp2-20260727T090151Z`.
5. Nuovo container avviato con la configurazione **riletta dal container che sostituisce**, non
   dalla memoria. Le tre variabili non incorporate nell'immagine sono state identificate
   diffando l'ambiente dell'immagine contro quello del container, invece di fidarsi di un elenco.

### Verificato dopo

```text
state=running  health=healthy  restarts=0  image=noesar-evolution:phase4-structure
livez 200 · readyz 200 · /metrics 401          hardening LAN preservato
postgres.ready    18.4, pgvector 0.8.5, migrations 16, rls_tables 15, production_ready
identity          projected=1 — l'identità Owner ha superato lo scambio
WebUI             / e /app.js 200, e i byte serviti sono IDENTICI al repository
destinazioni      12 servite: home chat coden coden-tui projects documents knowledge
                  agents workflows models research settings
sezioni           13 nella pagina Impostazioni
```

Parità di hardening confrontata campo per campo contro il container sostituito — rootfs in sola
lettura, `cap-drop ALL`, `no-new-privileges`, pids 512, memoria 8 GiB, uid 10001, rete, bind
`192.168.178.100:8100->8088`, entrambi i tmpfs `noexec`: **dieci campi su dieci identici**.

Esistenza delle rotte, provata senza credenziali con la distinzione 401-contro-404 — una rotta che
esiste pretende una sessione, una che non esiste risponde 404:

```text
GET  /api/v1/workflows            401
GET  /api/v1/approvals            401
GET  /api/v1/privacy              401
POST /api/v1/coden/authorize      401
POST /api/v1/no-such-post-route   404   (il controllo: rende significativi i 401 sopra)
```

### Detto chiaramente: cosa NON è stato verificato sull'installazione viva

**Il comportamento dell'interfaccia non è stato esercitato su questa installazione.** Le suite in
browser creano un Owner e cambiano impostazioni: girano contro una **sonda usa-e-getta**, mai
contro l'installazione (`CLAUDE10.md` §3a, `11e`). Ciò che è provato qui è che i byte serviti sono
**identici** all'albero il cui comportamento le suite hanno esercitato, che il servizio è sano e
che le superfici rispondono. Aprire l'interfaccia con una sessione reale è un'azione dell'Owner.

Restano inoltre **non costruite e dichiarate tali** dentro la build appena installata: la
destinazione *Ricerca* (nessun campo che possa emettere una query, il gate viene prima), il *TUI*,
e le sezioni *Sessioni*, *Aspetto*, *Licenza*.

### Pulizia — §5a

Il nuovo deploy avrebbe prodotto un terzo container, quindi il rollback più vecchio
`noesar-evolution.rollback-webui-20260726T155330Z` è stato rimosso: **il container soltanto**, la
sua immagine `:phase4-webui` resta su disco, quindi ogni percorso di rollback documentato qui
funziona ancora. Sopravvivono esattamente due container: l'installazione e
`noesar-evolution.rollback-wp2-20260727T090151Z`. Reti e volumi diffati contro
`EVIDENCE/docker_inventory_pre_cleanup_20260727T084713Z.txt`: **invariati**. Container non del
progetto: **37 prima, 37 dopo**. Totale invariato a 39. Nessun `prune` di alcun tipo.

### Rollback

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-wp2-20260727T090151Z
```

Nessun ripristino di stato è richiesto **finché** `state/ai-workspace.json` legge
`"schemaVersion": 1`. Da controllare prima di procedere: se legge 2, ripristinare anche
`state/` da `BACKUPS/runtime_pre_structure_deploy_20260727T090127Z/`.

---

## 2026-07-27 · Il layer di token è INSTALLATO — `:phase4-tokens`

Seconda installazione sotto `CLAUDE10.md` §3a (`D-0143`): costruito, installato e verificato nella
stessa fase.

### Immagine

`noesar-evolution:phase4-tokens`, overlay costruito **offline** su `:phase4-structure`, da
`oci/Dockerfile.phase4-tokens`. Lignaggio **nove** livelli. Contenuto ricalcolato dentro
l'immagine e confrontato con il repository: `apps/webui-static/` e
`services/reference-control-plane/src/` **corrispondono entrambi**.

### La verifica che conta: nulla di ciò che si vede è cambiato

```text
fotografia dei colori   prima del refactor  ->  byte esatti installati
superfici                    25
elementi misurati        39.320
firme distinte            6.133
tuple di colore CAMBIATE      0
firme apparse / sparite       0 / 0
sensibilita provata           1 token spostato di 1 unita  ->  29 firme si muovono
```

Non è un'affermazione: è una misura presa da un browser vero, due volte, e con il rilevatore
provato **capace di fallire** prima di fidarsi del suo zero.

### Sequenza — identica a quella dichiarata in §3a, `11c`

1. Immagine costruita e contenuto verificato **a servizio in funzione**.
2. `docker stop -t 60` → `runtime.stopping SIGTERM`, `postgres.stopped clean:true`, exit **0**.
3. Backup completo **a servizio fermo**: `BACKUPS/runtime_pre_tokens_deploy_20260727T092301Z/`
   — 75 MB, 12 directory, `"schemaVersion": 1`.
4. Precedente preservato come `noesar-evolution.rollback-structure-20260727T092301Z`.
5. Nuovo container avviato con la configurazione riletta dal precedente.

### Verificato dopo

```text
state=running  health=healthy  restarts=0  image=noesar-evolution:phase4-tokens
livez 200 · readyz 200 · /metrics 401
postgres.ready    18.4, pgvector 0.8.5, migrations 16, rls_tables 15, production_ready
identity          projected=1
styles.css        200 · 32543 byte · IDENTICO al repository
                  102 token definiti · 0 letterali di colore fuori da :root
hardening         10 campi su 10 identici al container sostituito
schema            "schemaVersion": 1 prima del build, dopo il backup e dopo l'avvio
```

### Pulizia — §5a

Rimosso il container di rollback superato `noesar-evolution.rollback-wp2-20260727T090151Z`; la sua
immagine `:phase4-wp2` resta su disco, quindi il percorso di rollback documentato ieri funziona
ancora. Sopravvivono due container. Reti e volumi **identici**, 37 container non del progetto,
totale 39. Nessun `prune`.

### Rollback

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-structure-20260727T092301Z
```

Nessun ripristino di stato richiesto finché `state/ai-workspace.json` legge `"schemaVersion": 1`.

---

## 2026-07-27 · Nove temi INSTALLATI — `:phase4-themes` · la grafica è completa

Terza installazione della giornata sotto `CLAUDE10.md` §3a. Con questa, i **tre** passi della
grafica che l'Owner aveva vincolato in ordine (`D-0118`) sono costruiti e installati.

### Immagine

`noesar-evolution:phase4-themes`, overlay offline su `:phase4-tokens`, lignaggio **dieci**.
Contenuto ricalcolato dentro l'immagine: `apps/webui-static/` e
`services/reference-control-plane/src/` **corrispondono al repository**.

### La verifica che conta: ogni tema è misurato, non guardato

```text
contrasto            0 fallimenti su 3.825 misure · 9 temi · 5 superfici campionate + shell
                     il tema di default misurato in piu su tutte e 25 le superfici
accessibilita       27/27 (era 26/26: il controllo sui nove temi e nuovo)
tema di default      2 sole tuple di colore cambiate, entrambe volute
                     (marchio e avatar nominano il proprio colore invece di ereditarlo)
matematica colore   11/11 test, ancorati alle definizioni WCAG, su tutta la ruota delle tinte
```

**Il campionamento è dichiarato, non nascosto:** cinque superfici (`home`, `coden`, `workflows`,
`settings/security`, `settings/appearance`) scelte perché fra loro portano l'inventario dei
componenti, più la shell. I temi si scambiano sul posto invece di rinavigare, quindi il controllo
costa cinque caricamenti invece di quarantacinque.

### Sequenza — §3a, `11c`

Immagine costruita a servizio in funzione e contenuto verificato · `docker stop -t 60` con
`postgres.stopped clean:true` e exit **0** · backup completo a servizio fermo
(`BACKUPS/runtime_pre_themes_deploy_20260727T100234Z/`, 75 MB, 12 directory) · precedente
preservato come `noesar-evolution.rollback-tokens-20260727T100234Z` · nuovo container avviato con
la configurazione riletta dal precedente.

### Verificato dopo

```text
state=running  health=healthy  restarts=0  image=noesar-evolution:phase4-themes
livez 200 · readyz 200 · /metrics 401
postgres.ready   18.4, pgvector 0.8.5, migrations 16, rls_tables 15, production_ready
identity         projected=1
styles.css       200 · 50291 byte · IDENTICO al repository · 8 blocchi tema + il default
colour.js        200 · IDENTICO al repository
hardening        10 campi su 10 identici al container sostituito
schema           "schemaVersion": 1 prima del build e dopo l'avvio
```

### Detto chiaramente: cosa NON è verificato

Il **comportamento** dell'interfaccia non è esercitato su questa installazione (§3a, `11e`): le
suite creano un Owner e cambiano impostazioni, quindi girano su una sonda usa-e-getta. Dal vivo è
provato che i byte serviti sono identici all'albero che quelle suite hanno esercitato.

**Nessuno screen reader reale ha partecipato** e `forced-colors` non è emulabile su questo
Chromium: entrambe le cose sono stampate dall'audit a ogni giro nel suo blocco `NOT_TESTED`.

### Pulizia — §5a

Rimosso il container `noesar-evolution.rollback-structure-20260727T092301Z`; la sua immagine resta.
Sopravvivono due container. Reti e volumi **identici**, 37 container non del progetto, totale 39.

### Rollback

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-tokens-20260727T100234Z
```

Nessun ripristino di stato richiesto finché `state/ai-workspace.json` legge `"schemaVersion": 1`.

---

## 2026-07-27 · `:phase4-parts` — le parti che la grafica non copriva

Sessioni con archivio e cestino, dimensione del testo e zoom, RTL riparato alla fonte, istanti con
la zona IANA, la metrica del prodotto, il banco di lavoro e la casella `NON FATTO`.
Decisioni `D-0152…D-0160`. Costruita, installata e verificata **nella stessa fase** (`D-0143`).

### ⚠ Costo di rollback — dichiarato PRIMA, non scoperto dopo (`11d`, `D-0082`)

`AI_STATE_VERSION` passa da **2 a 3**: questa build aggiunge `reviewSamples` e `closures` e
riempie `deletedAt`/`purgeAfter` su ogni conversazione. La migrazione c'è, è testata, e la catena
gira **1 → 3 in una sola lettura** — cosa che conta, perché il workspace installato legge ancora
`"schemaVersion": 1`.

Il costo è a senso unico ed è reale: **appena questa build SCRIVE `state/ai-workspace.json`, ogni
immagine precedente rifiuta di caricarlo**, perché il loro validatore pretende corrispondenza
esatta e un file dal futuro viene rifiutato invece che indovinato. Tornare indietro significa
quindi avviare il container precedente **e ripristinare `state/` dal backup**. Una lettura da sola
non riscrive il file: finché legge `1`, tornare indietro è solo riavviare il vecchio container.

**Verificato prima del build, dopo il backup e dopo l'avvio: legge ancora `1`.**

### Sequenza — §3a, `11c`

Immagine costruita **offline** (`--network=none --pull=false`) e contenuto verificato: sette file
confrontati per SHA-256 fra immagine e repository, **tutti identici** · `docker stop -t 60` con
`postgres.stopped clean:true` ed exit **0** · backup completo **a servizio fermo**
(`BACKUPS/runtime_pre_parts_deploy_20260727T110330Z/`, 75 MB, 12 directory) · precedente preservato
come `noesar-evolution.rollback-themes-20260727T110341Z` · nuovo container avviato con la
configurazione **riletta dal container sostituito**, non dalla memoria.

### Verificato dopo

```text
state=running  health=healthy  restarts=0  image=noesar-evolution:phase4-parts
livez 200 · readyz 200 · /metrics 401 (hardening LAN intatto)
postgres.ready   18.4, pgvector 0.8.5, migrations 16, rls_tables 15, production_ready
identity         projected=1
app.js           IDENTICO al repository
index.html       IDENTICO al repository
styles.css       IDENTICO al repository
rotte nuove      /api/v1/sessions 401 · /metrics/review-time 401 · /closures 401
                 /coden/authorisations 401   (contro 404 su una rotta inesistente)
schema           "schemaVersion": 1 prima del build, dopo il backup e dopo l'avvio
```

Il **401 contro il 404** è la parte che conta: prova che le rotte esistono e sono protette, invece
di provare soltanto che il server risponde.

### Detto chiaramente: cosa NON è verificato

Il **comportamento** dell'interfaccia non è esercitato su questa installazione (§3a, `11e`): le
suite creano un Owner, creano sessioni e ne eliminano, quindi girano contro una sonda usa-e-getta.
Dal vivo è provato che i byte serviti sono **identici** all'albero che quelle suite hanno
esercitato, che il servizio è sano e che le superfici rispondono.

**Nessuno screen reader reale** ha partecipato e `forced-colors` non è emulabile su questo
Chromium — l'audit lo stampa nel proprio blocco `NOT_TESTED` a ogni giro.

### Pulizia — §5a

Rimosso `noesar-evolution.rollback-tokens-20260727T100234Z`; **la sua immagine resta**, quindi il
percorso di rollback documentato in questo registro continua a funzionare. Sopravvivono **due**
container. Reti e volumi **identici** all'inventario preso prima
(`EVIDENCE/docker_inventory_pre_cleanup_20260727T110433Z.txt`), **37** container non del progetto
prima e dopo, **39** in totale. Nessun `prune`. Il container di analisi `noesar-debuglab` è stato
avviato per il passo di caccia e **rifermato nella stessa fase**.

### Rollback

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-themes-20260727T110341Z
```

**Controllare prima `state/ai-workspace.json`.** Se legge ancora `1`, non serve altro. Se legge `3`,
ripristinare anche `state/` da `BACKUPS/runtime_pre_parts_deploy_20260727T110330Z/`, o
`:phase4-themes` rifiuterà di caricare il workspace AI.

---

## 2026-07-27 · `:phase4-home` — la schermata iniziale, installata e verificata

Fase scelta dall'Owner fra le tre aperte. Regola `D-0143`: si costruisce, si installa e si
verifica nella stessa fase.

### Costruzione

```text
immagine    noesar-evolution:phase4-home   (sha256:377f34255ee8…)
dockerfile  oci/Dockerfile.phase4-home     (overlay su :phase4-parts)
build       docker build --network=none --pull=false      → offline, nessuna risoluzione
lignaggio   dodici livelli, dichiarato nel Dockerfile stesso
```

**Contenuto dell'immagine confrontato con l'albero PRIMA di toccare l'installazione**: i sei
file di prima parte estratti dall'immagine sono **byte-identici** al repository
(`app.js`, `index.html`, `styles.css`, `schedule.js`, `home-overview.mjs`, `server.mjs`).

### Sostituzione

```text
stop        docker stop -t 60           → "postgres.stopped clean:true" LETTO NEL LOG, non assunto
backup      BACKUPS/runtime_pre_home_deploy_20260727T121114Z/   75 MB, a servizio FERMO
precedente  noesar-evolution.rollback-parts-20260727T121125Z    preservato, Exited (0)
config      RILETTA dal container sostituito, non dalla memoria
            (bind 192.168.178.100:8100→8088 · uid 10001 · rootfs read-only · cap-drop ALL
             · no-new-privileges · tmpfs noexec · 8 GiB · 512 pid · noesar-evolution-net)
```

### Verifica sull'installazione viva

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-home
endpoint    livez 200 · readyz 200
rotta nuova /api/v1/home → 401 senza sessione, contro 404 di una rotta inesistente
modulo nuovo /schedule.js → 200
byte serviti app.js · index.html · styles.css · schedule.js IDENTICI al repository
stato AI    state/ai-workspace.json legge ancora "schemaVersion": 1
```

**Cosa NON è verificato dal vivo, e va detto.** Il *comportamento* dell'interfaccia non è
esercitato su questa installazione (§3a, `11e`): le suite creano un Owner, creano compiti e
sessioni, quindi girano contro una sonda usa-e-getta. Dal vivo è provato che i byte serviti sono
identici all'albero che quelle suite hanno esercitato, che il servizio è sano, e che la rotta
nuova esiste ed è protetta.

### ⚠ Rollback — nessun costo nuovo

`AI_STATE_VERSION` **non si muove**: resta 3. Nulla in questa fase aggiunge una collezione o un
campo a un record, perché la provenienza mostrata dalla schermata è **derivata** da ciò che i
record già portano. Tornare a `:phase4-parts` è quindi solo riavviare il container preservato:

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-parts-20260727T121125Z
```

Il costo dichiarato da `:phase4-parts` resta valido per conto suo — un'immagine **più vecchia**
di quella rifiuta un workspace scritto a versione 3 — e questa build non lo cambia. Finché
`state/ai-workspace.json` legge `1` (verificato in chiusura) anche quel percorso è aperto.

Per tornare indietro sul **sorgente**: `BACKUPS/home_screen_20260727T113422Z/`.

### Igiene (§5a)

```text
inventario  EVIDENCE/docker_inventory_pre_cleanup_20260727T121214Z.txt
rimosso     noesar-evolution.rollback-themes-20260727T110341Z  (rollback più vecchio)
conservato  l'immagine :phase4-themes resta su disco → il suo percorso di rollback vive
sopravvivono esattamente DUE container noesar-evolution*: il vivo e un solo rollback
non del progetto 37 prima, 37 dopo · reti invariate · volumi invariati · nessun prune
noesar-debuglab avviato per la caccia e RIFERMATO nella stessa fase (Exited 0)
```

---

## 2026-07-27 · `:phase4-healthz` — `B-010` chiuso sull'installazione viva

**Regola `D-0143` / §3a:** costruita, installata e verificata nella stessa fase.

### Cosa cambia

`/healthz` rispondeva **200 senza sessione** e su questo bind LAN era leggibile da **tutta la
sottorete**: versione esatta del prodotto, postura di autorità, versioni di PostgreSQL e pgvector,
inventario dei componenti, canale di aggiornamento e scope di debug attivi.

La fase precedente lo aveva **registrato e lasciato**, motivando che la riparazione tocca tre
installer e il polling dell'update manager. Li tocca — ma **non li rompe**, e questo non era stato
verificato prima di rinviare. Ogni consumatore legge **tre cose**: `status`, `local`, il codice HTTP.

Quindi la rotta è **spaccata**, non autenticata: un `401` lì si legge come servizio morto. Il codice
HTTP resta calcolato dalla salute **piena** anche per chi non può vederla.

### Contenuto dell'immagine confrontato con l'albero PRIMA di toccare l'installazione

I quattro file di prima parte estratti dall'immagine sono **byte-identici** al repository
(`auth.mjs`, `http-security.mjs`, `observability.mjs`, `server.mjs`). `apps/webui-static` **non è
stata ricopiata** — questa fase non la tocca — ed è stato verificato che l'immagine la **eredita**
identica (`app.js` stesso digest del repository).

### Sostituzione

```text
stop        docker stop -t 60           → "postgres.stopped clean:true" LETTO NEL LOG, non assunto
backup      BACKUPS/runtime_pre_healthz_deploy_20260727T130604Z/   75 MB, a servizio FERMO
precedente  noesar-evolution.rollback-home-20260727T130604Z        preservato, Exited (0)
config      RILETTA dal container sostituito (EVIDENCE/live_config_pre_healthz_deploy_*.json),
            non dalla memoria — bind 192.168.178.100:8100→8088 · uid 10001 · rootfs read-only
            · cap-drop ALL · no-new-privileges · tmpfs noexec · 8 GiB · 512 pid
            · noesar-evolution-net · NOESAR_BIND_SCOPE=lan
```

**Nota emersa rileggendo la configurazione:** il healthcheck del container interroga **`/livez`**,
non `/healthz`. La riparazione non poteva quindi toccarlo — cosa che la fase precedente aveva
elencato fra le ragioni per rinviare.

### Verifica sull'installazione viva

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-healthz
endpoint    livez 200 · readyz 200 · metrics 401 · home 401 · diagnostics 401
            rotta inesistente 404 → i 401 sono cancelli veri, non un catch-all
/healthz    200 SENZA sessione, e il corpo NON contiene più nessuno dei sette marcatori:
            versione · reference-node · postgresql · pgvector · releaseChannel · components · 18.4
            il corpo ridotto DICHIARA di esserlo, con ruolo e permesso che servirebbero
contratto   status=healthy AND local=true → Test-Noesar.ps1 e verify-runtime.sh passano ancora
byte serviti app.js · index.html · styles.css · schedule.js IDENTICI al repository
stato AI    state/ai-workspace.json legge ancora "schemaVersion": 1
```

**Cosa NON è verificato dal vivo, e va detto.** Il comportamento dell'interfaccia non è esercitato
su questa installazione (§3a `11e`): le suite creano un Owner e mutano dati, quindi girano contro
una sonda usa-e-getta. Dal vivo è provato che i byte serviti sono identici all'albero che quelle
suite hanno esercitato, che il servizio è sano, che la ridazione è **realmente attiva** su questo
bind, e che il contratto dei consumatori regge.

### ⚠ Rollback — nessun costo nuovo

`AI_STATE_VERSION` **non si muove**: resta 3. Nessun record cambia forma — la riparazione è
interamente nel modo in cui una risposta viene composta. Tornare indietro **reintroduce la
divulgazione**.

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-home-20260727T130604Z
```

Finché `state/ai-workspace.json` legge `1` — verificato in chiusura — restano aperti anche i
percorsi più vecchi. Per tornare indietro sul **sorgente**:
`BACKUPS/healthz_disclosure_20260727T123850Z/` e `BACKUPS/governance_amendment_20260727T125353Z/`.

### Igiene (§5a)

```text
inventario  EVIDENCE/docker_inventory_pre_cleanup_20260727T130708Z.txt
rimosso     noesar-evolution.rollback-parts-20260727T121125Z  (rollback più vecchio, Exited)
conservato  l'immagine :phase4-parts resta su disco → il suo percorso di rollback vive
            dodici tag della genealogia tutti presenti
sopravvivono esattamente DUE container noesar-evolution*: il vivo e un solo rollback
non del progetto 37 prima, 37 dopo · reti IDENTICHE · volumi IDENTICI · nessun prune
container-sonda del confronto immagine: creato e rimosso nello stesso passo
noesar-debuglab avviato per la caccia e RIFERMATO nella stessa fase (Exited 0)
```

## 2026-07-27 · `:phase4-reasoning` — il seam di ragionamento sull'installazione viva

**Regola `D-0143` / §3a:** costruita, installata e verificata nella stessa fase.

### Cosa cambia

Il provider di riferimento gira ora nel prodotto: `GET /api/v1/reasoning` riporta il seam e
`POST /api/v1/reasoning/plan` lo esercita. È questo che rende `FOSS_CORE_DEPENDS_ON_ATOM = false`
una proprietà dell'installazione, non di un crate nel repository. Il crate Rust resta il
**candidato canonico non compilato nell'immagine** — la stessa posizione del daemon di autorità —
e i due lati rispondono allo **stesso** file di vettori.

### Contenuto dell'immagine confrontato con l'albero PRIMA di toccare l'installazione

`server.mjs`, `reasoning.mjs`, `auth.mjs`, `http-security.mjs` **byte-identici** al repository.
`apps/webui-static` non ricopiata — questa fase non la tocca — e verificata **ereditata** identica
(`app.js` stesso digest).

### Sostituzione

```text
build       docker build --network=none --pull=false   FROM :phase4-healthz
stop        docker stop -t 60   → "postgres.stopped clean:true" LETTO NEL LOG, non assunto
backup      BACKUPS/runtime_pre_reasoning_deploy_20260727T163719Z/   75 MB, a servizio FERMO
precedente  noesar-evolution.rollback-healthz-20260727T163719Z       preservato, Exited (0)
config      RILETTA dal container sostituito (EVIDENCE/live_config_pre_reasoning_deploy_*.json):
            192.168.178.100:8100→8088 · uid 10001 · rootfs read-only · cap-drop ALL
            · no-new-privileges · tmpfs noexec · 8 GiB · 512 pid · noesar-evolution-net
            · NOESAR_BIND_SCOPE=lan · healthcheck su /livez
§5a         rimosso il rollback più vecchio (:phase4-home) CONSERVANDONE l'immagine:
            due container di progetto, che è quanto la regola ammette
```

### Verifica sull'installazione viva

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-reasoning
endpoint    livez 200 · readyz 200 · metrics 401 · home 401
            reasoning 401 · reasoning/plan 401 · rotta inesistente 404
            → i 401 sono cancelli veri, non un catch-all
B-010       NON regredito: /healthz 200 senza sessione e ZERO dei sette marcatori
            (reference-node · postgresql · pgvector · releaseChannel · components · 18.4)
byte serviti server.mjs e reasoning.mjs identici al repository
```

**Costo di rollback.** Nessuno nuovo: nessuna migrazione, nessun record cambia forma,
`AI_STATE_VERSION` invariato. Riavviare `noesar-evolution.rollback-healthz-20260727T163719Z`
riporta l'installazione a prima, perdendo **solo** le due rotte del seam.

**Cosa NON è verificato dal vivo, e va detto.** Le due rotte sono esercitate **con una sessione**
solo dall'harness (`AUTH_HTTP_SMOKE`), contro un server effimero: §3a `11e` vieta di far girare
contro questa installazione suite che creano un Owner e mutano dati. Dal vivo è provato che
esistono, che rispondono e che sono **chiuse** a chi non ha sessione.

## 2026-07-27 · `:phase4-capability` — i capability token sull'installazione viva

**Regola `D-0143` / §3a:** costruita, installata e verificata nella stessa fase.

### Cosa cambia

`GET /api/v1/capability`, `POST /api/v1/capability/mint`, `POST /api/v1/capability/spend`.
Un token si conia **solo** da un Piano che qualcuno ha approvato, è legato a **un** passo e non
può nominare un percorso che quel passo non nomina. Coniazioni, spese e **rifiuti** vanno tutti
nel registro di audit: «negato» senza ragione è ciò che rende inutile un audit.

### Contenuto dell'immagine confrontato con l'albero PRIMA di toccare l'installazione

`server.mjs`, `capability.mjs`, `reasoning.mjs` **byte-identici** al repository.

### Sostituzione

```text
build       docker build --network=none --pull=false   FROM :phase4-reasoning
stop        docker stop -t 60   → "postgres.stopped clean:true" LETTO NEL LOG
backup      BACKUPS/runtime_pre_capability_deploy_20260727T165731Z/   75 MB, a servizio FERMO
precedente  noesar-evolution.rollback-reasoning-20260727T165731Z      preservato, Exited (0)
config      RILETTA dal container sostituito (EVIDENCE/live_config_pre_capability_deploy_20260727T165731Z.json)
§5a         rimosso il rollback più vecchio (:phase4-healthz), immagine CONSERVATA
```

### Verifica sull'installazione viva

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-capability
endpoint    livez 200 · readyz 200 · metrics 401 · capability 401 · reasoning 401
            mint senza sessione 401 · rotta inesistente 404 → cancelli veri
B-010       NON regredito: /healthz 200 e ZERO marcatori
```

**Costo di rollback.** Nessuno nuovo: nessuna migrazione, nessun record cambia forma.

**Cosa NON è vero, e va detto.** Il registro dei token vive **in memoria**: un riavvio invalida
ogni token in circolazione — è la direzione sicura, ed è **dichiarata da `capabilityStatus`**
invece di essere scoperta. E **nessun esecutore applica i token**: `executorEnforcesTokens` è
`false` sull'installazione viva, perché l'esecutore è il passo 5 e non esiste. Oggi i token si
coniano e si spendono, ma **nulla viene eseguito attraverso di essi**.

## 2026-07-27 · `:phase4-shadow` — l'esecuzione in ombra sull'installazione viva

**Regola `D-0143` / §3a:** costruita, installata e verificata nella stessa fase.

### Cosa cambia

`GET /api/v1/shadow` e `POST /api/v1/shadow/compare`. Il confronto è **a due lati**, e il
secondo è quello pericoloso: *è successo qualcosa che nessuno aveva dichiarato*. Un'osservazione
vuota è **rifiutata**, non riportata pulita — «nessuna differenza trovata» e «non è stato
guardato niente» producono lo stesso insieme vuoto.

### Sostituzione

```text
build       docker build --network=none --pull=false   FROM :phase4-capability
stop        docker stop -t 60   → "postgres.stopped clean:true" LETTO NEL LOG
backup      BACKUPS/runtime_pre_shadow_deploy_20260727T170916Z/   75 MB, a servizio FERMO
precedente  noesar-evolution.rollback-capability-20260727T170916Z  preservato, Exited (0)
config      RILETTA dal container sostituito (EVIDENCE/live_config_pre_shadow_deploy_20260727T170916Z.json)
§5a         rimosso il rollback più vecchio (:phase4-reasoning), immagine CONSERVATA
byte        server.mjs · shadow.mjs · capability.mjs identici al repository
```

### Verifica sull'installazione viva

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-shadow
endpoint    livez 200 · readyz 200 · metrics 401 · shadow 401 · capability 401
            shadow/compare senza sessione 401 · rotta inesistente 404
B-010       NON regredito: /healthz 200 e ZERO marcatori
```

**Costo di rollback.** Nessuno nuovo.

**Cosa NON è vero, e va detto.** `executesPlans=false`: **nulla esegue un piano dentro l'ombra**.
Oggi l'ombra si costruisce, si osserva e si confronta; chi produce l'osservazione è ancora il
chiamante, e l'esecutore che accetta **solo** un capability token è il passo 5. E non è
copy-on-write: overlayfs e i reflink richiedono privilegi o un filesystem che li supporti, quindi
si copiano **solo i percorsi che il piano nomina** — dichiarato da `shadowStatus`.

## 2026-07-27 · `:phase4-executor` — l'esecutore che accetta solo token

**Regola `D-0143` / §3a:** costruita, installata e verificata nella stessa fase.

### Cosa cambia

L'esecutore (passo 5) e `GET /api/v1/executor`. Ogni azione deve presentare un token del piano
approvato che nomini **il suo percorso e la sua operazione**; il token si spende **prima**
dell'effetto, quindi un rifiuto significa che non è successo nulla. `EXECUTE` è dichiarata e
**sempre rifiutata**: qui non esiste una superficie d'esecuzione, e fingere di eseguire sarebbe
peggio che rifiutare.

**Difetto trovato e riparato mentre si costruiva questo passo.** Il livello capability si fidava
della **dichiarazione** `reachesOutsideWorkspace` invece di guardare i percorsi. Il piano arriva
**dal corpo della richiesta**: un passo che nomina `../etc/passwd` dichiarando il flag a `false`
coniava un token. Ora i percorsi sono ispezionati comunque, **qualunque cosa dichiari il passo**,
su entrambi i lati, con due vettori nuovi (`CAP-011`, `CAP-012`).

### Sostituzione

```text
build       docker build --network=none --pull=false   FROM :phase4-shadow
stop        docker stop -t 60   → "postgres.stopped clean:true" LETTO NEL LOG
backup      BACKUPS/runtime_pre_executor_deploy_20260727T171845Z/   75 MB, a servizio FERMO
precedente  noesar-evolution.rollback-shadow-20260727T171845Z       preservato, Exited (0)
config      RILETTA dal container sostituito (EVIDENCE/live_config_pre_executor_deploy_20260727T171845Z.json)
§5a         rimosso il rollback più vecchio (:phase4-capability), immagine CONSERVATA
byte        server.mjs · executor.mjs · capability.mjs · shadow.mjs identici al repository
```

### Verifica sull'installazione viva

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-executor
endpoint    livez 200 · readyz 200 · metrics 401 · executor 401 · shadow 401 · capability 401
            rotta inesistente 404 → cancelli veri
B-010       NON regredito: /healthz 200 e ZERO marcatori
```

**Costo di rollback.** Nessuno nuovo. ⚠️ Ma il rollback **reintroduce il difetto del flag**:
`:phase4-shadow` conia ancora un token per un percorso fuori dal workspace se il passo lo dichiara
contenuto. Detto qui invece di lasciarlo scoprire.

**Cosa NON è vero, e va detto.** `executorWiredToProductActions=false`: l'esecutore **esiste e
applica i token**, ma **nessuna superficie del prodotto instrada le proprie modifiche attraverso di
lui**. I due fatti sono dichiarati separatamente perché unirli sovrastimerebbe da qualunque parte
si arrotondi. L'esecutore è **riportato, non offerto come superficie**: una corsa richiede piano
approvato, token e ombra, e consegnare l'intera catena a un chiamante HTTP metterebbe la sandbox
dal lato sbagliato del muro per cui esiste.

## 2026-07-27 · `:phase4-events` — il registro causale sull'installazione viva

**Regola `D-0143` / §3a:** costruita, installata e verificata nella stessa fase.

### Cosa cambia

Il registro eventi (passo 6): **correlazione, causazione, catena di digest**. `GET /api/v1/events`
e `GET /api/v1/events/verify` (quest'ultima chiede `audit.read`). Distinto da `AuditLedger`, che
registra *chi ha fatto cosa*: questo registra *cosa ha causato cosa*, così «perché è successo»
si risponde camminando all'indietro invece di leggere un log e indovinare quali righe stiano
insieme.

Tre proprietà, ognuna **rifiutata** invece che riparata: una corsa ha **esattamente un inizio**;
una causa deve **esistere e appartenere alla stessa corsa**; ogni digest copre **quello
precedente**, quindi togliere o riordinare un evento in mezzo rompe tutti i digest successivi.
La verifica **ricalcola l'intera catena** invece di confrontare ogni evento col digest che porta:
un record che garantisce per sé stesso non garantisce nulla.

### Sostituzione

```text
build       docker build --network=none --pull=false   FROM :phase4-executor
stop        docker stop -t 60   → "postgres.stopped clean:true" LETTO NEL LOG
backup      BACKUPS/runtime_pre_events_deploy_20260727T172815Z/   75 MB, a servizio FERMO
precedente  noesar-evolution.rollback-executor-20260727T172815Z   preservato, Exited (0)
config      RILETTA dal container sostituito (EVIDENCE/live_config_pre_events_deploy_20260727T172815Z.json)
§5a         rimosso il rollback più vecchio (:phase4-shadow), immagine CONSERVATA
byte        server.mjs · events.mjs · executor.mjs identici al repository
```

### Verifica sull'installazione viva

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-events
endpoint    livez 200 · readyz 200 · events 401 · events/verify 401 · executor 401
            rotta inesistente 404 → cancelli veri
B-010       NON regredito: /healthz 200 e ZERO marcatori
```

**Costo di rollback.** Nessuno nuovo.

**Cosa NON è vero, e va detto.** `persistsAcrossRestart=false`: il registro vive **in memoria**,
un riavvio lo azzera. E **nessun sottosistema del prodotto vi scrive ancora**: le rotte lo
riportano e lo verificano, ma la catena viva è vuota finché qualcosa non comincia a registrare —
il che è vero, ed è per questo che `chainValid` su una catena vuota va letto come «niente da
contraddire», non come «tutto verificato».

## 2026-07-27 · `:phase4-cow` — l'ombra copy-on-write sull'installazione viva

**Immagine** `noesar-evolution:phase4-cow`, costruita `--network=none --pull=false` da
`oci/Dockerfile.phase4-cow`, `FROM noesar-evolution:phase4-events` (lignaggio quattordici
livelli). Solo il control plane cambia; `apps/webui-static` deliberatamente non ricopiata.

**Byte provati identici all'albero prima di toccare l'installazione**: `shadow.mjs`,
`executor.mjs`, `server.mjs` — `sha256sum` nell'immagine contro `sha256sum` nel repository,
tre su tre IDENTICAL.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo (`BACKUPS/runtime_pre_cow_deploy_20260727T183606Z`, 75 MB)
→ configurazione riletta dal container sostituito
(`EVIDENCE/live_config_pre_cow_deploy_20260727T183606Z.json`) → predecessore preservato come
`noesar-evolution.rollback-events-20260727T183606Z` → avvio.

**Un errore mio nel mezzo, dichiarato** (`D-0187`): il primo avvio ha passato
`--health-cmd` attraverso un `eval` che ne ha spogliato le virgolette. Il container risultava
`Up (unhealthy)` **mentre il servizio era sano** (`/livez` 200, PostgreSQL pronto, control
plane avviato). L'immagine porta già l'healthcheck corretto: fermato pulito
(`postgres.stopped clean:true` di nuovo), rimosso, ricreato **senza override**.

**Verifica dal vivo.** `Up (healthy)`, `RestartCount=0`, `ReadonlyRootfs=true`,
`CapDrop=["ALL"]`, `no-new-privileges`. `/api/v1/shadow` **401** contro **404** di una rotta
inesistente. `/healthz` **200** e `detail.disclosed=false` con ruolo e permesso nominati —
`B-010` non regredito. `AUTH_HTTP_SMOKE=PASS`. Dal vivo:
`MECHANISM=REFLINK_CLONE · copyOnWrite=true · measured=true · coverage=WHOLE_WORKSPACE`.

**§5a**: rimosso il rollback superato `noesar-evolution.rollback-executor-20260727T172815Z`.
Due soli container di progetto. Host invariato: **39 totali, 11 in esecuzione**.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta **3**: tornare a
`:phase4-events` è avviare il container preservato. ⚠️ **Ma reintroduce l'`unexpected`
strutturalmente vuoto**: una run dell'esecutore che tocca un file che nessuno ha dichiarato
tornerebbe a riportarsi pulita.

## 2026-07-28 · `:phase4-repomap` — comprensione minima del repository (fase 1, passo 7)

**Immagine** `noesar-evolution:phase4-repomap`, costruita `--network=none --pull=false` da
`oci/Dockerfile.phase4-repomap`, `FROM noesar-evolution:phase4-cow`. Solo
`services/reference-control-plane/src/` ricopiato (nuovo `repo-map.mjs` + `server.mjs`
modificato, 3 rotte).

**Byte provati identici all'albero**, sia sull'immagine sia sul container vivo dopo l'avvio:
`repo-map.mjs` e `server.mjs`, `sha256sum` immagine/container = `sha256sum` repository, PASS.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** → backup
completo a servizio fermo (`BACKUPS/runtime_pre_repomap_deploy_20260728T012632Z/`, 75 MB) →
configurazione riletta dal container sostituito
(`EVIDENCE/live_config_pre_repomap_deploy_20260728T012632Z.json`) → predecessore preservato
come `noesar-evolution.rollback-cow-20260728T012632Z` → avvio **senza override
`--health-cmd`** (lezione D-0187 applicata: healthcheck letto dall'immagine).

**Verifica dal vivo.** `Up (healthy)` al primo avvio, `restarts=0`. `/livez` 200, `/readyz`
200, `/healthz` invariato (`B-010` non regredito). Le 3 rotte nuove: **401** non autenticato,
**400** su una fuga di percorso (`../../etc`), **200** con dati reali (linguaggi/simboli/
punti-d'ingresso/dipendenze) su una fixture nel workspace.

**§5a**: rimosso il rollback superato `noesar-evolution.rollback-events-20260727T183606Z`.
Due soli container di progetto. Host invariato: **39 totali, 11 in esecuzione**, reti e
volumi diffati identici.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta **3**: tornare a `:phase4-cow`
è avviare il container preservato, nessuna migrazione coinvolta.

## 2026-07-28 · `:phase4-workspace-actions` — la scrittura file da chat, promossa per la prima volta

**Immagine** `noesar-evolution:phase4-workspace-actions`, costruita `--network=none
--pull=false` da `oci/Dockerfile.phase4-workspace-actions`, `FROM
noesar-evolution:phase4-repomap`. Solo `services/reference-control-plane/src/` ricopiato
(nuovo `workspace-actions.mjs` + `server.mjs` modificato, 5 rotte).

**Byte provati identici all'albero**, immagine e container vivo dopo l'avvio: `sha256sum`
di `workspace-actions.mjs` e `server.mjs` = `sha256sum` repository, PASS su entrambi.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** → backup
completo a servizio fermo (`BACKUPS/runtime_pre_workspace_actions_deploy_20260728T015851Z/`,
75 MB) → configurazione riletta dal container sostituito
(`EVIDENCE/live_config_pre_workspace_actions_deploy_20260728T015851Z.json`) → predecessore
preservato come `noesar-evolution.rollback-repomap-20260728T015851Z` → avvio senza override
`--health-cmd`, healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200, `/healthz` invariato (`B-010` non
regredito). Le rotte nuove: **401** non autenticato, **404** su una rotta inesistente. Test
manuale end-to-end sulla candidata pre-deploy (server locale, non l'installazione): piano →
approvazione → file reali scritti/modificati → doppia approvazione rifiutata → restore →
file reali ripristinati → registro eventi valido a 7 eventi incatenati.

**§5a**: rimosso il rollback superato `noesar-evolution.rollback-cow-20260728T012632Z`. Due
soli container di progetto. Host invariato: **39 totali, 11 in esecuzione**, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta **3**: tornare a
`:phase4-repomap` è avviare il container preservato, nessuna migrazione coinvolta. ⚠️ Tornare
indietro perde la wiring D-0190/D-0191: `executorWiredToProductActions` torna a `false`.

## 2026-07-28 · `:phase4-workspace-actions` ricostruita — le dichiarazioni di stato corrette prima del commit

**Trovato dopo il primo deploy, prima di chiudere la fase**: `capability.mjs::capabilityStatus()`
dichiarava ancora `executorWiredToProductActions: false` e `shadow.mjs::shadowStatus()`
`executesPlans: false` — vere fino a `D-0190`, **false da quando `workspace-actions.mjs` è
stato scritto**. Corrette a `true` con motivazione aggiornata; 3 test e 2 righe di
`tools/auth-http-smoke.mjs` che asserivano il valore vecchio, aggiornati e riverificati
(881/881 unit, ESLint 185 file 0 errori, `AUTH_HTTP_SMOKE=PASS`, `HTTP_SMOKE=PASS`).

**Immagine ricostruita sullo stesso tag** (`:phase4-workspace-actions`, nuovo image id),
byte provati identici all'albero corretto su immagine e container vivo. **Sequenza ripetuta
per intero**: `docker stop -t 60` → `postgres.stopped clean:true` letto nel log → backup
(`BACKUPS/runtime_pre_workspace_actions_fix_deploy_20260728T020232Z/`, 75 MB) →
configurazione riletta → predecessore preservato come
`noesar-evolution.rollback-workspace-actions-unfixed-20260728T020232Z` → avvio, healthy al
primo tentativo. `/livez` 200, `/readyz` 200.

**§5a**: rimosso il rollback più vecchio (`:phase4-repomap`); tenuto il predecessore
immediato benché porti le due dichiarazioni stale — un rollback ad esso reintrodurrebbe solo
quelle due righe di stato, non un difetto funzionale, e §5a è meccanica (il più recente,
sempre). Due soli container di progetto.

**Costo di rollback** — nessuno nuovo.

## 2026-07-28 · `:phase4-csrf-hardening` — CSRF assente su plan/approve/reject/restore, trovato dal rigore adversarial e riparato

**Immagine** `noesar-evolution:phase4-csrf-hardening`, costruita `--network=none --pull=false`
da `oci/Dockerfile.phase4-csrf-hardening`, `FROM noesar-evolution:phase4-workspace-actions`.
Solo `server.mjs` ricopiato (2 chiamate a `requireCsrf()` aggiunte, nessun altro cambio).

**Byte provati identici all'albero**, immagine e container vivo dopo l'avvio: `sha256sum` di
`server.mjs` = `sha256sum` repository (`0b31dcec...`), PASS su entrambi.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** → backup
completo a servizio fermo (`BACKUPS/runtime_pre_csrf_hardening_deploy_20260728T060127Z/`,
75 MB) → configurazione riletta dal container sostituito → predecessore preservato come
`noesar-evolution.rollback-workspace-actions-20260728T060127Z` → avvio senza override
`--health-cmd`, healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200, `/healthz` 200 invariato (`B-010` non
regredito). `/api/v1/workspace-actions/plan` **401** non autenticato, rotta mai registrata
**404**. Il fix CSRF stesso è provato dalla suite HTTP contro un server locale byte-identico
(vedi `D-0193`), non ripetuto sull'installazione per rispettare 11e (nessuna suite che muta
dati contro l'installazione viva).

**§5a**: rimosso `noesar-evolution.rollback-workspace-actions-unfixed-20260728T020232Z`. Due
soli container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. ⚠️ Tornare a
`:phase4-workspace-actions` reintroduce la lacuna CSRF su `plan`/`approve`/`reject`/`restore`.

## 2026-07-28 · `:phase4-capability-csrf` — F4-017 chiuso, stessa lacuna su capability/mint e /spend

**Immagine** `noesar-evolution:phase4-capability-csrf`, costruita `--network=none
--pull=false` da `oci/Dockerfile.phase4-capability-csrf`, `FROM
noesar-evolution:phase4-csrf-hardening`. Solo `server.mjs` ricopiato (1 chiamata a
`requireCsrf()` aggiunta sul blocco condiviso mint/spend).

**Byte provati identici all'albero**, immagine e container vivo dopo l'avvio: `sha256sum` di
`server.mjs` = `sha256sum` repository (`c2e46897...`), PASS su entrambi.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** → backup
completo a servizio fermo (`BACKUPS/runtime_pre_capability_csrf_deploy_20260728T061943Z/`,
75 MB) → configurazione riletta dal container sostituito → predecessore preservato come
`noesar-evolution.rollback-csrf-hardening-20260728T061943Z` → avvio senza override
`--health-cmd`, healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200, `/healthz` 200 invariato. `/api/v1/capability`
e `/api/v1/capability/mint` **401** non autenticati, rotta mai registrata **404**. Il fix CSRF
stesso è provato dalla suite HTTP contro un server locale byte-identico (`D-0194`), non
ripetuto sull'installazione viva (11e).

**§5a**: rimosso `noesar-evolution.rollback-workspace-actions-20260728T060127Z`. Due soli
container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. ⚠️ Tornare a
`:phase4-csrf-hardening` reintroduce la lacuna CSRF su `capability/mint` e `/spend`
(`F4-017`).

## 2026-07-28 · `:phase4-tls` — TLS in-process, opzione B accanto al reverse proxy esistente

**Immagine** `noesar-evolution:phase4-tls`, costruita `--network=none --pull=false` da
`oci/Dockerfile.phase4-tls`, `FROM noesar-evolution:phase4-capability-csrf`. Copiati
`server.mjs` (modificato) e `tls.mjs` (nuovo). HEALTHCHECK aggiornato per provare HTTP poi
HTTPS (rejectUnauthorized:false) — nessun modo, a build time, di sapere quale transport una
data installazione configurerà a runtime.

**Byte provati identici all'albero**: `sha256sum` di `server.mjs`+`tls.mjs` nell'immagine
(container usa-e-getta) = `sha256sum` repository, PASS su entrambi. Un secondo controllo
via `docker exec` sul container vivo era ridondante (il container gira dallo stesso tag già
provato) — fatto comunque, dichiarato come deviazione da §5 regola 16 in `D-0198`.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo (`BACKUPS/runtime_pre_tls_deploy_20260728T090314Z/`,
75 MB) → configurazione riletta dal container sostituito (`docker inspect`: Env, Binds,
PortBindings, RestartPolicy, NetworkMode, CapDrop, ReadonlyRootfs) → predecessore
preservato come `noesar-evolution.rollback-capability-csrf-20260728T090314Z` → avvio senza
override `--health-cmd`, healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200, `/healthz` 200 invariato (`B-010` non
regredito). Rotta protetta **401**, rotta inesistente **404**. `runtime.started` porta
`tls_active:false, secure_cookies:false` — nessun certificato fornito, la capacità è
installata ma non accesa. `data-plane.identity-projected projected:1` riconfermato.

**§5a**: rimosso `noesar-evolution.rollback-csrf-hardening-20260728T061943Z`. Due soli
container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. Tornare a
`:phase4-capability-csrf` toglie solo la capacità TLS (mai accesa su questo deploy) — non
regredisce niente che fosse davvero attivo.

## 2026-07-28 · `:phase4-findings` — F4-014/F4-015/F4-016 chiusi, EXECUTE lasciato intatto

**Immagine** `noesar-evolution:phase4-findings`, costruita `--network=none --pull=false` da
`oci/Dockerfile.phase4-findings`, `FROM noesar-evolution:phase4-tls`. Copiati `server.mjs`
(F4-015 cache+reprobe, F4-016 workspace reale) ed `executor.mjs` (F4-014, `'COVERAGE'` →
`'INVALID'` per allinearsi a Rust).

**Byte provati identici all'albero**: `sha256sum` di `server.mjs`+`executor.mjs`
nell'immagine (container usa-e-getta) = `sha256sum` repository, PASS su entrambi.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo (`BACKUPS/runtime_pre_findings_deploy_20260728T095332Z/`,
75 MB) → configurazione riletta dal container sostituito (`docker inspect`) →
predecessore preservato come `noesar-evolution.rollback-tls-20260728T095332Z` → avvio
senza override `--health-cmd`, healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200, `/healthz` 200 invariato (`B-010` non
regredito). `GET /api/v1/shadow` 401, `POST /api/v1/shadow/reprobe` 401, `GET` sulla
stessa rotta reprobe **404** (F4-015 applicato dal vivo — la GET non risponde più su
quella rotta, solo POST). Rotta inesistente 404. `data-plane.identity-projected
projected:1` riconfermato.

**§5a**: rimosso `noesar-evolution.rollback-capability-csrf-20260728T090314Z`. Due soli
container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. Tornare a
`:phase4-tls` reintroduce tutti e tre i reperti (probe su GET, letterale `/workspace`,
mancanza di oracolo condiviso per l'esecutore).

## 2026-07-28 · `:phase4-sector-modules` — Fase 7 passo 27, framework moduli di settore + livelli di fiducia

**Immagine** `noesar-evolution:phase4-sector-modules`, costruita `--network=none
--pull=false` da `oci/Dockerfile.phase4-sector-modules`, `FROM
noesar-evolution:phase4-findings`. Copiati `server.mjs` (3 rotte nuove) e
`sector-modules.mjs` nuovo, più `capabilities/security/trust-level-policy.json`,
`capabilities/security/permission-catalog.json`, `schemas/industry-module-manifest.schema.json`
(mai copiati in nessuna immagine prima d'ora).

**Byte provati identici all'albero**: sha256 dei 5 file nell'immagine (container
usa-e-getta, `--entrypoint node`) = sha256 repository, 5/5 PASS.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo (`BACKUPS/runtime_pre_sector_modules_deploy_20260728T104143Z/`,
75 MB) → configurazione riletta dal container sostituito (`docker inspect`) →
predecessore preservato come `noesar-evolution.rollback-findings-20260728T104143Z` →
avvio senza override, healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200, `/healthz` 200 invariato (`B-010` non
regredito). Le 3 rotte nuove (`GET /api/v1/sector-modules`, `GET .../list`, `POST
.../validate`) `401` non autenticato. Rotta inesistente 404.

**§5a**: rimosso `noesar-evolution.rollback-tls-20260728T095332Z`. Due soli container di
progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. Tornare a
`:phase4-findings` toglie solo le tre rotte nuove; nessuna capacità già in uso regredisce.

## 2026-07-28 · `:phase4-compliance-packs` — Fase 7 passo 28, pacchetti di conformità firmati e datati

**Immagine** `noesar-evolution:phase4-compliance-packs`, costruita `--network=none
--pull=false` da `oci/Dockerfile.phase4-compliance-packs`, `FROM
noesar-evolution:phase4-sector-modules`. Copiati `server.mjs` (3 rotte nuove),
`compliance-packs.mjs` nuovo, `schemas/compliance-pack.schema.json` (mai copiato in
nessuna immagine prima d'ora).

**Byte provati identici all'albero**: sha256 dei 3 file nell'immagine (container
usa-e-getta, `--entrypoint node`) = sha256 repository, 3/3 PASS.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo
(`BACKUPS/runtime_pre_compliance_packs_deploy_20260728T110745Z/`, 75 MB) →
configurazione riletta dal container sostituito → predecessore preservato come
`noesar-evolution.rollback-sector-modules-20260728T110745Z` → avvio senza override,
healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200, `/healthz` 200 invariato (`B-010` non
regredito). Le 3 rotte nuove (`GET /api/v1/compliance-packs`, `GET .../list`, `POST
.../validate`) `401` non autenticato. Rotta inesistente 404. `GET /api/v1/sector-modules`
(passo 27) ancora `401` — non regredito.

**§5a**: rimosso `noesar-evolution.rollback-findings-20260728T104143Z`. Due soli
container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. Tornare a
`:phase4-sector-modules` toglie solo le tre rotte nuove.

## 2026-07-28 · `:phase4-technology-radar` — Fase 7 passo 29, Technology Radar

**Immagine** `noesar-evolution:phase4-technology-radar`, costruita `--network=none
--pull=false` da `oci/Dockerfile.phase4-technology-radar`, `FROM
noesar-evolution:phase4-compliance-packs`. Copiati `server.mjs` (5 rotte nuove),
`technology-radar.mjs` nuovo, `schemas/technology-radar-entry.schema.json` nuovo,
`docs/governance/technology-radar-seed.json` (mai copiato in nessuna immagine prima
d'ora, 15 voci reali).

**Byte provati identici all'albero**: sha256 dei 4 file nell'immagine (container
usa-e-getta, `--entrypoint node`) = sha256 repository, 4/4 PASS.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo
(`BACKUPS/runtime_pre_technology_radar_deploy_20260728T111825Z/`, 75 MB) →
configurazione riletta dal container sostituito → predecessore preservato come
`noesar-evolution.rollback-compliance-packs-20260728T111825Z` → avvio senza override,
healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200. Le 5 rotte nuove `401` non
autenticato. Rotta inesistente 404. Rotte dei passi 27 e 28 ancora `401` — non regredite.

**§5a**: rimosso `noesar-evolution.rollback-sector-modules-20260728T110745Z`. Due soli
container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. Tornare a
`:phase4-compliance-packs` toglie solo le cinque rotte nuove.

## 2026-07-28 · `:phase4-recompute-verifier` — CodeN Evolution passo 9, il verificatore per ricalcolo (cablato)

**Immagine** `noesar-evolution:phase4-recompute-verifier`, costruita `--network=none
--pull=false` da `oci/Dockerfile.phase4-recompute-verifier`, `FROM
noesar-evolution:phase4-oidc-saml-scim`. Copiati `server.mjs` (passa `claims` nel body
di `/api/v1/workspace-actions/plan`), `workspace-actions.mjs` (verifica cablata in
`approve()`), `verification.mjs` nuovo.

**Byte provati identici all'albero**: sha256 dei 3 file nell'immagine (container
usa-e-getta, `--entrypoint node`) = sha256 repository, 3/3 PASS.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo
(`BACKUPS/runtime_pre_recompute_verifier_deploy_20260728T131609Z/`, 75 MB) →
configurazione riletta dal container sostituito → predecessore preservato come
`noesar-evolution.rollback-oidc-saml-scim-20260728T131609Z` → avvio senza override,
healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200. `GET /api/v1/workspace-actions`
`401`. `POST /api/v1/workspace-actions/plan` senza sessione `401`.

**§5a**: rimosso `noesar-evolution.rollback-technology-radar-20260728T113911Z`. Due soli
container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. Tornare a
`:phase4-oidc-saml-scim` toglie solo il ricalcolo delle claim — nessun run già promosso
viene invalidato.

## 2026-07-28 · `:phase4-tool-catalog` — CodeN Evolution passo 10, il catalogo strumenti a carico zero

**Immagine** `noesar-evolution:phase4-tool-catalog`, costruita `--network=none
--pull=false` da `oci/Dockerfile.phase4-tool-catalog`, `FROM
noesar-evolution:phase4-recompute-verifier`. Copiati `server.mjs` (5 rotte nuove),
`tool-catalog.mjs` nuovo, `schemas/tool-catalog-entry.schema.json` nuovo.

**Byte provati identici all'albero**: sha256 dei 3 file nell'immagine (container
usa-e-getta, `--entrypoint node`) = sha256 repository, 3/3 PASS.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo
(`BACKUPS/runtime_pre_tool_catalog_deploy_20260728T142717Z/`, 75 MB) → configurazione
riletta dal container sostituito → predecessore preservato come
`noesar-evolution.rollback-recompute-verifier-20260728T142717Z` → avvio senza override,
healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200. Le 5 rotte nuove `401` non
autenticato. Rotta inesistente 404.

**§5a**: rimosso `noesar-evolution.rollback-oidc-saml-scim-20260728T131609Z`. Due soli
container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3. Il registro strumenti
attivi vive in memoria: tornare a `:phase4-recompute-verifier` non lascia nulla su disco
da disfare.

## 2026-07-28 · `:phase4-oidc-saml-scim` — Fase 7 passo 30, "OIDC, SAML, SCIM" (SCIM cablato, OIDC verifica, SAML dichiarato non costruito)

**Immagine** `noesar-evolution:phase4-oidc-saml-scim`, costruita `--network=none
--pull=false` da `oci/Dockerfile.phase4-oidc-saml-scim`, `FROM
noesar-evolution:phase4-technology-radar`. Copiati `server.mjs` (rotte SCIM+OIDC nuove),
`scim.mjs` nuovo, `oidc.mjs` nuovo.

**Byte provati identici all'albero**: sha256 dei 3 file nell'immagine (container
usa-e-getta, `--entrypoint node`) = sha256 repository, 3/3 PASS.

**Sequenza.** `docker stop -t 60` → **`postgres.stopped clean:true` letto nel log** →
backup completo a servizio fermo
(`BACKUPS/runtime_pre_oidc_saml_scim_deploy_20260728T113911Z/`, 75 MB) → configurazione
riletta dal container sostituito → predecessore preservato come
`noesar-evolution.rollback-technology-radar-20260728T113911Z` → avvio senza override,
healthy al primo tentativo, `restarts=0`.

**Verifica dal vivo.** `/livez` 200, `/readyz` 200. `GET /api/v1/oidc` e `/api/v1/scim`
`401`. `GET /scim/v2/Users` senza token → `401` in **forma RFC 7644**
(`schemas:["urn:ietf:params:scim:api:messages:2.0:Error"]`), confermato dal vivo, non
solo nei test. Rotta inesistente 404. Rotte dei passi 27-29 ancora `401` — non regredite.

**§5a**: rimosso `noesar-evolution.rollback-compliance-packs-20260728T111825Z`. Due soli
container di progetto. Host invariato: 39 totali, 11 in esecuzione, reti invariate.

**Costo di rollback** — nessuno nuovo, `AI_STATE_VERSION` resta 3 (lo store dei token
SCIM vive fuori dall'ai-workspace). Tornare a `:phase4-technology-radar` toglie le rotte
OIDC/SCIM; nessun account SCIM-provisionato sparisce — resta in `UserDirectory`, solo
l'API SCIM per gestirlo sparisce.

## 2026-07-28 · `:phase4-atom-routing` — passo 11, ATOM come secondo provider selezionabile per superficie
- **Costruita** `--network=none --pull=false` da `oci/Dockerfile.phase4-atom-routing`, `FROM noesar-evolution:phase4-tool-catalog`.
- **Byte provati identici all'albero** prima di installare: `server.mjs`, `reasoning-router.mjs`, `atom-client.mjs`.
- **Arresto pulito**: `docker stop -t 60`, `postgres.stopped clean:true` **letto nel log**.
- **Backup a servizio fermo**: `BACKUPS/runtime_pre_atom_routing_20260728T165711Z.tar.gz` (12 MB).
- **Predecessore preservato**: `noesar-evolution.rollback-atom-routing-20260728T165711Z` (`:phase4-tool-catalog`).
- **Configurazione riletta dal container sostituito**, non ricordata: 17 variabili `NOESAR_*`/`NODE_ENV`, stessi bind, porta, rete, restart policy, utente; healthcheck **non sovrascritto** (viene dall'immagine).
- **Verifica dal vivo, ATOM assente**: `running/healthy`, `RestartCount=0`, `/livez` `/readyz` `/healthz` **200**, `GET /api/v1/reasoning` **401** contro **404** di una rotta inesistente.
- **Verifica dal vivo, ATOM presente** (rete e container effimeri, entrambi rimossi): provenienza `interpret=reference, decompose=atom, expect=atom, classify=reference`; endpoint morto → **UNAVAILABLE**, provenienza vuota.
- **Costo di rollback**: nessuna migrazione, `AI_STATE_VERSION` invariato. Tornando indietro si perdono instradamento e provenienza; nessun dato cambia.
- **Pulizia**: `atomd-e2e-*` e `noesar-atom-e2e-*` rimossi; rollback precedente (`:phase4-recompute-verifier`) rimosso — restano i **due** container che §5a ammette.

## 2026-07-28 · `atomd` installato e **selezionato** dal prodotto per `decompose` ed `expect`
- **Nuovo container di progetto: `atomd`** (`atom-evolution:atomd`), sulla rete `noesar-evolution-net`, `restart unless-stopped`, `ReadonlyRootfs=true`, `CapDrop=ALL`, `no-new-privileges`, uid **10002**, `running/healthy`, `RestartCount=0`. **È un terzo container che sopravvive alla fase**, oltre ai due che §5a ammette: è un **componente dell installazione**, non un effimero. Lo rimuoverà la fase che rimuoverà la selezione.
- **Prodotto ricreato** dalla stessa immagine `:phase4-atom-routing` con tre variabili in più: `NOESAR_REASONING_MODE=rust-external`, `NOESAR_RUST_REASONING_ENDPOINT=http://atomd:8410`, `NOESAR_RUST_REASONING_TOKEN` (256 bit, letto da un file `chmod 600` fuori da git). `NOESAR_EXTERNAL_SURFACES` **non impostata** → il difetto: `decompose,expect`.
- **Arresto pulito**: `postgres.stopped clean:true` letto nel log. **Backup a servizio fermo**: `BACKUPS/runtime_pre_atom_selected_20260728T171127Z.tar.gz` (12 MB). **Predecessore preservato**: `noesar-evolution.rollback-atom-selected-20260728T171127Z`.
- **Verifica dal vivo, byte installati contro daemon installato**: il router dentro l immagine, con l ambiente reale del container in esecuzione, sulla rete reale → `mode=rust-external`, `endpoint=http://atomd:8410`, `decompose split=true parts=2`, provenienza `interpret=reference, decompose=atom, expect=atom`.
- **Verifica del modo di guasto**: con `atomd` **fermo**, `expect` → **UNAVAILABLE** con provenienza **vuota**, e il prodotto è rimasto `/livez` `/readyz` **200**. Nessun ripiego silenzioso; `atomd` riavviato e `healthy`.
- ⚠️ **Conseguenza operativa dichiarata**: finché la selezione è attiva, se `atomd` è giù le due superfici instradate rispondono **503**. **Rollback in una riga**: ricreare il prodotto senza le tre variabili — nessuna migrazione, nessun dato coinvolto.
- **Pulizia**: rollback precedente (`:phase4-tool-catalog`) rimosso; inventario in `EVIDENCE/docker_inventory_pre_cleanup_*.txt`.

## 2026-07-28 · `:phase4-atom-acting-path` — il ragionamento raggiunge il percorso che agisce
- **Costruita** `--network=none --pull=false` da `oci/Dockerfile.phase4-atom-acting-path`, `FROM noesar-evolution:phase4-atom-routing`.
- **Byte provati identici all albero** prima di installare: `server.mjs`, `workspace-actions.mjs`, `reasoning-router.mjs`, `reasoning.mjs` — 4/4 `BYTES_EQUAL`.
- **Arresto pulito**: `docker stop -t 60`, `postgres.stopped clean:true` **letto nel log**, non assunto.
- **Backup a servizio fermo**: `BACKUPS/runtime_pre_atom_acting_path_20260728T175658Z.tar.gz` (12 MB).
- **Predecessore preservato**: `noesar-evolution.rollback-atom-acting-path-20260728T175658Z` (`:phase4-atom-routing`).
- **Configurazione riletta dal container sostituito**, non ricordata: **20** variabili `NOESAR_*`/`NODE_ENV`, stesso bind `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME:/workspace`, stessa rete `noesar-evolution-net`, stessa porta `192.168.178.100:8100->8088`, stessa restart policy, stesso uid `10001:10001`; healthcheck **non sovrascritto** (viene dall immagine).
- **Verifica dal vivo**: `running/healthy`, `RestartCount=0`, `/livez` `/readyz` `/healthz` **200**, `/healthz` con `disclosed:false` (`B-010` non regredito), `POST /api/v1/workspace-actions/{id}/simulate` **401** contro **404** di una rotta inesistente.
- **Verifica prima di installare, su coppia effimera** (rete e tre container di prodotto + un `atomd`, tutti rimossi): con ombra condivisa `simulate` **200 `supported:true`** e `expect` risposto da **atom** dentro `plan()`; con `atomd` fermo `plan` **503** e nessuna run creata; senza provider esterno ogni superficie `reference` e `simulate` **`supported:false`**.
- ⚠️ **Limite dichiarato**: il daemon installato **non ha mount** sulla radice delle ombre, quindi un `simulate` instradato **rifiuta**. `NOESAR_SHADOWS_ROOT` esiste perché chiuderlo sia un mount, non un cambio di codice.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato, nessun dato coinvolto. Si perdono instradamento sul percorso che agisce e superficie `simulate`.
- **Pulizia**: 3 container di prodotto effimeri + 1 `atomd` effimero + 1 rete effimera rimossi; rollback precedente (`:phase4-atom-routing` selected) rimosso. Restano **3** container di progetto: installazione, un rollback, e `atomd` (componente dichiarato in `D-0214`). Non di progetto: **37**, invariati. Volumi **25/25** invariati. Inventario in `EVIDENCE/docker_inventory_pre_cleanup_20260728T175002Z.txt`.

## 2026-07-28 · `atomd` reinstallato — regola di attribuzione dei comandi (`A-0019`)
- **Ricostruita** `atom-evolution:atomd` con `tools/build-atomd.sh`; l immagine porta **esattamente** il binario costruito (verifica dello script: `OK ... 35ced410...`).
- **Arresto** `docker stop -t 30`; **predecessore preservato** come `atomd.rollback-pre-attribution-20260728*`.
- **Configurazione riletta dal container sostituito**: stessa rete `noesar-evolution-net`, stesso token, stesso bind `0.0.0.0:8410`, `ReadonlyRootfs`, `CapDrop=ALL`, `no-new-privileges`, uid **10002**. Nessun mount, come prima.
- **Verifica dal vivo**: `running/healthy`, e la **misura rifatta** contro il daemon installato: `EXTERNAL_SETTLED` **42/52 → 52/52**, `better=51 worse=0 equal=1`, riferimento **1/52**.
- ⚠️ **Quarto container di progetto dichiarato**: `atomd.rollback-pre-attribution-*`. Il tag `atom-evolution:atomd` è stato **riusato**, quindi l immagine precedente non ha più un nome: quel container fermo **è** il percorso di rollback. Lo rimuoverà la fase che dichiarerà la regola di attribuzione stabile.
- **Costo di rollback**: tornare indietro reintroduce le parti a due comandi (71 su 60 compiti reali). Nessuna migrazione, nessun dato.

## 2026-07-29 · `atomd` reinstallato + `:phase4-research-gate` — il gate UI-090 su entrambi i lati
- **`atomd` ricostruito** con `tools/build-atomd.sh` (binario verificato uguale all immagine). Predecessore
  preservato `atomd.rollback-pre-research-gate-20260729T054159Z`; `atomd.rollback-pre-attribution-*` rimosso
  (un solo rollback per convenzione). Config riletta e invariata (rete, token, bind, uid 10002, nessun mount).
- **Prodotto**: `:phase4-research-gate` da `Dockerfile.phase4-research-gate` (`FROM :phase4-atom-acting-path`,
  `--network=none --pull=false`). Byte immagine == albero per `server.mjs`+`research-gate.mjs`, prima e dopo.
- **Arresto pulito**: `docker stop -t 60`, `postgres.stopped clean:true` letto nel log. Backup a servizio fermo
  `BACKUPS/runtime_pre_research_gate_20260729T055824Z.tar.gz` (12 MB). Predecessore preservato
  `noesar-evolution.rollback-research-gate-20260729T055824Z`; `.rollback-atom-acting-path-*` rimosso.
- **Configurazione riletta dal container sostituito**: 20 variabili invariate, stesso bind, rete, porta,
  restart policy, uid 10001:10001.
- **Verifica dal vivo**: `Up (healthy)`, `RestartCount=0`, `/livez` `/readyz` **200**, `/healthz` `disclosed:false`
  (`B-010` non regredito), `GET/POST /api/v1/research/gate` **401** contro **404** di una rotta inesistente,
  byte serviti == albero (letti dal container, non assunti).
- **Misura sul daemon installato**: 21 casi held-out via HTTP reale → **20/21 (95.2%)**, 8/8 rifiuti con categoria.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato, la rotta non persiste dati.
- **§5a**: due soli container per progetto (installazione+1 rollback) su entrambi i lati. Host invariato.

## 2026-07-29 · `:phase4-atom-all-surfaces` + `atomd` con sessioni — ATOM risponde su tutte e dodici
- **Radice delle ombre condivisa creata**: host `/mnt/cachec/NOESAR_EVOLUTION_SHADOWS`, `10001:10002`, `2750` (setgid).
  Scrittura uid 10001, reflink `COPYFILE_FICLONE_FORCE` e lettura uid 10002 **provate in container prima del deploy**.
  Fuori da `/workspace` per costruzione (l'orchestratore rifiuta una radice annidata nell'albero che ombreggia); XFS, quindi il reflink è reale.
- **`atomd` ricostruito** (`tools/build-atomd.sh`, binario verificato uguale all'immagine) con registro di sessioni:
  `x-atom-session` come header di trasporto, cap `MAX_RECORDED_SESSIONS=64`, sfratto del più vecchio, e una sessione
  sfrattata riceve un rifiuto che **dice di essere stata sfrattata** invece di sembrare vuota. Mount `/shadows:ro`.
  Predecessore preservato: `atomd.rollback-pre-sessions-20260729T072209Z`.
- **Prodotto**: `:phase4-atom-all-surfaces` da `Dockerfile.phase4-atom-all-surfaces` (`FROM :phase4-research-gate`,
  `--network=none --pull=false`). Byte immagine == albero 2/2. Arresto pulito con `postgres.stopped clean:true` letto
  nel log, backup a servizio fermo (12 MB), predecessore preservato `noesar-evolution.rollback-all-surfaces-20260729T072501Z`.
  Configurazione riletta dal container sostituito + `NOESAR_SHADOWS_ROOT=/shadows`, `/shadows` rw, e le 12 superfici.
- **Verifica dal vivo**: `Up (healthy)`, `RestartCount=0`, `/livez` `/readyz` `/healthz` **200**, `/healthz` `disclosed:false`
  (`B-010` non regredito), `/api/v1/reasoning` **401**.
- **Misura coi byte INSTALLATI contro il daemon INSTALLATO**: `ANSWERED=12/12`, `ROUTED_TO_ATOM=12/12`.
  `simulate` predice davvero (`modify existing.txt` vs `create brand-new.txt`, distinti leggendo l'ombra). `fixtures`
  restituisce un pacchetto con digest.
- **Modo di guasto verificato**: daemon irraggiungibile → **12/12 `UNAVAILABLE`, zero fallback** al provider di riferimento.
- ⚠ **Conseguenza operativa**: con 12 superfici instradate, `atomd` giù fa rispondere **503 a tutte e dodici** invece che a tre.
  È la regola "nessun ripiego silenzioso" che funziona, ma il raggio è più ampio. **Rollback in una riga**: ricreare il
  prodotto senza `NOESAR_EXTERNAL_SURFACES`.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato, nessun dato toccato.
- **§5a**: due container di progetto per lato (installazione + un rollback). Ombra di prova rimossa, radice condivisa vuota.

## 2026-07-29 · `:phase4-workspace-actions-ui` — il workbench parla con il proprio motore
- **Tag**: `noesar-evolution:phase4-workspace-actions-ui`, `FROM noesar-evolution:phase4-atom-all-surfaces`, solo `apps/webui-static/` copiato.
- **Cosa cambia**: Plan/Shadow run/Diff nel workbench CodeN Evolution ora chiamano `/api/v1/workspace-actions/{plan,simulate,approve,reject,restore}` invece di mostrare testo statico "no execution surface". Nessuna route server nuova, nessun file server toccato.
- **Sequenza §3a**: build offline (`--network=none --pull=false`) → bytes immagine provati identici all'albero (`docker cp`+`diff -rq`) → stop `-t 60` con `postgres.stopped clean:true` letto nel log → backup runtime a servizio fermo (12.4 MB, `BACKUPS/runtime.20260729T134008Z.tar.gz`) → predecessore rinominato `noesar-evolution.rollback-workspace-actions-ui-20260729T134008Z` → avviato con la configurazione riletta dal container sostituito (env/mount/porta/rete identici) → verificato dal vivo.
- **Verifica dal vivo**: `Up (healthy)`, `RestartCount=0`, `/livez`+`/readyz` 200, `/api/v1/shadow` e `/api/v1/workspace-actions` 401 (gated) contro `/api/v1/does-not-exist` 404, markup servito contiene `id="planGoal"`/`planForm`/`shadowRunContent`/`diffContent`.
- **§5a**: due container di progetto (installazione + un rollback, il più recente). Rollback precedente `rollback-all-surfaces-20260729T072501Z` rimosso (era `Exited`, mai `Up`); la sua immagine resta su disco. Reti (10) e volumi (28) invariati prima/dopo.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato, nessuna route rimossa. Tornare a `:phase4-atom-all-surfaces` reintroduce solo la dicitura stale sulle tre superfici.

## 2026-07-29 · `:phase4-workspace-actions-panels` — il resto del workbench, e un bug reale
- **Tag**: `noesar-evolution:phase4-workspace-actions-panels`, `FROM noesar-evolution:phase4-workspace-actions-ui`, `apps/webui-static/` + `services/reference-control-plane/src/` copiati.
- **Cosa cambia**: Map/Problems/Editor/Preview/Logs del workbench cablati (vedi `D-0230`). Nuova route `GET /api/v1/events/:correlationId` in `server.mjs`.
- **Bug reale trovato e riparato nella stessa fase**: `executor.mjs` restituisce `performed`/`refused` come conteggi numerici, non array — il codice iniziale trattava `0` con `?? []` (non sostituisce un valore definito) e iterava su di esso, lanciando "0 is not iterable" al primo run pulito. Il browser E2E lo ha fatto FALLIRE (2/325) prima della riparazione.
- **Sequenza §3a**: build offline → byte immagine (entrambe le directory) provati identici all'albero → stop `-t 60` con `postgres.stopped clean:true` nel log → backup runtime (12.4 MB) → predecessore rinominato `noesar-evolution.rollback-workspace-actions-panels-20260729T141027Z` → avviato con la stessa configurazione riletta in precedenza → verificato dal vivo.
- **Verifica dal vivo**: `Up (healthy)`, `RestartCount=0`, `/livez`+`/readyz` 200, `/api/v1/events/:id` e `/api/v1/repo-map/scan` 401 (gated), markup con `mapScanBtn`/`editorContent`/`previewContent`/`problemsContent`/`workLogsContent`.
- **§5a**: due container di progetto (installazione + un rollback, il più recente). Rollback precedente `rollback-workspace-actions-ui-20260729T134008Z` rimosso (era `Exited`), immagine intatta su disco. Reti (10) e volumi (28) invariati.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato. Tornare a `:phase4-workspace-actions-ui` toglie solo Map/Problems/Editor/Preview/Logs e la nuova route eventi; Plan/Shadow/Diff restano invariati.

## 2026-07-29 · `:phase4-session-protocol` — la CodeN Evolution TUI, un vero terminale
- **Tag**: `noesar-evolution:phase4-session-protocol`, `FROM noesar-evolution:phase4-workspace-actions-panels`, `apps/webui-static/` + `services/reference-control-plane/src/` copiati.
- **Cosa cambia**: nuovo `session-protocol.mjs` (unix socket a `/workspace/tui.sock`, visibile sull'host a `NOESAR_EVOLUTION_RUNTIME/tui.sock`) + nuova route `POST /api/v1/tui/command` (bridge HTTP) + tab Terminal del workbench cablato + nuovo `tools/tui-client.mjs` (CLI reale, host-side, non nell'immagine). Nessuna route esistente tolta.
- **2 bug riparati nella stessa fase**: hang di `readline.question()` su stdin in pipe (fix `LineReader`); colore letterale `#fff` nel CSS del Preview (fix token `var(--surface-code)`, seeded-defect-proof tornato 19/19 da 6/19).
- **Sequenza §3a**: build offline → byte immagine (entrambe le directory) provati identici all'albero → stop `-t 60` con `postgres.stopped clean:true` nel log → backup runtime (12.4 MB) → predecessore rinominato `noesar-evolution.rollback-session-protocol-20260729T150250Z` → avviato con la configurazione riletta → verificato dal vivo.
- **Verifica dal vivo**: `Up (healthy)`, `RestartCount=0`, `/livez`+`/readyz` 200, `/api/v1/tui/command` 401 (gated), socket `tui.sock` presente con permessi `0600` proprietario `10001:10001`, markup con `terminalCommandInput`/`terminalCommandForm` in `app.js` servito, badge "SESSION PROTOCOL BUILT" nella pagina CodeN Evolution TUI.
- **§5a**: due container di progetto (installazione + un rollback, il più recente). Rollback precedente `rollback-workspace-actions-panels-20260729T141027Z` rimosso (era `Exited`), immagine intatta su disco. Reti (10) e volumi (29) invariati prima/dopo.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato. Tornare a `:phase4-workspace-actions-panels` toglie solo il socket/bridge/tab Terminal; Plan/Shadow/Diff/Editor/Preview/Problems/Logs/Map restano invariati.

## 2026-07-29 · `:phase4-supervisor` — ARCH-001: noesar-supervisord diventa PID 1
- **Tag**: `noesar-evolution:phase4-supervisor`, `FROM noesar-evolution:phase4-panel-draggable`. Nuovo stage builder `rust:1-bookworm` (offline, `RUSTUP_TOOLCHAIN` pinnato) che compila `rust/crates/noesar-supervisor` (`noesar-supervisord`, primo binario Rust MAI incluso in questa immagine — prima solo testato offline, mai copiato dentro), più `services/reference-control-plane/` ricopiato (nuovo `bin/postgres-child.mjs`, `postgres-supervisor.mjs` esteso con la modalità peer).
- **Cosa cambia**: `ENTRYPOINT` passa da `node server.mjs` a `/opt/noesar/bin/noesar-supervisord`, che spawna `postgres` (`bin/postgres-child.mjs`) e `api` (`server.mjs`, `NOESAR_POSTGRES_PEER_MODE=1`) come due figli **realmente pari**, non più uno annidato nell'altro. `codev` resta assente come terzo figlio (dettaglio in `D-0240`).
- **Verificato PRIMA del deploy, in un container usa-e-getta separato**: albero processi da `/proc` (postgres e api entrambi `ppid=1`), `kill -9` su ciascun figlio (l'altro resta `Up`, dati mai persi), `docker stop -t 60` pulito (0.157s, `postgres.stopped clean:true`), un solo socket `LISTEN` (8088) in `/proc/net/tcp`.
- **Sequenza §3a**: build `--network=none --pull=false` → verifica isolata (sopra) → stop `-t 60` sul vivo con `postgres.stopped clean:true` LETTO NEL LOG → backup runtime (75 MB, `BACKUPS/runtime_pre_supervisor_deploy_20260729T232340Z/`) → predecessore rinominato `noesar-evolution.rollback-supervisor-20260729T232340Z` → avviato con la configurazione **riletta dal container sostituito** (rete, porta, mount, tutte le env NOESAR_*) → verificato dal vivo.
- **Verifica dal vivo**: `Up (healthy)`, `RestartCount=0`, `/livez` e `/readyz` 200 (`ready:true`), dati preesistenti intatti (16 migrazioni già applicate, non rieseguite; `data-plane.identity-projected: projected:1` — l'identità reale precedente, non un DB vuoto), albero processi confermato via `docker exec` diretto su `/proc` (nessun `ps` nell'immagine slim).
- **Regressione trovata e NON toccata in questa fase**: `docker inspect` sul container PRIMA della sostituzione mostrava `ReadonlyRootfs:false`/`CapDrop:null`, contro `INST-004` registrato `✅` con "rootfs read-only · cap-drop ALL · no-new-privileges · tmpfs noexec" in più voci precedenti di questo stesso file. Non ripristinato qui (mescolare due cambi di rischio non verificati singolarmente sarebbe stato scorretto) — nuovo finding aperto, dettaglio in `D-0240`.
- **§5a**: due container di progetto (installazione + un rollback, il più recente). Rollback precedente `rollback-panel-drag-20260729T183818Z` rimosso (era `Exited`, mai `Up`, rimosso solo DOPO la conferma di salute del nuovo container), immagine intatta su disco.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato. Tornare a `:phase4-panel-draggable` ripristina la topologia a processo singolo (postgres annidato in api) — la verifica dal vivo di ARCH-002/003 non varrebbe più, dichiarato invece di nascosto.

## 2026-07-30 · `:phase4-supervisor` (config-only redeploy) — INST-004 hardening restored
- **No new image.** Same tag, `noesar-evolution:phase4-supervisor`. This is a `docker run` flag change only, not a rebuild — `D-0241` has the full reasoning.
- **Regression fixed**: `docker inspect` before this redeploy showed `ReadonlyRootfs:false`, `CapDrop:null`, `SecurityOpt:null`, `PidsLimit:null`, `Memory:0`, `Tmpfs:null` — lost at some point before `:phase4-supervisor` was built (found by `D-0240`, not caused by it). Restored: `--read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 512 --memory 8g --cpus 4 --tmpfs /run:rw,nosuid,nodev,noexec --tmpfs /tmp:rw,nosuid,nodev,noexec`. `--user 10001:10001` and `--shm-size 64m` had survived and are unchanged.
- **Sequence**: `docker stop -t 60` with `postgres.stopped clean:true` read in the log → full runtime backup (12.5 MB, `BACKUPS/runtime_pre_hardening_deploy_20260730T034633Z/`) → predecessor renamed `noesar-evolution.rollback-hardening-20260730T034633Z` → new container started with every env/mount/network/port re-read from the replaced container's own `docker inspect`, plus the restored flags.
- **Verified live**: `Up (healthy)`, `RestartCount=0`, `docker inspect` confirms all six hardening fields present with the exact target values, `/livez`+`/readyz` 200, `/api/v1/shadow` 401 vs `/api/v1/does-not-exist` 404, process tree from `/proc` confirms `ARCH-002`/`ARCH-003` topology unaffected (PID 1 = supervisor, api and postgres-child both direct children), `migrations":16` (0 re-run), `data-plane.identity-projected: projected:1`.
- **§5a**: two project containers (installation + one rollback, the most recent). Older rollback `rollback-supervisor-20260729T232340Z` removed after health confirmed, image intact on disk. Networks (10) and volumes (35) unchanged.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato. Returning to the rollback container reintroduces the posture regression, nothing else.

## 2026-07-30 · `:phase4-codev-peer` — ARCH-001 complete, `codev` is a real third peer
- **Tag**: `noesar-evolution:phase4-codev-peer`, `FROM noesar-evolution:phase4-supervisor`. New builder stage recompiles `noesar-supervisor` (3-peer child table); `services/reference-control-plane/` recopied (new `bin/codev-child.mjs`, `src/server.mjs` listens on an internal-only peer socket instead of the externally-reachable one).
- **Cosa cambia**: `codev` is spawned as a third direct child of PID 1 alongside `postgres`/`api`. It is a byte-transparent relay carrying no business logic — `api` still owns the one dispatch/auth/orchestrator instance; only the socket `api` listens on moved to `/run/codev-peer.sock` (internal, `NOESAR_CODEV_PEER_SOCKET_PATH`), with `codev` relaying `NOESAR_TUI_SOCKET_PATH` (unchanged, `/workspace/tui.sock`) to it. `D-0242` has full reasoning + the two bugs found building (tmpfs `/run` mode, a test-only listening-flag race).
- **Deploy correction found in this same phase**: `--tmpfs /run` needs `mode=1777` — Docker's own default for `/run` is `0755` root-owned, which made `api` (uid 10001) unable to create the peer socket at all until this was added. `INST-004`'s restored tmpfs flags (2026-07-30, earlier this phase) did not carry this — nothing needed a writable `/run` before `codev`.
- **Sequence**: `docker stop -t 60` with `postgres.stopped clean:true` in the log → full runtime backup (12.5 MB, `BACKUPS/runtime_pre_codev_peer_deploy_20260730T040708Z/`) → predecessor renamed `noesar-evolution.rollback-codev-peer-20260730T040708Z` → new container with env/mount/network/port/hardening re-read from the replaced container's own `docker inspect`, plus `mode=1777` added to `/run`.
- **Verified live**: `Up (healthy)`, `RestartCount=0`, all `INST-004` hardening fields intact, `/livez`+`/readyz` 200, `/api/v1/shadow` 401 vs `/api/v1/does-not-exist` 404, process tree from `/proc` shows three real peers (`postgres`/`codev`/`api`, all `ppid=1`), both `tui.sock` and `codev-peer.sock` present at `0600`, `migrations":16` (0 re-run), `data-plane.identity-projected: projected:1`.
- **Pre-production verification, isolated throwaway container**: real authenticated terminal session end-to-end through the relay (`tools/tui-client.mjs`, login+TOTP+`status`, real engine payload returned); `kill -9` on `codev` → restarted ~1s later, `api`/`postgres` untouched; `kill -9` on `api` → `postgres`/`codev` untouched, a new terminal connection attempted mid-restart closed fast with no data instead of hanging; `docker stop -t 60` → all three peers `child.stopped`, 0.122s total.
- **§5a**: two project containers (installation + one rollback, the most recent). Older rollback `rollback-hardening-20260730T034633Z` removed after health confirmed, image intact on disk. Networks (10) and volumes (35) unchanged.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato. Returning to `noesar-evolution.rollback-codev-peer-20260730T040708Z` (`:phase4-supervisor`) restores the two-peer topology (`codev` embedded in `api` again).

## 2026-07-30 · `:phase4-arch005-adapter-gate` — ARCH-005: local-model-runtime's `launch()` requires a granted token
- **Tag**: `noesar-evolution:phase4-arch005-adapter-gate`, `FROM noesar-evolution:phase4-codev-peer`. No Rust change this phase — no builder stage, only `services/reference-control-plane/` re-copied.
- **Cosa cambia**: new `adapter-capability.mjs` (`ADAPTER_MANIFESTS` + `AdapterGrantOrchestrator`, mints through the SAME `TokenMinter` `workspace-actions.mjs` spends). `local-model-runtime.mjs`'s `launch()` now requires a `capabilityToken` spent against that minter before spawning anything; no minter wired in refuses outright. New routes: `GET /api/v1/adapters`, `POST /api/v1/adapters/:resource/grants`, `POST /api/v1/adapters/grants/:runId/approve|reject`; `POST /api/v1/runtime/local-model/launch` now forwards `capabilityToken`. `D-0244` has the full reasoning.
- **Sequence**: build offline (`--network=none --pull=false`) → image bytes proved identical to the tree (`docker cp`+`diff -rq`) → `docker stop -t 60` with `postgres.stopped clean:true` read in the log → runtime backup (12.5 MB, `BACKUPS/runtime_pre_arch005_deploy_20260730T074008Z.tar.gz`) → predecessor renamed `noesar-evolution.rollback-arch005-adapter-gate-20260730T074008Z` → new container started with every env/mount/network/port/hardening flag re-read from the replaced container's own `docker inspect`.
- **Verified live**: `Up (healthy)`, `RestartCount=0`, all `INST-004` hardening fields intact (`ReadonlyRootfs:true`, `CapDrop:[ALL]`, `PidsLimit:512`), `/livez`+`/readyz` 200, `GET /api/v1/adapters` 401 vs `/api/v1/does-not-exist` 404, process tree from `/proc` still shows the three `D-0242` peers (`postgres`/`codev`/`api`, all `ppid=1`), `migrations":16` (0 re-run), `data-plane.identity-projected: projected:1`.
- **Reachability note**: the live container runs `NOESAR_LOCAL_MODEL_RUNTIME=disabled` (administrative override), so `launch()` refuses at the `disabled` check before reaching the new gate — the gate exists and is proven by the test suite (26 new tests), not by a live GPU launch on this deployment.
- **§5a**: two project containers (installation + one rollback, the most recent). Older rollback `rollback-codev-peer-20260730T040708Z` removed after health confirmed, image intact on disk. Networks (10) unchanged.
- **Costo di rollback**: nessuno — nessuna migrazione, `AI_STATE_VERSION` invariato. Returning to `:phase4-codev-peer` removes the capability gate on `launch()` — the adapter answers to `model.manage` RBAC alone again, nothing else.

## 2026-07-30 · `:phase4-sandbox-binary` — ARCH-008: the sandbox binary ships, unwired
Tag `noesar-evolution:phase4-sandbox-binary`, `FROM :phase4-arch005-adapter-gate`. New builder
stage compiles `rust/crates/noesar-sandbox` (`--offline --locked`, `rust/vendor`+`Cargo.lock`,
`RUSTUP_TOOLCHAIN` pinned) and copies the release binary to `/opt/noesar/bin/noesar-sandbox`
(0755); `services/reference-control-plane/` re-copied for the new `isolation.mjs`/
`sandbox-runner.mjs`. No ENTRYPOINT change, no migration.

**Verification**: image built `--network=none`; binary present and runs `--detect` inside the
built image before touching production. Deploy sequence: stop `-t 60` →
`postgres.stopped clean:true` in log → backup `EVIDENCE/backup_runtime_20260730T100439Z.tar.gz`
(12.5 MB) → §5a (older rollback `codev-peer` removed, predecessor `arch005-adapter-gate`
renamed to rollback) → new container, env/mounts/network/hardening **read back** from the
stopped container, not retyped. Live: `Up (healthy)`, `/livez` `/readyz` 200,
`ReadonlyRootfs=true CapDrop=[ALL]`, `migrations:16 rls_tables:15` (not re-run), byte identity
of running container's image ID = built image ID. `docker exec … noesar-sandbox --detect` on
the live container: `tier:1 SECCOMP_FILTER`, `containerCeiling.memoryBytes:8589934592`.

**Not wired**: no product surface invokes the binary. `executor.mjs`'s `EXECUTE` remains
permanently refused (shared conformance oracle, `EXEC-007`) — reversing that needs an explicit
Owner decision, not implied by shipping the binary. Same posture as `D-0244`'s adapter gate
before anything called `launch()`.

Predecessor: `noesar-evolution.rollback-sandbox-binary-20260730T100439Z` (`:phase4-arch005-adapter-gate`).
Rollback cost: none — no migration, `AI_STATE_VERSION` unchanged.

## 2026-07-30 · `:phase4-execute-client-decision` — D-0250 deployed: EXECUTE as a client decision
Tag `noesar-evolution:phase4-execute-client-decision`, `FROM :phase4-sandbox-binary`. No Rust
rebuild (`noesar-sandbox` unchanged; the `CapabilityLimits` rename_all fix lives in a crate
never compiled into this image). Only `services/reference-control-plane/` re-copied.

**Verification**: module loaded and resolved `disabled` inside the built image before touching
production. Deploy: stop `-t 60` → `postgres.stopped clean:true` → backup
`EVIDENCE/backup_runtime_20260730T104115Z.tar.gz` (12.5 MB) → §5a (older rollback
`sandbox-binary` removed, predecessor `sandbox-binary` renamed to rollback) → new container,
config **read back**, `NOESAR_EXECUTE_SANDBOX=disabled` added **explicitly** (parity with
`NOESAR_LOCAL_MODEL_RUNTIME=disabled`'s own visibility, not left implicit-by-absence). Live:
`Up (healthy)`, `/livez` `/readyz` 200, hardening intact, `migrations:16 rls_tables:15`
unchanged, byte identity confirmed. `docker exec` on the **live container**, real env:
`resolveExecuteSandboxConfig` → `{enabled:false, requested:false}` — the client's decision,
proven from inside the running process, not assumed.

Predecessor: `noesar-evolution.rollback-execute-client-decision-20260730T104115Z`
(`:phase4-sandbox-binary`). Rollback cost: none.

## 2026-07-30 · `:phase4-arch005-manifest-precision` — D-0252 deployed: three adapters get honest empty manifests
Tag `noesar-evolution:phase4-arch005-manifest-precision`, `FROM :phase4-execute-client-decision`.
No Rust rebuild (nothing Rust-side touched). Only `services/reference-control-plane/` re-copied
(`adapter-capability.mjs` + its two test files).

**Verification (pre-deploy)**: byte identity of image contents vs. repository tree confirmed via
`docker cp` + `diff` on both changed files, before touching production. Node **1222 tests (was
1220), 1221 pass, 1 honest skip, 0 fail**; ESLint **244 files, 0 errors**.

**Deploy**: stop `-t 60` → `postgres.stopped clean:true` confirmed in the log → backup
`BACKUPS/runtime_pre_arch005_manifest_precision_deploy_20260730T111600Z.tar.gz` (12.5 MB, service
stopped) → §5a (older rollback `execute-client-decision-20260730T104115Z` removed, predecessor
renamed to `.rollback-arch005-manifest-precision-20260730T111600Z`).

**Self-caught deployment defect, not a product defect**: the first `docker run` reconstructed
`HostConfig` from a partial field list (`Binds`/`PortBindings`/`RestartPolicy`/`ReadonlyRootfs`/
`CapDrop`/`NetworkMode`) and omitted `Tmpfs` — the predecessor's `--tmpfs /run:mode=1777` mount
that `D-0241` had specifically fixed. The container crash-looped for ~20s
(`listen EROFS: read-only file system /run/codev-peer.sock`, `session-protocol.mjs`'s Unix socket
listener) before healthcheck could ever pass. Caught by watching the log instead of assuming
`Up (health: starting)` would resolve to healthy; stopped and removed within seconds, no traffic
served, nothing promoted. Re-run from the **full** `HostConfig` JSON (`Tmpfs`, `SecurityOpt`,
`PidsLimit`, `Memory`, `NanoCpus` included this time, not just the six fields rule 11c's own
prose happens to name) succeeded on the first attempt: `postgres.ready`, `data-plane.ready
migrations:16 rls_tables:15 production_ready:true`, healthcheck **healthy** at 21s.

**Verification (post-deploy)**: `Up (healthy)`, `/livez` `/readyz` 200, hardening intact
(`ReadonlyRootfs:true CapDrop:[ALL] Tmpfs:{/run:mode=1777,/tmp}`, `RestartCount:0` on the
surviving container), `migrations:16 rls_tables:15` unchanged. `GET /api/v1/adapters` (no
session) → `401`, same as before — the new manifest entries did not loosen the route's own
auth. Rule 11e respected: no suite that bootstraps an owner or mutates settings was run against
this installation; what was proven is deployed-bytes-equal-tree (pre-deploy) plus service health
and the auth-gated surface answering (post-deploy). Post-cleanup inventory: exactly 2
`noesar-evolution*` containers, `noesar-evolution-net` the only project network, no volumes,
non-project container count unchanged (40).

Predecessor: `noesar-evolution.rollback-arch005-manifest-precision-20260730T111600Z`
(`:phase4-execute-client-decision`). Rollback cost: none — no runtime authorization behaviour
changed for any existing gated path.

## 2026-07-30 · `:phase4-arch008-execute-rust-mirror` — D-0253 deployed: comment-only, the real work ships nowhere
Tag `noesar-evolution:phase4-arch008-execute-rust-mirror`, `FROM :phase4-arch005-manifest-precision`.
The substance of `D-0253` (`rust/crates/noesar-executor` spawning `noesar-sandbox` natively) is
never compiled into any image — confirmed no other crate depends on it, same as before this
phase. Only `services/reference-control-plane/` re-copied, and only two files in it actually
changed: `executor.mjs`/`sandbox-runner.mjs`, comment-only (removing the "EXECUTE is permanently
refused on both language sides" claim that was already half-wrong since `D-0250`). Zero runtime
behaviour change — deployed anyway, for the same reason every source change is: keeping the live
container's tree byte-identical to the repository is the property `§3a` protects, not just the
behaviours that happen to differ.

**Verification (pre-deploy)**: byte identity of image contents vs. repository tree confirmed for
all 3 touched files (`executor.mjs`, `sandbox-runner.mjs`, `executor-vectors.test.mjs`) via
`docker cp` + `diff`. Full Rust workspace **140/140 tests** (up from 135), Node **1223 pass, 1
honest skip, 0 fail**, ESLint **244 files, 0 errors**, `MANIFEST.sha256` **5859/5859**.

**Deploy, lesson from the same session applied**: stop `-t 60` → `postgres.stopped clean:true`
confirmed in the log → backup `BACKUPS/runtime_pre_arch008_execute_rust_mirror_deploy_
20260730T114253Z.tar.gz` (12.5 MB, service stopped) → §5a (older rollback
`arch005-manifest-precision-...T111600Z` removed, predecessor renamed to
`.rollback-arch008-execute-rust-mirror-20260730T114253Z`) → new container built from the **full**
`docker inspect --format '{{json .HostConfig}}'` JSON this time, not a hand-picked field subset
(the earlier deploy this same session crash-looped for exactly that reason — `Tmpfs` omitted).
**Clean on the first attempt**: `Up (healthy)` at 15s, `postgres.ready migrations:16 rls_tables:15
production_ready:true`, `/livez`/`/readyz` 200, hardening intact
(`ReadonlyRootfs:true CapDrop:[ALL] Tmpfs:{/run:mode=1777,/tmp}`, `RestartCount:0`). Post-cleanup
inventory: exactly 2 `noesar-evolution*` containers, `noesar-evolution-net` the only project
network, non-project container count unchanged.

Predecessor: `noesar-evolution.rollback-arch008-execute-rust-mirror-20260730T114253Z`
(`:phase4-arch005-manifest-precision`). Rollback cost: none.

## 2026-07-30 · `:phase4-sess001-session-proof` — D-0255 deployed: SESS-001, the Session Proof route
Tag `noesar-evolution:phase4-sess001-session-proof`, `FROM :phase4-arch008-execute-rust-mirror`.
New: `session-proof.mjs`, `GET /api/v1/workspace-actions/:id/session-proof`, run fields
(`hypotheses`/`request`/`egressSamples`), `capability.denied` event. `tools/run-browser-e2e.sh`
also fixed this phase (`D-0256`, `--tmpfs /run:...,mode=1777` added) — not shipped in any image.

**Verification (pre-deploy)**: byte identity of image contents vs. repository tree confirmed for
all 3 touched/new `services/reference-control-plane/src/` files via `docker cp` + `diff`. Node
**1229 pass, 1 honest skip, 0 fail** (up from 1223), ESLint **246 files, 0 errors**, `scripts/
test.sh` **10/10**, browser E2E **327/327**, accessibility **27/27**, seeded-defect **19/19**,
`MANIFEST.sha256` **5861/5861**.

**Two self-caused mistakes during this deploy, disclosed rather than smoothed over**:
1. The first `docker run` copied `NOESAR_ALLOWED_HOSTS`/`NOESAR_EXTERNAL_SURFACES` from a
   `docker inspect ... | tr ',' '\n'` command I had run **for on-screen readability**, and
   pasted the newline-separated display output into `-e` instead of the real comma-separated
   value — `validHostHeader()` then rejected every request with `421`, health stuck at
   `starting`. Caught immediately (health never went green), not shipped.
2. Fixing it, I removed that container with `docker rm -f` instead of `docker stop -t 60` first
   — a live-container mistake, not a `§3a` sequence step skipped on purpose. PostgreSQL's own
   WAL crash recovery handled it cleanly (`database system was not properly shut down;
   automatic recovery in progress` → `redo done` → `ready to accept connections`,
   `migrations:16 rls_tables:15 production_ready:true` unchanged) — no data loss, but the
   correct move would have been a second clean stop. Named so the next phase does not repeat it.

**Deploy, corrected**: `docker stop -t 60` on the live container → `postgres.stopped clean:true`
confirmed in the log → backup `BACKUPS/runtime_pre_sess001_session_proof_deploy_
20260730T130533Z.tar.gz` (12.5 MB, service stopped) → §5a (older rollback
`arch008-execute-rust-mirror-...T114253Z` removed, predecessor renamed to
`.rollback-sess001-session-proof-20260730T130533Z`) → new container from the **full** `docker
inspect --format '{{json .HostConfig}}'` JSON, env re-read correctly the second time →
`Up (healthy)` at ~30s (after the self-caused WAL recovery above), hardening intact
(`ReadonlyRootfs:true CapDrop:[ALL] Tmpfs:{/run:mode=1777,/tmp}`, `RestartCount:0`),
`/livez`/`/readyz`/`/healthz` 200/200/200, `GET .../session-proof` on an unknown run answers
**401** (reaches the auth gate, not a 404 — the route is wired). Post-cleanup inventory: exactly
2 `noesar-evolution*` containers, `noesar-evolution-net` the only project network.

Predecessor: `noesar-evolution.rollback-sess001-session-proof-20260730T130533Z`
(`:phase4-arch008-execute-rust-mirror`). Rollback cost: none.

## 2026-07-30 · `:phase4-sess002-003-replay` — D-0259 deployed: the replay engine, both halves
Tag `noesar-evolution:phase4-sess002-003-replay`, `FROM :phase4-sess001-session-proof`.
New: `session-replay.mjs` (`compareDecisions`, `comparePolicyOutcome`, `callAtomReplay`,
`DECISION_SURFACES`), `WorkspaceActionOrchestrator#replay()`+`#replayHistoricalFixture()`,
`POST /api/v1/workspace-actions/:id/replay`, `POST /api/v1/session-proof/replay`. `plan()`
now threads `runId` as the router's `sessionId` and captures a fixture pack best-effort.

**Verification (pre-deploy)**: byte identity of image contents vs. repository tree confirmed
for all 4 touched/new `services/reference-control-plane/src/` files via `docker cp` + `diff`.
Node **1246 pass, 1 honest skip, 0 fail** (+18 over `D-0255`), ESLint **248 files, 0 errors**,
`scripts/test.sh` **10/10**, browser E2E **327/327**, accessibility **27/27**, seeded-defect
**19/19**, `MANIFEST.sha256` **5863/5863**.

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log → backup
`BACKUPS/runtime_pre_sess002_003_replay_deploy_20260730T142926Z.tar.gz` (12.5 MB, service
stopped) → §5a (older rollback `sess001-session-proof-...T130533Z` removed, predecessor
renamed to `.rollback-sess002-003-replay-20260730T142926Z`) → new container from the **full**
`docker inspect --format '{{json .HostConfig}}'` JSON, `NOESAR_ALLOWED_HOSTS`/
`NOESAR_EXTERNAL_SURFACES` re-verified comma-separated with `cat -A` before use (the `D-0257`
incident's exact lesson, applied and clean this time). **Clean on the first attempt**:
`Up (healthy)` at 11s, `database system was shut down` cleanly (no WAL recovery, unlike the
`D-0255` deploy), `postgres.ready migrations:16 rls_tables:15 production_ready:true`,
`/livez`/`/readyz` 200/200, hardening intact (`ReadonlyRootfs:true CapDrop:[ALL]
Tmpfs:{/run:mode=1777,/tmp}`, `RestartCount:0`). Both new routes answer **401** unauthenticated
(reach the auth gate, not a 404). Post-cleanup inventory: exactly 2 `noesar-evolution*`
containers, `noesar-evolution-net` the only project network.

Predecessor: `noesar-evolution.rollback-sess002-003-replay-20260730T142926Z`
(`:phase4-sess001-session-proof`). Rollback cost: none.

## 2026-07-30 · `:phase4-cube-c1-schema` — D-0261 deployed: the memory-cubes schema (migration 0017)
Tag `noesar-evolution:phase4-cube-c1-schema`, `FROM :phase4-sess002-003-replay`. New:
`database/postgres/0017_memory_cubes.sql` (`embedding_models`, `memory_records`, `memory_vectors`,
RLS, the immutable-signature trigger). Schema only — no application code reads or writes these
tables yet. This is the first image in the session where `database/postgres/` was added to the
`COPY` list; prior `Dockerfile.phase4-*` in this lineage only copied
`services/reference-control-plane/` (correct for those phases, none touched the schema).

**Verification (pre-deploy)**: byte identity of image contents vs. repository tree confirmed for
both changed/new `database/postgres/` files via `docker cp` + `diff`. Static: `scripts/test.sh`
pg-migrations + pg-contract **PASS** (17/17 migration manifest entries, checksums, transaction
boundaries). **Live, against a real disposable PostgreSQL** (not the live data — a scratch
container, `--network none`, throwaway workspace, removed after): confirmed `migrations:17` on
boot, then 8 direct `psql` tests against the trigger and every new constraint — all matched the
intended behaviour (full list in `docs/DECISION_LOG.md` `D-0261`).

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log → backup
`BACKUPS/runtime_pre_cube_c1_schema_deploy_20260730T144721Z.tar.gz` (12.5 MB, service stopped) →
§5a (older rollback `sess002-003-replay-...T142926Z` removed, predecessor renamed to
`.rollback-cube-c1-schema-20260730T144721Z`) → new container from the full `docker inspect`
HostConfig JSON, env re-verified comma-separated with `cat -A` before use. **Clean on the first
attempt**: `Up (healthy)` at 16s, only migration `0017` applied this boot (the other 16 were
already on the real data volume from prior deploys), `data-plane.ready migrations:17
rls_tables:18` (+3, the three new tables), `/livez`/`/readyz` 200/200, hardening intact
(`ReadonlyRootfs:true CapDrop:[ALL] Tmpfs:{/run:mode=1777,/tmp}`, `RestartCount:0`). Post-cleanup
inventory: exactly 2 `noesar-evolution*` containers, `noesar-evolution-net` the only project
network.

Predecessor: `noesar-evolution.rollback-cube-c1-schema-20260730T144721Z`
(`:phase4-sess002-003-replay`). Rollback cost: none — three new, unreferenced tables removed.

## 2026-07-30 · `:phase4-cube-typed-views` — D-0262 deployed: `CUBE-004` typed views (migration 0018) + a RESTRICTIVE-only policy defect fixed
Tag `noesar-evolution:phase4-cube-typed-views`, `FROM :phase4-cube-c1-schema`. New:
`database/postgres/0018_memory_cube_typed_views.sql` — four typed views over `memory_records`
(`library_memories`/`workshop_memories`/`corpus_memories`/`experience_memories`, `WITH CHECK
OPTION`, owned by `noesar_migrator`), direct `SELECT`/`INSERT`/`UPDATE` on `memory_records`
revoked from `noesar_app`, two new `SECURITY DEFINER` functions
(`can_read_memory_record`/`can_write_memory_record`) so `memory_vectors`' policy keeps working
without a direct grant. Also fixes an independent defect found live-verifying this: `0017`'s
three policies (`memory_records`/`memory_vectors`/`embedding_models`) were each the *only*
policy on their table and declared `RESTRICTIVE` — with no `PERMISSIVE` policy to narrow, access
was denied unconditionally since deploy, silent because nothing reads/writes these tables yet.
Fixed by dropping the `RESTRICTIVE` marker on all three (full detail: `docs/DECISION_LOG.md`
`D-0262`).

**Verification (pre-deploy)**: static `scripts/test.sh` pg-migrations + pg-contract **PASS**
(18/18 migration manifest entries). Full suite: `scripts/test.sh` 10/10 STEP, `npm test`
1246/1247 (1 pre-existing unrelated skip), `npm run lint` 248 files / 0 errors. **Live, against a
real disposable PostgreSQL** (`--network none`, throwaway workspace, removed after): extended the
project's own permanent in-container harness (`tools/acceptance/postgres-integration.mjs`) with
`CUBE04-01..08` — **57/57 PASS**, zero regressions on the pre-existing `DB-*` checks. The
RESTRICTIVE-only defect and its fix were also confirmed empirically in an isolated hypothesis
test against the unmodified `0017` schema before the final fix was written (full list in
`docs/DECISION_LOG.md` `D-0262`).

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log → backup
`BACKUPS/runtime_pre_cube_typed_views_deploy_20260730T152454Z.tar.gz` (12.7 MB, service stopped)
→ §5a (older rollback `cube-c1-schema-...T144721Z` removed, predecessor renamed to
`.rollback-cube-typed-views-20260730T152454Z`) → new container from the full `docker inspect`
HostConfig JSON, env re-verified comma-separated with before use. **Clean on the first attempt**:
`Up (healthy)` at 12s, `data-plane.ready migrations:18 rls_tables:18 production_ready:true`,
`/livez`/`/readyz`/`/healthz` all 200/200/200, hardening intact (`ReadonlyRootfs:true
CapDrop:[ALL] Tmpfs:{/run:mode=1777,/tmp}`, `RestartCount:0`). Byte identity of the two
changed/new files confirmed via `docker cp` + `diff`. Post-cleanup inventory: exactly 2
`noesar-evolution*` containers, `noesar-evolution-net` the only project network.

Predecessor: `noesar-evolution.rollback-cube-typed-views-20260730T152454Z`
(`:phase4-cube-c1-schema`). Rollback cost: reintroduces the `CUBE-004` gap and the
RESTRICTIVE-only defect — no data loss, nothing reads/writes these tables in application code
yet.

## 2026-07-30 · `:phase4-memory-application-layer` — D-0263 deployed: recall(), compaction, contamination canary, promotion (CUBE-003/CUBE-006)
Tag `noesar-evolution:phase4-memory-application-layer`, `FROM :phase4-cube-typed-views`. New:
migration `0019` (read-only `all_memories` union view), `services/reference-control-plane/src/
memory-service.mjs` (write/recall/promote/ensureWorkspace) and `memory-compaction.mjs`
(fail-closed extraction from `EventLedger`), `approval-queue.mjs` gains a fourth
`memory-candidate` source, `server.mjs` wires `MemoryService`, the boot-time workspace
projection, the `GET /api/v1/memory/recall` route, and an auto-compaction trigger after
`approve`/`reject`. Full detail: `docs/DECISION_LOG.md` `D-0263`.

**Verification (pre-deploy)**: `npm test` 1271/1272 (1 pre-existing unrelated skip), `npm run
lint` 253 files / 0 errors, `scripts/test.sh` 10/10 STEP (19/19 migration manifest entries).
**Live, against a real disposable PostgreSQL**: new permanent harness
`tools/acceptance/memory-integration.mjs` — **24/24 PASS**, including a real bug caught and
fixed before shipping (`listCandidates()`/`promote()` querying through the typed views under an
admin connection returned zero rows regardless of what existed, because a plain view's RLS
follows the view OWNER's identity, not the connecting role's — fixed to query `memory_records`
directly for these two already-privileged, `noesar_app`-unreachable methods).

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log → backup
`BACKUPS/runtime_pre_memory_application_layer_deploy_20260730T165253Z.tar.gz` (12.8 MB, service
stopped) → §5a (older rollback `cube-typed-views-...T152454Z` removed, predecessor renamed to
`.rollback-memory-application-layer-20260730T165253Z`) → new container from the full `docker
inspect` HostConfig JSON. **Clean on the first attempt**: `Up (healthy)` at 12s,
`data-plane.ready migrations:19 rls_tables:18`, `data-plane.workspace-projected ensured:true`
(the real owner's id in the boot log), `/livez`/`/readyz` 200/200, hardening intact
(`ReadonlyRootfs:true CapDrop:[ALL] Tmpfs:{/run:mode=1777,/tmp}`, `RestartCount:0`). Byte
identity of all four changed/new files confirmed via `docker cp` + `diff`. Post-cleanup
inventory: exactly 2 `noesar-evolution*` containers, `noesar-evolution-net` the only project
network.

Predecessor: `noesar-evolution.rollback-memory-application-layer-20260730T165253Z`
(`:phase4-cube-typed-views`). Rollback cost: none on live data — no application code wrote
through the new memory service before this phase.

## 2026-07-30 · `:phase4-memory-model-swap` — D-0264 deployed: the embedding model swap procedure (CUBE-008)
Tag `noesar-evolution:phase4-memory-model-swap`, `FROM :phase4-memory-application-layer`. New:
`services/reference-control-plane/src/memory-model-swap.mjs` — `ModelSwapService` implementing
`14 §9.3`'s four steps (register not-current, incremental backfill, atomic cutover at 100%
coverage, purge the superseded model's index). Full detail: `docs/DECISION_LOG.md` `D-0264`.

**Verification (pre-deploy)**: `npm test` 1284/1285 (1 pre-existing unrelated skip), `npm run
lint` 255 files / 0 errors, `scripts/test.sh` 10/10 STEP. **Live, against a real disposable
PostgreSQL**: `tools/acceptance/memory-integration.mjs` extended with `MEM-25..36` —
**35/35 PASS**, including a real bug caught and fixed before shipping (`purgeSuperseded()`
reported `deleted:0` against a real 7-row deletion because this project's hand-rolled pg client
computes `rowCount` from the returned row set, not PostgreSQL's `CommandComplete` tag — fixed
by adding `RETURNING`, the same convention `postgres-integration.mjs`'s `DB-17` already uses).

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log → backup
`BACKUPS/runtime_pre_memory_model_swap_deploy_20260730T170329Z.tar.gz` (12.9 MB, service
stopped) → §5a (older rollback `memory-application-layer-...T165253Z` removed, predecessor
renamed to `.rollback-memory-model-swap-20260730T170329Z`) → new container from the full
`docker inspect` HostConfig JSON. **Clean on the first attempt**: `Up (healthy)` at 12s,
`data-plane.ready migrations:19 rls_tables:18`, `data-plane.workspace-projected ensured:true`,
`/livez`/`/readyz` 200/200, hardening intact (`ReadonlyRootfs:true CapDrop:[ALL]
Tmpfs:{/run:mode=1777,/tmp}`, `RestartCount:0`). Byte identity of the two changed/new files
confirmed via `docker cp` + `diff`. Post-cleanup inventory: exactly 2 `noesar-evolution*`
containers, `noesar-evolution-net` the only project network.

Predecessor: `noesar-evolution.rollback-memory-model-swap-20260730T170329Z`
(`:phase4-memory-application-layer`). Rollback cost: none on live data — `embedding_models` is
empty in production; this phase only proves the swap mechanism against a disposable instance.

## 2026-07-30 · `:phase4-memory-webui` — D-0265 deployed: the Memory WebUI destination — Block C complete (CUBE-009)
Tag `noesar-evolution:phase4-memory-webui`, `FROM :phase4-memory-model-swap`. New: a thirteenth
sidebar destination "Memory" (`apps/webui-static/index.html`+`app.js`) backed by
`GET /api/v1/memory/recall` and the existing 4-source `ApprovalQueue` — no new backend route.
The pre-existing `id="view-memory"` manual notes panel (nested inside Knowledge) renamed to
`#memory-notes-block` to free the id, functionally unchanged. Full detail:
`docs/DECISION_LOG.md` `D-0265`.

**Verification (pre-deploy)**: `npm test` 1284/1285 (1 pre-existing unrelated skip — 3 previously
stale structural tests fixed for the new destination), `npm run lint` 255 files / 0 errors,
`scripts/test.sh` 10/10 STEP. **Live, in a real Chromium via Puppeteer**: full browser E2E suite
**334/334 PASS** and the accessibility audit **27/27 PASS**, both walking Memory as one of the
now-thirteen destinations. Two real, reproducible bugs found and fixed during this
verification — neither in the Memory destination itself — see `D-0265` for the full root-cause
analysis: (1) `clickOrExplain()`'s Puppeteer `page.click()` threw "Node is detached from
document" (traced to `scrollIntoViewIfNeeded`), fixed with an in-page synthetic click; (2) a
test race reading the approval strip before its own async refresh completed, fixed with an
explicit wait. Both previously masked by the approvals endpoint being synchronous-fast; exposed
once `D-0263` made one of its sources a genuine PostgreSQL round trip.

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log → backup
`BACKUPS/runtime_pre_memory_webui_deploy_20260730T173434Z.tar.gz` (12.9 MB, service stopped) →
§5a (older rollback `memory-model-swap-...T170329Z` removed, predecessor renamed to
`.rollback-memory-webui-20260730T173434Z`) → new container from the full `docker inspect`
HostConfig JSON. **Clean on the first attempt**: `Up (healthy)` at 12s, `data-plane.ready
migrations:19 rls_tables:18`, `data-plane.workspace-projected ensured:true`, `/livez`/`/readyz`
200/200, hardening intact (`ReadonlyRootfs:true CapDrop:[ALL] Tmpfs:{/run:mode=1777,/tmp}`,
`RestartCount:0`). Byte identity of both changed files confirmed via `docker cp` + `diff`.
Post-cleanup inventory: exactly 2 `noesar-evolution*` containers, `noesar-evolution-net` the
only project network.

Predecessor: `noesar-evolution.rollback-memory-webui-20260730T173434Z`
(`:phase4-memory-model-swap`). Rollback cost: none on live data — frontend-only change plus one
renamed markup id, no schema change.

**This closes MASTER_PROJECT/14_MEMORIA_A_CUBI.md's entire acceptance matrix. Block C is
complete: CUBE-001 through CUBE-009 all built and verified live.**

## 2026-07-31 · `:phase4-research` — D-0266 deployed: the Research destination on the existing gate (UI-080…096), Block D1
Tag `noesar-evolution:phase4-research`, `FROM :phase4-memory-webui`. New:
`services/reference-control-plane/src/research.mjs` (intent gate → designated external tool →
content gate → ephemeral revocable report), routes in `server.mjs`
(`/api/v1/settings/research`, `/api/v1/research/report[/:id[/revoke]]`,
`/api/v1/research/gate/contest`), the Research page wired up in `apps/webui-static/`. Full
detail: `docs/DECISION_LOG.md` `D-0266`.

**Verification (pre-deploy)**: `npm test` 1296/1297 (1 pre-existing skip, up from 1285 — includes
`research.test.mjs` 12/12 new), `npm run lint` 257 files / 0 errors. **Live, real Chromium**:
browser E2E **334/334 PASS**, accessibility audit **27/27 PASS**, both walking Research as one
of the now-fourteen destinations. One real bug found and fixed before shipping: a bare
`match = ...` in the two new report routes collided (TDZ) with a `let match` declared 800 lines
later in the same function — broke every request on the server, caught by 67 unrelated test
failures across the whole suite, fixed by giving the two matches their own names.

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log → backup
`BACKUPS/runtime_pre_research_deploy_20260731T003927Z.tar.gz` (12.9 MB, service stopped) → §5a
(older rollback `memory-webui-...T173434Z` removed, predecessor renamed to
`.rollback-research-20260731T003927Z`) → new container from the full `docker inspect` HostConfig
JSON. **Clean on the first attempt**: `Up (healthy)` at 12s, `data-plane.ready
migrations:19 rls_tables:18`, `data-plane.workspace-projected ensured:true`, `/livez`/`/readyz`
200/200, hardening intact (`ReadonlyRootfs:true CapDrop:[ALL] Tmpfs:{/run:mode=1777,/tmp}`,
`RestartCount:0`). Byte identity of all 5 changed/new files confirmed via `docker cp` + `diff`.
Post-cleanup inventory: exactly 2 `noesar-evolution*` containers.

Predecessor: `noesar-evolution.rollback-research-20260731T003927Z` (`:phase4-memory-webui`).
Rollback cost: none on live data — no schema change, no provider registered yet, the report
store is in-memory and empty at every restart regardless.

**`UI-080…096` closed. No research provider is registered on this installation — that is an
operator action (same posture as the reasoning provider), not a code gap.**

## 2026-07-31 · `:phase4-sessions-tui` — D-0267 deployed: the CodeN Evolution TUI's sessions commands (UI-050), Block D2
Tag `noesar-evolution:phase4-sessions-tui`, `FROM :phase4-research`. Changed:
`services/reference-control-plane/src/session-protocol.mjs` (+`sessions.list`/`sessions.get`/
`sessions.action`, closed over the same `contextGraph`+`ledger` the HTTP bridge already uses),
`server.mjs` (wires `contextGraph`/`ledger` into `createSessionDispatch`), `tools/tui-client.mjs`
(+`sessions`/`session-show`/`session-archive`/`session-delete`/`session-restore`/
`session-undone`, run from the operator's own host checkout — never baked into this image, see
`Dockerfile.phase4-codev-peer`'s own note). Full detail: `docs/DECISION_LOG.md` `D-0267`.

**Verification (pre-deploy)**: full suite **1312/1313** (1 pre-existing skip, up from 1297 —
+6 `session-protocol.test.mjs`, +9 new `tui-client-sessions.test.mjs`), ESLint **258 files 0
errors**, `scripts/test.sh` **10/10**, seeded-defect **19/19**, `auth-http-smoke`/`http-smoke`
PASS, `MANIFEST.sha256` **5880/5880**. No DOM/markup changed this phase, so browser E2E and the
accessibility audit were judged irrelevant and not re-run (control-plane + CLI change only).

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log → backup
(12.9 MB, service stopped) → §5a (older rollback `.rollback-research-20260731T003927Z`
removed, predecessor renamed to `.rollback-sessions-tui-20260731T022844Z`) → new container from
the full `docker inspect` HostConfig JSON. `Up (healthy)`, `data-plane.ready migrations:19
rls_tables:18`, `/livez`/`/readyz` 200/200, hardening intact (`ReadonlyRootfs:true
CapDrop:[ALL] RestartCount:0`). Byte identity of both changed source files confirmed via
`docker run --entrypoint sha256sum` against the built image. **Live probe, unauthenticated, no
real session touched**: a raw connection to the host-side `tui.sock` gets the protocol
handshake, then `sessions.list` before login answers `UNAUTHENTICATED` — the new method is
genuinely wired through `codev`'s relay to `api`'s dispatch on the running product, gated
exactly like every other method. Post-cleanup inventory: exactly 2 `noesar-evolution*`
containers.

Predecessor: `noesar-evolution.rollback-sessions-tui-20260731T022844Z` (`:phase4-research`).
Rollback cost: none on live data — additive dispatch methods only, no schema change.

**`UI-050` closed for sessions. `CE-020` remains open for the agent-panels half (`UI-054`),
which is Block D3 alongside Voice (`D-0123`).**

## 2026-07-31 · `:phase4-panels-tui` — D-0268 deployed: workbench panels + status line reachable from the TUI (UI-054), Block D3a
Tag `noesar-evolution:phase4-panels-tui`, `FROM :phase4-sessions-tui`. Changed:
`services/reference-control-plane/src/session-protocol.mjs` (+`product.invariants`, same
`INVARIANT_ENFORCEMENT` record `/api/v1/bootstrap` already sends), `server.mjs` (threads it
through), `tools/tui-client.mjs` (+`panel <name> [arg]` router + the bench's 12-field status
line on `status`). Full detail: `docs/DECISION_LOG.md` `D-0268`.

**Verification (pre-deploy)**: full suite **1322/1323** (1 pre-existing skip, up from 1313 —
+1 `session-protocol.test.mjs`, +9 new `tui-client-panels.test.mjs`), ESLint **259 files 0
errors**, `scripts/test.sh` **10/10**, seeded-defect **19/19**, `auth-http-smoke`/
`http-smoke` PASS, `MANIFEST.sha256` **5881/5881**. No DOM/markup changed, so browser E2E
and the accessibility audit were judged irrelevant and not re-run (same reasoning as
`:phase4-sessions-tui`).

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log →
backup (12.9 MB, service stopped) → §5a (older rollback
`.rollback-sessions-tui-20260731T022844Z` removed, predecessor renamed to
`.rollback-panels-tui-20260731T024358Z`) → new container from the full `docker inspect`
HostConfig JSON. `Up (healthy)`, `data-plane.ready migrations:19 rls_tables:18`,
`/livez`/`/readyz` 200/200, hardening intact (`ReadonlyRootfs:true CapDrop:[ALL]
RestartCount:0`). Byte identity of both changed source files confirmed via
`docker run --entrypoint sha256sum` against the built image. **Live probe, unauthenticated,
no real session touched**: `product.invariants` before login answers `UNAUTHENTICATED` —
genuinely wired through `codev`'s relay to `api`'s dispatch on the running product.
Post-cleanup inventory: exactly 2 `noesar-evolution*` containers.

Predecessor: `noesar-evolution.rollback-panels-tui-20260731T024358Z` (`:phase4-sessions-tui`).
Rollback cost: none on live data — one additive read-only dispatch method, additive CLI
commands only.

**`UI-054` closed for the panel-name half. `F1…F9` raw-keypress binding and Voice (`D-0123`)
remain open — named gaps (Block D3b/D3c), not silently dropped.**

## 2026-07-31 · (no image tag) — D-0269 shipped: `F1…F9` raw-keypress panel switching (UI-054, Block D3b) — git-only, no Docker deploy
Changed: `tools/tui-client.mjs` only (`panelForFunctionKey`/`FUNCTION_KEY_PANELS`,
`wireFunctionKeys`, exported `runPanel`, shared `PROMPT` constant), plus new
`services/reference-control-plane/test/tui-client-function-keys.test.mjs`. No change to
`services/reference-control-plane/` or any other file the OCI images copy.

**Why no deploy.** `tools/tui-client.mjs` is the operator's own terminal client, run from
the host checkout against the product's unix socket — it has never been baked into any
`noesar-evolution:*` image (see `oci/Dockerfile.phase4-sessions-tui`'s own header comment).
`D-0267`/`D-0268` redeployed the live container only because they also touched
`session-protocol.mjs`/`server.mjs`; this change touches neither, so there is nothing in
the image to update and no live probe that would prove anything a unit test does not
already prove. The live product container is unchanged: still
`noesar-evolution:phase4-panels-tui`, `Up (healthy)`.

**Verification (this change only)**: full suite **1325/1326** (1 pre-existing skip, up
from 1322/1323, +4 new), ESLint **260 files 0 errors**, `scripts/test.sh` **10/10**,
seeded-defect **19/19**, `MANIFEST.sha256` **5882/5882** (1 changed hash —
`tools/tui-client.mjs` — 1 new file appended). Full detail: `docs/DECISION_LOG.md` `D-0269`.

**`UI-054` now fully closed, both halves. `CE-020` holds for every TUI-reachable panel.
Remaining: Voice (`D-0123`, Block D3c) — unscoped, needs a dedicated pass before any code.**

## 2026-07-31 · `:phase4-voice-control` — D-0270 deployed: voice as a control tower (D-0123), Block D3c, Block D complete
Tag `noesar-evolution:phase4-voice-control`, `FROM :phase4-panels-tui`. Changed: new
`apps/webui-static/voice-control.js` (vocabulary matcher, status utterance builder, pure
confirm/revoke state machine, orchestrator, Web Speech feature-detected adapter), `app.js`
(topbar mic toggle wired to the SAME `runWorkspaceAction` Approve/Reject already call,
`opts.reason` override so voice reject skips the blocking `prompt()`), `index.html` (mic
toggle + transcript popover in the topbar), `i18n.js` (IT strings for the 3 new literal
English UI strings), `styles.css` (`.voice-control`/`.voice-line` rules, plus
`.command{min-width:160px}` — see below). `services/reference-control-plane/src/` and
`database/` untouched: this closes purely client-side, same as `D-0267`/`D-0268`/`D-0269`
before it — no capability voice reaches was not already reachable another way.

**Verification**: full suite **1347/1348** (1 pre-existing skip, up from 1325/1326, +22
new), ESLint **262 files 0 errors**, `scripts/test.sh` **10/10**, seeded-defect **19/19**,
`MANIFEST.sha256` **5885/5885**. **Live browser E2E 334/334 PASS**, zero regressions.
**Accessibility audit — a real regression found and fixed in this same phase**: first run
**26/27**, `#globalSearch` measured 22px wide at the audit's 1440px viewport because
`.command{flex:1}` had no `min-width` of its own and the new topbar chip pushed
`.top-actions` wider — `.command` was the one sibling with nothing stopping it from
shrinking. Fixed at the layer the invariant lives in (`.command{min-width:160px}`, not a
narrower voice button that would only defer the same failure to the next topbar addition).
Reran clean: **27/27**, then **334/334** browser E2E reran once more to confirm the CSS fix
itself caused no new regression. Full detail: `docs/DECISION_LOG.md` `D-0270`.

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log →
backup (12.9 MB, service stopped) → §5a (older rollback
`.rollback-panels-tui-20260731T024358Z` removed, predecessor renamed to
`.rollback-voice-control-20260731T062228Z`) → new container from the full `docker inspect`
HostConfig/Env JSON. `Up (healthy)`, `data-plane.ready migrations:19 rls_tables:18`,
`/livez`/`/readyz`/`/healthz` all 200, hardening intact (`ReadonlyRootfs:true
CapDrop:[ALL] RestartCount:0 SecurityOpt:[no-new-privileges:true]`). Byte identity of every
changed source file confirmed via `docker run --entrypoint sh … sha256sum` against the
built image. **Live probe**: `GET /voice-control.js` on the running product answers `200`
with the real source — genuinely served, not merely baked into the image. Post-cleanup
inventory: exactly 2 `noesar-evolution*` containers.

Predecessor: `noesar-evolution.rollback-voice-control-20260731T062228Z`
(`:phase4-panels-tui`). Rollback cost: none on live data — additive files, one additive
topbar element, one additive backward-compatible function parameter, no schema change.

**`D-0123`/`UI-054`/`CE-020` fully closed. Block D (the Owner's "build everything" WebUI
decision) is COMPLETE. Per the four-pause plan, this is pausa 2 — the next block (E+F,
debt+packaging) needs the Owner before starting.**

## 2026-07-31 · `:phase4-audit-ledger-perf` — D-0271 deployed: AuditLedger.append() O(n)→O(1), Block E+F (debt) resumed on Owner instruction
Tag `noesar-evolution:phase4-audit-ledger-perf`, `FROM :phase4-voice-control`. Changed:
`services/reference-control-plane/src/audit.mjs` (`lastHash` cached at construction, no
longer re-read from disk on every `append()`), `+2 audit.test.mjs` tests. Also this pass,
**not deployed** (not baked into any image): `tools/verify-package.py` (unused `sys`
import removed, `D-0039` debt closed), `docs/SBOM_REPORT.md` (fresh SBOM regenerated
against `:phase4-voice-control`, all four documents signed with a session-only Ed25519
demonstration key, all four verified `PASS`, tamper-rejection proven). Full detail:
`docs/DECISION_LOG.md` `D-0271`.

**Verification**: full suite **1349/1350** (1 pre-existing skip, up from 1347/1348, +2
new), ESLint **262 files 0 errors**, `scripts/test.sh` **10/10**, seeded-defect **19/19**,
`MANIFEST.sha256` **5886/5886**.

**Deploy**: `docker stop -t 60` → `postgres.stopped clean:true` confirmed in the log →
backup (12.9 MB, service stopped) → §5a (older rollback
`.rollback-voice-control-20260731T062228Z` removed, predecessor renamed to
`.rollback-audit-ledger-perf-20260731T070727Z`) → new container from the full `docker
inspect` HostConfig/Env JSON. `Up (healthy)`, `data-plane.ready migrations:19
rls_tables:18`, `/livez`/`/readyz` 200/200, hardening intact (`ReadonlyRootfs:true
CapDrop:[ALL] RestartCount:0`). Byte identity of `audit.mjs` confirmed via `docker run
--entrypoint sh … sha256sum` against the built image. Post-cleanup inventory: exactly 2
`noesar-evolution*` containers.

Predecessor: `noesar-evolution.rollback-audit-ledger-perf-20260731T070727Z`
(`:phase4-voice-control`). Rollback cost: none on live data — the hash-chain format on
disk is unchanged, a ledger written before this fix verifies identically to one written
after.

**Block E+F: 3 of 7 debt items closed (unused import, audit ledger O(n), SBOM signing on
all 4 documents), 1 investigated and found worse than described (oci/Dockerfile staleness
— needs its own phase), 2 named out-of-scope (signing-portal, passkey/WebAuthn — net-new
features, not debt), 1 confirmed deliberate design (TLS default off). The penetration-test
item belongs to Block G, untouched here.**
