# SESSION HANDOFF

**`D-0611` è installato — `D-0612`.** Il debito §3a aperto il 2026-08-20 è **chiuso**: la Home
dell'installazione viva ora conta anche le decisioni di CodeN Evolution, e `/review` esiste in
**entrambe** le shell. Proposto e non eseguito: `D-0613`.
**Live installation:** `noesar-evolution:d0611-run-lane-metric-20260821T032222Z`, `running`/
`healthy`, `RestartCount=0`. **Nessun debito §3a aperto.**
**Matrice: 66/67 con verdetto, 58 `met`.** Resta senza verdetto **solo `CE-035`**.

## ➜ LA PROSSIMA AZIONE

**Non c'è più un debito §3a da decidere.** Albero e installazione coincidono, provato
byte per byte (471/471, differing 0).

**Resta una sola casella della matrice senza verdetto, e non si chiude da qui.** `CE-035`
chiede `ssh` + `coden_evolution` da un **secondo nodo reale**: serve un VPS col prodotto
installato **sopra**, mai questo host esposto a internet. La GPU è irrilevante (`CE-020` prova
che la shell risponde con zero modelli caricati). **È bloccata su una risorsa che l'Owner non ha
ancora fornito** — non su lavoro mancante.

**Quindi la prossima fase è debito, e in quest'ordine:**

1. **`MANIFEST.sha256`** — stale di ~670 file dal `D-0399` (5.898 percorsi elencati contro 6.685
   tracciati), e **nessun passo della batteria lo verifica**: è l'unico debito dove *nessuna riga
   di matrice misura il criterio*, esattamente la classe di errore che questo progetto ha già
   pagato. `F-MANIFEST-001`.
2. **`D-0589`** — provenienza HMAC simmetrica: **blocca la posizione 5 di `PKG-001`**, quindi sta
   sul percorso delle cinque consegne.
3. **`D-0605`** (l'`expect` di riferimento non ha una guardia per passo) · **`D-0609`**
   (`shellcheck` assente e la batteria non lint-a affatto la shell) · **`D-0613`** (il
   verificatore di provenienza è rosso su ogni deploy riuscito).

**Anche aperti:** `D-0564` · `D-0591` · `D-0593` · `D-0595` · `D-0610` · `F-TOOLSCOPE-001` ·
`F-ROT-001` · `F-UNIT-FLAKE-001`. **`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Il lane dei run raggiunge la metrica sul prodotto che gira, non solo in albero.** Letto
**dentro l'immagine spedita** con un contenitore usa-e-getta (`--rm --network none`):
`productMetric.record()` ha **tre** call site (`server.mjs:356`, `server.mjs:4472`,
`workspace-actions.mjs:773`) dove l'immagine precedente ne aveva **uno**; `readyAtUnix` legge
`run.measurement.measuredAtUnix` (riga 767) con `readySource: 'shadow-measured'` (782);
`/review` è in **entrambe** le shell sullo stesso metodo `review.latency`
(`agent-commands.js:154`, `coden-view-model.js:73`); `review-latency.mjs` **117 righe**.

**La deriva fra l'immagine nuova e quella che sostituisce è esattamente il diff di git.** 12
file, confrontati uno per uno con `git diff --name-only 4977d54..HEAD` ristretto ai percorsi che
il Dockerfile copia: **nessun file inatteso**, in nessuna delle due direzioni. `tools/deploy/`
non è nell'immagine, quindi la riparazione `D-0608` non ci compare — coerente.

**Un difetto trovato chiudendo, e riparato — `D-0614`.** `PROJECT_STATE.json.installation` era
ferma a `d0516-model-chooser` del **2026-08-17**: **dieci** deploy successivi l'avevano lasciata
indietro, e `rollback_containers` elencava quattro contenitori del 25 luglio che §21b vieta e che
non esistono più. Il ledger era corretto ogni volta; la chiave no — e la chiave è **ciò che il
digest stampa**, quindi una sessione fredda avrebbe creduto di girare su un'immagine di quattro
giorni prima. Riparata la chiave **e la regola**: il passo `DOCUMENT` di una fase che installa
aggiorna questa chiave, non solo il ledger. Nessuna chiave di primo livello aggiunta: 128 = 128.

**Il deploy è passato pulito al primo colpo.** A differenza di `D-0606`, che diede `D-0608`:
preflight PASS, `clean exit confirmed`, backup del workspace **a servizio fermo**, predecessore
conservato, sostituto `healthy` con 4 figli, exit 0.

**Verificato:** unit **2922** (2921 pass, 0 fail, 1 skip preesistente) ·
`SOURCE_VERIFY=PASS migrations=20 baseline=12/12 intact nul-free=1153` ·
`ACCEPTANCE_MATRIX: PASS` (67 criteri, 66 con verdetto, 58 `met`, 0 critici senza verdetto) ·
fixture di deploy **80/80** · byte-uguale albero↔immagine **471/471** differing **0** ·
sul vivo `/livez` `/readyz` `/healthz` **200**, TLS **200**, gate `401`/`404`/`200`,
**0** auth-failure, **0** righe di errore · env **44 = 44** con diff dei nomi vuoto.

## WHAT WAS **NOT** DONE

- **`/review` non è stato interrogato con una sessione autenticata.** Sul vivo è provato che la
  rotta **esiste ed è protetta** (`401`, discriminata da un `404` su rotta inesistente); che
  **restituisca il numero giusto** è provato in albero (8/8 + 13/13), non sull'installazione.
  È una prova più debole ed è dichiarata tale, non presentata come equivalente (§3a 11e).
- **`CE-035` non toccata** — bloccata su un secondo nodo che non esiste.
- **`F-ROT-001` ri-osservata e non riparata**: `NOESAR_ALLOWED_HOSTS` nomina `172.22.0.5` mentre
  l'IP del contenitore è `172.22.0.3`. **Sopravvive correttamente** — la configurazione è riletta
  dal contenitore che si sostituisce, non reinventata — ma resta sbagliata. Fuori dallo scope di
  una fase di deploy: cambiarla è un cambio di configurazione, non un'installazione.
- **`/sweep` non è mai stato eseguito con `apply:true` su dati reali.** Deliberato: cancella byte
  che non tornano.
- **`MANIFEST.sha256` non rigenerato**: stale di ~670 file dal `D-0399`.
- **HUNT AND FIX: scoped al diff.** Il diff di prodotto di questa fase è **zero file** — si è
  installato un albero già provato. Lo strumento del caccia è stato il deploy stesso, che è ciò
  che trovò `D-0608` la volta scorsa; questa volta non ha dato nulla. Aggiunti: fixture di
  deploy 80/80 e il confronto immagine↔immagine↔git. **Nessuna full sweep** — nessuna superficie
  nuova, nessun file di prodotto cambiato.
- **`shellcheck` assente su questo host** e la batteria non lint-a affatto la shell — è `D-0609`.
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.
- **T2 non rieseguita** (browser e2e, accessibility, seeded-defect): il codice di prodotto non è
  cambiato dalla fase che le ha eseguite verdi, e la prova che i byte installati sono quelli è
  stata prodotta qui. Dichiarato, non implicito.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
