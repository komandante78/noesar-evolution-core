# 17 · CodeN Evolution — il piano di lavoro

**Deciso dall'Owner il 2026-08-05.** Questo documento non aggiunge decisioni: prende quelle di
`16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` e le rende **eseguibili**, una fase per volta.

Serve a una cosa sola: **rendere impossibile che il lavoro si perda fra una sessione e
l'altra.** È già successo — cinque fasi consegnate a luglio hanno lasciato fuori tre Card senza
che nessuno lo segnalasse, e nessuno se n'era accorto perché non esisteva un posto dove la
consegna era scritta prima di cominciare.

---

## 0. Le regole che valgono per ogni fase

Ogni fase, senza eccezioni:

1. **Si apre dichiarando il contratto** — sei righe, quelle qui sotto. Se la lista dei file non
   si riesce a scrivere prima di cominciare, la fase non è scoperta: si divide e lo si dice.
2. **Si chiude misurando**, mai affermando. Nessun `PASS` senza output prodotto **in quella
   sessione**. `[NON VERIFICATO]` è una risposta valida; un `PASS` inventato non lo è mai.
3. **Prima di rimuovere qualcosa, si prova che il sostituto funziona.** Non dopo.
4. **Ciò che non è stato fatto si scrive**, sempre, anche quando tutto il resto è andato bene.
5. **Una fase non ne apre un'altra.** Si ferma e si riferisce.

**Il contratto, nella forma già in uso:**

```text
OBIETTIVO   una frase — la singola cosa che questa fase rende vera
FILE        i file che cambieranno (un elenco, non "vari")
MISURA      cosa si misura PRIMA, e cosa deve risultare DOPO
VERIFICA    T0 / T1 / T2 / T3, e se installa
BUDGET      chiamate a strumenti attese
STOP        la condizione osservabile che chiude la fase
```

---

## Fase 1 · La prosa arriva al motore da tutte e due le shell

```text
OBIETTIVO   Scrivere una richiesta in prosa nel terminale produce un Piano, come già nel browser
FILE        tools/tui-client.mjs
            services/reference-control-plane/test/two-shells-parity.test.mjs
MISURA      PRIMA: nel terminale una richiesta senza file nominati non arriva al motore
            DOPO:  la stessa richiesta produce un runId, e i file li ha trovati il repository
VERIFICA    T1 + tools/acceptance/ce-021-two-shells.mjs
BUDGET      ~15 chiamate
STOP        La stessa frase, digitata nelle due shell, produce due Piani con gli stessi file
```

**Il difetto, già trovato e localizzato.** `tools/tui-client.mjs:180` rifiuta **lato client**,
senza chiamare il motore:

```js
if (!files.length) { console.log('No files named — nothing to plan. …'); return; }
```

Il motore ha superato quel messaggio (`workspace-actions.mjs:350`): `files` è opzionale e un
elenco vuoto è *«una richiesta di guardare, non una chiamata malformata»*. Il browser è stato
aggiornato, il terminale no.

**Va tolto anche l'interrogatorio.** `runPlanFlow` chiede `Goal:`, poi `File path:`, poi
`Contents of <file>:` da incollare a mano. Dopo questa fase il prompt manda la prosa e mostra i
candidati che il repository ha proposto. Un agente di programmazione legge il repository da sé.

**Il test che impedisce la ricaduta:** `two-shells-parity.test.mjs` deve fallire se una shell
accetta una forma di richiesta che l'altra rifiuta.

---

## Fase 2 · Il modello di vista, in un posto solo

```text
OBIETTIVO   Le due shell descrivono una sessione con lo STESSO oggetto, non con due modelli
FILE        tools/coden-view-model.mjs                          (nuovo, puro)
            tools/tui-fullscreen.mjs                            (importa invece di definire)
            apps/webui-static/app.js                            (importa invece di definire)
            services/reference-control-plane/test/coden-view-model.test.mjs   (nuovo)
MISURA      PRIMA: il modello {transcript, prompt, menu} esiste solo in tui-fullscreen.mjs:67
            DOPO:  un file solo lo definisce, e le due shell non ne costruiscono nessun altro
VERIFICA    T1
BUDGET      ~20 chiamate
STOP        Nessuna delle due shell contiene una struttura di trascrizione propria
```

**Cosa entra nel modulo:** la forma dello stato (`transcript` di voci `{kind, text, detail}`,
`prompt`, `menu`, riga di stato) **e** la mappa comando → chiamata al motore, che oggi vive in
`tui-fullscreen.mjs:26`.

**Cosa NON entra, e va detto perché.** `tools/tui-screen.mjs` **non si condivide**: produce righe
di caratteri clippate a una larghezza, e in un browser sarebbe buttare via il mezzo. Si condivide
**lo stato, non i pixel**. Il modulo è puro: niente ANSI, niente DOM, niente socket — così è
verificabile da solo e nessuna delle due shell può deviarlo senza rompere un test.

**Precedente da non ripetere:** `PANEL_NAMES` diceva 14 pannelli contro i 25 del markup, e
nessuno se n'era accorto perché *una lista confrontata solo con sé stessa è sempre d'accordo*.

---

## Fase 3 · La WebUI prende la forma del terminale, e `/` diventa l'unica porta

```text
OBIETTIVO   La destinazione CodeN Evolution nel browser È la TUI, resa in una pagina
FILE        apps/webui-static/index.html          (regione CodeN)
            apps/webui-static/app.js              (regione CodeN)
            apps/webui-static/agent-commands.js   (le voci nuove del menu)
            services/reference-control-plane/src/coden-address-book.mjs
            test/coden-shell-parity.test.mjs      (nuovo — CE-033, CE-034, CE-036)
MISURA      PRIMA: tutti e 25 gli indirizzi si aprono dal prompt — provato uno per uno
            DOPO:  4 regioni (stato, trascrizione, prompt, menu) e nessun pannello fisso
VERIFICA    T2 (browser e2e) — baseline attuale 240/249, da non peggiorare
BUDGET      ~45 chiamate — è la fase grossa, se sfora si divide in 3a/3b
STOP        Le due shell hanno le stesse regioni, le stesse voci di menu, gli stessi indirizzi
```

> ### 🛑 MISURATO IL 2026-08-05, PRIMA DI TOCCARE QUALCOSA — la fase poggiava su una premessa falsa
>
> Il passo 1 qui sotto ha fatto il suo lavoro al primo tentativo. **Il terminale rende 8 dei 25
> indirizzi. Diciassette non hanno una vista.**
>
> ```text
> banco   tests · terminal · preview · documentation · problems · closure · projects
>         recent · tasks · agents · tools · plugins · history · favourites      (14)
> agente  conversation · plan · activity                                         (3)
> ```
>
> Non è una dimenticanza del client: `ADDRESS_VIEWS` è una tabella di *cosa questo trasporto sa
> mostrare*, e un indirizzo assente **dichiara `UNAVAILABLE`** invece di stampare vuoto — che è
> onesto e già costruito.
>
> **Cosa questo cambia.** `16` §4b.3 diceva che i 25 pannelli «non si perdono, erano già
> indirizzi». È vero per la **navigazione** — ci si arriva — e falso per il **contenuto**: da
> terminale, diciassette dicono di non essere disponibili. Rimuovere il cruscotto del browser
> senza costruirli renderebbe `CE-034` falso di diciassette voci, e trasformerebbe una funzione
> che oggi esiste nel browser in una che non esiste da nessuna parte.
>
> **Quindi la fase 3 si divide, come previsto:**
>
> | | Cosa | Perché separata |
> |---|---|---|
> | **3a** | Le quattro regioni nel browser, e il menu `/`. **Il cruscotto resta.** | è forma, ed è reversibile |
> | **3b** | I 17 indirizzi mancanti ottengono un metodo e una vista | è **sostanza**, ed è la fase che nessuno aveva contato |
> | **3c** | Solo allora si rimuove il cruscotto | rimuovere è l'ultimo atto, mai il primo |
>
> ### ✅ 3a CHIUSA il 2026-08-05 — `D-0317`
>
> Le quattro regioni nel browser e il menu `/` a quattro gruppi (29 voci: 14 lavoro, 11
> applicazioni, 3 configurazione, 1 sessione), **una fonte sola**, filtrate per permesso in
> **entrambe** le shell. Il cruscotto è ancora in piedi, come previsto.
>
> **Due difetti trovati ESEGUENDO, non leggendo:** (1) il menu del terminale poteva mostrare
> **un solo gruppo** — `renderFrame` gli dà `h/3` righe e le quattordici voci di LAVORO le
> prendevano tutte, quindi APPLICAZIONI/CONFIGURA/SESSIONE non comparivano mai; ora il budget si
> divide fra i gruppi, la finestra segue la selezione e un gruppo troncato lo dichiara
> (`WORK 2 of 14`). (2) ogni shell si costruiva da sé l'oggetto `{permissions, role}`: trovato
> per mutazione, azzerarne uno rendeva quel menu non filtrato senza far fallire niente.
>
> **`/skills` NON è nel menu**, benché §4b.4 lo disegni: il prodotto non ha una superficie skill
> (misurato). Una voce che si apre sul nulla è ciò che la regola 3 vieta.
>
> **Verificato:** unit **1743/1744**, ESLint 322 0/0/0, **15 mutazioni → 15**, browser e2e
> **252/261** con l'insieme dei 9 fallimenti **identico** alla baseline pre-modifica (misurata
> in sessione con `git stash`), e la shell del terminale **guidata** con stream iniettati, 13/13.
>
> **Non fatto in 3a, dichiarato:** la barra degli indirizzi in alto resta (va con 3c, insieme al
> cruscotto che naviga); il terminale continua a non avere una vista per una destinazione — la
> nomina con l'etichetta della lista servita e dice di non averla, che è il lavoro di **3b**.

> ### ✅ 3b CHIUSA il 2026-08-05 — `D-0318`
>
> **La misura ha ridimensionato la fase.** I «17 senza vista» sono 17 senza *metodo*, ma sette
> rispondevano già onestamente (2 note di trasporto + 5 che servono il testo dichiarato dal
> pannello). **Dieci** dicevano «nessuna fonte su questo trasporto» — vera, ma non è una vista.
>
> ```text
> PRIMA   8 viste ·  2 note · 5 testi dichiarati · 10 «nessuna fonte»
> DOPO   16 viste ·  2 note · 7 testi dichiarati ·  0 «nessuna fonte»
> ```
>
> **UN metodo per i sette pannelli-elenco, non sette**: il browser li riempie tutti da una
> rotta sola (`/api/v1/ai/bootstrap`), e sette metodi sarebbero sette occasioni per le due
> shell di guardare istantanee diverse. Cap a sei **dichiarato** (`showing 2 of 9`), perché il
> browser affetta a sei: mostrarne sessanta sarebbe un disaccordo su cosa *sia* il pannello.
>
> **`closure` si registra anche dal terminale**, ed è la prima SCRITTURA che il socket acquista
> in questo programma: `closure.list`/`closure.record` sono due voci di policy separate perché
> le due rotte HTTP chiedono permessi diversi. `/closure` è un **form**: tre campi con una
> clausola di rifiuto obbligatoria non stanno su una riga di prompt. Un solo copione di domande,
> due rese — il browser apre il pannello che il form ce l'ha già, il terminale cammina i campi.
>
> **Tre difetti, due trovati eseguendo:** (1) una risposta **vuota** dentro un form veniva
> scartata e faceva slittare di un campo tutte le successive — una chiusura reale è uscita con
> il rischio dentro `notDone` e il comando successivo dentro `residualRisk`; (2) `plugins` e
> `favourites` dichiaravano il vuoto con la classe sbagliata, e «Nothing pinned yet.» prometteva
> una funzione inesistente; (3) una guardia **intermittente** nel browser e2e, riparata.
>
> **Verificato:** unit **1754/1755**, ESLint 322 0/0/0, **6 mutazioni → 6** (tre sopravvissute
> alla prima, ognuna ha prodotto un test vero), browser e2e **252/261** con i 9 fallimenti
> identici alla baseline, e la shell del terminale **guidata** attraverso tutto il form, 13/13.
>
> **3c ora è sbloccata:** niente nel browser raggiunge più un pannello che il terminale non
> raggiunge. Restano fuori il cruscotto e la barra degli indirizzi, che sono esattamente 3c.

> ### ✅ 3c CHIUSA il 2026-08-05 — `D-0319` (`9f2e831` + `0c1f93d`)
>
> **Il passo 1 ha rifatto il suo lavoro, e ha ridimensionato la fase una seconda volta.** Aprire
> i 25 indirizzi **dal prompt**, prima di toccare un file:
>
> ```text
> GESTO                                    BROWSER   PROMPT (ssh)   shell a riga (pipe)
> i 25 indirizzi CodeN, al prompt             0/25        0/25             25/25
> le 14 voci «destinazione», per nome        14/14        0/14               —
> i 25, dalla barra degli indirizzi          25/25    (non esiste)          —
> ```
>
> **Le viste di 3b stavano nella shell che quasi nessuno riceve.** `showAddress()` vive in
> `tui-client.mjs`, che apre la shell a riga **solo con stdin in pipe**; su un TTY vero — cioè
> via `ssh` — parte `runFullScreen`, il cui ramo `navigate` rispondeva con una promessa che
> nominava una fase già consegnata, per tutti e venticinque. Quindi la premessa su cui 3c era
> stata sbloccata era vera per una shell e **falsa per il prompt**.
>
> Perciò 3c si è divisa: **3c-1 il sostituto** (una tabella di viste sola, resa da entrambe le
> shell; il ranking degli indirizzi che esisteva in **due copie** unificato; `/` che risolve
> anche un indirizzo) e **3c-2 la rimozione** (cruscotto, doppia regione aperta, barra degli
> indirizzi su questa destinazione, breadcrumb). Il mouse conserva una strada: la `/` scritta
> nel suggerimento del prompt è diventata un comando — nulla di aggiunto allo schermo.
>
> **Tre difetti trovati ESEGUENDO**, uno più vecchio della fase: `$$(...)` diventato `$(...)`
> (`String.replace` tratta `$$` come un `$` letterale) — TypeError al boot che le unit non
> possono vedere, perché leggono `app.js` come testo; il prompt che navigava con
> `location.hash=` e **rifetchava la pagina** per una mossa interna (28 → 32 richieste); e
> **`CE-020` rosso da 3a** (`6bb7faf`), per due fasi, perché non sta in `npm test`: la quota
> «uguale per gruppo» dava **una voce per gruppo** e `/approve` non compariva.
>
> **Verificato:** unit **1760/1761**, ESLint 323 0/0/0, **CE-020 0 fail** (era rosso), CE-021 0
> fail, browser e2e **257/266** con i 9 identici alla baseline, **15 mutazioni → 15**.
>
> **Non fatto, dichiarato:** niente è deployato; la regione terminale del banco e la riga di
> stato a 12 campi restano (cablate) — la prima è ormai un secondo prompt sulla stessa pagina,
> ed è la proposta di miglioramento registrata.

> **3b non è lavoro di interfaccia.** Alcuni di quei diciassette non hanno un metodo sul
> protocollo, non solo una vista: sono voci nuove in `SESSION_METHOD_POLICY`, con il loro
> permesso e il loro gate. Va dimensionata come fase a sé, non nascosta dentro un cambio di
> grafica — che è esattamente il modo in cui le Card C e D sono sparite a luglio.

**L'ordine dentro la fase non è negoziabile:**

1. **Prima si misura** che tutti e 25 gli indirizzi si aprano dal prompt. L'address book ne
   dichiara 25 e il markup ne dichiara 25, ma la prova è **aprirli**. Se due o tre erano
   raggiungibili solo come riquadro, si scopre adesso e non dopo aver tolto i riquadri.
2. Poi si costruiscono le quattro regioni.
3. Poi si rimuove il cruscotto.
4. Il menu `/` assorbe applicazioni, configurazione e sessione (`16` §4b.4), e **la barra degli
   indirizzi in alto sparisce**: un terminale non ha una barra degli indirizzi, e tenerla
   rimetterebbe due gesti per la stessa cosa.

**Scope, dichiarato per non allargarsi:** cambia **la destinazione CodeN Evolution**. Chat resta
Chat, Impostazioni restano Impostazioni, Memoria e Ricerca restano quelle. `app.js` è 3910 righe
ma sono tutte e tredici le destinazioni.

---

## Fase 4 · Il proiettore di contesto (invenzione I)

```text
OBIETTIVO   Ogni chiamata al modello riceve una vista ricostruita da stato, mai una trascrizione
FILE        services/reference-control-plane/src/context-projector.mjs   (nuovo)
            services/reference-control-plane/src/ai-workspace/context-graph.mjs
            test/context-projection.test.mjs                             (nuovo — CE-004, CE-005)
MISURA      PRIMA: la forma e la taglia del contesto alla chiamata 3 e alla chiamata 300
            DOPO:  sono la stessa forma, e la taglia non cresce con il numero di chiamate
VERIFICA    T1 + un compito lungo reale
BUDGET      ~40 chiamate
STOP        Un test rifiuta una scrittura fuori schema, e la misura a n>300 è registrata
```

> ### ✅ FASE 4 CHIUSA il 2026-08-05 — `D-0320`
>
> **La misura, fatta prima di toccare un file, sul vero `ContextGraph` e sul vero store:**
>
> ```text
> chiamata      PRIMA (trascrizione)          DOPO (proiezione)
>       3        8 voci ·  1 044 B                581 B
>      25       52 voci ·  7 237 B              1 152 B
>     300      602 voci · 85 190 B              1 197 B
>     400      802 voci · 113 590 B             1 197 B      ← identico a 300
> ```
>
> **×81,6 prima, −98,6 % dopo**, e il tetto (15 198 B) è **derivato dallo schema**, non scritto
> in un test: non può allontanarsi dalle sezioni che descrive.
>
> **Detto con precisione, perché la versione onesta è più stretta dello slogan.** La forma
> *non* è identica fra la chiamata 3 e la 300: alla 3 la sessione ha tre passi di piano, e la
> vista ne mostra tre. È identica **dalla chiamata 25**, cioè da quando i tetti sono raggiunti,
> e a ogni chiamata è identico l'insieme ordinato delle sezioni. La crescita fra 3 e 25 è lo
> stato che **si riempie fino ai suoi tetti** — finita e limitata — non un accumulo.
>
> **Nove sezioni**, esattamente quelle che l'invenzione I nomina, più «tentativi» e «segnali del
> repository» (dove atterra l'invenzione II alla fase 7: accetta un segnale con un `level` e non
> ha campi numerici, quindi nessuna porta di servizio per il punteggio). **Nessun `append`,
> nessun `note`, nessun campo di prosa.** Una stringa oltre il massimo si **rifiuta**, non si
> taglia: tagliare nasconderebbe per sempre a chi scrive che non l'ha detto nei termini dello
> schema.
>
> **Tre difetti, tutti trovati misurando o eseguendo:** (1) validare in lettura *lanciando*
> significava che **una sola riga fuori schema bloccava ogni chiamata al modello di quella
> sessione, per sempre** — ora la riga si esclude, si **conta** e la vista lo dichiara; (2) la
> finestra ordinava le domande bloccanti in testa e poi prendeva la coda, cioè le ordinava per
> buttarle via — selezione e presentazione ora sono due passi; (3) per **mutazione**, il tetto
> allentato di uno sopravviveva, perché nessun test teneva esattamente `show + 1` voci.
>
> **Verificato:** unit **1776/1777** (era 1760/1761), ESLint **326** 0/0/0, `verify-source`
> PASS, **11 mutazioni → 11** da baseline verificata verde prima.
>
> **Non fatto, dichiarato:** **nessuna chiamata al modello passa ancora dal proiettore, su
> nessuna delle due shell** — `chat-orchestrator.mjs` consegna ancora l'intero ramo, e il
> terminale non rende nessuna proiezione. È voluto: sostituire ciò che una shell manda al
> modello è una **rimozione**, e la regola 3 dice che il sostituto si prova prima. Il sostituto
> ora esiste ed è misurato; il suo primo consumatore è la **fase 5**, che è l'ordine che `16` §5
> sostiene. Il motore non scrive ancora nessuna sezione: piano, diff e token stanno in `#runs`
> di `workspace-actions.mjs`, che è la lista file della fase 5. Niente è deployato.

**Perché prima dell'Autore.** `15` §14 lo chiama il rischio numero 1: *«se lo stato e il
proiettore non sono i primi, ogni componente scritto prima va rifatto»*. L'Autore è il primo
componente che paga davvero quell'assenza, perché chiama il modello **ripetutamente sullo stesso
compito** — cioè il caso in cui il contesto che cresce diventa il difetto misurato: *dopo 25-30
chiamate la coerenza si rompe anche con 200K di contesto*.

**Regola vincolante:** nessun componente può appendere testo libero. Chi vuole influenzare il
modello **scrive nello stato**, e lo stato ha uno schema.

---

## Fase 5 · L'Autore

```text
OBIETTIVO   Il prodotto scrive lui il cambiamento, e l'Owner promuove un risultato misurato
FILE        services/reference-control-plane/src/author.mjs      (nuovo)
            services/reference-control-plane/src/workspace-actions.mjs
            test/author.test.mjs                                 (nuovo — CE-025…CE-030)
MISURA      PRIMA: workspace-actions.mjs:537 scrive i contenuti passati dal chiamante
            DOPO:  una richiesta in prosa produce contenuti che nessuno ha incollato
VERIFICA    T1, poi T2, poi T3
BUDGET      ~50 chiamate — se sfora si divide, non si tira dritto
STOP        Una frase in prosa diventa un diff reale, provato in ombra, che l'Owner promuove
```

> ### ✅ FASE 5a CHIUSA il 2026-08-05 — `D-0321`. **5b resta aperta, e il motivo è misurato.**
>
> **La fase si divide prima di toccare un file**, come la regola impone: **ATOM non ha una
> superficie di autoratura.** `/v1/imagine` compare nel sorgente di ATOM **una volta sola, in un
> test che asserisce `404`**. Quindi «qualsiasi modello → ATOM controlla e rigenera → la
> risposta» non è costruibile senza cambiare un secondo repository — decisione dell'Owner, non
> effetto collaterale di questa fase. **5a = l'Autore. 5b = la metà ATOM.**
>
> **La misura di apertura**, sul vero workspace e sul vero orchestratore, con una richiesta in
> prosa che **non nomina nessun file**:
>
> ```text
> PRIMA   grounding trova 3 file · il piano porta i PERCORSI · "contents" non compare
>         approve() → performed 3 · src/login.js  85205e13… → 85205e13…  INVARIATO
>
> DOPO    (modello vivo, Qwen2.5-Coder 7B) autorati 3 · invariati 0 · rifiutati 0
>         percorsi scartati 0 · novità novel · 4,1 s
>         src/login.js  85205e13… → 08784ada…   CAMBIATO   (e le altre due anche)
>         ledger: 1 evento di autoratura con 3 fixture rigiocabili
> ```
>
> **3 file su 3 portano byte che nessuno ha incollato**, e `src/login.js` torna col limitatore
> importato, configurato e attaccato alla rotta.
>
> **La regola che decide il disegno è la 1: l'Autore non nomina mai un percorso.** Gli si chiede
> **un file per volta** e la sua risposta è il corpo *di quel file* — non esiste un ramo di
> codice che estragga un percorso dall'uscita del modello, quindi non c'è niente con cui
> allargare l'insieme chiuso. Una direttiva di percorso dentro il blocco si toglie, si **conta**
> e finisce **sulla risposta della run**.
>
> **Il blocco recintato è obbligatorio**: senza, non si distingue un file da un paragrafo su un
> file, e indovinare significherebbe scrivere la prosa del modello nel repository dell'operatore
> la prima volta che diventa chiacchierone. `NO_FENCE`, `MANY_FENCES`, `EMPTY` sono rifiuti con
> un nome — l'ultimo perché un file vuoto è **una cancellazione chiesta come scrittura**.
>
> **Un difetto trovato ESEGUENDO:** registravo l'autoratura prima che la run avesse una radice, e
> il ledger rifiutava il piano come `SECOND_ROOT`. **Il ledger aveva ragione e l'ordine no**:
> l'autoratura *accade* prima (i byte devono esistere prima che si chieda di approvarli) ma il
> piano è ciò che la run **è**, quindi l'autoratura gli discende. Un test asserisce la causazione.
>
> **Verificato:** unit **1791/1792**, ESLint **330** 0/0/0, **11 mutazioni → 11**, più una
> autoratura reale contro il modello vivo. **Dichiarato e non nascosto:** una singola esecuzione
> della suite ha riportato **2 rotture** che l'output catturato non nominava; **tre esecuzioni
> successive sono verdi** e non si sono riprodotte — registrato come *osservato una volta e non
> attribuito*, perché «è passato la seconda volta» non è una diagnosi.
>
> **Non fatto in 5a, dichiarato:** ATOM non è nella catena (è 5b); il profilo di divergenza è
> **accettato ma non fornito** — `buildAuthoringPrompt` prende i quattro segnali col loro livello
> e un test prova che non diventano mai un punteggio, ma nessuno chiama ancora
> `divergence-profile.mjs`, che è la **fase 7** e questo ne è il punto d'atterraggio; l'ombra non
> esegue ancora i test **prima** della promozione (`16` §3.3 vuole lo stadio 11 prima del 13 — i
> byte ora esistono abbastanza presto perché sia possibile); **nessuna delle due shell** rende
> ancora il verdetto di autoratura, ed è sulla risposta. Niente è deployato.

**La catena:** qualsiasi modello sotto → **ATOM** controlla e rigenera → la risposta. Su tutte e
tre le superfici.

**I sette vincoli sono in `16` §3.2 e non si rinegoziano qui.** I due che si sbagliano più
facilmente:

- **L'Autore non nomina mai un percorso.** Riceve un insieme chiuso dal Piano. Un percorso nella
  sua uscita si **scarta e si registra**, non si normalizza.
- **La sua uscita non tocca il repository vero.** Va in ombra, i test girano, e **solo dopo**
  c'è il dialogo di promozione. `CE-008` esiste apposta.

---

## Fase 6 · Se ATOM cade, il prodotto continua — e lo dice

```text
OBIETTIVO   ATOM irraggiungibile non ferma il lavoro, e il degrado è visibile
FILE        services/reference-control-plane/src/reasoning-router.mjs
            services/reference-control-plane/src/session-proof.mjs
            apps/webui-static/coden-view-model.js         (la riga di stato lo mostra)
            test/atom-fallback-declared.test.mjs          (nuovo)
MISURA      PRIMA: atomd fermo ⇒ 503 reasoning_unavailable ⇒ la sessione si ferma
            DOPO:  atomd fermo ⇒ risponde il riferimento, provenienza `reference` + ragione + ora
VERIFICA    T1 con atomd fermato davvero, non simulato
BUDGET      ~25 chiamate
STOP        Con atomd fermo si porta a termine un compito, e la Prova di Sessione dice come
```

**La regola scritta nel router non si butta**, si legge bene: *«non deve mai ripiegare **in
silenzio**»*. La parola che porta il peso è **in silenzio**. Si ripiega, e lo si dichiara.

**Un lavoro cominciato con ATOM non si conclude senza:** se cade a metà, il passo in corso si
ferma con un checkpoint riprendibile, invece di produrre metà ragionamento di una qualità e metà
di un'altra.

---

## Fase 7 · Il profilo di divergenza collegato

```text
OBIETTIVO   Il profilo si vede accanto al diff, e l'Autore lo riceve prima di scrivere
FILE        services/reference-control-plane/src/session-protocol.mjs   (voce di policy)
            services/reference-control-plane/src/server.mjs             (rotta gemella)
            services/reference-control-plane/src/author.mjs             (lo consuma)
            tools/coden-view-model.mjs                                   (lo mostra)
MISURA      PRIMA: divergence-profile.mjs non è importato da nessun file
            DOPO:  due repository con convenzioni opposte producono profili opposti, e si vedono
VERIFICA    T1
BUDGET      ~20 chiamate
STOP        Il profilo compare accanto al diff nelle due shell, come 4 segnali con il loro livello
```

**Vincolo che un test già impone:** sulla WebUI va reso come i **quattro segnali con il loro
`level`**, **mai** come un numero. Il modulo rifiuta di produrne uno.

---

## Fase 8 · `coden_evolution` — l'accesso in una parola

```text
OBIETTIVO   ssh dalla rete, si scrive coden_evolution, parte la sessione
FILE        tools/coden-evolution                        (nuovo, avviatore portabile)
            MASTER_PROJECT/08_INSTALLAZIONE.md           (la ricetta, per famiglia di OS)
            oci/Dockerfile                               (l'avviatore va spedito)
            test/launcher-portability.test.mjs           (nuovo — CE-031, CE-032, CE-035)
MISURA      PRIMA: serve essere amministratore, sapere il container e il percorso del client
            DOPO:  un utente normale scrive una parola
VERIFICA    T1 + prova reale da una seconda macchina della rete
BUDGET      ~25 chiamate
STOP        Da un'altra macchina: ssh, `coden_evolution`, accesso, e si lavora
```

**Il confine che non si attraversa.** Il **prodotto** fornisce l'avviatore, portabile, che non
presume sistema operativo né motore di contenitori. L'**installazione** fornisce la ricetta per
l'utente di sistema. Il prodotto **non modifica mai** la configurazione dell'host: non è una
scelta da sottoporre, è fuori dal progetto (legge di piattaforma).

**Tre trappole già registrate** (`16` §4.3): il socket non si pubblica sull'host; l'utente
dedicato non entra nel gruppo che controlla i contenitori; su alcuni sistemi la configurazione
del demone non sopravvive al riavvio.

---

## Come si misura che il piano sta funzionando

Dopo ogni fase, tre righe e nient'altro:

```text
FATTO        cosa è vero adesso che prima non lo era, con la misura
NON FATTO    cosa era in questa fase e non è stato consegnato, e perché
PROSSIMA     la fase successiva, e la prima cosa da misurare quando si apre
```

**Il criterio finale, che chiude il programma** — è quello di `09_PIANO.md` §3 con la clausola
che mancava:

> Apre un repository vero, ne capisce la struttura, riceve una richiesta, produce un piano,
> **scrive lui il cambiamento**, ottiene un'autorizzazione su un risultato già misurato in ombra,
> cambia diversi file, mostra il diff, esegue i test, corregge un errore, produce un risultato
> verificabile, ripristina lo stato precedente su richiesta, registra ogni operazione — e **non
> esce mai nemmeno una volta dall'autorità che gli è stata data**.

Quando quella frase è vera **dalle due shell**, con `ssh` e sull'host, il programma è finito.
