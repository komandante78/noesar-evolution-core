# SESSION HANDOFF

**The Owner set the priority on 2026-08-30:** *«prima voglio finire il progetto da dare al bando
per finanziamento»*. Everything else — including the ATOM/GPU design work of that morning — is
**parked by his decision**, and is not resumed until he says so.

**The deadline is not the one written all over these documents.** NLnet's calls reopen
**2026-09-03**, but an application is submitted up to **2026-11-03**. The `2026-09-04` in
`docs/PLAN_11_DAYS_TO_DELIVERY.md` was the target he set himself, not a hard date. The risk is
not the calendar; it is handing in a half-written dossier.

His page-by-page list is still the backlog: `docs/OWNER_REVIEW_2026-08-21.md` §4 — **read it
before deciding what to build**, and a row he reopens is open whatever a `D-0xxx` says.

## ➜ LA PROSSIMA AZIONE

**`P9` — the dossier in `FUNDING/` is the deliverable the funder actually reads, and it is the
least advanced thing in the repository.** It was written on 2026-08-14. Since that day the
product has moved **446 commits, 406 files, +62161/-13437**, and the dossier still claims
"2547 tests" in five separate files. Today's real number is **3151**.

**One decision is the Owner's and only his**, and it gates three of the nineteen files
(`04_FOSS_SCOPE`, the shape of `08_MILESTONES`, all of `10_BUDGET_STRUCTURE`):
`docs/FUNDING_ALIGNMENT.md` §"Known open question" — public programmes commonly require the
funded work to be open source **in its entirety**, and an open-core model with a permanently
reserved ATOM may not qualify as-is. Nothing here assumes an outcome. The other sixteen files
do not depend on the answer and are being brought level now.

## WHAT WAS MEASURED THIS SESSION (2026-08-30)

Everything below is a measurement taken today, not a claim carried forward.
Logs: `EVIDENCE/BATTERY_20260830/`.

| | measured |
|---|---|
| `HEAD` | `0556cdb4`, tree clean, `origin/main` = `HEAD`, **0 commits ahead** |
| Unit | **3151 tests, 344 suites — 3150 pass, 0 fail, 1 skip**, 19.5 s |
| `scripts/test.sh` | **pass=22 fail=0 partial=0 unavailable=0** |
| ESLint 9.39.5 | **492 files, 0 errors, 0 warnings, 0 no-undef** |
| Container | `noesar-evolution` up 22 h, healthy |
| Model | 27B `Qwen3.8-27B-UD-Q4_K_M`, `-ngl 46 -c 16384 -fa on --jinja --reasoning off` |

## THE TWO BLOCKERS ARE CLOSED — BOTH BY MEASUREMENT

- **`B-015` — CLOSED.** The 19 commits were pushed on 2026-08-30. `origin/main` = `HEAD` =
  `0556cdb4`, `git rev-list --count origin/main..HEAD` = 0. The entry sat marked *recurring*
  for six days after its cause was gone: a blocker is closed by a measurement, never by the
  absence of a new failure.

- **`B-016` — CLOSED, premise disproven.** It claimed the configured model could not emit tool
  calls and that the container serving it belonged to another project and was out of bounds.
  Neither is true now: the provider is the **local 27B the product launches itself**, and
  `--jinja` is in the persisted `launchCommand` in `config/local-model.json`, so it survives a
  restart. Three measurements, weakest first:

  1. a raw request carrying a `tools` array returns `finish_reason: "tool_calls"`;
  2. the **exact stimulus `probeToolCalling()` sends** returns
     `tool_calls[0] = noesar_probe_echo({"word":"ok"})` — `supported:true` where the same probe
     once returned `false`;
  3. **`tools/acceptance/live-model-tool-loop.mjs` — NEW — passes 6/6 in 14.1 s.** It drives the
     **real `ChatOrchestrator`**, the real scope gate and the real SSE contract against that
     model: the model asks for the tool, the tool runs, `tool-call` is streamed before
     `tool-result`, the final answer carries the tool's own number, and the call is in the ledger.

  **That third run is the `P2` acceptance** — *"a chat turn that needs a tool calls it, shows the
  call, and answers from the result — measured, not asserted"* — **met live**. The handoff of
  2026-08-25 said the model was "the missing half" and that everything below it was proven only
  by suite. The half is no longer missing, and the evidence is a script that can be re-run:

  ```
  docker exec -e NOESAR_SRC=file:///opt/noesar/services/reference-control-plane/src/     noesar-evolution node /tmp/live-model-tool-loop.mjs
  ```

  (the container rootfs is read-only, so the file is piped to `/tmp` with
  `docker exec -i noesar-evolution sh -c 'cat > /tmp/live-model-tool-loop.mjs'`.)

## WHAT IS STALE IN THE OLDER DOCUMENTS — do not rebuild from them

- **The voice is gone from the product** (removed 2026-08-25). `OWNER_REVIEW` §4 rows **4 and 5**
  and plan phases **P5/P6** are **decayed**. Do not reconstruct them.
- `docs/COSA_MANCA.md` (2026-08-09) and `docs/GAP_REGISTER.md` (2026-08-19) are older than this
  file and older than the work they describe.
- `FUNDING/16_EVIDENCE_INDEX.md` still indexes `RELEASE/MASTER_V4_*` — the "Master V4" baseline
  **retired on 2026-07-26** (`D-0096`). It points at evidence for a project of record that no
  longer exists.

## OPEN — in the order it matters for the application

1. **`P9`** — the dossier. Sixteen files are mine to bring level; three wait on the Owner's
   open-core decision.
2. **`P8`** — the battery above is three quarters of it; the browser e2e run and a live deploy
   with evidence on the running installation are what remain.
3. **`P7` — closed on inspection, and the phase was really a register problem.** `F-ROT-001` was
   already closed on 2026-08-25 (`docs/LINEA_DI_STATO.md` §6: not a stale allowed-host but the
   lost static address, which `redeploy.sh` now carries forward). `F4-012` was fixed the same day
   in `0da3ca9` — *the guard was right, the message was wrong* — and yet still sat in
   `docs/OPEN_FINDINGS.tsv` as `OPEN - recorded, no action` **five days later**; that row is
   corrected today. `F-MODEL-001` is reclassified in `LINEA_DI_STATO` as **new functionality, not
   a repair** — an Owner decision — and `F-RUST-002` is the architecture question the plan always
   said it was. **Nothing in P7 is engineering work waiting to be done.**
4. **`OWNER_REVIEW` §4 still open**: 1 and 2 (Models page — partly covered by «Browse»), 6 and 7
   (Knowledge and Memory — **waiting on the Owner's intent**, not technical work), 8 (configurable
   research providers), 9 (agent creation from natural language), 10 (multimodal).
5. **UI defects** in `DIFETTI_UI_DA_RIPARARE.md`: the «Inizializzazione sicura» title on the login
   screen, the Home page in English while the language is Italian (`home-overview.mjs` builds its
   strings without `t()`), and the Normale/Bypass selector sitting outside the panel that gives
   it meaning.
6. **The model install bar** — `fetchArtefact` demands a sha256 a HuggingFace link does not carry.
   Three options are written down; **this one is done with the Owner present.**

## THE METHOD, UNCHANGED

1. **His list is the backlog.** Do not ask him to re-dictate what is already written down.
2. **A row he reopens is open**, whatever a `D-0xxx` says.
3. **Do not end a turn with a question when the work was already authorised.** Deliver, then ask
   only what genuinely needs him — a decision, a credential, a product direction.
4. **A UI surface is seen rendered before it is called done.**
5. **A ratchet that rose is diffed, not re-baselined.**
6. **Re-measure before you summarise.** Both blockers closed today had been dead for days; the
   documents did not know. That is the recurring defect of this project, and it is why
   `PROJECT_STATE.json` now carries a `last_battery` block with the date on it.
