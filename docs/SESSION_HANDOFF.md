# SESSION HANDOFF

**Cinque fasi in questa sessione:** `D-0594` (`CE-031` ⚠️) · `D-0596` (un byte NUL rendeva
`author.mjs` invisibile a `grep`) · `D-0597` (`CE-006` ✅) · `D-0599` (`CE-030` ✅) · `D-0600`
(`CE-027` ✅, `CE-028` ✅). Ratchet **9 → 4**, critical **0**. `D-0595` e `D-0598` proposti.
**Live installation:** **`noesar-evolution:d0590-keyboard-coverage-20260820T050637Z`**,
`running`/`healthy`. Rollback conservato: `noesar-evolution-pre-20260820T050745Z` (uno, §5a).

## ➜ LA PROSSIMA AZIONE

**1 · IL DEPLOY ATTENDE UNA PAROLA DELL'OWNER, ed è la prima cosa.** L'albero è **cinque commit
di prodotto** avanti all'installazione viva — `D-0596` (il byte NUL), `D-0597` (lo store di
replay), `D-0599` (il budget di novità), `D-0600` (il replay di sessione). **Il debito §3a è
aperto e cresce.** Si chiude con la sequenza **intera** di `CLAUDE10.md` §3a 11c: costruire
offline, provare byte-uguale albero↔immagine, fermare con grazia, backup a servizio fermo,
conservare il predecessore, ripartire con la configurazione **riletta dal contenitore che
sostituisce**, verificare sul vivo, pulire. **Al deploy vanno rieseguiti** browser e2e e l'audit
di accessibilità: nessuna di queste fasi ha toccato markup, DOM o token CSS, quindi non sono
stati rieseguiti qui — erano verdi in `D-0590`, sullo stesso albero di interfaccia.

**2 · Le quattro righe rimaste.** `CE-005` (la forma del contesto alla chiamata *n* > 300) e
`CE-023` (copertura di proiezione **misurata**, con e senza ATOM) sono misurabili qui. `CE-024`
(tempo di revisione umana per cambiamento accettato) chiede di strumentare il banco di revisione.
`CE-035` è **dell'Owner**: chiede `ssh` + `coden_evolution` da una macchina **che non è questa**,
quindi il VPS senza GPU con il prodotto installato SOPRA, mai questo host esposto a internet.
**La GPU è irrilevante** — nessuna riga nomina un modello, e `CE-020` prova che la shell risponde
con zero modelli caricati.

**Anche aperti:** `D-0564` · `D-0589` (provenienza HMAC **simmetrica**, non verificabile da un
auditor indipendente: blocca la posizione 5 di `PKG-001`) · `D-0591` · `D-0593` · `D-0595` ·
`D-0598` · `F-TOOLSCOPE-001`.

**`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Il filo che lega quattro delle cinque fasi: un meccanismo che esisteva, collegato a nulla, e un
campo che non poteva dire altro che «va bene».**

**`D-0594` · `CE-031`.** Verdetto vuoto nella matrice e un ✅ nel ledger che non raccontavano la
stessa cosa: quel ✅ (2026-08-07) fu ottenuto creando un account, tre regole `sudoers` e un blocco
`sshd` **su questo host** — vietato al prodotto, irripetibile, cancellato dal `/etc` in RAM al
riavvio. Ora `ce-031-second-machine.sh` (step tristate della batteria): **10/10** da una seconda
macchina che **misura** il proprio isolamento (namespace suo, uid 65534, nessun socket di motore)
e sopra il solo TCP registra l'Owner col secondo fattore e **guida la sessione**; **3/3** sull'host
con i privilegi abbassati. Non è un ✅ pieno: un altro namespace **non è** un'altra macchina.

**`D-0596` · un byte NUL.** Trovato **usandolo**: `grep` su `author.mjs` tornava vuoto mentre
`head` mostrava il contenuto. Un NUL grezzo a 16.918/25.691 — `grep` tratta il file come binario e
**non stampa nulla** senza `-a`, quindi spariva da ogni `grep -rn` su `services/`, compreso il
passo di lettura di HUNT AND FIX, **rispondendo «nessuna corrispondenza» invece di «non
scandito»**. Cambiato **come è scritto** (`\0`), non cosa vale: `attemptDigest` identico, misurato.
E la **regola**: `verify-source.mjs` rifiuta ogni sorgente di prima parte con un NUL grezzo (1143
file), vista FALLIRE. `git` non era colpito — euristica sui primi 8.000 byte — quindi la revisione
della regola 44 non è mai stata cieca.

**`D-0597` · `CE-006`.** Il record di ogni chiamata al modello era **cinque digest e zero byte**:
poteva **verificare** una chiamata rieseguita da altri e non rieseguirne nessuna, mentre la regola
5 di `author.mjs` dichiarava *«each authoring returns a replayable record»*. Ora quei digest sono
**indirizzi di contenuto** — la riga di ledger non cresce di un byte — più `beforeDigest`, senza
cui `unchanged` vs `written` non è ricostruibile. **11/11**, col metodo della riga: una decisione
**a caso** da una sessione conclusa.

**`D-0599` · `CE-030`.** Non un verdetto mancante: **un buco**. `author()` accetta
`previousAttemptDigests` e `attempts` dal giorno in cui è stato scritto; il **suo unico chiamante
nel prodotto** non passava né l'uno né l'altro. `novelty` valeva `novel` su **ogni run mai fatto**,
il ramo `repeat` viveva solo nei test, e **nessun budget esisteva**. Ora: storia per conversazione,
un ripetuto **non consuma budget**, a esaurimento **il modello non viene più interrogato** e il
piano sopravvive.

**`D-0600` · `CE-027` e `CE-028`.** `replay()` ricalcolava le decisioni e **lasciava fuori dal
verdetto l'autoratura**: `faithful:true` voleva dire «il piano coincide» e taceva sui byte, in un
metodo che si chiama replay. Ora è un **AND**, riportato per chiamata e per nome. E `CE-028` è
provata su **due repository git veri** con storie opposte, col profilo asserito **sul prompt reso**
— `author.mjs` ricorda quando quella riga leggeva `signal.signal` contro un modulo che emette `id`
e per una fase intera il modello ricevette `- undefined: high`.

**Verificato:** `scripts/test.sh` **18/18** · unit **2895/2896** (1 skip preesistente) · ESLint
**461 file 0/0/0** · matrice **63 verdetti su 67**, ratchet visto **FALLIRE a 3** · **cinque
oracoli visti rossi**, uno per riga chiusa.

## WHAT WAS **NOT** DONE

- **Niente è installato.** `D-0596`, `D-0597`, `D-0599`, `D-0600` cambiano codice del prodotto e
  l'installazione viva porta ancora `d0590`. È il punto 1 qui sopra.
- **`CE-031` è ⚠️, non ✅:** un altro namespace di rete non è un altro OS, un altro kernel, un
  `sshd` reale né un computer che non è questo. Quelli sono `CE-035`.
- **`CE-035` non è stata toccata** e non poteva esserlo: serve una seconda macchina vera.
- **`CE-028` non asserisce che un modello VIVO obbedisca** alle convenzioni che gli si mostrano —
  è una proprietà del modello, non del prodotto, e questa suite non ha un modello.
- **La ritenzione dello store di replay non è decisa** (`D-0598`): `sweep()` esiste, è provato, e
  **non è chiamato da nulla**. Lo store cresce col ledger finché l'Owner non decide.
- **Browser e2e e audit di accessibilità non rieseguiti** in nessuna delle cinque fasi: nessun
  markup, nessun DOM, nessun token CSS toccato. **Da rieseguire al deploy.**
- **`MANIFEST.sha256` non rigenerato**, e dichiarato: stale di ~670 file dal `D-0399`, nessun passo
  della batteria lo verifica.
- **`D-0595` e `D-0598` proposti, non eseguiti.**
- **Un errore mio:** uno script di sostituzione ha corrotto il **titolo** di `MASTER_PROJECT/16`
  invece delle righe. Ripristinato da git — l'unica modifica non committata di quel file era la
  corruzione — e i tre verdetti riscritti uno per uno.
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`
  (rimisurato). I soli reperti sono `/etc/passwd`/`/etc/shadow` in prosa e in asserzioni di path
  traversal — canarini, dismessi con motivo.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`. Va
  richiuso o riscritto.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
