# SESSION HANDOFF

**Phase:** `D-0583` — projection coverage and the `NON FATTO` box enforced in the **report**.
Ratchet **17 → 13**, critical still **0**. `D-0584` repaired, `D-0585` proposed.
**Live installation:** **`noesar-evolution:d0583-coverage-and-notdone-20260819T173441Z`**,
deployed 17:35Z, `running`/`healthy`, byte-equal to the tree **455/455**. Predecessor kept as
`noesar-evolution-pre-20260819T173528Z`.

## ➜ LA PROSSIMA AZIONE

```text
node tools/verify-acceptance-matrix.mjs   ->  unstated 13, critical 0   (seen to FAIL at 12)
```

**The "cheap" class the previous handoff named is now empty — and two of its six rows were
never cheap.** They were examined, not skipped, and here is what they actually need:

- **`CE-011`** (*ogni fatto indotto porta evidenza, conteggio e condizione di smentita*) needs a
  **migration**. `noesar_knowledge.memory_records` already has `confirmations`/`refutations`
  (constrained to the `experience` cube) and `derived_must_cite`, but **no column holds the
  refutation condition** and nothing makes a fact unwritable without one — and the stated method
  is *"schema + test: un fatto senza smentita non è scrivibile"*, so a JS guard would not satisfy
  it.
- **`CE-012`** (*un vettore senza il suo modello è un errore, non un numero*) needs a **comparison
  surface that does not exist**. The datum is in place — `memory_vectors` is keyed
  `(record_id, model_id)` — but `memory-service.mjs` states no embedding pipeline is wired, so
  there is nothing to run *"il test di confronto fra due spazi diversi"* against.

Both are Postgres-shaped work, verified through **`scripts/test.sh`** (this host has no
`python3`), not JS-shaped work like the four just closed.

**The 13 remaining:** `CE-005` `CE-006` `CE-011` `CE-012` `CE-020` `CE-023` `CE-024` `CE-027`
`CE-028` `CE-030` `CE-031` `CE-032` `CE-035`. `CE-020` (every capability has a complete keyboard
form) is still the one worth **scoping before** picking up. `CE-031`/`CE-032`/`CE-035` need a real
second machine.

**Also open:** `D-0564`, still the most valuable unbuilt idea — the event ledger's head is a hash
with no key, so it detects an edit but not a rewrite. And `F-TOOLSCOPE-001`, which `D-0574` argues
against wiring until a route can mint for catalog tools.

**`production_ready` stays `false`.** 13 rows with no verdict is not a finished product.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**A rule enforced only in the producer is a rule the report walks around.** `CE-009` says *"test
che rifiuta un **rapporto** senza copertura o con copertura implicita"*. `projectionCoverage()` had
never rounded a partial result up, and its own tests proved that — but nothing checked the report,
and the report is what a person reads.

Measured on `assembleSessionProof()` **before** the repair:

| What was served | Why it is the defect |
|---|---|
| `{"diff":[],"risk":…,"promoted":false}` for a decided run with no coverage | `coverage: undefined` is **dropped** by `JSON.stringify` — coverage absent, not declared absent |
| a coverage object claiming `complete:true` over **6/9** recomputed | the report asserted a complete projection of a partial one |
| `notDone: null` on **every** promoted run | a blank `NON FATTO` box, indistinguishable from a run nobody checked — the exact thing §16 forbids |

Now three outcomes where there was one: the coverage whole · a **declared** absence
(`{measured:false, reason}`) when nothing was measured · `SessionProofRefused` when the two
disagree. The `NON FATTO` box is composed from measured facts — every claim the verifier did not
recompute, named with its reason — and an empty box is a **declaration**, proven after
serialisation.

| Row | Verdict | What it took |
|---|---|---|
| `CE-009` | ✅ MET | the guard above + `ce-009-coverage-never-absent-never-implicit.test.mjs` **11/11** |
| `CE-019` | ✅ MET | the same file, plus `ClosureRegister`'s existing refusal — **two** reports, and the second had no owner |
| `CE-010` | ✅ MET | `divergence-profile.test.mjs` **10/10** — two real git repositories with opposite habits, the same candidate change profiled against each |
| `CE-016` | ✅ MET | `ce-016-zero-tools-at-rest.test.mjs` **4/4** — zero tools at rest across ten catalogue sizes, 0 → 5000 |

**A defect in the measurement apparatus, found by running it from elsewhere** (`D-0584`):
`canonical-json.test.mjs` resolved its conformance vector from the **process CWD**, so it passed
from the repository root and threw `ENOENT` from `services/reference-control-plane/`. Every other
vector test in that directory resolves from the file. **8/8 from three directories** now.

**Verified this session:** unit **2853, 0 fail** · ESLint **452 files, 0 errors** ·
`verify-source` PASS · matrix PASS, ratchet **seen to FAIL at 12** before being set to 13 ·
live `/livez` `/readyz` `/healthz` **200** on 8100 **and** 8443 · `sha256` of `session-proof.mjs`
**identical** between tree and running container.

## WHAT WAS **NOT** DONE

- **`CE-011` and `CE-012` carry no verdict**, and the previous handoff called them cheap. They are
  not. The reason is above, and it is a measurement, not an estimate.
- **`tools/run-browser-e2e.sh` and `tools/accessibility-audit.mjs` were not run.** This phase
  changed one runtime module with no markup, no DOM and no CSS token, and no shell renders the
  field it changed.
- **`scripts/test.sh` (the full battery) was not re-run** after the unit suite went green on the
  same tree — `noesar-evolution-verify` single-pass rule 4, declared rather than implied.
- **`D-0585` was proposed, not built** — the coverage line is enforced but still invisible to a
  person; no shell shows `esito.coverage`.
- **The phase overran its declared budget** (~45 tool calls, actual ~70): the contract said no
  install, and §3a binds a shipping source change to install and verify in the same phase.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): its premise ("neither gitleaks nor trufflehog is installed") — the
  scan this phase ran was **heuristic and declared as such**; neither tool is on `PATH`.
- `B-011` low/deferred (`D-0258`): git history rewritten on the Owner's explicit authorisation,
  bundle backup taken.
