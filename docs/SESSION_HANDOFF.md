# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. A cold session should be able to resume from this
file and `PROJECT_STATE.json` alone.**

---

## Current position

| Field | Value |
|---|---|
| Phases completed | **4** — completion gate, LAN access gate, WebUI remediation, WebUI completion |
| Plan of record | `docs/WORK_PLAN_V4_ALIGNMENT.md` — WP-0 done; WP-1 worked, both blockers still OPEN; **WP-2: Workflows, approval queue, WCAG 2.2 AA and the seven privacy states done** |
| Phase status | `PHASE_4_COMPLETE_WP2_PRIVACY_STATES_BUILT_NOT_DEPLOYED` |
| **Next work** | **WP-2 continues** — five remaining rows; the role model needs the Owner in the loop |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Last commit | `12dd1f7` |
| Updated (UTC) | 2026-07-26 |

> ## ➜ What this session did
>
> WP-2's smallest self-contained row: the local-first privacy indicator, `01_PRODUCT/12`.
> It was **measured before it was changed** — the discipline that has now paid twice running.
>
> The specification is ten lines and makes three separable claims: seven named states; an
> external state disclosing destination, service identity, data categories, purpose,
> duration, retention, consent scope and a revoke control; and telemetry off with no user
> content in licence or update metadata. Against the shipped code:
>
> ```text
> # tests 25   # pass 7   # fail 18
> ```
>
> The seven passes included the four published `EGRESS` conformance vectors, which is why the
> new suite asserts them: the repair had to leave them intact, and it did.

> ## ➜ The sharpest finding was not a missing state
>
> `REMOTE_MODEL_ACTIVE` was being reported by an installation whose remote-model request had
> just been **refused**.
>
> The state lived in `let currentPrivacyState`, assigned at module load and then overwritten
> by whatever egress plan any authenticated caller last evaluated. Two defects came out of
> that one line: asking *what would happen if I used a remote model* repainted the indicator
> for every user until restart, on the strength of a plan the server had denied; and it
> initialised to `LOCAL_ONLY_`**`VERIFIED`** before anything had been verified, resetting to
> that optimistic claim on every restart.
>
> `derivePrivacy()` now computes the state from enabled providers and consented connectors.
> There is nothing for a caller to set and nothing to go stale across a restart.
> `evaluateEgress()` stays separate and unchanged — it answers a hypothetical, and a
> hypothetical is not a state. `D-0087`.

> ## ➜ Four design decisions worth reading before extending this
>
> **A registered provider is a menu item, not a pending connection** (`D-0088`). This was my
> own defect, caught by this phase's own test. `ProviderGateway.seed()` registers OpenAI,
> Anthropic and Kimi in every workspace, disabled and unconsented. Counting those as pending
> meant **a fresh installation could never once report `LOCAL_ONLY_VERIFIED`** — a permanent
> false alarm, and a warning that is always on is one people learn to skip past. "Pending"
> now means enabled without consent, or consented without being enabled.
>
> **Retention at a third party is declared unknowable, not invented** (`D-0089`). The
> disclosure carries `UNKNOWN_AT_DESTINATION` with the reason, beside the local retention
> this installation does control. A figure would have been fabrication; a blank would have
> left a required element empty.
>
> **The revoke control is not advertised to callers who cannot use it** (`D-0091`). `user`,
> `client_restricted` and `service_account` all hold `user.read`, so they read the indicator,
> but none holds `provider.manage`, so the route answers them 403. Widening the permission
> was rejected — revoke disables providers workspace-wide, so a restricted account could
> switch off everyone's access. The disclosure reports `available` for **this** caller,
> answered by the same `hasPermission` call the route enforces.
>
> **`POLICY_VIOLATION_BLOCKED` is fed by refused sends, never by refused plans** (`D-0093`).
> Feeding it from a plan would let any caller repaint the indicator by asking a bad question —
> `D-0087` in the opposite direction. It expires from the indicator after 15 minutes; the
> ledger is the permanent record, and a state that never clears is `D-0088` again.

> ## ➜ Two defects found after the tests were already green
>
> **`POLICY_VIOLATION_BLOCKED` was unreachable in the running product.** `lastPolicyViolation`
> was declared in the server and only ever *cleared* — nothing set it. The unit tests proved a
> pure function could produce the state, which is not the same as the product reaching it, and
> is exactly the gap the bootstrap feature-claims suite exists to close. Found by reading the
> staged diff; no scanner on this host sees it. `ProviderGateway.#assertAllowed` now reports
> each external refusal once, through one place, and the test drives it over HTTP.
>
> **That test's first version proved nothing.** It asserted `status >= 400`, which a 404 from
> a mistyped route satisfies — it "passed" the attempt while the indicator had not moved. It
> now asserts `403` exactly, using the provider health probe, which runs the same
> `#assertAllowed` gate and then genuinely reaches out.

> ## ➜ Defects of my own, declared
>
> Three harness defects were triaged out **before** anything was repaired, because a false
> positive "fixed" is a real regression introduced for nothing: the wrong key for the
> conformance file (`vectors` for `cases`), the wrong field on the providers response
> (`items` for `providers`), and the wrong verb for granting consent (`POST` for `PUT`).
>
> Two more were in the browser harness. Waiting on a native checkbox's `checked` — true the
> instant it is clicked, while the round trip was still in flight — meant the next click hit a
> stale client copy, and the UI **correctly** refused it with "Grant explicit external consent
> first". Waiting only on the server's answer then raced the client's own re-render and
> detached the node mid-click. The barrier now marks the node before acting, so it can only
> clear once a re-render has replaced it.
>
> And `toast` takes `(message, {kind})`. The previous handoff said it takes an options object;
> the code is the authority, and the code was checked.

---

## Verified in this session

```text
unit tests             631/631   600 before; +31 in one new suite; 0 failures
  privacy states        31/31    18 of 25 failed against the unfixed code
eslint                 158 files, 0 errors, 0 warnings, 0 no-undef
browser acceptance    233/233   213 before; +20 checks, real browser, real box
accessibility          26/26    unchanged with the new markup
installer hardening   100/100   unchanged
MANIFEST             5702/5702  0 failed, 0 duplicates
static analysis       services/ clean · apps/ 1 pre-existing MEDIUM · tools/ pre-existing only
```

Six deliberate defects were seeded one at a time and each was caught by exactly one test:
any registered external provider counted as pending, `observed:false` assuming local-only,
the metadata producer spreading its caller's object, the revoke control advertised
regardless of permission, the indicator stored again from the caller's plan, and the
egress-blocked wiring removed. Every source file was restored and confirmed
**byte-identical** to its pre-seed copy after each round.

The browser suite ran four times. Two of those runs failed on my own harness races, described
above rather than hidden; the final 233/233 was run against the final tree.

### Dismissed with evidence, not silently

- `apps/webui-static/app.js:85 insecure-object-assign` (semgrep, MEDIUM) — pre-existing,
  dismissed in the two previous phases. Re-confirmed by diffing line 85 against this phase's
  own backup copy: byte-identical, untouched by this work. The target is a freshly created
  local `Error` with three fixed literal keys.
- `tools/verify-package.py`, `tools/create-rust-build-provenance.py` — `B603`/`B607`/`S603`/
  `S607` (reported CRITICAL/HIGH by the scanner), `B404`, `F401`. Neither file is staged.
  Verified at the flagged lines: argv-list form, no `shell=True`, fixed command names, and the
  only variable part is a path from a local `rglob` walk. `F401 sys` is `D-0039`.
- **`B-002` unchanged and still weak.** `detect-secrets` was shown last phase to report 0
  findings on a literal `AKIA…` key. Its clean result here is weak evidence, and the
  pre-commit scan is heuristic and declared as such.

---

## ⚠️ FOUR security or feature fixes are in the source and NOT installed

The live installation on `192.168.178.100:8100` runs `:phase4-webui`, built before all of
them. It therefore still serves:

1. the forgeable `/api/v1/coden/authorize` (s262, `e2abbc6`),
2. the unvalidated consent scope (s263, `f512041`) — on the live box `DENY` still mints an
   approval and a recursive delete can still be granted `PERSISTENT_FOLDER`,
3. no Workflows or approval queue at all, while its own `/api/v1/bootstrap` still advertises
   `Workflows` (s264, `9912462`), and
4. a privacy indicator any authenticated caller can repaint by evaluating an egress plan, and
   which claims `LOCAL_ONLY_VERIFIED` before verifying anything (this session, `12dd1f7`).

**Deployment is an installation phase and requires the Owner's explicit authorisation.** Do
not do it on initiative — and when it is authorised, read the schema-rollback note first.

## Read this before deploying: the schema bump has a rollback cost

Once the upgraded build performs its **first write**, `state/ai-workspace.json` is version 2
and **every older image in the rollback lineage will refuse to read it**. That refusal is
deliberate — an older build operating on state whose invariants it does not know would not
fail loudly, it would corrupt quietly. Rolling back therefore requires restoring
`state/ai-workspace.json` from the pre-update backup, which the update path already takes.
**A read alone never rewrites the file**, so starting the new build and stopping it again
without creating a workflow is reversible.

---

## Open blockers

### B-001 — no GitHub remote · medium · unchanged
`gh` is not installed and no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`, confirmed again this
phase (`git remote -v` is empty). The local repository is complete and committed.

### B-002 — secret scan is heuristic · low · unchanged
Neither `gitleaks` nor `trufflehog` is installed, and rule 45 forbids installing tooling to
satisfy a rule. `detect-secrets`, the one real scanner available, was shown last phase to
report **0 findings on a textbook AWS key canary**. Treat its clean results as weak evidence.

### B-008 — two identity stores · medium · unchanged
The account that signs in lives in `RUNTIME_ROOT/state/auth.json`; `noesar_identity.users` in
PostgreSQL is empty. Needs a phase of its own.

### B-005, B-006, B-007 — **CLOSED**.

---

## Exact next action

**WP-2 continues.** Four of its eleven rows are done; **five are untouched**, and the table in
`docs/WORK_PLAN_V4_ALIGNMENT.md` is the list:

```text
Passkeys / WebAuthn, OIDC, SAML, SCIM      01_PRODUCT/14   passkeySupported:false; zero references
Role model (six named roles)               01_PRODUCT/14   a DIFFERENT model ships, not a subset
Compliance evidence packs                  06_COMPLIANCE   absent
Industry Module Framework                  07_INDUSTRY     absent (Gate 6)
ML-BOM alongside SBOM                      00_CONTROL/06   SBOM exists, no ML-BOM
```

Of what remains, **ML-BOM is the smallest and most self-contained** — it was the other half of
the pair this session drew from, and it is the obvious next one. `00_CONTROL/06` requires it
beside the SBOM, and `03_SECURITY/35` and `06_COMPLIANCE/65` both reference it.

One thing to settle before starting it: this build ships **no model weights**. An honest
ML-BOM therefore describes the model *surfaces* the product declares — the provider
catalogue entries and the local runtime's expected formats — and states plainly that no model
artifact is distributed. An ML-BOM that invented model entries to look complete would be the
exact defect class this project keeps removing.

**Compliance evidence packs** and the **Industry Module Framework** are whole subsystems and
Gate 6 work. **Passkeys/WebAuthn, OIDC, SAML and SCIM** are four separate integrations that
each need an Owner decision about what this product federates with.

**Take the role model only with the Owner in the loop.** `01_PRODUCT/14` names six roles that
are neither a superset nor a subset of the six that ship, so satisfying it means changing who
can do what on a running installation. This session again avoided touching it: the revoke
route reuses `provider.manage` rather than inventing a permission.

**Still open and unchanged:**

- **`SEC-003` must not be marked PASS.** Forgery of the authorization record and of the
  consent scope is closed, and four of seven invariants are enforced and defended by tests.
  **Three are enforced at a layer this build does not run** — honestly declared, which is the
  right state but not the same as the matrix item passing.
- **`OPS-002` must not be marked PASS** and cannot be closed from this host: no macOS, no
  Windows, no PowerShell, no podman, and rule 45 forbids installing them. `Install-Noesar.ps1`
  is expected to nest the tree on reinstall — recorded, not repaired (`D-0077`).
- **`MANIFEST.sha256` does not cover `MASTER_REFERENCE/`** — 0 of its 119 files. The
  acceptance matrix the whole plan is measured against is not integrity-protected. Widening
  the manifest changes what the artifact means, so it is the Owner's call (`D-0074`). The two
  specification files this phase consumed were verified individually against
  `MASTER_REFERENCE/MANIFEST.sha256`, which does cover them: both OK.
- **WP-3 / WebUI v2.** v1 was reviewed on 2026-07-26 and **not accepted**. Read
  `docs/WEBUI_DESIGN_REVIEW_V1.md` first. WP-2 has now added **three** things to the v1
  shell — `Workflows`, `Approvals`, and the privacy disclosure panel on Home. WP-3 re-derives
  the whole navigation from `01_PRODUCT/11`, so treat all three as destinations and surfaces
  that must find a home in the new information architecture, not as settled layout.
- **The CodeN Evolution design conversation.** `docs/CODEN_EVOLUTION_DESIGN_V1.md` is written
  and waiting; five decisions at the end are the Owner's.
- **ATOM.** Blueprint at `/mnt/cachec/NOESAR-ATOM-PRIVATE/` (private, no remote, nothing
  implemented). Its first step is not in that repository: `ReasoningProvider` is **zero files
  in the core**, and that contract belongs to the public core.
- **Phase 5** is WP-4 and stays below all of the above.

Read in this order on reopening: `PROJECT_STATE.json`, this file, `docs/PHASE_PLAN.md`,
`docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md`, then `docs/WORK_PLAN_V4_ALIGNMENT.md`.

### Gate items only the Owner can close

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
npm test                                    # 631 unit tests
npm run lint                                # eslint, 158 files
node --test services/reference-control-plane/test/privacy-states.test.mjs   # 31
npm run test:accessibility                  # 26 WCAG 2.2 AA checks, real Chromium
npm run test:installers                     # 100 hardening checks
npm run test:installers-cross-platform      # cross-platform, 0 failures
sha256sum -c MANIFEST.sha256                # 5702 entries
bash tools/run-browser-e2e.sh               # 233 checks, disposable probe, self-cleaning
```

## Rollback

```text
container   noesar-evolution.rollback-lan-webui-20260725T175916Z   image :phase4-complete-lan
this phase  BACKUPS/wp2_privacy_states_20260726T151829Z/   privacy.mjs, server.mjs,
                                                           update-manager.mjs, app.js,
                                                           index.html, styles.css,
                                                           MANIFEST.sha256, SESSION_HANDOFF.md,
                                                           CHECKSUMS.txt
            BACKUPS/MANIFEST.sha256.pre_wp2_privacy_20260726T151829Z
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

`CLAUDE10.md` §5a and step 13 of the 15-step skill cycle. **Two containers survive a phase** —
the running installation and one rollback — and that is exactly what exists. This session
created no product container. The browser suite created its own probe, runner and image and
removed all three on exit, on each of its four runs. `noesar-debuglab` was started for the
hunt step and **stopped again in the same phase**; one read-only `docker exec` was made into
it to read its own route table, because its API is undocumented on this host.

Inventory **39 containers throughout**, exactly two `noesar-evolution*`, networks and volumes
diffed against `EVIDENCE/docker_inventory_pre_cleanup_20260726T154521Z.txt` and **unchanged**.
Live product after the work: `livez` 200, `readyz` 200, `/metrics` 401, `health=healthy`,
`RestartCount=0`, still `:phase4-webui`. Host-wide `prune` in any form remains forbidden.

Noted, not acted on: `run-browser-e2e.sh` preserves its workspace when a run fails, so the two
failed runs left `20260726T153315Z` and `20260726T153436Z` under
`/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/e2e/`. That preservation is the script's deliberate
behaviour, the directories lie outside `PROJECT_ROOT`, and rule 12 forbids deleting them.
