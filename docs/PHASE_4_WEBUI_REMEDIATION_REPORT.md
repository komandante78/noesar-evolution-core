# Phase 4 — WebUI Product Remediation

**Executed:** 2026-07-25 (UTC)
**Status:** **PARTIAL.** The root cause is found, fixed and verified in a real browser.
The account-security backend and a verified QR encoder are implemented and tested. The
Settings, Security, Users, Tools, Providers, System Health, Updates, Logs, Backups and
About **pages are not built**, and nothing was rebuilt or deployed.

```text
REMEDIATION_STATUS              PARTIAL
ROOT_CAUSE                      FOUND, FIXED, VERIFIED IN A REAL BROWSER
WEBUI_NAVIGATION                PARTIAL   (routing repaired; 10 sections still absent)
SETTINGS_UI                     NOT_IMPLEMENTED
SECURITY_UI                     NOT_IMPLEMENTED   (backend complete and tested)
MFA_QR                          ENCODER VERIFIED, NOT RENDERED IN THE INTERFACE
MFA_ROTATION_UI                 NOT_IMPLEMENTED   (backend complete and tested)
USER_MANAGEMENT_UI              NOT_IMPLEMENTED
AGENTS_UI / TOOLS_UI            NOT_IMPLEMENTED
KNOWLEDGE_UI                    NOT_IMPLEMENTED
PRIVACY_BANNER_DYNAMIC          NOT_IMPLEMENTED
BROWSER_E2E                     PARTIAL   (diagnostic + root-cause harness only)
IMAGE_REBUILD                   NOT PERFORMED
OWNER_MFA_ROTATION              AWAITING_OWNER_INTERACTION
CLIENT_BROWSER_RETEST           AWAITING_OWNER
NEXT_PHASE                      BLOCKED
```

## 1. Root cause of the inactive WebUI

Two independent causes, both confirmed by execution.

### Cause A — every write failed after a page reload (`F4W-001`)

`csrfToken` was a module-level variable, populated only from the login response. A page
reload re-evaluates the module and resets it to `''`, and `api()` attached the
`x-noesar-csrf` header only when that value was truthy. The `noesar_csrf` cookie is
deliberately **not** `HttpOnly` so the script can read it back — and the code never did.

The session cookie survives the reload, so the application still looks signed in. Every
read works. Every **write** returns `403 CSRF validation failed`. That is why this
presents as "clicking does nothing" rather than as a session error.

Reproduced in a headless browser against a probe running the shipped image:

```text
create a project immediately after login   ->  "Project created."
press F5
create another                             ->  403 CSRF validation failed
```

After the fix, in the same harness:

```text
create a project immediately after login   ->  "Project created."   0 failed requests
press F5
create another                             ->  "Project created."   0 failed requests
```

### Cause B — the sections simply do not exist (`F4W-002`)

The shipped `apps/webui-static` has **11** nav entries and **11** panels. There is no
Settings section, no Security section, no Users, Tools, Providers, System Health,
Updates, Logs, Backups or About. Agents and Tools were one combined entry, so there was
no Tools item to click at all.

Navigation itself was **not** broken: in a real browser every nav click switched the
active panel correctly, with no console errors and no failed requests beyond a
`404 /favicon.ico`. The panels that exist are thin — Agents renders 3 buttons and 12
inputs, Knowledge 5 and 6 — so a click lands on a near-empty shell, which is
indistinguishable from nothing happening.

## 2. What was fixed

| Area | State |
|---|---|
| CSRF / all writes after reload | **fixed, verified in a browser** |
| Hash router: deep links, refresh, Back/Forward, document title, ARIA announcement | **implemented** |
| 404 page and access-denied page | **implemented** |
| Global error boundary, toasts with correlation ID, no stack traces to the user | **implemented** |
| Password change | **implemented, 4 tests** |
| Authenticator replacement (two-step, step-up, two consecutive codes, atomic swap) | **implemented, 5 tests** |
| Recovery codes (issued once, digest-only at rest) | **implemented, 2 tests** |
| Session listing and revocation | **implemented, 2 tests** |
| QR encoder, dependency-free, verified against libqrencode | **implemented, 17 tests** |

## 3. What was NOT done, and why

**The interface for the new sections was drafted and then deliberately withdrawn.**
Markup for Settings, Security, Users, Tools, Providers, System Health, Updates, Logs,
Backups and About was written, but their data loaders were not. Shipping twelve nav
entries whose panels sit on "Loading…" forever would have reproduced exactly the defect
this phase exists to remove, and would have looked like progress while making the
product worse. The router therefore advertises only routes that have a working page.

Consequently there was **no rebuild and no deployment**. The live installation still
runs `noesar-evolution:phase4-complete-lan` on `192.168.178.100:8100`, untouched, with
the Owner account intact. `phase4-webui-remediated` does not exist.

Also not done: dynamic privacy banner, users/invitations UI, agents UI, tools UI,
knowledge UI, the full browser acceptance suite over every route, and the ten
documentation files this phase specified beyond this report.

## 4. Findings

| ID | Severity | Summary | Status |
|---|---|---|---|
| `F4W-001` | high | every write failed after a reload | CLOSED |
| `F4W-002` | high | ten required sections do not exist | OPEN — backend done, UI not built |
| `F4W-003` | medium | no MFA rotation, no recovery codes, no session control | CLOSED |
| `F4W-004` | medium | Base32 shown, `otpauthUri` ignored | PARTIAL — encoder verified, not rendered |
| `F4W-005` | medium | QR encoder verified only for versions 1–6 | OPEN — bounded and documented |
| `F4W-006` | medium | login identity and multi-user directory are two stores | OPEN — recorded |
| `F4W-007` | low | privacy banner is static markup | OPEN — not started |

### `F4W-006` deserves attention

The account that signs in lives in `state/auth.json`. `noesar_identity.users` in
PostgreSQL — the table the Phase 4 completion gate exercised for its multi-user
acceptance — is **empty** on the real installation. The multi-user work recorded there
does not cover the login path. Reconciling the two is a data-model decision with
migration consequences, not a WebUI repair.

### `F4W-005` — the QR encoder, and why it stops at version 6

Two real bugs were found by comparing against `libqrencode`, neither visible by reading:

1. **format-information bits placed in reverse order**;
2. **a Reed-Solomon generator polynomial with its shift and its α term swapped**, which
   yields *correct data codewords and wrong error-correction codewords*.

Both produce something that looks exactly like a QR code and does not decode. The second
was localised by extracting the reference symbol's codewords and diffing: data codewords
0–15 matched byte for byte, and divergence began precisely at codeword 16, the first EC
codeword.

After fixing them, versions 1–6 match `libqrencode` module-for-module and 7–10 still do
not. Rather than ship a symbol that cannot be proven to decode, `chooseVersion` refuses
above version 6. The fixed part of an enrolment URI is 81 bytes, so usernames up to 25
characters are covered; `normalizeUsername` permits 64, so a longer username has no QR
and must use the manual key.

## 5. Owner MFA rotation

**Not performed, by design.** The backend, the step-up gate, the two-consecutive-code
confirmation and the atomic swap are implemented and tested, but the flow requires the
Owner's own password and live authenticator codes, and rotating on their behalf is
forbidden by this phase.

```text
OWNER_MFA_ROTATION = AWAITING_OWNER_INTERACTION
```

The Owner cannot yet perform it from the interface, because the Security page is not
built. Until then the API endpoints are the only route, and the original enrolment
secret remains in force.

## 6. Tests

```text
unit tests                    488/488   (455 before; 33 added)
  account security             16
  QR encoder                   17
eslint                        140 files, 0 errors, 0 warnings, 0 no-undef
installer hardening           100/100
browser harness               root cause reproduced before the fix and absent after it
```

The QR tests compare against `libqrencode` where it is installed and **report a skip**
where it is not, rather than passing quietly.

## 7. Honest summary

The mystery is solved and the single most damaging defect — every write failing after a
refresh — is fixed and proven. The security backend the product was missing entirely now
exists and is tested. What the Owner asked for and does **not** yet have is the interface:
the Settings and Security pages, the QR on screen, the rotation flow, users, tools and
knowledge. Those remain `NOT_IMPLEMENTED`, stated rather than simulated.
