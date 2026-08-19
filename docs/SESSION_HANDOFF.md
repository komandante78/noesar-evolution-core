# SESSION HANDOFF

**Last updated:** 2026-08-19 · **Phase:** `s347` — `D-0556`/`D-0557` (after `s346`, `D-0554`) · **COMMITTED, NOT DEPLOYED**
**Plan of record:** `MASTER_PROJECT/` · **Live:** `noesar-evolution:d0544-health-lane-20260818T160214Z` (untouched)

---

## ➜ LA PROSSIMA AZIONE

**Owner instruction, 2026-08-19:** *finish the project; proposals are saved, not executed; do not
ask which improvement to build.* So the next phase is **not** a question — it is `G-02`.

1. **`G-02` — prove `oci/Dockerfile` reproduces the running image.** 86 overlay Dockerfiles were
   never folded back, and until this is measured the five delivery ZIPs have no honest provenance.
   It needs a build, which no phase has run.
2. **Then the 15 CRITICAL criteria with no recorded verdict** (below) — that is now the project's
   headline gap, and it is a countable one.

Read [`docs/GAP_REGISTER.md`](GAP_REGISTER.md) for the whole picture; `node
tools/verify-acceptance-matrix.mjs` prints the criteria gap in one line.

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**The acceptance matrices exist, and this phase corrected its own `G-01` row from the day before.**
`docs/WORK_PLAN_V5_REWRITE.md` §5 risk 4 and the first version of `G-01` both said the rewrite has
*"zero matrici con ID e severità"*. **Both were false**:

| Document | Criteria |
|---|---|
| `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` | 24 (`CE-001…024`) |
| `MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` | 12 (`CE-025…036`) |
| `MASTER_PROJECT/14_MEMORIA_A_CUBI.md` | 9 (`CUBE-001…009`) |
| `MASTER_PROJECT/03_ARCHITETTURA.md` | 8 (`ARCH-001…008`) |

Each row already carries an id, a severity (`C`/`A`/`M`) and a stated method of verification, and
the matrix's own header says *"ogni riga è verificabile eseguendo, non leggendo"*. **What was
missing is that nothing read them** — one test file in the whole repository mentioned one id.

**The gap is now a number, and it is the important one:**

```text
53 criteria · 17 with a recorded verdict (15 met, ARCH-005 partial, ARCH-008 other)
36 with NO verdict at all — 15 of them CRITICAL:
   CE-001 CE-002 CE-003 CE-004 CE-007 CE-008 CE-013 CE-014 CE-015 CE-017 CE-018
   CE-022 CE-025 CE-026 CE-029
```

`CE-001` is *"nessun percorso muta il workspace senza spendere un token coniato da un Piano
autorizzato"* — the central security claim of the product, and nothing anywhere states a verdict
on it.

**The instrument, and the one thing it refuses to do.** `tools/acceptance-matrix.mjs` projects the
four tables into `docs/acceptance-matrix.json`; `tools/verify-acceptance-matrix.mjs` is battery
step `matrix` and fails on three things: drift between the documents and the projection, a
criterion stating no method of verification, and the unstated-verdict count **getting worse** — a
ratchet that may only go down. **It never decides that a criterion passes.** Status is read from
the document that owns it, never inferred: a tool that graded the matrix would be grading its own
author's prose, and the first false PASS would be structural rather than accidental.

**Verification, this session:**

```text
node tools/verify-acceptance-matrix.mjs      53 criteria, ACCEPTANCE_MATRIX: PASS
ORACLE: a tampered committed matrix          refused, exit 1; regenerating restores PASS
node --test .../acceptance-matrix.test.mjs   7/7
scripts/test.sh                              15/15 steps PASS, exit 0 (matrix is new)
unit suite                                   2646 pass / 0 fail
tools/run-eslint.sh                          430 files, 0 errors
```

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

**No criterion is bound to an executable check — 0 of 53.** The 17 recorded verdicts are prose
written by their author. That is better than nothing and weaker than a result: `D-0554` found four
such prose records false in a single session. Binding all 53 in one pass would be exactly the
false-confidence artefact this instrument exists to prevent, so it is `D-0557`, **saved** under the
Owner's instruction and executed after delivery.

**The battery does not fail on the 36 unstated verdicts**, by design: a permanently red check is
one people learn to ignore. It fails when the number gets worse.

**`MASTER_PROJECT/` was not modified.** The tool reads; the documents stay as they are, provenance
intact.

**`[UNVERIFIED]`:** that the 15 met verdicts are true. This phase measured that they are
*recorded*, not that they hold — the distinction is written into the field name (`RECORDED_MET`)
so no reader can collapse the two.

---

## FILES THIS PHASE CHANGED

```text
NEW  tools/acceptance-matrix.mjs                    the parser and projection
NEW  tools/verify-acceptance-matrix.mjs             drift + shape + ratchet
NEW  docs/acceptance-matrix.json                    53 rows, generated, never hand-edited
NEW  services/.../test/acceptance-matrix.test.mjs   7 tests on the risky part, the parser
MOD  scripts/test.sh                                step `matrix`
MOD  docs/GAP_REGISTER.md                           G-01 corrected — it was wrong
MOD  docs/WORK_PLAN_V5_REWRITE.md                   §5 risk 4 corrected, original text kept
MOD  docs/DECISION_LOG.md · PROJECT_STATE.json      D-0556, D-0557
```

---

## SESSION CLOSE — `CLAUDE10.md` §5a, run in full

**Nothing was removed, because nothing was created.** Containers, images and networks created
across `s343`–`s347`: **zero** — the Python conformance probe ran `--rm --network none`, and no
phase built an image. Evidence: `EVIDENCE/session_close_20260819T054047Z.txt`, with the full
pre-cleanup inventory in the gitignored `EVIDENCE/docker_inventory_pre_cleanup_20260819T053927Z.txt`.

```text
containers   noesar-evolution (Up, healthy) + one rollback — exactly the two §21b allows
             50 non-project containers, untouched
image tags   28, all deployment lineage with a documented rollback -> KEPT (§21c)
             throwaway-shaped tags (e2e/probe/tmp/scratch): 0
networks     noesar-e2e-net, noesar-evolution-net — the stable unstamped ones; no per-run bridge
             noesar-local belongs to another project and was never touched
volumes      65, unchanged
§21f         state=running health=healthy restarts=0 · /livez 200 · /readyz 200 · /metrics 401
```

**Two corrections made during the close, both mine:** the first health probe used `127.0.0.1` and
reported `000` — the port is published on `192.168.178.100:8100 → 8088`, not on loopback, so that
was my address error and not a product fault. And a `grep` written to find throwaway tags lost its
`^noesar-evolution` anchor across the alternation and listed **other projects' images**; it was a
listing, not a removal, but the same expression inside a removal path would have been a host-wide
accident. Recorded as `D-0558`.

---

## THE IMPROVEMENT PROPOSAL — `D-0557`, **saved, not offered**

Per the Owner's instruction of 2026-08-19, proposals are recorded and executed **after** the
project is finished. `D-0557`: bind each criterion to the check that measures it, so the matrix
reports `MEASURED_PASS` from a run instead of `RECORDED_MET` from prose. **Funding fit — Restack ·
traits 5 and 6:** traceability from requirement to executed test is the assurance artefact, not the
matrix alone.

---

## OPEN BLOCKERS

`B-002` and `B-011`, both unchanged. No new blocker. `production_ready: false` stands, correctly.
