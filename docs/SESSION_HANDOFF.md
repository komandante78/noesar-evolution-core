# SESSION HANDOFF — 2026-08-14 (`D-0437`: `/` menu flattened, `.coden-bar`/`.coden-terminal-region` layout fixed)

## ➜ LA PROSSIMA AZIONE

**L'installazione gira su `noesar-evolution:d0437-menu-20260814T060733Z` dalle 06:07:48Z,
sana, byte-verificata.** Quattro problemi riportati dall'Owner su `#/coden`, tre risolti e
deployati, uno da confermare a occhio:

1. **Barra chip troppo alta — FATTO.** `project`/`git`/`model`/.../`Owner Bypass` andavano a
   capo uno per riga (8 righe). Ora la barra resta sempre una riga sola: i chip scorrono in
   orizzontale invece di impilarsi.
2. **Terminale bordo a bordo — FATTO.** `.coden-terminal-region` non aveva mai avuto margini
   propri (ereditava il "full width" di una scelta precedente, s333, pensata per l'agent
   shell sotto di lui). Ora ha 24px di margine (10px sotto gli 850px).
3. **Menu `/` a sottomenu — FATTO.** Era a due livelli (`/` da solo mostrava 7 gruppi, una
   lettera ne apriva uno). Ora è **una lista piatta unica**, classificata per rilevanza
   (`matchCommands`), con scorrimento a frecce quando non ci sta tutta — stessa forma su ssh,
   terminale integrato e fallback browser.
4. **Cursore doppio nell'angolo — NON CONFERMATO.** Il testo incollato dall'Owner sembrava un
   copia-incolla dell'intera pagina, non uno screenshot. xterm.js tiene una copia invisibile
   del testo del terminale per i lettori di schermo, sovrapposta esattamente al canvas visibile
   — è la spiegazione più probabile di un "doppio" nel testo copiato. `D-0436` (stessa sessione)
   nasconde già il cursore reale. **Serve la conferma a occhio dell'Owner** (non copiare testo):
   c'è davvero un secondo riquadro visibile, o no?

**Rollback**, se qualcosa non convince:

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260814T060748Z noesar-evolution && docker start noesar-evolution
```

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `D-0436` cursore terminale (xterm nascosto) | **FATTO**, deployato. |
| `D-0437` barra chip / margini terminale / menu piatto | **FATTO**, deployato. Conferma visiva Owner in sospeso. |
| Cursore "doppio" riportato dopo `D-0436` | **NON CONFERMATO** — probabile artefatto di copia-incolla, non riparato alla cieca. |
| `D-0433` | **APERTO, bloccante.** Sesto redeploy in sessione — l'Owner ha già riconosciuto lo stato come corretto al quinto. |
| `D-0435` | **APERTO, invariato.** ~12 controlli E2E rotti dalla correzione di `D-0431`. |
| Immagini Docker orfane (`e2e-base-*`, `webui-e2e-*`, trovate durante il cleanup `D-0436`) | **Trovate, non rimosse** — fuori scope, da rimuovere in una fase di igiene repository. |
| `D-0427`, `D-0429` | Invariati. |

## Verificato IN QUESTA SESSIONE (ultimo giro)

| Strumento | Risultato |
|---|---|
| `node --test …` | **2536/2537** (1 skip preesistente) |
| `tools/run-eslint.sh` | **407 file, 0 errori** |
| `coden-shell-parity.test.mjs` (riscritto per la forma piatta) | **50/50** |
| Byte-verify | 6 file modificati, sha256 container↔albero identico |
| `/readyz` (in-container) | 200/ready |
| Cleanup §5a | rollback vecchio rimosso, container non di progetto invariati a 50, volumi invariati a 63, reti invariate |
| `tools/run-secret-scan.sh` | `SKIPPED reason=image-absent` — scan euristico eseguito, dichiarato, 0 hit |

## Cosa NON è stato fatto

- **Il cursore "doppio" non riparato**: causa non confermata dal vivo, nessuna modifica alla
  cieca. In attesa della conferma dell'Owner.
- **`D-0435` non toccato**: fuori scope di questa fase.
- **`D-0433` non riparato**: stesso motivo delle fasi precedenti, invariato.
- **Immagini Docker orfane non rimosse**: fuori scope, da fare in una fase dedicata.
- **Nessuna push ancora eseguita** al momento della scrittura di questo handoff.

## Proposta di miglioramento

**Un test di parità sullo STATO del terminale dopo un `write()`** (cursore visibile/nascosto,
buffer alternato attivo), non solo sul contenuto — già proposto in `D-0436`, resta valido: la
via più economica per chiudere la classe di difetto "un shell dimentica un escape/stato che
l'altro invia" senza dover aspettare uno screenshot dal vivo per scoprirlo.
