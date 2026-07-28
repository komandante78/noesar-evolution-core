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

**`D-0197`: `B-008` era una voce stale — chiuso senza migrare nulla.** L'Owner ha scelto di
partire dalla migrazione identità (`D-0196`). Prima di scrivere codice, verificato lo stato
reale: `userDirectory.projectToDataPlane()` esiste **dal 2026-07-25** (commit `8350816`) ed
è **già chiamata a ogni avvio del server**, subito dopo che il data plane risponde pronto
(`server.mjs:1878`). Log del container vivo (lettura sola): `data-plane.ready
production_ready:true` seguito da `data-plane.identity-projected projected:1`.
`noesar_identity.users` **non è vuoto** — la premessa di `B-008` era vera quando scritta e
falsa ora, mai riverificata. Il disegno è deliberato (commento in testa a
`user-directory.mjs`): le credenziali restano SOLO in `state/auth.json` per non finire mai
in un dump SQL; solo i fatti d'identità (id/username/role/status) sono proiettati.
**Nessuna migrazione eseguita — non c'era nulla da migrare.**

**Rimangono da `D-0195`/`D-0196`, non toccate da questa fase**: TLS (fase autorizzata, non
costruita) e `B-001` (remote voluto dall'Owner, bloccato in attesa delle sue credenziali).

**Prossima fase, a scelta dell'Owner**: TLS, o il remote git (`B-001`, appena le
credenziali sono disponibili). Se l'Owner vuole *davvero* spostare anche le credenziali
dentro PostgreSQL (cambio architetturale che il codice attuale rifiuta di proposito, per
la ragione del backup-dump in `F4-013`), va riconfermato esplicitamente — non è implicito
in nessuna decisione presa finora.

## ➜ Stato dell'installazione

**Invariato da `D-0194`** — questa e la fase precedente sono entrambe source-only/lettura,
nessun rebuild/deploy. `noesar-evolution:phase4-capability-csrf` · `Up (healthy)` ·
`restarts=0` · `192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-csrf-hardening-20260728T061943Z`. Due container di progetto, che
è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

**`D-0195`+`D-0196`** (commit `802b54b`): `apps/webui-react` rimossa su emendamento
esplicito dell'Owner (`CLAUDE10.md` regola 12, secondo named exception) — 3 file, più un
difetto latente reale trovato e riparato in `tools/generate-inventory.mjs` (la frase
generata nominava la cartella come stringa letterale, si sarebbe autocontraddetta dopo la
rimozione). Registrate anche le risposte dell'Owner su `B-008`, `B-001`, TLS — nessuna
costruita in quella fase.

**`D-0197`** (questa fase, non ancora committata al momento in cui questo file è scritto):
nessun file di prodotto toccato. Solo lettura: `git log -S`, `docker logs` (sola lettura,
nessuna mutazione), lettura di `user-directory.mjs`/`server.mjs`. Aggiornati
`PROJECT_STATE.json` (blocker `B-008` → resolved) e `docs/DECISION_LOG.md`.

## ➜ Verifiche prodotte in sessione

```text
D-0195/D-0196: unit 894/894, ESLint 187 file 0 errori, tools/verify-source.mjs PASS,
  MANIFEST 5785→5782 (5782/5782 verificate, conteggio OK incrociato con le righe),
  secret scan PASS su tutta la storia git, pre-commit hook passato
D-0197: nessuna verifica di codice necessaria — nessun codice cambiato. Evidenza è il log
  del container vivo (data-plane.identity-projected projected:1) e git log -S sul commit
  che ha introdotto la proiezione (8350816, 2026-07-25)
```

Non eseguiti in questa fase (non necessari — nessuna rotta, markup, CSS, DB o Rust toccati):
browser e2e, accessibilità, difetti seminati, http-smoke, DebugLab sweep, build immagine.

## ➜ Cosa NON è vero, e non va scoperto per caso

- Tutto ciò che era falso a fine fase precedente e non toccato da questa sessione resta
  falso: `operationsSupported: ['WRITE']` (DELETE/EXECUTE dichiarati non costruiti),
  `testExecution: false`, `runsPersistAcrossRestart: false`, registri in memoria, firma
  provenance simmetrica, `.ps1` mai eseguiti, `F4-014` (esecutore senza oracolo condiviso),
  `F4-015` (`shadowStatus()` scrive su una GET), `F4-016` (reasoning.mjs pianifica contro
  `/workspace` letterale).
- `B-001` deciso ma **bloccato**: nessuna credenziale fornita, nessun remote configurato.
- TLS deciso ma **non costruito**: l'installazione resta senza certificato.
- **`B-008` è chiuso, ma solo per la proiezione identità.** Le credenziali restano
  interamente fuori da PostgreSQL, per design — questo NON è cambiato e non era la
  richiesta implicita di nessuna decisione presa.

## ➜ Blocker aperti

- **`B-001`** — remote voluto dall'Owner, in attesa delle sue credenziali. `gh` non installabile.
- `B-002`, `B-008`, `B-009`, `B-010` — chiusi.

## ➜ Le domande all'Owner ancora senza risposta

Restano solo:

- **La conformità della conservazione dei dati delle richieste rifiutate** — non è una
  decisione dell'Owner da prendere: il disegno è già autorizzato (`D-0136`), manca una
  verifica di conformità legale/normativa esterna a questo progetto, prima che diventi
  codice in produzione.
- **Nuova, da `D-0197`**: si vuole davvero spostare anche le credenziali dentro
  PostgreSQL, contro la ragione di design documentata (`F4-013`, dump non cifrato)? Solo
  se sì è una fase reale da fare; altrimenti `B-008` resta chiuso così com'è.
