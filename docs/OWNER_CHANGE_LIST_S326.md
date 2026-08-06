# Lista modifiche richieste dall'Owner — aperta in s326 (2026-08-06)

> **STATO: IN RACCOLTA — NON IMPLEMENTARE.**
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

## 4 · _(in attesa)_

---

## Domande aperte, da sciogliere prima dell'esecuzione

| # | Domanda | Nasce da |
|---|---|---|
| A | Cosa si presenta al socket al posto del cookie, e chi può fabbricarlo | punto 1 |
| B | `/skills`: superficie nuova da costruire — quanta parte è in questa lista e quanta è una fase a sé | punto 3 |

## Cosa NON è autorizzato

Scrivere codice, costruire immagini, deployare. Il punto 3 è approvato **come disegno**.
L'ordine di esecuzione si concorda a lista chiusa.
