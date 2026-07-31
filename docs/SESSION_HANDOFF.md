# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-31 (`D-0268`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008) → B (SESS-001..003) → C (CUBE-001..009) →
> pausa 1 → **decisione WebUI** → pausa 2 → E+F (debito+packaging) → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C COMPLETI. Decisione WebUI (Owner): costruire Ricerca + TUI +
> Voce/pannelli staccabili, "non lasciamo nulla indietro". D1 (Ricerca, `D-0266`), D2
> (sessioni del TUI, `D-0267`) e D3a (pannelli per nome, `D-0268`) FATTI e installati.
> Restano D3b (tasti F1…F9) e D3c (Voce).**

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

## ➜ LA PROSSIMA AZIONE — Blocco D3b o D3c: tasti F1…F9, oppure Voce

**Block D3a fatto (`D-0268`)**: `session-protocol.mjs` porta `product.invariants` (stesso
record `INVARIANT_ENFORCEMENT` che `/api/v1/bootstrap` già manda al browser). `tools/
tui-client.mjs` porta `panel <name> [arg]` — `map`/`logs <runId>`/`shadow`/`invariants`/
`authority`/`editor <runId>`/`diff <runId>` instradano alle STESSE chiamate che già
alimentano quelle viste nel browser; `tests`/`documentation`/`preview`/`closure`/
`conversation`/`activity` rispondono con lo stesso testo "dichiarato vuoto" del browser,
perché nessun metodo esiste per fonderli da NESSUN trasporto — un vuoto dichiarato, non
inventato. `status` ora stampa anche la riga di stato del banco a 12 campi, con la STESSA
onestà: solo Elapsed e Authority hanno una fonte da questo trasporto (2 di 12), gli altri
dieci restano "—" — non si inventa oltre quello che il browser stesso ammette di non avere.

**Prossima azione reale**: due pezzi restano del Blocco D, entrambi da scopare PRIMA di
scrivere codice — nessuno dei due ha un piano di implementazione, solo il principio di
design. **D3b** — tasti `F1…F9` per passare pannello: richiede sostituire il loop di
lettura a righe (`readline`/`LineReader`, deliberato per input piped/non-TTY — vedi il
commento in testa a `tui-client.mjs`) con un loop a tasti in raw-mode con un fallback per
input piped, un cambio architetturale a parte, non un comando in più. **D3c** — Voce
(`D-0123`): dichiarata **"idea disegnata, non pianificata"** (2026-07-27) — prima di
scrivere una riga serve capire cosa significhi concretamente "torre di controllo, non
assistente" come superficie reale (cattura audio? TTS? quale endpoint la riceve?), un
lavoro di scoping mai fatto.

**Non rifare**: 1 test nuovo di `session-protocol.test.mjs`, i 9 di
`tui-client-panels.test.mjs`, `scripts/test.sh` 10/10, seeded-defect 19/19 (D-0268).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-panels-tui` (`D-0268`) · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:19 rls_tables:18`.
  Rollback preservato: `noesar-evolution.rollback-panels-tui-20260731T024358Z`
  (`:phase4-sessions-tui`).
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001` attraverso `CUBE-009` sono TUTTI ✔ COSTRUITI E VERIFICATI DAL VIVO** (Blocco
  C, invariato).
- **`UI-080…096` (Ricerca) sono TUTTI ✔ COSTRUITI** (`D-0266`) — nessun provider di
  ricerca è registrato: la superficie è vera, i dati no.
- **`UI-050` e `UI-054` (nome-pannello) sono ora COSTRUITI** (`D-0267`/`D-0268`) — ma
  `CE-020` ("ogni capacità dal TUI") resta **non soddisfatto** per i tasti `F1…F9`
  (D3b) e per la Voce (`D-0123`, D3c): nessuno dei due è iniziato.
- **La riga di stato del TUI ammette onestamente solo 2 campi su 12** (Elapsed,
  Authority) — identico principio del browser che ne ammette 4 su 12, non identico
  insieme di campi: Network e Sandbox richiedono dati solo-HTTP (privacy/bootstrap) che
  il socket non porta. Un gap dichiarato, non un errore.
- **Nessun concetto di workspace nel percorso live del prodotto** — un solo workspace
  canonico proiettato all'avvio, stesso pattern usato per l'identità.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0268`

| Verifica | Risultato |
|---|---|
| `node --test` (suite completa) | **1322/1323 PASS** (1 skip pre-esistente, +10) |
| `tools/run-eslint.sh` | **259 file · 0 errori** |
| `scripts/test.sh` (9 step) | **10/10 PASS** |
| `tools/seeded-defect-proof.mjs` | **19/19 catturati** |
| `tools/auth-http-smoke.mjs` + `tools/http-smoke.mjs` | **PASS** |
| `MANIFEST.sha256` | **5881/5881** (4 hash aggiornati, 1 file nuovo) |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, byte immagine identici |
| probe live non autenticato | `product.invariants` risponde `UNAUTHENTICATED` — cablato e gated sul prodotto vivo |

**Non eseguito, dichiarato**: browser E2E e audit accessibilità (nessun DOM toccato); i
tasti `F1…F9` (richiedono un loop di lettura raw-mode, cambio architetturale a parte).

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna tecnica.** La decisione WebUI è "tutto". D3b/D3c proseguono senza bisogno di
ulteriori pause, salvo scoperte — ma D3c (Voce) merita uno scoping dedicato prima del
codice, essendo "idea disegnata, non pianificata" (`D-0123`).
