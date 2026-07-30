# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0265`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008 + pulizia matrice) → B (SESS-001..003) →
> C (CUBE-001..009) → pausa 1 → decisione WebUI → pausa 2 → E+F (debito+packaging) →
> pausa 3 → G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B e C COMPLETI. `CUBE-001` attraverso `CUBE-009` tutti costruiti e
> verificati dal vivo — l'intera matrice di accettazione di `14_MEMORIA_A_CUBI.md` è
> chiusa. Prossimo: pausa 1, poi la decisione WebUI.**

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

**Unica eccezione documentata (`D-0232`)**: il peso `phi-4-Q4_K_M.gguf` è stato **letto**
(copia read-only) su istruzione diretta dell'Owner che l'ha nominato.

## ⚠️ QUATTRO REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted, mai una modifica
   all'host come rimedio.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: ogni fase produce una proposta di
   miglioramento; eseguirla è decisione dell'Owner.
5. **`EXECUTE` è una decisione del CLIENTE** (`D-0250`): già risolto come config.

## ➜ LA PROSSIMA AZIONE — Blocco C completo, pausa 1 poi la decisione WebUI

**Block C6 fatto (`D-0265`)**: tredicesima destinazione WebUI "Memory", interamente sopra
quanto già costruito (`GET /api/v1/memory/recall` per cerca/sfoglia, la coda di
approvazione a 4 fonti già esistente per approva/scarta — **nessuna nuova rotta
backend**). Parole normali (`MEMORY_CATEGORY_LABELS`), mai `cube`/`promotion_state`/
`contamination` fuori da un dettaglio aperto di proposito. **`CUBE-009` chiuso —
CHIUDE L'INTERA MATRICE DI ACCETTAZIONE del documento.**

**Collisione di nomi trovata e risolta**: `id="view-memory"` apparteneva già al pannello
manuale "memorie" (titolo/contenuto/tag, `state.memories`, dentro Knowledge) — rinominato
`#memory-notes-block` (solo l'id del contenitore, verificato non referenziato altrove),
titolo cambiato in "Notes". Due feature ora distinte: **Notes** (scritte a mano) vs.
**Memory** (scritta automaticamente, mai a mano — §11).

**⚠️ Due bug reali trovati e riparati verificando questo dal vivo in un browser reale,
nessuno nella destinazione Memory stessa**: (1) `page.click()` di Puppeteer si staccava
dal documento ("Node is detached") durante l'approvazione di un item — tracciato allo
stack trace fino a `scrollIntoViewIfNeeded`, riparato con un click sintetico in-pagina;
(2) una corsa fra il test e il proprio refresh asincrono della striscia di approvazione.
**Entrambi mascherati finché la coda di approvazione era sincrona-veloce in memoria**,
esposti dal vero giro di rete Postgres che `D-0263` ha introdotto in una delle sue
quattro fonti. Un terzo fix difensivo (guardia latest-call-wins su `refreshApprovals()`)
è valido ma NON ha da solo riparato nessuno dei due — dichiarato onestamente.

**Tre copie indipendenti hardcoded della lista destinazioni trovate e riconciliate**
(`tools/browser-e2e.mjs`, `tools/accessibility-audit.mjs`, `tools/computed-style-
snapshot.mjs`) più una quarta che legge `app.js` direttamente (`webui-markup-structure.
test.mjs`) — nessuna indovinata, ognuna trovata eseguendo il controllo e leggendo cosa
si rompeva.

**Prossima azione reale**: nessuna azione tecnica pendente su Block C. Il piano a fasi
prevede ora **pausa 1** (obbligatoria per l'Owner), poi la **decisione WebUI**. Riportare
il Blocco C completo e attendere direzione.

**Non rifare**: le 35 verifiche `MEM-01..36` (`D-0263`/`D-0264`), le 8 `CUBE04-01..08`
(`D-0262`), suite E2E completa **334/334** e audit accessibilità **27/27** (`D-0265`).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-memory-webui` (`D-0265`) · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:19 rls_tables:18` ·
  workspace canonico proiettato all'avvio · byte immagine identici · stop pulito.
  Rollback preservato: `noesar-evolution.rollback-memory-webui-20260730T173434Z`
  (`:phase4-memory-model-swap`).
- **`embedding_models`/promozioni reali sono vuote in produzione** — l'intero Blocco C ha
  provato il MECCANISMO (schema, servizio, procedura di scambio, superficie WebUI), non
  lo ha ancora popolato con dati reali — nessun codice applicativo scrive ancora memoria
  automatica dal vivo (la compattazione è cablata su approve/reject di workspace-actions,
  mai esercitata fuori dai test).
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001` attraverso `CUBE-009` sono TUTTI ✔ COSTRUITI E VERIFICATI DAL VIVO.**
- **`CUBE-005` ha un residuo dichiarato, indipendente dai cubi**: il difetto originale
  (`vector_entries` senza identità di modello) resta aperto, fuori scope per questo
  documento (§9.1).
- **Gli strati di consolidamento (`14 §9.6` punto 9, giorno/mese/anno) non sono mai stati
  nella matrice di accettazione** — dichiaratamente rimandati ("prima serve materiale da
  consolidare"), nessuna azione mancante.
- **`B-009` non ha richiesto una migrazione dati**: 0 righe in `memory_items`,
  `state.memories`, tabelle Postgres delle conversazioni.
- **Nessun concetto di workspace nel percorso live del prodotto** — un solo workspace
  canonico proiettato all'avvio, stesso pattern usato per l'identità.
- **`INST-002`**: nessun token di installazione. **Bug menu "Ramo"** (`D-0235`): mai
  riprodotto.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0265`

| Verifica | Risultato |
|---|---|
| `npm test` + `npm run lint` + `scripts/test.sh` | **PASS** (1284/1285 — 1 skip pre-esistente, 255 file lint 0 errori, 19 migrazioni) |
| Suite E2E completa, Chromium reale via Puppeteer (`tools/browser-e2e.mjs`) | **334/334 PASS** (era 235/238 al primo tentativo, prima dei due fix reali) |
| Audit accessibilità (`tools/accessibility-audit.mjs`) | **27/27 PASS** |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, `migrations:19 rls_tables:18` |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna tecnica.** Il piano a fasi prevede una pausa dell'Owner qui (pausa 1).
