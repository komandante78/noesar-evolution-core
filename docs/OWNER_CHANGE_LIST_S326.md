# Lista modifiche richieste dall'Owner — aperta in s326 (2026-08-06)

> **STATO: 4a e 4b CONSEGNATI · 1, 2, 3 ANCORA DA FARE.**
>
> Aggiornato a fine s326. L'Owner ha autorizzato l'esecuzione («PROCEDI E INIZIA DA 4»,
> «PROCEDI CON 4B») dopo che i punti 1-4 erano stati raccolti. Cosa è vero adesso:
>
> | Punto | Stato |
> |---|---|
> | **1** Autenticazione unica TUI ↔ NOESAR | **non iniziato** — resta la domanda A |
> | **2** WebUI stile terminale, sezioni fuori dalla pagina | **non iniziato** |
> | **3** `/` progressivo, una porta sola | **approvato come disegno, non costruito** |
> | **4a** chat nella sidebar | ✅ **consegnato e provato nel browser** (`D-0329`) |
> | **4b** unire lavoro e ricerca | ✅ **completo**: fonti (`D-0332`) **e** piano (`D-0333`, s327) |
>
> **Il fatto che bloccava la seconda metà di 4b, e che era una decisione dell'Owner:** un lavoro
> **non è legato a una chat**. `sessionId` in `workspace-actions.mjs` è l'id della run stessa,
> `conversationId` compare zero volte, e la rotta di lista restituisce una dichiarazione di
> capacità, non i lavori. Serviva decidere se una run appartiene a una conversazione — e **cosa
> succede alle run avviate dal terminale**, che una conversazione non ce l'hanno.
>
> ### ✅ DECISIONE PRESA DALL'OWNER (2026-08-06, s327): **la chat possiede la run**
>
> - chi avvia dalla chat passa il **`conversationId`**: la run lo porta con sé, e la colonna
>   destra mostra il piano **di quella chat**;
> - le run avviate **dal terminale** restano **senza conversazione** (`conversationId: null`) e
>   si vedono in un gruppo **dichiarato** «avviate dal terminale» — visibili, non nascoste, e
>   soprattutto **non attribuite** a una chat che non le ha aperte;
> - il legame è **additivo**: niente cambia per chi lavora dal terminale oggi.
>
> **Secondo fatto misurato in s327, che la decisione tira dentro:** `#runs = new Map()`
> (`workspace-actions.mjs:98`) — le run vivono **solo in memoria** e muoiono col processo.
> Perché «il piano di questa chat» sia ancora lì dopo un riavvio, la relazione va **persistita**,
> non solo aggiunta al volo. Non è una domanda per l'Owner: è la dimensione vera del pezzo.
>
> **✅ COSTRUITO in s327 (`D-0333`), 4b è chiuso.** La run porta il `conversationId`; il
> terminale **non può** fabbricarlo (`conversationId: null` fissato nel dispatch, non letto dal
> filo) ma **può leggere** il raggruppamento; una conversazione inesistente **rifiuta** la run
> invece di archiviarla sotto un legame che non risolve. Un solo renderer per le due liste, e
> un solo gesto esplicito che crea il legame, **nominato sul form** e staccabile lì.
> La non-persistenza è **dichiarata** dal motore e ripetuta dal pannello: la lista dice che non
> è una storia. **Proposta di miglioramento all'Owner, non eseguita:** persistere run e
> relazione — è un archivio, non un campo, e non è ciò che 4b chiedeva.
> Verifiche: unit **1855/1856**, ESLint **0/0/0**, **8 mutazioni → 8**, browser **403/403**.
>
> ---
>
> **Testo originale del patto, tenuto perché è la regola con cui la lista è stata costruita:**
>
> **STATO ALLA RACCOLTA: IN RACCOLTA — NON IMPLEMENTARE.**
>
> Patto stabilito dall'Owner in s326, verbatim: *«DEVI FARE DELLE MODIFICHE PRIMA FAREMO UNA
> LISTA E FINO A MIA AUTORIZZAZIONE ASSIMILI LA LISTA»*. Finché questo file dice IN RACCOLTA:
> si annota, non si scrive codice, non si costruisce, non si deploya. Un punto marcato
> ✅ AUTORIZZATO è approvato **come disegno**, il che non è un permesso di cominciare: l'ordine
> di esecuzione si concorda quando la lista è chiusa.
>
> Questa lista è **precedente alla fase 8** di `MASTER_PROJECT/17`. La fase 8 resta ferma su
> richiesta esplicita dell'Owner.

---

## 1 · Autenticazione unica fra NOESAR EVOLUTION e la TUI

**Richiesta.** Nome utente, password e verifica non devono essere una cosa a sé della TUI di
CodeN Evolution: **se sei già entrato in NOESAR EVOLUTION, la TUI ti riconosce**. Un'unica
autenticazione, non due.

**Stato:** raccolto.

**Terreno su cui atterra, misurato.** Oggi il socket unix chiede `Username` / `Password` /
`Authenticator code` **per conto proprio**, e non è una svista: `session-protocol.mjs` lo
dichiara in testa — *«Authenticates its own session over the wire … rather than trusting a
cookie, since a socket connection has none»*. Quindi la richiesta tocca una decisione presa
apposta.

**La domanda vera da risolvere prima di scrivere codice:** cosa si presenta al socket al posto
del cookie, **e chi può fabbricarlo**. È una questione di autorità, non di comodità — vale la
prima delle tre trappole di `16` §4.3 (*«le comodità di accesso non si pagano con l'autorità»*,
già registrata in `15` §13).

---

## 2 · WebUI di CodeN Evolution in forma di terminale, e la pila di sezioni fuori dalla pagina

**Richiesta.** Due cose distinte:

**2a — la grafica.** La WebUI deve avere lo **stile della TUI / `ssh`**, così *«non sembra
neanche una chat»*. Non un tema scuro sopra una chat: la forma del terminale.

**2b — la pila in fondo esce dalla pagina principale.** Oggi è tutta impilata in un rotolo unico:

- `Strumenti` — il modulo di registrazione (Nome, Descrizione, Trasporto, Endpoint o eseguibile,
  Nome strumento remoto, External network tool, Mutative, Register disabled-by-policy tool)
- `Strumenti installati` — `Local · MCP · OpenAPI`, i tre Debug Evolution coi campi token
- `Installable catalogues` — la scheda del modulo Debug Evolution
- `CodeN Evolution view`
- il riquadro `LOCAL ONLY VERIFIED` / *«NOESAR runs locally on your device»*
- `Approvals: 0` / `Open queue`

**Stato:** raccolto. La forma di destinazione è decisa dal punto 3.

---

## 3 · ✅ AUTORIZZATO — una porta sola: `/` progressivo e auto-rivelante

**Come ci siamo arrivati.** La prima formulazione dell'Owner era: menu a scomparsa sulla voce
*CodeN Evolution* della sidebar, le **pagine** lì dentro, e in `/` **solo** i comandi che servono
davvero (`/logout`, `/skills` e simili, inclusi quelli utili quando ci si collega alle **API di
altri provider**). L'Owner ha poi fermato quella formulazione da sé — *«ASPETTA TROVAMI
UN'ALTERNATIVA»* — perché il terminale **non ha una sidebar**: le due shell sarebbero divergite,
che è la regola già violata una volta in questo progetto senza accorgersene.

**Il disegno approvato.** Tutto dentro `/`, ma `/` **smette di essere una lista piatta** e diventa
progressivo e auto-rivelante.

```
┌─ CodeN Evolution ─────────────────────────── owner · atom ok ─┐
│ /                                                             │
│                                                               │
│   d  Dove           25 pagine     diff · piano · sessioni     │
│   s  Sessione        4 comandi    logout · account · provider │
│   t  Strumenti      12 voci       local · mcp · openapi       │
│   m  Moduli          2 voci       catalogo · installati       │
│   a  Approvazioni    0 in attesa  la coda è vuota             │
│                                                               │
│   ⋯ 3 voci non mostrate: richiedono workspace.write           │
└───────────────────────────────────────────────────────────────┘
  ↑↓ scorri    ⏎ entra    esc chiudi    …oppure digita per filtrare
```

**Le proprietà, che sono il punto:**

1. **Una porta sola.** Il click su *CodeN Evolution* nella sidebar apre **lo stesso menu**, col
   mouse. Non è un secondo meccanismo di navigazione accanto a `/` — è `/` reso. Questo tiene in
   piedi `D-0298` e `D-0317` (tre widget di navigazione rimossi proprio perché erano troppi).
2. **Le pagine restano dentro `/`** (gruppo *Dove*), invece di uscirne verso la sidebar: è ciò che
   impedisce al terminale di restare indietro.
3. **Due velocità, un meccanismo.** Chi non sa **sfoglia**; chi sa **digita** e salta i livelli
   (`/t mcp`).
4. **Dichiara ciò che non mostra, e perché** (`⋯ 3 voci: richiedono workspace.write`). È la
   postura che il prodotto ha già ovunque (`accessFiltered:false`, `degraded=true`), applicata al
   menu.
5. **La lista la serve il motore** (`coden.addresses`, fase 4), non la shell → browser e terminale
   **non possono divergere per costruzione**.
6. **Barra di stato col tasto successivo, anche nel browser** — è lo stile-terminale del punto 2
   reso funzionale invece che decorativo.

**Fondamento (ricerca, s326).** Il palette piatto ha un difetto documentato — *«devi già sapere
cosa scrivere»*; l'elenco alfabetico di Sublime è definito «ugualmente inutile». Chi ha risolto
l'ha fatto col menu progressivo auto-documentante: **Magit/transient** (scala a insiemi enormi di
comandi), **which-key** (si mostra da solo, senza un tasto in più), **Zellij** (la barra cambia
col contesto e mostra i tasti validi adesso), **lazygit** (pochi comandi + scopribilità). Dalla
nota su CIDER: *la documentazione non basta, l'unico posto affidabile per insegnare una funzione è
dentro il flusso, nel momento dell'esitazione.*

**Conseguenza già misurata, non stimata: `/skills` NON esiste.** Zero superfici skill in tutto
`services/reference-control-plane/src/` (verificato in s326; già escluso per la stessa ragione in
s322, e `16` §4b.4 disegna il menu `/` ma non la superficie skill). Quindi `/skills` **va
costruito**, non «lasciato». **Da solo può valere una fase.**

---

## 4 · La chat di NOESAR EVOLUTION — resta una chat, ma unisce lavoro e ricerca

**Richiesta.** La chat **deve restare una chat** — non diventare un terminale come CodeN
Evolution. Semplice ma potente, e deve **unire lavoro e ricerca**. Deve lavorare come lavorano
`claude.ai` o ChatGPT.

**Gestione delle chat, come richiesta dall'Owner:**

- chat **a sinistra nella sidebar**, sotto il menu *Chat* un menu a tendina
- mostra le **ultime 5** chat; **superate le 5** compare la barra di scorrimento con le altre
- pulsanti **Elimina** e **Archivia**, sempre con consenso
- sotto le chat, **Archivi** → **pagina nuova** con le chat archiviate
- archivio **10 per pagina** *(l'Owner aveva detto 20, poi ha accettato 10 quando gli è stato
  segnalato che `UI-005` dice già 10 — nessuna divergenza dalla spec)*
- **Seleziona tutti** con **Elimina** e **Ripristina**, sempre con consenso
- le stesse funzioni valgono anche **per la singola chat archiviata**

**Forma del consenso, chiarita dall'Owner:** *«quando si clicca su archivia chat appare il popup
per consentire di archiviare oppure di eliminare o ripristinare»*. Quindi: **popup di conferma
sul click**, per archiviare / eliminare / ripristinare. La proposta di consenso *proporzionato*
(undo inline per le azioni reversibili) è stata **presentata con l'evidenza e non accolta** —
si fa il popup. Resta valida `UI-010` per l'azione **irreversibile** (`purge` / svuota cestino):
popup **più** pulsante pericoloso non preselezionato ed `Esc` che annulla.

### 4a · CORRETTO IN SESSIONE — non è «da costruire»: **è già costruito**

> ⚠️ **Correzione di un mio errore, registrata perché è la classe di errore che questo
> progetto ripete.** Ho detto due volte all'Owner che `UI-001…UI-012` era *«non costruita»*,
> fidandomi della riga 505 di `docs/WEBUI_DESIGN_V3.md` **invece di guardare il codice**.
> Misurato poi davvero: **è costruita**, e con i test. La riga 505 era **stale** ed è stata
> corretta in s326. Vedi `feedback_verify_policy_against_reality_before_trusting_it`.

**Cosa esiste davvero, verificato leggendo `apps/webui-static/`:**

| Riga | Stato reale |
|---|---|
| `UI-001` / `UI-002` | ✅ cinque distese + scroller dalla sesta, conteggio sopra |
| `UI-003` | ✅ `Archive…` / `Delete…` per riga (i puntini = chiede prima) |
| `UI-004` | ✅ tre posti *Working list · Archive · Bin*, con `#sessionsReturn` |
| `UI-005` | ✅ `sessionPageSize()` → **10** per archivio e cestino |
| `UI-006` | ✅ `Restore` + `Delete…` sulle archiviate |
| `UI-007` | ✅ caselle per riga + `workSessions.selected` (Set) |
| `UI-010` / `UI-012` | ✅ `Delete for good…` in classe `danger`; ritenzione dichiarata nello stato vuoto |

Test vivi: `session-lifecycle.test.mjs` **8/8**, più `webui-markup-structure`,
`tui-client-sessions`, e la e2e browser.

**Quindi il vero divario non è costruire, è DOVE VIVE e COME SI CHIAMA:**

1. La superficie sta in **`Impostazioni › Sessioni`** (`SETTINGS_SECTIONS`,
   `#/settings/sessions`), non nella **sidebar** come l'Owner chiede.
2. Si chiama **«Sessions»**. Il codice stesso annota che *«"Session" è sovraccarico in questo
   prodotto»* — Impostazioni › Sicurezza elenca le sessioni di **accesso**, questa elenca
   sessioni di **lavoro**. L'Owner le chiama **chat**.
3. È una **vista da operatore** per gestirle, non l'elenco da cui **si lavora**: manca il gesto
   «clicco e continuo quella conversazione».

**Il rischio numero uno di questo punto, da scriverlo prima di cominciare:** costruire una
**seconda** resa della stessa lista nella sidebar. Sarebbe due renderer per un solo oggetto —
esattamente la classe di divergenza che questo progetto ha già pagato (`PANEL_NAMES` 14 contro
25, `D-0300`). **Una implementazione sola, resa dove serve.**

**Scope reale di 4a, dopo la misura:** portare la superficie esistente nella sidebar come
**Chat**, con il menu a tendina richiesto, **senza duplicarla** — e decidere il nome unico
(*chat* vs *sessioni*) perché oggi la parola è sovraccarica.

| Richiesta Owner | Riga già esistente |
|---|---|
| massimo 5 chat | `UI-001` — le cinque attive più recenti distese |
| oltre 5 → scorrimento | `UI-002` — riquadro a scorrimento, **col conteggio dichiarato sopra** |
| Elimina + Archivia per riga | `UI-003` |
| Archivi come pagina nuova | `UI-004` — **con ritorno sempre visibile** |
| 10 per pagina | `UI-005` — **con l'intervallo dichiarato** (`11–20 di 31`) |
| Ripristina + Elimina su archiviata | `UI-006` |
| Seleziona tutti | `UI-007` — «tutte in questa pagina», **contatore**, un solo pulsante |
| sempre con consenso | `UI-008` — *«Nessuna eccezione»*, criticità **Critica** |

Quattro righe che l'Owner **non** ha chiesto e che vanno costruite lo stesso, perché sono la
profondità già pensata: `UI-009` (la conferma dice **cosa** e **a quante**, elencando i titoli e
troncando con «e altre N»), `UI-010` (pulsante pericoloso **mai** preselezionato, `Esc` annulla),
`UI-011` (*Archivia* **sposta**, non distrugge), `UI-012` (*Elimina* → **cestino recuperabile
30 giorni**, e la conferma lo dice).

**E il motore esiste già.** `sessions.action` con `archive · unarchive · bin · restore · purge` è
implementato in `session-protocol.mjs` (fase 3b). **C'è il motore, manca la faccia** — la stessa
situazione di `D-0291`. Quindi questa metà del punto 4 è **costruire ciò che è già scritto**, non
progettare.

### 4b · La metà che NON è specificata da nessuna parte: unire lavoro e ricerca

`UI-001…012` copre solo la gestione delle chat. *«Unire lavoro e ricerca»* non è specificato
altrove. Disegno proposto, fondato sulla ricerca di s326:

```
┌─ NOESAR ────────────────────┬──────────────────────────────────────┐
│ ▸ Chat                      │  conversazione        │  IL LAVORO   │
│   ├ Rifattorizza login   ●  │                       │              │
│   ├ Analisi CSP             │  › come blindo la     │  Piano #418  │
│   ├ Bug socket              │    sessione?          │  3 file      │
│   ├ Report settimanale      │                       │  ─────────── │
│   ├ Note pentest            │  ‹ ho trovato 3 punti │  ▸ auth.mjs  │
│   │ ┄┄┄ altre 12 ┄┄┄┄┄┄┄ ⇕ │    e un precedente    │  ▸ login.js  │
│   └ Archivi →               │    nella memoria      │              │
│ ▸ Ricerca                   │                       │  fonti: 2    │
│ ▸ Memoria                   │  [                 ]  │  atom ✓      │
└─────────────────────────────┴──────────────────────────────────────┘
```

1. **Il lavoro non vive nello scorrimento.** Piano, file toccati e fonti stanno in un pannello
   **stabile** accanto alla conversazione.
2. **La ricerca diventa prova, non messaggi persi.** Ciò che si trova si **allega** al piano come
   fonte e finisce nei cubi di memoria già esistenti (`corpus`/`experience`/`workshop`). Ricerca
   e lavoro sono la **stessa sessione**, non due posti.
3. **Il pannello sopravvive al modello.** Se ATOM cade, il lavoro resta visibile e **dichiara** di
   essere degradato — comportamento che il motore ha già (`D-0323`).
4. **Ricerca sul contenuto, non sui titoli** — è il punto in cui si supera `claude.ai`, la cui
   ricerca in sidebar copre i titoli; e costa poco perché i cubi ci sono già.

**Fondamento (ricerca s326).** Il pattern vincente è **canvas/artifact**: conversazione a
sinistra, lavoro in un pannello stabile a destra — *«chat come motore, documento come cruscotto:
il lavoro vero dell'utente vive in un documento stabile e visibile, che resta usabile anche se
l'AI si ferma»* (UX Collective). È **già la postura di NOESAR**: il mercato ha scoperto il
pattern che questo prodotto ha in architettura. Sulle conferme, NN/G: *«l'efficacia dei dialoghi
di conferma dipende dalla loro rarità»* — motivo per cui `purge` conserva un attrito maggiore.

**Stato:** raccolto. 4a è in gran parte già specificato; 4b è disegno nuovo, da approvare.

---

## Domande aperte, da sciogliere prima dell'esecuzione

| # | Domanda | Nasce da |
|---|---|---|
| A | Cosa si presenta al socket al posto del cookie, e chi può fabbricarlo | punto 1 |
| B | `/skills`: superficie nuova da costruire — quanta parte è in questa lista e quanta è una fase a sé | punto 3 |
| C | 4b (unire lavoro e ricerca) è disegno nuovo: va approvato come è stato approvato il punto 3 | punto 4 |

## Risolte

| # | Domanda | Risposta dell'Owner |
|---|---|---|
| — | Archivio: 10 o 20 per pagina | **10** — allineato a `UI-005`, nessuna divergenza dalla spec |
| — | Consenso pieno o proporzionato | **popup di conferma sul click**, per archiviare / eliminare / ripristinare |

## Cosa NON è autorizzato

Scrivere codice, costruire immagini, deployare. Il punto 3 è approvato **come disegno**.
L'ordine di esecuzione si concorda a lista chiusa.
