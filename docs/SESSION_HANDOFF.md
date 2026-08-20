# SESSION HANDOFF

**Sei fasi, e sono INSTALLATE.** `D-0594` (`CE-031` ⚠️) · `D-0596` (un byte NUL rendeva
`author.mjs` invisibile a `grep`) · `D-0597` (`CE-006` ✅) · `D-0599` (`CE-030` ✅) · `D-0600`
(`CE-027` ✅, `CE-028` ✅) · `D-0601` (`CE-005` ✅). Ratchet **9 → 3**, critical **0**.
Proposti: `D-0595`, `D-0598`. Bloccato: `D-0602` (`CE-023`).
**Live installation:** **`noesar-evolution:d0601-context-shape-20260820T104316Z`**, deployata
10:45Z su autorizzazione dell'Owner, `running`/`healthy`, `RestartCount=0`.
**Il debito §3a è chiuso:** l'installazione è pari all'albero.

## ➜ LA PROSSIMA AZIONE

**`CE-023`, deciso dall'Owner il 2026-08-20 — è la prossima sessione, e apre lì.** Sotto c'è tutto
ciò che serve per non ricostruirlo da capo: misurato oggi, non ricordato.

**Il punto di partenza è migliore di quanto `D-0602` lasciasse intendere.** `[VERIFIED]`
L'installazione viva **ha già ATOM selezionato**: `NOESAR_REASONING_MODE=rust-external`,
`NOESAR_RUST_REASONING_ENDPOINT=http://127.0.0.1:8410`, dodici superfici in
`NOESAR_EXTERNAL_SURFACES`, e `NOESAR_RUST_REASONING_TOKEN` **presente** (letto il nome, mai il
valore). Non c'è configurazione da inventare: c'è da **eseguire**.

**Due fatti che cambiano il piano, e che costerebbero mezza sessione a riscoprire:**

1. **Lo strumento NON è una suite mutante.** `[VERIFIED]`
   `tools/measure-projection-coverage.mjs` usa **solo** `ReasoningRouter` (`plan`, `decompose`,
   `expect`) — nessun `WorkspaceActionOrchestrator`, nessun workspace, nessun token coniato,
   nessuna scrittura. §3a 11e non è in gioco; la cautela vera è un'altra, la 2.
2. **L'endpoint è `127.0.0.1:8410` DENTRO il contenitore.** Il figlio `atom` gira lì e la porta
   non è pubblicata: dall'host lo strumento non raggiunge nulla. Quindi o gira **dentro**
   l'installazione, o gira su una **sonda usa-e-getta costruita dall'immagine viva** con lo stesso
   ambiente — che ha il suo atomd e non tocca la produzione. La seconda è la via da preferire, ed è
   una decisione da confermare **prima** di partire, non a metà.

**Cosa resta di `D-0602`, ridotto all'osso:** l'autorizzazione a eseguire la misura con ATOM
attivo. Il token resta nell'ambiente e **mai** in un file tracciato (§7).

**E il risultato atteso non è «ATOM migliora».** `D-0215` (2026-07-28) misurò
`PER_TASK better=0 worse=0 equal=9 of 9`, `VERDICT=NO_DIFFERENCE`, e scrisse che la differenza fra
i due provider sta nella **forma della decomposizione**, non nella copertura — per cui esiste già
`tools/measure-decomposition-shape.mjs`. Quella evidenza **non basta** per la casella: la regola 38
vieta un PASS su evidenza di un'altra sessione. Va rieseguita, e il verdetto va scritto per ciò che
la misura dice, non per ciò che ci si aspetta che dica.

**Dopo `CE-023`, le altre due — e nessuna delle due è lavoro pronto.**

**`CE-024` — è costruzione, non misura.** Chiede il tempo di revisione umana per cambiamento
accettato, «strumentazione del banco di revisione». Misurato: **un banco di revisione umana non
esiste ancora**. Chiuderla significa costruirlo, che è una decisione di prodotto.

**`CE-035` — serve una macchina che non è questa.** `ssh` + `coden_evolution` da un secondo nodo
reale: il VPS senza GPU col prodotto installato SOPRA, mai questo host esposto a internet. **La GPU
è irrilevante** — nessuna riga nomina un modello, e `CE-020` prova che la shell risponde con zero
modelli caricati. Il VPS si distrugge a fine prova; setup token e chiavi non entrano in nessun file
tracciato.

**Anche aperti:** `D-0564` · `D-0589` (provenienza HMAC **simmetrica**: blocca la posizione 5 di
`PKG-001`) · `D-0591` · `D-0593` · `D-0595` · `D-0598` · `D-0602` · `F-TOOLSCOPE-001`.

**`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Il filo che lega quattro delle sei fasi: un meccanismo che esisteva, collegato a nulla, e un
campo che non poteva dire altro che «va bene».**

- **`D-0594` `CE-031`** — il ✅ nel ledger era stato ottenuto modificando **questo host** (account,
  `sudoers`, `sshd`): vietato al prodotto, irripetibile, cancellato dal `/etc` in RAM. Ora una
  seconda macchina che **misura** il proprio isolamento registra l'Owner col secondo fattore e
  **guida la sessione** sopra il solo TCP (10/10), più 3/3 sull'host a privilegi abbassati.
- **`D-0596`** — **un byte NUL** rendeva `author.mjs` binario per `grep`, che senza `-a` **non
  stampa nulla**: il file spariva da ogni `grep -rn` su `services/` rispondendo «nessuna
  corrispondenza» invece di «non scandito». Riparato **e** la regola (1148 file, vista fallire).
- **`D-0597` `CE-006`** — il record di ogni chiamata al modello era **cinque digest e zero byte**:
  poteva verificare una chiamata rieseguita da altri e non rieseguirne nessuna.
- **`D-0599` `CE-030`** — non un verdetto mancante, **un buco**: l'unico chiamante non passava
  `previousAttemptDigests` né `attempts`, quindi `novelty` valeva `novel` su **ogni run mai
  fatto** e **nessun budget esisteva**.
- **`D-0600` `CE-027`/`CE-028`** — `replay()` diceva `faithful:true` senza guardare i byte. Ora è
  un **AND**. `CE-028` provata su **due repository git veri** con storie opposte.
- **`D-0601` `CE-005`** — **1188 byte a call 300 e a call 400**, rapporto 300/3 = **2,08×** contro
  il **81,6×** di prima del proiettore. E il test non diceva **dove** la forma si assesta: è la
  **chiamata 25**, ora asserito.

**Il deploy, e il rifiuto che l'ha preceduto.** Il primo tentativo usava un'immagine costruita
**prima** che `D-0601` toccasse `context-projection.test.mjs`: il preflight ha rifiutato con
`differing: 1`. Nessuna eccezione «è solo un file di test» — immagine **ricostruita**, e che il
codice di prodotto fosse invariato è stato **provato** confrontando le due immagini (unica
differenza quel file; modi, symlink e configurazione runtime identici), che è la ragione misurata
per cui e2e e accessibilità non sono state rieseguite.

**Verificato:** `scripts/test.sh` **18/18** · unit **2888/2889** (1 skip preesistente) · ESLint
**461 file 0/0/0** · browser e2e **0 rossi non dichiarati** · accessibilità **27/27** · matrice
**64 verdetti su 67**, ratchet visto **FALLIRE a 2** · **sei oracoli visti rossi** · sul vivo:
byte-uguale albero↔immagine **466/466**, i tre file del rilascio **identici** albero↔immagine, il
NUL **assente** dall'immagine spedita.

## WHAT WAS **NOT** DONE

- **`CE-023` non è stata misurata** (`D-0602`) — vedi sopra: è una condizione di stop, non una
  dimenticanza.
- **`CE-024` e `CE-035` non toccate**, e per `CE-024` la ragione è che il banco che dovrebbe
  strumentare **non esiste**.
- **`CE-031` è ⚠️, non ✅:** un altro namespace di rete non è un altro OS, un altro kernel, un
  `sshd` reale né un computer che non è questo.
- **`CE-028` non asserisce che un modello VIVO obbedisca** alle convenzioni che gli si mostrano.
- **La ritenzione dello store di replay non è decisa** (`D-0598`): `sweep()` esiste, è provato, e
  **non è chiamato da nulla**.
- **Nulla che richieda una sessione autenticata è provato sul vivo**, e nessuna suite mutante è
  stata puntata sull'installazione (§3a 11e).
- **`MANIFEST.sha256` non rigenerato**: stale di ~670 file dal `D-0399`, nessun passo della
  batteria lo verifica.
- **`D-0595` e `D-0598` proposti, non eseguiti.**
- **Un errore mio, oltre a quello dell'ordine di build:** uno script di sostituzione ha corrotto il
  **titolo** di `MASTER_PROJECT/16`. Ripristinato da git e i verdetti riscritti uno per uno.
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
- **`D-0602`**: `CE-023` ferma su ATOM + token.
