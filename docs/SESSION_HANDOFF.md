# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-31 (`D-0269`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008) → B (SESS-001..003) → C (CUBE-001..009) →
> pausa 1 → **decisione WebUI** → pausa 2 → E+F (debito+packaging) → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C COMPLETI. Decisione WebUI (Owner): costruire Ricerca + TUI +
> Voce/pannelli staccabili, "non lasciamo nulla indietro". D1 (Ricerca, `D-0266`), D2
> (sessioni del TUI, `D-0267`), D3a (pannelli per nome, `D-0268`) e D3b (tasti F1…F9,
> `D-0269`) FATTI. Resta SOLO D3c (Voce) prima della pausa 2.**

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

**Eccezioni documentate**: `D-0232` (peso `phi-4-Q4_K_M.gguf` letto, read-only, su
istruzione diretta). `D-0266`: `crates/atom-provider/src/research_gate.rs` in
`ATOM_EVOLUTION` letto (non modificato) per il vocabolario di rifiuto reale.

## ⚠️ CINQUE REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted, mai una modifica
   all'host come rimedio.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: ogni fase produce una proposta
   di miglioramento; eseguirla è decisione dell'Owner.
5. **`EXECUTE` è una decisione del CLIENTE** (`D-0250`), **e così è l'egress di Ricerca**
   (`D-0266`): nessun provider imbullonato nel codice, un connettore `tools` pluggable
   come ogni altro, l'operatore lo configura e lo consente.

## ➜ LA PROSSIMA AZIONE — Blocco D3c: Voce (`D-0123`), ultimo pezzo prima della pausa 2

**Block D3b fatto (`D-0269`)**: `tools/tui-client.mjs` porta `panelForFunctionKey`/
`FUNCTION_KEY_PANELS` (puro: `f1`…`f9` → le prime nove `PANEL_NAMES`, stesso ordine che
`panel` da solo già elenca) e `wireFunctionKeys(iface, session)`, cablato da `main()` SOLO
quando `process.stdin.isTTY`, che instrada allo STESSO `runPanel()` già usato dal comando
digitato `panel <name>` — nessun metodo nuovo lato server, perché ogni pannello che un tasto
raggiunge aveva già una rotta da `D-0268`. **Nessun deploy Docker**: `tui-client.mjs` non è
mai stato incluso in nessuna immagine `noesar-evolution:*` (client dell'operatore, eseguito
dal checkout host) — `D-0143` è soddisfatto dalla verifica completa, non da un deploy che
non esiste per questo file. Il container vivo resta invariato: `:phase4-panels-tui`.

**Prossima azione reale — D3c, Voce (`D-0123`)**: l'UNICO pezzo rimasto della decisione
WebUI dell'Owner ("tutto, non lasciamo nulla indietro"). Dichiarata **"idea disegnata, non
pianificata"** (2026-07-27) — prima di scrivere una riga serve uno SCOPING VERO, non
presunto: cosa significa concretamente "torre di controllo, non assistente" come superficie
reale? Domande aperte da risolvere PRIMA del codice: (1) cattura audio — dove, con quale
libreria (questo progetto non ne ha mai usata una, zero dipendenze è la policy dichiarata
in testa a `tui-client.mjs` e altrove — un input audio reale rompe quella policy, va deciso
se un'eccezione è accettabile o se serve un binario esterno separato); (2) TTS — stesso
problema di dipendenze, più la domanda se serve affatto o se "torre di controllo" significa
SOLO comandi vocali in ingresso, mai voce in uscita; (3) quale endpoint/trasporto riceve
l'audio — un quarto peer accanto a `api`/`codev`/(WebUI), o un canale dentro uno di quelli
già esistenti; (4) cosa "torre di controllo" esclude esplicitamente rispetto ad "assistente"
(l'Owner ha usato questa distinzione per una ragione — probabilmente: comandi imperativi
brevi su azioni già esistenti, MAI una conversazione libera con un modello). **Non iniziare
a scrivere codice prima di avere risposte, anche solo ipotesi esplicite verificate con
l'Owner se possibile — questo è lo stesso errore che D3a/D3b hanno evitato scopando prima.**

**Non rifare**: i 4 test di `tui-client-function-keys.test.mjs`, `scripts/test.sh` 10/10,
seeded-defect 19/19, `MANIFEST.sha256` 5882/5882 (D-0269).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-panels-tui` (`D-0268`, INVARIATO da `D-0269`
  — D3b è git-only) · `Up (healthy)` · `192.168.178.100:8100→8088` · hardening intatto ·
  `migrations:19 rls_tables:18`. Rollback preservato:
  `noesar-evolution.rollback-panels-tui-20260731T024358Z` (`:phase4-sessions-tui`).
- **Due container per progetto** — §5a rispettato (invariato, nessun nuovo container).

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001` attraverso `CUBE-009` sono TUTTI ✔ COSTRUITI E VERIFICATI DAL VIVO** (Blocco
  C, invariato).
- **`UI-080…096` (Ricerca) sono TUTTI ✔ COSTRUITI** (`D-0266`) — nessun provider di
  ricerca è registrato: la superficie è vera, i dati no.
- **`UI-050` e `UI-054` sono ORA ENTRAMBI COSTRUITI PER INTERO** (`D-0267`/`D-0268`/
  `D-0269`) — `CE-020` ("ogni capacità dal TUI") vale ora per OGNI pannello. L'unica
  capacità WebUI ancora fuori dal TUI/prodotto è la Voce (`D-0123`, D3c) — non iniziata.
- **`D-0269` non ha toccato NULLA lato server** — `session-protocol.mjs`/`server.mjs`
  invariati da `D-0268`. Se qualcuno cerca un deploy/rollback per D3b, non esiste: è un
  cambio di solo client, verificato dai test, non da un container.
- **La riga di stato del TUI ammette onestamente solo 2 campi su 12** (Elapsed,
  Authority) — identico principio del browser che ne ammette 4 su 12, non identico
  insieme di campi: Network e Sandbox richiedono dati solo-HTTP (privacy/bootstrap) che
  il socket non porta. Un gap dichiarato, non un errore.
- **Nessun concetto di workspace nel percorso live del prodotto** — un solo workspace
  canonico proiettato all'avvio, stesso pattern usato per l'identità.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0269`

| Verifica | Risultato |
|---|---|
| `node --test` (suite completa) | **1325/1326 PASS** (1 skip pre-esistente, +4) |
| `tools/run-eslint.sh` | **260 file · 0 errori** |
| `scripts/test.sh` (9 step) | **10/10 PASS** |
| `tools/seeded-defect-proof.mjs` | **19/19 catturati** |
| `MANIFEST.sha256` | **5882/5882** (1 hash aggiornato — `tools/tui-client.mjs` — 1 file nuovo) |
| deploy | **nessuno** — file mai incluso in un'immagine Docker, vedi sopra |

**Non eseguito, dichiarato**: `wireFunctionKeys` stesso non è testato a unità (serve un TTY
reale, stessa classe di gap del commento su mascheramento password di `login()`); browser
E2E e audit accessibilità (nessun DOM toccato, nessuna ragione per rieseguirli).

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna posta finora su D3c.** Prima di scrivere codice per la Voce servirebbe una
risposta esplicita alle quattro domande elencate sopra in "LA PROSSIMA AZIONE" — se
l'Owner non è raggiungibile, la sessione che riprende questo lavoro deve trattarle come
BLOCCANTI per il codice, non come dettagli da inventare in corsa.
