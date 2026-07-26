# 06 · CodeN Evolution — il workspace

## 1. Un solo programma, due shell

CodeN Evolution è **un solo programma**. La WebUI e il client SSH sono due shell sopra lo
stesso motore, la stessa sessione, lo stesso stato.

Non è "un terminale disegnato in una pagina web" e non è "una CLI che telefona a un server":
entrambe **si agganciano a una sessione viva**. Avvii un compito nel browser, te ne vai, fai
`ssh`, ti agganci, e stai guardando lo stesso piano a metà volo — stesso stadio, stessa
richiesta di autorità in attesa, stessa coda di log. Ti stacchi da una e il compito continua:
appartiene al motore, non alla finestra.

**Conseguenze, e sono vincolanti:**

- **La sessione è l'unità di stato**, non la connessione. Le shell sono visualizzatori senza
  stato.
- **Ogni capacità deve rendersi in tutte e due.** Una funzione che serve il mouse non è
  finita. Un diff, una richiesta di autorità, una lavagna dei compiti e la mappa del
  repository hanno ciascuno una forma da tastiera completa, **progettata insieme** a quella
  grafica, non portata dopo.
- **Il protocollo fra shell e motore è pubblico e versionato.** Una terza shell — un plugin
  per editor, un visualizzatore mobile, un reporter di CI — è allora un client, non un fork.
- **`ssh` è il trasporto, non una modalità.** La shell da terminale su un TTY locale e via SSH
  sono lo stesso client; remoto è il deployment, non un prodotto diverso.
- **Le due shell non divergono in nessun punto.** Deciso esplicitamente. È la scelta più cara
  del progetto ed è per questo che è stata presa adesso invece di essere scoperta a metà.

## 2. Il ciclo di vita: sedici stadi

La specifica ne fissa dieci. Diventano sedici perché i dieci accorpavano decisioni diverse
sotto una sola parola. **Nessuno dei dieci originali è perso.**

```text
  1  Ricezione        la richiesta, testuale, con i suoi vincoli
  2  Interpretazione  Intent Frame: obiettivo, non-obiettivi, criteri di successo   [ATOM]
  3  Chiarimento      le ambiguità si risolvono con te, o si registrano come assunzioni
  4  Ricognizione     mappa del repository, punti d'ingresso, proprietà, modifiche recenti
  5  Recupero         evidenza: codice, documenti, test, cronologia, compiti passati
  6  Ipotesi          cause o approcci in ordine, con prove a favore E contrarie      [ATOM]
  7  Piano            passi ordinati, file, comandi, dipendenze                        [ATOM]
  8  Decomposizione   finché ogni passo è verificabile per ricalcolo                   [ATOM]
  9  Raggio d'azione  cos'altro tocca: dipendenti, API, dati, altri agenti
 10  Attesa           cosa deve succedere — quali test passano, quali falliscono apposta [ATOM]
 11  Simulazione      workspace ombra: diff previsto, esito previsto            [ATOM, opzionale]
 12  Classificazione  rischio per passo e per piano                                    [ATOM]
 13  Autorizzazione   la decisione umana — delimitata, a scadenza, revocabile
 14  Esecuzione       checkpoint, poi token spesi passo per passo, annullabile
 15  Verifica         test mirati, poi allargamento, poi la suite intera
 16  Chiusura         diff, evidenza, rischio residuo, cosa NON è stato fatto → accetta o annulla
```

**Lo stadio 3 è quello che tutti saltano.** Una richiesta con un'ambiguità irrisolta produce
lavoro sicuro di sé puntato sul bersaglio sbagliato, e il momento più economico per accorgersene
è **prima che il piano esista**.

**Lo stadio 8 è il cuore ATOM applicato al lavoro reale.** Si scompone finché verificare non è
più un'opinione. È lo stesso meccanismo che porta la moltiplicazione da 0.790 a 1.000 esatto.

**Lo stadio 16 ha una casella obbligatoria "cosa NON è stato fatto"** e non può essere vuota
senza dirlo. Un rapporto che elenca solo i successi ti insegna a fidarti in modo uniforme, che
è l'opposto di utile.

## 3. Capire il repository

La mappa si costruisce in modo incrementale, all'apertura e poi sui cambiamenti, **mai come
scansione bloccante**.

**Estrazione:** linguaggi e framework, gestori di pacchetti, configurazione, punti d'ingresso,
moduli, classi, funzioni, superficie API pubblica, schemi di database e migrazioni, test e i
loro bersagli, pipeline CI, container, infrastruttura.

**Struttura:** parsing AST per l'ampiezza, Language Server dove esiste per la profondità,
ricerca letterale veloce, indice dei simboli, indice semantico nella semantica di lavoro.
Grafo delle dipendenze, delle chiamate, degli import, e la cronologia da git.

**I segnali che una mappa porta e un albero di file no:**

| Segnale | Perché conta |
|---|---|
| **Proprietà e recency** | chi l'ha toccato per ultimo, quanto spesso cambia |
| **Copertura dei test per modulo** | e quali test esercitano davvero un dato file |
| **Criticità** | raggiungibile da un punto d'ingresso, sul percorso di autenticazione, tocca persistenza o denaro |
| **Fragilità** | churn contro storia dei difetti: dove le correzioni continuano ad atterrare |
| **Ambiguità** | dove la mappa è incerta, **marcata come incerta** invece che spianata |

Selezionando un nodo compaiono file correlati, dipendenti e dipendenze, test associati,
modifiche recenti, problemi aperti, **e i compiti che lo hanno già toccato**. Quest'ultimo si
accumula: il workspace diventa più bravo su un repository più a lungo ci lavora, **senza mai
scrivere il tuo codice nella semantica del prodotto**.

## 4. File, editor, terminale

**File:** leggere, creare, modificare, rinominare, spostare, eliminare con conferma,
confrontare versioni, cercare testo e simboli, applicare patch, annullare, ripristinare
checkpoint.

**Protezioni applicate dall'esecutore e ricontrollate dopo la risoluzione del percorso:**
nessuna scrittura fuori dal workspace, nessun attraversamento di directory, nessuna fuga via
symlink, nessuna sovrascrittura cieca, nessuna eliminazione massiva senza un'autorizzazione
esplicita e classificata a parte, nessuna modifica di `.env` o di segreti senza una concessione
distinta.

**Editor:** evidenziazione sintassi, autocompletamento, diagnostica, vai-alla-definizione,
trova-riferimenti, rinomina simbolo, documentazione al passaggio, formattazione, azioni di
codice, lint in linea, refactoring, breakpoint, navigazione errori, blame git, confronto file,
minimappa, breadcrumb.

**Terminale:** sessioni multiple e persistenti, shell diverse, esecuzione interattiva,
processi in background, log in tempo reale, stop/restart/kill che **uccide davvero l'albero
dei processi** invece di lasciare orfani, cronologia, ricerca, export, timeout configurabile.

**I comandi sono classificati**, e la classe determina cosa serve:

| Classe | Esempio | Cosa serve |
|---|---|---|
| Lettura | stato git, visualizzazione file | niente |
| Rischio basso | test, lint, build | token in allowlist |
| Modifica locale | formattatore, installazione dipendenze | token + checkpoint |
| Rischio alto | database, rete, Docker host | conferma forte + rollback |
| Critico | privilegi amministrativi, eliminazioni | ri-autenticazione + doppia conferma |

## 5. Verifica

Il motore decide cosa eseguire da cosa è cambiato, e allarga man mano che serve confidenza:
test mirati sui moduli toccati, poi i loro dipendenti, poi type checking e lint, poi la build,
poi la suite intera. Integrazione, end-to-end, contratto, API, database, container, scansioni
di sicurezza e benchmark sono disponibili e scelti per rilevanza.

```text
  modifica ─▶ test mirati ─▶ analisi del fallimento ─▶ correzione ─▶ ri-mira
                                                             │
                        iterazioni limitate, configurabili ──┘
                                                             ▼
                              allarga ─▶ suite intera ─▶ revisione diff ─▶ rapporto
```

**Il lavoro sui bug è test-first per costruzione:** riproduci, scrivi il test di regressione,
guardalo fallire *per la ragione giusta*, correggi la causa, guardalo passare, esegui la
suite. Una correzione che arriva senza un test che prima falliva viene riportata come **non
verificata**, con quelle parole.

## 6. Sotto-agenti e lavoro in parallelo

Un coordinatore decompone e assegna. Specialisti: architettura, backend, frontend, test,
sicurezza, documentazione, prestazioni, e un **revisore**.

**Il revisore è strutturalmente indipendente.** Contesto separato, modello diverso dove
possibile, e **non vede mai il ragionamento di chi ha implementato** — solo il diff, i test, il
piano e i criteri dichiarati. Un revisore che eredita il contesto dell'implementatore eredita i
suoi punti ciechi e produce consenso, non revisione.

Gli specialisti sono **categoricamente distinti**, mai fette sottili dello stesso continuo: è
una lezione misurata, non estetica — un router ottimo su esperti indistinguibili degrada da
1.000 a 0.69, e nessuna gerarchia lo salva.

**L'isolamento è vero, non di scheduling.** Agenti concorrenti lavorano in worktree git
separati, container separati o copie separate del workspace. Due agenti non possono tenere
token di scrittura sullo stesso file: il coordinatore serializza o divide. Il merge è uno
stadio esplicito con il suo diff e la sua autorizzazione.

## 7. Checkpoint, rollback e replay

Checkpoint automatici prima di ogni compito, ogni gruppo di modifiche, ogni cambio di
dipendenze, ogni migrazione, ogni comando ad alto rischio e ogni commit. Ognuno porta snapshot
dei file, stato git, il Piano, i comandi eseguiti, l'output rilevante, le versioni delle
dipendenze e la configurazione di sessione.

Il ripristino è granulare: un file, un gruppo di modifiche, l'intero workspace — oppure **solo
la conversazione**, **solo il piano**, **solo lo stato degli strumenti**. Poter riavvolgere il
ragionamento dell'agente tenendo il proprio codice è un'operazione distinta e spesso è proprio
quella che si vuole.

**Il replay deterministico** è la proprietà più forte: con il registro degli eventi e il
pacchetto di fixture, un'intera sessione si riesegue e deve produrre **gli stessi piani, le
stesse decisioni, gli stessi diff**. "Spiegami cosa ha fatto l'agente martedì" smette di essere
un'interpretazione di log e diventa una riesecuzione.

## 8. Il rapporto finale

In forma fissa, in entrambe le shell:

```text
  OBIETTIVO         cosa è stato chiesto, e come è stato interpretato
  ASSUNZIONI        ambiguità risolte senza chiedere, e come
  PIANO ESEGUITO    stadi raggiunti, stadi saltati e perché
  MODIFICATO        file, con la ragione di ciascuno
  COMANDI           cosa è stato eseguito, e cosa ha restituito
  VERIFICATO        test eseguiti · passati · falliti · non eseguiti, e perché no
  EVIDENZA          ogni affermazione qui sopra, collegata alla sua fonte
  RISCHIO RESIDUO   cosa potrebbe ancora essere sbagliato
  NON FATTO         cosa era stato chiesto e non è stato consegnato
  CHECKPOINT        come annullare tutto
  STATO             accettato · in attesa di commit · annullato
```

`ASSUNZIONI`, `NON FATTO` e `RISCHIO RESIDUO` sono **obbligatori** e non possono essere vuoti
senza dirlo. È così che si evita di insegnare a qualcuno a smettere di leggere i rapporti.

E questo rapporto, firmato e con le fixture allegate, **è la Prova di Sessione**.
