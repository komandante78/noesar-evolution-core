# 02 · ATOM — il cuore

Questo è il documento centrale. Tutto il resto del progetto discende da qui.

---

## 1. Cos'è ATOM, in una frase

> **ATOM è il modo in cui questo prodotto decide: scompone un compito fino al livello in cui
> verificare significa RICALCOLARE invece che giudicare, poi pianifica, simula, esegue e
> ricontrolla — e lascia dietro di sé la prova di averlo fatto.**

Non è un modello. Non è un assistente. È il **percorso obbligatorio** che ogni decisione
attraversa prima che il prodotto possa cambiare qualcosa.

## 2. Attenzione — "ATOM" indica tre cose su questo server

Confonderle fa perdere tempo, ed è già successo.

| | Cos'è | Riguarda questo progetto? |
|---|---|---|
| **ATOM Evolution** | Il provider di ragionamento di NOESAR Evolution, dietro un contratto pubblico congelato | **SÌ — è questo documento** |
| **ATOM-seam** | Un verificatore già innestato nel binario di CodeN Ultra (altro prodotto) | No, non si tocca |
| **ATOM MODEL** | Il modello modulare a router+esperti in costruzione nel laboratorio | **Fornisce i meccanismi provati**, vedi §4 |

I meccanismi che ATOM Evolution usa **non sono inventati qui**: sono stati validati in 38
esperimenti nel laboratorio, con soglie dichiarate prima di allenare e held-out mai visti.
Questo è ciò che distingue questo progetto da una promessa architetturale.

---

## 3. Il principio radice: il livello atomico è dove esiste una tabella finita

Nel laboratorio, il "calcolo atomico" ha una definizione operativa precisa: **l'operazione al
livello più fine in cui esistono solo 100 fatti possibili** — prodotto cifra×cifra, o somma a
due soli termini con riporto. A quel livello non serve giudicare se una risposta è giusta:
si guarda la tabella.

Generalizzato, questo è il principio portante di tutto il prodotto:

> **Scomponi finché verificare non è più un'opinione.**

La conseguenza pratica, e vale ovunque nel prodotto:

| Livello | Verificare significa | Affidabile? |
|---|---|---|
| Compito intero | "sembra giusto" | No |
| Passo grosso | un modello giudica un altro modello | No — 37-95% di falsi allarmi (misurato) |
| **Passo atomico** | **ricalcolo, confronto, tabella** | **Sì — 100% cattura, 0% falsi positivi (misurato)** |

## 4. Cosa è già dimostrato, con i numeri

Tutti misurati nel laboratorio `RETE_NEURALE_TEST`, stessa architettura, stesso held-out,
unica variabile cambiata di volta in volta.

| Meccanismo | Prova | Numero |
|---|---|---|
| **La decomposizione atomica funziona** | salto diretto → prodotti parziali → assemblaggio a due termini | 0.790 → 0.997 → **1.000 esatto, zero errori** |
| **Il verificatore deve RICALCOLARE, non giudicare** | verificatore-ricalcolo contro verificatore-classificatore | **100% cattura / 0% falsi positivi** contro **37-95% falsi allarmi** |
| **Il pianificatore deve essere una procedura, non una tabella** | su lunghezze mai viste in training | **1.000** contro **0.068** del monolite |
| **Comporre esperti piccoli batte un blocco grosso** | router + 2 esperti piccoli contro monolite della stessa dimensione totale | **+46%** |
| **Il ciclo pianifica→esegui→verifica→correggi regge lontano** | verifica economica a ogni passo | **1.000 fino a 15× la lunghezza vista in training** |
| **Gli esperti devono essere categoricamente distinti** | router ottimo su esperti indistinguibili | degrada da 1.000 a **0.69**, e nessuna gerarchia lo salva |
| **L'elaborazione mirata sui punti deboli funziona** | decomposizione esplicita solo dove il diretto fallisce | **0.39 → 0.87** sui deboli, i forti intatti |

E i fallimenti, altrettanto utili:

| Cosa NON funziona | Prova |
|---|---|
| Far scoprire la decomposizione da solo dal risultato finale | **peggio del baseline** (0.093 contro 0.116) |
| Sintetizzare codice dai soli esempi input/output, senza specifica | **fallimento totale**, 0.0 su held-out |
| "Sistemare" un RL già buono senza isolare le variabili | 3 tentativi indipendenti, **tutti e 3 peggiorano** |

**La conseguenza diretta per il prodotto**, ed è vincolante:

- Un compito deve **sempre** portare una specifica esplicita. Mai dedurre cosa si vuole dal
  solo comportamento osservato. Questo diventa l'**Intent Frame**, stadio 2 del ciclo.
- Il verificatore **ricalcola**. Non chiediamo mai a un modello se il risultato sembra
  corretto. Questo diventa l'**esecuzione in ombra**, che è del motore e non del provider.
- I sotto-agenti sono **categoricamente distinti** (architettura, backend, test, sicurezza),
  mai fette sottili dello stesso continuo.

---

## 5. Il contratto: come il prodotto parla ad ATOM

`ReasoningProvider` è un contratto **pubblico, versionato e congelato**. È l'unica strada che
il motore ha per ottenere un piano. Oggi **non esiste in codice**: è il primo pezzo da
costruire.

| Superficie | Il motore manda | Torna indietro | Obbligatoria? |
|---|---|---|---|
| `interpret` | la richiesta, le regole di progetto, il digest della mappa | **Intent Frame**: obiettivo, non-obiettivi, criteri di successo, ambiguità | sì |
| `hypothesize` | l'Intent Frame, l'evidenza raccolta | **ipotesi causali in ordine**, ognuna con prove a favore *e contrarie* | sì |
| `plan` | le ipotesi scelte, i vincoli, la modalità | **Piano**: passi ordinati, file, comandi, dipendenze, raggio d'azione | sì |
| `decompose` | un passo troppo grosso per essere verificato | lo stesso passo spezzato fino al livello verificabile | sì |
| `expect` | il Piano | **cosa deve succedere**: quali test passano, quali falliscono apposta, cosa il diff deve toccare | **sì — è ciò che rende definibile la "sorpresa"** |
| `constrain` | il Piano e la policy attiva | il Piano ristretto, o rifiutato con una ragione | sì |
| `classify` | il Piano | classe di rischio per passo e per piano | sì |
| `confidence` | Piano e risultati | un numero, **e le ragioni per cui non è più alto** | sì |
| `evidence` | qualunque affermazione mostrata a una persona | le fonti che la sostengono, oppure "inferenza, non supportata" | sì |
| `cancel` | un piano in corso | uno stop pulito che lascia un checkpoint riprendibile | sì |
| `simulate` | il Piano contro un workspace ombra | diff previsto ed esito previsto **senza eseguire** | **no — è il vantaggio di ATOM** |
| `fixtures` | l'id di una sessione | il pacchetto di replay deterministico | sì |

Le cinque portanti sono `interpret`, `hypothesize`, `plan`, `decompose`, `expect`. Le altre
sono ciò che rende il prodotto onesto.

## 6. La simulazione è tre livelli, e solo uno è di ATOM

Questo è il punto che rende il core pubblico **non mutilato**.

| Livello | Chi lo fa | Cos'è | Serve intelligenza? |
|---|---|---|---|
| **1 · Esecuzione in ombra** | **il motore, sempre** | applica il piano a una copia, esegue i test mirati, cattura cos'è successo | **nessuna** |
| **2 · Attesa dichiarata** | **ogni provider, obbligatorio** | il piano dichiara cosa deve succedere | quasi nessuna |
| **3 · Simulazione predittiva** | **ATOM** | dire cosa succederà *senza eseguirlo*, prevedere modi di fallire mai visti, scegliere fra piani diversi | sì, molta |

**I livelli 1 e 2 sono tutto ciò che serve per autocorreggersi.** Un piano che non sa dire
cosa si aspetta non è un piano. Quindi il provider di riferimento si autocorregge benissimo.

Il vantaggio di ATOM diventa: **velocità** (scarta un piano cattivo prima di pagare il run in
ombra: su una suite lenta è la differenza fra provare tre approcci e provarne venti),
**portata** (il livello 1 vede solo ciò che i test coprono; prevedere un percorso non testato
è ragionamento e non ha sostituto meccanico), **scelta** (confrontare approcci strutturalmente
diversi richiede un modello di cosa farebbe ciascuno).

## 7. La scala di maturità compra portata, mai permessi

| Livello | Cosa sa fare il provider | Cosa aggiunge |
|---|---|---|
| L0-L2 | interpretare, piani a ipotesi singola, rischio statico | sola lettura, pianificazione |
| **L3-L5** | ipotesi in competizione, raggio d'azione, attesa dichiarata | **modifica guidata, esecuzione guidata, lavoro autonomo in sandbox** |
| L6-L7 | simulazione predittiva, modi di fallire mai osservati | più terreno coperto prima di tornare da te |
| L8 | ricerca causale multi-passo, autocritica, valutazione evolutiva di piani alternativi | piani strutturalmente alternativi |

**Il provider di riferimento pubblico sta a L3-L5, onestamente.** Il core pubblico lavora
anche senza presidio. Un livello più alto compra **quanto terreno copre**, mai il permesso di
controllare il proprio lavoro.

Questo non è generosità: il rischio `R-001` del registro classifica **Critico** «core
pubblico inutilizzabile senza ATOM», e un moat costruito trattenendo il ciclo di sicurezza
renderebbe il build pubblico *pericoloso* — che è esattamente ciò che quel rischio esiste per
impedire, oltre a bruciare la storia dei finanziamenti pubblici.

## 8. ATOM non tocca il mondo esterno

ATOM ragiona. **Nessun accesso al filesystem, nessuna shell, nessuna rete, nessuna
credenziale.** Riceve digest e pacchetti di evidenza che il motore ha preparato, e restituisce
oggetti.

È questo che rende sicuro attaccare un provider proprietario: **attaccare ATOM non può
allargare il raggio d'azione del prodotto, perché il provider non ne ha uno.** La specifica lo
dice già in generale — *"gli adattatori non possono auto-concedersi permessi"* — e qui è
portante.

## 9. Come ATOM lavora, in ordine

```text
  richiesta
     │
     ▼
  interpret     ──▶  Intent Frame: obiettivo, non-obiettivi, criteri, ambiguità
     │
     ▼
  chiarimento   ──▶  le ambiguità si risolvono con la persona, o si registrano come assunzioni
     │
     ▼
  hypothesize   ──▶  ipotesi in ordine, con prove a favore E CONTRARIE
     │
     ▼
  plan          ──▶  passi, file, comandi, dipendenze
     │
     ▼
  decompose     ──▶  finché ogni passo è verificabile per ricalcolo
     │
     ▼
  expect        ──▶  cosa deve succedere — questo rende definibile la sorpresa
     │
     ▼
  simulate      ──▶  (solo ATOM) cosa succederebbe, senza eseguire
     │
     ▼
  classify      ──▶  rischio per passo
     │
     ▼
  [ autorizzazione umana — capability token ]
     │
     ▼
  esecuzione in ombra  ──▶  il MOTORE ricalcola la realtà
     │
     ▼
  atteso ≠ reale ?  ──SÌ──▶  torna a hypothesize con la divergenza come evidenza nuova
     │ NO
     ▼
  esecuzione reale  ──▶  verifica  ──▶  revisione  ──▶  Prova di Sessione
```

## 10. Quando le cose vanno storte: persistenza, non blocco

I modelli che fanno il lavoro sono piccoli. **I modelli piccoli non falliscono fermandosi:
falliscono ripetendosi con sicurezza.** Quindi il controllo non può essere "fermati quando
fatica" — sarebbe trasformare una capacità in un limite.

Il controllo è la **novità imposta**:

> **Un approccio ripetuto non conta come tentativo. Uno nuovo sì.**

Due firme di fallimento identiche esauriscono il gradino e si sale la scala. Firma diversa?
Sta imparando, resta lì. Può lavorare a lungo, **purché ogni minuto contenga qualcosa che non
aveva ancora provato.**

### La scala a otto gradini

```text
  1  Riprova              guasto transitorio — rete, test instabile, timing
  2  Ripianifica          ipotesi successiva, con la sorpresa come evidenza      [ATOM]
  3  Allarga l'evidenza   vicini, cronologia, test, chiamanti
  4  Ricerca              fonti verificate, versionate, query registrate
  5  Decomponi            spezza in un sotto-problema verificabile da solo       [ATOM]
  6  Modello più forte    instrada questo passo su un modello più capace
  7  Piano alternativo    approcci strutturalmente diversi, non varianti         [ATOM L8]
  8  Chiedi               una domanda precisa, con allegato tutto ciò che ha escluso
```

**Il gradino 5 è il più importante**, e i numeri lo dicono: un modello che non sa aggiustare
un sottosistema molto spesso sa aggiustare *una funzione*, se qualcos'altro fa la
decomposizione e sa verificare il pezzo isolato. È lo stesso identico meccanismo che porta la
moltiplicazione da 0.790 a 1.000 — applicato al lavoro reale invece che all'aritmetica.

Il gradino 8 non è un fallimento: è arrivare con una domanda precisa e il conto di tutto ciò
che è già stato escluso.

### La ricerca sul web, senza rompere la privacy

1. **La query la costruisce il motore, non il modello, ed è ispezionabile.** È assemblata da:
   firma dell'errore, nome **e versione** della dipendenza dal manifest, nome del simbolo. Mai
   il tuo sorgente, mai i percorsi dei file, mai il contenuto dei documenti. La stringa esatta
   finisce nel registro **prima** di partire.
2. **"Fonti verificate" significa una allowlist derivata dalle tue stesse dipendenze**:
   documentazione ufficiale delle librerie che il progetto dichiara, riferimento del
   linguaggio, docs presenti nel repository. Un livello generico esiste ed è **spento di
   default**.
3. **Ciò che torna è dato non fidato**, esattamente come il contenuto del repository. È
   **evidenza**: può generare un'ipotesi, non può mai dare un'istruzione.
4. **Cercare deve cambiare l'ipotesi.** Il tentativo dopo una ricerca deve essere davvero
   diverso, e il motore lo verifica. Stessa firma dopo la ricerca → si sale subito.

### I valori di partenza

| Controllo | Default | Perché |
|---|---|---|
| Sorpresa | **bivio, mai uno stop** | è informazione, ed è ciò che rende diverso il tentativo dopo |
| File fuori dal piano | nuova autorizzazione | non un tetto numerico: il piano nomina già i file |
| Firma di fallimento identica | sali dopo 2 | il gradino è esaurito, il compito no |
| Approccio ripetuto | non conta come tentativo | la regola della novità |
| Ricerche per compito | 3, allowlist, query registrate | oltre, sta girando in tondo |
| Stessa ipotesi dopo ricerca | sali subito | la firma del loop |
| Tempo | 20 min per stadio, 60 per compito | paracadute per i blocchi, non controllo di qualità |

**Questi numeri saranno sbagliati in qualche punto.** Sono default con una ragione, non
costanti, e sono tutti osservabili nel registro (firme, gradini saliti, approcci provati,
ricerche fatte): si tarano leggendo cosa è successo, non indovinando.

---

## 11. Il futuro di ATOM: crescere per numero, non per taglia

Il laboratorio ha già stabilito la strada, e vale come indirizzo hardware del prodotto intero:

- **Comporre esperti piccoli e verificati batte un blocco denso della stessa dimensione
  totale** (+46% misurato). L'affidabilità viene dalla composizione, non dalla stazza.
- La crescita corretta è **per numero di esperti**, non per taglia di un blocco unico. È
  anche l'unica realistica sull'hardware vero: **un esperto per scheda, addestramento in
  parallelo**, naturale in un'architettura modulare, impossibile con un monolite.
- I checkpoint **si accumulano, non si riallenano**: un esperto validato entra nella libreria
  e resta.

**Perché questo è la risposta giusta al "pensa al domani":** la scommessa opposta — un modello
sempre più grande — dipende da hardware che non hai e che invecchia. Questa dipende dal
*numero* di pezzi verificati che hai accumulato, e quel numero cresce con il tempo di lavoro,
non con il budget. È l'unica forma di crescita che va nella direzione giusta per un prodotto
self-hosted.

## 12. Cosa va costruito, in ordine

1. **Il contratto `ReasoningProvider`**, pubblico e versionato. È il pezzo che manca del
   tutto ed è il primo.
2. **Il provider di riferimento** che lo implementa onestamente a L3-L5, incluse `expect` e
   `decompose`. Va nel core pubblico e ci resta.
3. **L'esecuzione in ombra** nel motore: copia del workspace, esecuzione dei test mirati,
   confronto atteso/reale. Non serve intelligenza, serve la sandbox che già c'è.
4. **La scala di persistenza** e il registro delle firme di fallimento.
5. **ATOM Evolution** dietro lo stesso contratto, quando il resto regge: simulazione
   predittiva, ricerca causale, valutazione di piani alternativi, libreria di esperti.

I punti 1-4 sono **tutti pubblici** e fanno un prodotto completo. Il punto 5 lo rende più
veloce e più ambizioso. Questa separazione non è un compromesso commerciale: è la sola che
soddisfa `R-001` e la sola che regge davanti a un finanziatore pubblico.
