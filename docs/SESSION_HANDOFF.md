# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. A cold session should be able to resume from this
file and `PROJECT_STATE.json` alone.**

---

## Current position

| Field | Value |
|---|---|
| Phases completed | **4** — completion gate, LAN access gate, WebUI remediation, WebUI completion |
| Plan of record | `docs/WORK_PLAN_V4_ALIGNMENT.md` — **WP-0 done, WP-1 half done** |
| Phase status | `PHASE_4_COMPLETE_WP1_SEC003_RESIDUAL_DONE` |
| **Next work** | **WP-1 remainder (`OPS-002`), then WP-2** |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Last commit | `f94b42f` |
| Updated (UTC) | 2026-07-26 |

> ## ➜ What this session did: the SEC-003 residual
>
> The previous session closed the *forgery* half of `SEC-003` and said plainly that the
> invariants themselves were untested — seven declared, and the names appeared in exactly
> one place in the tree: the list that declares them. Nothing read, enforced or tested
> them. This session wrote the adversarial suite the acceptance matrix asks for and
> repaired what it caught.
>
> **The suite runs one attempt per invariant from a genuinely elevated Owner Bypass
> session** — owner role, real password, unreplayed authenticator code — so that the
> invariant answers rather than the elevation gate. A suite refused one step early proves
> nothing. Against the **unfixed** code:
>
> ```text
> credential_theft_prevention      ~/.ssh/authorized_keys, /etc/shadow    403  held
> audit_integrity                  bypass action then chain verify        ok   held
> signed_update_verification       stage an unsigned bundle               4xx  held
> destructive_action_confirmation  recursive delete + PERSISTENT_FOLDER   201  LANDED
> destructive_action_confirmation  consentScope "DENY"                    201  LANDED
> destructive_action_confirmation  consentScope "UNLIMITED_FOREVER"       201  LANDED
> malware / cyberattack / physical harm    no mechanism existed to attack
> negative control                 ordinary bypass write                  201  correct
> ```
>
> **The consent scope was never validated.** It was copied from the request body onto the
> stored approval, so `DENY` — the plan's own refusal option — minted an approval, an
> invented scope was stored verbatim, and a recursive delete could be granted a standing,
> reusable licence to destroy. Fixed in `f512041`: `checkConsentScope` runs against the
> **recomputed** plan, so Owner Bypass does not relax it; refusals are appended to the
> ledger instead of being silent. `D-0072`.
>
> **No denylist was written for the other three.** Malware, illegal cyberattack and
> physical harm prevention are properties of what is *executed*, not of a filesystem path,
> and this layer has no execution surface (`executionEnabled:false`). A keyword denylist
> over `commands` would let the planner claim protection it does not provide, and the
> round-3 experiment in this repository already showed textual denylists are defeated by
> any indirection (`psql -f x.sql` never contains the forbidden verb). Instead every
> invariant now carries `status` and `enforcedBy`, and a test refuses any invariant added
> as a bare string again. `D-0071`.
>
> **The WebUI was making a separate claim.** The panel hardcoded five invariants that
> matched neither the seven in code nor each other — it listed "Scoped approvals and
> rollback", which is not an invariant, and omitted two that are. It now renders from the
> server's declaration, verified in a real browser with a real box, not by class
> inspection. `D-0073`.

> ## ➜ `SEC-003` STILL MUST NOT BE MARKED PASS
>
> What is now true: the authorization record cannot be forged (s262), and the consent
> scope cannot be forged, invented, or stretched into an unattended licence (this
> session). Four of the seven invariants are enforced and defended by tests.
>
> **Three of the seven are enforced at a layer this build does not run.** They are
> honestly declared as such rather than advertised, which is the right state — but it is
> not the same as the matrix item passing. Closing `SEC-003` requires either the execution
> layer that owns them, or an Owner decision that the item is satisfied by an authorization
> layer that cannot reach them.

> ## ➜ MANIFEST did not verify when this session opened
>
> The previous handoff reported `MANIFEST 5690/5690`. It was not true:
> `sha256sum -c MANIFEST.sha256` failed on `tools/run-browser-e2e.sh`, changed by `7597a54`
> in s261 while the manifest was last refreshed at the earlier `5e4dbef`. Separately,
> `test/coden-path-authorization.test.mjs`, created by s262, was never appended. Both are
> repaired — **5692/5692 OK, 0 failed, 0 duplicates**.
>
> **Open, and deliberately not acted on:** the manifest covers the delivered product tree
> and does **not** cover `MASTER_REFERENCE/` — 0 of its 119 tracked files are listed. The
> measuring instruments WP-0 imported are therefore not integrity-protected: the acceptance
> matrix the whole plan is measured against could be altered and the manifest would not
> notice. Widening the manifest changes what the artifact means, so it is the Owner's call.
> `D-0074`.

---

## Verified in this session

```text
adversarial suite       11/11    5 of 11 failed against the unfixed code, 0 after
unit tests             524/524   513 before; +11 this suite; 0 failures
eslint                 148 files, 0 errors, 0 warnings, 0 no-undef
browser acceptance     178/178   174 before; +4 invariant panel, real browser
MANIFEST              5692/5692  7 refreshed, 2 appended, 0 removed, 0 duplicates
static analysis        services/…/src  0 findings (semgrep, bandit, ruff, detect-secrets)
```

`noesar-debuglab` was started for the hunt step and **stopped again in the same phase**.
Container inventory **39 throughout**, exactly two `noesar-evolution*`, networks and
volumes untouched, no product container created, started or stopped. The browser suite
removed its own probe, runner and image. Live check after the work: `livez`/`readyz` 200,
`/metrics` 401, `health=healthy`, `RestartCount=0`, still `:phase4-webui`.

Dismissed with evidence, not silently: one semgrep `insecure-object-assign` on `app.js:85`
(the target is a freshly created local `Error` with three fixed literal keys — no mass
assignment, no redirect; pre-existing), and the `tools/*.py` bandit/ruff `subprocess`
hits (hardcoded argv, not untrusted input; `sys` unused is already `D-0039`).

---

## ⚠️ Two security fixes are in the source and NOT installed

The live installation on `192.168.178.100:8100` runs `:phase4-webui`, built **before**
both of them. It therefore still serves:

1. the forgeable `/api/v1/coden/authorize` (s262, `e2abbc6`), and
2. the unvalidated consent scope (this session, `f512041`) — so on the live box `DENY`
   still mints an approval and a recursive delete can still be granted `PERSISTENT_FOLDER`.

**Deployment is an installation phase and requires the Owner's explicit authorisation.**
Do not do it on initiative.

---

## Open blockers

### B-001 — no GitHub remote · medium · unchanged
`gh` is not installed, no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. The local repository
is complete and committed.

### B-002 — secret scan is heuristic · low · unchanged
Neither `gitleaks` nor `trufflehog` is installed. The scan run this session was heuristic
and is declared as heuristic; its matches were all identifier names, a pre-existing CSS
class, test fixture constants and SHA-256 checksums in the manifest.

### B-008 — two identity stores · medium
The account that signs in lives in `RUNTIME_ROOT/state/auth.json`; `noesar_identity.users`
in PostgreSQL is empty. Needs a phase of its own.

### B-005, B-006, B-007 — **CLOSED**.

---

## Exact next action

**WP-1 is half done. The remaining half is `OPS-002`, the other `severity: blocker`.**

`OPS-002` — *cross-platform installation*. `deployment/` carries `linux/`, `macos/`,
`windows/`, `podman/` and `unraid/`. The hardening regression covers **four scripts**
(`INSTALLATION/install-unraid.sh`, `deployment/unraid/install-complete.sh`,
`deployment/docker/run.sh`, `deployment/lib/network-access.sh`). The Linux, macOS, Windows
and Podman installers have never been executed or tested, and `Install-Noesar.ps1` has
never run on Windows.

Note before planning it: much of that cannot be *executed* on this host — there is no
macOS, no Windows, and Podman is not installed. Rule 45 forbids installing tooling to
satisfy a rule. So `OPS-002` will need the honest split stated up front: what can be
verified behaviourally here (the same `bash -n`-is-not-enough technique already used —
run the installers against a fake `docker` binary, which caught a real defect in Phase 3),
what can only be statically reviewed, and what is genuinely `[UNVERIFIED]` for want of a
platform. Do not report a platform as covered because its script was read.

**Then WP-2** — Workflows and the approval queue first, since `/api/v1/bootstrap` already
advertises `Workflows` in its feature list and the engine does not exist. That claim is a
defect of the same class this session just fixed twice.

**Still open and unchanged from the previous handoff:**

- **WP-3 / WebUI v2.** The Owner reviewed v1 on 2026-07-26 and did **not** accept it, and
  asked that the new preview be produced in a fresh session. Read
  `docs/WEBUI_DESIGN_REVIEW_V1.md` first — four corrections, one of which re-derives the
  information architecture rather than restyling. One open question to ask before
  building: three separate chat destinations, or one Chat destination with three surfaces.
- **The CodeN Evolution design conversation.** `docs/CODEN_EVOLUTION_DESIGN_V1.md` is
  written and waiting; five decisions at the end are the Owner's.
- **ATOM.** Blueprint at `/mnt/cachec/NOESAR-ATOM-PRIVATE/` (private, no remote, nothing
  implemented). Its first step is not in that repository: `ReasoningProvider` is **zero
  files in the core**, and that contract belongs to the public core.
- **Phase 5** is WP-4 and stays below all of the above.

Read in this order on reopening: `PROJECT_STATE.json`, this file, `docs/PHASE_PLAN.md`,
`docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md`, then
`docs/WORK_PLAN_V4_ALIGNMENT.md`.

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
usernames of 25 characters or fewer), `F4-013` (a filesystem backup of the workspace is
not encrypted and contains the auth master key — an operator duty the documentation must
state), `D-0039` (`tools/verify-package.py` imports `sys` unused), no TLS, no SBOM for the
image beyond the declared component inventory, no independent penetration test, and the
licensing backlog inherited from Phase 1 (12 first-party Rust crates and 2 Node packages
with no declared licence, no root `LICENSE`, 86 sources with no SPDX header, 0 declared
licences across the Rust tree in the source SBOM).

---

## Reproducing this session's verification

```bash
npm test                                    # 524 unit tests
npm run lint                                # eslint, 148 files
node --test services/reference-control-plane/test/coden-invariant-adversarial.test.mjs
sha256sum -c MANIFEST.sha256                # 5692 entries
bash tools/run-browser-e2e.sh               # 178 checks, disposable probe, self-cleaning
```

## Rollback

```text
container   noesar-evolution.rollback-lan-webui-20260725T175916Z   image :phase4-complete-lan
backup      $ARTIFACT_ROOT/backups/phase_4_webui_pages_20260725T175916Z/
this phase  BACKUPS/sec003_invariants_20260726T094716Z/     path-auth.mjs, server.mjs, index.html
            BACKUPS/MANIFEST.sha256.pre_sec003_invariants_20260726T095620Z
```

To roll back the installation: `docker stop noesar-evolution`, rename it aside, then
`docker start noesar-evolution.rollback-lan-webui-20260725T175916Z` and rename it back.
The runtime bind mount is shared, so no data restore is needed.

Image lineage, all still on disk:

```text
:phase4-webui          what is running now
:phase4-complete-lan   the kept rollback container (immediate predecessor)
:phase4-complete       state before the LAN bind
:phase4                state before the completion gate
:phase3                state before Phase 4
```

## Housekeeping

`CLAUDE10.md` §5a and step 13 of the 15-step skill cycle. **Two containers survive a
phase** — the running installation and one rollback — and that is exactly what exists.
This session created no container of its own except the browser suite's disposable probe
and runner, which the suite removed on exit, plus `noesar-debuglab` for the hunt step,
which was stopped again in the same phase. Host-wide `prune` in any form remains
forbidden. Inventory evidence:
`EVIDENCE/docker_inventory_post_wp1_20260726T095900Z.txt`.
