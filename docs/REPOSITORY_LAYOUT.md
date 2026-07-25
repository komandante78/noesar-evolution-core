# NOESAR EVOLUTION — Repository Layout

The canonical repository as constructed in Phase 1. File counts are tracked files.

---

## Product source (repository root — no artificial wrapper directory)

| Path | Files | Contents | Authority |
|---|---|---|---|
| `rust/` | 5,231 | Rust workspace: 12 first-party crates + 113 vendored crates | 01 |
| `services/` | 47 | reference control plane (Node/ESM) | 01 |
| `apps/` | 7 | web UI application | 01 |
| `database/` | 50 | schema, migrations, adapters | 01 |
| `capabilities/` | 43 | capability framework, reference implementation, examples | 03 |
| `schemas/` | 41 | JSON schemas / public contracts | 03 |
| `packages/` | 6 | SDK packages | 03 |
| `ai-workspace/` | 22 | AI workspace runtime | 03 |
| `private-boundary/` | 2 | **public** ATOM provider contract + boundary declaration | 03 |
| `security/`, `sbom/`, `conformance/` | 3 | security policy, SBOM, conformance | 04 |
| `tests/` | 15 | test suites | 01/04 |
| `deployment/`, `oci/`, `scripts/`, `updates/`, `hardware-probes/` | 30 | deployment and runtime packaging | 02 |
| `operations/` | 53 | operational runbooks and runtime ops | 05 |
| `tools/` | 10 | verification and provenance tooling | 01 |
| `evidence/` | 30 | in-product evidence set | 01/04 |
| root files | 8 | `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `STATUS.md`, `MANIFEST.sha256`, `PACKAGE_METADATA.json`, `package.json`, `VERIFY_REPORT.txt` | 01 |

## Delivered documentation and governance

| Path | Files | Contents |
|---|---|---|
| `MASTER_REFERENCE/` | 75 | Master Specification V4 and its control/architecture sections |
| `PROJECT_GOVERNANCE/` | 117 | governance corpus (control, product, architecture, security, AI platform, open-source/commercial, compliance, industry modules, operations, legal templates) |
| `DOCUMENTATION/` | 47 | package-level documentation across all five packages |
| `docs/` | 75 | product documentation **plus** this project's phase governance documents |
| `EVIDENCE/` | 26 | delivered evidence sets |
| `INSTALLATION/` | 4 | installer material |
| `RELEASE/` | 5 | release material |
| `FUNDING/` | 17 | funding and FOSS-scope documentation |
| `LICENSES/` | 1 | product licensing boundary |
| `provenance/` | 26 | the five packages' envelopes (`README`, `PACKAGE_METADATA.json`, `CONTENTS_MANIFEST.tsv`, `SHA256SUMS.txt`, `LICENSES/`) preserved per package |

## Project governance (authored here, not delivered)

| Path | Purpose |
|---|---|
| `CLAUDE.md` → `CLAUDE10.md` | the binding operating authority |
| `.claude/skills/noesar-evolution/SKILL.md` | the mandatory 13-step phase cycle |
| `PROJECT_STATE.json` | machine-readable resume point |
| `docs/SESSION_HANDOFF.md` | human-readable resume point |
| `docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md` | append-only records |
| `docs/PHASE_PLAN.md`, `docs/PROJECT_SUMMARY_FROM_INCEPTION.md` | plan and inception summary |
| `docs/LICENSE_STRATEGY.md`, `docs/FUNDING_ALIGNMENT.md`, `docs/ATOM_PUBLIC_PRIVATE_BOUNDARY.md` | strategic invariants |
| `docs/SOURCE_*.md/tsv`, `docs/PACKAGE_CONTENT_MAPPING.tsv`, `docs/PATH_CONFLICTS.tsv`, `docs/REPOSITORY_LAYOUT.md`, `docs/INSTALLABLE_ARTIFACT_MAP.md`, `docs/LICENSE_INVENTORY.tsv`, `docs/THIRD_PARTY_NOTICES_DRAFT.md`, `docs/DUAL_LICENSE_READINESS.md`, `docs/ATOM_BOUNDARY_AUDIT.md`, `docs/PHASE_1_CANONICAL_EXTRACTION_REPORT.md` | Phase-1 outputs |

> `docs/` deliberately holds both product documentation and phase governance. The 67
> incoming product documents have no filename collision with the governance set, and
> the governance files are protected against overwrite by name.

## Deliberately outside the repository

| Location | Contents | Why |
|---|---|---|
| `$STAGING` = `/mnt/cachec/NOESAR_EVOLUTION_STAGING/PHASE_1` | the five extracted packages | extraction scratch; never a Git path |
| `$ARTIFACT_ROOT` = `/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS` | `prebuilt/linux-x86_64/` (2 ELF binaries + provenance), `vendor-binary-fragments/` (4 compiled vendored fragments) | compiled binaries are forbidden in the repository (`CLAUDE10.md` §33) |
| `BACKUPS/` (ignored) | pre-merge snapshot of the Phase-0 governance files | backup discipline (`CLAUDE10.md` §22) |
| `/mnt/user/downloads/NOESAR_EVOLUTION_FINAL` | the five source ZIPs | never added to Git, never modified |

## Scale

6,025 files on disk, **6,007 tracked**, 90 MB. `rust/vendor/` alone is 5,203 files
and ~80 MB — 87% of the repository is vendored third-party Rust source, retained
deliberately so the workspace can build offline.
