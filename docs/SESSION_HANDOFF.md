# SESSION HANDOFF

**Phase:** `D-0586` — an induced fact is unwritable without evidence, count and refutation
condition; two embedding spaces raise instead of comparing. Ratchet **13 → 11**, critical still
**0**. `D-0587` proposed.
**Live installation:** **`noesar-evolution:d0586-induced-facts-and-spaces-20260819T180231Z`**,
deployed 18:02Z, `running`/`healthy`, byte-equal to the tree **457/457**. Predecessor kept as
`noesar-evolution-pre-20260819T180243Z`.

## ➜ LA PROSSIMA AZIONE

```text
node tools/verify-acceptance-matrix.mjs   ->  unstated 11, critical 0   (seen to FAIL at 10)
```

**The cheap class is gone — emptied over `D-0581`, `D-0583`, `D-0586` — and none of the 11 that
remain is cheap. That is now measured, not guessed.** Three classes; the next phase should say
which it takes:

- **(a) needs a harness that does not exist** — `CE-005` (the context at call *n* > 300 has the
  shape of call 3: a long-run harness) · `CE-006` (every model call re-runnable in isolation).
- **(b) needs a second machine** — `CE-031` `CE-032` `CE-035` (`ssh` reachability and launcher
  portability). These cannot be honestly closed on this host alone. **Declare that rather than
  approximate it** — an approximated verdict on a portability row is exactly the false PASS
  rule 38 exists for.
- **(c) needs product that is not built** — `CE-023` (projection coverage **measured** with
  ATOM) · `CE-024` (human review time per accepted change) · `CE-027`/`CE-028`/`CE-030`
  (authoring fixtures, divergence into authoring, identical authorings counted once).

**`CE-020` sits alone** (every capability has a complete keyboard form): it is the only one whose
parts may already exist — `tools/tui-fullscreen.mjs` and `test/ce-020-tui-fullscreen.test.mjs`
are there. **Scope it first**: list the capabilities, check which have no keyboard path, and only
then commit a phase to it.

**Also open:** `D-0564`, still the most valuable unbuilt idea — the event ledger's head is a hash
with no key, so it detects an edit but not a rewrite. And `F-TOOLSCOPE-001` (`D-0574` argues
against wiring it until a route can mint for catalog tools).

**`production_ready` stays `false`.** 11 rows with no verdict is not a finished product.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Two phases, and the second one closed the two rows the first had measured as too expensive.**

`D-0583` — **coverage and the NOT DONE box are enforced in the report, not only in the producer.**
`CE-009` says *"a test that refuses a **report**"*. `projectionCoverage()` had never rounded a
partial result up; nothing checked the report, which is what a person reads. Measured before the
repair: a decided run with no coverage served JSON where the `coverage` key **vanished**
(`undefined` is dropped by `JSON.stringify`); `complete:true` over **6/9** passed through
untouched; every promoted run served `notDone: null`. Now: the coverage whole · a **declared**
absence when nothing was measured · `SessionProofRefused` when the two disagree — and the NOT DONE
box is built from measured facts, with an empty box a **declaration**.

`D-0586` — **the schema refuses what the schema was told to refuse.** Both `CE-011` and `CE-012`
name the schema in their stated method, so migration `0020` carries them:

| Row | What it took | Where the proof is |
|---|---|---|
| `CE-011` | `refutation_condition` + **three separate** constraints on the `experience` cube, so a violation names **which** part is missing | `MEM-37/38/39` refused **by the table** through the admin connection, `MEM-40` written when complete, `MEM-41` the rule stays scoped to induction, `MEM-42` end-to-end |
| `CE-012` | `vector_distance()` — the comparison had to be **built** before it could refuse | `MEM-45` two spaces → `22000` · `MEM-46` null model → refused · `MEM-47` absent vector → refused ("missing" ≠ "identical") · `MEM-43/44` a real distance, and **0** against itself |

**Nothing was invented to make them pass.** No embedding pipeline was fabricated — `recall()`
still reports `vectorIndexComplete:false` honestly. Legacy `experience` rows are marked
`UNDECLARED:` rather than given a fictional condition, and the application refuses that marker
from a caller. Measured on this installation before writing the migration: `experience` rows =
**0**, so the backfill is a no-op here and exists for other installations.

**A defect in the measurement apparatus** (`D-0584`): `canonical-json.test.mjs` resolved its
conformance vector from the **process CWD** — it passed from the repository root and threw
`ENOENT` from `services/reference-control-plane/`. **8/8 from three directories** now.

**Verified this session:** `memory-integration` **46/46** on a real PostgreSQL 18 cluster booted
from nothing · unit **2861, 0 fail** · `scripts/test.sh` **15/15** · ESLint **453 files, 0
errors** · matrix PASS, ratchet seen to FAIL at 12 and again at 10 · both deployments byte-equal
to the tree (**455/455**, **457/457**) · the three constraints, the column and the function
proved **present on the running database**, not merely shipped.

## WHAT WAS **NOT** DONE

- **`D-0586`'s rollback cost is NOT none, and this is the first in the series where that is
  true.** `0020` has no `down`: rolling back leaves the column and constraints in place, and the
  previous code — which never writes `refutation_condition` — would have every `experience` write
  refused. It bites nothing today (0 rows, no surface writes that cube) and is written down
  rather than discovered mid-rollback.
- **Live constraint BEHAVIOUR was not exercised against the installation** — proving it would
  require writing a row, and §3a 11e forbids a mutating suite against the installation. It was
  proved on the disposable cluster; what is proved live is that the schema objects exist.
- **Browser e2e and the accessibility audit were not run** in either phase: no markup, no DOM, no
  CSS token changed, and no shell renders the fields either phase added.
- **`D-0585` and `D-0587` were proposed, not built.** The coverage line is enforced but invisible
  to a person; and `refutations` is now declarable but nothing in the product ever **observes** a
  refutation, so the condition is written and never evaluated.
- **Both phases overran their declared budgets.** Each contract said no install; §3a binds a
  shipping change to install and verify in the same phase, and a schema change doubly so.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): its premise ("neither gitleaks nor trufflehog is installed") — the
  scans this session ran were **heuristic and declared as such**; neither tool is on `PATH`.
- `B-011` low/deferred (`D-0258`): git history rewritten on the Owner's explicit authorisation,
  bundle backup taken.
