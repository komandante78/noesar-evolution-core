# SESSION HANDOFF

**Phase:** `D-0590` — `CE-020` chiude: ogni capacità del motore ha una forma da tastiera, **27/27**.
Ratchet **11 → 10**, critical **0**. `D-0591` proposto. Fase precedente della stessa sessione:
`D-0588` (i cinque archivi, `PKG-001`).
**Live installation:** `noesar-evolution:d0586-induced-facts-and-spaces-20260819T180231Z`,
`running`/`healthy`. **NON aggiornata**: l'installazione in esecuzione non ha i sei comandi nuovi.

## ➜ LA PROSSIMA AZIONE

**Il deploy di `D-0590` è in attesa di una parola dell'Owner.** Preflight già eseguito, non
mutante:

```text
tools/deploy/redeploy.sh --source noesar-evolution --check   ->  PREFLIGHT: PASS
```

Immagine corrente `d0586…`, rete `noesar-evolution-net`, 44 variabili · 3 porte · 2 bind, ogni
bind esiste, 249 GiB liberi, il nome del predecessore è libero, rollback dichiarato. `--apply`
esige `--authorized-by-owner`, e quella parola è dell'Owner — non me la do da solo, anche se
`CLAUDE10.md` §3a lega la fase a installare ciò che cambia. **È l'unica cosa aperta di questa
fase.**

Poi, la matrice a **67 criteri, 10 senza verdetto, 0 critici**. Le dieci:

- **(a) serve un banco che non esiste** — `CE-005` (il contesto alla chiamata *n* > 300 ha la
  forma della chiamata 3) · `CE-006` (ogni chiamata al modello rieseguibile isolata).
- **(b) serve una seconda macchina** — `CE-031` `CE-032` `CE-035`. **Non chiudibili onestamente
  su questo host solo**: dichiararlo è la risposta giusta, approssimare un verdetto di
  portabilità è il falso PASS della regola 38.
- **(c) serve prodotto non costruito** — `CE-023` `CE-024` `CE-027` `CE-028` `CE-030`. È la
  classe **più lunga e più densa**, e le cinque righe non sono indipendenti: `CE-027`, `CE-028`
  e `CE-030` sono tutte sull'Autore (fase 5 del piano `17`).

**`CE-020` non è più nell'elenco**: era l'unica riga le cui parti esistevano già, ed è chiusa.

**Anche aperti:** `D-0564` · `D-0589` (provenienza firmata HMAC **simmetrico**: non verificabile
da un auditor indipendente, blocca la posizione 5 di `PKG-001`) · `D-0591` · `F-TOOLSCOPE-001`.

**`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Due fasi.** `D-0588`: «i cinque archivi» nominava due artefatti diversi in otto punti e
`MASTER_PROJECT/` non li enumerava affatto; ora una lista sola in `09_PIANO.md` §4a, due istanze
nominate, `tools/verify-five-archives.mjs` nella batteria, riga `PKG-001` con un ❌ onesto.

**`D-0590`: `CE-020`.** Il criterio dice *ogni* capacità; il runner che lo copriva ne esercitava
**una** (`repoMap.scan`) e provava il meccanismo, non la copertura. Misurato leggendo
`SESSION_METHOD_POLICY` — il registro del motore, non una lista scritta a mano — **6 capacità su
27** non avevano forma da tastiera nella shell che un utente `ssh` riceve davvero. Quattro da
nessuna parte; **due (`sessions.get`, `sessions.action`) solo come verbi della shell a righe**,
che gira soltanto con stdin da pipe — dal sorgente si leggono come coperte e non lo sono. Stessa
forma del `D-0405`.

Sei comandi nella lista che **entrambe** le shell importano, quindi il browser li guadagna nello
stesso cambiamento; quattro rotte dirette in `CODEN_UNBRIDGED` perché quei metodi sono
`bridged:false`. **Nessun permesso allargato**: le rotte esistevano già e chiedono lo stesso
permesso del socket. `/session-action` porta con sé il rifiuto che la shell a righe aveva già —
`confirm` come parola digitata (`15` §13) — altrimenti la shell a schermo pieno sarebbe stata la
via più economica per la cosa più pericolosa (`purge` non si annulla).

**Verificato:** oracolo nuovo visto **FALLIRE a 6/27**; unit **2864/2865** (1 skip preesistente);
ESLint **455 file 0/0/0**; `scripts/test.sh` **16/16**; browser e2e **505/506**, l'unico rosso è
il gap dichiarato `F-I18N-002` a **647 — identico al valore misurato il 2026-08-18**, quindi non
cresciuto qui (`UNDECLARED=0`); `ce-020-tui-fullscreen.mjs` **CE020_FAIL=0** su 18 controlli
contro un motore vero a tasti veri; ratchet visto **FALLIRE a 9**.

## WHAT WAS **NOT** DONE

- **L'installazione non è stata aggiornata** — vedi LA PROSSIMA AZIONE. `CLAUDE10.md` §3a lega
  una fase che cambia il prodotto a installarla nella stessa fase, e questa fase cambia il
  prodotto: è un debito dichiarato, non una scelta.
- **`tools/accessibility-audit.mjs` non eseguito**, e dichiarato: nessun markup, nessun token CSS,
  nessuno stato visivo nuovo — le sei righe nuove usano il componente riga che già esiste.
- **La fase ha superato il budget dichiarato** (~45 chiamate, spese ~70). La causa è nominabile:
  la prima misura ha detto «10 capacità scoperte», e si è rivelata sbagliata — non contava le
  viste d'indirizzo. Rifarla per bene è ciò che ha trovato il difetto vero.
- **`D-0591` proposto, non eseguito**: l'oracolo prova che una forma da tastiera **esiste**, non
  che le altre ventisei **rispondano**.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`, quindi
  le scansioni di questa sessione sono state **euristiche e dichiarate tali**. Va richiuso o
  riscritto.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
