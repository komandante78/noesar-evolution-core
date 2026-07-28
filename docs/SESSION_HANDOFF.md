# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-28. Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai CodeN Ultra, NOESAR V3,
ATOM o altro dell'host. L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Da `D-0172` impone tre skill sempre attive.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**`D-0190`/`D-0191` costruiti e installati: la prima superficie del prodotto che spende un
capability token e cambia un file vero.** `workspace-actions.mjs` — `plan()` → `approve()` →
promozione nel workspace reale, solo se pulita. Percorso banale (P6): un passo, solo WRITE.

**La fase 1 è MOLTO più vicina al proprio criterio, ma non ancora completa.** Rileggendo
09_PIANO.md §3 clausola per clausola, ora vero: apre un repository vero e ne capisce la
struttura (repo-map), riceve una richiesta, produce un piano, ottiene un'autorizzazione,
cambia diversi file, mostra il diff, produce un risultato verificabile (`execute().ok`),
ripristina lo stato precedente su richiesta, registra ogni operazione (7 eventi incatenati
per run). **Ancora falso, e nominato, non taciuto**: **«esegue i test, corregge un errore»**
— `executor.mjs` rifiuta EXECUTE in modo **permanente e deliberato**, spedito e testato al
passo 5; riaprirlo per eseguire un comando dichiarato dal piano sarebbe esecuzione di codice
arbitrario travestita da wiring, non il lavoro di questa fase. `workspaceActionsStatus()` lo
dichiara. **E la clausola sull'autorità** — «provato da una suite il cui unico lavoro è
provare a farglielo fare» — ha ora **6 test avversariali dedicati** (percorso vuoto, fuga di
percorso, doppia decisione, approvazione senza approvante, cross-contaminazione, no-op non
promosso), ma non ha ancora il rigore esaustivo della suite `coden-invariant-adversarial`
(11/11) che governa il vecchio livello `path-auth`.

**Trovato costruendo, corretto prima del commit**: `capability.mjs`/`shadow.mjs`
dichiaravano ancora `executorWiredToProductActions:false`/`executesPlans:false` — vere fino a
questa fase, **false da quando `workspace-actions.mjs` esiste**. Corrette a `true`, 3 test +
`auth-http-smoke.mjs` aggiornati, immagine ricostruita e rischierata (vedi ledger, due voci
consecutive stesso giorno).

**Trovato costruendo, riparato subito** (`D-0192`): il primo cablaggio puntava l'ombra dentro
`workspace/shadows/` — annidata nell'albero che deve shadowware — e `shadow.mjs` la rifiuta
(«the shadow and the workspace must not contain one another»). La rotta di stato esistente
usa quella stessa directory ma **solo per sondare**, mai per materializzare, quindi il rifiuto
non era mai scattato prima. Riparato: l'ombra ora vive in `/tmp` (mai annidata), e
l'orchestratore **rifiuta al costruttore** se le due directory si contengono di nuovo.

**Due reperti storici, ancora aperti**: `F4-014` (l'esecutore è l'unico dei sei passi con due
implementazioni e nessun oracolo condiviso) e `F4-015` (`shadowStatus()` scrive su una GET).
`F4-016` (`reasoning.mjs` pianifica sempre contro `/workspace` letterale, innocuo in
produzione) resta aperto e non riparato — fuori scope, `workspace-actions.mjs` usa invece la
costante `workspace` reale apposta per non ereditarlo.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-workspace-actions` (ricostruita) · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-workspace-actions-unfixed-20260728T020232Z` (il predecessore
immediato — porta le due dichiarazioni stale corrette sopra, non un difetto funzionale). Due
container di progetto, che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

`workspace-actions.mjs`: `plan()` (request+files → piano reale via reasoning.mjs, i file
forniti dal chiamante perché il provider di riferimento non ha modello), `approve()` (umano
autorizza → mint token → ombra whole-workspace → `execute()` → **promozione** al workspace
reale solo se pulita), `reject()`, `restore()` (una tantum, ripristina bytes esatti o cancella
un file creato). Cinque rotte HTTP dietro `workspace.write`. Ogni passo nel registro causale
(step 6, **scritto per la prima volta da un caller reale**).

## ➜ Verifiche prodotte in sessione

```text
unit                  881/881  (era 863, +18)
ESLint                185 file · 0 errori · 0 warning · 0 no-undef
browser reale         315/315
accessibilità         27/27 su 27 superfici · 0 fail
difetti seminati      19/19 catturati
MANIFEST              5783/5783 · 0 mismatch · 0 righe non verificabili
AUTH_HTTP_SMOKE PASS · HTTP_SMOKE PASS
controllo HTTP dal vivo: piano→approva→file veri scritti→doppia-approvazione rifiutata→
  restore→file veri ripristinati→registro eventi valido a 7 eventi incatenati
Full sweep DebugLab (superficie di sicurezza, rule 40d): services/ 0 findings, verdetto clean
byte immagine = albero, byte container vivo = albero (sha256sum, entrambi, DOPO la correzione)
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`operationsSupported: ['WRITE']`** — DELETE ed EXECUTE dichiarati e non costruiti.
- **`testExecution: false`** — confine deliberato, non dimenticanza: vedi sopra.
- **`runsPersistAcrossRestart: false`** — i run vivono in memoria, un riavvio li azzera.
- **`filesSuppliedBy: 'caller'`** — il provider di riferimento non ha modello e non inventa un
  target da un prompt in prosa.
- Tutto ciò che era falso a fine fase precedente e non toccato da questa resta falso:
  registri in memoria, firma provenance simmetrica, `.ps1` mai eseguiti.

## ➜ Blocker aperti

- **`B-001`** — nessun remote. `gh` non installabile.
- **`B-008`** — due store d'identità, migrazione da fare in una fase propria.
- `B-002`, `B-009`, `B-010` — chiusi.

## ➜ Le domande all'Owner ancora senza risposta

**`D-0189`/`D-0190` risposta e costruita.** Le altre, invariate: **(3)** rimuovere
`apps/webui-react`; **(4)** `B-008`, quale store è la destinazione; **(5)** `B-001`, si vuole
un remote; **(6)** cinque destinazioni dell'interfaccia «da decidere»; **(7)** conformità
della conservazione dei dati delle richieste rifiutate; **(8)** TLS. **Nuova**: si vuole
estendere l'adversarial suite di `workspace-actions.mjs` al rigore di
`coden-invariant-adversarial.test.mjs` prima di dichiarare la clausola sull'autorità
completamente soddisfatta, o i 6 test attuali bastano per ora?
