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

**`D-0198`: TLS in-process — costruita, installata e verificata nella stessa fase
(`:phase4-tls`).** Accanto alla via già documentata (reverse proxy davanti, esempi in
`deployment/reverse-proxy/`), il prodotto può ora terminare TLS da solo: nuovo modulo
`tls.mjs::resolveTls()`, `server.mjs` sceglie `node:https` quando
`NOESAR_TLS_CERT_FILE`+`NOESAR_TLS_KEY_FILE` sono entrambi presenti e validi, rifiuta una
coppia mezza configurata o un file non-PEM invece di ripiegare in plaintext in silenzio.
`secureCookies` diventa `true` automaticamente quando TLS è attivo. Il prodotto **non
genera mai un certificato da solo** — stessa ragione di `D-0055` sul bind address: quale
nome, autofirmato o CA, è una decisione dell'operatore.

**TLS resta OFF sull'installazione viva.** Nessun certificato fornito dall'Owner in questa
sessione: la capacità è installata, non accesa. Per accenderla serve fornire (o chiedere di
generare) un `NOESAR_TLS_CERT_FILE`+`NOESAR_TLS_KEY_FILE` e ridistribuire con quelle due
variabili impostate — nessun rebuild necessario, il codice è già lì.

**Trovato costruendo**: l'HEALTHCHECK del container (identico in `oci/Dockerfile` e
`Dockerfile.phase4`) interrogava solo HTTP — con TLS attivo avrebbe dichiarato il
container malato mentre il servizio risponde. Riparato con un controllo a due tentativi
(HTTP poi HTTPS, verifica certificato disattivata — controlla il proprio processo su
loopback, non una terza parte), provato in positivo contro un server plaintext, uno TLS
reale con certificato autofirmato di test, e nessun server.

**Rimane solo `B-001`** (remote git, bloccato in attesa delle credenziali dell'Owner).
Nessuna azione pendente su TLS o `B-008` (chiuso in `D-0197`).

## ➜ Stato dell'installazione

`noesar-evolution:phase4-tls` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-capability-csrf-20260728T090314Z`. Due container di progetto,
che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

**`D-0195`+`D-0196`** (commit `802b54b`): `apps/webui-react` rimossa, tre decisioni
dell'Owner registrate (`B-008`, `B-001`, TLS).

**`D-0197`** (commit `3a29c3f`): `B-008` verificato stale e chiuso senza migrare nulla —
la proiezione identità girava già da sola dal 2026-07-25.

**`D-0198`** (non ancora committato al momento in cui questo file è scritto): TLS
in-process. File nuovi: `services/reference-control-plane/src/tls.mjs`,
`services/reference-control-plane/test/tls.test.mjs` (9 test), `tools/tls-smoke.mjs`,
`oci/Dockerfile.phase4-tls`. Modificati: `server.mjs`, `oci/Dockerfile`,
`oci/Dockerfile.phase4` (HEALTHCHECK bi-modale in entrambi), `scripts/test.sh` (nuovo step
tristate), `docs/LAN_ACCESS_CONFIGURATION.md` (sezione TLS riscritta, due opzioni A/B),
`docs/REMAINING_WORK.md`, `PROJECT_STATE.json`, `MANIFEST.sha256`.

## ➜ Verifiche prodotte in sessione

```text
D-0195/D-0196/D-0197: vedi le rispettive voci del decision log, invariate qui.
D-0198: unit 894→903 (+9), ESLint 187→190 file 0 errori, tools/verify-source.mjs PASS,
  tools/http-smoke.mjs PASS, tools/auth-http-smoke.mjs PASS, tools/tls-smoke.mjs nuovo
  PASS (due listener reali: plaintext invariato, TLS con certificato di test — transport
  commutato, HSTS presente solo quando dovuto, cookie sicuri impliciti)
  MANIFEST 5782→5785, 5785/5785 verificate (conteggio OK incrociato con le righe — trovato
  che docs/LAN_ACCESS_CONFIGURATION.md ERA tracciato, contro l'assunzione ereditata)
  byte immagine = albero (server.mjs, tls.mjs) via container usa-e-getta
  dal vivo: /livez 200, /readyz 200, /healthz 200 invariato, rotta protetta 401, rotta
  inesistente 404, tls_active:false secure_cookies:false nel log di avvio (nessun
  certificato fornito), data-plane.identity-projected projected:1 riconfermato
```

⚠️ **Deviazione dichiarata in `D-0198`**: un controllo byte ridondante fatto con
`docker exec` sul container vivo (§5 regola 16 non lo ammette) — non necessario, il
controllo sull'immagine con un container usa-e-getta era già sufficiente. Nessuna
mutazione, nessun dato nuovo letto.

## ➜ Cosa NON è vero, e non va scoperto per caso

- Tutto ciò che era falso a fine fase precedente e non toccato da questa sessione resta
  falso: `operationsSupported: ['WRITE']` (DELETE/EXECUTE dichiarati non costruiti),
  `testExecution: false`, `runsPersistAcrossRestart: false`, registri in memoria, firma
  provenance simmetrica, `.ps1` mai eseguiti, `F4-014` (esecutore senza oracolo condiviso),
  `F4-015` (`shadowStatus()` scrive su una GET), `F4-016` (reasoning.mjs pianifica contro
  `/workspace` letterale).
- `B-001` deciso ma **bloccato**: nessuna credenziale fornita, nessun remote configurato.
- **TLS è costruita e installata ma NON attiva**: `tls_active:false` sul vivo. Non
  assumere che le connessioni siano cifrate finché un certificato non è configurato.

## ➜ Blocker aperti

- **`B-001`** — remote voluto dall'Owner, in attesa delle sue credenziali. `gh` non installabile.
- `B-002`, `B-008`, `B-009`, `B-010` — chiusi.

## ➜ Le domande all'Owner ancora senza risposta

Restano solo:

- **La conformità della conservazione dei dati delle richieste rifiutate** — non è una
  decisione dell'Owner da prendere: il disegno è già autorizzato (`D-0136`), manca una
  verifica di conformità legale/normativa esterna a questo progetto, prima che diventi
  codice in produzione.
- **Da `D-0197`, invariata**: si vuole davvero spostare anche le credenziali dentro
  PostgreSQL, contro la ragione di design documentata (`F4-013`, dump non cifrato)? Solo
  se sì è una fase reale da fare; altrimenti `B-008` resta chiuso così com'è.
- **Nuova, da `D-0198`**: si vuole attivare TLS ora fornendo un certificato (o chiedendo
  di generarne uno autofirmato per uso LAN), oppure la capacità resta lì finché non serve?
