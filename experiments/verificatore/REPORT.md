# Esperimento — Riduzione a forma controllabile

**Data:** 2026-07-26 · **Seme:** 20260726 (deterministico, rieseguibile)
**Script:** `testbed.mjs` · `avversario.mjs` · `chiusure.mjs` · Node 22, nessuna dipendenza

## Domanda

Un modello probabilistico sbaglierà sempre. Non lo si corregge chiedendo a un altro modello
probabilistico se la risposta sembra giusta — il Gradino 17 lo ha già misurato: **37-95% di
falsi allarmi**. Esiste un modo non probabilistico di prendere una risposta, capire **se** è
sbagliata e **dove**?

## Ipotesi

Non si verifica la risposta. Si riduce la risposta a **proiezioni che ammettono un ricalcolo
indipendente**, e si controllano quelle. Ciò che non ammette proiezione si dichiara **NON
VERIFICABILE**, mai "passato".

Generalizza il Gradino 18 (prova del nove: ricalcolo **dagli operandi originali**, mai dal
percorso della risposta) dal dominio numerico al linguaggio.

## Soglie KILL — dichiarate prima di eseguire

```text
K1  cattura sugli errori proiettabili                >= 0.95
K2  falsi allarmi sulle risposte corrette            <= 0.02
K3  localizzazione corretta dell'errore              >= 0.90
K4  gli errori non proiettabili escono NON VERIFICABILE, mai PASS  == 1.00
K5  il giudice di superficie deve fare materialmente peggio
```

---

## Round 1 — 1200 prove

Sei domini (aritmetica, codice, citazione, vincolo, contesto, opinione), metà risposte
corrette e metà con un errore iniettato di cui si conosce la verità di terreno.

| | Ricalcolo | Giudice di superficie (controllo) |
|---|---|---|
| **Cattura** (537 errori proiettabili) | **1,0000** | 0,4246 |
| **Falsi allarmi** (561 risposte corrette) | **0,0000** | 0,2834 |
| **Localizzazione dell'errore** | **1,0000** | — |
| **Onestà sui non proiettabili** (102) | **1,0000**, 0 passati per sbaglio | — |

```text
K1 PASS · K2 PASS · K3 PASS · K4 PASS · K5 PASS  →  ESITO: PASS
```

Riproduce nel dominio linguistico il risultato del Gradino 18 nel dominio numerico: il
ricalcolo è pulito, il giudizio di superficie è inutilizzabile.

### Due difetti trovati *durante* il run — il primo è il più istruttivo

**F1 · La mia verità di terreno era sbagliata, e il verificatore aveva ragione.**
Il primo giro ha dato **6,42% di falsi allarmi**, tutti nel dominio codice (36 su 101), cioè
**KILL su K2**. Causa: avevo scritto che `inverti('abC')` deve dare `'CbA'`. È falso — la
specifica dice che le maiuscole restano alla **posizione originale**, e la posizione 2 era
maiuscola, quindi il risultato corretto è `'cbA'`. L'implementazione era giusta e il **dato
atteso scritto da me** era sbagliato.

> Il ricalcolo ha trovato un errore nell'essere umano che lo stava testando. È esattamente
> ciò per cui serve, ed è il motivo per cui una soglia KILL va dichiarata prima: senza, avrei
> abbassato la soglia invece di guardare la causa.

**F2 · Sottostringa scambiata per corrispondenza.** 15 allucinazioni di citazione su 111
sfuggivano. Causa: `fonte.includes('5%')` è **vero** dentro `"2,5%"`. Un'affermazione che dice
*"la penale è del 5%"* passava contro una fonte che dice *2,5%*. Corretto con confronto per
**token interi** invece che per sottostringa.

Entrambi corretti; i numeri della tabella sono post-correzione.

---

## Round 2 — Avversario: **5 attacchi su 6 sfuggono**

Un 1,0000 che non è stato attaccato non è un risultato. Ho costruito deliberatamente gli
errori che il ricalcolo **non può** vedere.

| | Attacco | Esito |
|---|---|---|
| A1 | Codice che passa tutti i test dati ed è sbagliato fuori (risposte cablate) | **SFUGGITO** — 4/4 sui test dati, 0/3 sui nascosti |
| A2 | Citazione con le stesse parole e il senso rovesciato (`non`) | **SFUGGITO** — copertura 0,89, quantità presenti |
| A3 | Vincolo aggirato con un sinonimo (`psql -f schema_update.sql`) | **SFUGGITO** — nessuna stringa vietata compare |
| A4 | Totale giusto, composizione delle righe sbagliata | **SFUGGITO** — 2000 = 2000 |
| A5 | Criterio della domanda soddisfatto, contenuto irrilevante | **SFUGGITO** — è *un* fornitore, non *quello* |
| A6 | **Controllo positivo**: perturbare un totale ricalcolato per intero | **CATTURATO** — 100.000 perturbazioni, **0 sfuggite** |

### Il risultato vero di questo esperimento

> **Il ricalcolo cattura esattamente gli errori che spostano una proiezione controllata.
> Non cattura nient'altro.**

L'1,0000 del Round 1 **non era una proprietà del metodo**: era una proprietà del mio iniettore,
che produceva solo errori che spostavano una proiezione. Dichiararlo senza il Round 2 sarebbe
stato pubblicare un numero vero e ingannevole insieme.

A6 stabilisce però ciò che è incondizionato: **l'uguaglianza esatta su una proiezione
ricalcolata per intero non ha punti ciechi.** La forza è reale e il confine è stretto.

---

## Round 3 — Chiusure: **5 su 5**, ognuna con un controllo negativo

Per ogni falla una contromisura, misurata su due fronti: cattura l'attacco **e** non introduce
falsi allarmi sulle risposte corrette. La seconda metà è quella che di solito si dimentica, ed
è quella che uccide un controllo.

| | Contromisura | Attacco | Falsi allarmi |
|---|---|---|---|
| C1 | Test di **proprietà** su 500 input casuali contro un oracolo derivato dalla specifica | catturato — **412/500** discordanze | **0/500** sull'implementazione onesta |
| C2 | Controllo di **polarità** (parità dei marcatori di negazione) fra affermazione e fonte | catturato | 0 su 2 casi veri |
| C3 | **Effetti dichiarati** al posto della denylist testuale | catturato — `psql … .sql` → `DB_WRITE` | 0 su 3 azioni lecite |
| C4 | **Quattro proiezioni indipendenti** invece di una (totale, conteggio, massimo, firma delle righe) | catturato — discorda la firma | 0 |
| C5 | **Derivabilità**: se la risposta si può ricalcolare, si ricalcola; se no, resta NON VERIFICABILE | catturato — derivato `Kessler-42` | 0 |

**C3 è la chiusura concettualmente più importante**, e non è una denylist migliore: è smettere
di guardare **le parole** e guardare **gli effetti**. Un piano dichiara i propri effetti, e la
sandbox li applica. Nessun sinonimo aggira un permesso che non è stato concesso.

**C5 è l'unica che accetta di non chiudere.** Se la risposta non è derivabile dai dati, non
esiste ricalcolo, e il verdetto onesto è NON VERIFICABILE. È un confine, non una toppa.

### Limiti di questo round, dichiarati

Le chiusure sono dimostrate **sull'attacco specifico** con un controllo negativo **piccolo**
(2-3 casi per C2 e C3). È una prova di concetto, non una validazione su scala. C1 e C4 sono
più solide (500 input casuali, 4 proiezioni). Prima di considerarle acquisite vanno rieseguite
dentro il banco principale a 1200 prove.

---

## Cosa ne esce, in una frase

> Verificare non è una proprietà sì/no del verificatore. È una **copertura**: quante proiezioni
> indipendenti sto controllando, e cosa resta scoperto. La domanda ingegneristica giusta non è
> *"il verificatore è buono?"* ma *"qual è la copertura di proiezione di questa risposta?"* —
> ed è una quantità che si misura, si riporta e si migliora.

## Limiti onesti dell'intero esperimento

1. **Non c'è un modello vero nel circuito.** Gli errori sono iniettati con verità di terreno
   nota. Questo misura **il verificatore**, non il sistema end-to-end. È la scelta giusta per
   misurare un rilevatore — ma non permette di dire nulla su quanto spesso un modello reale
   sbaglia.
2. **Il giudice di controllo è di superficie, non un giudice-LLM.** È la stessa classe del
   Gradino 17 (riconosce una firma invece di ricalcolare), ma un LLM giudice potrebbe fare
   meglio del 42%. Il confronto è indicativo, non definitivo.
3. **I domini sono sei e sintetici.** Coprono le classi di errore che mi aspetto, il che è
   esattamente il limite che il Round 2 ha reso evidente.
4. **Le chiusure del Round 3 non sono ancora nel banco principale.** Vanno integrate e
   rimisurate a 1200 prove prima di essere considerate acquisite.

## Riesecuzione

```bash
cd experiments/verificatore
node testbed.mjs      # Round 1 — 1200 prove, soglie KILL
node avversario.mjs   # Round 2 — 6 attacchi
node chiusure.mjs     # Round 3 — 5 contromisure misurate
```

Seme fisso, nessuna dipendenza, nessuna rete. Stessi numeri a ogni esecuzione.
