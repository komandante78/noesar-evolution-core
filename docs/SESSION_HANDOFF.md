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
2. **`docs/WEBUI_DESIGN_V3.md`** — il progetto dell'interfaccia **accettato e completo**: le
   sezioni 1-9 sono la v3 e la rilettura che ne ha trovato gli otto buchi; le sezioni **10-17
   sono la v4, che li chiude tutti**. Criteri `UI-001…UI-072`. L'anteprima navigabile è
   **`docs/design/ANTEPRIMA_WEBUI_V4.html`**, autonoma: si apre in un browser senza nulla
   intorno (la v3 resta accanto solo per confronto)
3. `MASTER_PROJECT/07_INTERFACCIA.md` — il riferimento normativo dell'interfaccia
4. `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` — le tre malattie misurate, le sei invenzioni,
   la matrice di accettazione `CE-001…CE-024`
5. `MASTER_PROJECT/09_PIANO.md` §1 e §3 · `docs/WORK_PLAN_V5_REWRITE.md`
6. `docs/DECISION_LOG.md` (ultime: `D-0117…D-0129`), `docs/INSTALLATION_LEDGER.md`

---

## ➜ LA PROSSIMA AZIONE — deciso dall'Owner

> **Si costruisce la GRAFICA. Poi tutto il resto** (`D-0118`).

**Il disegno è finito**: gli otto buchi trovati rileggendo la specifica sono chiusi nella v4
(`D-0125…D-0129`), e la mappa 23→11 non lascia nessuna destinazione senza casa. Non resta
progettazione da fare prima di scrivere codice.

Non è più una conversazione: l'impianto è **accettato** e i criteri sono scritti. L'ordine dentro
la grafica è vincolato e non va invertito:

1. **Struttura** — 23 → 11 destinazioni, quindici voci che cambiano rango a sezione dentro
   l'unica pagina Impostazioni; barra laterale a tre stati su `[` e `]`; pannello contestuale
   agganciabile/flottante/via con memoria **per destinazione** (`D-0117`).
2. **Layer di token** — oggi non esiste: i colori sono letterali sparsi in ~23 KB di CSS. Senza
   questo passo i nove temi e il selettore libero non sono implementabili.
3. **Palette e temi** — la palette estratta dai pixel, i nove temi, il selettore di colore libero
   con contrasto misurato e variante testuale derivata (`UI-020…UI-026`).

**Attenzione al costo, già dichiarato:** cambiare rango a quindici voci sposta i selettori di
tutte le pagine. I controlli in browser e i criteri di accessibilità vanno **rieseguiti**, non
riletti — e i valori di contrasto in `WEBUI_DESIGN_V3.md` §5 sono **calcolati**, mai passati per
`tools/accessibility-audit.mjs`.

**Non iniziare la fase 1.** Della fase 0 restano aperti i punti 5 e 6 — traduzione canonica in
inglese e emendamenti a `V4-D001`/`V4-D002`.

**Rimasto aperto e non pianificato:** la **voce** (`D-0123`). È disegnata nell'anteprima come
torre di controllo, con il vincolo che non può allargare l'autorità. Serve una decisione
dell'Owner prima che diventi lavoro.

---

## ➜ Cosa è stato fatto in questa sessione

### 1 · Il divario è stato misurato sul codice, non stimato

Prima di disegnare qualsiasi cosa: **23 destinazioni** contro le undici del riferimento
normativo, **zero** occorrenze di collasso della barra o di aggancio del pannello in
`apps/webui-static/`, **nessun** layer di token, e una palette diversa da quella del riferimento
vincolante. Da lì il progetto, non dal gusto.

### 2 · L'impianto accettato, e due decisioni chiuse dall'Owner

Undici destinazioni, **una sola** pagina Impostazioni con i menu dentro, e Progetti/Documenti/
Conoscenza/Agenti come **superfici di lavoro** con le proprie azioni invece che elenchi. L'Owner
ha chiuso i due punti che erano rimasti aperti: **pannello per destinazione** (`D-0117`) e
**prima la grafica, poi la costruzione** (`D-0118`).

### 3 · Le sessioni, con la conferma su ogni azione

Cinque distese, riquadro a scorrimento dalla sesta col conteggio dichiarato, archivio in pagina
propria a **dieci per pagina**, ripristino, selezione multipla con contatore. **Conferma senza
eccezioni**, che dichiara *che cosa* e *a quante* ed elenca i titoli quando sono più d'una.
`UI-001…UI-012`. Aggiunta proposta e **togliibile**: l'eliminazione resta recuperabile 30 giorni.

### 4 · Il colore lo sceglie la persona, la leggibilità la garantisce il prodotto

Nove temi **più** un selettore libero. Il contrasto è **misurato mentre si sceglie**; una tinta
che non regge come testo **non viene rifiutata** — resta l'indicatore e la variante testuale è
derivata allontanandosi dal fondo fino a 4,5:1. I sette stati semantici non cambiano mai
significato e portano sempre **glifo + parola**.

### 5 · Un errore di misura mio, trovato eseguendo

Avevo dichiarato che l'indaco del riferimento non rompe il contrasto, sulla base di **un solo**
calcolo: bianco *sopra* `#3958c3`, 6,2:1. Scrivendo la derivazione automatica ho calcolato anche
il caso opposto — la stessa tinta usata **come testo** su `#0c1824` — e sta a **2,9:1**, sotto
soglia esattamente come il viola. Accento *pieno* e accento *testuale* sono due token diversi, e
la versione precedente li aveva confusi in uno. **La correzione è nel meccanismo, non nella
tabella.**

### 6 · Perché uno dovrebbe sceglierlo — cercato, non inventato

Sei misure pubblicate, con le fonti, in `WEBUI_DESIGN_V3.md` §6: adozione **84%** contro fiducia
alta **3%**; **66%** «quasi giusto, ma non del tutto»; **38%** dice che rivedere codice generato
costa *più* che rivedere quello di un collega; **65%** dei fallimenti viene dal contesto che si
degrada, non dal modello; e il rispetto dei vincoli che scende dal **73% al 33%** fra il turno 5 e
il turno 16.

La lettura: il collo di bottiglia non è più scrivere, è **fidarsi**. Le quattro differenze del
prodotto discendono dal motore e l'interfaccia le rende visibili — promuovere un risultato invece
di autorizzare un'intenzione, la copertura di verifica sempre a schermo, **riavvolgere e
ramificare** senza riesecuzione (possibile solo perché il contesto è una proiezione da stato), e
la voce come torre di controllo.

**Limite dichiarato:** quei numeri vengono da terzi e **non sono stati riprodotti qui**.

## ➜ Verifiche prodotte in sessione

```text
unit                    631/631   0 falliti · 44 suite
eslint                  158 file · 0 errori · 0 warning · 0 no-undef
MANIFEST              5721/5721   0 falliti (invariato: nessun file coperto è stato toccato)
migration manifest      CURRENT · 16 migrazioni
anteprima               sintassi JS OK (node --check) · tag bilanciati (164 div, 161 span)
matematica colore       6 coppie tinta/fondo eseguite isolate — ha trovato il difetto §5
```

**Nota sul MANIFEST, non un difetto ma va saputo:** non copre `PROJECT_STATE.json`,
`docs/DECISION_LOG.md`, `docs/SESSION_HANDOFF.md` né `docs/design/` — la stessa classe di
`D-0074`. I due file nuovi di questa fase seguono la convenzione esistente e **non** sono stati
aggiunti: cambiarla è una decisione dell'Owner, non una scelta da fare di passaggio.

**Non eseguibile su questo host, dichiarato e non contato come passato:** l'apertura
dell'anteprima **in un browser reale**. Non ce n'è uno installato, la regola 45 vieta di
installarlo, e un browser richiederebbe un container fuori da una fase di installazione. Restano
non eseguiti anche i quattro passi Python di `scripts/test.sh` (`python3` assente, regola 45).

## ➜ L'installazione — intoccata

```text
container   running · healthy · noesar-evolution:phase4-wp2
igiene      nessun container creato, avviato o fermato · nessuna rete, nessun volume toccato
            sopravvivono i due ammessi da §5a: l'installazione e UN solo rollback
```

**Nessuna riga di prodotto è stata modificata in questa sessione**: il lavoro è tutto in `docs/`.
Restano nel sorgente e **non installate** le riparazioni delle sessioni precedenti — il box vivo
dichiara ancora il nome sbagliato in `/api/v1/bootstrap`. Il deploy è una fase di installazione e
**richiede autorizzazione esplicita dell'Owner**; prima va letta la nota sul costo di rollback
dello schema (`D-0082`).

## ➜ Blocker aperti

`B-001` nessun remote GitHub (nessun commit è mai stato pushato) · `B-002` secret scan euristico
(`detect-secrets` restituisce 0 finding su una chiave AWS letterale) · `B-008` due store di
identità.

**Non un blocker ma va ripetuto:** restano non eseguite, con la ragione data, la cancellazione dei
file di memoria di altri progetti (irreversibile: quel percorso non è un repository git) e la
conservazione di credenziali in un file tracciato (regola 25). Alternativa proposta e non ancora
autorizzata: archiviare invece di cancellare, e un `.env.example` che **nomina** le variabili
senza valori.

## ➜ Rollback

```text
container    noesar-evolution.rollback-webui-20260726T155330Z     immagine :phase4-webui
runtime      BACKUPS/runtime_pre_wp2_deploy_20260726T155330Z/     copia completa 75 MB
questa fase  BACKUPS/webui_design_v3_20260727T065119Z/            stato, handoff, decisioni,
                                                                  MANIFEST — prima di toccarli
progetto V4  git c28d8a2 · archivi sigillati ·
             EVIDENCE/v4_removal_recovery_20260726T163433Z.txt
```

Per tornare indietro sull'installazione: `docker stop -t 60 noesar-evolution`, rinominarlo da
parte, poi `docker start noesar-evolution.rollback-webui-20260726T155330Z`. **Se nel frattempo la
build attuale ha scritto** `state/ai-workspace.json` — controlla se legge ancora
`"schemaVersion": 1` — va ripristinato anche quello dal backup, o `:phase4-webui` rifiuterà di
caricare il workspace AI.
