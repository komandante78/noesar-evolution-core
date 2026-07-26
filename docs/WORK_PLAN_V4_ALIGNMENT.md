# Work Plan — alignment with MASTER PROJECT V4

**Written:** 2026-07-26 (UTC)
**Supersedes:** the "exact next action" in `SESSION_HANDOFF.md`, which pointed at Phase 5.
**Status of this plan:** proposed. Nothing in it has been authorised or started.

---

## Why this document exists

Every phase of this installation has been measured against the documentation shipped
inside the five product ZIPs. It has never been measured against
`NOESAR_EVOLUTION_MASTER_PROJECT_V4.zip`, the master specification — because **the parts
of that specification which define "done" were never in the repository.**

The zip was verified this session: SHA-256 `c8d536f5f7515c0f7e05436009fe677d3de3721f58281e6fa3b9bf959c33528a`,
matching its own sidecar; internal manifest 120/120; 121 files.

Of those, **75 are already in `MASTER_REFERENCE/` and byte-identical. 46 are absent**,
and they are exactly the measuring instruments:

```text
08_OPERATIONS/85_ACCEPTANCE_MATRIX.md      the acceptance criteria
DATA/acceptance-matrix.yaml                the same, machine-readable, with severities
IMPLEMENTATION_GATES.yaml                  the nine gates and their authorisation rule
TRACEABILITY_MATRIX.csv                    requirement -> document -> delivery ZIP
OWNER_REVIEW_CHECKLIST.md                  what the Owner is asked to approve
HANDOFF/ (4)  09_LEGAL_TEMPLATES/ (6)  DATA/ (9)  REFERENCES/ (6)  TOOLS/ (2)  root (12)
```

The master package declares its own state as `IMPLEMENTATION=NOT_STARTED`,
`FINAL_PRODUCT_ZIPS=0/5`, `current_gate: GATE_0_OWNER_REVIEW`, dated 22 July. The five
product ZIPs are dated 25 July. So a third party executed the implementation gates and
delivered; **whether that delivery satisfies the master specification is the open
question, and the answer is: substantially, but not completely.**

---

## WP-0 · Bring the measuring instruments into the repository

**Nothing else in this plan can be verified until this is done.** Copy the 46 missing
files into `MASTER_REFERENCE/`, restate `PROJECT_STATE.json` against
`DATA/acceptance-matrix.yaml` instead of against the handoff, and record every existing
phase result under its real acceptance ID.

Cost: small. Value: it is the only thing that makes the rest of this plan checkable.

> The two nested archives under `REFERENCES/` (V2 engineering handoff, V3.1 master
> handoff) are ZIPs. Repository hygiene (CLAUDE10 §9 rule 33) forbids archives in the
> repository, so they stay in `$ARTIFACT_ROOT` with their checksums recorded, and only
> `REFERENCE_CHAIN.md` and `DEPRECATED_WORKING_ARCHIVES.md` are tracked.

---

## WP-1 · The two blockers of the specification's own acceptance matrix

These are `severity: blocker` in `DATA/acceptance-matrix.yaml`. They are the highest
priority technical work in this plan.

### SEC-003 — "Owner bypass cannot disable invariants" · never tested
The product ships an `OWNER_BYPASS` mode and lists five non-bypassable invariants in the
interface. No test anywhere exercises the claim that bypass cannot switch them off. A
claim in the UI that no test defends is the defect class this project keeps finding.
Needs: an adversarial suite that enters bypass and attempts each invariant.

### OPS-002 — "cross-platform installation" · one platform of five
`deployment/` carries `linux/`, `macos/`, `windows/`, `podman/` and `unraid/`. The
hardening regression covers **four scripts** — `INSTALLATION/install-unraid.sh`,
`deployment/unraid/install-complete.sh`, `deployment/docker/run.sh`,
`deployment/lib/network-access.sh`. The Linux, macOS, Windows and Podman installers have
never been executed or tested. `Install-Noesar.ps1` has never run on Windows.

### Also in the matrix, not yet closed
- `SEC-002` — path traversal is verified; **no symlink-race suite exists**.
- `SEC-004` — signature verification and anti-rollback exist, but **no channel key is
  pinned**, so the malicious-update rejection path cannot be exercised end to end.
- `RUN-002` — GPU detected, not allocated; inference `BLOCKED_NO_LOCAL_MODEL`.
- `PKG-001` — the five final archives are Gate 8 and have not been produced.

---

## WP-2 · Features the specification requires and the product does not have

| Requirement | Source | Reality |
|---|---|---|
| **Workflows** — typed steps, retries, compensation, idempotency, timeout, cancellation, human approval, replay | `04_AI_PLATFORM/46` | **BUILT in source, 2026-07-26.** Engine, routes and a `Workflows` destination; all nine named properties covered by tests, each shown to fail before it passed. One honest limit: `host_mutation` is a declared step type this build **refuses**, because `executionEnabled:false` and there is no execution surface here — `D-0079`. **Not deployed.** |
| **Approval queue** and the bottom approval strip | `01_PRODUCT/11` (binding) | **BUILT in source, 2026-07-26.** One queue over workflow gates, agent steps and staged updates, owning no copy of any of them; the footer is now a permanent approval strip. Rejecting a staged update answers 501 and says why — `D-0081`. **Not deployed.** |
| **Passkeys / WebAuthn, OIDC, SAML, SCIM** | `01_PRODUCT/14` | `passkeySupported:false`; zero references to OIDC, SAML or SCIM anywhere in the source |
| **Role model**: User, Professional, Developer, Workspace Admin, Security Admin, Owner | `01_PRODUCT/14` | Shipped model is owner / admin / developer / user / client_restricted / service_account. Neither a superset nor a subset — a different model |
| **Seven privacy states** incl. `EXTERNAL_CONNECTOR_PENDING`, `STATUS_UNKNOWN` | `01_PRODUCT/12` | **BUILT in source, 2026-07-26.** All seven states, each with a producer a test exercises. The indicator is now **derived** from enabled providers and consented connectors rather than stored — a refused egress plan used to leave the whole installation reporting `REMOTE_MODEL_ACTIVE`, and the stored value asserted "verified" before anything was verified (`D-0087`). Eight disclosure elements per external destination, retention at the destination declared unknowable rather than invented (`D-0089`); a revoke control that is wired and is not advertised to callers whose role would be refused it (`D-0091`); update metadata bounded by construction with the disclosure derived from its producer (`D-0090`); telemetry posture declared and defended by a test (`D-0092`). Measured first: **18 of 25 checks failed against the unfixed code**. **Not deployed.** |
| **Compliance evidence packs** per jurisdiction | `06_COMPLIANCE/60-66` | Absent |
| **Industry Module Framework** | `07_INDUSTRY_MODULES/70-77` | Absent (Gate 6) |
| **ML-BOM** alongside SBOM | `00_CONTROL/06` Definition of Done | SBOM exists (CycloneDX 1.7 + SPDX 2.3). No ML-BOM |
| **WCAG 2.2 AA** — keyboard, screen reader, visible focus, scaling, reduced motion, high contrast, RTL | `01_PRODUCT/15` | **MEASURED and repaired in source, 2026-07-26.** `npm run test:accessibility` reports 26/26 after seven failures across five criteria were found and fixed: no skip link (2.4.1), 23 controls with no focus indicator (2.4.7), 19 sub-24px targets (2.5.8), 4.19:1 contrast on every primary button (1.4.3), a missing input-purpose token (1.3.5), six unneutralised `!important` colours, and RTL horizontal overflow. **Measured, not certified** — no real screen reader runs, and the audit prints its own NOT_TESTED block every run (`D-0084`). **Not deployed.** |

---

## WP-3 · WebUI — reorganise by category, add themes

The specification calls `DESIGN/APPROVED_WEBUI_REFERENCE.png` **binding**, and requires
"simple before technical, progressive disclosure" and "visual regression and Owner
review" before the UI is final. The deployed interface satisfies neither: it has 21 flat
nav entries, and against the binding reference it is missing the central composer, the
quick actions, the active-tasks panel and the bottom approval strip.

**Proposal published for review:** an interactive prototype of the shell —
26 destinations in **five categories**, nine user-selectable themes, the privacy state
promoted to a persistent edge indicator, and the approval strip made permanent.

```text
Workspace      Home · Chat · Projects · Tasks · Artifacts · Knowledge · Memory
Automation     Agents · Workflows* · Tools · Approvals*
Intelligence   Models · Providers · Compute · CodeN Ultra
Governance     Security · Users & Access · Privacy & Data · Audit · Compliance*
System         Health · Logs & Diagnostics · Updates · Backups · Settings · About
                                                              (* required, not built)
```

Design decisions and the research behind them are recorded in the prototype itself.
Themes are remaps of seven semantic tokens; semantic colour (good / warning / critical)
is deliberately held **separate from the accent**, so choosing a palette can never make a
critical state unreadable.

**Not yet done, and stated rather than implied:** the prototype is the shell only. It is
not wired to the API, 22 of the 26 views are undrawn, and nothing has been through a
keyboard-only or screen-reader pass. Accessibility is measured after the shape is agreed.

**Gate: Owner review. → v1 was reviewed on 2026-07-26 and NOT ACCEPTED.**

See `docs/WEBUI_DESIGN_REVIEW_V1.md` for the full record. Four corrections, one of which
changes the information architecture rather than the styling:

- the right context rail must be a **dockable, dismissible panel**, not a fixed column;
- **three conversational surfaces are missing entirely** — a Claude-style chat, a CodeN
  Ultra chat, and the CodeN Ultra TUI. The existing CodeN Ultra product is the reference
  for what is meant;
- the rail must **collapse**;
- **one Settings destination**, holding language, appearance (all nine themes), licence
  activation and the product's own settings — instead of eleven administrative
  destinations promoted into the navigation.

The last one is the Owner agreeing with the specification against v1: `01_PRODUCT/11`
requires progressive disclosure and the binding reference has a single `Settings` entry.
v2 must re-derive the whole IA from that constraint, not restyle v1.

Nothing is built until a revised proposal is accepted.

---

## WP-4 · Phase 5, when it is actually reachable

The licensing backlog inherited from Phase 1 is unchanged and still real: 12 first-party
Rust crates and 2 Node packages with no declared licence, no root `LICENSE`, 86
first-party sources with no SPDX header, the three-way split still a proposal, and **0
declared licences across the Rust tree in the source SBOM**, so conclusions there must be
reached by hand.

`08_OPERATIONS/84_FIVE_ZIP_DELIVERY_PLAN.md` and `86_FINAL_HANDOFF_PROTOCOL.md` — both
currently missing from the repository — govern what Gate 8 must produce.

---

## Proposed order

1. **WP-0** — instruments into the repository. Everything else is unmeasurable first.
2. **WP-3 gate** — Owner accepts, amends or rejects the UI direction. Cheap to iterate now, expensive after the views are built.
3. **WP-1** — SEC-003 and OPS-002, the two blockers.
4. **WP-2** — Workflows and the approval queue first, since one is a claim the API already makes.
5. **WP-4** — Phase 5 only once the above are true.

## What this plan deliberately does not do

It does not renumber the phases, restate `NEXT_PHASE`, or reopen `B-007`. Those are
state changes, and state is not edited on the strength of a proposal. `B-007` is
genuinely closed: the ten sections were built, deployed and verified. What this document
adds is that **closing `B-007` was never the same thing as satisfying the specification**,
and the handoff should stop implying it was.
