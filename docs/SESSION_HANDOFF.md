# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-29 (`D-0230`). Stato completo in `PROJECT_STATE.json`, storia in
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

**`D-0230`, stessa giornata di `D-0229`: il resto del workbench, su istruzione esplicita
dell'Owner — «lo voglio finito», non fermarsi dopo un solo pannello e riportare.**
Cablati **Map** (`/api/v1/repo-map/scan`+`/search`, già costruiti da tempo, mai consumati
da nessuna pagina — languages/manifests/entry point/symbol index/dependency map + ricerca
letterale), **Problems/Editor/Preview** (nessuna nuova route: dati già arrivati da
plan()/approve(), il pannello semplicemente non li mostrava mai), **Logs** (nuova
`GET /api/v1/events/:correlationId`, stessa fiducia di `GET /api/v1/workspace-actions/:id`
— basta una sessione, un id ignoto torna trail vuoto non 404).

**Bug reale trovato COSTRUENDO, non leggendo**: `executor.mjs` restituisce
`performed`/`refused` come **conteggi numerici**, non array. Il codice iniziale faceva
`result?.refused??[]` e poi `for...of` su quel valore — ma `0` è un valore *definito*,
quindi `??` non lo tocca, e `for...of 0` lancia "0 is not iterable" al primo run **pulito**
(zero rifiuti). Il browser E2E lo ha fatto fallire (2/325 FAIL) prima della riparazione,
poi 325/325 dopo. Riparato leggendo `result.outcomes.filter(o=>!o.performed)` per i passi
rifiutati e i due conteggi direttamente (non più `.length` su un numero).

**Deliberatamente NON costruito, confini non lacune** (spiegato all'Owner nella stessa
sessione, non un rifiuto silenzioso):
- **Esecuzione test dichiarati dal piano** — `execute()` riceve sempre `tests:[]` su
  questo percorso; riaprirlo sarebbe esecuzione di codice arbitrario travestita da
  funzionalità. `workspace-actions.mjs` rifiuta EXECUTE/DELETE "permanently and on purpose".
- **Terminal / CodeN Evolution TUI** — serve un vero protocollo di sessione su unix
  socket e una shell reale attaccata: un sottosistema a sé, non un pannello da cablare.
- **La decisione modello-vero-nel-ciclo** — resta quella dell'Owner da `D-0228`, non
  toccata qui.

## ➜ Stato dell'installazione

- **Prodotto**: `noesar-evolution:phase4-workspace-actions-panels` · `Up (healthy)` ·
  `RestartCount=0` · `192.168.178.100:8100→8088` · stessa configurazione del predecessore,
  riletta dal container sostituito. Rollback preservato:
  `noesar-evolution.rollback-workspace-actions-panels-20260729T141027Z`
  (`:phase4-workspace-actions-ui`).
- **atomd**: invariato, `atom-evolution:atomd` · `Up (healthy)` · `noesar-evolution-net`.
- **Due container per progetto** (installazione + 1 rollback, il più recente). Reti (10)
  e volumi (28) invariati prima/dopo entrambe le installazioni di oggi.
- **Costo di rollback: nessuno.** Nessuna migrazione, `AI_STATE_VERSION` invariato.
  ⚠ Tornare a `:phase4-workspace-actions-ui` toglie solo Map/Problems/Editor/Preview/Logs
  e la route eventi; Plan/Shadow/Diff (`D-0229`) restano invariati.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Nessuna superficie WebUI consuma ancora `/api/v1/research/gate`** — invariato da `D-0222`.
- **`ATOM_PROVIDER_MODEL_BACKED` in `lib.rs` resta `false`** — invariato da `D-0226`.
- **Tests/Terminal/CodeN Evolution TUI restano non costruiti** — confini dichiarati sopra,
  non lacune di questa fase.
- **Il fallimento residuo su `selfharm-method`** (`ASK` invece di `REFUSE`) non toccato.

## ➜ Blocker aperti

`B-002` (low, nessun `gitleaks`/`trufflehog` installabile — regola 45; scan manuale a
pattern, 0 reperti su entrambe le fasi di oggi). Nessun altro.

## ➜ Verificato in questa fase (secondo giro, D-0230)

Unit 1119/1119 (+1, il nuovo test HTTP sugli eventi), ESLint 226 file 0 errori,
`scripts/test.sh` 10/10, `auth-http-smoke`+`http-smoke` PASS (nuova route), browser E2E
**325/325** (6 nuovi check: scan+ricerca Map, Problems/Editor/Preview/Logs sul run reale
— inclusa la riparazione performed/refused vista fallire e poi passare), accessibilità
27/27, seeded-defect-proof 19/19, MANIFEST 5831/5831. Sequenza `§3a` completa per entrambe
le installazioni della giornata (`D-0229` e `D-0230`).

## ➜ Le domande all'Owner ancora senza risposta

- **Il percorso host per l'ombra condivisa** con `atomd` — invariato da `D-0216`.
- **Modello vero nel ciclo di ragionamento vs. banco su scritture reali** — invariato da
  `D-0228`, non deciso in nessuna delle due fasi di oggi.
