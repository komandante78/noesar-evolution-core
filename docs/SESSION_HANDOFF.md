# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. A cold session should be able to resume from this
file and `PROJECT_STATE.json` alone.**

---

## Current position

| Field | Value |
|---|---|
| Phases completed | **4** — completion gate, LAN access gate, WebUI remediation, WebUI completion |
| Plan of record | `docs/WORK_PLAN_V4_ALIGNMENT.md` — WP-0 done; WP-1 worked, both blockers still OPEN; **WP-2: Workflows, the approval queue and WCAG 2.2 AA done** |
| Phase status | `PHASE_4_COMPLETE_WP2_WORKFLOWS_APPROVALS_AND_WCAG_MEASURED_NOT_DEPLOYED` |
| **Next work** | **WP-2 continues** — eight remaining items; the role model needs the Owner in the loop |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Last commit | `91a0ab0` |
| Updated (UTC) | 2026-07-26 |

> ## ➜ What this session did
>
> The previous handoff named the first step and the reason for it: **write the test that the
> claim is true, and run it against the current code.** `/api/v1/bootstrap` advertised
> `Workflows` in its feature list while no page, no route and no engine existed.
>
> That test was written first. Against the unmodified code:
>
> ```text
> # tests 19   # pass 18   # fail 1
> error: '"Workflows" is advertised by /api/v1/bootstrap but its route answered 404 —
>         the claim is not honoured'
> ```
>
> One claim false, sixteen true — which is worth having established. The probe map lives in
> the test, not beside the feature list: kept together, one edit could add a feature and its
> own proof in the same breath. Adding a feature to the server now fails with "no probe
> defined for advertised feature".
>
> Then the engine, covering the nine properties `04_AI_PLATFORM/46` names — typed steps,
> retries, compensation, idempotency, timeout, cancellation, human approval, evidence,
> replay — and the approval queue and permanent bottom strip `01_PRODUCT/11` requires.

> ## ➜ Three design decisions worth reading before extending this
>
> **A step type declares its effects, and one of them is refused** (`D-0079`). `transform`
> computes from a closed operation registry — no dynamic evaluation, because evaluating a
> user-supplied expression would hand every workflow author the execution surface this build
> deliberately lacks. `host_mutation` is declared and **fails closed**, naming the layer that
> owns it, because `executionEnabled` is `false` here. Treating it as a no-op that "succeeded"
> would have been a workflow claiming mutations it cannot perform — the same false claim this
> phase set out to remove. Same reasoning as `D-0071`.
>
> **A run is bound to the definition it started from** (`D-0080`). Runs snapshot their
> workflow. Without it, editing a workflow would rewrite the history of every run already made
> from it, and a replay would replay the edit rather than the event.
>
> **The approval queue owns nothing** (`D-0081`). It reads the three subsystems that own
> approvals and routes each decision back to the one that raised it. A copy would be a second
> source of truth and the two would drift — which is not hypothetical here: the WebUI held
> five hardcoded invariants matching neither the code nor each other.

> ## ➜ Two defects found in the engine itself, one of them serious
>
> **`advance()` could report a run `completed` when a step never finished** (`D-0083`). It
> looked for the next step whose status was `pending` or `awaiting_approval`. A step left
> `running` by a process that died is neither, so it was skipped — and if every other step had
> finished, the run was declared a success. Found by reading the engine; no scanner on this
> host can see it, because nothing is syntactically wrong. Such a step is now reconciled to
> `interrupted`, kept distinct from `failed`, written to the evidence and the audit ledger,
> and the run fails and compensates. Attempts are now recorded when they **start**, so an
> interrupted attempt leaves a trace at all.
>
> **The AI state schema bump needed a migration, and got one** (`D-0082`). Adding `workflows`
> and `workflowRuns` raised `AI_STATE_VERSION` from 1 to 2. The installed workspace carries
> `"schemaVersion": 1` and `validateState` demanded an exact match, so bumping the constant
> alone would have made the AI workspace refuse to load on the next deployment. That is
> migration `0012` again in a different file. The fixture in the test is the shape of the real
> installed file, not an invented one.

> ## ➜ Read this before deploying: the schema bump has a rollback cost
>
> Once the upgraded build performs its **first write**, `state/ai-workspace.json` is version 2
> and **every older image in the rollback lineage will refuse to read it**. That refusal is
> deliberate — an older build operating on state whose invariants it does not know would not
> fail loudly, it would corrupt quietly.
>
> Rolling back therefore requires restoring `state/ai-workspace.json` from the pre-update
> backup, which the update path already takes. **A read alone never rewrites the file**, so
> starting the new build and stopping it again without creating a workflow is reversible.

> ## ➜ And then WCAG 2.2 AA — measured for the first time, then repaired
>
> `01_PRODUCT/15` targets WCAG 2.2 AA and the work plan said *never tested, no evidence
> either way*. It was the only WP-2 row in that state rather than simply absent, which is why
> it came next: cheap to measure now, expensive after WP-3 redraws the interface.
>
> `npm run test:accessibility` reuses the existing disposable-probe apparatus through a new
> `NOESAR_E2E_DRIVER` hook instead of copying 160 lines of container plumbing. Against the
> untouched interface it found **seven failures across five criteria**:
>
> ```text
> 2.4.1  no skip link before 23 navigation entries
> 2.4.7  23 of 783 controls changed nothing on focus — .command input{outline:0}
> 2.5.8  18 text buttons at 19px high, two checkboxes at 13x13   (new in WCAG 2.2)
> 1.4.3  white on the primary gradient measured 4.19:1; .nav-group 2.90:1
> 1.3.5  reauthPassword, the one identity field of eight with no autocomplete token
> RTL    horizontal overflow from six margin-left:auto rules
> ---    six !important colours with no forced-colors override
> ```
>
> All repaired; the audit now reports **26/26**. Contrast was fixed by computing replacement
> colours, not by eye: the new gradient stops measure 5.74 and 6.38, and `.nav-group` had to
> clear the body's radial-gradient stop `#142443` rather than just the sidebar colour.
>
> **26/26 is not conformance, and the tool says so itself** — it prints an eight-line
> NOT_TESTED block every run. No real screen reader participates; only the accessibility tree
> is inspected. `forced-colors` emulation is refused by this Chromium, so only the static
> stylesheet checks hold there. `D-0084`.
>
> **Two soundness decisions.** Contrast over a gradient has no single ratio, so the audit takes
> the **worst** across every colour stop rather than exempting those elements — which would
> have silently excused almost the whole interface, since every panel is a gradient. And the
> `!important` colour check was rewritten: failing on their mere existence was wrong, since
> six of them carry good/warning/critical meaning. The defect is an `!important` colour with
> **no forced-colors override**, and that is what it now tests. `D-0085`.
>
> **Three of the findings were mine** (`D-0086`). Two harness false positives were triaged out
> *before* repairing anything — labelled form fields counted as nameless, and a hash-only
> navigation that left the audit signed out, so five checks were failing on the harness rather
> than the product. And the skip link **this work added** was first hidden with
> `left:-9999px`, which in RTL extends the scrollable area to 11439px and breaks the very
> criterion a skip link serves. My own audit caught it on the next run; it is now hidden by
> clipping, and the RTL check names the outermost offending elements, because `overflow=true`
> alone cannot be acted on without guessing.
>
> ESLint's `no-undef` objected to a `KeyboardEvent` global and exposed something worse than
> a lint error: that check dispatched a **synthetic** keyboard event, which no browser turns
> into an activation — so it would have passed on a button the keyboard cannot operate. It now
> presses a real key. Second time `no-undef` has paid for itself here, which is what
> `B-006` exists for.

---

## Verified in this session

```text
unit tests             600/600   524 before; +76 across five new suites; 0 failures
  bootstrap claims      19/19    1 failed against the unfixed code
  workflow engine       31/31    4 seeded defects, each caught by exactly 1 test
  state migration        9/9     5 failed with the version bumped and no migration
  approval queue        10/10
  interrupted step       7/7     5 failed with the reconciliation removed
eslint                 157 files, 0 errors, 0 warnings, 0 no-undef   (149 before)
browser acceptance    213/213   178 before; +35 checks, real browser, real boxes
installer hardening   100/100   unchanged
cross-platform          0 failures, unchanged
MANIFEST             5701/5701  0 failed, 0 duplicates
accessibility           26/26    7 failures across 5 criteria found and repaired
static analysis        src/, apps/, tools/ — no new finding
```

The engine is new code, so there was no "unfixed version" to watch fail. Five deliberate
defects were seeded instead and each was caught by exactly one test: compensation reversed to
forward order, replay reading the live definition instead of the run's snapshot, a
non-executable step type allowed to run, the idempotency check disabled, and the migration
removed. The file was restored and re-verified clean after each.

The browser suite was run **twice**. The first 213/213 described code that no longer existed
once the interrupted-step fix landed, so it was re-run against the final tree.

### Three defects of my own, fixed before commit

`fillProjectSelect` did not exist; `toast` takes an options object, not a string; and
`.status-bad` / `.status-warn` were set by the new code and **absent from the stylesheet**, so
a failure would have rendered in ordinary body text. A class the application sets and the
presentation layer does not honour is the same defect shape as a declared protection nothing
enforces.

### Dismissed with evidence, not silently

- `app.js:85 insecure-object-assign` (semgrep, MEDIUM) — pre-existing, already dismissed last
  phase; the target is a freshly created local `Error` with three fixed literal keys.
  Re-confirmed pre-existing against this phase's backup copy.
- `tools/*.py` `B603`/`B607`/`S603`/`S607` — pre-existing, hardcoded argv, no untrusted
  input. `F401 sys` unused is `D-0039`.
- **Not a dismissal — new evidence for `B-002`:** before trusting any clean scan, a canary
  outside the repository was scanned. semgrep reported its `eval()` as CRITICAL, so the
  detector fires. But **`detect-secrets` reported 0 findings on a literal `AKIA…` key and a
  matching `aws_secret_access_key` line in the same file.** The heuristic secret scan is
  weaker than its name suggests. The canary was removed; it was never inside the repository.

---

## ⚠️ THREE security fixes are in the source and NOT installed

The live installation on `192.168.178.100:8100` runs `:phase4-webui`, built before all of
them. It therefore still serves:

1. the forgeable `/api/v1/coden/authorize` (s262, `e2abbc6`),
2. the unvalidated consent scope (s263, `f512041`) — on the live box `DENY` still mints an
   approval and a recursive delete can still be granted `PERSISTENT_FOLDER`, and
3. no Workflows or approval queue at all, while its own `/api/v1/bootstrap` still advertises
   `Workflows` (this session, `9912462`).

**Deployment is an installation phase and requires the Owner's explicit authorisation.** Do
not do it on initiative — and when it is authorised, read the schema-rollback note above
first.

---

## Open blockers

### B-001 — no GitHub remote · medium · unchanged
`gh` is not installed, no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. The local repository is
complete and committed.

### B-002 — secret scan is heuristic · low · **evidence strengthened this session**
Neither `gitleaks` nor `trufflehog` is installed and rule 45 forbids installing tooling to
satisfy a rule. New this session: `detect-secrets`, the one real scanner available, was shown
to report **0 findings on a textbook AWS key canary**. Treat its clean results as weak
evidence. The heuristic scan run before each commit matched only identifier names, header
names and test constants declared as non-secrets.

### B-008 — two identity stores · medium · unchanged
The account that signs in lives in `RUNTIME_ROOT/state/auth.json`; `noesar_identity.users` in
PostgreSQL is empty. Needs a phase of its own.

### B-005, B-006, B-007 — **CLOSED**.

---

## Exact next action

**WP-2 continues.** Three of its eleven rows are now done; **eight are untouched**, and the
table in `docs/WORK_PLAN_V4_ALIGNMENT.md` is the list:

```text
Passkeys / WebAuthn, OIDC, SAML, SCIM      01_PRODUCT/14   passkeySupported:false; zero references
Role model (six named roles)               01_PRODUCT/14   a DIFFERENT model ships, not a subset
Seven privacy states                       01_PRODUCT/12   five implemented
Compliance evidence packs                  06_COMPLIANCE   absent
Industry Module Framework                  07_INDUSTRY     absent (Gate 6)
ML-BOM alongside SBOM                      00_CONTROL/06   SBOM exists, no ML-BOM
WCAG 2.2 AA                                01_PRODUCT/15   DONE — 26/26 repaired, NOT certified
```

**WCAG 2.2 AA is done** (measured, repaired, 26/26 — not certified). Of what remains, the honest ordering is: **the seven privacy states** and **ML-BOM** are the smallest and self-contained; **compliance evidence packs** and the **Industry Module Framework** are whole subsystems and Gate 6 work; **passkeys/WebAuthn, OIDC, SAML and SCIM** are four separate integrations that each need an Owner decision about what this product federates with.

**Take the role model only with the Owner in the loop.** `01_PRODUCT/14` names six roles that
are neither a superset nor a subset of the six that ship, so satisfying it means changing who
can do what on a running installation. This session deliberately reused `agent.manage` for
every workflow route rather than inventing a permission, precisely so that decision stays
open and undisturbed.

**Still open and unchanged:**

- **`SEC-003` must not be marked PASS.** Forgery of the authorization record and of the
  consent scope is closed, and four of seven invariants are enforced and defended by tests.
  **Three are enforced at a layer this build does not run** — honestly declared, which is the
  right state but not the same as the matrix item passing.
- **`OPS-002` must not be marked PASS** and cannot be closed from this host: no macOS, no
  Windows, no PowerShell, no podman, and rule 45 forbids installing them. `Install-Noesar.ps1`
  is expected to nest the tree on reinstall — recorded, not repaired, because it cannot be
  run here (`D-0077`).
- **`MANIFEST.sha256` does not cover `MASTER_REFERENCE/`** — 0 of its 119 files. The
  acceptance matrix the whole plan is measured against is not integrity-protected. Widening
  the manifest changes what the artifact means, so it is the Owner's call (`D-0074`).
- **WP-3 / WebUI v2.** v1 was reviewed on 2026-07-26 and **not accepted**. Read
  `docs/WEBUI_DESIGN_REVIEW_V1.md` first — four corrections, one of which re-derives the
  information architecture rather than restyling. Note that this session added **two** nav
  entries to the v1 shell; WP-3 re-derives the whole navigation from `01_PRODUCT/11`'s single
  `Settings` entry, so treat `Workflows` and `Approvals` as destinations that must find a
  home in the new IA, not as settled navigation.
- **The CodeN Evolution design conversation.** `docs/CODEN_EVOLUTION_DESIGN_V1.md` is written
  and waiting; five decisions at the end are the Owner's.
- **ATOM.** Blueprint at `/mnt/cachec/NOESAR-ATOM-PRIVATE/` (private, no remote, nothing
  implemented). Its first step is not in that repository: `ReasoningProvider` is **zero files
  in the core**, and that contract belongs to the public core.
- **Phase 5** is WP-4 and stays below all of the above.

Read in this order on reopening: `PROJECT_STATE.json`, this file, `docs/PHASE_PLAN.md`,
`docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md`, then `docs/WORK_PLAN_V4_ALIGNMENT.md`.

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

### Deferred items, still open

`F4W-005` (the QR encoder is proven only for versions 1–6, bounding enrolment QR codes to
usernames of 25 characters or fewer), `F4-013` (a filesystem backup of the workspace is not
encrypted and contains the auth master key — an operator duty the documentation must state),
`D-0039` (`tools/verify-package.py` imports `sys` unused), **rejecting a staged update answers
501** (the update manager has no discard verb; nothing has been applied at that point, and
inventing one would be scope creep — `D-0081`), no TLS, no SBOM for the image beyond the
declared component inventory, no independent penetration test, and the licensing backlog
inherited from Phase 1 (12 first-party Rust crates and 2 Node packages with no declared
licence, no root `LICENSE`, 86 sources with no SPDX header, 0 declared licences across the
Rust tree in the source SBOM).

---

## Reproducing this session's verification

```bash
npm test                                    # 600 unit tests
npm run lint                                # eslint, 156 files
node --test services/reference-control-plane/test/bootstrap-feature-claims.test.mjs
node --test services/reference-control-plane/test/workflow-engine.test.mjs
node --test services/reference-control-plane/test/workflow-interrupted-step.test.mjs
node --test services/reference-control-plane/test/ai-state-migration.test.mjs
node --test services/reference-control-plane/test/approval-queue.test.mjs
npm run test:accessibility                  # 26 WCAG 2.2 AA checks, real Chromium
npm run test:installers                     # 100 hardening checks
npm run test:installers-cross-platform      # cross-platform, 0 failures
sha256sum -c MANIFEST.sha256                # 5700 entries
bash tools/run-browser-e2e.sh               # 213 checks, disposable probe, self-cleaning
```

## Rollback

```text
container   noesar-evolution.rollback-lan-webui-20260725T175916Z   image :phase4-complete-lan
this phase  BACKUPS/wcag_20260726T120938Z/            index.html, styles.css, app.js, MANIFEST
            BACKUPS/MANIFEST.sha256.pre_wcag_*
            BACKUPS/wp2_workflows_20260726T112259Z/   server.mjs, atomic-store.mjs,
                                                      index.html, app.js, styles.css,
                                                      MANIFEST.sha256, PROJECT_STATE.json
            BACKUPS/MANIFEST.sha256.pre_wp2_workflows_20260726T114748Z
```

To roll back the installation: `docker stop noesar-evolution`, rename it aside, then
`docker start noesar-evolution.rollback-lan-webui-20260725T175916Z` and rename it back. The
runtime bind mount is shared, so no data restore is needed **today** — but once a build
carrying the version-2 AI state schema has written to that workspace, a rollback also needs
`state/ai-workspace.json` restored from the pre-update backup. See the schema note above.

Image lineage, all still on disk:

```text
:phase4-webui          what is running now
:phase4-complete-lan   the kept rollback container (immediate predecessor)
:phase4-complete       state before the LAN bind
:phase4                state before the completion gate
:phase3                state before Phase 4
```

## Housekeeping

`CLAUDE10.md` §5a and step 13 of the 15-step skill cycle. **Two containers survive a phase**
— the running installation and one rollback — and that is exactly what exists. This session
created no product container. The browser suite created its own probe, runner and image and
removed all three on exit, both times it ran. `noesar-debuglab` was started for the hunt step
and **stopped again in the same phase**; three read-only `docker exec` calls were made into it
to read its own route table, because its API is undocumented on this host. Inventory **39
containers throughout**, exactly two `noesar-evolution*`, networks and volumes untouched.
Live product after the work: `livez` 200, `readyz` 200, `/metrics` 401, `health=healthy`,
`RestartCount=0`, still `:phase4-webui`. Host-wide `prune` in any form remains forbidden.
