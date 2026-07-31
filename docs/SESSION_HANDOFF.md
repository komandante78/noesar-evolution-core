# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-31 (`D-0266`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008) → B (SESS-001..003) → C (CUBE-001..009) →
> pausa 1 → **decisione WebUI** → pausa 2 → E+F (debito+packaging) → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C COMPLETI. La decisione WebUI (Owner, questa sessione): costruire
> Ricerca + TUI + Voce/pannelli staccabili, "non lasciamo nulla indietro". Ricerca
> (`D-0266`) FATTA e installata. TUI e Voce/pannelli restano da fare — vedi sotto.**

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

**Eccezioni documentate**: `D-0232` (peso `phi-4-Q4_K_M.gguf` letto, read-only, su
istruzione diretta). `D-0266`: `crates/atom-provider/src/research_gate.rs` in
`ATOM_EVOLUTION` letto (non modificato) per ricavare il vocabolario reale delle
categorie di rifiuto (`physical-harm`/`animal-harm`/`self-harm`/`legal-evasion`) — stesso
punto di integrazione già stabilito da `D-0222`.

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

## ➜ LA PROSSIMA AZIONE — Blocco D2: il TUI di CodeN Evolution (`UI-050` lato shell)

**Block D1 fatto (`D-0266`)**: la destinazione Ricerca (`UI-080…089`) costruita sopra il
gate già vivo (`UI-090…096`, `D-0222`) — provider pluggable riusando il connettore
`tools`/consenso già esistente (`agent-service.mjs`/`tool-executor.mjs`, HTTPS+SSRF
guard+vault), doppio gate reale (intento poi contenuto), rapporto ephemeral
revocabile/scadente/session-gated (`ResearchReportStore`, in-memory per design), rifiuto
contestabile (`RefusalRegistry`). `research.mjs` nuovo, 12/12 test. **Bug reale trovato
dalla suite intera, non dalla review**: `match=...` senza `let` in due rotte nuove
collideva (TDZ) con un `let match` dichiarato 800 righe più sotto nella stessa funzione —
rompeva OGNI richiesta al server, 67 test falliti in tutta la suite l'hanno preso.
Riparato rinominando le due variabili.

**Nessun provider di ricerca è registrato in produzione** — il meccanismo è vero e
installato, ma senza un connettore esterno registrato+consentito (azione dell'operatore,
in Agents → Tools) la superficie risponde onestamente "non configurato", non inventa
risultati.

**Prossima azione reale**: `UI-050` — ogni azione delle sessioni ha già una forma da
tastiera nel browser; manca il vero comando TUI (`tools/tui-client.mjs` supporta oggi
solo `plan/simulate/approve/reject/restore/get/events/map/search/status`, cioè
CodeN Evolution — mancano i comandi di gestione sessioni `/sessioni`, `/sessione <n>`,
`/archivia <n>`, `/elimina <n>`, `/seleziona <n…>`, `/archivio --pagina <n>`,
`/ripristina <n>`, `/non-fatto`). Il backend (`session-protocol.mjs`) ha già il pattern
(`workspace.*` dispatch chiuso sulle stesse istanze del bridge HTTP) — servono nuovi
metodi `sessions.*` che riusano `contextGraph.listSessions/archiveSession/binSession/
restoreSession/purgeSession`, le stesse funzioni della rotta REST `/api/v1/sessions*`.
`CE-020` resta insoddisfatto finché non è fatto.

**Dopo D2: Blocco D3** — Voce (`D-0123`) e pannelli staccabili (`07 §5`), mai iniziati.
Scoping prima del codice: leggere cosa `D-0123` e `07 §5` chiedevano davvero.

**Non rifare**: i 12 test `research.test.mjs`, suite E2E completa **334/334** e audit
accessibilità **27/27** (`D-0266`, quattordicesima destinazione).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-research` (`D-0266`) · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:19 rls_tables:18` ·
  workspace canonico proiettato all'avvio · byte immagine identici · stop pulito.
  Rollback preservato: `noesar-evolution.rollback-research-20260731T003927Z`
  (`:phase4-memory-webui`).
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001` attraverso `CUBE-009` sono TUTTI ✔ COSTRUITI E VERIFICATI DAL VIVO** (Blocco
  C, invariato).
- **`UI-080…096` sono TUTTI ✔ COSTRUITI E VERIFICATI DAL VIVO** (`D-0266`) — ma nessun
  provider di ricerca è registrato: la superficie è vera, i dati no.
- **`UI-050` lato shell NON è costruito** — le azioni delle sessioni hanno la forma da
  tastiera nel browser, non un comando TUI reale. Non confondere con `coden-tui`, la
  destinazione dichiarata-e-non-costruita per CodeN Evolution stesso (`D-0141`, diversa).
- **Nessun concetto di workspace nel percorso live del prodotto** — un solo workspace
  canonico proiettato all'avvio, stesso pattern usato per l'identità.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0266`

| Verifica | Risultato |
|---|---|
| `npm test` + `npm run lint` | **PASS** (1296/1297 — 1 skip pre-esistente, 257 file lint 0 errori) |
| Suite E2E completa, Chromium reale via Puppeteer (`tools/browser-e2e.mjs`) | **334/334 PASS** |
| Audit accessibilità (`tools/accessibility-audit.mjs`) | **27/27 PASS** |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, `migrations:19 rls_tables:18` |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna tecnica.** La decisione WebUI è stata presa ("tutto"). D2 (TUI) e D3
(Voce/pannelli) proseguono senza bisogno di ulteriori pause, salvo scoperte.
