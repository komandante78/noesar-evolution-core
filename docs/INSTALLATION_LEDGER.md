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
