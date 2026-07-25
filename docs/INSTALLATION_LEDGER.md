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
