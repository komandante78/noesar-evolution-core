# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-29 (`D-0229`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ DUE REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
   Prima di dichiarare un gap non risolvibile o iniziare a costruire:
   `find docs/ MASTER_PROJECT/ -newer <ultimo documento letto>`.
2. **`ATOM_EVOLUTION` (`/mnt/cachec/ATOM_EVOLUTION`) non copia MAI nulla dal vecchio** —
   né da `NOESAR-ATOM-PRIVATE`, né dal progetto ATOM originale. Vedi `D-0212` e
   `.claude/skills/noesar-evolution/SKILL.md`.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Impone tre skill sempre attive (`D-0172`).
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. `find docs/ MASTER_PROJECT/ -newer docs/SESSION_HANDOFF.md` — regola 1 sopra.
4. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**`D-0229`: il workbench CodeN Evolution parla ora col proprio motore.** s284 (DEBUG
EVOLUTION, log CLAUDE.md dell'host — un progetto diverso usato per scansionare questo)
aveva verificato che "CodeN Evolution" non era costruito lato prodotto: il `ReasoningProvider`
era deterministico e funzionante, ma **nessuna pagina lo consumava**. Verifica diretta sul
workbench (`apps/webui-static/index.html#view-coden`) ha trovato la causa esatta — i pannelli
Plan/Shadow run/Diff dichiaravano ancora *"no plan object exists yet"* / *"this layer has no
execution surface"* / *"no change to compare"*, mentre il backend (`workspace-actions.mjs`)
esegue piani reali dentro un'ombra copy-on-write e promuove su successo da `D-0190`/`D-0191`
(`executesPlans=true`, `executorWiredToProductActions=true`) — mesi prima, mai collegato.

**Cablato**: il pannello Plan è ora un form (obiettivo + righe percorso/contenuto ripetibili)
che chiama `POST /api/v1/workspace-actions/plan`; i pulsanti Simulate/Approve/Reject/Restore
chiamano gli endpoint già esposti; Shadow run e Diff mostrano l'esito reale (rischio,
confidenza, provenienza, diff prima/dopo) invece del testo statico. Un run promosso o
rifiutato entra anche in `state.workspaceActionRuns`, cosicché il menu a tendina di Closure
— che già unisce agent run e workflow run allo stesso modo — possa nominarlo. **Nessuna route
server nuova, nessun file di `services/reference-control-plane/src/` toccato.**

**Deliberatamente fuori scope**: Tests/Editor/Map/Logs restano `declared-empty` — `execute()`
riceve sempre `tests:[]` su questo percorso, quindi il pannello Tests non ha davvero nulla da
mostrare; è un'affermazione onesta, non un gap di questa fase.

**Stato dei benchmark, invariato da `D-0228`** — quattro misure su dodici superfici (decompose
51/51 vs 0/51, gate `UI-090` 20/21, fedeltà replay 8/8, accuratezza `simulate` 6/7). Nessun
benchmark contro un sistema terzo esiste ancora.

**Decisione ancora rimandata all'Owner, invariata da `D-0228`** — "un modello vero nel
circuito del ragionamento" (quale delle 10 superfici deterministiche sostituire con una
chiamata LLM, decisione di design) contro "un banco `simulate`/`decompose` su cambiamenti
reali e complessi" (più piccolo, nessun modello nuovo). **Se nessuna delle due viene scelta**:
`ARCH-001` — il supervisore PID 1 a tre figli, tuttora zero file, il criterio critico più
grosso rimasto — oppure estendere il banco basato sulla realtà (`D-0227`/`D-0228`) ad altre
superfici.

## ➜ Stato dell'installazione

- **Prodotto**: `noesar-evolution:phase4-workspace-actions-ui` · `Up (healthy)` ·
  `RestartCount=0` · `192.168.178.100:8100→8088` · stessa configurazione (env/mount/rete/
  porta) del predecessore, riletta dal container sostituito, non da memoria.
  Rollback preservato: `noesar-evolution.rollback-workspace-actions-ui-20260729T134008Z`
  (`:phase4-atom-all-surfaces`).
- **atomd**: invariato, `atom-evolution:atomd` · `Up (healthy)` · `noesar-evolution-net`.
- **Due container per progetto** (installazione + 1 rollback, il più recente — il
  precedente `rollback-all-surfaces-20260729T072501Z` rimosso per §5a, immagine intatta
  su disco). Reti (10) e volumi (28) invariati prima/dopo la rimozione.
- **Costo di rollback: nessuno.** Nessuna migrazione, `AI_STATE_VERSION` invariato, nessuna
  route rimossa. ⚠ Tornare a `:phase4-atom-all-surfaces` reintroduce solo la dicitura stale
  sulle tre superfici — il backend continua a eseguire piani esattamente come prima in
  entrambi i casi.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Nessuna superficie WebUI consuma ancora `/api/v1/research/gate`** — invariato da `D-0222`.
- **`ATOM_PROVIDER_MODEL_BACKED` in `lib.rs` resta `false`** — invariato da `D-0226`.
- **I pannelli Tests/Editor/Map/Logs del workbench restano `declared-empty`** — non toccati
  in questa fase, per la ragione dichiarata sopra.
- **Il fallimento residuo su `selfharm-method`** (`ASK` invece di `REFUSE`) non è stato
  toccato — invariato da `D-0222`.

## ➜ Blocker aperti

`B-002` (low, nessun `gitleaks`/`trufflehog` installabile — regola 45; scan manuale a
pattern, 0 reperti su questa fase). Nessun altro.

## ➜ Verificato in questa fase

Unit 1118/1118 (invariato, nessun file server toccato), ESLint 226 file 0 errori,
`scripts/test.sh` 10/10, browser E2E 319/319 (4 nuovi check: un ciclo reale plan→simulate→
approve→diff→restore guidato attraverso la UI, non solo la forma del DOM), accessibilità
27/27, seeded-defect-proof 19/19, MANIFEST 5830/5830. Sequenza `§3a` completa: build offline
→ byte immagine provati identici all'albero → stop pulito (`postgres.stopped clean:true`
letto nel log) → backup runtime a servizio fermo → predecessore preservato → avviato con
configurazione riletta → verificato dal vivo (`/livez`/`/readyz` 200, markup con i nuovi id
`planGoal`/`planForm`/`shadowRunContent`/`diffContent` confermato via `curl`).

## ➜ Le domande all'Owner ancora senza risposta

- **Il percorso host per l'ombra condivisa** con `atomd` — invariato da `D-0216`.
- Le altre domande storiche (repo remoto `B-001` risposto/chiuso s277-278; le restanti
  vivono nel corpo di `D-0223`/`D-0228` più sopra nel tempo, non ripetute qui).
