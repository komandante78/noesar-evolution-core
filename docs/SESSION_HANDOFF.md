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

**I sette passi di `09_PIANO.md` §2 sono TUTTI costruiti e installati.** Il passo 7 —
comprensione minima del repository (rilevamento linguaggi, punti d'ingresso, indice dei
simboli, ricerca letterale, mappa delle dipendenze) — è stato l'ultimo, in `repo-map.mjs`
(`D-0188`, installato `:phase4-repomap`).

**Ma questo NON chiude la fase 1.** Il criterio §3 non è un elenco di componenti — è un
flusso: *apre un repository vero, ne capisce la struttura, riceve una richiesta, produce un
piano, ottiene un'autorizzazione, cambia diversi file, mostra il diff, esegue i test,
corregge un errore, produce un risultato verificabile, ripristina lo stato precedente su
richiesta, registra ogni operazione — e non esce mai dall'autorità che gli è stata data,
provato da una suite avversaria il cui unico lavoro è provare a farglielo fare.* Oggi:

- `executorWiredToProductActions = false` — nessuna superficie del prodotto instrada le
  proprie modifiche attraverso l'esecutore
- `executesPlans = false` — nulla esegue un piano dentro l'ombra
- il registro eventi resta vuoto su un'installazione fresca: nessun sottosistema vi scrive

**`D-0189` ha risposta, `D-0190`: scrittura file da chat.** Quando `reasoning.plan` produce un
piano approvato, l'esecutore spenderà un token per scrivere/modificare un file **vero** nel
workspace su disco, cablando le quick action già disegnate in `home-overview.mjs` ("Find a bug
and fix it", "Implement a feature", ecc. — oggi aprono solo una chat col testo dell'obiettivo,
senza eseguire nulla). **Deciso, non costruito.** La prossima fase esegue il ciclo completo
(contratto, backup, scope minimo, test, hunt-and-fix, build/install/verify nella stessa fase,
`D-0143`) per questa scelta.

**`F4-016` aperto, non riparato**: `reasoning.mjs` pianifica sempre contro `/workspace`
letterale (`PRODUCT.workspaceRoot` non è mai definito), mai contro `NOESAR_WORKSPACE` — 
innocuo in produzione (coincidono lì), ma silenzioso altrove. `repo-map.mjs` usa invece la
costante `workspace` reale. Fuori scope per questa fase.

**Build offline Rust**: serve `RUSTUP_TOOLCHAIN` pinnato (`D-0173`) e `conformance/` montata
a `/conformance`, altrimenti i test di conformance Rust falliscono per un motivo che non è il
codice. Non toccato in questa fase (nessun crate Rust nuovo — vedi `D-0188`).

**Due reperti storici, ancora aperti**: `F4-014` (l'esecutore è l'unico dei sei passi con due
implementazioni e nessun oracolo condiviso) e `F4-015` (`shadowStatus()` scrive su una GET).

## ➜ Stato dell'installazione

`noesar-evolution:phase4-repomap` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-cow-20260728T012632Z` (`:phase4-cow`, il predecessore). Due
container di progetto, che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione, reti e
volumi diffati identici prima/dopo.

## ➜ Cosa è stato fatto in questa sessione

**Passo 7 costruito, installato e verificato nella stessa fase** (`D-0143`): `repo-map.mjs`
— sola lettura, workspace-scoped, JS-only (`D-0188`, nessun gemello Rust perché questo
propone/presenta e non decide/confina, D-A). Tre rotte: `GET /api/v1/repo-map` (stato),
`POST /api/v1/repo-map/scan`, `GET /api/v1/repo-map/search`, dietro `workspace.read`.

**Trovato costruendo**: la stessa costante rotta (`PRODUCT.workspaceRoot ?? '/workspace'`,
sempre il letterale) che `reasoning.mjs` già usa — copiata per errore nella prima stesura
delle rotte nuove, poi vista fallire in un controllo HTTP dal vivo e corretta a `workspace`
(la costante vera). Registrata come `F4-016` per la copia in `reasoning.mjs`, non riparata lì
(fuori scope).

**Full sweep DebugLab** (rule 40d, nuova superficie): `services/` — dove questa fase ha
scritto — **0 findings**. `tools/`, `capabilities/`, `apps/`, `oci/`, `INSTALLATION/`: ~90
findings, tutti **preesistenti** (bandit B603/B607 su `subprocess.run` ad argomenti fissi,
S105 sul canary di test `must-not-leak` già documentato come falso positivo, F401 import
inutilizzati) — **non riparati**: fuori scope di questa fase, nessuno introdotto da essa.

## ➜ Verifiche prodotte in sessione

```text
unit                  863/863  (era 843, +20 repo-map.test.mjs)
ESLint                183 file · 0 errori · 0 warning · 0 no-undef
browser reale         315/315
accessibilità         27/27 su 27 superfici · 0 fail
difetti seminati      19/19 catturati
MANIFEST              5781/5781 · 0 mismatch · 0 righe non verificabili
AUTH_HTTP_SMOKE       PASS · HTTP_SMOKE PASS
controllo HTTP dal vivo delle 3 rotte nuove: 401 non-auth, 400 fuga di percorso, 200 con
  linguaggi/simboli/punti-d'ingresso/dipendenze reali su una fixture e sul sorgente vero di
  questo repository (test unitario dedicato)
byte immagine = albero, byte container vivo = albero (sha256sum, entrambi)
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`repoMapStatus().incremental = false`** — ricostruito per intero a ogni chiamata, nessuna
  cache, nessun watcher.
- **`astParsing = false`** — indice dei simboli è regex per linguaggio, non un parser.
- **`secondLevelSignals = false`** — proprietà, recency, copertura, criticità, fragilità
  restano fase 2 (`09_PIANO.md` P5).
- Tutto ciò che era falso a fine fase precedente resta falso: `executorWiredToProductActions`,
  `executesPlans`, registri in memoria, firma provenance simmetrica, `.ps1` mai eseguiti.

## ➜ Blocker aperti

- **`B-001`** — nessun remote. `gh` non installabile. Nessun commit mai pushato.
- **`B-008`** — due store d'identità, migrazione da fare in una fase propria.
- `B-002`, `B-009`, `B-010` — chiusi.

## ➜ Le domande all'Owner ancora senza risposta

**Quella più urgente (`D-0189`) ha risposta** (`D-0190`: scrittura file da chat). Le altre,
invariate: **(3)** rimuovere `apps/webui-react`; **(4)** `B-008`, quale store è la
destinazione; **(5)** `B-001`, si vuole un remote; **(6)** cinque destinazioni dell'interfaccia
«da decidere»; **(7)** conformità della conservazione dei dati delle richieste rifiutate;
**(8)** TLS.
