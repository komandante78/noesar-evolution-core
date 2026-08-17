# SESSION HANDOFF — 2026-08-17 (`D-0497`: TOOLS_MODULES_INDEX §2-4 deep review complete)

## ➜ LA PROSSIMA AZIONE

**`TOOLS_MODULES_INDEX_2026-08-16.md` is now fully reviewed: 102/102 named items,
`Checked: SI` throughout.** `D-0494` (2026-08-16) covered §1 (59 backend API route groups).
This session, on Owner authorization ("procedi con 1"), covered §2 (17 CodeN slash commands),
§3 (20 Rust crates), §4 (6 `capabilities/` dirs) — same content-match method, not
filename-prefix guessing. Full detail: `docs/DECISION_LOG.md` `D-0497`, the index document
itself (§2-4 findings sections).

**Real, measured result for the Rust half of the stack, not previously produced in any
session**: `cargo test --workspace --offline`, run in a disposable `rust:1-bookworm` container
(`--network none`, the repository's own vendored dependencies) → **144 passed, 0 failed**
across 26 test binaries. First attempt genuinely failed on a mount-scope mistake (only `rust/`
was mounted, so `noesar-capability`'s conformance test could not reach the project-root
`conformance/*.json` vectors) — re-run with the whole repository mounted fixed it; recorded in
`D-0497` so the false failure is not later mistaken for a real one.

**Three new findings, all recorded not fixed** (matching §1's own posture for its 7 gaps —
writing tests or rewiring crates is new scope, not a documentation-review finding to expand
into): `F-TOOLS2-001` (3/17 slash commands — `/reject`, `/simulate`, `/git` — have their engine
logic tested but not the dispatch layer a keystroke goes through), `F-RUST-001` (8/20 Rust
crates carry zero tests; `noesar-auth`'s Argon2/TOTP logic is compiled, declared as a
dependency, and never actually called anywhere in the workspace; 3 crates compile but are
packaged into no Dockerfile), `F-CAP4-001` (`capabilities/sandbox/` and `capabilities/templates/`
are read by no product code).

**Next — Owner's choice**:
1. Apply the same e2e-driving template to another of the 7 remaining "backend proven, not
   e2e-driven" page-level occurrences `D-0491` named.
2. Act on one of the three new findings, or another named open item (see table below).

No code changes or deployment without explicit Owner authorization for whichever is chosen.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-TOOLS2-001` | **OPEN, recorded** — 3/17 CodeN slash commands untested at the dispatch layer. `D-0497`. |
| `F-RUST-001` | **OPEN, recorded** — 8/20 Rust crates with zero tests; `noesar-auth` compiled but never called. `D-0497`. |
| `F-CAP4-001` | **OPEN, recorded** — `capabilities/sandbox/` + `capabilities/templates/` unread by any code. `D-0497`. |
| 7 API groups with no dedicated backend test | **RECORDED, not fixed** — `artifacts`, `chat`, `closures`, `conversations`, `knowledge`, `search`, `sources`. `D-0494`. |
| `F7-001` | **OPEN, out of scope** — `capabilities/reference/*.py`, 23 CRITICAL/9 HIGH static findings from the `D-0204` sweep. Not re-triaged this session. |
| `F-SLASH-001` | **ROOT CAUSE CONFIRMED, not fixed** — needs a test-strategy choice. `D-0463`. |
| `F-MODEL-001` | **OPEN**, awaiting Owner choice — `#/models` `servedBy` not declared. `D-0395`. |
| `#/coden/bench/documentation` copy | **OPEN, `D-0489`** — wording proposed, needs Owner sign-off. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato. `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — catalogue-closable gap 644/908 (baseline 607). |
| `F-MANIFEST-001` | **OPEN**, pre-existing, out of scope — `MANIFEST.sha256` 5898 vs 6568 tracked files. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` still names the pre-rotation container IP. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — scope pronto (`docs/security/INDEPENDENT_PENTEST_SCOPE.md`), serve l'Owner per ingaggiare un tester esterno. |

All others from earlier sessions: **FIXED/DEPLOYED/CLOSED**, listed in full in
`docs/DECISION_LOG.md` — not repeated here.

## Verificato IN QUESTA SESSIONE

**§2 (slash commands)**: `coden-shell-parity.test.mjs` read directly — confirmed it iterates
`AGENT_COMMANDS` for resolution and `CE-036` permission-parity across all 17 uniformly. Per-command
dispatch coverage checked by content grep across `services/reference-control-plane/test/*.test.mjs`.

**§3 (Rust crates)**: `cargo test --workspace --offline` in a disposable, offline, `--network
none` `rust:1-bookworm` container — **144 passed, 0 failed**, 26 binaries. `noesar_auth` grepped
across every crate's `src/*.rs` — zero `use` sites. Dependents of `noesar-control-plane`,
`noesar-hardware-orchestrator`, `noesar-audit-ledger` grepped across `crates/*/Cargo.toml` and
`oci/*.Dockerfile` — zero.

**§4 (`capabilities/`)**: full file listing of all 6 subdirectories; `grep -rl` for each
filename across `services/`, `rust/crates/*/src`, `tools/*.mjs`, `docs/*.md`.

**`node tools/verify-source.mjs`**: `SOURCE_VERIFY=PASS migrations=19 baseline=12/12 intact`
(T0 — this session's edits were documentation/state only, no source changed).

**Container hygiene**: `docker ps -a --filter name=noesar-evolution` before and after —
unchanged (`noesar-evolution` running, one rollback kept). The analysis container used
`--rm --network none`; `docker ps -a` confirms nothing named `noesar-evolution-rust-audit*`
survives. No image was pulled — `rust:1-bookworm` was already present on this host.

## Cosa NON è stato fatto

- **Tests for the 3 dispatch-layer gaps, the 8 untested Rust crates, or the 2 unread
  `capabilities/` dirs** — recorded, not written; new scope, same posture §1 took for its own gaps.
- **`F7-001` was not re-triaged** — an already-open, already-evidenced finding; re-auditing it
  would be the exact re-read `noesar-evolution-context` rule 1 forbids.
- **`F-SLASH-001`, `F-MODEL-001`, the `documentation` copy fix, the other 7 named page-level
  e2e gaps, `cargo publish`, the pentest** — all still open, none built without authorization.

## Proposta di miglioramento

**Questo giro (`D-0497`)**: `scripts/test.sh` has zero named step for the Rust workspace — it
runs the Python verifiers (`rust-source`, `rust-provenance`, both static/documentation checks)
but never `cargo test` itself, so a "full sweep" of this project's own portable-verification
entry point silently never runs the 144 tests this session had to invoke by hand, in a
one-off container, to get a real number. Adding a named `rust-test` step (same disposable
`rust:1-bookworm --network none` pattern already proven this session, now that the mount-scope
mistake is known and avoidable) would make `cargo test`'s result a `PASS`/`FAIL`/`UNAVAILABLE`
line in every full sweep instead of a fact nobody sees unless a session goes looking — the same
"declared, not implied" standard `scripts/test.sh`'s own Python steps already hold Rust to for
documentation but not for execution. Cost: one shell function (~15 lines, the pattern already
exists in this session's own commands) plus the build-time cost already paid once per full
sweep (~10s incremental once `target/` is warm inside the throwaway container — though a
`--rm` container never keeps `target/`, so each run currently pays the ~2-3 min cold-compile
cost; a named volume for `target/` scoped to this analysis container would remove that, itself
a second, smaller improvement). Recorded for the Owner's judgment; not built this phase.

**Precedenti (`D-0496`-`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
