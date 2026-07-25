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

As of the end of Phase 0, the following is established by direct evidence:

- The five archives exist at `/mnt/user/downloads/NOESAR_EVOLUTION_FINAL`.
- All five SHA-256 checksums match the expected values exactly, and match the
  vendor manifest shipped alongside them.
- The archives carry a ` (2)` duplicate-download suffix in their filenames; content
  is unaffected (see `docs/DECISION_LOG.md`, D-0003).
- The workspace, governance files, state files, and local Git repository exist.

**Nothing about the product's internals has been verified**, because Phase 0
explicitly forbids extraction. Any statement about NOESAR EVOLUTION's architecture,
dependencies, ports, or capabilities is `[UNVERIFIED]` until Phase 1 opens the
archives and Phase 2 reads them against this host.

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
- **`.claude/skills/noesar-evolution/SKILL.md`** — the fixed 13-step phase cycle
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

## 7. Known open items entering Phase 1

- GitHub remote not created — `gh` is not installed on this host
  (`GITHUB_STATUS=BLOCKED_AUTHENTICATION`).
- Secret scanning is heuristic only — `gitleaks` is not installed.
- Archive filenames carry a ` (2)` suffix and were deliberately not renamed.
