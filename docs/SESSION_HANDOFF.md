# SESSION HANDOFF

**`CE-023` è misurata e chiusa** (`D-0604`) — con verdetto `DIFFERS`, non `NO_DIFFERENCE`.
Matrice **65 verdetti su 67**, ratchet **3 → 2** (visto FALLIRE a 1), critical **0**.
Proposto: `D-0605`. **L'installazione non è stata cambiata** e non c'è debito §3a aperto.
**Live installation:** `noesar-evolution:d0601-context-shape-20260820T104316Z`, `running`/
`healthy`, `RestartCount=0`, `/livez` e `/readyz` **200**.

## ➜ LA PROSSIMA AZIONE

**Restano due caselle senza verdetto, e nessuna delle due è lavoro pronto su questa macchina.**
La scelta è dell'Owner; sotto c'è ciò che serve per non ricostruirla.

**`CE-024` — è costruzione, non misura.** Chiede il tempo di revisione umana per cambiamento
accettato, «strumentazione del banco di revisione». Misurato: **un banco di revisione umana non
esiste**. Chiuderla significa costruirlo — decisione di prodotto, non una misura da eseguire.

**`CE-035` — serve una macchina che non è questa.** `ssh` + `coden_evolution` da un secondo nodo
reale: un VPS con il prodotto installato SOPRA, mai questo host esposto a internet. **La GPU è
irrilevante** — nessuna riga nomina un modello, e `CE-020` prova che la shell risponde con zero
modelli caricati. Il VPS si distrugge a fine prova; setup token e chiavi non entrano in nessun
file tracciato.

**Terza via, se l'Owner preferisce chiudere debito invece di aprire caselle:** `D-0605` (la
guardia per passo in `expect`), `D-0589` (provenienza HMAC **simmetrica** — blocca la posizione 5
di `PKG-001`), `D-0598` (la ritenzione dello store di replay: `sweep()` esiste, è provato, e
**non è chiamato da nulla**), o `MANIFEST.sha256`, stale di ~670 file dal `D-0399` e verificato
da nessun passo della batteria.

**Anche aperti:** `D-0564` · `D-0589` · `D-0591` · `D-0593` · `D-0595` · `D-0598` · `D-0605` ·
`F-TOOLSCOPE-001`.

**`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**La misura di `CE-023` è stata presa, e dice una cosa diversa da quella che ci si aspettava.**

- **Come.** Sonda usa-e-getta costruita dall'**immagine viva**, `--rm --network none`, tree in
  sola lettura, `atomd` avviato **dentro la sonda** con un token generato lì. La produzione non è
  stata toccata: `docker exec` **non usato** (§5 r16), token dell'installazione **mai letto**.
  Era la decisione che `D-0603` chiedeva di confermare prima di partire.
- **Il risultato.** `PER_TASK better=0 worse=1 equal=8 of 9`, `VERDICT=DIFFERS`. Su `T3` ATOM
  decompone in **4** passi contro 2, due dei quali portano solo `cargo build` e **nessun file**, e
  il suo `expect` rifiuta l'intera aspettativa con una guardia **per passo**. Il riferimento non
  ci arriva mai: la sua guardia è **per piano** e scarta i comandi senza `test`. **Due contratti
  di rifiuto diversi sulla stessa superficie**, non «ATOM copre meno».
- **L'aggregato è dichiarato inutilizzabile, non nascosto.** `COVERAGE_DELTA=-0.2615` nasce su
  denominatori **10 contro 13**: artefatto del conteggio dei passi.
- **Due difetti dello strumento, trovati eseguendolo.** Un `0/n` da rifiuto era indistinguibile da
  un `0/n` da aspettativa vuota — la ragione era catturata e **mai stampata**, ed è costata una
  corsa diagnostica separata. E l'avviso sul denominatore scattava **solo** sul ramo
  `NO_DIFFERENCE`: la prima corsa mai atterrata su `DIFFERS` — con 10 vs 13, esattamente la
  condizione per cui l'avviso esiste — **non stampava nulla**. Entrambi riparati, con l'oracolo
  **visto rosso** sul secondo.

**Verificato in questa sessione:** unit **2895 test, 2894 pass, 0 fail, 1 skip preesistente** ·
ESLint **462 file, 0 errori 0 warning 0 no-undef** · `verify-source` **PASS**, `nul-free=1148` ·
matrice **65/67**, ratchet **visto FALLIRE a 1** · `ce-023-projection-coverage-report` **6/6** ·
sul vivo `healthy`, `/livez` e `/readyz` **200** · zero residui di sonda.

## WHAT WAS **NOT** DONE

- **`CE-024` e `CE-035` non toccate** — vedi sopra: mancano un banco che non esiste e una macchina
  che non è questa.
- **`D-0605` proposto, non eseguito**: il `expect` di riferimento **continua** a poter emettere
  un'aspettativa che non può essere contraddetta da un passo, senza dirlo. Oggi non si manifesta
  perché il suo `decompose` non produce passi senza file — è una latenza, non un bug attivo.
- **Perché `D-0215` (2026-07-28) desse `equal=9 of 9` e oggi dia `DIFFERS` non è stato
  stabilito.** Quale delle due parti sia cambiata non è stato misurato e non è affermato.
- **`atomd` girava con `simulation=true`**, senza modello: la misura riguarda la forma della
  decomposizione e della proiezione, non la qualità di un modello.
- **Non è misurato se l'aspettativa sia *giusta*** — la copertura dice quanto del piano potrebbe
  essere contraddetto dall'esito, mai se la previsione sia buona.
- **T2 e T3 non rieseguiti** (`noesar-evolution-verify`, regola del passaggio unico): questa fase
  ha cambiato due file di `tools/` e aggiunto un test, nessun file di `services/`, `apps/`,
  `capabilities/`, `rust/` o degli installer. HUNT AND FIX **scoped to the diff (4 file)**, non
  full sweep — e i due difetti trovati erano dentro quel diff.
- **Nulla è stato installato**, quindi nessun debito §3a è aperto da questa fase.
- **`MANIFEST.sha256` non rigenerato**: stale di ~670 file dal `D-0399`.
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
- **`D-0602` è CHIUSO** da `D-0604`: la misura è stata prodotta.
