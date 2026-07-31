# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-31 (`D-0270`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008) → B (SESS-001..003) → C (CUBE-001..009) →
> pausa 1 → **decisione WebUI** → pausa 2 → E+F (debito+packaging) → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C COMPLETI. Blocco D (decisione WebUI: Ricerca+TUI+Voce/pannelli) ORA
> COMPLETO — D1 (`D-0266`), D2 (`D-0267`), D3a (`D-0268`), D3b (`D-0269`), D3c (`D-0270`)
> tutti fatti. ⛔ SIAMO ALLA PAUSA 2 — punto di stop previsto dal piano stesso, non da
> continuare senza l'Owner.**

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

## ⛔ LA PROSSIMA AZIONE — PAUSA 2, non Blocco E+F

**Il piano dell'Owner stesso** (citato in cima a questo file, deciso ancor prima del
Blocco A) mette una pausa **dopo** la decisione WebUI e **prima** di E+F. Il Blocco D si è
appena chiuso con `D-0270` — questo NON è un via libera a proseguire da soli su E+F.
**Fermarsi qui, riportare il lavoro fatto, aspettare l'Owner.**

Se l'Owner chiede esplicitamente di proseguire: **Blocco E+F (debito+packaging)** non ha
ancora uno scope dettagliato in nessun file di stato — la prima azione reale di quel
blocco è rileggere questo file e `docs/DECISION_LOG.md` per capire cosa "debito+packaging"
intende concretamente (probabilmente: gli item ancora aperti elencati sotto "Cosa NON è
vero" + un giro di pulizia pre-release), non assumerlo.

**Block D3c fatto (`D-0270`)**: Voce come **torre di controllo** (`D-0123`), non
assistente — `apps/webui-static/voice-control.js` (vocabolario fisso a 5 parole:
`approve`/`reject`/`cancel`/`repeat`/`status`; reducer puro: `approve`/`reject` chiedono
la STESSA parola due volte per eseguire, `cancel` o la parola opposta revocano subito,
qualsiasi altra cosa ripete la domanda invece di indovinare), cablato in `app.js` a un
toggle microfono nel topbar che chiama lo STESSO `runWorkspaceAction` già usato dai
pulsanti Approve/Reject visibili — nessuna capacità nuova lato server. **Regressione
reale trovata e riparata nella stessa fase**: l'audit di accessibilità è sceso a 26/27
(`#globalSearch` schiacciato a 22px dal nuovo chip nel topbar, `.command` non aveva un
proprio `min-width`) — riparato alla radice (`.command{min-width:160px}`), non solo
rimpicciolendo il bottone voce (che avrebbe solo rimandato lo stesso guasto alla prossima
aggiunta al topbar). **Deployato live** (`:phase4-voice-control`) — a differenza di
`D-0269`, questa fase tocca `apps/webui-static/`, che È dentro l'immagine Docker.

**Non rifare**: i 22 test di `voice-control.test.mjs`, browser E2E 334/334 (rieseguito
due volte, la seconda dopo il fix CSS), audit accessibilità 27/27, `scripts/test.sh`
10/10, seeded-defect 19/19, `MANIFEST.sha256` 5885/5885 (D-0270).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-voice-control` (`D-0270`) · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:19 rls_tables:18`.
  Rollback preservato: `noesar-evolution.rollback-voice-control-20260731T062228Z`
  (`:phase4-panels-tui`).
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001` attraverso `CUBE-009` sono TUTTI ✔ COSTRUITI E VERIFICATI DAL VIVO** (Blocco
  C, invariato).
- **`UI-080…096` (Ricerca) sono TUTTI ✔ COSTRUITI** (`D-0266`) — nessun provider di
  ricerca è registrato: la superficie è vera, i dati no.
- **`UI-050`/`UI-054`/`D-0123` sono ORA TUTTI COSTRUITI PER INTERO** (`D-0267`…`D-0270`)
  — `CE-020` ("ogni capacità dal TUI") vale ora anche per la Voce. **Non esiste più
  nessuna capacità WebUI non ancora raggiungibile da un'altra via.**
- **La Voce non parla mai spontaneamente** — solo su richiesta (`status`) o come conferma
  di un'azione (`Approving.`/`Rejecting.`/`Cancelled.`). Nessun narrato continuo, nessuna
  chat vocale — per design, non per limite tecnico.
- **La riga di stato del TUI ammette onestamente solo 2 campi su 12** (Elapsed,
  Authority) — identico principio del browser che ne ammette 4 su 12. Un gap dichiarato.
- **Nessun concetto di workspace nel percorso live del prodotto** — un solo workspace
  canonico proiettato all'avvio, stesso pattern usato per l'identità.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0270`

| Verifica | Risultato |
|---|---|
| `node --test` (suite completa) | **1347/1348 PASS** (1 skip pre-esistente, +22) |
| `tools/run-eslint.sh` | **262 file · 0 errori** |
| `scripts/test.sh` (9 step) | **10/10 PASS** |
| `tools/seeded-defect-proof.mjs` | **19/19 catturati** |
| `MANIFEST.sha256` | **5885/5885** |
| browser E2E (`tools/run-browser-e2e.sh`) | **334/334 PASS** (rieseguito 2 volte) |
| audit accessibilità | prima **26/27** (regressione reale, riparata), poi **27/27** |
| deploy | stop pulito, backup, §5a rispettato, `Up (healthy)`, byte immagine identici |
| probe live | `GET /voice-control.js` → `200`, servito davvero dal prodotto vivo |

**Non testato, dichiarato**: `initVoiceControl`'s wiring reale con `SpeechRecognition`/
`speechSynthesis` veri — servirebbe un motore vocale reale in un browser, assente anche
nell'E2E headless di questo progetto. Il matcher/reducer/orchestratore sono comunque
testati per intero con I/O finte (22 test).

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna tecnica sul Blocco D — è chiuso.** L'unica domanda reale ora è se/quando
proseguire su **Blocco E+F**, la prossima pausa prevista dal piano stesso.
