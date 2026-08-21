# SESSION HANDOFF

**`D-0625`: la pagina dei modelli fa quello che l'Owner aveva chiesto il 2026-08-04 — e per
tredici sessioni non l'ha fatto.** `#/models` era **vuota**: la macchina c'era (corsie, filtri,
paginazione, trasporto), il catalogo no. Ora porta **8 modelli reali in 7 categorie**, ognuno con
descrizione, e l'**elimina a doppia conferma** che non esisteva affatto. **Installato**, non in
albero.
**Prima in questa sessione:** `D-0612` (`D-0611` installato) · `D-0615` (`MANIFEST.sha256` era
falso su 114 file, `F-MANIFEST-001` CHIUSA) · `D-0619` (provenienza Ed25519 verificabile da terzi)
· `D-0622` (la custodia della chiave è dell'operatore).
Riparati chiudendo: `D-0614`, `D-0616`, `D-0618`, `D-0620`, `D-0623`, `D-0626` (quattro).
Proposti/registrati: `D-0613`, `D-0617`, `D-0621`, `D-0624`, **`D-0627`**.
**Live installation:** `noesar-evolution:d0625-model-catalog-20260821T080244Z`, `running`/
`healthy`. **Nessun debito §3a aperto.**

## ➜ LA PROSSIMA AZIONE

**PRIMA DI TUTTO, `D-0627` — la causa radice per cui `#/models` è rimasta vuota tredici
sessioni.** `model-catalog.mjs` cita `MC-002`, `MC-004`, `MC-005` e `MC-006` come criteri, e
nella matrice **non esiste nemmeno una riga `MC-`** (misurato: 0 su 67). Niente misurava quella
pagina, quindi niente è mai diventato rosso. `tools/acceptance-matrix.mjs` legge solo i documenti
`MASTER_PROJECT/`, e `docs/MODEL_CATALOG_DESIGN.md` non è fra quelli: o la tabella MC entra in un
documento già sorgente, o `SOURCES` impara a leggere quel file. **È una decisione sul metro.**
**Non riparata in `D-0625` perché quella fase è finita a ~270% del budget dichiarato**, e
cambiare l'elenco delle fonti della matrice a budget sfondato è come si introducono gli errori.

**POI: la passata live dell'Owner, che resta PRIMA di `D-0621`.** L'Owner ha deciso
il 2026-08-21 di camminare il prodotto vivo superficie per superficie e registrare cosa non
funziona e cosa non gli piace, **prima** di qualunque altro lavoro. La scheda è
**`docs/OWNER_REVIEW_2026-08-21.md`** — porta l'elenco completo misurato: **29 comandi** del menu
unico (da provare in **entrambe** le shell) e **13 pannelli** WebUI, più i numeri di partenza per
i benchmark. **Non aprire una fase nuova finché quella scheda non è riempita.**

**L'ordine deciso dall'Owner, e concordato:** passata live → triage di ogni riga contro il codice
reale (§40b: un falso positivo "riparato" è una regressione per niente) → lista dei cambiamenti
ordinata per ciò che sblocca cosa → **un solo aggiornamento**, costruito a fette con `T0`/`T1`
continui e un deploy solo → debug + vulnerabilità + **`T2` intero** sull'installazione nuova →
benchmark mirati contro i numeri di partenza. **Costo dichiarato**: finché non si deploya
l'installazione resta indietro rispetto all'albero — debito §3a **aperto e scritto**.

**Quando la passata è finita, il lavoro riprende da qui:**

**`D-0621` — estendere la firma pubblica ai cinque archivi.** Lo strato Ed25519 ora esiste, è
provato ed è generico: applicarlo alle cinque posizioni di `MASTER_PROJECT/09_PIANO.md` §4a è
**riuso, non costruzione**. È il passo che porta `PKG-001` da *chiudibile* a *chiuso* — insieme
alla cosa che manca davvero, cioè **produrre gli archivi**, che non è mai stato fatto
(`09_PIANO.md`: *«nessun archivio di consegna è mai stato prodotto»*).

**Attenzione a non confondere due cose, perché `D-0619` sposta il confine:** la posizione 5
(«provenienza») ora **può** chiudersi, ma **non è chiusa**. Si chiude quando un archivio di
consegna esiste ed è firmato. Dirlo diversamente sarebbe un falso PASS.

**Poi:** `D-0624` (portare i backend di custodia agli **altri** firmatari — oggi solo la
provenienza è agnostica, gli SBOM pretendono ancora il PEM su disco) · `D-0617` (firmare
`MANIFEST.sha256`) · `D-0609` (`shellcheck` assente) · `D-0605` · `D-0613`.

**La custodia della chiave NON è più un blocco (`D-0622`).** Era registrata qui come «decisione
dell'Owner che blocca il rilascio»; l'Owner ha risposto di attenersi ai criteri dei finanziatori,
e rileggendoli **nessun programma prescrive la custodia**. Il progetto quindi non la sceglie:
firma attraverso un backend, e il percorso **staccato** non fa mai entrare la chiave privata nel
processo — cold storage, smartcard e qualunque HSM sono lo stesso flusso da qui.
`docs/RELEASE_SIGNING_POLICY.md`. **Cosa resta all'Owner**: generare la chiave durevole e
scegliere dove tenerla — ora una decisione di **deployment senza conseguenze sul codice**.
Raccomandazione: **cold storage + percorso staccato**, che non costa nulla e non richiede
fornitori.

**`CE-035` resta l'unica casella senza verdetto e non si chiude da qui.** Chiede `ssh` +
`coden_evolution` da un **secondo nodo reale**: serve un VPS col prodotto installato **sopra**, mai
questo host esposto a internet. **Bloccata su una risorsa che l'Owner non ha ancora fornito.**

**Anche aperti:** `D-0564` · `D-0591` · `D-0593` · `D-0595` · `D-0610` · `F-TOOLSCOPE-001` ·
`F-ROT-001` · `F-UNIT-FLAKE-001`. **`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`D-0611` è installato (`D-0612`).** Byte-uguale albero↔immagine **471/471**, deriva esattamente
uguale al diff di git. Dettaglio: `docs/INSTALLATION_LEDGER.md`.

**`MANIFEST.sha256` diceva il falso (`D-0615`).** Misurato prima: **114 hash sbagliati**, **818**
file tracciati non elencati, **6** voci per file non tracciati. Mantenuto a mano in 109 commit,
**mai diventato rosso perché nessuno lo guardava**. Ora è `git ls-files` meno sé stesso — **6.717**
voci a fine sessione — con `--check` in `scripts/test.sh` **e** nel pre-commit.

**`D-0619`** — provenienza Ed25519, round-trip col Python reale, entrambe le firme verificano.
Dettaglio: `docs/DECISION_LOG.md`, `rust/BUILD_STATUS.md`.

**Gli oracoli sono stati visti rossi, non dedotti.** `D-0615`: 3 volte, incluso **il gate che ha
rifiutato un commit di quella fase stessa**. `D-0619`: 4 volte, e la più importante è che
**togliendo `publicSignature` dalla busta Python l'HMAC si rompe** sul documento contro-firmato —
che è ciò che prova che quella modifica era necessaria e non decorativa.

**E il difetto era l'opposto di quello atteso.** `signCompliancePack(pack, privateKeyPem)` pretende
la chiave privata **in memoria di processo** — ciò che un HSM e una chiave offline esistono per
evitare: il progetto **aveva già scelto** la custodia («un file su disco») e chiuso fuori tutte le
altre. Ora `tools/release-signing.mjs` porta **due backend veri**, `local-key` e `detached`, e il
verificatore **non può distinguerli**. Provato end-to-end senza chiave privata nel processo.
Ragionamento e fonti: `docs/RELEASE_SIGNING_POLICY.md`.

**Quattro difetti riparati chiudendo, tutti della stessa famiglia.** `D-0614`:
`PROJECT_STATE.json.installation` era ferma a **dieci deploy** prima. `D-0616`: la regola *«quali
percorsi il manifest può attestare»* era scritta due volte e un symlink avrebbe **incastrato** il
gate. `D-0618`: il close guard non conosceva `MANIFEST.sha256`, che `D-0615` ha reso obbligatorio
in ogni chiusura — `F-CLOSURE-001` un artefatto più tardi. `D-0620`: portabilità, i due strumenti
nuovi derivavano il proprio percorso in un modo che su Windows non fa mai match (§62).
`D-0623`: due percorsi di firma assemblavano la busta ciascuno per conto suo e differivano di un
campo — **terza volta in questa sessione** per lo stesso difetto, dopo `D-0608` e `D-0616`.

**Verificato:** unit **2955** (2954 pass, 0 fail, 1 skip preesistente) · ESLint **472 file**
**0/0/0** · `SOURCE_VERIFY=PASS migrations=20 baseline=12/12 intact nul-free=1160` ·
`MANIFEST=OK 6717 files` · `ACCEPTANCE_MATRIX: PASS` · fixture di deploy **80/80** · fixture
dei hook **71/71** · Python `test-rust-build-provenance.py` **11 OK** in contenitore offline ·
sul vivo `/livez` `/readyz` `/healthz` **200**, TLS **200**, gate `401`/`404`/`200`.

## WHAT WAS **NOT** DONE

- **`PKG-001` NON è chiusa, e la posizione 5 nemmeno.** `D-0619` la rende **chiudibile**: si
  chiude quando un archivio di consegna esiste ed è firmato. **Nessun archivio di consegna è mai
  stato prodotto.** Presentarlo altrimenti sarebbe un falso PASS.
- **La chiave di rilascio durevole non esiste ancora** — quelle usate per le prove sono di
  sessione e stanno **fuori dall’albero**, mai committate. Generarla è un atto dell’Owner.
  `D-0622` fa sì che la sua **custodia** non abbia più conseguenze sul codice, non che la
  chiave esista.
- **Solo la provenienza è agnostica rispetto alla custodia.** `sign-release-artifact.mjs` e la
  firma dei quattro SBOM pretendono ancora il PEM su disco: è `D-0624`, proposto e non
  eseguito. Metà prodotto agnostico non è una proprietà che si possa dichiarare.
- **`D-0615` e `D-0619` non toccano l'installazione**, e non è un'asserzione: verificato dentro
  l'immagine viva che `/opt/noesar/MANIFEST.sha256` non esiste e che `tools/` ne contiene 8 file.
- **`/review` non è stato interrogato con una sessione autenticata** (§3a 11e). Sul vivo è provato
  che la rotta esiste ed è protetta; il **valore** è provato in albero (8/8 + 13/13).
- **`CE-035` non toccata** — bloccata su un secondo nodo che non esiste.
- **`F-ROT-001` ri-osservata e non riparata**: `NOESAR_ALLOWED_HOSTS` nomina `172.22.0.5` mentre
  l'IP è `172.22.0.3`. Sopravvive **correttamente** (config riletta, non reinventata).
- **T2 non eseguita** (browser e2e, accessibility, seeded-defect): nessun file di prodotto è
  cambiato in `D-0615`, `D-0619` né `D-0622` — tutto vive in `tools/`, `docs/` e nei test, e
  `tools/` non entra nell’immagine. Dichiarato, non implicito.
- **HUNT AND FIX: scoped al diff** in tutte e quattro le fasi, **nessuna full sweep**. `D-0612`:
  diff di prodotto zero file, strumento il deploy stesso (nulla) + fixture 80/80. `D-0615`: 5
  file, **ha dato `D-0616`**. `D-0619`: 7 file, **ha dato `D-0620`**. `D-0622`: 4 file, **ha dato
  `D-0623`**. Ogni fase di questa sessione ha trovato un difetto nel proprio codice nuovo.
- **`shellcheck` assente su questo host** e la batteria non lint-a affatto la shell — è `D-0609`.
- **`/sweep` non è mai stato eseguito con `apply:true` su dati reali.**
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
