# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-31 (`D-0267`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008) → B (SESS-001..003) → C (CUBE-001..009) →
> pausa 1 → **decisione WebUI** → pausa 2 → E+F (debito+packaging) → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C COMPLETI. Decisione WebUI (Owner): costruire Ricerca + TUI +
> Voce/pannelli staccabili, "non lasciamo nulla indietro". D1 (Ricerca, `D-0266`) e D2
> (sessioni del TUI, `D-0267`) FATTI e installati. Resta D3: Voce + pannelli.**

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

## ➜ LA PROSSIMA AZIONE — Blocco D3: Voce + pannelli staccabili

**Block D2 fatto (`D-0267`)**: `session-protocol.mjs` porta tre metodi nuovi —
`sessions.list`/`sessions.get`/`sessions.action` — chiusi sulla STESSA istanza
`contextGraph`/`ledger` che le rotte HTTP `/api/v1/sessions*` già usano. `tools/
tui-client.mjs` porta `sessions [place] [page]` · `session-show <n>` ·
`session-archive <n…|all>` · `session-delete <n…|all>` · `session-restore <n…|all>` ·
`session-undone` — `<n>` risolve contro l'ultima lista mostrata (come le righe numerate
del browser), `session-delete` manda `bin` o `purge` a seconda che l'ultima lista fosse il
cestino (stessa regola del tasto Canc del browser), e ogni azione distruttiva-o-di-
spostamento chiede `Confirm? [y/N]` senza default (UI-008/051/052). Scelta di design: le
azioni in blocco prendono numeri di riga separati da spazio o `all`, non una coppia
`select`/`apply` con stato — una riga di terminale esprime già un insieme in un colpo solo.

**Prossima azione reale**: Blocco D3 — Voce (`D-0123`) e pannelli staccabili (`07 §5`),
mai iniziati. **Scoping prima del codice**: leggere davvero cosa `D-0123` e `07 §5`
chiedevano, non assumerlo dal titolo. `UI-054` (pannelli agente raggiungibili a schermo
intero dal TUI, `F1…F9`/`/pannello <nome>`) chiude `CE-020` insieme a questo blocco.

**Non rifare**: i 6 test nuovi di `session-protocol.test.mjs`, i 9 di
`tui-client-sessions.test.mjs`, `scripts/test.sh` 10/10, seeded-defect 19/19 (D-0267).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-sessions-tui` (`D-0267`) · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:19 rls_tables:18`.
  Rollback preservato: `noesar-evolution.rollback-sessions-tui-20260731T022844Z`
  (`:phase4-research`).
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001` attraverso `CUBE-009` sono TUTTI ✔ COSTRUITI E VERIFICATI DAL VIVO** (Blocco
  C, invariato).
- **`UI-080…096` (Ricerca) sono TUTTI ✔ COSTRUITI** (`D-0266`) — nessun provider di
  ricerca è registrato: la superficie è vera, i dati no.
- **`UI-050` è ora COSTRUITO per le sessioni** (`D-0267`) — ma `CE-020` ("ogni capacità
  dal TUI") resta **non soddisfatto** per i pannelli agente (`UI-054`): quelli restano
  raggiungibili solo dal browser finché non è fatto il Blocco D3.
- **Nessun concetto di workspace nel percorso live del prodotto** — un solo workspace
  canonico proiettato all'avvio, stesso pattern usato per l'identità.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0267`

| Verifica | Risultato |
|---|---|
| `node --test` (suite completa) | **1312/1313 PASS** (1 skip pre-esistente, +15) |
| `tools/run-eslint.sh` | **258 file · 0 errori** |
| `scripts/test.sh` (9 step) | **10/10 PASS** |
| `tools/seeded-defect-proof.mjs` | **19/19 catturati** |
| `tools/auth-http-smoke.mjs` + `tools/http-smoke.mjs` | **PASS** |
| `MANIFEST.sha256` | **5880/5880** (4 hash aggiornati, 1 file nuovo) |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, byte immagine identici |
| probe live non autenticato | `sessions.list` risponde `UNAUTHENTICATED` — cablato e gated sul prodotto vivo |

**Non eseguito, dichiarato**: browser E2E e audit accessibilità — nessun DOM/markup toccato
in questa fase (solo control-plane + CLI), giudicati irrilevanti per lo stesso criterio con
cui `D-0259` (backend-only) li aveva già saltati.

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna tecnica.** La decisione WebUI è "tutto". D3 (Voce/pannelli) prosegue senza
bisogno di ulteriori pause, salvo scoperte.
