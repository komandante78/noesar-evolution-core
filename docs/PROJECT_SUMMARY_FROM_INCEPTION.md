# NOESAR EVOLUTION — Project Summary from Inception

**Written at:** Phase 0, 2026-07-25T01:13:11Z
**Purpose:** give any future session — human or agent — the full picture from the
beginning, without needing a prior conversation.

---

## 1. What this project is

NOESAR EVOLUTION is delivered as a set of **five sealed source archives** that
together constitute a complete product: source, runtime and deployment, capabilities
and SDK, security and acceptance, and final release/operations material.

This workspace exists to take those archives and turn them into an installed,
verified, documented, licensed, and releasable system on this host, through six
governed phases — without improvising, without losing state between sessions, and
without a single unverified claim of success.

## 2. What is verified so far

As of the end of **Phase 1**, the following is established by direct evidence:

- The five archives exist at `/mnt/user/downloads/NOESAR_EVOLUTION_FINAL`, and all
  five SHA-256 checksums match — verified twice, in Phase 0 and again in Phase 1.
- The archives carry a ` (2)` duplicate-download suffix; they are therefore
  identified by hash only, never by name (D-0003, D-0008).
- All five are structurally safe: no traversal, symlinks, device files, nested
  archives or case-collisions.
- **The canonical repository is constructed** — 5,984 tracked files, 90 MB — and its
  correctness is confirmed independently by the product's own `MANIFEST.sha256`
  verifying **5,606/5,606** at the repository root.
- The product is **12 first-party Rust crates plus 113 vendored crates**; the
  vendored tree verifies **5,090 files OK, 0 corrupt, 4 missing** (blocker B-003).
- Static checks pass: JSON 121/121, `bash -n` 46/46, `node --check` 87/87.
- **No ATOM implementation is present** — only a public contract and boundary
  documentation.

**Still unverified:** anything requiring execution. Nothing has been built, started,
installed, or benchmarked. Statements about runtime behaviour, ports, resource needs,
or whether the core truly runs without ATOM remain `[UNVERIFIED]` until Phases 3–4.

## 3. Archive inventory (by declared name)

| # | Archive | Declared role |
|---|---|---|
| 01 | `…_01_COMPLETE_PRODUCT_SOURCE_V4_FINAL.zip` | complete product source |
| 02 | `…_02_RUNTIME_AND_DEPLOYMENT_V4_FINAL.zip` | runtime and deployment |
| 03 | `…_03_CAPABILITIES_AND_SDK_V4_FINAL.zip` | capabilities and SDK |
| 04 | `…_04_SECURITY_AND_ACCEPTANCE_V4_FINAL.zip` | security and acceptance |
| 05 | `…_05_FINAL_RELEASE_AND_OPERATIONS_V4_FINAL.zip` | final release and operations |

Roles are taken from the archive names as supplied; their contents are unexamined.

## 4. How the work is governed

- **`CLAUDE.md`** — entry point; imports the authority file.
- **`CLAUDE10.md`** — the sole binding authority: scope, non-destruction, external
  systems off-limits, secrets, honesty, documentation duty, Git discipline,
  language, open core, ATOM boundary, licensing posture.
- **`.claude/skills/noesar-evolution/SKILL.md`** — the fixed 14-step phase cycle
  every phase must follow, ending in `STOP`.
- **`PROJECT_STATE.json`** — machine-readable resume point.
- **`docs/SESSION_HANDOFF.md`** — human-readable resume point, rewritten each phase.
- **`docs/INSTALLATION_LEDGER.md`** — append-only record of what actually happened.
- **`docs/DECISION_LOG.md`** — append-only record of decisions and their consequences.

## 5. The six phases

Defined in `docs/PHASE_PLAN.md`: bootstrap (0), extraction and repository (1),
preflight and installation design (2), build and Unraid installation (3), acceptance,
security and rollback (4), documentation, licensing audit and release (5).

Exactly one phase runs per invocation. The next phase is never anticipated.

## 6. Strategic constraints fixed at inception

1. **Open core that stands alone.** The FOSS core must be complete and independently
   useful — a working product on its own, not a teaser.
2. **ATOM is proprietary and separate.** The core must not require ATOM to build,
   start, pass tests, or deliver documented functionality. Integration happens
   through public interfaces only, and no proprietary ATOM implementation ever
   enters a public repository. See `docs/ATOM_PUBLIC_PRIVATE_BOUNDARY.md`.
3. **Funded work must be FOSS.** Anything that cannot be released as FOSS is not
   funded work. See `docs/FUNDING_ALIGNMENT.md`.
4. **Licensing is a proposal, not a ruling.** AGPL-3.0-or-later proposed for the
   open core, additional commercial license planned, both pending legal review.
   See `docs/LICENSE_STRATEGY.md`.
5. **English is canonical** for code, APIs, logs, and technical documentation; UI
   localization is a separate layer.
6. **Private until decided otherwise.** The repository stays private until an
   explicit, recorded decision to publish.

## 7. Known open items entering Phase 2

- **B-001** — GitHub remote not created; `gh` is not installed and no token is set
  (`GITHUB_STATUS=BLOCKED_AUTHENTICATION`, `GIT_PUSH=BLOCKED_NO_REMOTE`). The local
  repository is complete and committed.
- **B-002** — secret scanning is heuristic only; `gitleaks`/`trufflehog` unavailable
  and installing new tooling is forbidden.
- **B-003 (new in Phase 1)** — `rust/vendor/cc-1.3.0/src/target/` is missing four
  upstream source files in every shipped archive, because the packaging filter that
  strips `target/` build output also removed a legitimate source directory. Not
  fixed: recreating them would mean fabricating upstream content. Impact is bounded
  (`cc` is not compiled on linux-x86_64). **Phase 2 must decide the resolution.**
- Archive filenames still carry the ` (2)` suffix and are still not renamed.

## 8. What Phase 1 taught us that changes how we work

Two lessons worth carrying:

1. **Rules written before seeing the material encode guesses.** The Phase-0
   `.gitignore` was reasonable in the abstract and wrong in practice — it silently
   deleted the cargo vendoring configuration and a public key the examples need. A
   repository that looks complete but cannot build is the worst failure mode,
   because nothing surfaces it until much later. Verify policy against reality at
   the first opportunity.
2. **A delivery's own claims are evidence, not proof.** The packages assert a
   "complete vendor snapshot" and record an aggregate hash; both are contradicted by
   the shipped bytes. Independent recomputation found it — checking is cheap and
   worth doing every time.
