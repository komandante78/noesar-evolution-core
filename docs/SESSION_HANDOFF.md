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

**`D-0203`: Fase 1 CHIUSA.** EXECUTE resta rifiutato per design (D-0189/D-0191/D-0201).
Su istruzione dell'Owner, si è proceduto direttamente a **Fase 7** ("Il mondo esterno"),
**saltando le Fasi 2-6** — dichiarato esplicitamente.

**`D-0204`: passo 27 (framework moduli di settore + livelli di fiducia) chiuso.**
`sector-modules.mjs`: rivive `capabilities/security/{trust-level-policy,
permission-catalog}.json` + `schemas/industry-module-manifest.schema.json` (schema morto
dal 2026-07-25). Trovato e riparato: il template tracciato non validava contro il proprio
schema. Installato `:phase4-sector-modules`.

**`D-0205`: passo 28 (pacchetti di conformità firmati e datati) chiuso, installato.**
`compliance-packs.mjs`: rivive `schemas/compliance-pack.schema.json` (schema morto),
**applica** la finestra datata (non-ancora-efficace / scaduto / finestra vuota, tre
motivi distinti), verifica firma **Ed25519 reale** (`node:crypto`) — interoperabilità con
`openssl pkeyutl` **provata in entrambe le direzioni**, non solo asserita. Firma **solo
CLI** (`tools/sign-compliance-pack.mjs`/`verify-compliance-pack.mjs`), mai HTTP: una
chiave privata non raggiunge `server.mjs`. Nessun contenuto di alcuna giurisdizione
spedito — la matrice (`PROJECT_GOVERNANCE/DATA/compliance-pack-matrix.csv`) segna "legal
review: required" su tutte e 14, nessuna fatta. Installato `:phase4-compliance-packs`.

**Prossima azione**: passo 29 (Technology Radar), o a scelta dell'Owner. Sessione ancora
in corso su istruzione esplicita dell'Owner di proseguire senza fermarsi.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-compliance-packs` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-sector-modules-20260728T110745Z`. Due container di progetto,
che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

`D-0203` (state-only) → `D-0204` (sector-modules.mjs, 3 rotte, installato) → `D-0205`
(compliance-packs.mjs, 3 rotte, 2 CLI tool nuovi, installato). Dettaglio completo di
ciascuna nel decision log.

## ➜ Verifiche prodotte in sessione (cumulative, ultima misura per voce)

```text
unit 914→932→954 (+40 sui due passi), ESLint 191→193→197 file 0 errori,
verify-source/http-smoke/auth-http-smoke PASS ad ogni passo, browser e2e 315/315
(riverificato 2 volte, 0 regressioni), accessibilità 27/27 (riverificato 2 volte),
difetti seminati 19/19 (riverificato 2 volte), scripts/test.sh pass=5 fail=0 invariato
(python3 assente sull'host). MANIFEST 5788→5790→5794, sempre N/N verificate. Byte
immagine = albero verificato ad ogni deploy (5 file poi 3 file). Due deploy live
consecutivi, entrambi healthy al primo tentativo, restarts=0. gitleaks dopo il primo
commit: 144 commit, 0 leak.
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Fasi 2-6 del roadmap non sono costruite** — saltate su istruzione diretta
  dell'Owner (D-0203).
- Né il framework moduli di settore né i pacchetti di conformità sono **enforced**:
  `sectorModulesStatus().enforced === false`, `compliancePacksStatus().enforced ===
  false`. Nessun modulo e nessun pacchetto reale è mai stato installato — entrambe le
  directory runtime (`.sector-modules/`, `.compliance-packs/`) sono vuote su ogni
  deployment finora.
- **Nessun contenuto di conformità reale esiste** per nessuna giurisdizione — spedirlo
  richiederebbe la revisione legale che la matrice stessa dichiara mancante ovunque.
- **F7-001 aperto, esteso in D-0205**: 23 CRITICAL/9 HIGH in `capabilities/reference/*.py`
  + 7 CRITICAL/2 HIGH in `tools/create-rust-build-provenance.py` e `verify-package.py` —
  stessa classe (subprocess con percorso parziale verso un eseguibile), pre-esistente,
  mai nei file che questa sessione ha scritto. Non riparato, fuori scope.
- Tutto ciò che era falso a fine `D-0201`/`D-0204` e non toccato resta falso:
  `operationsSupported: ['WRITE']`, `testExecution: false`,
  `runsPersistAcrossRestart: false`, registri in memoria, firma **provenance** (non
  quella dei compliance pack) simmetrica, `.ps1` mai eseguiti, TLS costruita ma non
  attiva.

## ➜ Blocker aperti

`B-002` (low, nessun gitleaks/trufflehog installabile — regola 45). Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **La conformità della conservazione dei dati delle richieste rifiutate** — verifica
  legale/normativa esterna a questo progetto (design già autorizzato, `D-0136`).
- **Da `D-0197`, invariata**: credenziali dentro PostgreSQL contro la ragione di design
  documentata (`F4-013`)?
- **Da `D-0198`, invariata**: attivare TLS ora fornendo un certificato?
- **Da `D-0201`, invariata**: riaprire EXECUTE come fase propria?
- **`F7-001`**: riparare in una fase dedicata, o accettare come rischio residuo
  dichiarato di codice dormiente?
