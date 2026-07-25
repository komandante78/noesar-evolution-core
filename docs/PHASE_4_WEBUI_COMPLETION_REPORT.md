# Phase 4 — WebUI Completion

**Executed:** 2026-07-25 (UTC)
**Status:** **COMPLETE.** The ten missing sections are built, wired to endpoints that
already existed, and verified in a real browser over every route. `B-007` is closed.

```text
WEBUI_SECTIONS_BUILT            10 / 10
WEBUI_NAVIGATION                COMPLETE
SETTINGS_UI                     IMPLEMENTED
SECURITY_UI                     IMPLEMENTED
MFA_QR                          RENDERED AND VERIFIED IN A BROWSER
MFA_ROTATION_UI                 IMPLEMENTED, DRIVEN END TO END
USER_MANAGEMENT_UI              IMPLEMENTED
TOOLS_UI / PROVIDERS_UI         IMPLEMENTED (split into their own pages)
SYSTEM_HEALTH / UPDATES / LOGS  IMPLEMENTED
BACKUPS_UI / ABOUT_UI           IMPLEMENTED
PRIVACY_BANNER_DYNAMIC          IMPLEMENTED
ROLE_GATING                     IMPLEMENTED, EXERCISED FROM BOTH SIDES
BROWSER_E2E                     174 / 174
UNIT_TESTS                      507 / 507   (488 before; 19 added)
ESLINT                          143 files, 0 errors, 0 warnings, 0 no-undef
INSTALLER_HARDENING             100 / 100
MANIFEST                        5690 / 5690
OWNER_MFA_ROTATION              AWAITING_OWNER_INTERACTION
```

## 1. What was built

Ten sections, each with a data loader registered in `VIEW_LOADERS` — an object the
previous phase declared, consumed in `activate()`, and never populated, so no view had
ever fetched anything of its own.

| Page | Consumes | Reachable by |
|---|---|---|
| Settings | `/api/v1/settings/timezone`, `/locale` | any session |
| Security | `/api/v1/auth/security`, `/password`, `/mfa/replace*`, `/recovery-codes`, `/sessions/*` | any session |
| Users | `/api/v1/admin/users`, `/admin/invitations` | `user.manage` |
| Tools | `/api/v1/tools` | any session (mutations need `agent.manage`) |
| Providers | `/api/v1/providers`, `/providers/*/health`, `/credential`, `/consent` | any session (mutations need `provider.manage`) |
| System Health | `/healthz`, `/api/v1/watchdog`, `/api/v1/database/status` | owner |
| Updates | `/api/v1/updates/*` | owner |
| Logs | `/api/v1/logs`, `/api/v1/debug/*` | owner |
| Backups | `/api/v1/database/backup`, `/data/export`, `/data/retention` | `data.manage` |
| About | `/api/v1/bootstrap` | any session |

**Tools and Providers were moved, not rewritten.** Both already existed as working
markup buried inside "Agents & Tools" and "Models & External APIs" — which is why there
was no Tools entry to click at all. The markup was relocated with its element ids
intact, so every existing handler keeps working and nothing is duplicated.

**Role gating is derived from the server, not restated in the browser.**
`AuthService.permissionsFor(role)` exposes the single `ROLE_PERMISSIONS` definition, and
`/api/v1/auth/me` and the session response carry it. The alternative — a copy of the
permission matrix in `app.js` — is one refactor away from disagreeing with the server
that enforces it, and the disagreement would be silent.

## 2. The defect that explains the original report

`F4W-008`, high, **present in the delivered product and missed by two prior phases.**

`<section class="view" id="view-tasks">` was never closed. HTML does not auto-close a
`<section>` when the next one opens, so **nine views became DOM children of Tasks**:
Artifacts, Knowledge, Memory, Models, Agents, CodeN Ultra, Compute — and the 404 and
access-denied pages the previous phase had just built.

A `.view` is `display:none` unless it carries `.active`, and an element inside a
`display:none` ancestor has no box however active it is. So those panels were fetched,
populated, marked active — and invisible. That is precisely the reported symptom:
*clicking Agents, Tools or Knowledge does nothing.*

The delivered file has **35 `<section>` opens against 34 closes**. It was found by
walking the ancestor chain of an unclickable button in a real browser:

```text
BUTTON.primary                        0x0
FORM#mfaReplaceForm.form-stack        0x0
SECTION.panel                         0x0
SECTION#view-security.view.active     0x0     <- active
SECTION#view-tasks.view               0x0     <- NOT active, display:none
```

The previous phase concluded "navigation itself was not broken — all 11 nav entries
switch panels correctly". That was true of `classList` and false of the screen. The
check looked at the class rather than at whether anything was visible.

## 3. Defects introduced by this phase, declared separately

| ID | What | Found by |
|---|---|---|
| `F4W-009` | the authenticator form carried both `form-stack` (grid) and `inline-form` (flex) — the only element in the file combining them — collapsing its button to 0x0 | the browser suite |
| `F4W-010` | the first route check tested `classList` and `innerText` length, and `innerText` falls back to `textContent` for an element that is not rendered — so it passed on nine invisible pages | re-reading the check after `F4W-008` |

Three further defects were in the harness rather than the product, and are recorded
rather than quietly fixed:

- the old-authenticator rejection check ran its login through the page, which replaced
  the browser's session cookie and silently signed the suite out — every later step then
  timed out. It is issued from Node now, so the isolation is structural rather than a
  matter of running it last;
- the default 800x600 viewport exercised the `max-width:1250px` layout branch (no right
  column) and let a coordinate click land on the sticky top bar after scrolling — a
  control that appears to do nothing, which is the exact defect being hunted;
- the invitation list was sampled before the refresh that follows it completed.

A fourth: the first attempt at the privacy banner compared the state against
`LOCAL_ONLY`, a value this server never emits — it emits `LOCAL_ONLY_VERIFIED`. That
would have left the banner permanently amber. It now uses `banner.external`, the
server's own verdict.

## 4. The privacy banner, and why `F4W-007` was wrong as worded

The finding said the banner was static markup. It was not: `refreshPrivacy()` already
drove it from `/api/v1/privacy`. Two real defects were behind it:

1. `refreshPrivacy()` swallowed every error in an empty `catch{}`. A failed or
   unreachable privacy check therefore left the hardcoded **"LOCAL-ONLY VERIFIED"** chip
   on screen looking confirmed — the interface asserting a privacy guarantee it had not
   verified. It now says `UNVERIFIED` and explains why.
2. `.privacy-banner.external` was added to the stylesheet in the previous phase and
   applied by nothing. The amber external-egress styling was dead and the visual warning
   never appeared.

## 5. Verification

```text
browser acceptance      174 / 174   (tools/run-browser-e2e.sh)
unit tests              507 / 507   (488 before; 6 role-permission, 13 markup-structure)
eslint                  143 files, 0 errors, 0 warnings, 0 no-undef
installer hardening     100 / 100
MANIFEST                5690 / 5690 (5 refreshed, 4 appended, 0 removed, 0 duplicates)
static analysis         semgrep/bandit/ruff via noesar-debuglab, started and stopped in this phase
```

The browser suite runs in the digest-pinned Puppeteer image against a **disposable
probe** built offline as a two-directory overlay on the audited image, with an empty
workspace and its own generated setup token. It bootstraps a throwaway Owner through the
real forms. **The real installation is never driven and no real credential is used.**

What it asserts, per route: the panel is active, carries real content, has a **non-zero
rendered box**, shows no `Loading…` placeholder, reports no loader failure, produces no
console error and no failed request, and sets a document title.

Beyond the routes it drives: the CSRF reload regression; a cold deep link to an
owner-only route; the whole authenticator replacement (QR rendered, two consecutive
codes, ten recovery codes, and the superseded secret refused with 401); a settings change
surviving a reload; an invitation issued and its token shown once; sign-out.

**The denied path is exercised, not assumed.** A second account is created through the
invitation flow with a role holding neither `user.manage` nor `data.manage`, signed in
for real, and checked: the nav hides Users, Backups, System Health, Updates and Logs;
still offers Settings, Security and About; `#/logs` renders access-denied **with a real
box**, explains what is required, keeps the address as `#/logs` so a reload does not turn
the 403 into a 404, and attempts no request. This project has twice shipped a defect
because only one side of a branch was ever executed; as the Owner, `may()` returns true
for everything, so an error in it would be invisible.

### Static analysis triage

`semgrep` reported one `insecure-object-assign` at `app.js:85` — `Object.assign` on a
freshly constructed `Error` with three literal keys. Prototype pollution requires
attacker-controlled **keys**, and there are none. **Dismissed as a false positive.**

The twelve `bandit`/`ruff` hits are all subprocess warnings in `tools/verify-package.py`
and `tools/create-rust-build-provenance.py`, neither touched by this phase; one is the
`F401` already deferred to Phase 5 as `D-0039`. Out of scope, recorded not performed.
`services/reference-control-plane/src` and both files added by this phase: **zero**.

A clean scan proves the scanner found nothing. Every defect above was found by execution.

## 6. What is still not done

- **`F4W-005`** — the QR encoder is proven only for versions 1 to 6 and refuses above
  that, so a username longer than 25 characters gets the typed key and no QR.
- **`F4W-006` / `B-008`** — the login identity store and the PostgreSQL user directory
  are still two stores. Unchanged by this phase; it is a data-model decision.
- **`OWNER_MFA_ROTATION`** — the Owner must perform it themselves. The flow is now
  reachable from Security → Replace authenticator, and it is proven to work end to end,
  but rotating on their behalf is not this phase's to do.
- The eleven stopped probe containers, eleven probe images and eleven `noesar-e2e-*`
  networks created while iterating on the suite are preserved, not removed (rule 12).
  The script now reuses one stable network so this does not recur; disposing of the
  existing ones is a separate, explicit decision.
