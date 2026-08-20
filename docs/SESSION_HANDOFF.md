# SESSION HANDOFF

**Phase:** `D-0594` — `CE-031` registrata **⚠️ PARZIALE**: da *senza verdetto* a *accesso reale
eseguito*, da una seconda macchina e da un account non privilegiato sull'host. Ratchet **9 → 8**,
critical **0**. `D-0595` proposto.
**Live installation:** invariata — **`noesar-evolution:d0590-keyboard-coverage-20260820T050637Z`**,
`running`/`healthy`, `/livez` e `/readyz` **200** riprovati dopo la pulizia. **Nessun deploy in
questa fase, e non ne serviva uno:** non è stata toccata una riga di codice del prodotto.
Rollback conservato: `noesar-evolution-pre-20260820T050745Z` (uno solo, come vuole §5a).

## ➜ LA PROSSIMA AZIONE

**1 · `CE-006`, e va prima delle altre tre.** Costruisce il banco di **replay** che `CE-027`
riusa: farlo dopo significherebbe costruirlo due volte. `CE-027`/`CE-028`/`CE-030` sono **un solo
soggetto** — l'Autore, fase 5 del piano `17` — e vanno prese come **una** fase, dopo `CE-006`.

**2 · `CE-035` è dell'Owner, non del prodotto.** Chiede `ssh` + `coden_evolution` da una **seconda
macchina della rete**. Ciò che `D-0594` ha chiuso è la metà *raggiungibile senza privilegi*; ciò
che resta è **una macchina che non è questa**, con `sshd` reale. Serve il VPS senza GPU con il
prodotto installato SOPRA — mai questo host esposto a internet — dove il test è letteralmente
`ssh` + una parola, quindi nessuna porta pubblica oltre a `sshd`. **La GPU è irrilevante:**
nessuna riga nomina un modello, e `CE-020` prova che la shell risponde con zero modelli caricati.
Il VPS si distrugge a fine prova; setup token e chiavi non entrano in nessun file tracciato (§7).

**3 · Le otto righe senza verdetto:** `CE-005` `CE-006` `CE-023` `CE-024` `CE-027` `CE-028`
`CE-030` `CE-035`.

**Anche aperti:** `D-0564` · `D-0589` (provenienza HMAC **simmetrica**, non verificabile da un
auditor indipendente: blocca la posizione 5 di `PKG-001`) · `D-0591` · `D-0593` · `D-0595` ·
`F-TOOLSCOPE-001`.

**`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`CE-031` (Sev A) aveva un verdetto vuoto nella matrice e un ✅ nel ledger, e i due non
raccontavano la stessa cosa.** Il ✅ del 2026-08-07 (`D-0341`) fu ottenuto creando un account di
sistema, tre regole `sudoers` e un blocco `sshd` **su questo host**: una modifica che la legge di
piattaforma vieta al prodotto, che nessun test può rieseguire, e che il `/etc` in RAM di
quell'host ha cancellato al riavvio successivo. Provava inoltre di raggiungere un **prompt di
autenticazione**, che non è raggiungere una sessione.

**Ora è una prova che chiunque cloni il repository riesegue**, su qualunque host con un motore di
contenitori, senza modificare nulla fuori da sé — `tools/acceptance/ce-031-second-machine.sh`,
step tristate di `scripts/test.sh`:

- **altra macchina, 10/10** — namespace di rete suo, uid **65534**, radice in sola lettura, tutte
  le capability tolte, **nessun socket di motore**, **nessun percorso di questo host**. Non è
  *supposto* isolato: la sonda **misura** di non essere uid 0 e che non c'è né socket né motore
  che risponda, perché una sonda che desse per buono il proprio isolamento asserirebbe la cosa
  sotto esame. Poi, sopra il **solo TCP**: `/livez` 200 · bridge non autenticato **401** ·
  **registrazione dell'Owner con il secondo fattore** · `status` → `noesar-tui/1` ·
  `capability.grants`, che richiede `workspace.read`, → **200** — stesso dispatch e stesse istanze
  vive del socket unix, quindi il permesso viaggia con il trasporto · `/coden-terminal.html`
  servito, monta l'emulatore e carica il suo modulo.
- **sull'host, 3/3** — privilegi **abbassati** a uid 65534 (`setpriv`; nessun account creato,
  nulla scritto): la parola sola esce **3** *dichiarando* che il motore non le risponde — la
  clausola «senza privilegi sul motore di contenitori», eseguita — e nomina il browser invece di
  lasciare un vicolo cieco; poi lo **stesso** account raggiunge `/livez` **200** sul lasciapassare
  di loopback.

**L'installazione usa-e-getta è pubblicata solo su loopback, su porta scelta dal kernel.**
L'asimmetria è il punto: l'host può dialogarci, la seconda macchina no — dentro il suo namespace
`127.0.0.1` è sé stessa — quindi resta obbligata al nome del contenitore sul bridge, che è la cosa
sotto esame. Workspace **interamente su tmpfs**, cluster PostgreSQL compreso: pronta in **1 s**,
20 migrazioni, `production_ready:true`, e rimuovere il contenitore è tutta la pulizia.

**Oracolo visto rosso in due direzioni, non una.** Montando il socket Docker `CE031-1` fallisce
nominandolo; puntata dove non ascolta nulla la sonda riporta **7 FAIL misurati**.

**Un difetto nel mio stesso oracolo, trovato eseguendolo.** La prima versione, contro un indirizzo
morto, **moriva con uno stack trace di undici**: il chiamante vedeva comunque un'uscita non-zero,
quindi *sembrava* funzionare, ma aveva sostituito nove pezzi di evidenza con un backtrace.
Riparato: un guasto di trasporto è una **misura** («non ha risposto»), e si registra come tale.

**E due difetti `set -eu` nello stesso file, che è la terza volta in questo angolo.** Una
sostituzione di comando eredita `set -e`, quindi l'uscita 3 *attesa* dell'avviatore ha ucciso il
sottoshell prima del `printf` che doveva registrarla, e con esso l'intero script. Riparata con
`if`, la seconda versione registrava `exit=0` per un processo appena uscito 3: dopo `if !` il `$?`
del corpo è lo stato del `!`, **0 per costruzione**. È `D-0390` e `D-0592` una terza volta — da cui
`D-0595`, proposto: una libreria sola invece dell'idioma ricopiato a mano.

**Verificato:** `scripts/test.sh` **18/18** (era 17, il diciottesimo è il nuovo passo) · unit
**2864/2865** (1 skip preesistente) · ESLint **456 file 0/0/0** · matrice **59 verdetti su 67**,
senza verdetto **8**, ratchet visto **FALLIRE a 7** · `shellcheck` da contenitore usa-e-getta →
solo `SC1007` sull'idioma corretto `CDPATH= cd`, **dismesso con motivo**.

## WHAT WAS **NOT** DONE

- **`CE-031` NON è un ✅ pieno, ed è registrata ⚠️.** «Un'altra macchina» qui è un altro
  **namespace di rete** con un uid non privilegiato — **non** un altro sistema operativo, un altro
  kernel, un `sshd` reale, né un computer che non è questo. Quelli sono `CE-035`.
- **`CE-035` non è stata toccata** e non poteva esserlo qui: richiede una seconda macchina vera.
- **Nessun deploy**, e nessuno serviva: zero righe di codice del prodotto cambiate. L'installazione
  viva resta pari all'albero dal `D-0590`.
- **`MANIFEST.sha256` non rigenerato**, e dichiarato: è stale di ~670 file dal `D-0399`, nessun
  passo della batteria lo verifica, ripararlo è un'altra fase.
- **Browser e2e e audit di accessibilità non rieseguiti**: nessun markup, nessun DOM, nessun token
  CSS, nessuna riga di prodotto. Erano verdi in `D-0590` sullo stesso albero di prodotto.
- **`D-0595` proposto, non eseguito.**
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`
  (rimisurato). Nessun reperto nei file di questa fase. L'unica occorrenza di `password` è un
  valore **generato a runtime** per un'installazione usa-e-getta distrutta a fine script.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato di nuovo — né `gitleaks` né `trufflehog` sono su
  `PATH`. Va richiuso o riscritto.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
