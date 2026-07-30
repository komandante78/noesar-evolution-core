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

## 2. Quattro cubi — e il criterio che ha deciso il numero

Mi hai lasciato decidere il numero. **Quattro**, e il criterio conta più del numero perché
serve anche fra un anno:

> **Un cubo è uno stato epistemico.** Due cose stanno in cubi diversi quando **la domanda
> "come faccio a sapere che è vero?" ha risposte di tipo diverso.** Se la risposta è la stessa
> e cambia solo il modo di verificare, sono due **categorie** dentro lo stesso cubo.

Applicato:

| | **1 · Biblioteca** | **2 · Officina** | **3 · Corpus** | **4 · Esperienza** |
|---|---|---|---|---|
| Stato epistemico | **asserito** e verificato | **in attesa** di giudizio | **fonte** | **indotto** da osservazioni |
| «come so che è vero?» | qualcuno l'ha deciso o osservato | non lo so ancora | è il documento stesso | è successo N volte |
| Si smentisce con | una nuova decisione | l'approvazione o lo scarto | una nuova versione della fonte | **un solo controesempio** |
| Semantica (`05`) | del prodotto | del compito → candidato | di lavoro | del prodotto |
| Fiducia | autoritativa | candidata | **non fidato, sempre** | **falsificabile** |
| Durata | permanente | fino a promozione o scarto | quanto il progetto | permanente, ma rivedibile |

**Perché il Corpus non è un pari.** Un documento **è** la fonte; un ricordo è
un'**affermazione su qualcosa**. Tenerli insieme è il meccanismo con cui il riassunto di un
documento torna indietro come se fosse il documento.

**Perché l'Esperienza è separata dalla Biblioteca**, che è la scelta meno ovvia delle quattro.
Una `decisione` è vera perché qualcuno l'ha presa. Una **lezione** — *«questo approccio
fallisce quando X»* — è vera perché è successo più volte, ed **è l'unico tipo di memoria che
un solo controesempio può ribaltare**. Metterla in biblioteca la farebbe sembrare autoritativa
quanto una decisione dell'Owner, e non lo è: è un'induzione. Ha bisogno di portarsi dietro
quante volte è stata confermata e quante smentita, e di essere **rimessa alla prova** — cosa
che una decisione non richiede mai. È anche il livello `L7` del blueprint ATOM, e il registro
delle firme di fallimento della fase 2.

**Perché non cinque.** Ho provato a scorporare la cronologia delle conversazioni (è materiale
di sessione → Officina), gli artefatti (sono output, non memoria), la configurazione
dell'installazione (è stato, ha già le sue tabelle) e l'audit (è il ledger, e duplicarlo
creerebbe una seconda verità su cosa è successo). Nessuno passa il criterio. **Ogni cubo in
più è un confine che il codice deve rispettare, e un confine che non corrisponde a una
differenza reale prima o poi viene attraversato per sbaglio.**

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

### 3.2 · Le nove categorie — registro chiuso

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
| `lezione` | **solo cubo Esperienza** — «questo fallisce quando X» | si rimette alla prova; porta conferme e smentite |

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
| 3 | **Le nove categorie** come registro chiuso | `CHECK` nello schema, non convenzione |
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
2. **Le nove categorie sono le tue?** Le ho ricavate da ciò che si accumula davvero in un file
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

---

## 9. La soluzione concreta

Non parte da zero: **metà di questa architettura è già nello schema**, e il pezzo che manca è
piccolo e preciso.

### 9.1 · Cosa c'è già, e il difetto che ha

`noesar_knowledge.vector_entries` è **già** l'indice separato dal record — ha `source_kind` e
`source_id` che puntano indietro, e il commento nel file lo dice: *«questa è l'indice di
embedding che una ricerca legge davvero»*. La direzione era giusta.

**Il difetto:** né `vector_entries` né `memory_items` portano l'**identità del modello** che
ha prodotto il vettore.

```sql
embedding vector(384) NOT NULL      -- ma di quale modello?
```

Conseguenza, ed è peggio di una svista: due modelli diversi possono coesistere nella stessa
tabella e **essere confrontati fra loro**. La distanza coseno fra due spazi diversi non dà
errore — **dà un numero**. Il richiamo restituirebbe risultati plausibili e privi di senso,
che è esattamente la definizione dell'allucinazione che vuoi evitare, prodotta dallo schema
invece che dal modello.

È anche il motivo per cui oggi **non si può cambiare modello di embedding**: non c'è modo di
sapere quali righe reindicizzare.

### 9.2 · Lo schema proposto

Da applicare come migrazione `0017`. **Scritto qui e non in `database/postgres/`
deliberatamente**: un file lì viene raccolto dal manifesto delle migrazioni e applicato al
prossimo deploy, e questo tocca dati vivi. Diventa una migrazione quando lo approvi.

```sql
-- ── i modelli di embedding, con la loro identità ──────────────────────────────
CREATE TABLE noesar_knowledge.embedding_models (
  id             uuid PRIMARY KEY,
  name           text NOT NULL UNIQUE,      -- es. 'bge-small-en-v1.5'
  dimensions     integer NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  is_current     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Un solo modello corrente per volta, applicato dallo schema e non dal codice.
CREATE UNIQUE INDEX embedding_models_one_current
  ON noesar_knowledge.embedding_models(is_current) WHERE is_current;

-- ── il cubo: quattro, distinti per stato epistemico ───────────────────────────
CREATE TYPE noesar_knowledge.cube AS ENUM
  ('library','workshop','corpus','experience');

-- ── la segnatura: un solo indirizzo canonico, immutabile ──────────────────────
CREATE TABLE noesar_knowledge.memory_records (
  id             uuid PRIMARY KEY,
  cube           noesar_knowledge.cube NOT NULL,
  signature      text NOT NULL UNIQUE,      -- PRD/progetto/2026/07/26/0043-decisione
  workspace_id   uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id     uuid REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  owner_user_id  uuid NOT NULL REFERENCES noesar_identity.users(id),

  category       text NOT NULL CHECK (category IN (
                   'decisione','procedura','convenzione','vincolo',
                   'fatto','difetto','preferenza','riferimento','lezione')),
  content        text NOT NULL,
  provenance     jsonb NOT NULL,            -- già obbligatoria oggi: si conserva
  contamination  text NOT NULL DEFAULT 'unverified' CHECK (contamination IN
                   ('verified','unverified','suspect','revoked')),
  promotion_state text NOT NULL CHECK (promotion_state IN (
                   'session','project-candidate','project',
                   'global-candidate','global','revoked')),

  -- Derivato: se è generato, non esce mai senza le sue fonti (§4.1)
  derived        boolean NOT NULL DEFAULT false,
  derived_from   uuid[] NOT NULL DEFAULT '{}',
  CONSTRAINT derived_must_cite CHECK (NOT derived OR cardinality(derived_from) > 0),

  -- Correzione senza distruzione: nasce un record nuovo, il vecchio resta leggibile
  superseded_by  uuid REFERENCES noesar_knowledge.memory_records(id),

  -- Solo per il cubo 'experience': un'induzione porta il proprio bilancio
  confirmations  integer NOT NULL DEFAULT 0,
  refutations    integer NOT NULL DEFAULT 0,
  CONSTRAINT counters_only_for_experience CHECK (
    cube = 'experience' OR (confirmations = 0 AND refutations = 0)),

  observed_at    timestamptz NOT NULL,       -- quando è successo
  created_at     timestamptz NOT NULL DEFAULT now()  -- quando l'abbiamo scritto
);

-- La segnatura non cambia mai. Il trigger esiste perche un UPDATE distratto la
-- cambierebbe senza che nessun test se ne accorga.
CREATE FUNCTION noesar_knowledge.signature_is_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.signature IS DISTINCT FROM OLD.signature THEN
    RAISE EXCEPTION 'la segnatura e immutabile: % -> %', OLD.signature, NEW.signature;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER memory_records_signature_immutable
  BEFORE UPDATE ON noesar_knowledge.memory_records
  FOR EACH ROW EXECUTE FUNCTION noesar_knowledge.signature_is_immutable();

-- ── l'indice: una riga per (record, modello). QUI sta l'elasticita ────────────
CREATE TABLE noesar_knowledge.memory_vectors (
  record_id      uuid NOT NULL REFERENCES noesar_knowledge.memory_records(id) ON DELETE CASCADE,
  model_id       uuid NOT NULL REFERENCES noesar_knowledge.embedding_models(id) ON DELETE CASCADE,
  embedding      vector(384) NOT NULL,
  indexed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_id, model_id)
);

CREATE INDEX memory_vectors_hnsw
  ON noesar_knowledge.memory_vectors USING hnsw (embedding vector_cosine_ops);

-- Cataloghi che funzionano SENZA vettori (sei dei sette)
CREATE INDEX memory_records_time   ON noesar_knowledge.memory_records(observed_at DESC);
CREATE INDEX memory_records_proj   ON noesar_knowledge.memory_records(project_id, observed_at DESC);
CREATE INDEX memory_records_cat    ON noesar_knowledge.memory_records(cube, category, observed_at DESC);
CREATE INDEX memory_records_actor  ON noesar_knowledge.memory_records(owner_user_id, observed_at DESC);
CREATE INDEX memory_records_contam ON noesar_knowledge.memory_records(contamination)
  WHERE contamination <> 'verified';
CREATE INDEX memory_records_promo  ON noesar_knowledge.memory_records(promotion_state)
  WHERE promotion_state LIKE '%candidate';

ALTER TABLE noesar_knowledge.memory_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.memory_records FORCE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.memory_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.memory_vectors FORCE ROW LEVEL SECURITY;
-- Le policy seguono quelle di 0015: AS RESTRICTIVE, per utente e per progetto.
```

**`vector(384)` resta fisso in `memory_vectors`, e va bene**, perché la tabella non è più *la*
memoria: è *un* indice. Un modello a 1024 dimensioni prende la sua tabella
`memory_vectors_1024` con la stessa chiave `(record_id, model_id)`. I record non si toccano.

### 9.3 · Come si cambia modello, concretamente

```text
1. INSERT in embedding_models (is_current = false)      il nuovo modello esiste, non serve ancora
2. riempimento incrementale di memory_vectors            il vecchio indice continua a servire
3. quando la copertura e 100%: is_current = true         una transazione, nessun fermo
4. DELETE delle righe del vecchio modello                 spazio liberato, record intatti
```

In nessun momento la ricerca è rotta, e in nessun momento due spazi vengono confrontati:
**ogni query filtra per `model_id = (SELECT id FROM embedding_models WHERE is_current)`.**

E se il passo 2 non finisce mai — modello sparito, macchina spenta — il sistema resta al
punto 1: **degradato ma corretto**, con il vecchio indice ancora valido.

### 9.4 · Il contratto del richiamo

Una firma sola, e ciò che restituisce è la ragione per cui non allucina:

```text
recall(query, { cube, project, category, since, until, limit })
  → {
      items: [ { signature, content, category, provenance,
                 contamination, observed_at, score? } ],
      coverage: { candidates, examined, returned, model, vector_index_complete },
      not_found: [ "criteri che non hanno prodotto nulla" ]
    }
```

Tre proprietà, tutte verificabili da un test:

1. **`items` sono record, mai prosa.** La prosa la scrive il modello dopo, ed è confrontabile
   con ciò che ha ricevuto.
2. **`coverage` viaggia sempre.** Restituire 3 elementi su 200 candidati e tacerlo è mentire
   per omissione. `vector_index_complete: false` dice all'interfaccia che la ricerca per
   somiglianza è parziale perché un reindicizzamento è in corso.
3. **`not_found` è esplicito.** «Non ho trovato nulla su X» è un'informazione, e un modello che
   la riceve non è tentato di riempire il vuoto.

### 9.5 · La compattazione, come procedura

A fine sessione, e **senza chiedere** perché produce solo candidati:

```text
1. RACCOGLI   gli eventi della sessione dal ledger (che e gia append-only e concatenato)
2. TOGLI      comandi ripetuti, output identici, tentativi superati da uno riuscito,
              file letti e mai usati                          ← togliere non inventa
3. ESTRAI     le frasi che sono gia decisioni/fatti/difetti dette in sessione
              → derived = false, provenienza = l evento da cui vengono
4. GENERA     solo cio che l estrazione non copre
              → derived = true, derived_from = gli id, e il CHECK impedisce di dimenticarlo
5. SCARTA     ogni candidato non tracciabile a un evento          ← fallire chiuso
6. SCRIVI     in cube='workshop', promotion_state='*-candidate'
7. PROPONI    nella striscia di approvazione che esiste gia in fondo alla WebUI
```

I passi 1-3 non possono inventare per costruzione. Il passo 4 può, e per questo il suo output
è marcato nello schema e non nel codice: `CONSTRAINT derived_must_cite` fa fallire l'`INSERT`,
non una revisione.

### 9.6 · Ordine di costruzione

| | Cosa | Dipende da |
|---|---|---|
| 1 | **Decidere `B-009`**: PostgreSQL o JSON autoritativo | Owner — è una migrazione di dati vivi |
| 2 | `embedding_models` + `model_id` sui vettori | niente. **È anche un fix di un difetto presente**, indipendente dai cubi |
| 3 | `memory_records` con segnatura, trigger, RLS | 1 |
| 4 | Cataloghi senza vettori (sei) | 3 |
| 5 | `memory_vectors` e la ricerca filtrata per modello corrente | 2, 3 |
| 6 | Il contratto `recall` con `coverage` e `not_found` | 4, 5 |
| 7 | La compattazione estrattiva | 6, e il ledger che esiste già |
| 8 | Canary di contaminazione e promozione approvata | 7, e la coda di approvazione che esiste già |
| 9 | Strati di consolidamento giorno/mese/anno | 8 — ultimo, prima serve materiale |

**Il punto 2 si può fare subito e da solo**: non è la memoria a cubi, è la riparazione di un
difetto che oggi rende impossibile cambiare modello di embedding senza corrompere in silenzio
la ricerca. Vale la pena farlo anche se decidessi di non costruire i cubi.

---

## 10. PostgreSQL è autoritativo — deciso dall'Owner

`B-009` è chiuso: **PostgreSQL è l'archivio autoritativo della memoria.** `ai-workspace.json`
smette di essere una seconda verità.

Perché regge: i muri fra le tre semantiche di `05` sono applicabili **solo** lì. L'isolamento a
livello di riga è già costruito, forzato e provato contro un avversario nello stesso progetto.
Un muro in un file JSON è una convenzione che il prossimo `writeFile` può attraversare.

La migrazione tocca dati vivi, quindi: backup a servizio fermo · scrittura doppia finché i
conteggi non coincidono · lettura commutata in una transazione · JSON tenuto in sola lettura
per una release, poi rimosso. Lo stesso schema del deploy di oggi, con il rollback preservato.

---

## 11. Non complicato per gli utenti

Vincolo dell'Owner, e viene prima delle scelte tecniche: se la memoria si vede, ha fallito.

> **L'utente non deve sapere che esistono quattro cubi.** I cubi sono il modo in cui il
> prodotto tiene onesta la propria memoria, **non una tassonomia da imparare.**

Concretamente:

- **Non si scrive mai una memoria a mano.** Il prodotto la scrive a fine sessione. Nessun file
  da mantenere, nessuna sintassi. È la differenza che hai chiesto rispetto a un `CLAUDE.md`:
  già scritta e già organizzata.
- **Una sola destinazione**, `Memoria`, dentro le undici di `07`. Non quattro pagine.
- **Tre gesti, e basta:** *cerca* (una casella) · *sfoglia* (per tempo, progetto, argomento) ·
  *approva* (la striscia in fondo che esiste già).
- **Parole normali.** Il registro chiuso vive nello schema; l'utente legge «decisioni»,
  «procedure», «cose imparate». Mai `promotion_state`, mai `contamination`, mai `cube`.
- **Nessuna configurazione per iniziare.** Modello di embedding, dimensioni, indici: il
  prodotto sceglie e lo dice se cambia qualcosa.
- **Divulgazione progressiva.** Provenienza, contaminazione, quale modello ha indicizzato:
  disponibili su un elemento quando li chiedi, mai davanti quando non servono.

La domanda che l'utente deve potersi fare è **«cosa sai di questo progetto?»**, non «in quale
cubo sta?». E l'approvazione deve leggersi come una frase, non come un modulo:

```text
Dalla sessione di oggi ho imparato 3 cose su noesar-evolution.
   • PostgreSQL e autoritativo per la memoria          [tieni] [scarta] [vedi da dove viene]
```

**Il costo di questa semplicità è nostro, non suo:** ogni campo che l'utente non vede è un
campo che il codice deve riempire correttamente da solo.

---

## 12. Come invecchia — e perché NOESAR EVOLUTION deve guardare a domani

Vincolo dell'Owner: questo è un progetto **evolutivo**. Un'architettura di memoria progettata
solo sull'oggi diventa il vincolo di domani. Quanto segue è ricerca fatta il 26 luglio 2026,
non previsione.

### 12.1 · Una mia affermazione era troppo forte, e la correggo

In §1 ho scritto che «elastico nelle dimensioni» è impossibile. **È impossibile in una colonna
a dimensione fissa. Non è impossibile in generale**, e il meccanismo esiste già ed è maturo.

**Matryoshka Representation Learning (MRL).** Il modello è addestrato applicando la stessa
funzione di perdita anche a *prefissi troncati* dell'embedding, il che costringe
l'informazione a disporsi dal grossolano al fine: le prime dimensioni portano la semantica
universale, le ultime il dettaglio. La conseguenza è che **un solo checkpoint serve molte
dimensioni** — 32, 64, 128, 512, 1024 — e si tronca *a tempo di interrogazione* senza
riaddestrare e senza perdita apprezzabile di qualità.

Cosa cambia per noi: un vettore Matryoshka salvato una volta **alla dimensione piena** può
alimentare indici più piccoli per troncamento, senza ricalcolare gli embedding. L'elasticità
diventa una proprietà del dato, non solo dello schema.

E abilita il pattern che conta davvero su una biblioteca che cresce per anni: **restringi e
riordina** — prima passata su vettori corti e economici per fare una lista breve, seconda
passata a dimensione piena solo su quella. Il costo cresce col quadrato dei candidati, non
della memoria.

### 12.2 · La scala di quantizzazione che pgvector ha già

Il limite che conta non è quello che pensavo. Per `vector`, **l'indice si ferma a 2.000
dimensioni** — ma pgvector offre già tre uscite, e noi giriamo su **0.8.5**:

| Tipo | Tetto indicizzabile | Costo |
|---|---|---|
| `vector` | 2.000 dimensioni | 4 byte per dimensione |
| `halfvec` | **4.000** | 2 byte — **metà dello spazio** |
| `bit` (quantizzazione binaria) | **64.000** | 1 bit per dimensione |
| `sparsevec` | 1.000 elementi non nulli | solo i non nulli |

Questo rende la scala di domani già disponibile oggi: `bit` per la lista breve, `halfvec` per
il riordino, `vector` pieno solo dove serve precisione. E siccome `memory_vectors` è già
separata per `(record_id, model_id)`, **aggiungere un livello di quantizzazione è una tabella
in più, non una migrazione dei record.**

### 12.3 · Il principio che la ricerca conferma, e che avevamo già

La letteratura 2026 sull'attribuzione arriva alla stessa conclusione di §5, e le dà un nome
utile: **vincolo architetturale contro rilevamento probabilistico**. Verificare
meccanicamente che una citazione esista nel contesto recuperato previene l'allucinazione
*per costruzione* — un modello non può citare ciò che non ha visto — e questo batte qualunque
punteggio di confidenza calcolato a posteriori.

È esattamente il motivo per cui le tre semantiche sono separate **dallo schema** e non dalla
buona condotta, e perché `derived_must_cite` è un `CHECK` e non una revisione.

Un affinamento che prendiamo dalla stessa letteratura: l'attribuzione fine cita **il passaggio
esatto**, non l'identificatore del documento. Conseguenza sulla segnatura: per il Corpus
l'indirizzo deve arrivare al **passaggio**, non al file. Un elemento del Corpus è
`.../<documento>#<passaggio>`, e senza quel suffisso non è citabile.

### 12.4 · Cosa questo impone al progetto, oggi

Tre vincoli che non costano nulla adesso e che risparmiano una migrazione dopo:

1. **`memory_vectors` non assume il tipo del vettore.** La colonna sia sostituibile
   (`vector` → `halfvec` → `bit`) senza toccare `memory_records`. È già così: il tipo vive
   nell'indice, non nel record.
2. **`embedding_models` registra anche `supports_matryoshka` e le dimensioni valide.**
   Una riga in più oggi; senza, il giorno in cui si adotta MRL non si sa quali vettori si
   possono troncare e quali no.
3. **La segnatura del Corpus arriva al passaggio.** Cambiarla dopo significherebbe invalidare
   ogni citazione già emessa — e la segnatura è immutabile per progetto.

### 12.5 · Cosa resta onestamente aperto

- **Nessuno dei modelli citati è installato qui.** MRL è una proprietà del modello: si ottiene
  scegliendone uno addestrato così, non aggiungendo codice.
- **Non abbiamo misurato niente di tutto questo su dati nostri.** I numeri della letteratura
  valgono come direzione, non come prova: la copertura di proiezione impone che una cosa non
  misurata non sia dichiarata vera.
- **Il riordino a due passate ha senso oltre una certa scala**, e sotto è complessità in più.
  La soglia va misurata quando la biblioteca esiste, non decisa adesso.

**Fonti:** [Matryoshka Embeddings — Sentence Transformers](https://sbert.net/examples/sentence_transformer/training/matryoshka/README.html) ·
[pgvector](https://github.com/pgvector/pgvector) ·
[Scalar and binary quantization for pgvector — Jonathan Katz](https://jkatz05.com/post/postgres/pgvector-scalar-binary-quantization/) ·
[What's new in pgvector v0.7.0](https://supabase.com/blog/pgvector-0-7-0) ·
[Learning Fine-Grained Grounded Citations for Attributed LLMs](https://arxiv.org/pdf/2408.04568) ·
[Citation-Grounded Code Comprehension](https://arxiv.org/html/2512.12117v1)

---

## 13. Matrice di accettazione

Stessa premessa dei documenti `03 §10` e `08 §11`. **Nulla di questo documento è
implementato** (dichiarato in apertura): ogni criterio qui è scritto per quando lo sarà,
non per oggi — la tabella esiste perché altrimenti non ci sarebbe modo controllabile di
dire "fatto" quando il lavoro comincia. Severità: **C**ritica / **A**lta / **M**edia.

| ID | Criterio | Sev | Verifica | Stato |
|---|---|---|---|---|
| `CUBE-001` | Un record è immutabile nella segnatura; una correzione crea un nuovo record con `superseded_by`, mai un `UPDATE` distruttivo | **C** | trigger `signature_is_immutable` (§9.2), test che tenta l'`UPDATE` e verifica il rifiuto | ✅ COSTRUITO (`D-0261`, migrazione `0017`) — trigger provato dal vivo contro un PostgreSQL reale usa e getta: un `UPDATE` che cambia la segnatura è rifiutato con l'eccezione; un `UPDATE` su un campo ordinario passa |
| `CUBE-002` | Un elemento `derived=true` non è mai emesso senza le sue fonti | **C** | `CONSTRAINT derived_must_cite` (§9.2), test che tenta un `INSERT` senza `derived_from` | ✅ COSTRUITO (`D-0261`) — provato dal vivo: `INSERT` con `derived=true` e `derived_from={}` rifiutato |
| `CUBE-003` | Un candidato non tracciabile a un evento di sessione non viene emesso dalla compattazione (fallire chiuso, §4.1 regola 3) | **C** | test sulla pipeline di compattazione con un evento sintetico non riconducibile | ⏳ non costruito — richiede la pipeline applicativa (fase C successiva), non solo lo schema |
| `CUBE-004` | Le tre semantiche di `05` sono separate da tabelle/tipi diversi — un elemento del Cubo 3 (Corpus) non è restituibile come affermazione del Cubo 1 (Biblioteca) nemmeno per un errore di programmazione | **C** | test di tipo/schema che tenta la confusione e verifica il rifiuto strutturale, non applicativo | ✅ **CHIUSO (`D-0262`)** — l'Owner ha scelto viste tipate + `REVOKE`, non tabelle separate: quattro viste (`library_memories`/`workshop_memories`/`corpus_memories`/`experience_memories`), ciascuna `WHERE cube = '<x>' WITH CHECK OPTION`, `memory_records` non più raggiungibile direttamente da `noesar_app`. Un `INSERT`/`UPDATE` che tenta di far apparire un cubo attraverso la vista sbagliata è respinto strutturalmente dalla vista stessa, non da una convenzione applicativa — provato dal vivo (`CUBE04-01..08`, 57/57 PASS, incluso il tentativo esplicito di confusione). Le viste sono possedute da `noesar_migrator` (non dal superuser che esegue la migrazione) proprio per evitare che la RLS venga bypassata dall'ownership — vedi `docs/DECISION_LOG.md` `D-0262` per il dettaglio, incluso un secondo difetto indipendente trovato e riparato nella stessa passata (le policy di `0017` erano `RESTRICTIVE` senza alcuna `PERMISSIVE`, quindi negavano sempre) |
| `CUBE-005` | Un vettore senza l'identità del modello che l'ha prodotto non è confrontabile: ogni query filtra per `model_id` corrente | **C** | test di confronto fra due spazi diversi (stessa classe di `CE-012`, qui a livello di schema `memory_vectors`) | ✅ SCHEMA COSTRUITO (`D-0261`) — `embedding_models`+`memory_vectors(record_id, model_id)` con indice unico parziale `is_current`, provato dal vivo: un secondo modello `is_current=true` è rifiutato. **Il difetto originale (`vector_entries` senza identità di modello) resta aperto e indipendente**, vedi §9.1 |
| `CUBE-006` | Il richiamo (`recall`) restituisce sempre `coverage` e `not_found`, mai silenziosamente parziale | **A** | test sul contratto `recall()` (§9.4) con un insieme di candidati noto | ⏳ non costruito — richiede la pipeline applicativa |
| `CUBE-007` | Le nove categorie sono un registro chiuso (`CHECK` nello schema), non stringa libera | **M** | tentativo di `INSERT` con una categoria fuori lista, verifica del rifiuto a livello di schema | ✅ COSTRUITO (`D-0261`) — provato dal vivo: `INSERT` con categoria fuori lista rifiutato dal `CHECK` |
| `CUBE-008` | Un cambio di modello di embedding non perde record — solo re-indicizza, coi vecchi vettori che continuano a servire finché il nuovo indice non è completo | **A** | procedura di cambio modello (§9.3) misurata end-to-end su un corpus di prova | ⏳ non costruito |
| `CUBE-009` | L'utente non vede la tassonomia a quattro cubi — una sola destinazione `Memoria`, tre gesti (cerca/sfoglia/approva), parole normali mai `promotion_state`/`contamination`/`cube` | **A** | ispezione della WebUI: nessuna di quelle tre parole compare fuori da una vista di dettaglio esplicitamente richiesta | ⏳ non costruito |
