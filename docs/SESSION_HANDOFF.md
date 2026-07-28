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

**`D-0203`: Fase 1 (la spina dorsale, 09_PIANO.md §2) è CHIUSA.** Il criterio §3 include
testualmente "esegue i test, corregge un errore" — EXECUTE resta rifiutato per design,
tre volte (D-0189/D-0191/D-0201). L'Owner ha istruito in sessione di chiudere così com'è
e procedere direttamente a **Fase 7** ("Il mondo esterno"), **saltando le Fasi 2-6**
(workspace, le due shell, memoria/privacy, isolamento vero, ATOM) — dichiarato
esplicitamente, non scoperto in silenzio.

**`D-0204`: Fase 7 aperta, passo 27 (framework moduli di settore + livelli di fiducia)
costruito, installato, verificato nella stessa fase (`:phase4-sector-modules`).**
`sector-modules.mjs` nuovo: valida/lista manifest candidati contro
`schemas/industry-module-manifest.schema.json` e
`capabilities/security/{trust-level-policy,permission-catalog}.json` — tracciati in
MANIFEST dal 2026-07-25, mai copiati in un'immagine né letti da codice fino ad ora
(schema morto, 09_PIANO.md §1). Trovato costruendo: l'unico esempio tracciato
(`capabilities/templates/industry-module/module.template.json`) non validava contro lo
schema che dovrebbe esemplificare (camelCase contro snake_case) — riparato, verificato
fallire-prima/passare-dopo. 3 rotte nuove, sola lettura/validazione, nessuna scrive stato
prodotto (`enforced:false`, `wiredToCapabilityMinting:false`, dichiarato).

**Prossima azione**: passo 28 (pacchetti di conformità firmati e datati), o a scelta
dell'Owner.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-sector-modules` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-findings-20260728T104143Z`. Due container di progetto, che è
quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

**`D-0203`** (state-only, nessun codice): Fase 1 chiusa. `PROJECT_STATE.json` +
`docs/DECISION_LOG.md` aggiornati.

**`D-0204`** (commit da fare): `sector-modules.mjs` nuovo (validatore JSON-Schema fatto in
casa, dichiarato sottoinsieme non motore generale), 3 rotte in `server.mjs`,
`sector-modules.test.mjs` nuovo (18 test), `capabilities/templates/industry-module/module.template.json`
riparato (era incompatibile con lo schema tracciato), `oci/Dockerfile.phase4-sector-modules`
nuovo. `PROJECT_STATE.json` corretto anche su due incoerenze pre-esistenti segnalate dal
digest a inizio sessione: `product_test_suite.unit`/`.eslint`/`.manifest` erano stale di
due fasi (894/187/5785 invece di 932/193/5790).

## ➜ Verifiche prodotte in sessione

```text
D-0204: unit 914→932 (+18), ESLint 191→193 file 0 errori, verify-source/http-smoke/
  auth-http-smoke PASS, browser e2e 315/315 (riverificato, 0 regressioni), accessibilità
  27/27 (riverificato), difetti seminati 19/19 (riverificato), scripts/test.sh pass=5
  fail=0 partial=1 unavailable=4 (python3 assente sull'host, invariato). MANIFEST
  5788→5790, 5790/5790 verificate. Byte immagine = albero su 5 file (server.mjs,
  sector-modules.mjs, trust-level-policy.json, permission-catalog.json, schema) via
  container usa-e-getta. Dal vivo: /livez 200, /readyz 200, /healthz invariato, le 3
  rotte nuove 401 non autenticato, rotta inesistente 404, RestartCount=0.
  Sweep DebugLab (nuova superficie, rule 40d): services/ 0 finding; capabilities/ ha
  trovato 23 CRITICAL/9 HIGH pre-esistenti e non correlati in capabilities/reference/*.py
  (F7-001, aperto, basso, non toccato — fuori scope di questo passo).
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Fasi 2-6 del roadmap (09_PIANO.md §2) non sono costruite** — saltate su istruzione
  diretta dell'Owner in questa sessione (D-0203), non un errore.
- Il framework moduli di settore **non è enforced**: `sectorModulesStatus().enforced ===
  false`, `wiredToCapabilityMinting === false`. Nessun modulo reale è mai stato
  installato — `.sector-modules/` (runtime, non nell'immagine) è vuota su ogni
  deployment finora.
- **F7-001 aperto**: 23 CRITICAL/9 HIGH in `capabilities/reference/*.py` (subprocess con
  path parziale verso `openssl`, un letterale di test flaggato come possibile password).
  Non è la superficie toccata da questo passo (`sector-modules.mjs` legge solo
  `capabilities/security/*.json`, mai `capabilities/reference/`).
- Tutto ciò che era falso a fine `D-0201` e non toccato da `D-0203`/`D-0204` resta falso:
  `operationsSupported: ['WRITE']`, `testExecution: false`,
  `runsPersistAcrossRestart: false`, registri in memoria, firma provenance simmetrica,
  `.ps1` mai eseguiti, TLS costruita ma non attiva.

## ➜ Blocker aperti

`B-002` (low, nessun gitleaks/trufflehog installabile — regola 45). Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **La conformità della conservazione dei dati delle richieste rifiutate** — non è una
  decisione dell'Owner: il disegno è già autorizzato (`D-0136`), manca una verifica di
  conformità legale/normativa esterna a questo progetto.
- **Da `D-0197`, invariata**: si vuole spostare anche le credenziali dentro PostgreSQL,
  contro la ragione di design documentata (`F4-013`)?
- **Da `D-0198`, invariata**: si vuole attivare TLS ora fornendo un certificato?
- **Da `D-0201`, invariata**: si vuole riaprire EXECUTE come fase propria?
- **Nuova**: `F7-001` (bandit/ruff in `capabilities/reference/*.py`) — riparare in una
  fase dedicata, o accettare come rischio residuo dichiarato di codice dormiente?
