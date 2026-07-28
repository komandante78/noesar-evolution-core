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

**Il roadmap `09_PIANO.md` §2 è CHIUSO nella sua interezza — passi 1-31, tutti costruiti
o esplicitamente dichiarati fuori scope.** Nessuna prossima azione è pre-decisa: sta
all'Owner scegliere fra le Fasi 2-6 saltate (D-0203), riaprire EXECUTE come fase propria
(rifiutato tre volte, D-0189/D-0191/D-0201), costruire SAML introducendo una dipendenza
XML autorizzata (D-0207), o altro.

**`D-0203`: Fase 1 CHIUSA** — EXECUTE resta rifiutato per design, Fasi 2-6 saltate su
istruzione dell'Owner.

**Fase 7 — cinque passi, tutti chiusi nella stessa sessione, senza fermarsi, su
istruzione esplicita dell'Owner:**

- **`D-0204` passo 27** — framework moduli di settore + livelli di fiducia. `:phase4-sector-modules`.
- **`D-0205` passo 28** — pacchetti di conformità firmati e datati, firma Ed25519 reale.
  `:phase4-compliance-packs`.
- **`D-0206` passo 29** — Technology Radar, seed di 15 voci reali. `:phase4-technology-radar`.
- **`D-0207` passo 30** — "OIDC, SAML, SCIM": SCIM davvero cablato a `UserDirectory`
  (primo passo *enforced*), OIDC verifica RS256 reale, SAML esplicitamente non
  costruito. `:phase4-oidc-saml-scim` (**installazione corrente, resta tale**).
- **`D-0208` passo 31 (ULTIMO)** — SBOM/ML-BOM/CBOM/build riproducibili/firme. **Nessun
  deploy**: cinque tool offline in `tools/`, nessuna riga toccata in `server.mjs`. CBOM
  reale (6 algoritmi trovati grep-ando il sorgente vero), ML-BOM dichiarato vuoto
  (verificato, 0 file-modello nei due alberi spediti), firma riusata dal passo 28,
  riproducibilità build **misurata per la prima volta** (2/2 build identiche byte per
  byte sulla catena incrementale — l'immagine base resta dichiarata non riproducibile,
  non ri-testata, servirebbe rete).

## ➜ Stato dell'installazione

`noesar-evolution:phase4-oidc-saml-scim` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-technology-radar-20260728T113911Z`. Due container di
progetto, che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione. **Invariata
rispetto a `D-0207`** — `D-0208` non ha prodotto un deploy.

## ➜ Cosa è stato fatto in questa sessione

`D-0203` → `D-0204` → `D-0205` → `D-0206` → `D-0207` → `D-0208`. Cinque commit pushati
su `origin/main`. Dettaglio completo di ciascuno nel decision log.

## ➜ Verifiche prodotte in sessione (cumulative, ultima misura per voce)

```text
unit 914→932→954→972→1018 (+104 sui passi 27-30, invariato al passo 31 — nessun
file server toccato), ESLint 191→...→209 file 0 errori, verify-source/http-smoke/
auth-http-smoke PASS ad ogni passo con rotte nuove, browser e2e 315/315 (riverificato
4 volte, 0 regressioni), accessibilità 27/27 (riverificato 4 volte), difetti seminati
19/19 (riverificato 4 volte), scripts/test.sh pass=5 fail=0 invariato (python3 assente).
MANIFEST 5788→5807, sempre N/N verificate. Quattro deploy live (passi 27-30), tutti
healthy al primo tentativo, restarts=0, byte immagine=albero provato ogni volta.
gitleaks dopo ogni commit: 0 leak, 147 commit alla chiusura. DebugLab full-sweep ogni
volta che si introduce una superficie nuova: sempre 0 finding nei file scritti in
questa sessione (F7-001 raccoglie i reperti pre-esistenti trovati per strada, mai nei
file nuovi). Passo 31: pipeline inventario→CBOM→ML-BOM→firma→verifica provata dal vivo
contro l'immagine in esecuzione, un documento manomesso correttamente rifiutato,
riproducibilità build 2/2.
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Fasi 2-6 del roadmap non sono costruite** — saltate su istruzione dell'Owner (D-0203).
- **Sector modules, compliance packs, Technology Radar, OIDC restano non enforced**
  (`enforced:false`). **SCIM è l'unica eccezione** (`enforced:true`).
- **SAML non esiste per niente** in questo prodotto.
- **Nessun documento SBOM/CBOM/ML-BOM è committato nel repository** — sono generati al
  volo da chi li chiede, contro l'immagine che gli si dà in pasto; un documento
  committato diventerebbe stale al primo deploy successivo, ed è per questo che
  `generate-inventory.mjs` non lo è mai stato.
- **La riproducibilità misurata copre solo la catena incrementale** (`Dockerfile.phase4-*`,
  `FROM` un tag locale + `COPY`, `--network=none`). **L'immagine base
  (`Dockerfile.phase4`, `apt-get`) resta dichiarata NON riproducibile, mai ri-testata
  in questa sessione** — richiederebbe accesso alla rete.
- **F7-001 aperto**: reperti pre-esistenti (subprocess a percorso parziale) in
  `capabilities/reference/*.py` e due file di `tools/` — mai nei file scritti in questa
  sessione, mai riparato, fuori scope dichiarato.
- Tutto ciò che era falso a fine `D-0201` e non toccato resta falso:
  `operationsSupported: ['WRITE']`, `testExecution: false`,
  `runsPersistAcrossRestart: false`, registri in memoria, firma **provenance** (build,
  non i nuovi documenti di rilascio) simmetrica, `.ps1` mai eseguiti, TLS costruita ma
  non attiva.

## ➜ Blocker aperti

`B-002` (low, nessun gitleaks/trufflehog/syft/cyclonedx installabile — regola 45).
Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **La conformità della conservazione dei dati delle richieste rifiutate** — verifica
  legale/normativa esterna a questo progetto (design già autorizzato, `D-0136`).
- **Da `D-0197`, invariata**: credenziali dentro PostgreSQL contro `F4-013`?
- **Da `D-0198`, invariata**: attivare TLS ora fornendo un certificato?
- **Da `D-0201`, invariata**: riaprire EXECUTE come fase propria?
- **`F7-001`**: riparare in una fase dedicata, o accettare come rischio residuo
  dichiarato di codice dormiente?
- **SAML**: vale la pena una libreria XML per costruirlo per davvero?
- **Nuova, ora che il roadmap è chiuso**: qual è il prossimo obiettivo del progetto?
  Le Fasi 2-6 saltate, o qualcos'altro non ancora nominato in `09_PIANO.md`?
