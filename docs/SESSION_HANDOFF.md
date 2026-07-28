# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-28. Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai CodeN Ultra, NOESAR V3,
ATOM o altro dell'host. L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Da `D-0172` impone tre skill sempre attive.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**`D-0201`: `F4-014`/`F4-015`/`F4-016` chiusi — costruiti, installati e verificati nella
stessa fase (`:phase4-findings`).** L'Owner ha scelto esplicitamente questi tre invece di
riaprire EXECUTE (confine di sicurezza deliberato, `D-0191`, lasciato intatto).

- **`F4-014`**: l'esecutore era l'unico dei sei passi senza oracolo condiviso.
  `conformance/executor-vectors.json` (10 casi) ora esiste, e sia
  `executor-vectors.test.mjs` (Node) sia `rust/crates/noesar-executor/tests/conformance.rs`
  (Rust, mai scritto prima nonostante l'header lo affermasse) girano sullo stesso file.
  **Trovata una vera divergenza costruendo**: Node lanciava un kind `'COVERAGE'` che
  l'enum Rust `ShadowError` non ha affatto — Rust riporta lo stesso rifiuto come
  `Invalid`. Allineato Node a `'INVALID'`.
- **`F4-015`**: `GET /api/v1/shadow` scriveva sul filesystem (probe reflink reale) a ogni
  richiesta — una GET non deve avere effetti collaterali. Ora il probe gira una volta
  all'avvio e la GET serve la cache; nuovo `POST /api/v1/shadow/reprobe` è l'unica rotta
  che scrive.
- **`F4-016`**: `reasoning.mjs` pianificava sempre contro la stringa letterale
  `/workspace` (`PRODUCT.workspaceRoot` non era mai definito). Ora usa la costante
  `workspace` reale, come già fanno `shadow.mjs` e `repo-map.mjs`.

**Nessun blocker aperto, nessun reperto di severità bassa non dichiarato resta.**
`F4W-011` (misura contro MASTER V4) e `F4W-012` (disegno WebUI) restano le uniche voci
`open_findings`, non toccate da questa fase — sono di natura diversa (misura/design, non
bug).

## ➜ Stato dell'installazione

`noesar-evolution:phase4-findings` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-tls-20260728T095332Z`. Due container di progetto, che è quanto
§5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

**`D-0195`+`D-0196`** (commit `802b54b`): `apps/webui-react` rimossa, tre decisioni
dell'Owner registrate.

**`D-0197`** (commit `3a29c3f`): `B-008` verificato stale e chiuso senza migrare nulla.

**`D-0198`** (commit `f721d62`): TLS in-process costruita e installata, non attivata.

**`D-0199`+`D-0200`** (commit `be305e8`): repository GitHub privato creato e pushato;
secret scan rieseguito dopo il commit ha trovato e corretto un fixture di test a forma di
chiave PEM.

**`D-0201`** (non ancora committato al momento in cui questo file è scritto):
`F4-014`/`F4-015`/`F4-016` chiusi. File nuovi: `conformance/executor-vectors.json`,
`services/reference-control-plane/test/executor-vectors.test.mjs`,
`rust/crates/noesar-executor/tests/conformance.rs`,
`oci/Dockerfile.phase4-findings`. Modificati: `server.mjs`, `executor.mjs`,
`executor.test.mjs`, `tools/auth-http-smoke.mjs`, `PROJECT_STATE.json`, `MANIFEST.sha256`.

## ➜ Verifiche prodotte in sessione

```text
D-0195..D-0200: vedi le rispettive voci del decision log, invariate qui.
D-0201: unit 903→914 (+11), ESLint 190→191 file 0 errori, verify-source/http-smoke/
  auth-http-smoke/tls-smoke tutti PASS, MANIFEST 5785→5788 (5788/5788 verificate)
  Rust: container rust:1-bookworm --network=none --cap-drop=ALL, RUSTUP_TOOLCHAIN
  pinnato, cargo test --workspace --locked --offline --all-targets → exit 0, zero
  FAILED in tutto il workspace, noesar-executor 12 nativi + 1 nuovo vettore PASS
  byte immagine = albero (server.mjs, executor.mjs) via container usa-e-getta
  dal vivo: /livez 200, /readyz 200, /healthz 200 invariato, GET/POST shadow 401,
  GET su /shadow/reprobe 404 (verbo sbagliato, prova F4-015 applicato), rotta
  inesistente 404, data-plane.identity-projected projected:1 riconfermato
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- Tutto ciò che era falso a fine fase precedente e non toccato da questa sessione resta
  falso: `operationsSupported: ['WRITE']` (DELETE/EXECUTE dichiarati non costruiti),
  `testExecution: false`, `runsPersistAcrossRestart: false`, registri in memoria, firma
  provenance simmetrica, `.ps1` mai eseguiti.
- **EXECUTE resta permanentemente rifiutato** — non toccato, per scelta esplicita
  dell'Owner in questa sessione (ha scelto i tre reperti minori invece di riaprirlo).
- TLS costruita ma **non attiva**: `tls_active:false` sul vivo.
- Il repository su GitHub esiste ma nessuna credenziale è salvata per pushare di nuovo.
- Un warning di compilazione Rust pre-esistente (`unused import: ShadowLimits` in
  `noesar-executor/src/lib.rs:26`) **non è stato toccato** — fuori dallo scope dichiarato
  di questa fase (non è un difetto di comportamento, solo un warning del compilatore).

## ➜ Blocker aperti

Nessuno.

## ➜ Le domande all'Owner ancora senza risposta

Restano solo:

- **La conformità della conservazione dei dati delle richieste rifiutate** — non è una
  decisione dell'Owner da prendere: il disegno è già autorizzato (`D-0136`), manca una
  verifica di conformità legale/normativa esterna a questo progetto.
- **Da `D-0197`, invariata**: si vuole davvero spostare anche le credenziali dentro
  PostgreSQL, contro la ragione di design documentata (`F4-013`)?
- **Da `D-0198`, invariata**: si vuole attivare TLS ora fornendo un certificato?
- **Nuova**: si vuole eventualmente riaprire EXECUTE (esecuzione sandboxata di test/codice)
  come fase propria, ora che i tre reperti minori sono chiusi? Rifiutato esplicitamente per
  questa sessione, non deciso per sempre.
