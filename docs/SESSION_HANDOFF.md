# SESSION HANDOFF — 2026-08-17 (`D-0500`: the harness stops hiding assertions it never reached)

## ➜ LA PROSSIMA AZIONE

**Blocked on one Owner decision, and only one.** `F-SLASH-001` is now the best-evidenced item
on the whole list, and everything about it is understood except the choice that is not mine to
make — the **A/B test-strategy fork**, unchanged since `D-0463`:

- **design A** — drive `/diff` through the live terminal and assert its transcript. The more
  faithful test of the Owner's original complaint ("*i comandi / non vedo cambiamenti*") now that
  the terminal is the surface a person actually looks at.
- **design B** — keep testing the composer specifically, and have the check **declare** when the
  terminal has already claimed the surface, on the reasoning that the composer's own
  gesture-to-panel path is separately proven by the authority and plan-creation checks.

Neither is self-evidently right, and picking wrong means building the wrong test. Everything
that did not depend on that choice has already been delivered (`D-0498`, `D-0499`, `D-0500`).

**Alternatives if you would rather not decide that now**: one of the **6 remaining** "backend
proven, not e2e-driven" gaps (`#/research`, theme/accent, log-search/debug-mode, skills, modules,
remote-targets), or another named open item from the table.

No code changes or deployment without explicit Owner authorization.

## Cosa è cambiato in questa sessione (3 fasi, tutte committate e pushate)

**`D-0497`** — `TOOLS_MODULES_INDEX` §2-4 reviewed, 43 items: **102/102 named items now
reviewed**. `cargo test --workspace --offline` in a disposable `rust:1-bookworm` container
(`--network none`): **144 passed, 0 failed** — the first real measurement of the Rust half.
Three findings recorded: `F-TOOLS2-001`, `F-RUST-001`, `F-CAP4-001`.

**`D-0498`** — `#/settings/updates` driven end to end, 5 new checks (check / change-channel,
round-tripped / approve / apply / rollback), each asserted against the real honest outcome for a
fresh install. Closed the 6th of `D-0491`'s 9 named e2e gaps.

**`D-0499`** — the silent ordering dependency between the `updates` and `authority-form` blocks
became an assertion, with a **permanent positive control** after the real reauth proving the
detector discriminates (`elevatedUntil:0/false` at both guards vs a live timestamp after reauth)
rather than merely passing.

**`D-0500`** — `soft()` now declares what an aborted block never reached. The count is **derived**
from the block's own source, never hand-kept. Verified live: the accounting fired on the real
throw — `0/7 check call sites in this block ran, 7 never reached`.

**Why `D-0500` mattered more than it looks**: the suite total moved 492 → 500 → 495 across this
session's runs, purely because of *where* one exception landed. Five real assertions had been
invisible for at least two runs, and their appearance in the `D-0499` run read as a regression
when it was the opposite. That number is now self-explaining.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-SLASH-001` | **OPEN — needs the Owner's A/B choice (above).** Root cause confirmed; 4 distinct manifestations in 4 runs, now self-documenting in the run output. |
| 6 remaining "backend proven, not e2e-driven" | **OPEN** — `#/research`, theme/accent, log-search/debug-mode, skills, modules, remote-targets. `D-0491`/`D-0498`. |
| `F-TOOLS2-001` | **OPEN, recorded** — 3/17 CodeN slash commands untested at the dispatch layer. `D-0497`. |
| `F-RUST-001` | **OPEN, recorded** — 8/20 Rust crates with zero tests; `noesar-auth` (real Argon2/TOTP) compiled, declared as a dependency, never called anywhere. `D-0497`. |
| `F-CAP4-001` | **OPEN, recorded** — `capabilities/sandbox/` + `capabilities/templates/` unread by any code. `D-0497`. |
| 7 API groups with no dedicated backend test | **RECORDED** — `artifacts`, `chat`, `closures`, `conversations`, `knowledge`, `search`, `sources`. `D-0494`. |
| `F7-001` | **OPEN, out of scope** — `capabilities/reference/*.py`, 23 CRITICAL/9 HIGH from the `D-0204` sweep. |
| `F-MODEL-001` | **OPEN**, awaiting Owner choice — `#/models` `servedBy` not declared. `D-0395`. |
| `#/coden/bench/documentation` copy | **OPEN, `D-0489`** — wording proposed, needs Owner sign-off. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato. `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — 643 closable of 904 (baseline 607). |
| `F-MANIFEST-001` | **OPEN**, pre-existing — `MANIFEST.sha256` 5898 vs 6568 tracked files. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` still names the pre-rotation container IP. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — scope pronto, serve l'Owner per ingaggiare un tester esterno. |

All others: **FIXED/DEPLOYED/CLOSED** in `docs/DECISION_LOG.md`.

## Verificato IN QUESTA SESSIONE

`cargo test --workspace --offline`: **144/144**. Final probe: **493/495 PASS**, the only 2 FAILs
both pre-existing and tracked. `D-0500`'s counting logic: **9/9** oracle cases, seen RED first.
`tools/run-eslint.sh`: 411 files, 0 errors, 0 warnings. `node tools/verify-source.mjs`:
`SOURCE_VERIFY=PASS migrations=19 baseline=12/12 intact`. Secret scan: **heuristic** — `gitleaks`
is absent on this host, declared per rule 45. `docker ps -a` after every run: exactly the two
permitted containers, no e2e image tag and no stamped network survived.

## Cosa NON è stato fatto

- **`F-SLASH-001` is not fixed.** It is better evidenced and now self-documenting, which is not
  the same thing. It needs the A/B decision above.
- **The 7 `POINT-2B` assertions inside it were not repaired** — repairing them *is* the A/B
  choice, not a separate task.
- **A prediction made before the final run did not hold** (`5/7` expected, `0/7` observed,
  because the flake landed at the click instead of past it). Recorded in `D-0500` rather than
  dropped: a prediction that missed is evidence about the flake.
- **The 6 remaining page-level gaps, `F-TOOLS2-001`, `F-RUST-001`, `F-CAP4-001`, the 8 untested
  Rust crates, `F7-001` re-triage** — recorded, none built.
- **No product code was changed in any of the four phases** — `D-0497` documentation, `D-0498`/
  `D-0499`/`D-0500` test-only.

## Proposta di miglioramento

**Questo giro (`D-0500`)**: `scripts/test.sh` still has no step that runs `cargo test` — it runs
two *static* Rust verifiers (`rust-source`, `rust-provenance`) and nothing that executes the
crates, so the 144 tests measured this session are invisible to the project's own
portable-verification entry point and stay that way unless a session goes looking by hand. This
is the same proposal `D-0497` recorded and it is now worth more, because `D-0497` proved the run
works offline from vendored dependencies and `D-0500` proved the harness can be trusted to
declare what it did not run. Cost: one shell function (~15 lines, the disposable
`rust:1-bookworm --network none` pattern is already written down in `D-0497`), plus a cold
compile per full sweep (~2-3 min, since `--rm` keeps no `target/`) — removable with a named
volume scoped to that container, itself a smaller second improvement. Benefit: `cargo test`
becomes a `PASS`/`FAIL`/`UNAVAILABLE` line in every full sweep instead of a fact nobody sees.
Recorded, not built — it was not in this phase's authorised scope.

**Precedenti (`D-0499`-`D-0460`)**: see `docs/DECISION_LOG.md`.
