# Catalogo modelli — progetto

**Requisito dell'Owner, 2026-08-04.** Registrato in s318 come *solo progetto*, disegnato qui in
s320 con l'autorizzazione dell'Owner a decidere. Nessuna riga di questo documento è
implementata: è il piano, e lo dice in testa perché la lezione di
`CODEN_EVOLUTION_DESIGN_V1.md` — un documento di progetto letto come un resoconto di ciò che
esiste — è costata quattro sessioni.

## 1. Il requisito, come l'ha dato l'Owner

- **Qualunque modello, nessuna lista fissa.** Sfogliare o cercare deve poter far emergere il
  modello che l'utente vuole, non un sottoinsieme scelto da noi e cotto nel prodotto.
- **Impaginato, non una lista piatta.** Raggruppato per tipo e per funzione ("modello 1 per il
  codice, modello 2 per un altro compito").
- **Scaricati e in uso sempre in primo piano.** Con *Usa*; quelli non ancora scaricati con
  *Scarica e avvia*.
- **Solo fonti verificate.** Mai un URL arbitrario.

## 2. La tensione vera, e come si scioglie

I primi due requisiti tirano in direzioni opposte dal quarto. *Qualunque modello* e *solo fonti
verificate* si contraddicono se "fonte" significa "elenco di modelli": un elenco di modelli
approvati è esattamente la lista fissa che il primo requisito vieta.

Si sciolgono separando le due cose che oggi vengono confuse:

> **Si verifica il *pubblicatore*, non il *modello*.**

Un pubblicatore registrato è un'origine di cui il prodotto conosce la chiave, l'impronta e lo
stato di revoca. Quanti modelli pubblichi, e quali, non è affare del catalogo. Così *qualunque
modello* resta vero — qualunque modello **di un'origine conosciuta** — e *nessun URL arbitrario*
resta vero, perché ciò che è vietato non è il modello sconosciuto ma l'**origine** sconosciuta.

Questo meccanismo **esiste già**: `services/reference-control-plane/src/publisher-registry.mjs`
(`D-0275`) tiene ID del pubblicatore, livello di fiducia, chiave pubblica, impronta SHA-256,
stato attivo/revocato, chi l'ha registrato e quando, con revoca a due grane (una chiave, o tutte
le chiavi di un pubblicatore). Il catalogo modelli **non costruisce un secondo registro di
fiducia**: usa questo. Un registro di fiducia parallelo sarebbe due posti dove revocare, e la
revoca che funziona in un posto solo è peggio di nessuna revoca.

## 3. Le tre corsie, e perché una lista piatta non basta

Non è impaginazione per estetica: le tre corsie hanno **verbi diversi**, e mescolarle è ciò che
rende una lista piatta illeggibile.

| Corsia | Cosa contiene | Verbo | Costo del gesto |
|---|---|---|---|
| **In uso** | il modello che sta rispondendo adesso | *Sostituisci* | riavvio del runtime |
| **Scaricati** | presenti su disco, non attivi | *Usa* | secondi, nessuna rete |
| **Disponibili** | noti a un pubblicatore registrato, non presenti | *Scarica e avvia* | rete, disco, tempo |

Le prime due corsie sono in primo piano e **non si impaginano mai**: sono la risposta a "cosa ho"
ed è una domanda che non deve costare una ricerca. Solo la terza si impagina, perché è l'unica
che può essere grande.

**Un modello in uso non si nasconde mai dietro una pagina.** Se il filtro corrente lo
escluderebbe, resta visibile con l'etichetta del perché ("in uso · fuori dal filtro"). Un
prodotto che nasconde ciò che sta eseguendo è un prodotto in cui non si può spegnere ciò che sta
eseguendo.

## 4. Il raggruppamento — dichiarato, mai indovinato

Per **tipo** (testo, visione, embedding, riordino, voce) e per **funzione** (codice,
ragionamento, sintesi, traduzione, uso di strumenti).

**La regola che decide ogni caso dubbio:** questi campi sono **dichiarati dal pubblicatore e
riportati**, mai dedotti dal prodotto. Il prodotto non guarda il nome di un modello per
concludere che serve al codice, e non lo interroga per scoprirlo. Ci sono due ragioni, e la
seconda è quella che conta:

1. Dedurre dal nome è indovinare, e indovinare qui produce una scheda che sembra un fatto.
2. È la stessa postura già presa per `contextWindow` in s317 — **campo dichiarato
   dall'operatore, mai sondato** — e presa perché nessuno stile di provider espone la propria
   lunghezza di contesto in modo affidabile. Una seconda postura per un secondo campo sarebbe
   due abitudini contrarie nello stesso pannello.

Un modello che non dichiara nulla finisce sotto **`non dichiarato`**, che è una categoria
visibile e non un cestino: il conteggio si vede, e un pubblicatore che non descrive ciò che
pubblica è un'informazione, non un difetto da nascondere.

## 5. *Scarica e avvia* — dove passa l'autorità

È l'unico pulsante di questo pannello che tocca la rete, il disco e l'esecuzione, quindi è
l'unico che deve spendere autorità. In ordine:

1. **Consenso di egress.** Scaricare è uscita. Passa dallo stesso cancello di
   `research-gate.mjs`/connettori, non da uno nuovo. Nessuna fonte è incorporata.
2. **Origine verificata.** Il pubblicatore è nel registro e **non è revocato** *al momento del
   download*, non al momento in cui fu registrato.
3. **Un token di capacità**, coniato per quell'operazione, con i tetti scritti dentro (byte
   massimi, destinazione, durata). Il download è un'operazione mutativa su disco: la regola sola
   vale qui come altrove.
4. **Verifica dell'artefatto prima dell'uso** — impronta attesa contro impronta calcolata. Un
   file scaricato e non verificato non entra nella corsia "scaricati": entra in
   `non verificato`, e da lì non si avvia.
5. **Avvio tramite `LocalModelRuntime`**, che già oggi prende `launchCommand` come **array
   argv, mai una stringa di shell** — nota nel codice: *"un comando assemblato come testo e dato
   a una shell è un comando che un nome di modello fornito dall'operatore può estendere"*. Il
   catalogo non aggira quella scelta passando un nome dentro una stringa.

`NOESAR_LOCAL_MODEL_RUNTIME=disabled` **continua a vincere** su tutto quanto sopra. Oggi
l'installazione viva è così. Il catalogo, con quella variabile a `disabled`, mostra le corsie e
disabilita *Scarica e avvia* **dicendo perché** — non lo nasconde: un pulsante assente non
insegna niente, un pulsante spento con il motivo insegna dove si accende.

## 6. Cosa questo progetto NON fa

| Cosa | Perché no |
|---|---|
| Una classifica di qualità dei modelli | Il prodotto non ha misure proprie, e riportare i punteggi altrui come propri è la contaminazione da benchmark che questo progetto rifiuta altrove. |
| Scelta automatica del modello per compito | È un router. `D-0281` l'ha già rifiutato: ATOM non manda `model`. Il catalogo mostra, l'operatore sceglie. |
| Sondare un modello per scoprire cosa sa fare | Sondare costa una chiamata e restituisce un'opinione. Vedi §4. |
| Un secondo registro di fiducia per i modelli | §2. Si revoca in un posto solo. |
| Un prezzo per modello | Nessuna tabella di prezzi esiste in questo prodotto (verificato in s317). Mostrarne una sarebbe inventarla. |

## 7. Superfici da costruire, quando si costruirà

Elencate perché il piano sia controllabile, non perché siano già decise nel dettaglio.

- `model-catalog.mjs` — corsie, raggruppamento, impaginazione; **nessuna richiesta di rete**: il
  catalogo è metadati, esattamente come `tool-catalog.mjs` (invenzione V, `CE-016`, ora misurata
  in `ce-016-zero-tools-at-rest.test.mjs`).
- `GET /api/v1/models/catalog` — corsie e pagine; **niente segreti**, i modelli non ne hanno.
- `POST /api/v1/models/acquire` — il solo verbo mutativo, il solo che spende un token.
- Pannello *Modelli* — destinazione che esiste già nella barra (`▦ Modelli`, documento `07` §2).

## 8. Criteri di accettazione

| ID | Criterio | Come si verifica |
|---|---|---|
| MC-001 | Nessun download da un'origine non registrata, né da una revocata dopo la registrazione | tentativo con pubblicatore revocato fra registrazione e download |
| MC-002 | Il modello in uso è visibile sotto ogni filtro e ogni pagina | enumerazione di tutti i filtri con un modello attivo escluso da ciascuno |
| MC-003 | Tipo e funzione non sono mai dedotti | un modello con nome fortemente suggestivo e dichiarazione assente resta in `non dichiarato` |
| MC-004 | Un artefatto la cui impronta non corrisponde non è avviabile | download manomesso |
| MC-005 | Il catalogo a riposo non fa richieste di rete | conteggio delle richieste uscenti all'apertura del pannello |
| MC-006 | Con il runtime disabilitato il pannello dichiara il perché invece di nascondere il gesto | ispezione con `NOESAR_LOCAL_MODEL_RUNTIME=disabled` |
