# SESSION HANDOFF — 2026-08-14 (`D-0436`: browser terminal cursor hidden, region shrunk)

## ➜ LA PROSSIMA AZIONE

**L'installazione gira su `noesar-evolution:d0436-cursor-20260814T011452Z` dalle 01:15:20Z,
sana.** L'Owner ha confermato a occhio `D-0431` (una sola superficie su `#/coden`), poi ha
segnalato un cursore fermo nell'angolo in basso a destra del terminale e l'impressione che la
finestra fosse più grande del dovuto.

**Causa trovata leggendo il codice** (non da uno screenshot): `coden-terminal.js`'s `draw()`
scriveva solo `SCREEN.home + rows` a ogni frame — non nascondeva mai il cursore reale di
xterm.js. La shell `ssh` (`tui-fullscreen.mjs`) lo nasconde UNA VOLTA all'avvio via
`SCREEN.enter` (che include `?25l`), perché il TUI disegna il proprio caret (`›`) come parte
del frame. `renderFrame()` chiude sempre l'ultima riga (il footer) con `padToWidth` alla
larghezza intera, quindi il cursore di scrittura restava parcheggiato a colonna=larghezza,
riga=altezza-1 — l'angolo in basso a destra, ad ogni frame.

**Fix**: nuovo token condiviso `SCREEN.hideCursor` (`tui-screen.mjs`), scritto ad ogni `draw()`
di `coden-terminal.js`. `.coden-terminal-region` ridotta da `min(70dvh,48rem)` a
`min(55dvh,36rem)` su richiesta diretta dell'Owner.

1. **Apri `https://<host>:8443/#/coden`** e conferma a occhio: cursore non più visibile
   nell'angolo, box più contenuto.
2. **`D-0435` — ancora aperto**: ~12 controlli in `tools/browser-e2e.mjs` pilotano ancora
   `#codenPrompt`/`#codenMenu` direttamente e falliscono contro l'elemento nascosto. Non
   toccato in questa fase.
3. **`D-0433` — ancora aperto**: questo è il **quinto** redeploy della sessione. L'hook di
   chiusura fallirà — serve la conferma esplicita dell'Owner che lo stato è corretto.
4. **Poi, come già proposto**: igiene del repository (immagini `e2e-base-*`/`webui-e2e-*`
   orfane da sessioni precedenti, trovate ma non rimosse — fuori scope di questa fase, vedi
   sotto), riconciliazione dei tre piani.

**Rollback**, se qualcosa non convince:

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260814T011520Z noesar-evolution && docker start noesar-evolution
```

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `D-0431` "due chat" | **CONFERMATO dall'Owner a occhio.** |
| `D-0436` cursore terminale | **FATTO.** Causa trovata per lettura, non per screenshot; test unitario visto rosso poi verde. |
| `D-0433` | **APERTO, bloccante.** Quinto redeploy in sessione — l'hook di chiusura fallirà. |
| `D-0435` | **APERTO, invariato.** ~12 controlli E2E rotti dalla correzione di `D-0431`. |
| `D-0427`, `D-0429` | Invariati. |
| Immagini orfane (`e2e-base-*`, `webui-e2e-*`, 4 tag da sessioni precedenti) | **Trovate, non rimosse** — non create da questa fase, fuori scope (`noesar-evolution-budget` §5). Da rimuovere in una fase di igiene repository. |
| Igiene repository | Proposta, non iniziata. |

## Verificato IN QUESTA SESSIONE (ultimo giro)

| Strumento | Risultato |
|---|---|
| `node --test …` | **2540/2541** (1 skip preesistente, +1 nuovo test) |
| `tools/run-eslint.sh` | **407 file, 0 errori** |
| Byte-verify | 3 file modificati, sha256 container↔albero identico |
| `/livez` + `/readyz` (in-container) | entrambi 200/ready |
| Cleanup §5a | rollback vecchio rimosso, container non di progetto invariati a 50, volumi invariati a 63, reti invariate |
| `tools/run-secret-scan.sh` | `SKIPPED reason=image-absent` (gitleaks non installato su questo host) — scan euristico eseguito, dichiarato, 0 hit |

## Cosa NON è stato fatto

- **`D-0435` non toccato**: fuori scope di questa fase.
- **`D-0433` non riparato**: stesso motivo delle fasi precedenti, invariato.
- **Immagini Docker orfane non rimosse**: `noesar-evolution:e2e-base-20260813T170128Z`,
  `e2e-base-20260813T174609Z`, `webui-e2e-20260813T170128Z`, `webui-e2e-20260813T174609Z` —
  litter da una sessione precedente, trovate durante l'inventario §5a di questa fase, non
  create da questa fase. Da rimuovere in una fase di igiene dedicata.
- **Nessuna push ancora eseguita** al momento della scrittura di questo handoff — vedi il
  comando in coda alla fase.
- Igiene repository, riconciliazione dei tre piani: proposte, non iniziate.

## Proposta di miglioramento

**Il vocabolario ANSI condiviso (`SCREEN`) dovrebbe avere un test di parità che verifica ogni
consumatore (`tui-fullscreen.mjs`, `coden-terminal.js`) contro l'INTERO set di stati che un
frame può lasciare sul terminale reale** (cursore visibile/nascosto, buffer alternato
attivo/non attivo) — non solo, come oggi, che i due shell condividano lo stesso renderer. Il
difetto di `D-0436` è esistito per l'intera vita di `coden-terminal.js` senza che nessun test
lo intercettasse, perché nessun test guardava lo STATO del terminale dopo un `write()`, solo
il CONTENUTO. Costo: un test per stato (~4), beneficio: la stessa classe di difetto (uno shell
dimentica un `SCREEN.*` che l'altro invia) non richiede più uno screenshot dal vivo per essere
trovata.
