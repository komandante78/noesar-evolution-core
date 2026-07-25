# NOESAR EVOLUTION — Phase Plan

Six phases, numbered 0 through 5. Exactly one phase is executed per invocation.
A phase ends with state updated, handoff written, commit made, and a full stop.

| Phase | Title |
|---|---|
| 0 | Bootstrap, governance, persistent state and private Git repository |
| 1 | Canonical extraction and repository construction |
| 2 | Host preflight and installation design |
| 3 | Isolated build and Unraid installation |
| 4 | End-to-end acceptance, remediation, security and rollback |
| 5 | Complete documentation, licensing audit, release and final packaging |

## Phase 0 — Bootstrap, governance, persistent state and private Git repository

Establish the permanent workspace, the binding rules for Claude Code, the resumable
state and handoff files, the internal skill, and the private Git repository.
Verify the five source archives by SHA-256 without extracting the product.

**Explicitly out of scope:** extraction, build, container work, installation.

## Phase 1 — Canonical extraction and repository construction

Extract the verified archives into a canonical source tree inside the project and
construct the repository layout from it. Establish what is tracked, what is ignored,
and where the open-core boundary falls. No build, no installation.

## Phase 2 — Host preflight and installation design

Assess the host against the product's stated requirements and design the
installation: topology, ports, volumes, resource envelope, configuration surface,
secret handling, and rollback plan. Design only — nothing is installed.

## Phase 3 — Isolated build and Unraid installation

Build in isolation, then install on Unraid according to the Phase 2 design.
Backups precede every mutation; rollback stays available at all times.

## Phase 4 — End-to-end acceptance, remediation, security and rollback

Run end-to-end acceptance against the installed system, remediate what fails,
perform the security review, and verify that rollback actually works. Results are
reported as observed — no unverified PASS.

## Phase 5 — Complete documentation, licensing audit, release and final packaging

Complete the documentation set, audit licensing and dependency compliance against
the open-core and ATOM-boundary constraints, prepare the release, and produce the
final packaging.

## Invariants across all phases

- One phase per invocation; the next phase is never anticipated.
- Nothing outside `PROJECT_ROOT` is modified.
- No container, database, network, or external dataset is touched without an
  explicit instruction naming it.
- No secret, archive, binary, model, cache, or database enters the repository.
- English is canonical for code, APIs, logs, and technical documentation.
- The FOSS core never depends on ATOM.
