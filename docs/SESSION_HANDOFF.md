# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-31 (`D-0271`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008) → B (SESS-001..003) → C (CUBE-001..009) →
> pausa 1 → **decisione WebUI** → pausa 2 → E+F (debito+packaging) → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C, D COMPLETI. L'Owner ha detto di proseguire oltre la pausa 2 senza
> ulteriore scoping — `deferred_items` si è rivelato essere già la lista del debito
> (D-0271): 3/7 item chiusi, 1 investigato e trovato peggio del previsto, 3 lasciati
> fuori scope o per decisione dell'Owner. Restano QUATTRO fili aperti, tutti bisognosi
> di una decisione dell'Owner su quale seguire, non di altro lavoro solitario.**

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ CINQUE REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted, mai una modifica
   all'host come rimedio.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: ogni fase produce una proposta
   di miglioramento; eseguirla è decisione dell'Owner.
5. **`EXECUTE` è una decisione del CLIENTE** (`D-0250`), **e così è la custodia di una
   chiave di firma release vera** (`D-0271`): nessuna decisione di sicurezza/capacità
   presa da solo — sempre nominata come domanda per l'Owner, mai inventata.

## ⛔ LA PROSSIMA AZIONE — quattro fili aperti, chiedere all'Owner quale seguire

**`D-0271` (questo giro)**: l'Owner ha detto "procedi" dopo la pausa 2, senza rispondere
alle domande di scoping lasciate in sospeso — la reazione giusta (per lo stesso principio
di `D3c`: leggere lo stato prima di scrivere codice) è stata controllare
`PROJECT_STATE.json.deferred_items`, che si è rivelato essere ESATTAMENTE la lista
"debito+packaging" che il piano nomina. Triaggiati tutti gli 8 item:

- **Chiusi con prove (3)**: `tools/verify-package.py` import `sys` inutilizzato rimosso;
  `AuditLedger.append()` era O(n) per scrittura (rileggeva l'intero ledger a ogni evento
  solo per trovare l'ultimo hash) — ora O(1), `lastHash` cachato in memoria dalla
  costruzione; firma di TUTTI e 4 i documenti SBOM (rigenerati freschi contro
  `:phase4-voice-control`, non contro il tag stantio del report esistente), verificati
  PASS, tamper-rejection provata.
- **Investigato, NON chiuso, peggio del previsto (1)**: `oci/Dockerfile` (il Dockerfile
  canonico, distinto dai ~50 overlay `phase4-*`) **non ha Postgres installato e non ha
  `noesar-supervisor` come PID1** — ricostruirlo oggi, anche con un passo di rete
  registrato per `apt-get`, produrrebbe un'immagine che non si avvia come il prodotto
  reale. Serve una fase dedicata, non una correzione rapida.
- **Lasciati fuori scope, per motivi nominati (3)**: portale di firma aggiornamenti e
  Passkey/WebAuthn sono funzionalità nuove, non debito — meritano uno scoping dedicato
  come `D3c`; TLS off-by-default è design deliberato (`D-0198`), non debito; il pentest
  indipendente è dell'Owner nel **Blocco G**, non di E+F.

**Non c'è più debito sicuro e ben definito da chiudere da soli.** I quattro fili rimasti
(portale firma, Passkey/WebAuthn, `oci/Dockerfile`, oppure passare al Blocco G) sono TUTTI
decisioni di scope/priorità dell'Owner, non tecniche — **chiedere quale seguire prima di
scrivere altro codice**, esattamente come per D3c.

**Non rifare**: i 2 test nuovi di `audit.test.mjs`, `scripts/test.sh` 10/10, seeded-defect
19/19, `MANIFEST.sha256` 5886/5886 (D-0271).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-audit-ledger-perf` (`D-0271`) · `Up
  (healthy)` · `192.168.178.100:8100→8088` · hardening intatto ·
  `migrations:19 rls_tables:18`. Rollback preservato:
  `noesar-evolution.rollback-audit-ledger-perf-20260731T070727Z` (`:phase4-voice-control`).
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Blocco D (Ricerca+TUI+pannelli+tasti+Voce) è COMPLETO** — vedi `D-0266`…`D-0270`.
- **`oci/Dockerfile` NON riflette il prodotto vivo** — nessuno stato precedente lo aveva
  mai verificato riga per riga contro la produzione reale prima di `D-0271`.
- **La chiave di firma SBOM usata in `D-0271` è di sessione, mai persistente** — il
  fingerprint pubblico è in `docs/SBOM_REPORT.md`, la chiave privata non è mai stata nel
  repository e non sopravvive a questa sessione.
- **`deferred_items` in `PROJECT_STATE.json` ORA riflette lo stato vero** — 3 chiusi, 1
  investigato/riaperto con dettaglio, 3 invariati per motivo nominato.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0271`

| Verifica | Risultato |
|---|---|
| `node --test` (suite completa) | **1349/1350 PASS** (1 skip pre-esistente, +2) |
| `tools/run-eslint.sh` | **262 file · 0 errori** |
| `scripts/test.sh` (9 step) | **10/10 PASS** |
| `tools/seeded-defect-proof.mjs` | **19/19 catturati** |
| `MANIFEST.sha256` | **5886/5886** |
| SBOM: 4/4 documenti firmati | tutti `PASS`, tamper-rejection provata su una copia alterata |
| deploy (`audit.mjs`) | stop pulito, backup, §5a rispettato, `Up (healthy)`, byte identici |

## ➜ Le domande all'Owner ancora senza risposta

**Quale dei quattro fili seguire**: (1) scoping del portale di firma aggiornamenti; (2)
scoping di Passkey/WebAuthn; (3) riconciliare `oci/Dockerfile` col prodotto vivo (rischio
sull'integrità del percorso di build, va fatto con calma); (4) passare al Blocco G
(Owner Bootstrap+pentest). Nessuna di queste è una scelta tecnica mia da fare da sola.
