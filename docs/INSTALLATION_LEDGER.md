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

### Git

Repository initialised locally inside `PROJECT_ROOT`. The five archives are excluded
by `.gitignore` and were never staged.

### Secret scan

`gitleaks` is not installed on this host and the rules forbid installing new tooling
to satisfy the scan, so a **heuristic scan** was run instead and is declared as such.
Result and method are recorded in `docs/SESSION_HANDOFF.md`.

### GitHub

`gh` is not installed on this host, so the private remote could not be created.
Recorded as `GITHUB_STATUS=BLOCKED_AUTHENTICATION`. No token was written to any file.
The local repository was completed regardless.
