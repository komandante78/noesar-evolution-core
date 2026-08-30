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

## ➜ LA PROSSIMA AZIONE — deciso dall'Owner il 2026-08-30 sera

**L'approvazione a metà turno, e poi gli strumenti di scrittura.** L'Owner, verbatim:
*«allora va finito»*, di CodeN Evolution che *lavora su sandbox e fa il lavoro*. La sandbox
c'è: `CE-008` (l'ombra precede l'autorizzazione), `CE-017` (checkpoint prima di ogni passo
mutativo, ripristino byte-identico), `CE-016` (zero strumenti a riposo), `ARCH-008` (la scala
adattiva spende token `EXECUTE` su entrambi i lati). **Ciò che manca è il permesso al modello
di spenderla**, e sta scritto in due punti:

1. **`builtin-tools.mjs:280` — `SEEDED_EFFECTS = ['read']`.** I 20 metodi di lettura sono
   strumenti; gli **8 `write` e 2 `destroy` sono classificati e con schema, non registrati**.
   `D-0687` lo dice: accenderli è una parola, ma *«ciò che manca davvero prima è
   un'approvazione a metà turno che dà la persona»* — `mutative` compare **zero volte** in
   `chat-orchestrator.mjs`, mentre `agent-service.mjs:66` lo fa già rispettare.
2. **`agent-service.mjs:68` e `workflow-service.mjs:617` chiamano `execute()` senza `can`**,
   quindi `tool-executor.mjs:65` rifiuta 403 e un'esecuzione in background non ha **nessuno**
   strumento. `chat-orchestrator.mjs:159` e `research.mjs:631` lo passano — ed è per questo
   che la chat funziona e il background no. Una riga per punto di chiamata, **dopo** la
   decisione su *con quale autorità agisce un'esecuzione in background*.

**L'ordine è questo, e non è arbitrario:** prima l'approvazione a metà turno, poi
`SEEDED_EFFECTS` prende `write`. Accendere la scrittura senza il gesto di conferma è togliere
il freno prima di aver messo il pedale. È anche la riga 9 del §4 di
`docs/OWNER_REVIEW_2026-08-21.md`, con le sue parole: *«se scrivo di creare un agente, deve
crearlo — non voglio storie»*.

## `P9` È CHIUSO — il dossier è consegnabile

Il dossier `FUNDING/` è stato portato a livello il 2026-08-30 e la domanda è definita:
`FUNDING/00_SUBMISSION_SET.md`, venti file più `PROMPT_LOG.md` come allegato, `19` fuori
perché è un piano interno. `D-0697`-`D-0701`. **La decisione che bloccava tre file da luglio
è presa** (`D-0697`): la FAQ ufficiale di Restack risponde alla domanda sull'open core — il
vincolo è di **dipendenza**, e `FOSS_CORE_DEPENDS_ON_ATOM=false` è una run di accettazione,
non una promessa. `docs/FUNDING_ALIGNMENT.md` §"Known open question" è **superato**: non
riaprirlo.

Restano tre obbligazioni, tutte in `FUNDING/20_GENAI_DISCLOSURE.md` §"Before this is
submitted": rigenerare il prompt log **su tre transcript** (il terzo è la sessione
`1fc5f34f`, che ha scritto 264 righe), leggerlo, e mandare la domanda già scritta in
`FUNDING/21_QUESTION_FOR_NLNET.md`. **Il 3 settembre** si rileggono le regole: le call aprono
quel giorno e la guida del 30/08 era ancora *preliminary*.

## MISURATO LA SERA DEL 2026-08-30 — le sonde guidate, rieseguite

Non la suite: le **sonde**, quelle che guidano il prodotto vero invece di asserirlo.

| sonda | esito |
|---|---|
| `live-model-tool-loop.mjs`, **dentro il container che gira**, contro il 27B vero | **6/6 in 11 s** |
| `ce-020-tui-fullscreen.mjs` — TUI a tasti veri | **18/18**, `CE020_FAIL=0` |
| `ce-037-one-word.mjs` — `ssh` e una parola sola | **15/15** |
| `ce-021-two-shells.mjs` — le due shell | **4 FAIL**, e la sonda è ferma al 5 agosto |
| `acceptance-matrix.mjs` | 73 righe, 72 con verdetto, **64 soddisfatte**, 1 senza verdetto |

**Il fallimento di `ce-021` non è il prodotto.** La sonda chiama `workspace.approve` subito
dopo `workspace.plan`; dal 2026-08-19 (`D-0569`, `9ef29bb7`, `CE-008`) il motore pretende
`measure()` in mezzo. Il criterio è soddisfatto da
`test/ce-021-one-live-session-across-both-shells.test.mjs`, che fa la sequenza giusta
attraverso le due shell e passa dentro la suite verde. Registrato come **`F-CE021-001`** in
`docs/OPEN_FINDINGS.tsv` e **non riparato**: cosa farne è una decisione dell'Owner.
**`F-CE035-001`** è la stessa muffa nel registro invece che in una sonda — `CE-035` è l'unica
riga di 73 senza alcun verdetto, mentre `ce-037` prova il suo gesto 15/15.

**La lezione, di nuovo:** nessun gate esegue le sonde guidate, ed è così che questa è marcita
undici giorni senza che niente diventasse rosso.

## WHAT WAS MEASURED THIS SESSION (2026-08-30)

Everything below is a measurement taken today, not a claim carried forward.
Logs: `EVIDENCE/BATTERY_20260830/`.

| | measured |
|---|---|
| `HEAD` | **`b1e05b15`** — `6899a9e8` pushato, **1 commit locale avanti** |
| Unit | **3152 tests, 344 suites — 3151 pass, 0 fail, 1 skip** (gate pre-commit, quattro volte) |
| `scripts/test.sh` | **pass=22 fail=0 partial=0 unavailable=0** |
| ESLint 9.39.5 | **494 files, 0 errors, 0 warnings, 0 no-undef** (sera) |
| Container | `noesar-evolution:placement-3` up 29 h, healthy — **l'immagine è del 29/08**, nessun deploy fatto dopo |
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

1. **L'approvazione a metà turno, poi gli strumenti di scrittura** — la prossima azione qui
   sopra, decisa dall'Owner il 30/08 sera. `OWNER_REVIEW` §4 riga 9 è la stessa cosa detta con
   le sue parole.
2. **`F-CE021-001` e `F-CE035-001`** — la sonda `ce-021` da riportare al flusso in tre passi, e
   il verdetto di `CE-035` da scrivere con l'evidenza che esiste già. Registrati, non riparati.
3. **`P9` — CHIUSO.** Il dossier è consegnabile; restano le tre obbligazioni prima della
   consegna (log su tre transcript, leggerlo, mandare `FUNDING/21`) e la rilettura delle regole
   il **3 settembre**.
4. **`P8`** — la batteria è tre quarti; restano la corsa browser e2e e un deploy vero con
   evidenza sull'installazione che gira. **Attenzione: un deploy spegne il 27B.**
5. **`P7` — closed on inspection, and the phase was really a register problem.** `F-ROT-001` was
   already closed on 2026-08-25 (`docs/LINEA_DI_STATO.md` §6: not a stale allowed-host but the
   lost static address, which `redeploy.sh` now carries forward). `F4-012` was fixed the same day
   in `0da3ca9` — *the guard was right, the message was wrong* — and yet still sat in
   `docs/OPEN_FINDINGS.tsv` as `OPEN - recorded, no action` **five days later**; that row is
   corrected today. `F-MODEL-001` is reclassified in `LINEA_DI_STATO` as **new functionality, not
   a repair** — an Owner decision — and `F-RUST-002` is the architecture question the plan always
   said it was. **Nothing in P7 is engineering work waiting to be done.**
6. **`OWNER_REVIEW` §4 still open**: 1 and 2 (Models page — partly covered by «Browse»), 6 and 7
   (Knowledge and Memory — **waiting on the Owner's intent**, not technical work), 8 (configurable
   research providers), 9 (agent creation from natural language), 10 (multimodal).
7. **UI defects** in `DIFETTI_UI_DA_RIPARARE.md`: the «Inizializzazione sicura» title on the login
   screen, the Home page in English while the language is Italian (`home-overview.mjs` builds its
   strings without `t()`), and the Normale/Bypass selector sitting outside the panel that gives
   it meaning.
8. **The model install bar** — `fetchArtefact` demands a sha256 a HuggingFace link does not carry.
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
