# SESSION HANDOFF — 2026-08-16 (`D-0494`: TOOLS_MODULES_INDEX §1 reviewed, 2 defects corrected)

## ➜ LA PROSSIMA AZIONE

**The other list built this morning (`D-0473`, 08:14) has had its first slice reviewed.**
`docs/TOOLS_MODULES_INDEX_2026-08-16.md` §1 (60 backend API route groups) is now checked in
depth, same discipline as the pages-index review (`D-0474`-`D-0491`). Two real defects found and
corrected **in the document**: `projects` (v1)/(v2) were the same implementation counted twice
(real total 59 groups, not 60 — `server.mjs` has exactly one `/api/v1/projects` block); and §6's
claim that `ATOM_EVOLUTION` is "still empty" was false — it has 28 real commits and a working
`atomd` daemon satisfying all 11 `ReasoningProvider` surfaces (self-declared gap:
`ATOM_SELECTED_BY_ANY_ENGINE=false`, nothing calls it yet). 7 groups have real routes but no
dedicated backend test by name (`artifacts`, `chat`, `closures`, `conversations`, `knowledge`,
`search`, `sources`) — recorded, not fixed (writing 7 new test files was not this phase's scope).
Details: `docs/DECISION_LOG.md` `D-0494`.

**§2 (17 slash commands), §3 (20 Rust crates), §4 (6 `capabilities/` dirs) of the same file
remain at `Checked: NO`** — natural next slice of this same review.

**`D-0469`'s deploy from 2026-08-15 is still what is live and healthy** — `D-0493`'s `app.js`
fix (password/passkey handlers) is proven on the disposable e2e probe only, **not yet deployed**.

**Next — Owner's choice**:
1. Continue `TOOLS_MODULES_INDEX` — §2 (slash commands), §3 (Rust crates) or §4 (`capabilities/`).
2. **Deploy** the `D-0493` `app.js` fix to the live installation.
3. Apply the same e2e-driving template to another of the 7 remaining "backend proven, not
   e2e-driven" page-level occurrences `D-0491` named.
4. Act on another named open item (see table below).

No code changes or deployment without explicit Owner authorization for whichever is chosen.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `app.js` password/passkey fix | **APPLIED, not deployed** — `D-0493`, e2e-proven on the probe, live installation still runs the old (buggy) build. |
| `TOOLS_MODULES_INDEX` §2-4 | **OPEN** — 43 of 102 named items (slash commands, Rust crates, `capabilities/` dirs) not yet reviewed. `D-0494`. |
| 7 API groups with no dedicated backend test | **RECORDED, not fixed** — `artifacts`, `chat`, `closures`, `conversations`, `knowledge`, `search`, `sources`. `D-0494`. |
| `F-SLASH-001` | **ROOT CAUSE CONFIRMED, not fixed** — needs a test-strategy choice. `D-0463`. |
| `F-MODEL-001` | **OPEN**, awaiting Owner choice — `#/models` `servedBy` not declared. `D-0395`. |
| `#/coden/bench/documentation` copy | **OPEN, `D-0489`** — wording proposed, needs Owner sign-off. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato. `D-0468`. `ATOM_EVOLUTION` stesso **non è vuoto** (28 commit, corretto in `D-0494`). |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — catalogue-closable gap 644/908 (baseline 607). |
| `F-MANIFEST-001` | **OPEN**, pre-existing, out of scope — `MANIFEST.sha256` 5898 vs 6568 tracked files. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` still names the pre-rotation container IP. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — scope pronto (`docs/security/INDEPENDENT_PENTEST_SCOPE.md`), serve l'Owner per ingaggiare un tester esterno. |

All others from earlier sessions: **FIXED/DEPLOYED/CLOSED**, listed in full in
`docs/DECISION_LOG.md` — not repeated here (D-0460 through D-0493).

## Verificato IN QUESTA SESSIONE

Documentation-only review: 60 rows of `TOOLS_MODULES_INDEX_2026-08-16.md` §1 cross-checked
against real routes in `server.mjs` (grep, both spacing styles the file uses) and real test
coverage in the 166-file `test/` directory (by content match, not filename-prefix guessing — a
first-pass filename check undercounted badly, e.g. missed 11 `coden-*.test.mjs` files entirely).
`node tools/verify-source.mjs`: `SOURCE_VERIFY=PASS`. No product code touched.

## Cosa NON è stato fatto

- **§2, §3, §4 of `TOOLS_MODULES_INDEX`** (43 of 102 named items) — not yet reviewed.
- **Tests for the 7 groups found undertested** — recorded as a gap, not written; new scope.
- **Deployment of the `D-0493` `app.js` fix** — still only proven on the disposable e2e probe.
- **`F-SLASH-001`, `F-MODEL-001`, the `documentation` copy fix, the `file-extractors.mjs`
  packaging, the other 7 named page-level e2e gaps** — all still open, none built without
  authorization.

## Proposta di miglioramento

**Questo giro (`D-0494`)**: a group with real routes and zero dedicated tests is invisible to
every automated signal this project has (unit suite green, e2e green) — it only surfaces by a
human reading `server.mjs` against `test/` by hand, which is exactly how the 7-group gap and the
`projects` double-count were found. Worth a small script (`tools/verify-route-coverage.mjs`)
that extracts every `/api/v1/*` group from `server.mjs` and flags any with zero matching test
file content (not filename-prefix — this session's own experience shows that undercounts),
turning this from a one-off manual pass into a repeatable check the CI-equivalent suite can run.
Benefit: the exact gap this phase found, caught automatically on every future route added. Cost:
low — a few hours, same shape as `tools/measure-page-liveness.mjs` already proves works.

**Precedenti (`D-0493`-`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
