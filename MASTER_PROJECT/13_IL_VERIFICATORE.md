# 13 · Il verificatore — la soluzione al problema della probabilità

**La tua domanda:** il modello lavora su probabilità, quindi sbaglierà sempre. Non voglio che
ATOM si limiti a "elaborare la risposta". Voglio un sistema che, ricevuta la risposta, dentro
una sandbox — una specie di cervello che pensa ed elabora — esamini, testi, provi, e capisca
**dove è lo sbaglio** e **qual è il contesto della domanda**.

**Questa è la risposta, e non è teorica: è misurata.** Esperimenti in
`experiments/verificatore/`, referto completo in `REPORT.md`, rieseguibili con un comando.

---

## 1. Perché "elaborare meglio la risposta" non può funzionare

La strada naturale è: il modello risponde, e poi qualcosa giudica se la risposta è buona.
**È già stata provata e misurata, e non funziona.**

| Verificatore | Cattura gli errori | Falsi allarmi |
|---|---|---|
| **Che giudica** una firma superficiale | 0,42 | **0,37 → 0,95** |
| **Che ricalcola** in modo indipendente | **1,00** | **0,00** |

Il verificatore che giudica, in estrapolazione, segnalava errore **al 95% delle risposte
giuste**. Un controllo che grida al lupo su tutto è un controllo che si impara a saltare, ed è
peggio di non averlo.

La ragione è strutturale, non di qualità: **un giudizio probabilistico su un output
probabilistico resta probabilistico.** Due monete non fanno una certezza.

---

## 2. Il principio: non si verifica la risposta, si verificano le sue proiezioni

Il Gradino 18 aveva risolto il problema nell'aritmetica con la **prova del nove**: non
controllava la risposta, controllava il suo **residuo modulo 9**, ricalcolato **dagli operandi
originali** — mai dal percorso della risposta, che poteva essere quello sbagliato.

Generalizzato:

> **Una risposta non si accetta come risposta. Si riduce a un insieme di affermazioni, e ogni
> affermazione si proietta su qualcosa che si può RICALCOLARE. Si controlla la proiezione.
> Ciò che non ammette proiezione si dichiara NON VERIFICABILE — mai "passato".**

Il livello giusto di scomposizione è quello del calcolo atomico: **si scompone finché
verificare non è più un'opinione.**

---

## 3. La funzione, in dettaglio

```text
   domanda Q  +  contesto C  ──▶  MODELLO  ──▶  risposta A (probabilistica, può sbagliare)
                                                      │
   ┌──────────────────────────────────────────────────▼──────────────────────────────┐
   │  SANDBOX DI VERIFICA — il "cervello che elabora"                                │
   │  Non giudica. Ricalcola. Non ha accesso alla rete né al workspace reale.        │
   │                                                                                  │
   │  1  RIDUZIONE      A ──▶ affermazioni atomiche a₁ … aₙ                          │
   │  2  CLASSIFICAZIONE ogni aᵢ ──▶ che tipo di ricalcolo ammette                   │
   │  3  PROIEZIONE     ogni aᵢ ──▶ una o più quantità ricalcolabili da C            │
   │  4  RICALCOLO      da C, MAI da A                                               │
   │  5  CONFRONTO      uguaglianza esatta                                            │
   │  6  LOCALIZZAZIONE quale aᵢ discorda, e di quanto                                │
   │  7  COPERTURA      quale frazione di A è stata effettivamente controllata        │
   └──────────────────────────────────┬───────────────────────────────────────────────┘
                                      ▼
       PASS            tutte le proiezioni coincidono, copertura dichiarata
       FAIL(aᵢ)        aᵢ discorda — si sa QUALE e di QUANTO
       NON VERIFICABILE nessuna proiezione esiste — e lo si dice
```

### 3.1 · I sei tipi di affermazione e il loro ricalcolo

| Tipo | Cos'è | Come si ricalcola | Verità di terreno |
|---|---|---|---|
| **CALCOLO** | un numero derivato dai dati | si ricalcola dai dati originali | i dati |
| **ESECUZIONE** | codice, query, comando | **si esegue** contro le asserzioni della specifica | l'esecuzione |
| **CITAZIONE** | "il documento dice X" | si localizza X nella fonte; quantità e polarità devono corrispondere | la fonte |
| **VINCOLO** | la domanda vietava Y | si confrontano gli **effetti dichiarati** del piano con i divieti | la domanda |
| **COERENZA** | due parti della risposta si implicano | si ricalcola la derivata dalla primitiva | la risposta stessa |
| **RISPONDE** | la risposta soddisfa la domanda | se la risposta è derivabile dai dati, si deriva | i dati + i criteri |
| *(OPINIONE)* | giudizio, previsione, preferenza | **nessun ricalcolo esiste** | — → NON VERIFICABILE |

### 3.2 · Le due regole che rendono il ricalcolo indipendente

1. **Si ricalcola dai dati originali, mai dalla risposta.** Se il verificatore riparte dai
   numeri che la risposta ha prodotto, eredita il suo errore. È l'errore che uccise il
   verificatore del Gradino 17.
2. **Confronto per uguaglianza esatta, mai per somiglianza.** *"È circa giusto"* è un giudizio,
   e i giudizi sono la cosa che stiamo sostituendo.

### 3.3 · Il ciclo di riparazione — dove si usa la localizzazione

Sapere **quale** affermazione è rotta è ciò che rende la riparazione economica:

```text
   FAIL(a₃)  ──▶  si rigenera SOLO a₃, con allegato:
                    · cosa aveva detto
                    · cosa il ricalcolo ha ottenuto
                    · da quali dati
                  a₁, a₂, a₄ … restano intatte — non erano sbagliate
                       │
                       ▼
                  si riverifica solo a₃
                       │
                  stessa firma di fallimento due volte?  ──▶  si sale la scala (documento 02, §10)
```

Rigenerare l'intera risposta è lo spreco tipico: butta via il lavoro giusto insieme a quello
sbagliato, e non impara niente.

---

## 4. Cosa dicono le misure

### Round 1 — 1200 prove, sei domini

| | Ricalcolo | Giudice di superficie |
|---|---|---|
| Cattura (537 errori) | **1,0000** | 0,4246 |
| Falsi allarmi (561 risposte giuste) | **0,0000** | 0,2834 |
| Localizzazione dell'errore | **1,0000** | — |
| Onestà sui non verificabili (102) | **1,0000** | — |

Tutte e cinque le soglie KILL: **PASS**.

**Due difetti trovati durante il run, e il primo è quello che vale.** Il primo giro dava 6,42%
di falsi allarmi — **KILL**. Causa: avevo scritto io un valore atteso sbagliato in un test.
**Il verificatore aveva ragione e io torto.** È esattamente il mestiere per cui esiste, ed è la
ragione per cui la soglia va dichiarata *prima*: senza, avrei abbassato la soglia invece di
guardare la causa. Il secondo: `'5%'` risulta contenuto in `'2,5%'`, quindi un'allucinazione
passava — corretto con confronto per token interi.

### Round 2 — l'avversario: **5 attacchi su 6 sfuggono**

Un 1,0000 non attaccato non è un risultato. Ho costruito gli errori che il ricalcolo **non
può** vedere:

| | Attacco | Esito |
|---|---|---|
| A1 | Codice che passa tutti i test dati ed è sbagliato fuori | **sfuggito** |
| A2 | Citazione con le stesse parole e il senso rovesciato | **sfuggito** |
| A3 | Vincolo aggirato con un sinonimo | **sfuggito** |
| A4 | Totale giusto, righe sbagliate | **sfuggito** |
| A5 | Criterio soddisfatto, contenuto irrilevante | **sfuggito** |
| A6 | *Controllo:* perturbare un totale ricalcolato per intero | **catturato** — 100.000 prove, 0 sfuggite |

> **Il risultato vero:** il ricalcolo cattura esattamente gli errori che **spostano una
> proiezione controllata**. Nient'altro. L'1,0000 del Round 1 non era una proprietà del metodo:
> era una proprietà del mio iniettore.

E ciò che resta incondizionato: **l'uguaglianza esatta su una proiezione ricalcolata per intero
non ha punti ciechi** — 100.000 perturbazioni, zero sfuggite.

### Round 3 — le chiusure: **5 su 5**

| | Contromisura | Attacco | Falsi allarmi introdotti |
|---|---|---|---|
| C1 | Test di **proprietà** su 500 input casuali contro un oracolo | catturato, **412/500** discordanze | **0/500** |
| C2 | Controllo di **polarità** (parità delle negazioni) | catturato | 0 |
| C3 | **Effetti dichiarati** invece della denylist testuale | catturato | 0 |
| C4 | **Quattro proiezioni indipendenti** invece di una | catturato | 0 |
| C5 | **Derivabilità**: se si ricalcola, si ricalcola; se no, NON VERIFICABILE | catturato | 0 |

**C3 è la più importante concettualmente**, e non è una denylist migliore: è smettere di
guardare **le parole** e guardare **gli effetti**. Un piano dichiara i propri effetti e la
sandbox li applica — nessun sinonimo aggira un permesso che non è stato concesso. È esattamente
il capability token del documento 04, e questo esperimento ne è la giustificazione empirica.

**C5 è l'unica che accetta di non chiudere**, ed è un confine dichiarato invece di una toppa.

---

## 5. L'invenzione: la **copertura di proiezione**

Da tutto questo esce una quantità che prima non c'era, e che è la cosa concreta da portarsi via:

> **Verificare non è una proprietà sì/no. È una copertura.**
> Non *"il verificatore è buono?"* ma *"quante proiezioni indipendenti ho controllato di questa
> risposta, e cosa resta scoperto?"*

```text
  Risposta con 7 affermazioni
    5 proiettate e ricalcolate       ✓ tutte coincidono
    1 proiettata parzialmente        ⚠ una proiezione su tre possibili
    1 non proiettabile               ○ opinione — dichiarata

    COPERTURA DI PROIEZIONE  5,3 / 7  =  76%
    NON CONTROLLATO          l'affermazione 6 su due proiezioni; l'affermazione 7 per intero
```

È misurabile, si riporta, si migliora — **come la copertura dei test, ma per le risposte**. E ha
tre conseguenze immediate:

1. **Va nella Prova di Sessione.** Il pacchetto non dice più "verificato": dice *quanto* è stato
   verificato e **cosa non lo è stato**. È la differenza fra una rassicurazione e una prova.
2. **Diventa un criterio di autorizzazione.** Una modifica ad alto rischio con copertura sotto
   una soglia non si esegue: si aumenta la copertura o si chiede a una persona.
3. **Dà una direzione di miglioramento chiara.** Alzare la copertura è un lavoro definito —
   aggiungere proiezioni — invece di "rendere l'AI più intelligente", che non lo è.

---

## 6. Cosa questo NON risolve — il confine, dichiarato

- **Non rende il modello corretto.** Il modello sbaglierà con la stessa frequenza di prima. Ciò
  che cambia è che gli errori proiettabili **non arrivano più a te**.
- **Non cattura ciò che non ha una proiezione.** Un'opinione, una previsione, una preferenza:
  restano NON VERIFICABILI per sempre, e il valore sta nel dirlo.
- **La copertura non sarà mai 100%** su una risposta in linguaggio libero, e affermarlo sarebbe
  lo stesso genere di bugia che questo meccanismo esiste per eliminare.
- **Gli esperimenti misurano il verificatore, non il sistema completo.** Non c'è un modello vero
  nel circuito: gli errori sono iniettati con verità di terreno nota. È la scelta giusta per
  misurare un rilevatore, e non permette di dire nulla su quanto spesso un modello reale sbagli.
- **Il giudice di controllo è di superficie, non un giudice-LLM.** Un LLM giudice potrebbe fare
  meglio del 42% — il confronto è indicativo, non definitivo.
- **Le chiusure del Round 3 hanno controlli negativi piccoli** (2-3 casi per C2 e C3). Prova di
  concetto, non validazione: vanno integrate nel banco a 1200 prove e rimisurate.

---

## 7. Dove si innesta

| Documento | Cosa cambia |
|---|---|
| **02 · ATOM** | Il contratto acquista `project` (elenca le proiezioni di un'affermazione) accanto a `expect`. `decompose` scende fino al livello proiettabile, non a un livello generico. |
| **04 · Sicurezza** | C3 è la giustificazione empirica dei capability token: **effetti, non parole**. |
| **06 · CodeN Evolution** | Lo stadio 15 *Verifica* diventa questo. Lo stadio 16 riporta la copertura. |
| **01 · Prova di Sessione** | Nuovo campo: `copertura` — quante proiezioni, quali, e cosa è rimasto scoperto. |
| **09 · Piano** | Fase 1 acquista il verificatore a proiezioni: senza, l'esecuzione in ombra confronta due cose e non sa dire *dove* differiscono. |

## 8. Cosa farei subito, se autorizzi

1. **Integrare le cinque chiusure nel banco principale** e rimisurare a 1200 prove: oggi sono
   provate isolatamente.
2. **Aggiungere un settimo dominio non sintetico** — prendere risposte reali su un repository
   vero e misurare la copertura di proiezione ottenibile. È il numero che dice se questo
   funziona nel mondo, e nessun esperimento sintetico può darlo.
3. **Mettere un modello vero nel circuito** e misurare end-to-end: quanti errori reali sono
   proiettabili. Sospetto molti meno del 100% del banco sintetico, ed è il numero che conta
   davvero.
