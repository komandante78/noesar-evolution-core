# SESSION HANDOFF

**Due fasi in questa sessione.** `D-0612`: `D-0611` **installato**, debito §3a chiuso.
`D-0615`: `MANIFEST.sha256` non era *stale*, era **falso su 114 file** — rigenerato e messo
sotto due gate. `F-MANIFEST-001` **CHIUSA**. Riparato anche un difetto latente nel codice nuovo
prima che spedisse (`D-0616`). Proposti: `D-0613`, `D-0617`.
**Live installation:** `noesar-evolution:d0611-run-lane-metric-20260821T032222Z`, `running`/
`healthy`, `RestartCount=0`. **Nessun debito §3a aperto** — misurato, non asserito.
**Matrice: 66/67 con verdetto, 58 `met`.** Resta senza verdetto **solo `CE-035`**.

## ➜ LA PROSSIMA AZIONE

**`D-0589` — provenienza HMAC simmetrica.** È il prossimo per una ragione sola: **blocca la
posizione 5 di `PKG-001`**, quindi sta sul percorso delle cinque consegne, che è il percorso
verso la fine. Nulla d'altro fra i debiti aperti tocca quel percorso.

**Poi, in ordine di valore:** `D-0617` (firmare il manifest — `D-0615` lo rende vero dentro il
repository, ma chi altera un file **e rigenera** passa ancora ogni gate: manca `firma → manifest`,
e lo strumento Ed25519 esiste già) · `D-0609` (`shellcheck` assente e la batteria non lint-a
affatto la shell) · `D-0605` · `D-0613`.

**`CE-035` resta l'unica casella senza verdetto e non si chiude da qui.** Chiede `ssh` +
`coden_evolution` da un **secondo nodo reale**: serve un VPS col prodotto installato **sopra**,
mai questo host esposto a internet. La GPU è irrilevante (`CE-020`). **È bloccata su una risorsa
che l'Owner non ha ancora fornito** — non su lavoro mancante.

**Anche aperti:** `D-0564` · `D-0591` · `D-0593` · `D-0595` · `D-0610` · `F-TOOLSCOPE-001` ·
`F-ROT-001` · `F-UNIT-FLAKE-001`. **`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`D-0611` è installato (`D-0612`).** Sequenza §3a 11c per intero. Byte-uguale albero↔immagine
**471/471**, differing **0**. La deriva fra l'immagine nuova e quella sostituita è **esattamente**
`git diff 4977d54..HEAD` sui percorsi che il Dockerfile copia: 12 file, **nessuno inatteso**.
Letto **dentro l'immagine spedita**: `productMetric.record()` ha **tre** call site dove prima ne
aveva **uno**, e `/review` è in **entrambe** le shell sullo stesso metodo `review.latency`.

**`MANIFEST.sha256` diceva il falso, e adesso non può tornare a dirlo in silenzio (`D-0615`).**
Misurato prima: **114 hash sbagliati**, **818 file tracciati non elencati**, **6 voci** per file
che git non traccia. Non era staleness — era un'attestazione di integrità falsa, mantenuta a mano
due righe per volta in 109 commit, **mai diventata rossa perché nessuno la guardava**. Ora:
**6.712** voci = `git ls-files` meno sé stesso, generate da `tools/generate-manifest.mjs`, con
`--check` in `scripts/test.sh` **e** in `.githooks/pre-commit`, e 13 righe di oracolo.
**Deciso quale istanza è** — quella che il progetto *produce*, non quella *ricevuta* nel pacchetto
01 del V4 — e scritto in `docs/SOURCE_PROVENANCE.md` §3.2, dove la collisione poteva rinascere.

**L'oracolo è stato visto rosso prima, tre volte.** `--check` exit **1** sui numeri veri;
il test del symlink rosso rimettendo la regola duplicata (`D-0616`); e **il gate ha fallito sulle
modifiche di questa fase stessa** (3 hash + 1 file non elencato) prima che le rigenerassi — che è
la prova che funziona nel flusso reale e non solo in fixture.

**Un difetto latente riparato prima di spedire (`D-0616`).** La regola *«quali percorsi il
manifest può attestare»* era scritta **due volte**: un symlink tracciato avrebbe incastrato il
gate in un fallimento che **rigenerare non ripara**. Ora è una sola definizione, `isAttestable()`.
È la classe esatta di `D-0608` (`env_count()`).

**Un difetto di stato riparato chiudendo `D-0612` (`D-0614`).**
`PROJECT_STATE.json.installation` era ferma a `d0516-model-chooser` del **17 agosto**: **dieci**
deploy l'avevano lasciata indietro, e `rollback_containers` elencava quattro contenitori del 25
luglio che §21b vieta. Il ledger era giusto ogni volta; la chiave no — ed è la chiave che il
**digest stampa**. Riparata la chiave **e la regola**.

**Verificato:** unit **2935** (2934 pass, 0 fail, 1 skip preesistente) · ESLint **468 file
0/0/0** · `SOURCE_VERIFY=PASS migrations=20 baseline=12/12 intact nul-free=1155` ·
`ACCEPTANCE_MATRIX: PASS` · fixture di deploy **80/80** · manifest **13/13** con oracolo visto
rosso · sul vivo `/livez` `/readyz` `/healthz` **200**, TLS **200**, gate `401`/`404`/`200`,
**0** auth-failure, **0** righe di errore · env **44 = 44** con diff dei nomi vuoto.

## WHAT WAS **NOT** DONE

- **`D-0615` non tocca l'installazione, e non è un'asserzione: è misurato.** Verificato dentro
  l'immagine viva che `/opt/noesar/MANIFEST.sha256` **non esiste** e che `tools/` ne contiene 8
  file, non `generate-manifest.mjs`. **Nessun debito §3a aperto da questa fase.**
- **`/review` non è stato interrogato con una sessione autenticata.** Sul vivo è provato che la
  rotta esiste ed è protetta (`401`, discriminata da `404`); che restituisca il **numero giusto**
  è provato in albero (8/8 + 13/13), non sull'installazione (§3a 11e).
- **`CE-035` non toccata** — bloccata su un secondo nodo che non esiste.
- **`F-ROT-001` ri-osservata e non riparata**: `NOESAR_ALLOWED_HOSTS` nomina `172.22.0.5` mentre
  l'IP è `172.22.0.3`. Sopravvive **correttamente** (la config è riletta, non reinventata), ma
  resta sbagliata. Fuori scope per una fase di deploy e per una di manifest.
- **Il manifest non è firmato** — è `D-0617`, proposto e non eseguito. Chi altera un file **e
  rigenera** passa ogni gate: la catena si ferma a `manifest → file`, le manca `firma → manifest`.
- **T2 non eseguita** (browser e2e, accessibility, seeded-defect): nessun file di prodotto è
  cambiato in `D-0615` — i due file nuovi sono uno strumento e un test, e nessuno dei due entra
  nell'immagine. Dichiarato, non implicito.
- **HUNT AND FIX: scoped al diff** in entrambe le fasi. `D-0612`: diff di prodotto **zero file**,
  lo strumento del caccia è stato il deploy stesso (non ha dato nulla) più il fixture 80/80.
  `D-0615`: 5 file, e il caccia **ha dato `D-0616`**. Strumenti: le suite del repository,
  l'oracolo seminato a mano, `bash -n`, `git ls-files -s` per i percorsi non regolari, lettura.
  **Nessuna full sweep** in nessuna delle due.
- **`shellcheck` assente su questo host** e la batteria non lint-a affatto la shell — è `D-0609`.
- **`/sweep` non è mai stato eseguito con `apply:true` su dati reali.**
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
