# 15 · CodeN Evolution — il progetto, da zero

**Deciso dall'Owner il 2026-07-26.** Questo documento non descrive un assistente di
programmazione: descrive **come si lavora**. Le funzioni che deve avere sono già state fissate
dall'Owner in un elenco di 38 sezioni, e restano vincolanti. Qui c'è il **meccanismo** che le
rende sicure, veloci e costruibili — e che le rende *originali*, perché il meccanismo è ciò che
nessun altro ha.

Precede questo documento e resta valido: `06_CODEN_EVOLUTION.md` (il ciclo, le due shell),
`04_SICUREZZA_E_AUTORIZZAZIONI.md` (i token), `13_IL_VERIFICATORE.md` (il ricalcolo),
`14_MEMORIA_A_CUBI.md` (i quattro cubi). Questo documento li **cuce** e aggiunge ciò che
mancava: le sei invenzioni, la matrice di accettazione, e l'ordine.

**CodeN Evolution è un prodotto nuovo.** Non eredita nome, codice, architettura o convenzioni
da nessun altro sistema, di questo host o di altri.

---

## 1. La regola sola

> **Il motore non cambia nulla se non eseguendo un Piano autorizzato.**

Il modello **non ha superficie d'azione**. L'esecutore **non ha superficie di proposta**. Fra i
due c'è un solo oggetto — il Piano — e una sola grammatica — il capability token.

Tutto il resto di questo documento è la conseguenza di quella riga. Quando una decisione è
dubbia, si risolve chiedendo quale delle due opzioni la rende *più vera*.

---

## 2. Le tre malattie, misurate

Non opinioni: numeri pubblicati, raccolti il 2026-07-26. Sono il motivo per cui il progetto
esiste nella forma che ha.

| Misura | Fonte |
|---|---|
| Le decisioni di merge dei manutentori stanno **24 punti percentuali sotto** il punteggio SWE-bench, su 296 PR generate da agenti riviste da 4 manutentori reali | METR, 2026-03-10 |
| **Verificare è diventato più difficile che generare** — l'asimmetria classica si è invertita. Crisi di adeguatezza dell'oracolo, divario di *organicità* fra patch funzionante e patch accettata | *The Verification Horizon*, arXiv 2606.26300 |
| **84% di adozione, 29% di fiducia** | Trust Deficit 2026 |
| L'attribuzione del fallimento passo-per-passo è accurata al **14–53%**: gli harness di produzione non hanno tracce strutturate per un debug di principio | *Beyond the Leaderboard*, arXiv 2607.05775 |
| Quasi 100% di successo sotto i 4 minuti-uomo, **meno del 10% oltre le 4 ore**. Raddoppiare la durata **quadruplica** il fallimento. Dopo **25–30 chiamate a strumenti** la coerenza si rompe anche con 200K di contesto | Long-horizon survey; *Self-Compacting Agents*, arXiv 2606.23525 |
| Gli schemi degli strumenti MCP consumano fino al **72%** della finestra di contesto **prima** che il lavoro cominci | MCP Context Overload; *MCP-Zero*, arXiv 2506.01056 |
| **"Fallimento della decomposizione della fiducia"**: pianificatore stocastico plasmato da contenuto non fidato, accoppiato a esecutore deterministico ad alti privilegi, senza mediazione di capacità, verifica di provenienza né isolamento | *Trust but Verify*, arXiv 2607.12428 |
| **38%** delle PR agentiche rifiutate per **abbandono del revisore**; PR unite senza alcuna revisione **+31,3%** | arXiv 2605.22534 |
| Il **67,6%** dei segreti realmente trapelati in flussi con agenti lo introduce **l'umano**, e **l'81,1%** non è rilevato prima dell'integrazione | arXiv 2607.12428 |
| Gli agenti **non hanno meccanismi** per mantenere fedeltà al piano, accorgersi di averlo abbandonato, o recuperare | *Plan Compliance*, arXiv 2604.12147 |
| Il test metamorfico rileva il **75%** dei programmi errati con **8,6%** di falsi positivi — ed è quasi inutilizzato | arXiv 2406.06864 |
| Lo **scaffold** intorno al modello sposta il punteggio di **10–20 punti a modello invariato** | SWE-bench vs scaffolding, 2026-06 |

**L'ultima riga decide la strategia.** Se lo scaffold vale 10–20 punti a modello invariato,
allora **il prodotto è lo scaffold**. Non serve un modello più grande: serve un modo di lavorare
migliore. È anche la ragione per cui la crescita del prodotto passa dal **numero di esperti
verificati**, non dalla taglia di un blocco unico.

Sotto quei numeri ci sono tre malattie distinte:

- **A · L'oracolo.** Nessuno sa dire se il risultato è giusto. 24 punti fra "passa" e "si unisce".
- **B · La persistenza.** L'agente non fallisce nello scrivere codice: fallisce nel **restare lo
  stesso agente** nel tempo.
- **C · La decomposizione della fiducia.** Pianificatore probabilistico attaccato a esecutore
  privilegiato, senza niente in mezzo.

Su **C** la risposta è la regola sola (§1) e i capability token. È corretta ma **non è
originale**: la sicurezza a capacità esiste dagli anni '70, e va costruita perché è giusta, non
perché è nuova. **L'originalità sta su A, su B e sulla memoria.**

---

## 3. Le sei invenzioni

### I · Il contesto è una proiezione, non un accumulo

**Il difetto di tutti.** Si costruisce una trascrizione che cresce, e quando è troppo grande la
si **riassume**. Il riassunto è esso stesso il vettore di corruzione: da lì il context rot, il
crollo dopo 25–30 chiamate, l'attribuzione al 14–53%, e il lavoro già fatto che si rifà.

**L'invenzione.** *CodeN Evolution non ha una trascrizione.* Lo stato è un oggetto strutturato —
Piano, evidenze, domande aperte, diff corrente, firme di fallimento, token attivi. **Ogni
chiamata al modello riceve una vista ricostruita da zero** da quello stato, resa in modo
deterministico e limitata per costruzione.

Conseguenze, e nessuna è estetica:

- **Il context rot diventa strutturalmente impossibile.** Non si comprime niente perché non si
  accumula niente. Il contesto alla chiamata 300 ha la stessa forma della chiamata 3.
- **L'attribuzione diventa esatta.** Ogni chiamata ha un input *derivato da stato nominato*: si
  riesegue **quella singola decisione**, isolata, contro un modello diverso o una policy nuova.
- **È veloce e costa poco.** I contesti restano piccoli per costruzione.
- **"Rifà il lavoro già fatto" sparisce**: il lavoro fatto è *stato*, non una frase in fondo a
  una trascrizione da ricordare.
- **La fedeltà al piano diventa misurabile in continuo**, non a posteriori: la vista contiene il
  passo corrente, quindi deviare richiede di contraddire un dato, non di dimenticarlo.

**Regola vincolante:** nessun componente può appendere testo libero al contesto. Chi vuole
influenzare il modello **scrive nello stato**, e lo stato ha uno schema.

### II · Il repository è l'oracolo

**Il difetto di tutti.** I test dicono *funziona*. Il manutentore dice *non è come si fa qui*.
Sono i 24 punti di METR, e nessuno li chiude perché "come si fa qui" sembra soggettivo.

**L'invenzione.** Non è soggettivo: **è già scritto nel repository.** La sua storia git è un
corpus di migliaia di modifiche *che qualcuno ha accettato*. Da lì si **ricalcolano** — non si
giudicano — le invarianti che valgono su tutte:

- il **grafo di co-modifica**: quali file cambiano sempre insieme, con che frequenza
- il rapporto **test-per-modifica** che questo progetto tiene davvero
- dove vivono gli errori, come si nominano le cose, quale strato importa quale
- taglia e forma tipiche di un cambiamento accettato qui
- chi ha proprietà su cosa, e cosa è stato modificato di recente

Il diff candidato non riceve un punteggio: riceve un **profilo di divergenza**.

```text
DIVERGENZA DAL REPOSITORY
  ambito      7 file su 3 strati · qui i cambiamenti accettati ne toccano 2 su 1   ▲ alto
  co-modifica auth.rs cambia con session_test.rs nell'89% dei casi — qui no        ▲ alto
  test        0 test aggiunti · rapporto storico di questo repo: 0,8 per modifica  ▲ medio
  errori      usa `panic!` · questo strato usa `Result` nel 97% dei casi           ▲ medio
  taglia      +112/−38 · mediana accettata qui: +40/−15                            ● nella norma
```

**Perché è nuovo.** Gli altri ti fanno *scrivere a mano* le convenzioni in un file di regole,
che è stale il giorno dopo ed è sempre incompleto. Qui sono **indotte, misurate, datate e
mostrate perché tu le confermi**. Il repository specifica sé stesso, e le convenzioni invecchiano
insieme al codice invece che insieme alla documentazione.

Le invarianti indotte vivono nel cubo **Esperienza** (§6): un solo controesempio le ribalta.

### III · Si autorizza un risultato, non un'intenzione

**Il difetto di tutti.** Il dialogo è *"sto per fare X, mi autorizzi?"*. Stai valutando una
**promessa**, senza elementi per decidere. È così che il consenso diventa un riflesso e la
sicurezza diventa teatro.

**L'invenzione.** L'esecuzione in ombra viene **prima** dell'autorizzazione. Copia
copy-on-write, il lavoro si fa davvero, i test girano davvero, la sandbox è vera. Poi la domanda
cambia natura:

```text
NELLA COPIA È SUCCESSO QUESTO
  4 file · +112/−38
  61 test passati · 1 fallito → tests/session.rs:214 "expired token accepted"
  divergenza: ▲ alto (co-modifica) · ▲ medio (test)
  copertura di proiezione: 6 affermazioni su 9 ricalcolate · 3 no, ed ecco quali
  rollback: checkpoint ck-4471 · ripristino misurato in 0,3 s

  [Promuovi]  [Promuovi solo 2 file]  [Scarta]  [Mostra l'evidenza]
```

Non *"ti fidi?"* ma *"**questo è il risultato misurato: lo promuovi?**"*. L'autorizzazione
diventa **promozione**, il buio sparisce, e il costo di un errore crolla perché l'errore è già
successo dove non fa danno.

**Costo dichiarato:** si esegue due volte. È il prezzo per non autorizzare mai al buio, e
l'Owner l'ha accettato esplicitamente.

### IV · Il verificatore per ricalcolo, con la copertura dichiarata

**Il difetto di tutti.** L'oracolo è il test unitario, e basta. È debole, e i 24 punti lo
dimostrano.

**L'invenzione, in tre strati** — il terzo è la parte onesta che manca ovunque:

1. **Scomposizione fino al ricalcolo.** Un passo si scompone finché verificarlo non è più
   *giudicare* ma *ricalcolare*. Se un passo non ha una proiezione ricalcolabile, **non è un
   passo**: si scompone ancora. È lo stadio 8 del ciclo, ed è dove ATOM è più forte.
2. **Relazioni metamorfiche e proprietà generate dal codice**, non dal prompt — 75% di
   rilevamento con 8,6% di falsi positivi, e quasi nessuno le usa. Prendono ciò che `pass@k` non
   vede.
3. **La copertura di proiezione, dichiarata.** Quale frazione delle affermazioni del cambiamento
   è stata davvero ricalcolata, **e quali no, con la ragione**.

> Un rapporto che dice *"verificato 6 su 9; le 3 non verificate sono queste, per questa ragione"*
> è **più utile di un ✅**, perché indirizza la revisione umana esattamente dove serve.

**Regola vincolante:** la copertura di proiezione non può mai essere assente né arrotondata a
"completa". Un'affermazione non misurata è dichiarata non misurata.

### V · A riposo, il programma non ha strumenti

**Il difetto di tutti.** Gli schemi degli strumenti consumano fino al 72% del contesto prima che
il lavoro cominci, e la cecità sulla verifica dei pacchetti è il vettore d'attacco in crescita
del 2026.

**L'invenzione.** Non è "caricamento su richiesta": è che **la superficie degli strumenti è
derivata dal Piano**.

- **A riposo: zero strumenti, zero skill, zero plugin, zero connettori.** Esiste un *catalogo
  ricercabile*, che non è un carico.
- Un passo del Piano **dichiara l'effetto** che gli serve. Da quella dichiarazione si cerca lo
  strumento, non prima.
- **Installarlo è a sua volta un passo del Piano**, con la sua autorizzazione, la sua provenienza
  verificata (firma, checksum) e il suo checkpoint.
- Il token si conia **contro gli effetti dichiarati** dallo strumento. **Un effetto non
  dichiarato non è vietato: è impossibile.**
- **Nessuna denylist testuale.** Una denylist di stringhe è battuta da qualunque indirezione, e
  spacciarla per protezione è peggio che non averla.
- Alla chiusura del compito lo strumento **si disinstalla**, salvo promozione esplicita a
  permanente.

Risultato: contesto quasi vuoto, catalogo illimitato, catena di fornitura chiusa **per
costruzione** invece che per scansione.

### VI · ATOM entra dal contratto, e il prodotto ne misura il valore

**Deciso dall'Owner: ATOM deve funzionare dentro CodeN Evolution.** Il modo:

- ATOM è **un'implementazione di `ReasoningProvider`**, non un ramo dentro il motore. Il motore
  chiama `decompose`, `expect`, `classify`; non sa che ATOM esiste.
- **Selezionabile per superficie**, non tutto-o-niente: ATOM su `decompose` ed `expect` dove il
  ricalcolo è tutto, il provider di riferimento altrove.
- **Vincolo permanente** (`CLAUDE10.md` regola 54, `FOSS_CORE_DEPENDS_ON_ATOM = false`): il
  criterio di "fatto" si misura **anche senza ATOM**. ATOM lo rende *migliore*, mai *possibile*.
  Non è un freno ad ATOM: è ciò che impedisce al nucleo pubblico di essere una demo.
- **E la parte nuova:** non serve *credere* che ATOM funzioni. La **copertura di proiezione lo
  misura a ogni compito**. Se ATOM porta la copertura da 6/9 a 9/9, quel numero è visibile,
  compito per compito. È un componente proprietario il cui valore è dichiarato dal prodotto
  stesso invece che da un benchmark.

---

## 4. Gli oggetti

Sei, e non di più. Tutto il resto è una vista su questi.

**Piano** — immutabile una volta firmato. Obiettivo, non-obiettivi, criteri di successo,
assunzioni dichiarate, passi ordinati, raggio d'azione, esito atteso. Un Piano modificato è un
Piano **nuovo**, con il precedente conservato: la storia non si riscrive.

**Passo** — verbo, bersaglio, effetti dichiarati, **proiezione ricalcolabile** (se manca, non è
un passo), rischio classificato, dipendenze, compensazione.

**Token** — l'unica grammatica dell'azione. Contiene:

```text
cosa        verbo + effetti dichiarati (mai una stringa di comando)
dove        percorsi canonicalizzati, risolti dai symlink, ancorati al workspace
quanto      tetti: file, byte, durata, CPU, memoria, token del modello, costo, domini di rete
fino a      scadenza assoluta
quante      contatore di spesa — un token si SPENDE, non si "verifica"
ritorno     id del checkpoint che lo annulla
origine     piano + passo + autorizzazione che l'ha coniato
```

Spendere **decrementa**. Un token esaurito è morto. Non esiste un percorso in cui l'esecutore
agisce senza spenderne uno.

**Checkpoint** — snapshot dei file, stato git, Piano, comandi eseguiti, output rilevante,
versioni delle dipendenze, configurazione della sessione. Creato **prima** di ogni passo
mutativo, senza eccezioni.

**Evento** — append-only, con correlazione, causazione e digest concatenato. È la base della
**Prova di Sessione**: il replay è **al livello delle decisioni**, non dei token del modello,
perché i modelli non sono deterministici e le decisioni sì.

**Proiezione** — un'affermazione del cambiamento più il ricalcolo che la conferma o la smentisce.
È l'unità della verifica ed è ciò che si conta nella copertura.

---

## 5. Il ciclo, e dove ATOM si innesta

I sedici stadi restano quelli di `06_CODEN_EVOLUTION.md` §2. Qui si fissa il punto d'innesto e
l'ordine che l'invenzione III impone:

```text
 1 Ricezione        4 Ricognizione      7 Piano        [ATOM]   10 Attesa          [ATOM]
 2 Interpretazione  5 Recupero          8 Decomposiz.  [ATOM]   11 Simulazione     [ATOM opz.]
   [ATOM]           6 Ipotesi  [ATOM]   9 Raggio               12 Classificazione [ATOM]

              ── 11 e 12 PRECEDONO 13: si autorizza un risultato misurato ──

13 Autorizzazione   14 Esecuzione       15 Verifica              16 Chiusura
   promozione          token spesi         mirata → allargata       diff, evidenza, rischio
   delimitata          passo per passo     → suite intera           residuo, e la casella
   a scadenza          annullabile         + proiezioni             NON FATTO obbligatoria
   revocabile
```

**Lo stadio 3 (Chiarimento) è quello che tutti saltano**, ed è il più economico: un'ambiguità
irrisolta produce lavoro sicuro di sé puntato sul bersaglio sbagliato.

**Lo stadio 16 ha una casella `NON FATTO` che non può essere vuota senza dirlo.** Un rapporto
che elenca solo i successi insegna a fidarsi in modo uniforme, che è l'opposto di utile.

**Budget sulla novità, non sullo sforzo:** un approccio ripetuto non conta come tentativo. È
l'unico controllo che funziona sui modelli piccoli, che non falliscono fermandosi ma
**ripetendosi con sicurezza**.

---

## 6. La memoria — è ciò che cambia il modo di lavorare

**Dichiarato vitale dall'Owner, e lo è per una ragione strutturale:** l'invenzione I dice che il
contesto è una proiezione; **la memoria è ciò da cui la proiezione attinge.** Non è un accessorio
di recupero appiccicato di lato — *è lo stato che viene reso a ogni chiamata al modello*. Qualità
della memoria = qualità del contesto = qualità del lavoro. Sono la stessa cosa.

**Quattro cubi, per stato epistemico** (`14_MEMORIA_A_CUBI.md`, `D-0102`). Il criterio conta più
del numero: *due cose stanno in cubi diversi quando «come faccio a sapere che è vero» ha risposte
di tipo diverso.*

| Cubo | Cosa contiene | Come si sa che è vero | Chi lo ribalta |
|---|---|---|---|
| **Biblioteca** | asserito | qualcuno l'ha affermato e la fonte è tracciata | una correzione esplicita |
| **Officina** | in attesa | non lo si sa ancora — è lavoro in corso | la promozione o lo scarto |
| **Corpus** | fonte | è il testo originale, con provenienza | nulla: è ciò che è |
| **Esperienza** | indotto | è stato osservato *n* volte in questo repository | **un solo controesempio** |

**Regole vincolanti:**

- **Il record è la memoria, il vettore è un indice usa e getta** (`D-0101`). Un vettore ha senso
  solo nello spazio del modello che l'ha prodotto: «qualsiasi modello, memoria sempre presente»
  si ottiene rendendo il vettore **ricalcolabile**, non conservandolo. Ogni vettore registra il
  modello che l'ha generato — senza, confrontare due spazi diversi restituisce un numero invece
  di un errore (`D-0103`).
- **PostgreSQL è autoritativo** (`D-0104`). L'isolamento a livello di riga è ciò che rende i muri
  fra le semantiche **applicabili** invece che rispettati per buona condotta.
- **Ogni fatto indotto porta con sé cosa lo ha indotto, quante volte ha tenuto, e cosa lo
  smentirebbe.** Una memoria non falsificabile è superstizione, non conoscenza.
- **I dati di lavoro non escono mai** e non entrano mai nella semantica del prodotto. Valvola a
  senso unico, applicata dallo schema.

**Cosa ci finisce dentro, e perché cambia il lavoro.** Oggi ogni agente riparte **freddo** sullo
stesso repository, ogni volta: il secondo compito costa quanto il primo. Qui il cubo Esperienza
accumula il grafo di co-modifica, le convenzioni indotte dalla storia git, le firme di fallimento
normalizzate, i comandi che in questo progetto funzionano davvero.

> Il sistema non diventa migliore *a programmare*. Diventa migliore **su questo progetto** — e il
> miglioramento è ispezionabile riga per riga, invece che sepolto dentro un prompt.

**Normalizzazione obbligatoria delle firme d'errore:** uno stack trace contiene percorsi e
**valori**. Senza normalizzazione, "la memoria non contiene mai i tuoi dati" sarebbe falso.

---

## 7. La rete entra come ipotesi, mai come risposta

**Deciso dall'Owner: se non sa qualcosa, cerca, trova una soluzione e la prova in sandbox.**
Il meccanismo, perché è esattamente qui che gli agenti si fanno male:

1. **La query la costruisce il motore**, dalla firma del problema — non si incolla il codice
   dell'utente. Il lavoro non esce. Il broker di egress a sette stati governa la richiesta, e se
   lo stato non lo consente la ricerca **non parte** invece di partire ridotta.
2. **Ciò che torna entra nel Corpus** (fonte), con provenienza e stato di contaminazione. **Mai**
   in Biblioteca.
3. **Non viene applicato: diventa un esperimento.** Ipotesi + esito atteso → eseguito nella
   sandbox → il risultato decide.
4. **Funziona** → promosso in Esperienza, legato al controesempio che lo ribalterebbe.
   **Non funziona** → registrato come firma di fallimento, così non viene ritentato alla cieca.
5. **Il web è dato non fidato, come il repository.** Un testo trovato online non cambia una
   policy, non conia un token, non tocca un file, non ordina niente. Contenimento del prompt
   injection strutturale: i passaggi non fidati non entrano mai nel canale delle istruzioni.
6. **Un pacchetto trovato online non si installa perché è la risposta più votata.** Passa dal §V:
   effetto dichiarato, provenienza verificata, checkpoint, token.

**Nessun altro agente tratta un risultato di ricerca come un'ipotesi da falsificare.** Tutti lo
leggono e lo applicano — ed è misurato come uno dei vettori d'attacco in crescita del 2026.

---

## 8. La sandbox è il posto principale, non il recinto

**Deciso dall'Owner: più grande del normale.** "Più grande" non è più RAM: è un **cambio di
ruolo**. La sandbox smette di essere dove si mettono le cose pericolose e diventa **dove il
lavoro si fa normalmente**. Il repository vero si tocca **solo per promozione**.

- **Ambiente eseguibile intero:** non solo file — servizi, database, l'applicazione che gira,
  browser per l'anteprima e i test d'interfaccia, suite di test, processi in background,
  terminali multipli e persistenti.
- **Persistente per tutto il compito**, con checkpoint — non ricreata a ogni comando.
- **Più sandbox in parallelo**, una per ipotesi: worktree separati, così due strade si provano
  *davvero* invece di sceglierne una a priori. È anche come lavorano i sotto-agenti senza
  calpestarsi.
- **Rete mediata, non spenta.** Un proxy di uscita dove **ogni dominio è una concessione scritta
  nel token**. Ricerca web e installazione pacchetti avvengono **dentro** la sandbox, sotto
  audit — invece che fuori, dove nessuno guarda.
- **Isolamento per capacità** man mano che la fase 5 lo consente: cgroup per figlio, Landlock,
  seccomp per profilo, WASM per i moduli portabili. Oggi il container è l'unico confine, ed è
  dichiarato.

È anche ciò che rende possibile l'invenzione III: si autorizza un risultato **perché il risultato
esiste già**, misurato in ombra.

---

## 9. Le due shell, e il protocollo che le rende un solo programma

- **La sessione è l'unità di stato**, non la connessione. Le shell sono visualizzatori senza
  stato. Ti stacchi da una e il compito continua: appartiene al motore.
- **Ogni capacità nasce con la forma da tastiera**, progettata insieme a quella grafica. Una
  funzione che richiede il mouse **non è finita**.
- **Il protocollo fra shell e motore è pubblico e versionato**, su socket unix. Una terza shell —
  plugin per editor, visualizzatore mobile, reporter di CI — è allora **un client, non un fork**.
- **`ssh` è il trasporto, non una modalità.**

Le tre superfici di conversazione restano tre destinazioni distinte: **Chat** (nessun piano,
nessun gate, nessun accesso ai file), **CodeN Evolution** (il workspace), **CodeN Evolution TUI**
(lo stesso workspace da tastiera).

---

## 10. Ordine di costruzione

Per **dipendenza**, non per importanza. Ogni passo rende possibile il successivo.

| # | Cosa | Perché prima |
|---|---|---|
| 1 | **`ReasoningProvider`**, contratto pubblico e versionato | è la prima riga di codice: senza, ATOM non ha dove attaccarsi |
| 2 | **Lo stato e il proiettore di contesto** (inv. I) | tutto il resto scrive lì; farlo dopo significa rifarlo |
| 3 | **Provider di riferimento** — le undici superfici | il criterio di "fatto" si misura con questo, senza ATOM |
| 4 | **Capability token** e il motore che li conia da un Piano | rende vera la regola sola |
| 5 | **Registro degli eventi** con correlazione, causazione, digest | senza, niente di ciò che segue è dimostrabile |
| 6 | **Esecutore che non accetta altro che token**, e la sandbox che li spende | §8 |
| 7 | **Esecuzione in ombra** copy-on-write (inv. III) | richiede 4, 5 e 6 |
| 8 | **Comprensione del repository** + profilo di divergenza (inv. II) | pianificare la richiede comunque |
| 9 | **Verificatore per ricalcolo** + copertura di proiezione (inv. IV) | richiede 1 e 8 |
| 10 | **Catalogo strumenti a carico zero** (inv. V) | richiede 4 |
| 11 | **ATOM come secondo provider** (inv. VI) | richiede 1, 3 e 9 — e 3 deve già passare da solo |

---

## 11. Matrice di accettazione

**Colma il rischio 4 del piano di lavoro:** finora la riscrittura non aveva matrici con ID e
severità, quindi non esisteva un modo controllabile di dire "fatto". Ogni riga è verificabile
eseguendo, non leggendo. Severità: **C** critico (blocca la fase), **A** alto, **M** medio.

| ID | Criterio | Sev | Come si verifica | Verdetto |
|---|---|---|---|---|
| CE-001 | Nessun percorso muta il workspace senza spendere un token coniato da un Piano autorizzato | **C** | suite avversaria il cui unico lavoro è provare a farglielo fare | ✅ **verificato 2026-08-19 (`D-0561`)** — `services/reference-control-plane/test/ce-001-no-mutation-without-token.test.mjs`, 20/20: nove modi di tenere qualcosa di simile a un token, e dopo ognuno i **byte** su disco invariati (non solo il rifiuto); più la **chiusura**, derivata dal sorgente a ogni esecuzione — 114 moduli, 28 scrivono, **3 soli** conoscono la radice del workspace, ciascuno dichiarato. Eccezione nominata, non nascosta: `restore()` muta il workspace **senza spendere un token** e regge su una proprietà diversa — può riscrivere solo i byte che la promozione aveva catturato — misurata qui a parte. |
| CE-002 | Un token esaurito, scaduto o revocato è rifiutato su **ogni** superficie | **C** | test per superficie, più un tentativo per ciascuna |  |
| CE-003 | Un effetto non dichiarato dallo strumento è impossibile, non vietato | **C** | strumento sonda che tenta un effetto non dichiarato |  |
| CE-004 | Il contesto è ricostruito da stato: nessun componente può appendere testo libero | **C** | ispezione + test che rifiuta una scrittura fuori schema | ✅ **verificato 2026-08-19 (`D-0561`)** — i due modi che il criterio chiede, entrambi eseguiti: **ispezione** della superficie esportata di `services/reference-control-plane/src/context-projector.mjs` (`CONTEXT_SECTIONS` congelato, `validateFact`, `projectContext`, `renderProjection`, `projectionShape`, `projectionByteCeiling`: **nessuna funzione di append**, nessuna sezione a testo libero a cui puntare) e **test che rifiuta una scrittura fuori schema** — `context-projection.test.mjs` **16/16**, di cui 9 casi `CE-004`, incluso «una scrittura rifiutata lascia lo store intatto». |
| CE-005 | Il contesto alla chiamata *n* ha la stessa forma della chiamata 3, per *n* > 300 | **A** | compito lungo reale, misura della forma e della taglia |  |
| CE-006 | Ogni chiamata al modello è rieseguibile isolata dal suo stato registrato | **A** | replay di una decisione scelta a caso da una sessione conclusa |  |
| CE-007 | Il contenuto del repository e del web non può alterare istruzioni, policy o token | **C** | suite di prompt injection, zero bypass |  |
| CE-008 | L'ombra precede l'autorizzazione: nessun dialogo di autorizzazione senza risultato misurato | **C** | test che tenta di autorizzare un passo mai simulato | ❌ **NON soddisfatto, misurato 2026-08-19 (`D-0566`)** — `ce-008-shadow-precedes-authorization.test.mjs`. Il tentativo che il criterio nomina — autorizzare un passo mai simulato — **riesce**: `approve()` promuove una run che nessuno ha simulato. L'ordine reale, letto dal ledger e non dal sorgente, è `approved` → `executor.ran` → `shadow.compared`: **l'ombra segue l'autorizzazione**, e protegge la *promozione*, non il *dialogo*. `simulate()` esiste ma è **opzionale** e col solo provider di riferimento risponde `supported: false`, quindi su quell'installazione non esiste alcun risultato misurato da mostrare prima di approvare. Il test è verde e caratterizza il comportamento attuale: cambiando l'ordine fallisce, e questo verdetto va riscritto invece che ereditato. |
| CE-009 | La copertura di proiezione è sempre presente, mai arrotondata a "completa" | **A** | test che rifiuta un rapporto senza copertura o con copertura implicita |  |
| CE-010 | Il profilo di divergenza è ricalcolato dalla storia git, non configurato a mano | **A** | due repository con convenzioni opposte producono profili opposti |  |
| CE-011 | Ogni fatto indotto porta evidenza, conteggio e condizione di smentita | **A** | schema + test: un fatto senza smentita non è scrivibile |  |
| CE-012 | Un vettore senza il modello che l'ha prodotto non è confrontabile: **errore**, non numero | **A** | test di confronto fra due spazi diversi |  |
| CE-013 | I dati di lavoro non escono e non entrano nella semantica del prodotto | **C** | canary per semantica, verificato dallo schema |  |
| CE-014 | La query di ricerca è costruita dal motore; il codice dell'utente non compare mai nell'uscita | **C** | canary nel workspace, ispezione di ogni richiesta uscente |  |
| CE-015 | Un risultato dal web non è applicabile finché non è stato eseguito e verificato in sandbox | **C** | test che tenta di promuovere una fonte non eseguita |  |
| CE-016 | A riposo il programma ha zero strumenti caricati | **A** | misura del contesto a sessione appena aperta |  |
| CE-017 | Ogni passo mutativo è preceduto da un checkpoint, e il ripristino è byte-identico | **C** | ripristino verificato con checksum su ogni classe di passo | ✅ **verificato 2026-08-19 (`D-0563`)** — `ce-017-checkpoint-precedes-mutation.test.mjs`, 5/5, con **checksum sha256 dell'intero albero** prima del piano e dopo il ripristino, identici come mappa (percorsi **e** digest). Entrambe le classi di passo cablate: **modifica** (i byte originali tornano) e **creazione** (il file sparisce) — ed è la mappa dei checksum a **essere** la prova dell'ordine, perché quei byte possono tornare solo se erano stati letti prima di essere sovrascritti. Misurati anche: un file non nominato dal piano non viene toccato dal ripristino, il checkpoint è **per run** (ripristinando il secondo si torna al primo, non all'origine) e i byte binari sopravvivono esatti. Ampiezza dichiarata, non arrotondata: il percorso cablato è **solo WRITE** — `workspaceActionsStatus()` è asserito dal test, così il giorno in cui DELETE o EXECUTE venissero cablati questo verdetto va riguadagnato. |
| CE-018 | Il ledger è append-only, con digest concatenato che rileva una manomissione | **C** | tentativo di riscrittura, verifica della catena | ✅ **verificato 2026-08-19 (`D-0563`), con il limite dichiarato nel verdetto** — `ce-018-ledger-append-only.test.mjs` 6/6, più i 4 vettori di manomissione di `conformance/event-vectors.json` e il journal manomesso di `durability.test.mjs`. Nuovo qui: **append-only misurato sui BYTE** (il prefisso già scritto è identico dopo altri quattro eventi), un evento modificato è rifiutato al reload con `CHAIN_BROKEN`, e l'unica riga tollerata è quella **finale** troncata (scrittura interrotta), recuperata e contata. **Il limite, misurato eseguendo l'attacco:** la catena è `createHash` senza chiave (`createHmac` **assente**, asserito da un test), quindi rileva chi modifica ma **non** chi riscrive la catena da capo — due storie diverse producono due catene entrambe valide, distinguibili solo da chi ha annotato altrove il digest di testa. `D-0564` propone l'ancora. |
| CE-019 | Il rapporto finale ha `NON FATTO` non vuoto senza dichiararlo | **M** | test sul formato |  |
| CE-020 | Ogni capacità ha una forma da tastiera completa | **A** | ogni capacità esercitata dal TUI, senza mouse |  |
| CE-021 | Le due shell mostrano la stessa sessione viva, e staccarsi non ferma il compito | **A** | avvio in una shell, distacco, aggancio dall'altra |  |
| CE-022 | **Il criterio di "fatto" passa con il solo provider di riferimento, senza ATOM** | **C** | l'intera suite eseguita con ATOM disinstallato | ✅ **verificato 2026-08-19 (`D-0566`), nella forma PIÙ DURA di quella chiesta** — la batteria intera `scripts/test.sh` **15/15 exit 0** eseguita non solo senza ATOM, ma con ATOM **selezionato e irraggiungibile** (`NOESAR_REASONING_MODE=rust-external` verso un endpoint inesistente): il prodotto continua sul provider di riferimento e **dichiara** la degradazione (`D-0312`). La stessa batteria è verde anche nella configurazione di default, senza ATOM configurato. **La prima esecuzione era ROSSA (13/15)** e ha trovato un difetto reale — non nel prodotto ma nei test: due suite leggevano l'ambiente circostante e fallivano perché il prodotto si comportava correttamente. Riparate all'origine fissando le quattro variabili del router; senza quella riparazione questo criterio non era misurabile in modo ripetibile. |
| CE-023 | Con ATOM la copertura di proiezione è **misurata**, non asserita | **A** | stesso compito con e senza, delta riportato |  |
| CE-024 | Il tempo di revisione umana per cambiamento accettato è misurato e riportato | **M** | strumentazione del banco di revisione |  |

**Il criterio complessivo della fase 1** resta quello di `09_PIANO.md` §3, e questa matrice ne è
la forma eseguibile:

> Apre un repository vero, ne capisce la struttura, riceve una richiesta, produce un piano,
> ottiene un'autorizzazione, cambia diversi file, mostra il diff, esegue i test, corregge un
> errore, produce un risultato verificabile, ripristina lo stato precedente su richiesta, registra
> ogni operazione — e **non esce mai nemmeno una volta dall'autorità che gli è stata data**, con
> quest'ultima clausola provata da una suite **il cui unico lavoro è provare a farglielo fare**.

---

## 12. La posizione del prodotto

Tutti ottimizzano la **velocità di produzione del codice**. I numeri dicono che il collo di
bottiglia si è spostato: 38% delle PR rifiutate per abbandono del revisore, +31,3% di PR unite
senza alcuna revisione, 84% di adozione contro 29% di fiducia.

> **CodeN Evolution non ottimizza per produrre codice. Ottimizza per produrre un cambiamento che
> costa poco rivedere.**

La metrica del prodotto è il **tempo di revisione umana per cambiamento accettato** (CE-024).
Ogni invenzione serve quella: il diff arriva con l'evidenza che lo giustifica, l'esito già
misurato in ombra, il profilo di divergenza dal repository, la copertura di proiezione e ciò che
**non** è stato verificato, e la casella `NON FATTO`.

Il revisore legge **evidenza**, non prosa.

---

## 13. Cosa NON si costruisce

Registrato come decisione, non dimenticato.

| Cosa | Perché no |
|---|---|
| Un dialogo di autorizzazione per sottosistema | Collassano nei token. Quattro abitudini di consenso sono quattro occasioni di formare il riflesso sbagliato |
| Denylist testuali di comandi | Battute da qualunque indirezione. Si dichiarano gli **effetti**: ciò che non è dichiarato è impossibile |
| Riassunto automatico del contesto | È il vettore di corruzione, non la cura. L'invenzione I lo rende inutile |
| Un file di convenzioni scritto a mano come unica fonte | Stale il giorno dopo. Le convenzioni si **inducono** e si mostrano per conferma |
| Conferma con un tasto solo | In un terminale `y` è a un incollaggio di distanza dall'essere digitato da qualcosa che non sei tu |
| Installazione automatica delle dipendenze come iniziativa | Resta un obiettivo, ma è un'azione **con token e checkpoint** |
| SQLite come archivio primario | L'isolamento a livello di riga è ciò che rende applicabili i muri della memoria |
| Guscio desktop come architettura | È **packaging sopra lo stesso protocollo**, una decisione successiva |
| Telemetria di default | Spenta, e resta spenta |
| Un modello sempre più grande | Lo scaffold vale 10–20 punti a modello invariato. Si cresce per **numero di esperti verificati** |
| Esecuzione cloud e app mobile | **Rinviate**, non rifiutate: sono superfici di uscita, vanno progettate *attraverso* l'impegno di privacy |

---

## 14. I rischi di questo progetto, dichiarati adesso

1. **L'invenzione I è invasiva.** Se lo stato e il proiettore non sono i primi, ogni componente
   scritto prima va rifatto. È il passo 2 dell'ordine per questa ragione.
2. **L'invenzione III raddoppia il lavoro per passo.** Accettato esplicitamente dall'Owner: è il
   prezzo per non autorizzare mai al buio. Va misurato, non stimato.
3. **L'invenzione II legge la storia git del progetto dell'utente.** È lettura locale, niente
   esce — ma è una decisione di privacy presa esplicitamente e va scritta nell'interfaccia, non
   solo qui.
4. **Nessun toolchain Rust sull'host**, e la regola 45 vieta di installarlo: ogni ciclo di
   build/test paga il costo dei container effimeri.
5. **Il supervisore a tre figli tocca l'avvio dell'installazione viva.** Blue/green con rollback
   preservato, sempre.
6. **Il profilo di divergenza può diventare un oracolo tirannico** su un repository giovane o
   incoerente. Mitigazione: è un *profilo*, mai un veto; sotto una soglia di storia dichiara
   `campione insufficiente` invece di inventare una convenzione.
7. **Nessuna revisione indipendente.** Né del V4, né della riscrittura, né di questo documento.

---

## 15. Decisioni registrate qui

| ID | Decisione |
|---|---|
| `D-0107` | Il contesto è una proiezione ricostruita da stato, mai una trascrizione che si accumula. Nessun componente può appendere testo libero |
| `D-0108` | Le convenzioni del repository si **inducono** dalla storia git e producono un profilo di divergenza; mai un punteggio, mai un veto |
| `D-0109` | L'esecuzione in ombra precede l'autorizzazione: si promuove un risultato misurato, non si approva un'intenzione |
| `D-0110` | La copertura di proiezione è obbligatoria e non arrotondabile: ciò che non è stato ricalcolato è dichiarato tale |
| `D-0111` | A riposo zero strumenti; la superficie è derivata dal Piano; effetti dichiarati invece di denylist; installare è un passo autorizzato |
| `D-0112` | ATOM entra come implementazione di `ReasoningProvider`, selezionabile per superficie, e il suo valore è **misurato** dalla copertura di proiezione. Il criterio di "fatto" passa senza ATOM (CE-022) |
| `D-0113` | La rete entra come ipotesi da falsificare in sandbox, mai come risposta da applicare; query costruita dal motore |
| `D-0114` | La sandbox è il luogo primario dell'esecuzione, non il recinto: ambiente intero, persistente, parallelo, rete mediata per dominio |
| `D-0115` | La metrica del prodotto è il tempo di revisione umana per cambiamento accettato |
| `D-0116` | Matrice di accettazione CE-001…CE-024 con ID e severità: colma il rischio 4: prima non esisteva un modo controllabile di dire "fatto" |
