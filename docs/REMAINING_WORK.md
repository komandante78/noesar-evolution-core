# What remains — measured 2026-07-26

**Purpose.** A session asked "what is left to finish the project?" and the first answer was
wrong twice over: it measured against one instrument and presented that as the whole, and it
reported three components as absent that are not. This file exists so no future session
repeats either mistake.

**Which ruler this file uses.** The **delivered V4 master** in `MASTER_REFERENCE/`, because
that is what `CLAUDE10.md`, `PROJECT_STATE.json` and `docs/SESSION_HANDOFF.md` all point at,
and what every phase from WP-0 to the privacy states was measured against. **There is a
second project** — see "The fork" at the end. It is not the ruler for anything built so far,
and the choice between them is the Owner's.

---

## 0. Two measurement errors, corrected

**Error 1 — one instrument mistaken for the whole.** The first answer was derived from
`DATA/acceptance-matrix.yaml` (11 items). That matrix is narrower than
`00_CONTROL/06_DEFINITION_OF_DONE`, which is in turn far narrower than the 89 master
documents. Three layers, not one — set out in §1, §2, §3 below.

**Error 2 — searching code identifiers instead of the schema.** Four components were reported
as "0 files" by grepping for names like `SecretBroker` — a convention this codebase does not
use. Re-verified today against the schema and the real files:

| Component | Reported | **Actually measured 2026-07-26** |
|---|---|---|
| Secret Broker | 0 files | **partial** — `credential-vault.mjs` exists, 9 files reference it |
| Resource Governor | 0 files | **partial** — quota/rlimit present in observability, logging, `run.sh` |
| Model Trust Registry | 0 files | **dead schema** — `model_descriptors.trust_state` exists with `quarantined/verified/active/revoked` and **no code reads or writes it** |
| Emergency Stop | 0 files | 0 files — confirmed |

**Dead schema is worse than absence**, and it is its own category: a column that exists and
nothing uses tells the next reader the feature is there. The rule that follows — *a column
nobody uses is either removed or wired; leaving it fabricates evidence for whoever looks
next.*

Related: `memory_items.provenance jsonb NOT NULL` already exists and is used, so the memory
work below **extends** rather than starts from zero.

---

## 1. Layer one — the acceptance matrix (`DATA/acceptance-matrix.yaml`)

`verdict_required: PASS` on all eleven. **Only two are recorded in `PROJECT_STATE.json`**,
although WP-0 explicitly asked that every phase result be recorded under its real acceptance
ID. That clerical gap is itself unfinished work.

| ID | Severity | State |
|---|---|---|
| `SEC-003` bypass cannot disable invariants | blocker | **OPEN** — 3 of 7 invariants enforced at a layer this build does not run |
| `OPS-002` cross-platform installation | blocker | **OPEN** — Windows never executed; no install on any other platform |
| `SEC-002` path traversal + symlink race | blocker | **OPEN** — traversal verified, **no symlink-race suite exists** |
| `SEC-004` malicious update/model rejection | blocker | **OPEN** — signature and anti-rollback exist, **no channel key pinned**, so the rejection path is unexercisable |
| `RUN-002` real supported hardware matrix | high | **OPEN** — GPU detected, **not allocated**, `BLOCKED_NO_LOCAL_MODEL` |
| `PKG-001` exactly five final archives | blocker | **OPEN** — Gate 8, never produced |
| `PUB-002` reference reasoning works without ATOM | blocker | **UNCLEAR** — `ReasoningProvider` is zero files; what "reference reasoning" denotes needs settling before it can be tested |
| `PUB-001` public build has no private dependency | blocker | evidence exists (s259) — **needs recording under its ID** |
| `SEC-001` prompt injection cannot grant tool authority | blocker | evidence exists (10 tests, 0 bypass) — **needs recording** |
| `RUN-001` CPU fallback | blocker | evidence exists — **needs recording** |
| `OPS-001` backup restore roundtrip | blocker | evidence exists (25/25 byte-identical) — **needs recording** |

Four need reclassification; six need real work; one needs a definition.

## 2. Layer two — the Definition of Done (`00_CONTROL/06`)

Clauses the matrix does not cover:

- **the commercial edition integrates through frozen contracts** — `05_OPEN_SOURCE_COMMERCIAL`, untouched
- **all V2 capabilities are traced** — `TRACEABILITY_MATRIX.csv` has 14 requirement rows; **nobody has verified they are traced**
- **provenance and signatures exist** — `rust/BUILD_STATUS.md` states of itself
  `RUST_BINARY_INCLUDED=false`, `PROVENANCE_SIGNED=false`
- **five archives pass an *independent* audit** — independent by definition excludes the
  agent that built them
- **ML-BOM** — absent (SBOM exists: CycloneDX 1.7 + SPDX 2.3)

## 3. Layer three — the specified architecture (89 master documents)

This is the layer the first answer omitted entirely, and it is the one that decides whether
"finished" is near. Recorded in `docs/GAP_ANALYSIS_AND_ORIGINALITY_V1.md`, re-verified today.

- **The Security Kernel does not exist as specified — critical.** `30_SECURITY_KERNEL`
  describes an independent Rust authority outside the model with twelve components.
  `noesar-security-kernel` is **37 lines of Rust** performing string checks on a path. The
  specification's central pipeline —
  `AI_PROPOSES → POLICY_DECIDES → USER_OR_POLICY_AUTHORIZES → SANDBOX_EXECUTES → VERIFIER_CHECKS → AUDIT_RECORDS`
  — **appears nowhere in the code.** What decides at runtime is a Node process whose
  directory states its own status: `services/reference-control-plane`. It is the *reference*
  implementation, and nothing was built behind it.
- **`ReasoningProvider` — zero files, critical and strategic.** It is the seam ATOM attaches
  to, cited in five documents, an approved decision, a gate, and the register's gravest risk.
- **Capability-level isolation — high.** `34_AGENT_TOOL_CAPABILITY_SANDBOX` requires
  Landlock, per-profile seccomp, AppArmor/SELinux, cgroups v2, Wasmtime/WASI. Measured: 0
  Landlock, seccomp only as Docker's builtin, 1 incidental WASM mention. Risk `R-015`
  ("one-container requirement weakens isolation", High) is **untreated**: the container is
  the only boundary, so everything inside shares one blast radius.
- **MEVCM — 0 files, high.** `44_MEVCM_MEMORY_AND_CONTAMINATION` specifies memory layers with
  provenance, source class, contamination state, legal hold, causal links, and a promotion
  pipeline with a contamination canary. What exists is retrieval. Funding work package #8.
  Extends `memory_items.provenance`, which already exists.
- **No post-execution verifier — medium.** The ledger records that something happened;
  nothing checks that what happened was what was authorised.
- **Industry Module Framework and compliance packs — high.** Sections 60–66 and 70–77,
  thirteen documents, no implementation. Refusals that exist only in prose are not enforced.
- **Identity narrower than specified — medium.** OIDC/SAML/SCIM zero files; passkeys 3 files.
- **Technology Radar — the "tomorrow" mechanism — not built.**
- **The stack contradicts the frozen decision log — governance.** `V4-D001` (Approved): Rust
  is the primary authority language. `V4-D002` (Approved): TypeScript/React is the canonical
  WebUI. Measured: ~24,500 lines of JavaScript carry the product against ~1,100 of Rust;
  `apps/webui-react` has three files and no component. The choice may be right — **the defect
  is the silence**: the governing documents and the product disagree and nothing records
  which is meant to move.

## 4. WP-2 — five of nine rows unbuilt

(The table in `docs/WORK_PLAN_V4_ALIGNMENT.md` has **nine** rows. Earlier handoffs said
eleven; the count does not survive checking.)

Passkeys/WebAuthn + OIDC + SAML + SCIM (four separate integrations, each needing an Owner
decision about what this product federates with) · the six-role model (neither superset nor
subset of what ships — changes who can do what on a live installation) · compliance evidence
packs · Industry Module Framework · ML-BOM.

## 5. WP-3 — the WebUI

v1 reviewed 2026-07-26 and **not accepted** (`docs/WEBUI_DESIGN_REVIEW_V1.md`). WP-2 has since
added three surfaces to the v1 shell — Workflows, Approvals, the privacy disclosure panel —
which must find a home in whatever information architecture is agreed.

## 6. Blockers and Owner-only items

`B-001` no GitHub remote · `B-002` heuristic secret scan (`detect-secrets` returns 0 findings
on a literal AWS key) · `B-008` two identity stores.

Owner-only: MFA/TOTP, token reuse, step-up auth, client browser test, Owner MFA rotation —
plus the decisions on the role model, what to federate, whether `MANIFEST.sha256` should
cover `MASTER_REFERENCE/` (today **0 of 119 files**: the matrix everything is measured
against is not integrity-protected), and licensing.

Declared debt: TLS is off by default and requires operator configuration either way
(reverse proxy or `NOESAR_TLS_CERT_FILE`/`NOESAR_TLS_KEY_FILE` — see
`docs/LAN_ACCESS_CONFIGURATION.md` § TLS) · no image SBOM beyond the declared inventory ·
**no independent penetration test** · WCAG measured, **not certified** · `F4W-005` QR
encoder proven only for versions 1–6 · `F4-013` the workspace backup is unencrypted and
contains the auth master key · rejecting a staged update answers 501.

## 7. The formal position

`MASTER_REFERENCE/IMPLEMENTATION_GATES.yaml` still carries `current_gate: GATE_0_OWNER_REVIEW`.
By the specification's own gate model **the Owner has never approved the master**, and gates
1 through 8 each require `owner_authorization: required`.

---

## The fork — and it is the Owner's to resolve

A second, complete project exists at `/mnt/user/downloads/NOESAR_EVOLUTION/`: fourteen Italian
documents written 2026-07-25/26, declaring of itself *"progetto. Nulla di quanto segue è
implementato."* It is **not a restyling** of V4. It keeps what V4 decided and rebuilds the
centre, and two of its changes contradict items listed above:

| V4 says | The rewrite says |
|---|---|
| the Security Kernel has twelve components | the same twelve **collapse into one mechanism**: capability tokens |
| the approved WebUI has 26 destinations | the information architecture drops to **11** |
| CodeN has ten lifecycle stages | **sixteen**, none lost — ten conflated distinct things |

It also names two things this file's layer three does not: **capability tokens (zero files,
critical — the mechanism that unifies the twelve)** and **shadow execution (absent — without
it there is no self-correction)**. And its §1 is a corrected version of the same measurement,
which is where the "dead schema" category in §0 comes from.

**This matters because the two rulers imply different products.** Building V4's twelve
security components and building the rewrite's single capability-token mechanism are not the
same work, and doing the first would be building against a design the second supersedes.

Nothing in this repository has been measured against the rewrite. Until the Owner says which
is the plan of record, §1–§7 above remain the operative list, and this section is the reason
to ask before starting anything in layer three.
