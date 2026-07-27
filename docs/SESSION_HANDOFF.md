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
2. **`docs/WEBUI_DESIGN_V3.md`** — il progetto dell'interfaccia, completo e autorizzato, **più
   `§22-27`, che dicono cosa di esso è ora costruito.** §1-9 la v3 · §10-17 la v4 · §18-21 la v5
   (destinazione Ricerca e il suo gate) · **§22-24 la struttura** · **§25-27 il layer di token** · **§28-30 i nove temi**.
   Criteri `UI-001…UI-096`
3. `MASTER_PROJECT/07_INTERFACCIA.md` — il riferimento normativo dell'interfaccia
4. `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` (matrice `CE-001…CE-024`) ·
   `MASTER_PROJECT/09_PIANO.md` §1 e §3 · `docs/WORK_PLAN_V5_REWRITE.md`
5. `docs/DECISION_LOG.md` (ultime: **`D-0137…D-0151`**), `docs/INSTALLATION_LEDGER.md`

---

## ➜ LA PROSSIMA AZIONE

> **La grafica è COMPLETA — tre passi su tre, costruiti e installati.** La prossima azione non è
> più la grafica.

Restano aperte tre cose, in ordine di dipendenza. **Nessuna è iniziata.**

**(a) Fase 0, punti 5 e 6** — traduzione canonica in inglese di `MASTER_PROJECT/` (regola 49) ed
emendamenti registrati a `V4-D001` / `V4-D002` (`GAP-F`: il prodotto e i documenti che lo
governano dicono cose diverse e nulla registra quale dei due debba muoversi). Nessuna riga di
codice, tutto reversibile.

**(b) Le parti dell'interfaccia che il disegno chiede e la grafica NON copre.** Da non confondere
con «fatto»: la grafica era struttura, token e temi.

- il **banco di lavoro** a tre regioni (`UI-030…UI-037`)
- la casella **`NON FATTO`** nella chiusura (`UI-036`, **Critica**)
- la **metrica del prodotto** — tempo di revisione umana per cambiamento accettato
  (`UI-070…UI-072`), di cui `UI-072` è Critica: un cambiamento **rifiutato** conta come tempo speso
- la **gestione delle sessioni** (`UI-001…UI-012`) — oggi la sezione è dichiarata e non costruita
- le otto voci di accessibilità **non strutturali** (`UI-040…UI-047`): dimensione del testo, zoom,
  riduzione animazioni come impostazione, regione live, lingua e fuso, istanti IANA
- la **superficie della Ricerca**, che richiede **prima** il suo gate (`UI-090…UI-096`)

**(c) La fase 1, la spina dorsale** — `ReasoningProvider`, capability token, esecuzione in ombra,
esecutore che accetta solo token, registro eventi, comprensione del repository. Rust dalla prima
riga, su un host senza toolchain Rust.

**Regola in vigore, da qui in avanti** (`D-0143`, `CLAUDE10.md` §3a): **si costruisce, si installa
e si verifica nella stessa fase.** Le suite vanno lanciate con
`NOESAR_E2E_BASE_IMAGE=noesar-evolution:phase4-themes`.

---

## ➜ Cosa è stato fatto in questa sessione

**I passi 1 e 2 della grafica, costruiti e installati.** Ed è cambiata una regola: a metà sessione
l'Owner ha stabilito che **una fase che cambia il prodotto lo installa e lo verifica nella stessa
fase** (`D-0143`, `CLAUDE10.md` §3a). Le due installazioni sono `:phase4-structure` e
`:phase4-tokens`.

### 1 · Ventitré destinazioni diventano dodici, e niente si perde

I tredici blocchi di pagina demossi sono stati **spostati verbatim** da uno script che estrae e
riassembla (`D-0137`): `#view-users`, `#view-logs`, `#view-providers` e gli altri esistono ancora
con i loro id, dentro l'unica pagina Impostazioni, che ora ha **menu dentro il menu** — tre gruppi,
tredici sezioni, indirizzabili come `#/settings/<sezione>`. *Compiti* è entrato in Home,
*Strumenti* in CodeN Evolution, *Memoria* in Conoscenza.

**Ogni indirizzo che rispondeva risponde ancora** (`D-0138`): `#/logs` inoltra a
`#/settings/health`, e la barra dell'indirizzo viene riscritta, perché un inoltro invisibile non è
verificabile. **I gate di ruolo sono scesi di livello con le pagine che proteggono** (`D-0139`):
erano rotte protette, ora sono sezioni protette, e le voci di menu non consentite sono rimosse.

### 2 · Due destinazioni sono dichiarate e non costruite, e lo dicono

*CodeN Evolution TUI* e *Ricerca* stanno nella barra con l'etichetta **not built** e una pagina che
dice cosa manca (`D-0141`). Nasconderle per far tornare il conto sarebbe stato mentire sul numero.

**La Ricerca non ha alcun campo che possa emettere una query** (`D-0142`), ed è deliberato: il gate
`UI-090…UI-096` viene **prima** della superficie. Costruire prima la superficie significherebbe
consegnare una via d'uscita verso la rete senza nulla che la classifichi.

### 3 · Quattro difetti trovati, tutti eseguendo — e due erano miei

1. **Mio, serio.** Una sezione che l'account non può aprire **faceva comunque partire il suo
   loader**: quattro richieste `403` (`/logs`, `/debug/status`, `/watchdog`, `/database/status`)
   emesse per una pagina che la persona si stava vedendo rifiutare. Il gate era applicato sullo
   schermo e abbandonato sul filo. L'ha trovato la suite in browser; riparato alla causa.
2. **Mio.** La guardia «ogni sezione sta dentro Impostazioni» che avevo **appena scritto**
   confrontava la **posizione nel file**, non l'annidamento: una sezione spostata fuori ma lasciata
   fra `#view-settings` e `#view-not-found` passava. Scoperto **seminando quel difetto** e vedendo
   la guardia restare verde. Ora cammina la profondità dei tag.
3. **Preesistente.** `.nav span{display:none}` sotto gli 850px toglieva l'etichetta anche
   dall'**albero di accessibilità**: su schermo stretto ogni voce era annunciata come un glifo
   nudo. Sostituita con il ritaglio, che nasconde senza togliere il nome.
4. **Mia misura sbagliata.** Il giro delle rotte misurava il testo dell'intera pagina Impostazioni,
   comprese le dodici sezioni nascoste: il «Loading…» di una sezione che nessuno guarda faceva
   fallire una pagina che aveva finito.

### 4 · Le guardie sono state provate, non date per buone

Quattro difetti **seminati** — una destinazione tolta dalla barra, una pagina demossa cancellata
invece che spostata, un vecchio indirizzo lasciato senza inoltro, una sezione fatta uscire da
Impostazioni. **Al primo giro due non furono catturati**: uno perché il seme non aveva mutato
nulla, l'altro perché la guardia era debole. Dopo la correzione **4 su 4**, ognuno catturato da
esattamente una guardia, e ogni file ripristinato **byte-identico**.

### 5 · Passo 2 — il layer di token, e la prova che non ha cambiato nulla

102 token in `:root`, **zero letterali di colore fuori** (`D-0144`). La sostituzione è
**consapevole della proprietà** (`D-0145`): lo stesso `#fff` è `--text-on-accent` dove è testo e
`--surface-inverse` dove è sfondo — due nomi, oggi lo stesso valore, in un tema chiaro no. Una
sostituzione cieca avrebbe prodotto un layer che *sembra* rimappabile e non lo è.

**Il rischio del passo era uno solo: cambiare un colore senza accorgersene.** Perciò la prova è
stata costruita prima del refactor, non dopo — `tools/computed-style-snapshot.mjs`, che fotografa
da un browser vero ogni proprietà di colore di ogni elemento su tutte e 25 le superfici.

```text
39.320 elementi · 6.133 firme distinte · 0 tuple di colore cambiate · 0 apparse · 0 sparite
sensibilita provata: 1 token spostato di 1 unita di blu  ->  29 firme si muovono
```

La riga della sensibilità è la più importante: **uno zero prodotto da un controllo che non può
fallire non è evidenza.**

**Un token morto rimosso** (`D-0146`): `--violet` era dichiarato una volta e referenziato zero
volte — un colore semantico che l'interfaccia dichiarava di avere e non dipingeva mai. È la stessa
classe di difetto dello schema morto, e la regola che la governa era già scritta.

**Due guardie nuove**, entrambe viste fallire su un difetto seminato: nessun letterale fuori da
`:root`, e ogni `var()` nomina un token che esiste. La seconda copre l'unico modo di fallire di
questo disegno — **un `var(--text-primry)` non dà errore**: ricade sul valore ereditato, quindi un
refuso si presenta come un colore leggermente sbagliato invece che come un guasto.

**E la guardia ha trovato un difetto di sé stessa:** cercava le definizioni solo in `:root` e ha
contestato `--col-side`/`--col-panel`, che sono definiti su `.app-shell` perché variano col rango
della barra. Definizioni legittime; ora cerca in tutto il foglio.

### 6 · Passo 3 — nove temi, e cosa ha scoperto sullo strumento di misura

Nove temi come **rimappature dei token**, generati da `tools/generate-themes.mjs` conservando il
**rango** del default (`D-0147`) — quale superficie è più profonda di quale, quale testo è più
quieto di quale. Il default non ha blocco: è il valore dei token stessi. Fra i nove, uno chiaro e
uno ad **alto contrasto vero**.

**La generazione è una proposta; l'audit è il verdetto** (`D-0148`). L'audit cammina ora tutti e
nove i temi: **0 fallimenti di contrasto su 3.825 misure**. Ci sono voluti sei giri per arrivarci,
e ogni giro ha nominato un difetto.

**Il colore libero non rifiuta niente** (`D-0149`): una tinta che non regge come testo resta il
riempimento, e ciò che si legge usa un **parente** della stessa tinta, derivato muovendo solo la
chiarezza fino a 4,5:1. La matematica sta in `apps/webui-static/colour.js`, **in un modulo a parte
perché sia testabile senza browser** — 11 test ancorati alle definizioni WCAG e passati su **tutta
la ruota delle tinte**, non sui due colori che stavano nel documento.

**Sette stati, glifo + parola** (`D-0150`), col glifo generato dal foglio di stile e non scritto in
ogni punto di chiamata. E il **viola torna cablato** come `--state-waiting` (`D-0151`): è
esattamente ciò che `D-0146` diceva che il passo successivo dovesse fare.

**Tre difetti nello STRUMENTO, e sono il risultato più importante della fase.** Tutti invisibili
finché esisteva un tema solo:

1. le fermate di gradiente **completamente trasparenti** venivano fuse contro un colore di pagina
   **scritto a mano** — un fondo nero fantasma dietro ogni elemento del tema chiaro;
2. quel colore era una **costante presa dalla cosa misurata**. Uno strumento fatto così sbaglia la
   prima volta che quella cosa cambia — e infatti **il `26/26` precedente era in parte fortuna**;
3. un elemento con un **gradiente opaco proprio** non fermava la ricerca del fondo, quindi un
   bottone primario veniva giudicato contro la pagina dietro di lui.

**Due difetti nel prodotto**, trovati dagli stessi nove temi: le **parole-chiave** di colore
(`color:white`) erano sfuggite al layer di token — la guardia del passo 2 cercava `#hex` e `rgb()`
e non le parole — e **marchio e avatar ereditavano** il colore del testo invece di nominarlo.

**E due difetti miei.** Le pastiglie di colore usavano **stili inline**, che la CSP del prodotto
blocca: il rimedio è passare dal **CSSOM**, non allentare `style-src`. E la mia fotografia dei
colori numerava le chiavi alternative **per ordine d'inserimento**, quindi aggiungere una sezione
ne rinumerava migliaia e dichiarava 473 differenze che erano solo la sua contabilità.

## ➜ Verifiche prodotte in sessione

```text
unit                     648/648   0 falliti · 46 suite       (erano 631)
guardia di struttura      19/19    0 falliti                  (erano 13)
matematica del colore     11/11    ancorata alle definizioni WCAG, su tutta la ruota delle tinte
accettazione in browser  265/265   0 falliti · browser reale   (erano 233)
accessibilita WCAG 2.2    27/27    0 falliti                   (erano 26)
contrasto per tema           0 fallimenti su 3.825 misure in NOVE temi
eslint                   162 file · 0 errori · 0 warning · 0 no-undef
MANIFEST                5728/5728  0 falliti
fotografia dei colori    passo 2: 0 tuple cambiate su 6.133 firme · passo 3: 2, entrambe volute
difetti seminati          11/11    ognuno catturato da esattamente una guardia
```

**La copertura è cresciuta, non calata.** L'audit misura ora **venticinque** superfici — dodici
destinazioni più le tredici sezioni — con 630 controlli di focus e 944 misure di contrasto.
Auditare le sole destinazioni avrebbe fatto sparire tredici superfici dalla misura lasciando il
numero `26/26` identico: è così che una ristrutturazione trasforma un audit verde in un audit più
piccolo.

**Non eseguito, dichiarato:** nessuno screen reader reale (l'audit stampa il proprio blocco
`NOT_TESTED` a ogni giro) · `forced-colors` non emulabile su questo Chromium · i quattro passi
Python di `scripts/test.sh` (`python3` assente, regola 45).

**Osservazione registrata e non riparata:** il browser **scarta** l'intestazione
`Cross-Origin-Opener-Policy` che il server invia, perché si è serviti in HTTP semplice su un nome
che non è `localhost`. Vale anche per l'installazione viva in LAN. Richiede TLS — decisione di host
e di fase d'installazione.

## ➜ L'installazione — SOSTITUITA E VERIFICATA

**La regola è cambiata a metà sessione** (`D-0143`, `CLAUDE10.md` **§3a**): su istruzione
dell'Owner, *una fase che cambia il prodotto lo installa e lo verifica nella stessa fase*.
Preparare e non installare era esattamente il difetto che questo progetto elimina altrove — il box
vivo era rimasto indietro di **quattro** riparazioni. Vale da adesso in poi.

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-themes
bind        192.168.178.100:8100 -> 8088   (LAN, NON loopback — vedi nota)
endpoint    livez 200 · readyz 200 · metrics 401 (hardening LAN intatto)
dati        postgres 18.4 · pgvector 0.8.5 · 16 migrazioni · 15 tabelle RLS
            identity projected=1 — l'Owner ha superato lo scambio
interfaccia 12 destinazioni e 13 sezioni servite; byte IDENTICI al repository
stile       104 token + NOVE temi come rimappature; byte IDENTICI al repository
hardening   dieci campi su dieci identici al container sostituito
igiene      due soli container noesar-evolution* · reti e volumi invariati
            37 container non del progetto prima e dopo · nessun prune
```

**Nota verificata di nuovo qui:** l'installazione **non** ascolta su `127.0.0.1`. Un controllo di
salute contro il loopback restituisce `000` e sembra un servizio morto mentre il servizio è sano.
Usare l'indirizzo di bind reale, che si ricava con `docker port noesar-evolution`.

**Cosa NON è stato verificato dal vivo, e va detto.** Il *comportamento* dell'interfaccia non è
stato esercitato su questa installazione: le suite in browser creano un Owner e cambiano
impostazioni, quindi girano contro una sonda usa-e-getta e mai contro l'installazione (§3a,
`11e`). Dal vivo è provato che i byte serviti sono **identici** all'albero che quelle suite hanno
esercitato, che il servizio è sano e che le rotte rispondono (401 contro un controllo 404).

**Rollback — nessun ripristino di stato richiesto, per ora.**

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-tokens-20260727T100234Z
```

`AI_STATE_VERSION` è invariato rispetto a `:phase4-tokens` e `state/ai-workspace.json` legge **ancora
`"schemaVersion": 1"`** — verificato prima del build, dopo il backup e dopo l'avvio. **Finché
legge 1, tornare indietro è solo riavviare il container vecchio.** Se legge 2, ripristinare anche
`state/` da `BACKUPS/runtime_pre_themes_deploy_20260727T100234Z/` (75 MB, preso a servizio
fermo). Il costo di rollback dello schema di `D-0082` **non** si applica a questo salto.

## ➜ Blocker aperti

`B-001` nessun remote GitHub (nessun commit è mai stato pushato) · `B-002` secret scan euristico
(`detect-secrets` restituisce 0 finding su una chiave AWS letterale) · `B-008` due store di
identità.

**Aperto e non risolvibile qui:** la **conformità** della conservazione dei dati delle richieste
rifiutate. L'Owner ha autorizzato il **disegno** (`D-0136`); la verifica rispetto agli obblighi
applicabili non è stata fatta e non è accertabile su questo host.

**Aperto e non pianificato:** la **voce** (`D-0123`) e i **pannelli staccabili** su secondo monitor
(`07` §5).

**Non toccato dal passo 1, e da non confondere con «fatto»:** il **banco di lavoro**
(`UI-030…UI-037`), la **casella `NON FATTO`** (`UI-036`, Critica), la **metrica del prodotto**
(`UI-070…UI-072`), la **gestione delle sessioni** (`UI-001…UI-012`) e le otto voci di accessibilità
`UI-040…UI-047` che non sono strutturali.

## ➜ Rollback

```text
container    noesar-evolution.rollback-webui-20260726T155330Z     immagine :phase4-webui
runtime      BACKUPS/runtime_pre_wp2_deploy_20260726T155330Z/     copia completa 75 MB
questa       BACKUPS/webui_struttura_20260727T082357Z/            i 5 file dell'interfaccia,
sessione                                                          le 2 suite e il MANIFEST,
                                                                  copiati prima di ogni modifica
```

Per tornare indietro sul **sorgente** di questa fase basta ricopiare da quella cartella: nessuna
migrazione, nessuno schema, nulla di installato. Per tornare indietro sull'**installazione**:
`docker stop -t 60 noesar-evolution`, rinominarlo da parte, poi
`docker start noesar-evolution.rollback-webui-20260726T155330Z`. **Se nel frattempo la build
attuale ha scritto** `state/ai-workspace.json` — controlla se legge ancora `"schemaVersion": 1` —
va ripristinato anche quello dal backup, o `:phase4-webui` rifiuterà di caricare il workspace AI.
