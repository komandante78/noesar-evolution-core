# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. A cold session should be able to resume from this
file and `PROJECT_STATE.json` alone.**

---

## Current position

| Field | Value |
|---|---|
| Phases completed | **4 — completion gate, LAN access gate, WebUI remediation (PARTIAL)** |
| Phase status | `COMPLETED_WITH_COMPLETION_GATE_AND_LAN_ACCESS_GATE_PLUS_PARTIAL_WEBUI_REMEDIATION` |
| **Next phase** | **BLOCKED — not Phase 5** |
| `NEXT_PHASE` | `BLOCKED` |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Updated (UTC) | 2026-07-25 |

**The product is installed, reachable from the local network, and the Owner has now
bootstrapped.** Container `noesar-evolution`, image `noesar-evolution:phase4-complete-lan`
(unchanged since the LAN access gate), published on `192.168.178.100:8100`, healthy.
`auth/status` reports `initialized: true` — the Owner account was created since the last
handoff was written, outside this session.

# ➜ http://192.168.178.100:8100

---

## ⚠️ Read this before touching anything

**Everything produced in the WebUI remediation phase is committed to git and verified on
throwaway probes. None of it is running on the live installation.** Confirmed by hash,
not assumed:

```text
live  /opt/noesar/apps/webui-static/app.js                          sha256 f9a59bbc…
repo  apps/webui-static/app.js                                      sha256 e5f37014…   DIFFERENT

live  /opt/noesar/services/reference-control-plane/src/auth.mjs     sha256 993cec7b…
repo  services/reference-control-plane/src/auth.mjs                 sha256 35a0b005…   DIFFERENT

live  GET /api/v1/auth/security                                     404 — route does not exist yet
```

Concretely, on the live installation right now:

- **the CSRF bug is still present** — every write still fails after a page reload;
- **there is no password-change, MFA-replacement, recovery-code or session-revocation
  route** — the Owner still cannot rotate the TOTP secret shown once at bootstrap, which
  must be treated as compromised (`F4W-003`);
- **Settings, Security, Users, Tools, Providers, System Health, Updates, Logs, Backups
  and About do not exist** in the served interface.

Nothing in the runtime, the database or the Owner account was touched by this phase. The
gap is entirely in `apps/webui-static/` and `services/reference-control-plane/src/`,
already committed at `d57ab3e`, not yet built into any image.

---

## Why nothing was deployed

The WebUI remediation phase found and fixed the CSRF root cause, and implemented and
tested a complete account-security backend plus a dependency-free QR encoder — but ten
of the required WebUI sections (Settings, Security, Users, Tools, Providers, System
Health, Updates, Logs, Backups, About) do not exist at all. Markup for them was drafted
during the phase and **deliberately withdrawn before committing**: shipping nav entries
whose panels have no data loader would reproduce the exact defect being fixed, dressed up
as progress. Rebuilding and deploying only the CSRF fix, with the Owner still unable to
reach Security or rotate MFA from the interface, was judged not worth a container swap on
its own — the interface work is next, and a single deploy afterward covers all of it.

See `docs/PHASE_4_WEBUI_REMEDIATION_REPORT.md` for the full account, and
`docs/OPEN_FINDINGS.tsv` (`F4W-001` through `F4W-007`) for every finding.

### The two causes of "the WebUI is inactive" — both confirmed by execution, not by reading

1. **Every write failed after a page reload (`F4W-001`, fixed in source).** `csrfToken`
   was a module variable populated only by the login response; a reload resets it to
   `''` while the session cookie survives, so the app still looks signed in and every
   write returns `403 CSRF validation failed`. Reproduced and then re-verified fixed in a
   real headless browser against a probe — never on the live installation.
2. **Ten sections genuinely do not exist (`F4W-002`, not started).** Navigation itself
   was never broken — all 11 shipped nav entries switch panels correctly with zero
   console errors. There was simply nowhere for "Agents", "Tools", "Settings" and the
   rest to go beyond the thin panels already there.

---

## What changed in this repository this phase (all committed, none deployed)

```text
cfb2cd5  fix(webui): restore functional application navigation and routes
d57ab3e  feat(security): implement complete MFA lifecycle and account controls
```

- CSRF cookie read back on load and on 403-retry; hash router (deep links, refresh,
  Back/Forward, title, ARIA); 404 and access-denied views; global error boundary; toasts
  with a correlation ID; no stack traces to the user.
- `AuthService`: `securityOverview`, `changePassword`, `beginMfaReplacement` /
  `confirmMfaReplacement` / `cancelMfaReplacement`, `regenerateRecoveryCodes`,
  `revokeSession` / `revokeOtherSessions` — all gated on current password + a live,
  unreplayed TOTP code; the candidate secret during replacement keeps the live one
  working until confirmed; the swap is atomic; secrets never reach the ledger.
- `apps/webui-static/qr.js` — a hand-written QR encoder, verified module-for-module
  against `libqrencode` for versions 1–6. Two real bugs were found this way (format bits
  reversed; the Reed-Solomon generator's shift and α term swapped, which silently
  produces correct data codewords and wrong error-correction codewords). Versions 7–10
  do not yet verify and are refused rather than emitted unproven (`F4W-005`, `D-0059`).

```text
unit tests             488/488   (455 before; 33 added: 16 account-security, 17 QR)
eslint                 140 files, 0 errors, 0 warnings, 0 no-undef
installer hardening    100/100   (unchanged from the LAN access gate)
```

---

## Open blockers

### B-007 — WebUI sections not built · high · **blocks next phase**
Settings, Security, Users, Tools, Providers, System Health, Updates, Logs, Backups and
About do not exist in the served interface. The backend they need (account security,
users/invitations, agents, tools, sources/knowledge) mostly already exists and is tested
or was already live; only the pages are missing. Until Security exists, the Owner cannot
reach the MFA-replacement flow this phase built.

### B-008 — two identity stores · medium · does not block
The account that logs in lives in `RUNTIME_ROOT/state/auth.json`. `noesar_identity.users`
in PostgreSQL — the table the Phase 4 completion gate's multi-user acceptance exercised —
is **empty** on the real installation. That acceptance does not cover the login path.
Needs a dedicated phase to decide the target model and migrate; not a WebUI concern.

### B-001 — no GitHub remote · medium · unchanged
`gh` is not installed, no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. Local repository
complete and committed.

### B-002 — secret scan is heuristic · low · unchanged
Neither `gitleaks` nor `trufflehog` is installed; ESLint, shellcheck, semgrep and
detect-secrets cover what they cover, credential scanning stays heuristic.

### B-005, B-006 — **CLOSED** in the completion gate.

---

## The one thing waiting for the Owner

**Rotating the TOTP secret shown once at the original bootstrap, which must be treated as
compromised.** The backend is implemented and tested (`services/reference-control-plane/
src/auth.mjs`: `beginMfaReplacement` / `confirmMfaReplacement`), but it is not deployed
and there is no Security page to reach it from. Today the only route is the API directly:

```text
POST /api/v1/auth/mfa/replace           { password, totpCode }         -> candidate secret + otpauthUri
POST /api/v1/auth/mfa/replace/confirm   { challenge, firstCode, secondCode }  -> atomic swap, new recovery codes
```

This requires the fix to be built into a deployed image first — it is source-only right
now. `OWNER_MFA_ROTATION=AWAITING_OWNER_INTERACTION`, `CLIENT_BROWSER_RETEST=AWAITING_OWNER`.

---

## Exact next action

**`NEXT_PHASE=BLOCKED`. Do not start Phase 5 — the product is not done, not the licensing
step.** The next phase is finishing the WebUI:

1. Read `PROJECT_STATE.json`, this file, `docs/PHASE_4_WEBUI_REMEDIATION_REPORT.md`,
   `docs/OPEN_FINDINGS.tsv` (`F4W-*`) — in that order.
2. Build the Settings, Security, Users, Tools, Providers, System Health, Updates, Logs,
   Backups and About pages against the endpoints already implemented and tested
   (`/api/v1/auth/security`, `/password`, `/mfa/replace*`, `/recovery-codes`,
   `/sessions/*`, plus the pre-existing `/api/v1/admin/*`, `/agents`, `/tools`,
   `/sources`, `/providers`, `/updates/*`, `/logs`, `/database/*`). Render the QR with
   `apps/webui-static/qr.js`, capped at 25-character usernames per `F4W-005`.
3. Wire the dynamic privacy banner to `/api/v1/privacy` (`F4W-007`).
4. Write the browser E2E suite the original remediation spec asked for, over every real
   route, in the pinned Puppeteer container
   (`ghcr.io/puppeteer/puppeteer@sha256:9665f5b57abc5cc7080a641878964018de219055a4d2c9d8d050ceb1161778ba`).
5. Only then rebuild (`noesar-evolution:phase4-webui-remediated` or similar), deploy,
   verify live, and let the Owner rotate MFA and confirm the browser retest.
6. Separately — not blocking — `B-008`: decide whether `noesar_identity.users` becomes the
   source of truth for login, or is retired, or the two are reconciled deliberately.
7. The Phase 1 licensing backlog is still there for whenever Phase 5 actually starts: 12
   Rust crates and 2 Node packages with no declared licence, no root `LICENSE`, 86 sources
   with no SPDX header, the three-way licence split still a proposal.

## Reproducing this phase's verification

```bash
npm test                                    # 488 unit tests
npm run lint                                # eslint, 140 files
node tools/test-installer-hardening.mjs     # 100 checks, unchanged from the LAN gate

# proving the CSRF fix is real (requires a throwaway probe — do NOT point at the live
# installation without an Owner password you're authorised to use):
#   build an overlay image copying apps/webui-static/ and services/.../src/,
#   run it against a disposable workspace, log in, create something, press F5,
#   create something else — must succeed with 0 failed requests.
```

## Rollback

Nothing to roll back from this phase — no deployment happened. The LAN access gate's
rollback material is unchanged: `$ARTIFACT_ROOT/backups/phase_4_lan_access_20260725T151501Z/ROLLBACK.md`,
with `noesar-evolution.rollback-lan-phase4complete-20260725T153133Z` preserved stopped.
