# 14 · La memoria a cubi

**Richiesta dell'Owner, 26 luglio 2026.** Progetto. Nulla di quanto segue è implementato.

---

## 1. La cosa da capire prima di tutto, perché cambia il progetto

Hai chiesto: *«qualsiasi modello mettiamo, c'è sempre la memoria precedente»*.

**Questo non si ottiene conservando vettori.** Un vettore ha senso solo dentro lo spazio del
modello che l'ha prodotto: cambi modello di embedding e i vecchi vettori non diventano
imprecisi, diventano **privi di significato**. Non c'è conversione, non c'è migrazione.

Quindi la regola che regge tutto il resto:

> **Il record è la memoria. Il vettore è soltanto un indice, ed è usa e getta.**

Conseguenze, tutte verificabili:

- cambiare modello **non perde nulla**: si ricalcolano gli indici, i record non si toccano;
- un record **senza vettore è ancora una memoria** — si trova per segnatura, per data, per
  progetto, per categoria; solo la ricerca per somiglianza è temporaneamente muta;
- lo schema attuale **lo permette già**: `memory_items.embedding` è `NULL`-abile e
  `content` è `NOT NULL`. Chi l'ha scritto aveva ragione.

### "Elastici", diviso in due significati

| Senso | Si può? | Come |
|---|---|---|
| Elastici nel **numero di ricordi** | sì, senza limiti pratici | righe in PostgreSQL |
| Elastici nelle **dimensioni del vettore** | **no**, non in una colonna | `vector(384)` è fisso in pgvector |

La seconda si ottiene cambiando il posto in cui si mette l'indice: **una tabella di indice per
modello di embedding**, non una colonna. Aggiungere un modello significa aggiungere una
tabella e riempirla mentre la vecchia continua a servire. Nessun fermo, nessuna perdita, e i
due indici convivono finché il reindicizzamento non è finito. *Questo* è elastico nell'unico
senso che conta.

---

## 2. I tre cubi, e perché il terzo non è un pari

Hai chiesto due cubi, e di valutare se il terzo per i documenti serve. **Serve, ma non è un
cubo dello stesso tipo**, e la differenza è la ragione per cui questa architettura non
allucina.

| | **Cubo 1 · Biblioteca** | **Cubo 2 · Officina** | **Cubo 3 · Corpus** |
|---|---|---|---|
| Semantica (doc. `05`) | del prodotto | del compito → candidato | di lavoro |
| Contiene | come lavori, procedure, decisioni, vincoli, preferenze | sessioni compattate in attesa di giudizio | documenti, indice del repository, grafo |
| Stato epistemico | **affermazioni verificate** | **affermazioni in attesa** | **fonti** |
| Fiducia | autoritativa | candidata finché non approvata | **dato non fidato, sempre** |
| Durata | permanente | fino a promozione o scarto | quanto il progetto |
| Esce dalla macchina | mai senza concessione | mai | mai senza concessione su singolo elemento |

**Perché il terzo è diverso in natura.** Un documento **è** la fonte. Un ricordo è
un'**affermazione su qualcosa**. Tenerli nello stesso posto è precisamente il meccanismo con
cui nasce l'allucinazione: il riassunto di un documento torna indietro come se fosse il
documento. Separati per schema, quella confusione non è possibile — perché il richiamo dal
Cubo 3 restituisce **passaggi con la loro posizione nella fonte**, mentre il richiamo dal
Cubo 1 restituisce **affermazioni con la loro provenienza**, e i due tipi non sono
intercambiabili nemmeno per errore di programmazione.

---

## 3. La struttura della biblioteca

Mi hai chiesto di trovarla io. Il principio che prendo dalle biblioteche vere non è il numero
di Dewey: è **una sola collocazione canonica per ogni cosa, e molti cataloghi che ci puntano.**

### 3.1 · La segnatura

Ogni ricordo ha **un solo indirizzo**, immutabile per tutta la sua vita:

```text
<semantica>/<progetto>/<anno>/<mese>/<giorno>/<sequenza>-<categoria>

PRD/noesar-evolution/2026/07/26/0043-decisione
LAV/noesar-evolution/2026/07/26/0107-fatto
```

Immutabile perché è ciò che rende un'affermazione **citabile**: se l'indirizzo cambia, una
citazione di ieri punta al vuoto o — peggio — a qualcos'altro. Un ricordo che viene corretto
non cambia indirizzo: ne nasce uno nuovo che **supera** il vecchio, e il vecchio resta
leggibile con sopra scritto da chi è stato superato. Nessun `UPDATE` distruttivo, mai.

La data è **dentro** l'indirizzo, non solo in una colonna, per la stessa ragione per cui una
biblioteca scrive la segnatura sul dorso: si deve poter scorrere uno scaffale senza
interrogare un catalogo.

### 3.2 · Le otto categorie — registro chiuso

Chiuso di proposito, come il registro delle espressioni di L0 e quello delle operazioni dei
workflow. Una tassonomia aperta si riempie di sinonimi in tre mesi e smette di ordinare
qualcosa. Si estende **con una decisione registrata**, non con una stringa nuova.

| Categoria | Cosa contiene | Come si verifica che sia ancora vera |
|---|---|---|
| `decisione` | una scelta **e la sua ragione** | la ragione regge ancora? |
| `procedura` | come si fa una cosa, ripetibile | si riesegue |
| `convenzione` | nomenclatura, stile, formati | il codice la rispetta ancora? |
| `vincolo` | ciò che **non** si può fare, e perché | il perché è ancora vero? |
| `fatto` | uno stato del mondo osservato, **con quando** | si riosserva |
| `difetto` | problema, causa, correzione | il test di regressione esiste e passa? |
| `preferenza` | come l'Owner vuole le cose | solo l'Owner la cambia |
| `riferimento` | puntatore a una fonte esterna | la fonte esiste ancora? |

Ogni categoria ha una **regola di verifica diversa**, ed è questo che impedisce alla
biblioteca di marcire: un `fatto` del 2026 va riosservato, una `preferenza` no.

### 3.3 · I cataloghi

La segnatura è una. I modi di arrivarci sono molti, e sono **indici, non collocazioni**:

```text
per tempo       ora · giorno · mese · anno · "l'ultima volta che"
per progetto    tutti i ricordi di un progetto
per categoria   tutte le decisioni · tutti i vincoli
per attore      chi l'ha affermato: Owner, agente, derivazione
per contaminazione   verificato · candidato · sospetto · revocato
per somiglianza vettoriale, e **solo** questo dipende dal modello
```

Sette cataloghi, sei dei quali funzionano **anche senza vettori**. Se il modello cambia e il
reindicizzamento è a metà, la biblioteca resta usabile.

### 3.4 · La crescita per strati

Il cubo cresce **stratificando consolidamenti**, mai riscrivendo il livello sotto:

```text
sessione  ──▶  digesto del giorno  ──▶  consolidamento del mese  ──▶  dell'anno
   │                  │                          │
   └── resta ─────────┴── ogni strato CITA quello sotto, non lo sostituisce ──┘
```

Un consolidamento che cancellasse le sessioni renderebbe le proprie affermazioni non
verificabili il giorno dopo. Lo spazio è il prezzo dell'essere controllabili, ed è basso: i
record sono testo.

---

## 4. Il Cubo 2 — l'officina che compatta

Hai descritto: *«una sessione di lavoro finita, compatta, elimina il rumore e manda la memoria
all'altro cubo»*. Questo è esattamente il percorso, con un solo cambiamento che non è mio ma
è già una decisione presa in `05`:

> **Nulla viene promosso automaticamente.** La promozione richiede validazione, policy,
> rilevamento di conflitti, un canary di contaminazione, approvazione umana e audit.

Non è una frenata burocratica: è ciò che impedisce a un file letto in un repository di
scrivere nella memoria autoritativa. Un agente che legge `INSTRUCTIONS.md` di un progetto
altrui non deve poter insegnare al prodotto una "convenzione".

La conciliazione è che lo schema **ha già gli stati intermedi**:

```text
session ──▶ project-candidate ──▶ project ──▶ global-candidate ──▶ global
                                                                    revoked
```

Quindi:

- **la compattazione è automatica** — a fine sessione, senza chiedere;
- **l'arrivo in `*-candidate` è automatico** — il Cubo 2 si riempie da solo;
- **il passaggio a `project` o `global` richiede approvazione** — ed è una riga nella striscia
  di approvazione che esiste già in fondo alla WebUI.

Hai la memoria «già scritta e organizzata» senza aprire un file, e nulla entra nella semantica
autoritativa senza che qualcuno lo abbia guardato.

### 4.1 · Compattare senza inventare — il punto più delicato di tutto il progetto

**La compattazione è il posto dove l'allucinazione entra.** Riassumere significa generare
testo, e il testo generato non ha provenienza. Se il riassunto di una sessione entra nella
biblioteca come affermazione, la biblioteca è avvelenata alla fonte.

Tre regole, in ordine di forza:

1. **Estrarre prima di generare.** Un `fatto`, una `decisione`, un `difetto` sono già frasi
   dette in sessione: si **selezionano**, non si riscrivono. La selezione preserva la
   provenienza per costruzione.
2. **Ciò che è generato è marcato `derivato`** e porta i puntatori agli elementi da cui viene.
   Un derivato non è mai restituito da solo: o con le sue fonti, o non esce.
3. **Fallire chiuso.** Se un candidato non è tracciabile a un record di sessione, **non viene
   emesso**. Non "emesso con confidenza bassa": non emesso. Una memoria senza provenienza non
   è una memoria debole, è un'invenzione con una data sopra.

Il rumore da eliminare, per contro, è definibile senza rischio: comandi ripetuti, output
identici, tentativi sostituiti da un tentativo successivo riuscito, file letti e mai usati.
**Togliere non inventa.**

---

## 5. Perché il richiamo non allucina

Un solo meccanismo non basta. Cinque, sovrapposti:

1. **Il richiamo restituisce record, mai prosa.** Chi chiama riceve elementi con la loro
   segnatura e la loro provenienza. La prosa la scrive il modello *dopo*, e ciò che scrive è
   verificabile contro ciò che ha ricevuto.
2. **Ogni elemento è citabile.** La segnatura è un indirizzo stabile: un'affermazione o porta
   il suo indirizzo, o non è sostenuta. È la superficie `evidence` del contratto pubblico —
   *«le fonti che la sostengono, oppure "inferenza, non supportata"»*.
3. **Il richiamo dichiara cosa non ha trovato.** Restituire tre elementi su duecento candidati
   e tacerlo è mentire per omissione. La **copertura** viaggia col risultato, come per il
   verificatore di L4.
4. **Stato di contaminazione su ogni elemento**, e il canary. Un ricordo che viene da un
   documento non fidato resta marcato per sempre, anche dopo la promozione.
5. **Le tre semantiche sono separate dallo schema**, non dalla buona condotta. Un elemento del
   Cubo 3 non può essere restituito come affermazione del Cubo 1 nemmeno per un errore di
   programmazione, perché sono tabelle diverse con tipi di ritorno diversi.

La quinta è la più importante, e vale la pena dire perché: le altre quattro sono discipline
che il codice deve ricordare di applicare. La quinta è una proprietà della struttura, e
**regge anche quando qualcuno dimentica**.

---

## 6. Cosa va costruito

In ordine di dipendenza. Nessuno di questi punti è iniziato.

| | Cosa | Nota |
|---|---|---|
| 1 | **Riconciliare i due archivi di memoria esistenti** | oggi le memorie vive stanno in `ai-workspace.json`, mentre `memory_items` in PostgreSQL — con `provenance`, `embedding` e la pipeline di promozione — **non è sul percorso vivo**. Stessa forma di `B-008`. Prima di costruire i cubi si decide quale dei due è autoritativo |
| 2 | **La segnatura** e la sua immutabilità | colonna + vincolo, `superseded_by` invece di `UPDATE` |
| 3 | **Le otto categorie** come registro chiuso | `CHECK` nello schema, non convenzione |
| 4 | **Indici per modello**, non colonna per vettore | è ciò che rende il cambio di modello non distruttivo |
| 5 | **I cataloghi** (sei senza vettori, uno con) | |
| 6 | **La compattazione estrattiva** di fine sessione | il punto più delicato: vedi §4.1 |
| 7 | **Il canary di contaminazione** e la pipeline di promozione | esiste come stati, non come codice |
| 8 | **La copertura nel risultato del richiamo** | |
| 9 | **Gli strati di consolidamento** giorno/mese/anno | ultimo: prima serve materiale da consolidare |

---

## 7. Cosa non ho deciso io, e resta a te

1. **Riconciliazione degli archivi** — JSON o PostgreSQL come autoritativo. Ha conseguenze su
   backup, RLS e multi-utente. Io propongo PostgreSQL, perché i muri fra le semantiche sono
   applicabili solo lì; ma è una migrazione di dati vivi.
2. **Le otto categorie sono le tue?** Le ho ricavate da ciò che si accumula davvero in un file
   di memoria di progetto. Se ne manca una, si aggiunge ora — dopo costa una migrazione.
3. **La soglia di promozione automatica.** Ho proposto: compattazione e arrivo in
   `*-candidate` automatici, passaggio ad autoritativo con approvazione. Se vuoi che anche
   `project` sia automatico entro un progetto, si può — ma allora un documento letto può
   insegnare al prodotto, e va detto ad alta voce.
4. **Ritenzione.** Quanto vive un elemento di sessione non promosso? Io propongo che non
   scada: è testo, e serve a rendere verificabili i consolidamenti sopra di esso.
5. **Il Cubo 3 è dentro questo progetto o è il grafo di conoscenza che già esiste?** Propendo
   per estendere quello esistente invece di crearne un secondo — un secondo archivio di
   documenti sarebbe la stessa doppia verità del punto 1.

---

## 8. Un limite dichiarato

Su questo host esistono cubi di memoria, in **CodeN Ultra** — 177 file, formato record+vettore
appaiati. Non è questo progetto e `CLAUDE10.md` §1 vieta di travasare materiale nelle due
direzioni: **niente di quel codice viene copiato qui**, e questo documento non ne dipende.

Vale però la lezione, perché è stata pagata: la storia di quel progetto registra una **causa
radice di allucinazione dai cubi**, e quattro cubi messi in quarantena. Il motivo per cui §5
elenca cinque meccanismi sovrapposti invece di uno è quello.
