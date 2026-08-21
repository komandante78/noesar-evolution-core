# SESSION HANDOFF

**Tre fasi in questa sessione.** `D-0612`: `D-0611` **installato**, debito §3a chiuso.
`D-0615`: `MANIFEST.sha256` non era *stale*, era **falso su 114 file** — rigenerato e messo sotto
due gate; `F-MANIFEST-001` **CHIUSA**. `D-0619`: la provenienza porta ora una firma **Ed25519**
che un auditor indipendente verifica con la sola chiave pubblica.
Riparati chiudendo: `D-0614`, `D-0616`, `D-0618`, `D-0620`. Proposti: `D-0613`, `D-0617`, `D-0621`.
**Live installation:** `noesar-evolution:d0611-run-lane-metric-20260821T032222Z`, `running`/
`healthy`, `RestartCount=0`. **Nessun debito §3a aperto** — misurato, non asserito.
**Matrice: 66/67 con verdetto, 58 `met`.** Resta senza verdetto **solo `CE-035`**.

## ➜ LA PROSSIMA AZIONE

**`D-0621` — estendere la firma pubblica ai cinque archivi.** Lo strato Ed25519 ora esiste, è
provato ed è generico: applicarlo alle cinque posizioni di `MASTER_PROJECT/09_PIANO.md` §4a è
**riuso, non costruzione**. È il passo che porta `PKG-001` da *chiudibile* a *chiuso* — insieme
alla cosa che manca davvero, cioè **produrre gli archivi**, che non è mai stato fatto
(`09_PIANO.md`: *«nessun archivio di consegna è mai stato prodotto»*).

**Attenzione a non confondere due cose, perché `D-0619` sposta il confine:** la posizione 5
(«provenienza») ora **può** chiudersi, ma **non è chiusa**. Si chiude quando un archivio di
consegna esiste ed è firmato. Dirlo diversamente sarebbe un falso PASS.

**Poi:** `D-0617` (firmare `MANIFEST.sha256` — stessa idea, altro artefatto) · `D-0609`
(`shellcheck` assente, la batteria non lint-a affatto la shell) · `D-0605` · `D-0613`.

**Decisione dell'Owner che blocca il rilascio, e non è tecnica:** dove vive la **chiave di rilascio
durevole** (HSM, secret manager, cold storage). Quella usata finora è di sessione e non è mai
committata. Stessa classe di `D-0250`/`D-0266`: non si inventa qui.

**`CE-035` resta l'unica casella senza verdetto e non si chiude da qui.** Chiede `ssh` +
`coden_evolution` da un **secondo nodo reale**: serve un VPS col prodotto installato **sopra**, mai
questo host esposto a internet. **Bloccata su una risorsa che l'Owner non ha ancora fornito.**

**Anche aperti:** `D-0564` · `D-0591` · `D-0593` · `D-0595` · `D-0610` · `F-TOOLSCOPE-001` ·
`F-ROT-001` · `F-UNIT-FLAKE-001`. **`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`D-0611` è installato (`D-0612`).** Byte-uguale albero↔immagine **471/471**. La deriva verso
l'immagine sostituita è **esattamente** `git diff 4977d54..HEAD` sui percorsi copiati: 12 file,
nessuno inatteso. Letto **dentro l'immagine spedita**: `productMetric.record()` ha **tre** call
site dove prima ne aveva **uno**, e `/review` è in **entrambe** le shell.

**`MANIFEST.sha256` diceva il falso (`D-0615`).** Misurato prima: **114 hash sbagliati**, **818**
file tracciati non elencati, **6** voci per file non tracciati. Mantenuto a mano in 109 commit,
**mai diventato rosso perché nessuno lo guardava**. Ora **6.715** voci = `git ls-files` meno sé
stesso, con `--check` in `scripts/test.sh` **e** nel pre-commit.

**La provenienza è verificabile da chi non ha la chiave (`D-0619`).** Prima: HMAC-SHA256, e
`rust/BUILD_STATUS.md` lo ammetteva — *«chi può verificare questa firma può anche falsificarla»*.
La ragione del 2026-07-27 per non fare Ed25519 valeva **per gli strumenti Python**; il repository
nel frattempo ha `signCompliancePack()` (Node `crypto` nativo), che firma già i quattro SBOM.
**Nessuna primitiva scritta a mano.** Le due firme coprono lo **stesso payload** — il documento
meno l'intera busta — quindi nessuna invalida l'altra.

**La prova che conta è il round-trip col codice vero:** documento firmato HMAC dal **Python reale**
in contenitore usa-e-getta, contro-firmato da Node, e **poi entrambe le firme verificano**.

**Gli oracoli sono stati visti rossi, non dedotti.** `D-0615`: 3 volte, incluso **il gate che ha
rifiutato un commit di quella fase stessa**. `D-0619`: 4 volte, e la più importante è che
**togliendo `publicSignature` dalla busta Python l'HMAC si rompe** sul documento contro-firmato —
che è ciò che prova che quella modifica era necessaria e non decorativa.

**Tre difetti riparati chiudendo, tutti della stessa famiglia.** `D-0614`:
`PROJECT_STATE.json.installation` era ferma a **dieci deploy** prima. `D-0616`: la regola *«quali
percorsi il manifest può attestare»* era scritta due volte e un symlink avrebbe **incastrato** il
gate. `D-0618`: il close guard non conosceva `MANIFEST.sha256`, che `D-0615` ha reso obbligatorio
in ogni chiusura — `F-CLOSURE-001` un artefatto più tardi. `D-0620`: portabilità, i due strumenti
nuovi derivavano il proprio percorso in un modo che su Windows non fa mai match (§62).

**Verificato:** unit **2946** (2945 pass, 0 fail, 1 skip preesistente) · ESLint **471 file
0/0/0** · `SOURCE_VERIFY=PASS migrations=20 baseline=12/12 intact nul-free=1155` ·
`MANIFEST=OK 6715 files` · `ACCEPTANCE_MATRIX: PASS` · fixture di deploy **80/80** · fixture dei
hook **71/71** · Python `test-rust-build-provenance.py` **11 OK** in contenitore offline ·
sul vivo `/livez` `/readyz` `/healthz` **200**, TLS **200**, gate `401`/`404`/`200`.

## WHAT WAS **NOT** DONE

- **`PKG-001` NON è chiusa, e la posizione 5 nemmeno.** `D-0619` la rende **chiudibile**: si
  chiude quando un archivio di consegna esiste ed è firmato. **Nessun archivio di consegna è mai
  stato prodotto.** Presentarlo altrimenti sarebbe un falso PASS.
- **La chiave di rilascio durevole non esiste** — quella usata è di sessione, mai committata.
  È una decisione dell'Owner, non inventata qui.
- **`D-0615` e `D-0619` non toccano l'installazione**, e non è un'asserzione: verificato dentro
  l'immagine viva che `/opt/noesar/MANIFEST.sha256` non esiste e che `tools/` ne contiene 8 file.
- **`/review` non è stato interrogato con una sessione autenticata** (§3a 11e). Sul vivo è provato
  che la rotta esiste ed è protetta; il **valore** è provato in albero (8/8 + 13/13).
- **`CE-035` non toccata** — bloccata su un secondo nodo che non esiste.
- **`F-ROT-001` ri-osservata e non riparata**: `NOESAR_ALLOWED_HOSTS` nomina `172.22.0.5` mentre
  l'IP è `172.22.0.3`. Sopravvive **correttamente** (config riletta, non reinventata).
- **T2 non eseguita** (browser e2e, accessibility, seeded-defect): nessun file di prodotto è
  cambiato in `D-0615` né in `D-0619`. Dichiarato, non implicito.
- **HUNT AND FIX: scoped al diff** in tutte e tre le fasi, **nessuna full sweep**. `D-0612`: diff
  di prodotto zero file, strumento il deploy stesso (nulla) + fixture 80/80. `D-0615`: 5 file,
  **ha dato `D-0616`**. `D-0619`: 7 file, **ha dato `D-0620`**.
- **`shellcheck` assente su questo host** e la batteria non lint-a affatto la shell — è `D-0609`.
- **`/sweep` non è mai stato eseguito con `apply:true` su dati reali.**
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
