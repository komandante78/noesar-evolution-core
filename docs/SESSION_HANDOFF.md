# SESSION HANDOFF

**Tre fasi in questa sessione.** `D-0606` **deployato** (debito §3a chiuso), e il deploy ha dato
`D-0608`. Poi `CE-024` **chiusa** — `D-0611` — collegando la metrica che già esisteva invece di
costruirne una seconda. Proposti: `D-0609`, `D-0610`.
**Live installation:** `noesar-evolution:d0606-replay-retention-20260820T132914Z`, `running`/
`healthy`, `RestartCount=0`.
**Matrice: 66/67 con verdetto, 58 `met`, ratchet `2 → 1`.** Resta senza verdetto **solo `CE-035`**.

## ➜ LA PROSSIMA AZIONE

**C'È UN DEBITO §3a APERTO, ed è la prima cosa da decidere.** `D-0611` è in albero, provato, e
**non installato**: sull'immagine viva `productMetric.record()` ha ancora **un solo** chiamante (la
coda di approvazione), quindi la Home riporta una cifra che **non contiene** le decisioni di CodeN
Evolution, e `/review` non esiste in nessuna delle due shell. **Nessun rischio attivo** — non si
perde nulla, si misura di meno — ma il debito è reale.

**Se si deploya, §3a 11c non è opzionale e l'ordine È la salvaguardia** — e stavolta lo strumento
c'è ed è provato: `tools/deploy/redeploy.sh --source noesar-evolution --check` prima, poi
`--apply --authorized-by-owner --image <tag>` dopo aver costruito offline dal `oci/Dockerfile`
canonico. **Nessuna migrazione di schema**: `readySource` è additivo e i campioni che ne sono privi
sono letti come `approval-raised` (provato).

**Poi resta una sola casella senza verdetto.** `CE-035` chiede `ssh` + `coden_evolution` da un
secondo nodo reale: serve un VPS col prodotto installato **sopra**, mai questo host esposto a
internet; la GPU è irrilevante (`CE-020` prova che la shell risponde con zero modelli caricati).

**Altro debito, se si preferisce:** `D-0605` (il `expect` di riferimento non ha una guardia per
passo), `D-0589` (provenienza HMAC simmetrica — blocca la posizione 5 di `PKG-001`),
`MANIFEST.sha256` (stale di ~670 file dal `D-0399`, nessun passo della batteria lo verifica).

**Anche aperti:** `D-0564` · `D-0589` · `D-0591` · `D-0593` · `D-0595` · `D-0605` · `D-0609` ·
`D-0610` · `F-TOOLSCOPE-001`. **`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`D-0606` è installato.** Sequenza §3a 11c per intero. Byte-uguale albero↔immagine **468/468**,
differing **0**; e la prova specifica letta **dentro l'immagine spedita** con un contenitore
usa-e-getta: **5 file su 5 identici**, `referencedDigests()` che nomina `answerRecordDigest` **e**
`answerDigest`, `session-protocol.mjs` con `replay.retention` e `replay.sweep`. Parità di
configurazione provata: `{{len .Config.Env}}` **44 = 44**, diff dei nomi vuoto.

**`D-0608` — il difetto che il deploy ha dato.** Il preflight stampava `44 variables` e il recipe
`45 env`, tre righe di distanza, per la stessa cosa: `wc -l` contava la newline finale che
`docker inspect --format` aggiunge. Il numero era il sintomo — con **zero** variabili la guardia di
completezza sarebbe passata e lo strumento avrebbe avviato un sostituto **senza ambiente,
dichiarando successo** (visto accadere: `exit 0`, predecessore rinominato). Riparato in **un punto
solo** (`env_count()`), perché il conteggio era consultato da **due** siti e correggerne uno li ha
fatti divergere. Riparata anche la regola che lo nascondeva: il `fake-docker` non era fedele.

**`CE-024` è chiusa — `D-0611` — e la scoperta è che il banco esisteva quasi tutto.** `ProductMetric`,
lo store `reviewSamples`, la rotta `/api/v1/metrics/review-time` e il pannello Home erano già lì e
verdi. **Il buco era la giunzione**: `productMetric.record()` aveva **un solo** chiamante, quindi il
lane `plan → measure → approve/reject` non entrava nella metrica del prodotto. Ora `approve()` e
`reject()` campionano con bordo sinistro `measurement.measuredAtUnix`, e `/review` in **entrambe**
le shell restituisce **lo stesso oggetto dalla stessa istanza** che la Home rende.

**Il primo abbozzo è stato buttato, ed è la decisione più importante della fase.** Calcolava una
**seconda** metrica sui run: due numeri dietro la stessa frase, che è `CE-033` e la collisione
`L0-L8` di `02_ATOM.md`. Ne è sopravvissuta solo l'aritmetica, che `ProductMetric` ora usa.

**Due difetti riparati chiudendo.** `readyDefinition` diceva *«shadow execution does not exist in
this build»* — falso dal `D-0567` — **e un test lo fissava**, tenendo in vita il compromesso dopo
che la ragione era sparita. E il `catch{return;}` muto della Home rendeva una rotta caduta
identica a un'installazione che non ha ancora deciso niente.

**Verificato:** unit **2922** (2921 pass, 0 fail, 1 skip preesistente) · ESLint **466 file 0/0/0** ·
`SOURCE_VERIFY=PASS migrations=20 baseline=12/12 intact` · `ACCEPTANCE_MATRIX: PASS` ·
`ce-024-the-run-lane-reaches-the-metric` **8/8** con oracolo **visto rosso 4 su 4** ·
`review-latency` **13/13** · fixture di deploy **80/80** con oracolo **visto rosso 3 su 3** ·
ratchet **visto fallire** a 0 · sul vivo `/livez` `/readyz` `/healthz` **200**, TLS **200**,
gate `401`/`404`/`200`, **0** auth-failure.

## WHAT WAS **NOT** DONE

- **`D-0611` NON è installato** — è il debito §3a aperto e la prossima decisione.
- **`CE-035` non toccata.**
- **Nessun boot del server in questa fase.** Il cablaggio di `server.mjs` (`recordReview`,
  `getProductMetric`) è asserito **sul testo del file spedito**: prova che le righe **esistono**,
  non che girano. È una prova più debole ed è dichiarata tale, non presentata come equivalente.
- **`/sweep` non è mai stato eseguito con `apply:true` su dati reali**, nemmeno ora che la
  superficie è viva. Deliberato: cancella byte che non tornano.
- **`D-0605`, `D-0609`, `D-0610` proposti, non eseguiti.**
- **HUNT AND FIX: full sweep** su `D-0611` (un metodo di sessione nuovo è una superficie nuova),
  **scoped al diff** su `D-0608`. Strumenti: le suite del repository, i difetti seminati,
  `bash -n`, lettura, e il deploy vero — che è ciò che ha effettivamente trovato `D-0608`.
- **`shellcheck` assente su questo host** e la batteria non lint-a affatto la shell — è `D-0609`.
- **`MANIFEST.sha256` non rigenerato**: stale di ~670 file dal `D-0399`.
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
- **Debito §3a**: `D-0611` in albero, non installato.
