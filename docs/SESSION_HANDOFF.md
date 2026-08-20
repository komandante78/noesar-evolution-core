# SESSION HANDOFF

**Phase:** `D-0592` — `CE-032` registrato **⚠️ PARZIALE**: la metà «in contenitore» era letta sul
testo del Dockerfile, ora è **eseguita** dentro un contenitore vero. Ratchet **10 → 9**, critical
**0**. `D-0593` proposto. Stessa sessione, prima: `D-0588` (i cinque archivi), `D-0590` (`CE-020`).
**Live installation:** `noesar-evolution:d0586-induced-facts-and-spaces-20260819T180231Z`,
`running`/`healthy`. **Indietro di una fase**: non ha i sei comandi da tastiera di `D-0590`.

## ➜ LA PROSSIMA AZIONE

**1 · Il deploy di `D-0590` è ancora in attesa di una parola.** Preflight già eseguito, non
mutante:

```text
tools/deploy/redeploy.sh --source noesar-evolution --check   ->  PREFLIGHT: PASS
```

`--apply` esige `--authorized-by-owner`. `CLAUDE10.md` §3a lega una fase che cambia il prodotto a
installarla; `D-0590` lo ha cambiato. **È un debito dichiarato, non una scelta.**

**2 · `CE-031` e `CE-035`, nell'ordine deciso con l'Owner.** Prima una **sonda-contenitore come
"altra macchina"**: namespace di rete suo, utente non privilegiato, **nessun socket Docker
montato**, che raggiunge l'installazione solo via TCP su `noesar-e2e-net`. Chiude la parte
*raggiungibile senza privilegi e senza conoscere percorsi*. **Non** chiude OS diverso, kernel
diverso, `sshd` reale — e questo va **dichiarato**, non lasciato intendere.

Poi un **VPS senza GPU con il prodotto installato SOPRA** — mai questo host esposto a internet.
Il test è letteralmente `ssh` + `coden_evolution`, quindi **nessuna porta pubblica oltre a
`sshd`** e `INST-007` resta fuori dal tiro. **La GPU è irrilevante**: nessuna delle righe nomina
un modello, e il runner `CE-020` prova che la shell risponde con zero modelli caricati. Il VPS si
distrugge a fine prova; setup token e chiavi non entrano in nessun file tracciato (§7).

**3 · Le nove righe senza verdetto:** `CE-005` `CE-006` `CE-023` `CE-024` `CE-027` `CE-028`
`CE-030` `CE-031` `CE-035`. `CE-027`/`CE-028`/`CE-030` sono **un solo soggetto** — l'Autore, fase
5 del piano `17` — e vanno prese come **una** fase. `CE-006` costruisce il banco di replay che
`CE-027` riusa: va **prima**, o si costruisce due volte.

**Anche aperti:** `D-0564` · `D-0589` (provenienza HMAC **simmetrica**, non verificabile da un
auditor indipendente: blocca la posizione 5 di `PKG-001`) · `D-0591` · `D-0593` · `F-TOOLSCOPE-001`.

**`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Tre fasi.** `D-0588`: «i cinque archivi» nominava due artefatti e `MASTER_PROJECT/` non li
enumerava — ora una lista sola in `09_PIANO.md` §4a, due istanze nominate, guard nella batteria,
riga `PKG-001` con un ❌ onesto. `D-0590`: **6 capacità su 27** non avevano forma da tastiera nella
shell che un utente `ssh` riceve; ora **27/27**, sei comandi nella lista che entrambe le shell
importano, nessun permesso allargato.

**`D-0592`: `CE-032`.** Il criterio scrive *«avvio su un'installazione da sorgenti **e su una in
contenitore**»*. La prima metà era eseguita **36 volte** — l'avviatore vero contro motori finti su
un `PATH` sintetico, con l'`argv` come asserzione. La seconda erano **tre `assert.match` sul testo
di `oci/Dockerfile`**, che non vede una `COPY` che atterra altrove, un symlink oscurato più tardi,
un'immagine senza `sh`, o un lanciatore che muore allo shebang.

Ora la parola si **esegue** dentro un contenitore usa-e-getta costruito dall'immagine del prodotto
(`tools/acceptance/ce-032-launcher-in-container.sh`, in `scripts/test.sh`): **6/6**, e **visto
FALLIRE 6/6** contro `node:22-bookworm-slim`.

**Un difetto nel mio stesso oracolo, trovato provandolo a fallire.** Sotto `set -eu` una `[ … ]`
nuda che è falsa **termina la shell**: nessuna riga `FAIL`, **uscita 0**. Contro l'immagine giusta
sembrava verde. È `D-0390` una seconda volta — la trappola che per poco annullò un deployment
riuscito — nello stesso angolo del prodotto. Riparato, e provato in **entrambe** le direzioni.

**Verificato:** `scripts/test.sh` **17/17** · unit **2864/2865** (1 skip preesistente) · ESLint
**455 file 0/0/0** · matrice **58 verdetti**, ratchet visto **FALLIRE a 8**.

## WHAT WAS **NOT** DONE

- **L'installazione non è stata aggiornata**, seconda fase di fila — vedi LA PROSSIMA AZIONE.
- **`CE-032` NON è un ✅ pieno, ed è registrato ⚠️.** `tools/coden-evolution.ps1` è coperto **solo
  staticamente**: su questo host non c'è PowerShell e la regola 45 vieta di installarlo. Il livello
  dichiarato per un'installazione Windows resta **`UNVERIFIED`** finché non gira su Windows vero.
- **`CE-031` e `CE-035` non sono state toccate.** Restano senza verdetto, e la sonda-contenitore
  non le chiuderà del tutto: quello che manca davvero è una macchina che non è questa.
- **Browser e2e e accessibilità non rieseguiti** in questa fase: nessun markup, nessun DOM,
  nessun token CSS. Erano verdi in `D-0590` sullo stesso albero, meno un test file e uno script.
- **`D-0593` proposto, non eseguito.**

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`, quindi
  le scansioni di questa sessione sono **euristiche e dichiarate tali**. Va richiuso o riscritto.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
