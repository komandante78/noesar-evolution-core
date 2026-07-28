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

**`D-0203`: Fase 1 CHIUSA.** EXECUTE resta rifiutato per design. Su istruzione
dell'Owner, si procede in **Fase 7** ("Il mondo esterno"), **Fasi 2-6 saltate**
esplicitamente.

Quattro passi di Fase 7 chiusi e installati **nella stessa sessione, uno via l'altro**,
su istruzione esplicita dell'Owner di non fermarsi:

- **`D-0204` passo 27** — framework moduli di settore + livelli di fiducia. `:phase4-sector-modules`.
- **`D-0205` passo 28** — pacchetti di conformità firmati e datati, firma Ed25519 reale
  (interoperabilità con `openssl` provata). `:phase4-compliance-packs`.
- **`D-0206` passo 29** — Technology Radar, seed di 15 voci **reali** (non placeholder).
  `:phase4-technology-radar`.
- **`D-0207` passo 30** — "OIDC, SAML, SCIM": **SCIM davvero cablato** a `UserDirectory`
  (primo passo *enforced*, non solo framework — creare/disabilitare/riabilitare/
  deprovisionare un utente per davvero via `/scim/v2/Users`, provato con 13 test HTTP
  end-to-end contro un server reale). OIDC verifica RS256 reale (JWKS, `node:crypto`)
  ma non collegata a un login. **SAML esplicitamente NON costruito** (nessun parser XML
  sicuro senza una nuova dipendenza — dichiarato, non finto). `:phase4-oidc-saml-scim`
  (**installazione corrente**).

**Prossima azione**: passo 31 (SBOM, ML-BOM, CBOM, build riproducibili, firme), o a
scelta dell'Owner.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-oidc-saml-scim` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-technology-radar-20260728T113911Z`. Due container di
progetto, che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

`D-0203` → `D-0204` → `D-0205` → `D-0206` → `D-0207`. Quattro commit pushati su
`origin/main`. Dettaglio completo di ciascuno nel decision log.

## ➜ Verifiche prodotte in sessione (cumulative, ultima misura per voce)

```text
unit 914→932→954→972→1018 (+104 sui quattro passi), ESLint 191→…→204 file 0 errori,
verify-source/http-smoke/auth-http-smoke PASS ad ogni passo, browser e2e 315/315
(riverificato 4 volte, 0 regressioni), accessibilità 27/27 (riverificato 4 volte),
difetti seminati 19/19 (riverificato 4 volte), scripts/test.sh pass=5 fail=0 invariato
(python3 assente sull'host). MANIFEST 5788→…→5802, sempre N/N verificate. Byte immagine
= albero verificato ad ogni deploy. Quattro deploy live consecutivi, tutti healthy al
primo tentativo, restarts=0. gitleaks dopo ogni commit: 0 leak. DebugLab full-sweep
(nuova superficie ogni volta, e D-0207 tocca autenticazione): sempre 0 finding in
services/.
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Fasi 2-6 del roadmap non sono costruite** — saltate su istruzione dell'Owner (D-0203).
- **Sector modules, compliance packs, Technology Radar restano non enforced**
  (`enforced:false`). **SCIM è l'eccezione: `enforced:true`** — è la prima superficie di
  Fase 7 che cambia davvero lo stato del prodotto.
- **OIDC non emette sessioni**: verifica un ID token o un discovery document se glielo
  passi, non esiste un flusso di login OIDC nell'interfaccia.
- **SAML non esiste per niente** in questo prodotto — nessuna rotta, nessun modulo,
  nessuna verifica di assertion XML.
- **F7-001 aperto**: 23 CRITICAL/9 HIGH in `capabilities/reference/*.py` + 7 CRITICAL/2
  HIGH in due file di `tools/` — stessa classe (subprocess con percorso parziale),
  pre-esistente, mai nei file scritti in questa sessione.
- Tutto ciò che era falso a fine `D-0201` e non toccato resta falso:
  `operationsSupported: ['WRITE']`, `testExecution: false`,
  `runsPersistAcrossRestart: false`, registri in memoria, firma **provenance** (build,
  non compliance-pack/radar) simmetrica, `.ps1` mai eseguiti, TLS costruita ma non
  attiva.

## ➜ Blocker aperti

`B-002` (low, nessun gitleaks/trufflehog installabile — regola 45). Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **La conformità della conservazione dei dati delle richieste rifiutate** — verifica
  legale/normativa esterna a questo progetto (design già autorizzato, `D-0136`).
- **Da `D-0197`, invariata**: credenziali dentro PostgreSQL contro `F4-013`?
- **Da `D-0198`, invariata**: attivare TLS ora fornendo un certificato?
- **Da `D-0201`, invariata**: riaprire EXECUTE come fase propria?
- **`F7-001`**: riparare in una fase dedicata, o accettare come rischio residuo
  dichiarato di codice dormiente?
- **SAML**: vale la pena introdurre una libreria XML per costruirlo per davvero, o resta
  dichiarato-non-costruito a tempo indeterminato?
