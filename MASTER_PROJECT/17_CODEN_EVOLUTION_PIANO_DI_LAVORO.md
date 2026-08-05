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
            tools/coden-view-model.mjs                    (la riga di stato lo mostra)
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
