# SESSION HANDOFF — 2026-08-16 (`D-0481`: deep review, §2 settings sections 7-9)

## ➜ LA PROSSIMA AZIONE

**`D-0469`'s deploy from 2026-08-15 is still what is live and healthy — no product code changed
this session.** Continued the review cadence (`D-0473`→`D-0481`), settings sections 7-9:

- **`#/settings/people`** — real; token invitations, role selection, e2e + backend covered.
- **`#/settings/security`** — real; password/recovery/MFA-replace/passkeys/session-revoke, every
  mutation gated on password + live TOTP. MFA-replace is e2e-covered; password change and
  passkey add/remove are not (backend is: `webauthn.test.mjs`, `totp-replay.test.mjs`).
- **`#/settings/models-hardware`** — real; read-only accelerator discovery + explained runtime
  recommendation, `hardware.test.mjs`. **Resolved a second standing open question** from this
  file's §1: `settings/hardware` (a separate `page-help.js` entry) is confirmed **stale** —
  `SETTINGS_SECTIONS` (`app.js:251`) has no `'hardware'` key, only `'models-hardware'`.

Full findings: `docs/PAGES_INDEX_2026-08-16.md` §8 `D-0481`, `docs/DECISION_LOG.md` `D-0481`.
`Checked` is now `SI` for 23 of 55 pages.

**Pattern now at 3 occurrences**: `#/research`'s form (`D-0478`), theme/accent picker
(`D-0479`), password-change/passkeys (`D-0481`) — all backend-proven, none e2e-driven. Worth
treating as one finding once §2 (settings) is fully reviewed, rather than three small notes.

**Next phase**: settings sections 10-12 — `storage`, `audit`, `health`. Same method: what works
/ what's missing / what to change, cite file:line, `HUNT AND FIX` anything in-scope found stale
or broken. No code changes without Owner authorization.

The other open items are unchanged, still the Owner's call:

- **`F-SLASH-001`**, **`F-MODEL-001`**, **`cargo publish`**, **Fase D (WP4)**, the hover/title
  fix, one of the 3 `D-0472` research directions, the `file-extractors.mjs` packaging proposal
  (`D-0476`), the growing e2e-coverage-gap pattern (3 named sites), and the orphaned
  `page-help.js['settings/hardware']` key (harmless, never rendered, cleanup candidate) — all
  scoped, none started.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-SLASH-001` | **ROOT CAUSE CONFIRMED, not fixed** — needs a test-strategy choice. `D-0463`. |
| `F-MODEL-001` | **OPEN**, awaiting Owner choice — `#/models` `servedBy` not declared. `D-0395`. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato (ancora vuoto). `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — catalogue-closable gap rose 607→644. |
| `F-MANIFEST-001` | **OPEN**, pre-existing, out of scope — `MANIFEST.sha256` 5898 vs 6568 tracked files. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` still names the pre-rotation container IP. |
| `F4-011` | **CORRECTED** (was a stale `OPEN` record) — actually fixed pre-`D-0362`. `D-0475`. |

All others from earlier sessions: **FIXED/DEPLOYED/CLOSED**, listed in full in
`docs/DECISION_LOG.md` — not repeated here (D-0460 through D-0469).

## Verificato IN QUESTA SESSIONE

Read-only review phase — direct source reading (`app.js`, `index.html`) cross-checked against
existing e2e/unit coverage cited in `docs/PAGES_INDEX_2026-08-16.md` §8, not re-executed in full
this session, cited as already-proven evidence per `noesar-evolution-engineering-depth` §8.1. No
suite run, no deploy, no container touched.

## Cosa NON è stato fatto

- **No test suite run** — zero source files changed this phase.
- **32 of 55 pages, 103 of 103 tools/modules items** — still `Checked: NO`, unreviewed.
- **The 3-occurrence e2e-coverage pattern** — named, not built into a check.
- **Orphaned `page-help.js['settings/hardware']` key** — identified, not removed (harmless,
  never rendered; removal needs an explicit ask per `CLAUDE10.md` §4/§13, not silent cleanup).
- **All previously named open items** (`F-SLASH-001`, `F-MODEL-001`, `cargo publish`,
  `file-extractors.mjs` packaging) — unchanged, none executed.
- **No HUNT AND FIX this batch** — the stale-note correction was documentation, not a functional
  defect.

## Proposta di miglioramento

**Questo giro (`D-0481`)**: the "backend proven, UI gesture not e2e-driven" shape has now
appeared 3 times independently. Benefit: naming it as a single pattern rather than 3 scattered
notes means a future phase can address the class in one pass (a shared e2e-harness helper for
"drive this form, read this outcome panel") instead of writing 3+ bespoke checks. Cost: none
this phase — an observation to act on once §2 finishes and the full list of occurrences is known.

**Precedenti (`D-0480`-`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
