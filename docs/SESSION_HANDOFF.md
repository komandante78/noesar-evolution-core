# SESSION HANDOFF

**Una fase in questa sessione: il deploy di `D-0606`.** Il debito §3a è **chiuso** — l'albero e
l'installazione dicono la stessa cosa, e lo dicono i byte letti dentro l'immagine spedita, non
l'albero. Il deploy stesso ha prodotto un difetto nuovo, trovato e riparato: **`D-0608`**.
Proposto: **`D-0609`**.
**Live installation:** `noesar-evolution:d0606-replay-retention-20260820T132914Z`, `running`/
`healthy`, `RestartCount=0`.

## ➜ LA PROSSIMA AZIONE

**Non c'è più una scelta forzata.** Nessun debito §3a è aperto, quindi la prossima mossa è una
decisione dell'Owner fra tre strade, nessuna delle quali è lavoro già pronto:

1. **`CE-024`** — il tempo di revisione umana per cambiamento accettato. **Il banco di revisione
   non esiste**: chiuderla significa costruirlo, non misurarlo. È la più grossa delle tre.
2. **`CE-035`** — `ssh` + `coden_evolution` da un secondo nodo **reale**. Serve un VPS con il
   prodotto installato **sopra**; mai questo host esposto a internet. La GPU è irrilevante
   (`CE-020` prova che la shell risponde con zero modelli caricati).
3. **Debito minore** — `D-0605` (il `expect` di riferimento non ha una guardia per passo),
   `D-0589` (provenienza HMAC simmetrica, blocca la posizione 5 di `PKG-001`), `MANIFEST.sha256`
   (stale di ~670 file dal `D-0399`, e **nessun passo della batteria lo verifica**).

**Anche aperti:** `D-0564` · `D-0589` · `D-0591` · `D-0593` · `D-0595` · `D-0605` · **`D-0609`**
(nuovo) · `F-TOOLSCOPE-001`. **`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`D-0606` è installato, e la prova non è l'albero.** Immagine costruita **offline** dal
`oci/Dockerfile` canonico (`--pull=false`, exit 0), deployata con
`tools/deploy/redeploy.sh --apply --authorized-by-owner`, che esegue la sequenza §3a 11c per
intero: preflight read-only → byte immagine == albero → stop con grazia **e chiusura pulita letta
nel log** → backup runtime **a servizio fermo** → predecessore preservato → sostituto creato con la
configurazione **riletta dal contenitore che sostituisce** → salute → figli → auth-failure.

**Byte-uguale albero↔immagine 468/468**, differing **0**. E la prova specifica di questo rilascio,
letta **dentro l'immagine spedita** con un contenitore usa-e-getta (`--rm --network none`): **5 file
su 5 identici** all'albero, `referencedDigests()` che nomina `answerRecordDigest` **e**
`answerDigest`, e `session-protocol.mjs` che porta `replay.retention` e `replay.sweep`.

**Parità di configurazione provata, non presunta:** `{{len .Config.Env}}` **44 = 44**, diff dei
nomi vuoto (valori mai stampati), `restart`/`ro rootfs`/`binds`/`tmpfs`/`ports`/`user` identici.
`F-ROT-001` sopravvive **correttamente** — la configurazione è riletta, non reinventata.

**`D-0608` — il difetto che il deploy ha dato, ed è il risultato più interessante della fase.**
Il preflight ha stampato `environment: 44 variables` e il recipe `45 env`, **tre righe di
distanza, per la stessa cosa**. Causa: `wc -l` sull'env-dump conta la newline finale che
`docker inspect --format` aggiunge all'output reso. Il numero sbagliato era il sintomo; il difetto
è che con **zero** variabili il file contiene la sola riga vuota → `ENV_COUNT=1` → `-gt 0` regge →
lo strumento ferma la produzione, la rinomina e avvia un sostituto **con ambiente vuoto,
dichiarando successo**. Latente per fortuna (Docker inietta sempre `PATH`), non per progetto: la
**stessa forma** del difetto che `D-0606` aveva riparato una fase prima.

**Riparato in un punto solo**, perché il conteggio era consultato da **due** siti — la guardia di
completezza e la verifica d'integrità della rotazione — e la prima correzione ne ha fatti divergere
i due (fixture da 3 rossi a **23**, che è come si è scoperto il secondo sito). Ora `env_count()`,
una definizione sola, `awk` e mai `grep -c` (esce 1 su zero, e il trap `ERR` è armato).

**Riparata anche la regola che lo nascondeva** (§40c): il `fake-docker` della fixture **non era
fedele** — nessuna newline finale su `range .Config.Env`, `wc -l` su `len .Config.Env`, e `cp`
invece del parser che scarta le righe vuote. La fixture era verde e non misurava la cosa.

**Verificato:** unit **2902** (2901 pass, 0 fail, 1 skip preesistente) · fixture di deploy
**80/80** (76 preesistenti + 4 nuove) con **oracolo visto rosso 3 su 3** · `SOURCE_VERIFY=PASS`
(`migrations=20`, `baseline=12/12 intact`, `nul-free=1150`) · provenienza **468/468 dopo** la
riparazione · `bash -n` OK sui tre file cambiati · sul vivo `healthy`, `/livez` `/readyz`
`/healthz` **200**, TLS `/livez` **200**, gate `401`/`404`/`200`, **0** auth-failure, **0** errori.

## WHAT WAS **NOT** DONE

- **`CE-024` e `CE-035` non toccate.** Restano le due caselle senza verdetto.
- **`D-0605` e `D-0609` proposti, non eseguiti.**
- **`/sweep` non è mai stato eseguito con `apply:true` su dati reali** — nemmeno ora che la
  superficie è viva sull'installazione. È deliberato: cancella byte che non tornano.
- **Nessuna prova sul vivo che richieda una sessione autenticata**, e nessuna suite mutante
  puntata sull'installazione (§3a 11e).
- **T2 non rieseguita per intero in questa fase.** Girate: unit, `verify-source`, fixture di
  deploy, provenienza. **Non** girate: browser e2e, accessibilità, `scripts/test.sh` completo —
  il codice di prodotto **non è cambiato in questa fase** (il diff è tre file sotto
  `tools/deploy/`, che l'immagine non contiene), e la provenienza 468/468 lo dimostra invece di
  affermarlo. Dichiarato, non implicito (`noesar-evolution-verify` §single-pass 4).
- **HUNT AND FIX: scoped al diff** — la fase ha cambiato tre file di `tools/deploy/`, nessuna
  superficie di prodotto nuova. Strumenti: la fixture, `bash -n`, lettura, e il deploy vero
  (che è ciò che ha effettivamente trovato `D-0608`). **`shellcheck` assente su questo host** e la
  batteria non lint-a affatto la shell — è la ragione di `D-0609`.
- **`MANIFEST.sha256` non rigenerato**: stale di ~670 file dal `D-0399`.
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
- **Debito §3a: CHIUSO.** Non c'è più.
