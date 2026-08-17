# SESSION HANDOFF — 2026-08-17 (`D-0498`: #/settings/updates driven end to end)

## ➜ LA PROSSIMA AZIONE

**Closed the 6th of `D-0491`'s 9 named "backend proven, not e2e-driven" occurrences** (Owner:
"procedi con A"). `tools/browser-e2e.mjs` now drives all five `#/settings/updates` buttons —
Check, Change channel (round-tripped back to its original value), Approve staged, Apply staged,
Roll back — each asserted against the real, honest outcome for a fresh installation (empty
inbox, nothing staged, no channel key pinned): 200/no-crash on Check, a real `NOTHING_STAGED`
refusal on Approve, the same strong-reauthentication 403 `#authorizePlan` uses on Apply
(deterministic — this block runs before `authority-form`'s own reauth call), and a true
success-at-current-version (not a fabricated error) on Roll back, since `rollback()` never
throws when there is nothing to revert from. Full detail: `docs/DECISION_LOG.md` `D-0498`,
`docs/PAGES_INDEX_2026-08-16.md` (the `#/settings/updates` entry and the post-review update
note at the bottom).

**Verified**: full disposable-probe run, `tools/run-browser-e2e.sh` — **490/492 PASS**, all 5
new checks PASS. Both FAILs pre-existing and already tracked, unrelated to this change:
`F-SLASH-001` (known flake) and `F-I18N-002` (643/909, baseline 607 — unchanged).

**No signed update package was fabricated** to drive a live `apply` success — same posture
`D-0493` took for passkey/WebAuthn: out of this suite's scope, would need a private signing key
this suite has no business holding.

**Next — Owner's choice**:
1. Apply the same e2e-driving template to one of the **6 remaining** "backend proven, not
   e2e-driven" occurrences: `#/research`, theme/accent, log-search/debug-mode, skills, modules,
   remote-targets.
2. Act on one of the three findings from `D-0497` (`F-TOOLS2-001`, `F-RUST-001`, `F-CAP4-001`),
   or another named open item (see table below).

No code changes or deployment without explicit Owner authorization for whichever is chosen.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| 6 remaining "backend proven, not e2e-driven" | **OPEN** — `#/research`, theme/accent, log-search/debug-mode, skills, modules, remote-targets. `D-0491`/`D-0498`. |
| `F-TOOLS2-001` | **OPEN, recorded** — 3/17 CodeN slash commands untested at the dispatch layer. `D-0497`. |
| `F-RUST-001` | **OPEN, recorded** — 8/20 Rust crates with zero tests; `noesar-auth` compiled but never called. `D-0497`. |
| `F-CAP4-001` | **OPEN, recorded** — `capabilities/sandbox/` + `capabilities/templates/` unread by any code. `D-0497`. |
| 7 API groups with no dedicated backend test | **RECORDED, not fixed** — `artifacts`, `chat`, `closures`, `conversations`, `knowledge`, `search`, `sources`. `D-0494`. |
| `F7-001` | **OPEN, out of scope** — `capabilities/reference/*.py`, 23 CRITICAL/9 HIGH static findings from the `D-0204` sweep. |
| `F-SLASH-001` | **ROOT CAUSE CONFIRMED, not fixed** — needs a test-strategy choice. `D-0463`. |
| `F-MODEL-001` | **OPEN**, awaiting Owner choice — `#/models` `servedBy` not declared. `D-0395`. |
| `#/coden/bench/documentation` copy | **OPEN, `D-0489`** — wording proposed, needs Owner sign-off. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato. `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — catalogue-closable gap 643/909 (baseline 607). |
| `F-MANIFEST-001` | **OPEN**, pre-existing, out of scope — `MANIFEST.sha256` 5898 vs 6568 tracked files. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` still names the pre-rotation container IP. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — scope pronto (`docs/security/INDEPENDENT_PENTEST_SCOPE.md`), serve l'Owner per ingaggiare un tester esterno. |

All others from earlier sessions: **FIXED/DEPLOYED/CLOSED**, listed in full in
`docs/DECISION_LOG.md` — not repeated here.

## Verificato IN QUESTA SESSIONE

**`D-0497`** (TOOLS_MODULES_INDEX §2-4, 43 items) and **`D-0498`** (`#/settings/updates` e2e):
`coden-shell-parity.test.mjs` read directly for §2's structural coverage; `cargo test
--workspace --offline` in a disposable `rust:1-bookworm` container (`--network none`) — 144
passed, 0 failed; `capabilities/` wiring checked by `grep -rl` across `services/`,
`rust/crates/*/src`, `tools/*.mjs`. `tools/browser-e2e.mjs`'s new updates block: full
disposable-probe run via `tools/run-browser-e2e.sh` — 490/492 PASS, all 5 new checks PASS, 2
pre-existing unrelated FAILs. `docker ps -a --filter name=noesar-evolution` before/after both
sessions: unchanged, exactly the two permitted containers.

## Cosa NON è stato fatto

- **The 6 remaining page-level e2e gaps, `F-TOOLS2-001`, `F-RUST-001`, `F-CAP4-001`, the 8
  untested Rust crates, the 2 unread `capabilities/` dirs, `F7-001` re-triage** — all recorded,
  none built; new scope in every case.
- **A signed update package was not fabricated** to prove a live `apply` success — deliberate
  scope boundary, not an oversight (see `D-0498`).
- **`F-SLASH-001`, `F-MODEL-001`, the `documentation` copy fix, `cargo publish`, the pentest** —
  all still open, none built without authorization.

## Proposta di miglioramento

**Questo giro (`D-0498`)**: the reauth-gate determinism this check relies on (`updates` must run
BEFORE `authority-form` so `elevatedUntil` is still unearned) is a real, silent ordering
dependency between two blocks 700+ lines apart in a single 3,900+ line file — nothing enforces
or even documents it except a comment at the point of use. A small `assertSessionNotElevated()`
helper, called at the top of any block whose determinism depends on a fresh, unelevated
session, would turn a silent ordering assumption into a check that fails loudly and locally if a
future edit reorders these blocks, instead of turning one of today's PASS assertions flaky for a
reason nobody would trace back to file order. Cost: ~10 lines (one `fetch('/api/v1/auth/me')` or
equivalent, asserting `elevatedUntil` is unset/expired) plus one call site per dependent block
(currently 2: `updates`, `authority-form`). Recorded for the Owner's judgment; not built this
phase — it would touch a file already changed this phase for an orthogonal reason.

**Precedenti (`D-0497`-`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
