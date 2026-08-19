# SESSION HANDOFF

**Phase:** `D-0581` — the four shell-parity acceptance rows measured. Ratchet **21 → 17**,
critical still **0**. `D-0582` proposed.
**Live installation:** **`noesar-evolution:d0581-shell-parity-20260819T161549Z`**, deployed
16:16Z, `running`/`healthy`, byte-equal to the tree **454/454**. Predecessor kept as
`noesar-evolution-pre-20260819T161603Z`.

## ➜ LA PROSSIMA AZIONE

```text
node tools/verify-acceptance-matrix.mjs   ->  unstated 17, critical 0
```

**The 17 remaining rows are not all the same cost, and the next phase should say which class it
is taking.**

**Cheap — provable against things already built:** `CE-009` (projection coverage never rounded to
"complete") · `CE-010` (the divergence profile is recomputed from git history, not configured) ·
`CE-011` (every induced fact carries evidence, count and refutation condition) · `CE-012` (a
vector without its model is an **error**, not a number) · `CE-016` (zero tools loaded at rest) ·
`CE-019` (the final report cannot leave `NON FATTO` empty without declaring it — the closure
register already refuses one).

**Expensive — needs product or infrastructure that may not exist:** `CE-005` (context at call
n>300 has the shape of call 3 — a long-run harness) · `CE-006` (every model call re-runnable in
isolation) · `CE-023` (projection coverage **measured** with ATOM) · `CE-024` (human review time
per accepted change — probably not built at all) · `CE-027`/`CE-028`/`CE-030` (authoring fixtures,
divergence into authoring, identical authorings counted once) · `CE-031`/`CE-032`/`CE-035` (`ssh`
reachability and launcher portability — need a real second machine).

`CE-020` (every capability has a complete keyboard form) sits between the two: **scope it before
picking it up.**

**Also open:** `D-0564`, still the most valuable unbuilt idea — the event ledger's head is a hash
with no key, so it detects an edit but not a rewrite. And `F-TOOLSCOPE-001`, which `D-0574` argues
against wiring until a route can mint for catalog tools.

**`production_ready` stays `false`.** 17 rows with no verdict is not a finished product.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**The family this project had already been burned by now has verdicts.** Its own skill records
it: *«le due shell non divergono in nessun punto» è scritto dal 26 luglio, mai applicato, e niente
lo faceva fallire*.

| Row | Verdict | What it took |
|---|---|---|
| `CE-021` | ✅ | The worst case of that failure: `two-shells-parity.test.mjs` carries a suite **titled** `CE-021` that measures the permission policy — a different claim wearing the criterion's name. The unmeasured half is now measured by the criterion's own method: start through transport A, **discard A entirely**, and a transport built afterwards finds the run, measures it, approves it, and the bytes land. **Negative control:** a *second* engine over the same workspace does **not** find that run |
| `CE-033` | ✅ | Its method forbids the easy test ("the two renderings, not the two implementations"), so: the frame has exactly three regions plus one conditional, found **inside a painted frame**; and neither shell can hold a region the other lacks because neither *composes* a frame — each writes one thing per repaint |
| `CE-034` | ✅ | Set equality — and the sets agree **by construction**, so the closure is derived from each shell's source and the **running** `ssh` shell is driven to resolve every command |
| `CE-036` | ⚠️ **PARTIAL** | Not met and not failed: the criterion asks for four group headings in the `/` box; the product paints a flat ranked list by **`D-0437`**, a direct Owner instruction (*«una lista piatta, stile come ha code claude»*). The supersession is **measured** — one test asserts no heading is painted, another that the groups survive where `D-0437` kept them, in `/help` |

**Two oracles seen to fire:** a browser-only `terminal.write()` turns `CE-033` red; dropping one
entry from the `ssh` shell's offered set turns `CE-034` red.

### Two defects found in this phase's OWN instrument, repaired at the rule

1. **The verdict classifier read a glyph from prose.** It tested for `✅` anywhere in a cell, so
   `CE-036`'s honest sentence *«non è un ✅ pieno»* classified the row as **MET** — the tool that
   exists so nobody rounds a verdict up rounded one up itself, in the dangerous direction. A cell
   now states its verdict by **what it leads with**.
2. **The drift check was blind to the verdict text.** It compared four fields and the verdict
   *enum*, never the prose — where all the evidence lives. Measured: `CE-002`'s text was **2,314**
   characters in the projection and **1,540** in the document that owns it, a paragraph `D-0577`
   appended to the projection alone, and the check **passed**. Repaired at its source (the
   paragraph now lives in the document) and at the rule.

Both oracles seen to fire; 5 regression tests added.

### Verification — all produced this session

```text
ce-021 4/4 · ce-033 7/7 · ce-034 4/4 · ce-036 7/7 · acceptance-matrix 13/13
npm test                     2881 tests / 2880 pass / 0 fail / 1 pre-existing skip
tools/run-eslint.sh          451 files / 0 errors / 0 warnings
scripts/test.sh              15/15 steps, 0 unavailable
tools/seeded-defect-proof    19/19 caught
ratchet                      seen to FAIL at 16, one notch tighter, before being set to 17
live                         /livez /readyz /healthz = 200 on :8100 and :8443, tree 454/454
```

## WHAT WAS **NOT** DONE

- **13 of the 17 remaining rows were not attempted**, and the split above says why.
- **`CE-036` is not a ✅**, and the criterion row is **older than the Owner decision governing
  it**. Amending it is the Owner's call, not the measurer's — `D-0582` proposes the mechanism.
- **Four proposals are open and none is executed:** `D-0578`, `D-0580`, `D-0582`, `D-0576`.
- **The browser suite and the accessibility audit were not run**, declared not omitted: this
  phase changed four test files and two tools — no product surface, no markup, no DOM, no CSS
  token. The two tools it changed do not ship in the image at all.
- **`F-MANIFEST-001`** (recorded `D-0577`) is still open: `MANIFEST.sha256` lists 5,898 paths
  against 6,685 tracked files and does not grow.

## OPEN BLOCKERS

`B-002` (stale premise: gitleaks/trufflehog — **re-measured this session, both absent from
`PATH`**, so the secret scan was heuristic and is declared as such) and `B-011` (low, deferred:
history rewritten on the Owner's explicit authorisation, 2026-07-30). Neither blocks work.
