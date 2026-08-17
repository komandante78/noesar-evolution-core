# SESSION HANDOFF — 2026-08-17 (`D-0499`: the e2e ordering dependency becomes a self-proving assertion)

## ➜ LA PROSSIMA AZIONE

**`D-0498`'s improvement proposal, authorised by the Owner and now built.**
`tools/browser-e2e.mjs` gains `sessionElevation()` and `checkSessionNotElevated(block)`, called
at the head of the two blocks whose assertions only mean anything on an unelevated session —
`updates` and `authority-form`. Both prove a security gate by watching it **refuse first**, and
that determinism rested entirely on running before `/api/v1/auth/reauth` elevates the session —
an ordering dependency between two blocks ~700 lines apart, held together by a comment at each
site and nothing else. It is now an assertion that fails locally and names its cause.

**The guard proves itself, permanently.** A positive control sits immediately after the real
reauth — the one moment in the whole suite when the session is known to be elevated. It measured
`elevatedUntil:0, elevated:false` at both guards versus `elevatedUntil:1786953900383,
elevated:true` after reauth. Without it, both guards could report "not elevated" for reasons
having nothing to do with elevation (a renamed field, a 401, a shape change) and stay green
forever — a clean scan proving only that the scanner found nothing.

**Verified live: 493/500 PASS**, all 3 new checks PASS.

**The FAIL count moved 2→7 and this is NOT a regression — read this before reacting to it.**
Total moved 492→500: +3 from the new checks, **+5 from assertions that had never executed
before**. In earlier runs `soft('POINT-2B-MEASURE')` threw at the click, so the 5 assertions
inside it never ran and were never counted. This run execution got past that point, so they ran
and reported their (failing) state. All 5 belong to the already-open `F-SLASH-001`. The diff is
test-only, additive (77 insertions, 0 deletions), and touches no composer, terminal, panel or
navigation code. `F-SLASH-001` has been updated with this new evidence in `PROJECT_STATE.json`.

**Next — Owner's choice**:
1. **`F-SLASH-001`** — now the best-evidenced item on the list. The 5 newly-surfaced assertions
   describe the defect directly (`activePanel:null`, transcript showing the terminal's own
   `showAddress()` path). It still needs the Owner's **test-strategy choice**, unchanged since
   `D-0463`: **(A)** drive `/diff` through the live terminal and assert the transcript, or
   **(B)** keep testing the composer and have the check *declare* when the terminal has already
   claimed the surface.
2. One of the **6 remaining** "backend proven, not e2e-driven" gaps: `#/research`, theme/accent,
   log-search/debug-mode, skills, modules, remote-targets.
3. Another named open item (see table).

No code changes or deployment without explicit Owner authorization for whichever is chosen.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-SLASH-001` | **OPEN, ROOT CAUSE CONFIRMED, better evidenced (`D-0499`)** — needs the Owner's A/B test-strategy choice. Non-determinism now documented across 3 runs. |
| 6 remaining "backend proven, not e2e-driven" | **OPEN** — `#/research`, theme/accent, log-search/debug-mode, skills, modules, remote-targets. `D-0491`/`D-0498`. |
| `F-TOOLS2-001` | **OPEN, recorded** — 3/17 CodeN slash commands untested at the dispatch layer. `D-0497`. |
| `F-RUST-001` | **OPEN, recorded** — 8/20 Rust crates with zero tests; `noesar-auth` compiled but never called. `D-0497`. |
| `F-CAP4-001` | **OPEN, recorded** — `capabilities/sandbox/` + `capabilities/templates/` unread by any code. `D-0497`. |
| 7 API groups with no dedicated backend test | **RECORDED, not fixed** — `artifacts`, `chat`, `closures`, `conversations`, `knowledge`, `search`, `sources`. `D-0494`. |
| `F7-001` | **OPEN, out of scope** — `capabilities/reference/*.py`, 23 CRITICAL/9 HIGH from the `D-0204` sweep. |
| `F-MODEL-001` | **OPEN**, awaiting Owner choice — `#/models` `servedBy` not declared. `D-0395`. |
| `#/coden/bench/documentation` copy | **OPEN, `D-0489`** — wording proposed, needs Owner sign-off. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato. `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — 643 closable of 912 (baseline 607). |
| `F-MANIFEST-001` | **OPEN**, pre-existing — `MANIFEST.sha256` 5898 vs 6568 tracked files. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` still names the pre-rotation container IP. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — scope pronto, serve l'Owner per ingaggiare un tester esterno. |

All others: **FIXED/DEPLOYED/CLOSED** in `docs/DECISION_LOG.md`.

## Verificato IN QUESTA SESSIONE

Three phases, all committed and pushed: **`D-0497`** (TOOLS_MODULES_INDEX §2-4, 43 items —
`cargo test --workspace --offline` in a disposable `rust:1-bookworm` container, `--network
none`: **144 passed, 0 failed**), **`D-0498`** (`#/settings/updates` driven end to end, 5 new
checks, probe 490/492), **`D-0499`** (the ordering guard, probe **493/500**, positive control
discriminating measurably).

`docker ps -a --filter name=noesar-evolution` after every run: exactly the two permitted
containers, no e2e image tag and no stamped network survived. `tools/run-eslint.sh`: 411 files,
0 errors. Secret scan: **heuristic** (`gitleaks` absent on this host, declared per rule 45).

## Cosa NON è stato fatto

- **`F-SLASH-001` is not fixed** — it is better evidenced, which is not the same thing. It needs
  a design decision only the Owner can make.
- **The 5 newly-surfaced `POINT-2B` assertions were not repaired** — they are the already-open
  finding becoming visible, and repairing them is the A/B choice above, not this phase's scope.
- **The 6 remaining page-level e2e gaps, `F-TOOLS2-001`, `F-RUST-001`, `F-CAP4-001`, the 8
  untested Rust crates, `F7-001` re-triage** — recorded, none built.
- **No product code was changed in any of the three phases** — `D-0497` was documentation,
  `D-0498` and `D-0499` are test-only.

## Proposta di miglioramento

**Questo giro (`D-0499`)**: `soft()` swallows a throw and records one FAIL, which is correct for
carrying on — but it also means every assertion *after* the throw inside that block silently
never runs, and the suite total shrinks without saying so. That is how 5 real assertions stayed
invisible across at least two runs, and why today's honest improvement looked like a regression
in the raw counts. `soft()` could **declare the assertions it skipped** — count the checks a
block would have made versus the ones it reached, and report `N assertions unreached because the
step aborted`. Cost: a per-block counter and one line of output; benefit: the suite total stops
being a number that silently depends on where an exception landed, which is the same "declare
what you do not show, and why" rule the product's own `/` menu already follows (`hiddenNote`,
`agent-commands.js`). Recorded for the Owner's judgment; not built — it would touch the harness
in the same phase that already changed it for an orthogonal reason.

**Precedenti (`D-0498`-`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
