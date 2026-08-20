# SESSION HANDOFF

**Fasi in questa sessione, tre:** `D-0594` (`CE-031` ⚠️ PARZIALE) · `D-0596` (un byte NUL rendeva
`author.mjs` invisibile a `grep`) · `D-0597` (`CE-006` ✅). Ratchet **9 → 7**, critical **0**.
`D-0595` e `D-0598` proposti.
**Live installation:** **`noesar-evolution:d0590-keyboard-coverage-20260820T050637Z`**,
`running`/`healthy`. Rollback conservato: `noesar-evolution-pre-20260820T050745Z` (uno solo, §5a).

## ➜ LA PROSSIMA AZIONE

**1 · IL DEPLOY DI `D-0597` ATTENDE L'OWNER, e il debito §3a è riaperto.** `D-0596` e `D-0597`
cambiano codice del prodotto (`author.mjs`, `workspace-actions.mjs`, `authoring-replay-store.mjs`),
quindi **l'installazione viva non è più pari all'albero**. Va chiusa con la sequenza intera di
`CLAUDE10.md` §3a 11c — costruire offline, provare byte-uguale albero↔immagine, fermare con
grazia, backup a servizio fermo, conservare il predecessore, ripartire con la configurazione
**riletta dal contenitore che sostituisce**, verificare sul vivo, pulire.

**2 · POI `CE-027`/`CE-028`/`CE-030` come UNA fase.** Sono **un solo soggetto** — l'Autore, fase 5
del piano `17` — e adesso hanno il banco che mancava: `AuthoringReplayStore` e
`replayAuthoredCall` rigiocano **una** chiamata dal suo record, che è esattamente ciò che `CE-027`
riusa per rigiocare una **sessione**. Era la ragione per cui `CE-006` andava prima, e vale ancora.

**3 · `CE-035` è dell'Owner, non del prodotto.** Chiede `ssh` + `coden_evolution` da una **seconda
macchina della rete**. `D-0594` ha chiuso la metà *raggiungibile senza privilegi*; ciò che resta è
**una macchina che non è questa**, con `sshd` reale — il VPS senza GPU con il prodotto installato
SOPRA, mai questo host esposto a internet. **La GPU è irrilevante:** nessuna riga nomina un
modello, e `CE-020` prova che la shell risponde con zero modelli caricati.

**Le sette righe senza verdetto:** `CE-005` `CE-023` `CE-024` `CE-027` `CE-028` `CE-030` `CE-035`.

**Anche aperti:** `D-0564` · `D-0589` (provenienza HMAC **simmetrica**, non verificabile da un
auditor indipendente: blocca la posizione 5 di `PKG-001`) · `D-0591` · `D-0593` · `D-0595` ·
`D-0598` · `F-TOOLSCOPE-001`.

**`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`D-0594` · `CE-031`.** La riga (Sev A) aveva verdetto vuoto nella matrice e un ✅ nel ledger, e i
due non raccontavano la stessa cosa: quel ✅ (2026-08-07, `D-0341`) fu ottenuto creando un account
di sistema, tre regole `sudoers` e un blocco `sshd` **su questo host** — vietato al prodotto,
irripetibile da un test, e cancellato dal `/etc` in RAM al riavvio successivo. Ora
`tools/acceptance/ce-031-second-machine.sh` (step tristate di `scripts/test.sh`): **10/10** da una
seconda macchina — namespace di rete suo, uid 65534, **nessun socket di motore**, nessun percorso
di questo host, e **misura** il proprio isolamento invece di presumerlo — che sopra il solo TCP
raggiunge, **registra l'Owner col secondo fattore** e **guida la sessione** (`status` →
`noesar-tui/1`; `capability.grants`, che richiede `workspace.read`, → 200); e **3/3** sull'host con
i privilegi abbassati a uid 65534, dove la parola sola esce **3** dichiarando che il motore non le
risponde e nomina il browser. Oracolo rosso in **due** direzioni.

**`D-0596` · un byte NUL.** Trovato **usandolo**: un `grep` su `services/…/author.mjs` tornava
vuoto mentre `head` mostrava il contenuto. Il file conteneva **1 NUL grezzo** a 16.918 di 25.691 —
`grep` classifica come binario un file che contiene un NUL e **non stampa nulla** senza `-a`,
quindi quel file spariva da ogni `grep -rn` su `services/`, compreso il passo di lettura di HUNT
AND FIX, **rispondendo «nessuna corrispondenza» invece di «non scandito»**. Il NUL come separatore
è giusto (è l'unico byte che un percorso non può contenere): è cambiato **come è scritto**, non
cosa vale — `attemptDigest` identico prima e dopo, misurato. E la **regola**, non solo l'istanza:
`verify-source.mjs` rifiuta ogni sorgente di prima parte con un NUL grezzo (**1143 file**), vista
FALLIRE reintroducendo il byte. Su 6.698 file tracciati: 29 con NUL, **28 legittimamente binari**,
uno solo di prima parte. `git` **non** era colpito — euristica sui primi 8.000 byte — quindi la
revisione della regola 44 non è mai stata cieca.

**`D-0597` · `CE-006`.** Il record di ogni chiamata al modello portava **cinque digest e zero
byte**. Un digest **verifica** una chiamata che qualcun altro ha rieseguito; non ne riesegue
nessuna, e i mezzi non erano registrati da nessuna parte — mentre la regola 5 in testa ad
`author.mjs` dichiarava *«each authoring returns a replayable record»*. Mancava anche
`beforeDigest`, senza cui `unchanged` vs `written` — un confronto con i byte di **prima** — non è
ricostruibile affatto. Ora i digest che la fixture **già portava** sono indirizzi di contenuto in
`AuthoringReplayStore`: la riga di ledger **non cresce di un byte** e il record è risolvibile.
`ce-006-…test.mjs` **11/11**, col metodo che la riga nomina — sessione conclusa a tre esiti, una
scelta **a caso**, poi tutte e tre; un test rigioca aprendo lo store da zero **senza orchestratore,
run, workspace o modello**; un test asserisce **sui byte** del ledger che né prompt né risposta lo
raggiungono. Due oracoli rossi: senza persistenza dei byte **4** test cadono, senza il solo
`beforeDigest` **3**.

**Verificato:** `scripts/test.sh` **18/18** · unit **2875/2876** (1 skip preesistente) · ESLint
**458 file 0/0/0** · matrice **60 verdetti su 67**, ratchet visto **FALLIRE a 6** · `shellcheck` da
contenitore usa-e-getta → solo `SC1007` sull'idioma corretto `CDPATH= cd`, **dismesso con motivo**.

## WHAT WAS **NOT** DONE

- **`D-0596` e `D-0597` NON sono installati**, ed è il punto 1 qui sopra: l'installazione viva
  porta ancora `d0590` e l'albero è tre commit di prodotto più avanti.
- **`CE-031` NON è un ✅ pieno, ed è ⚠️.** «Un'altra macchina» qui è un altro **namespace di rete**
  con un uid non privilegiato — non un altro OS, un altro kernel, un `sshd` reale, né un computer
  che non è questo. Quelli sono `CE-035`, e richiedono una seconda macchina vera.
- **`CE-035` non è stata toccata.**
- **La ritenzione dello store di replay non è decisa** (`D-0598`): `sweep()` esiste, è provato, e
  **non è chiamato da nulla** — lo store cresce col ledger finché l'Owner non decide.
- **`MANIFEST.sha256` non rigenerato**, e dichiarato: stale di ~670 file dal `D-0399`, nessun passo
  della batteria lo verifica.
- **Browser e2e e audit di accessibilità non rieseguiti**: nessun markup, nessun DOM, nessun token
  CSS toccato in tutta la sessione. Erano verdi in `D-0590`. **Da rieseguire al deploy.**
- **`D-0595` e `D-0598` proposti, non eseguiti.**
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`
  (rimisurato). I soli reperti sono due `/etc/passwd`, canarini di path traversal in
  un'asserzione e in prosa — dismessi con motivo.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`. Va
  richiuso o riscritto.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
