# NOESAR EVOLUTION — Session Handoff

**Riscritto alla fine di ogni fase. Una sessione fredda deve poter ripartire da questo file e
da `PROJECT_STATE.json` soltanto.**

---

## 🛑 REGOLA ZERO — un solo progetto esiste

**Ordine esplicito dell'Owner, 2026-07-26.** Lavorando qui, l'unico progetto che esiste è
**NOESAR EVOLUTION**. Nessun altro sistema di questo host si nomina, si cita, si confronta o si
tocca — non come riferimento, non come esempio, nemmeno "solo per contesto". Scritta in
`CLAUDE10.md` §1 e in cima alla skill, perché veniva letta e poi aggirata.

**CodeN Evolution è un prodotto nuovo** e non eredita nome, codice, architettura o convenzioni da
nessun altro.

**Tutto ciò che sta fuori da `PROJECT_ROOT` è in sola lettura.** Una richiesta di cancellare
artefatti di altri progetti è un **blocker**, non un compito.

## ➜ IL PROGETTO DI RIFERIMENTO È `MASTER_PROJECT/`

Deciso dall'Owner il 2026-07-26. Il metro non è il master V4: è la **riscrittura**.
`MASTER_REFERENCE/` è stata rimossa dall'albero — eccezione nominata, registrata in
`CLAUDE10.md` §1a e `D-0097`, recuperabile su tre percorsi con le prove in
`EVIDENCE/v4_removal_recovery_20260726T163433Z.txt`. **Non reintrodurla come metro senza una
nuova decisione dell'Owner.**

## ➜ Leggi in quest'ordine

1. `PROJECT_STATE.json` e questo file
2. **`docs/WEBUI_DESIGN_V3.md`** — il progetto dell'interfaccia, **completo e autorizzato**. Il
   nome del file dice v3 ma il contenuto è cresciuto in tre passaggi nella stessa giornata:
   **§1-9** la v3 e la rilettura che ne ha trovato gli otto buchi · **§10-17** la v4, che li
   chiude · **§18-21** la v5, che aggiunge la destinazione **Ricerca** e il suo gate di sicurezza.
   Criteri **`UI-001…UI-096`**
3. **`docs/design/ANTEPRIMA_WEBUI_V5.html`** — l'anteprima navigabile, autonoma: si apre in un
   browser senza nulla intorno. Le v3 e v4 restano accanto solo per confronto
4. `MASTER_PROJECT/07_INTERFACCIA.md` — il riferimento normativo dell'interfaccia
5. `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` — le tre malattie misurate, le sei invenzioni,
   la matrice `CE-001…CE-024` · `MASTER_PROJECT/09_PIANO.md` §1 e §3 ·
   `docs/WORK_PLAN_V5_REWRITE.md`
6. `docs/DECISION_LOG.md` (ultime: **`D-0117…D-0136`**), `docs/INSTALLATION_LEDGER.md`

---

## ➜ LA PROSSIMA AZIONE — deciso dall'Owner

> **Si costruisce la GRAFICA. Poi tutto il resto** (`D-0118`).

**La progettazione è finita e autorizzata.** Non resta disegno da fare prima di scrivere codice.
L'ordine dentro la grafica è vincolato e non va invertito:

1. **Struttura** — 23 → **12** destinazioni (`D-0130`: la Ricerca è la dodicesima ed è
   dichiarata); quindici voci che cambiano rango a sezione dentro l'unica pagina Impostazioni;
   barra laterale a tre stati su `[` e `]`; pannello contestuale agganciabile/flottante/via con
   memoria **per destinazione** (`D-0117`).
2. **Layer di token** — oggi non esiste: i colori sono letterali sparsi in ~23 KB di CSS. Senza
   questo passo i nove temi e il selettore libero non sono implementabili.
3. **Palette e temi** — palette estratta dai pixel, nove temi, selettore di colore libero con
   contrasto misurato e variante testuale derivata (`UI-020…UI-026`).

**Tre avvertenze per chi costruisce.**

- **Il gate della Ricerca si costruisce PRIMA della superficie, non dopo.** È un requisito
  (`UI-090…UI-096`), non una rifinitura, e una delle sue categorie non è aggirabile da nessun
  ruolo, Owner compreso.
- **Cambiare rango a quindici voci sposta i selettori di tutte le pagine.** I controlli in browser
  e i criteri di accessibilità vanno **rieseguiti**, non riletti: i 26 oggi verdi valgono
  sull'interfaccia attuale.
- **Tutti i valori di contrasto in `WEBUI_DESIGN_V3.md` sono calcolati**, mai passati per
  `tools/accessibility-audit.mjs`.

**Non iniziare la fase 1.** Della fase 0 restano aperti i punti 5 e 6 — traduzione canonica in
inglese e emendamenti a `V4-D001`/`V4-D002`.

---

## ➜ Cosa è stato fatto in questa sessione

La sessione era una **conversazione sulla grafica** e si è chiusa con un progetto completo e
autorizzato, in tre passaggi. Ognuno è partito da una verifica, non da un'idea.

### 1 · Il divario è stato misurato sul codice

23 destinazioni contro le undici del riferimento normativo; **zero** occorrenze di collasso della
barra o di aggancio del pannello in `apps/webui-static/`; **nessun** layer di token; palette
diversa da quella del riferimento vincolante. Da lì il progetto, non dal gusto.

### 2 · v3 — l'impianto, accettato

Undici destinazioni, **una sola** pagina Impostazioni con i menu dentro, Progetti/Documenti/
Conoscenza/Agenti come **superfici di lavoro**. L'Owner ha chiuso i due punti aperti: **pannello
per destinazione** (`D-0117`) e **prima la grafica, poi la costruzione** (`D-0118`). Gestione
completa delle **sessioni** (`UI-001…UI-012`) e **colore libero con leggibilità garantita**
(`UI-020…UI-026`).

### 3 · Un errore di misura mio, trovato eseguendo

Avevo dichiarato che l'indaco del riferimento non rompe il contrasto sulla base di **un solo**
calcolo — bianco *sopra* `#3958c3`, 6,2:1. Scrivendo la derivazione automatica ho calcolato il
caso opposto: la stessa tinta **come testo** su `#0c1824` sta a **2,9:1**, sotto soglia
esattamente come il viola. Accento *pieno* e accento *testuale* sono due token diversi e li avevo
confusi in uno. **La correzione è nel meccanismo, non nella tabella.**

### 4 · La rilettura contro la specifica — otto buchi

Fatta **dopo** l'accettazione, riga per riga contro `07_INTERFACCIA`, `06_CODEN_EVOLUTION` §2, la
matrice `CE-*` e il PNG approvato. L'impianto reggeva, il dettaglio no: cinque destinazioni senza
casa, banco di lavoro a metà, casella `NON FATTO` assente, barra superiore mutilata, accessibilità
a due voci su otto, `CE-020` non soddisfatto, schermata iniziale incompleta, `CE-024` non
raccolta.

### 5 · v4 — gli otto buchi chiusi

Banco a tre regioni con **riga di stato propria** (distinta dalla striscia di approvazione),
undici schede, terminale multiplo persistente, colonna agente completa, **casella `NON FATTO`**
(`UI-036`, Critica), barra superiore rimessa, accessibilità **8 su 8**, tastiera e comando TUI per
ogni azione, schermata iniziale completa, `CE-024` misurata — con i **cambiamenti rifiutati che
contano come tempo speso**, perché escluderli sarebbe scegliere il denominatore che conviene.

**`UI-046` è verificato meccanicamente, non asserito:** zero proprietà fisiche `left`/`right` nel
foglio di stile del provino, solo `inline-start`/`inline-end`. Un difetto reale di una sessione
precedente nasceva da un `left:-9999px`, e il rimedio non è ricordarselo — è renderlo impossibile
da scrivere male.

### 6 · v5 — la destinazione Ricerca, e un gate che non è una lista di parole

Obiettivo + criteri, rapporto con **link provvisorio** che scade e si revoca, **non pubblico di
suo**. La **qualità dell'evidenza** dichiarata invece del voto medio: nell'esempio disegnato il
candidato col voto più alto è quello con l'evidenza più debole, e il rapporto lo dice. **Nessun
link di affiliazione, mai.**

Il gate **non è una denylist testuale** — `D-0111` l'aveva già rifiutata perché battuta da
qualunque indirezione. Classifica **intento ed effetto**, gira su **due porte** (prima dell'uscita
e sul contenuto che rientra), ha **tre esiti** (procedi · chiedi · rifiuta) e **nomina la
categoria**. Si rifiuta l'**effetto**, non l'argomento: un prodotto che rifiuta «quali sono le
leggi sugli esplosivi» è rotto, non sicuro. **Lo sfruttamento di minori è l'unica categoria non
aggirabile da alcun ruolo, Owner compreso.**

Le destinazioni passano da undici a **dodici** (`D-0130`) — dichiarato, non nascosto: ogni
aggiunta futura deve costare lo stesso attrito, o si torna alle ventitré una voce alla volta.

## ➜ Verifiche prodotte in sessione

```text
unit                    631/631   0 falliti · 44 suite
eslint                  158 file · 0 errori · 0 warning · 0 no-undef
MANIFEST              5721/5721   0 falliti
migration manifest      CURRENT · 16 migrazioni
anteprima v5            sintassi JS OK · tag bilanciati (254 div · 238 span · 66 button · 52 tr)
UI-046 (RTL)            0 proprieta fisiche left/right nel CSS — verificato, non asserito
matematica colore       6 coppie eseguite isolate — ha trovato il difetto del §3 sopra
```

**Non eseguibile su questo host, dichiarato e non contato come passato:** l'apertura
dell'anteprima **in un browser reale**. Non ce n'è uno installato, la regola 45 vieta di
installarlo, e un browser richiederebbe un container fuori da una fase di installazione. Restano
non eseguiti anche i quattro passi Python di `scripts/test.sh` (`python3` assente, regola 45).

**Nota sul MANIFEST:** non copre `PROJECT_STATE.json`, `docs/DECISION_LOG.md`, questo file né
`docs/design/` — stessa classe di `D-0074`. I file nuovi di questa sessione seguono la convenzione
esistente e **non** sono stati aggiunti: cambiarla è una decisione dell'Owner.

## ➜ L'installazione — intoccata

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-wp2
bind        192.168.178.100:8100 -> 8088   (LAN, NON loopback — vedi nota sotto)
endpoint    livez 200 · readyz 200 · metrics 401 (hardening LAN intatto)
igiene      nessun container creato, avviato o fermato · reti e volumi invariati
            39 container all'apertura e 39 in chiusura
            sopravvivono i due ammessi da §5a: l'installazione e UN solo rollback
```

**Nota per la prossima sessione, verificata qui:** l'installazione **non** ascolta su
`127.0.0.1`. Un controllo di salute contro il loopback restituisce `000` e sembra un servizio
morto mentre il servizio è sano. Usare l'indirizzo di bind reale, che si ricava con
`docker port noesar-evolution`.

**Nessuna riga di prodotto è stata modificata in questa sessione**: tutto il lavoro è in `docs/`.
Restano nel sorgente e **non installate** le riparazioni delle sessioni precedenti — il box vivo
dichiara ancora il nome sbagliato in `/api/v1/bootstrap`. Il deploy è una fase di installazione e
**richiede autorizzazione esplicita dell'Owner**; prima va letta la nota sul costo di rollback
dello schema (`D-0082`).

## ➜ Blocker aperti

`B-001` nessun remote GitHub (nessun commit è mai stato pushato) · `B-002` secret scan euristico
(`detect-secrets` restituisce 0 finding su una chiave AWS letterale) · `B-008` due store di
identità.

**Aperto e non risolvibile qui:** la **conformità** della conservazione dei dati delle richieste
rifiutate. L'Owner ha autorizzato il **disegno** (`D-0136`); la verifica rispetto agli obblighi
applicabili non è stata fatta e non è accertabile su questo host. Trattare l'autorizzazione
dell'Owner come un accertamento di conformità sarebbe la falsa dichiarazione che questo progetto
elimina altrove.

**Aperto e non pianificato:** la **voce** (`D-0123`) — disegnata come torre di controllo, con il
vincolo che non può allargare l'autorità; e i **pannelli staccabili** su secondo monitor
(`07` §5).

**Non un blocker ma va ripetuto:** restano non eseguite, con la ragione data, la cancellazione dei
file di memoria di altri progetti (irreversibile: quel percorso non è un repository git) e la
conservazione di credenziali in un file tracciato (regola 25).

## ➜ Rollback

```text
container    noesar-evolution.rollback-webui-20260726T155330Z     immagine :phase4-webui
runtime      BACKUPS/runtime_pre_wp2_deploy_20260726T155330Z/     copia completa 75 MB
questa       BACKUPS/webui_design_v3_20260727T065119Z/            prima della v3
sessione     BACKUPS/webui_design_v4_20260727T071954Z/            prima della v4
             BACKUPS/webui_ricerca_v5_*/                          prima della v5
             BACKUPS/chiusura_20260727T075419Z/                   prima della chiusura
progetto V4  git c28d8a2 · archivi sigillati ·
             EVIDENCE/v4_removal_recovery_20260726T163433Z.txt
```

Per tornare indietro sull'installazione: `docker stop -t 60 noesar-evolution`, rinominarlo da
parte, poi `docker start noesar-evolution.rollback-webui-20260726T155330Z`. **Se nel frattempo la
build attuale ha scritto** `state/ai-workspace.json` — controlla se legge ancora
`"schemaVersion": 1` — va ripristinato anche quello dal backup, o `:phase4-webui` rifiuterà di
caricare il workspace AI.
