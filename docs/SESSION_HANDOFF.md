# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. A cold session should be able to resume from this
file and `PROJECT_STATE.json` alone.**

---

## Current position

| Field | Value |
|---|---|
| Phases completed | **4 — completion gate, LAN access gate, WebUI remediation, WebUI completion** |
| Phase status | `COMPLETED_WITH_COMPLETION_GATE_LAN_ACCESS_GATE_AND_WEBUI_COMPLETION` |
| **Next phase** | **5 — documentation, licensing audit, release, packaging** |
| `NEXT_PHASE` | `5_READY` |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Updated (UTC) | 2026-07-26 |

> ## ➜ The actual next action is a conversation, not a phase
>
> On 2026-07-26 the Owner commissioned a **design for CodeN Evolution** and said explicitly
> that the next session would discuss the proposal. It is written and waiting:
>
> - **`docs/CODEN_EVOLUTION_DESIGN_V1.md`** — the full design.
> - **`docs/WEBUI_DESIGN_REVIEW_V1.md`** — what was rejected in WebUI proposal v1.
>
> **Do not start Phase 5, and do not start building CodeN Evolution.** Both wait on that
> conversation. Five decisions are listed at the end of the design document and are the
> Owner's to take — how far unattended autonomy goes, whether the two shells ever diverge,
> one container or a second supervised process, whether the reference provider gets
> simulation, and how to rename `47_CODEN_ULTRA_PRODUCT_SPEC`.
>
> Settled already, and not to be reopened: the name is **CodeN Evolution**; it is **one
> program in two shells** (WebUI and SSH) attaching to the same live session; **ATOM is the
> mandatory reasoning path but never a requirement** — the public reference provider must
> keep the product fully usable; and **work data never reaches the internet and never enters
> the product's own semantics**.

**The interface is finished, deployed and reachable.** Container `noesar-evolution`,
image **`noesar-evolution:phase4-webui`**, published on `192.168.178.100:8100`, healthy,
17 components, 0 degraded, `RestartCount=0`. The Owner account, the database and the
workspace are untouched by the swap.

# ➜ http://192.168.178.100:8100

---

## What the Owner can now do that they could not before

1. **Rotate the compromised TOTP secret.** Security → *Replace authenticator*. Enter the
   current password and a live code, scan the QR (or type the key), then confirm with
   **two consecutive codes** from the new authenticator. The current authenticator keeps
   working until the moment of confirmation, and the swap is atomic. Ten new recovery
   codes are shown once afterwards. The whole flow is driven end to end by the browser
   suite, including a check that the superseded secret is then refused with `401`.
2. Change password, regenerate recovery codes, list and revoke sessions.
3. Settings (time zone with its resolution tiers, locale), Users and invitations, Tools,
   Providers, System Health, Updates, Logs with debug mode, Backups, About.

`OWNER_MFA_ROTATION=AWAITING_OWNER_INTERACTION` — it needs the Owner's own password and
live codes, and rotating on their behalf is not this phase's to do.

---

## Verified in this phase

```text
browser acceptance      174/174    every route, in a real browser
unit tests              507/507    488 before; +6 role permissions, +13 markup structure
eslint                  143 files, 0 errors, 0 warnings, 0 no-undef
installer hardening     100/100
MANIFEST                5690/5690  5 refreshed, 4 appended, 0 removed
runtime backup          1868/1868  verified, taken at rest after a clean stop
pg_dump                 123,664 bytes with a sha256 sidecar, taken while running
```

Live, after the swap: `livez/readyz/healthz` 200, `/metrics` and `/diagnostics` **401**
(the LAN hardening is preserved), `auth/status.initialized true`, 16/16 migrations, 15
RLS-forced tables, pgvector 0.8.5, and the served `app.js` hashing **identical** to the
repository. `GET /api/v1/auth/security` answers `401` where it answered `404` before.

A read-only browser smoke against the live installation reports 21 nav entries, 23 view
sections and **zero nested views**. Its three console messages are all expected: the COOP
advisory that a plaintext origin is untrustworthy (TLS is a declared gap), the favicon
404, and the `401` from the unauthenticated `/auth/me` probe that drives the login form.

---

## The defect worth remembering

`F4W-008`, high, **present in the delivered product**, and the actual cause of "clicking
Agents, Tools or Knowledge does nothing".

`<section class="view" id="view-tasks">` was never closed — 35 `<section>` opens against
34 closes. HTML does not auto-close a `<section>` when the next one opens, so **nine
views became DOM children of Tasks**: Artifacts, Knowledge, Memory, Models, Agents, CodeN
Ultra, Compute, and the 404 and access-denied pages the previous phase had just built. A
`.view` is `display:none` unless it carries `.active`, and an element inside a
`display:none` ancestor has no box however active it is. Those panels were fetched,
populated, marked active — and invisible.

It survived a full acceptance phase and a WebUI remediation phase because both checked
`classList` rather than whether anything was on screen. The previous phase's conclusion —
"navigation itself was not broken, all 11 nav entries switch panels correctly" — was true
of the class and false of the screen. `services/reference-control-plane/test/webui-markup-structure.test.mjs`
now pins tag balance and view nesting, and was verified to fail against the delivered file.

Two defects introduced by this phase are declared separately: `F4W-009` (a form carrying
both `form-stack` and `inline-form` collapsed its button to 0x0) and `F4W-010` (the first
version of the route check tested `innerText`, which falls back to `textContent` for an
element that is not rendered, so it passed on nine invisible pages). Three further
defects were in the harness rather than the product and are recorded in
`docs/PHASE_4_WEBUI_COMPLETION_REPORT.md` §3 rather than quietly fixed.

---

## Open blockers

### B-001 — no GitHub remote · medium · unchanged
`gh` is not installed, no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. The local
repository is complete and committed.

### B-002 — secret scan is heuristic · low · unchanged
Neither `gitleaks` nor `trufflehog` is installed. ESLint, shellcheck, semgrep and
detect-secrets cover what they cover; credential scanning stays heuristic and is declared
as heuristic wherever reported.

### B-008 — two identity stores · medium · does not block Phase 5
The account that signs in lives in `RUNTIME_ROOT/state/auth.json`.
`noesar_identity.users` in PostgreSQL — the table the completion gate's multi-user
acceptance exercised — is **empty** on the real installation. That acceptance does not
cover the login path. A data-model decision with migration consequences; it needs a phase
of its own.

### B-005, B-006, B-007 — **CLOSED**.

---

## ⚠️ Read this before planning anything

**The product has never been measured against its own master specification.**

`NOESAR_EVOLUTION_MASTER_PROJECT_V4.zip` was verified this session (SHA-256
`c8d536f5…`, matching its sidecar; internal manifest 120/120; 121 files). Of those, 75
are already in `MASTER_REFERENCE/` and **byte-identical** — and **46 are absent**. The
absent ones are precisely the measuring instruments: `08_OPERATIONS/85_ACCEPTANCE_MATRIX.md`,
`DATA/acceptance-matrix.yaml`, `IMPLEMENTATION_GATES.yaml`, `TRACEABILITY_MATRIX.csv`,
`OWNER_REVIEW_CHECKLIST.md`, the `HANDOFF/`, `09_LEGAL_TEMPLATES/`, `DATA/`, `REFERENCES/`
and `TOOLS/` directories.

So every phase so far has been checked against the documentation shipped inside the five
product ZIPs, never against the specification those ZIPs were meant to satisfy. Against
the master acceptance matrix, two `severity: blocker` items are open — `SEC-003` (Owner
bypass cannot disable invariants: **never tested**) and `OPS-002` (cross-platform
installation: **four scripts covered of the Linux / macOS / Windows / Podman / Unraid
set**) — and several required features are absent, including **Workflows, which
`/api/v1/bootstrap` already claims in its feature list**.

**`docs/WORK_PLAN_V4_ALIGNMENT.md` is the current plan of record.** Read it before this
section.

`B-007` remains genuinely closed — the ten sections were built, deployed and verified.
Closing it was never the same thing as satisfying the specification, and this handoff
should not be read as implying otherwise.

## Exact next action

**First action on reopening: produce WebUI proposal v2.** The Owner reviewed v1 on
2026-07-26, did **not** accept it, and asked explicitly that the new preview be made in a
fresh session rather than in the one that took the feedback. He expects more attempts.

Read `docs/WEBUI_DESIGN_REVIEW_V1.md` first — it holds the four corrections verbatim and
what each one means. In short: the context rail becomes a dockable, dismissible panel; the
rail collapses; **three conversational surfaces that v1 omitted entirely** (Claude-style
chat, CodeN Ultra chat, CodeN Ultra TUI) must be drawn; and the eleven administrative
destinations collapse into **one Settings page** holding language, appearance (all nine
themes), licence activation and the product's settings. That last one requires
re-deriving the information architecture, not restyling v1.

There is **one open question to ask before building**: three separate chat destinations,
or one Chat destination containing three surfaces.

**Then, not before:** `docs/WORK_PLAN_V4_ALIGNMENT.md` — bring the 46 missing
specification files into the repository (WP-0) so the rest is measurable, then the two
acceptance blockers (WP-1), then the missing features (WP-2).

Phase 5 as originally described — documentation, licensing audit, release, packaging —
is WP-4 and stays below. One phase per invocation, and none starts without explicit
authorisation.

1. Read `PROJECT_STATE.json`, this file, `docs/PHASE_PLAN.md`,
   `docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md` — in that order.
2. **The licensing backlog inherited from Phase 1 is the substance of it:** 12 first-party
   Rust crates and 2 Node packages with no declared licence, no root `LICENSE`, 86
   first-party sources with no SPDX header, and the three-way licence split still only a
   proposal in `docs/LICENSE_STRATEGY.md`. The source SBOM shows **0 declared licences**
   across the Rust tree, so conclusions there have to be reached by hand.
3. Packaging should rebuild from `oci/Dockerfile` with a recorded network step rather
   than inheriting the apt layer again (`D-0033`, `D-0053`). The image lineage is now six
   deep: `node:22-bookworm-slim@sha256:6c74791e… -> :phase3 -> :phase4 ->
   :phase4-complete -> :phase4-complete-lan -> :phase4-webui`.
4. Deferred items already recorded and still open: `F4W-005` (the QR encoder is proven
   only for versions 1–6 and refuses above that, bounding enrolment QR codes to usernames
   of 25 characters or fewer), `F4-013` (a filesystem backup of the workspace is not
   encrypted and contains the auth master key — an operator duty the documentation must
   state), `D-0039` (`tools/verify-package.py` imports `sys` unused), no TLS, no SBOM for
   the image beyond the declared component inventory, and no independent penetration test.
5. `B-008` is separate and not a Phase 5 concern.

### Five gate items only the Owner can close

```text
CLIENT_BROWSER_TEST      AWAITING_OWNER
OWNER_BOOTSTRAP          DONE (the Owner bootstrapped outside these sessions)
MFA_TOTP                 AWAITING_OWNER
TOKEN_REUSE_REJECTED     AWAITING_OWNER
STEP_UP_AUTH             AWAITING_OWNER
OWNER_MFA_ROTATION       AWAITING_OWNER_INTERACTION
```

None may be marked PASS by anyone but the Owner completing the flow in their own browser.
Until then Phase 5 may produce preliminary documentation, not a final declaration.

---

## Reproducing this phase's verification

```bash
npm test                                    # 507 unit tests
npm run lint                                # eslint, 143 files
node tools/test-installer-hardening.mjs     # 100 checks
sha256sum -c MANIFEST.sha256                # 5690 entries

# Browser acceptance. Builds a DISPOSABLE probe offline from the working tree, gives it
# an empty workspace, bootstraps a throwaway Owner from its own generated setup token,
# and drives every route. It never touches the real installation and never uses a real
# credential. It removes its own probe, runner and probe image on exit.
bash tools/run-browser-e2e.sh               # 174 checks
```

## Rollback

```text
container   noesar-evolution.rollback-lan-webui-20260725T175916Z   image :phase4-complete-lan
backup      $ARTIFACT_ROOT/backups/phase_4_webui_pages_20260725T175916Z/
              container-inspect.json, env.json, hostconfig.json
              containers.before, networks.before, volumes.before
              noesar.dump + noesar.dump.sha256      (pg_dump, taken while running)
              runtime/ + runtime.MANIFEST.sha256    (1868/1868, taken at rest)
```

To roll back: `docker stop noesar-evolution`, rename it aside, then
`docker start noesar-evolution.rollback-lan-webui-20260725T175916Z` and rename it back.
The runtime bind mount is shared, so no data restore is needed unless the workspace
itself must be reverted, in which case use `runtime/` above.

Earlier rollback **containers** were removed on 2026-07-26 under `D-0068`; their
**images are still on disk**, so those paths still work — recreate the container from the
run command with the tag you need:

```text
:phase4-complete-lan   what the kept rollback container above runs (immediate predecessor)
:phase4-complete       state before the LAN bind
:phase4                state before the completion gate
:phase3                state before Phase 4
```

## Housekeeping — done, and now enforced by the tooling

Owner instruction, 2026-07-26: *work clean*. The eleven `e2e-probe-*` containers, eleven
`e2e-runner-*` containers, twelve `noesar-evolution:webui-e2e-*` images and eleven
`noesar-e2e-*` networks left by the browser suite were removed, together with three
superseded rollback containers and two gate probes — 30 containers, 14 image tags and 11
networks in total. Evidence and full before/after verification are in
`docs/INSTALLATION_LEDGER.md` under *Container hygiene cleanup*.

This is now governance, not a one-off: `CLAUDE10.md` §5a, and `CLEAN UP` as step 13 of the
15-step skill cycle. **Two containers survive a phase** — the running installation and one
rollback. `tools/run-browser-e2e.sh` removes its own probe, runner and probe image on exit
(dumping probe logs first, and preserving the workspace only when the run failed);
`NOESAR_E2E_KEEP=1` opts out for interactive debugging. Host-wide `prune` in any form is
forbidden — removals name their targets.
