# SESSION HANDOFF — 2026-08-14 (`D-0439`: `.coden-bar` height, real cause fixed)

## ➜ LA PROSSIMA AZIONE

**L'installazione gira su `noesar-evolution:d0439-bar-20260814T085950Z` dalle 09:00:06Z, sana,
byte-verificata.** Sei richieste dell'Owner su `#/coden` in questa sessione. Il margine del
terminale (`D-0438`, 48px) è **confermato buono dall'Owner**. Le altre:

1. **Cursore xterm mai nascosto (`D-0436`) — FATTO.**
2. **Barra chip a 8 righe (`D-0437`) — FATTO.**
3. **Terminale bordo a bordo (`D-0437`→`D-0438`) — FATTO, CONFERMATO dall'Owner.**
4. **Menu `/` a sottomenu (`D-0437`) — FATTO.**
5. **Altezza `.coden-bar` ancora troppa dopo `D-0438` — FATTO (`D-0439`).** Il tetto
   `max-height:1,5cm` di `D-0438` non cambiava nulla a vista perché non era la causa: i due
   bottoni Normal/Owner Bypass ereditavano il padding dei bottoni generici del prodotto (9px
   13px, font 16px) — ~45px contro i ~25px dei chip accanto. A `align-items:center` la riga
   prende l'altezza del figlio più alto, quindi la barra era ~63px, **oltre** il tetto di
   1,5cm — `overflow:hidden` la stava probabilmente tagliando in silenzio invece di farla
   apparire più bassa. Corretto scalando i bottoni alla stessa misura dei chip: ~43px totali,
   nessun taglio, riduzione reale del ~32%. Il tetto di `D-0438` è stato rimosso (non più
   necessario).
6. **Cursore "doppio" nell'angolo — NON CONFERMATO.** Probabile artefatto di copia-incolla
   (mirror di accessibilità di xterm), non un bug visivo reale — `D-0436` nasconde già il
   cursore vero. **Serve la conferma a occhio dell'Owner**, guardando lo schermo.

**Rollback**, se qualcosa non convince:

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260814T090006Z noesar-evolution && docker start noesar-evolution
```

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `D-0436` cursore terminale | **FATTO**, deployato. |
| `D-0437` menu piatto / barra 1 riga | **FATTO**, deployato. |
| `D-0438` margine terminale 48px | **FATTO**, **CONFERMATO dall'Owner**. |
| `D-0439` altezza reale `.coden-bar` | **FATTO**, deployato. Conferma visiva Owner in sospeso. |
| Cursore "doppio" | **NON CONFERMATO** — non riparato alla cieca. |
| `D-0433` | **APERTO, bloccante.** Ottavo redeploy in sessione — stessa condizione già accettata dall'Owner ai redeploy precedenti. |
| `D-0435` | **APERTO, invariato.** ~12 controlli E2E rotti dalla correzione di `D-0431`. |
| Immagini Docker orfane (`e2e-base-*`, `webui-e2e-*`) | **Trovate, non rimosse** — fuori scope. |
| `D-0427`, `D-0429` | Invariati. |

## Verificato IN QUESTA SESSIONE (ultimo giro)

| Strumento | Risultato |
|---|---|
| `node --test …` | **2536/2537** (1 skip preesistente, invariato) |
| `tools/run-eslint.sh` | **407 file, 0 errori** |
| Byte-verify | `styles.css` container↔albero identico |
| `/readyz` (in-container) | 200/ready |
| Cleanup §5a | rollback vecchio rimosso, container non di progetto invariati a 50, volumi invariati a 63 |

## Cosa NON è stato fatto

- **`.coden-bar` (`D-0439`) non ancora confermata a occhio dall'Owner.**
- **Il cursore "doppio" non riparato**: causa non confermata dal vivo.
- **`D-0435`, `D-0433` non riparati**: fuori scope di questa fase.
- **Immagini Docker orfane non rimosse**: fuori scope.
- **Nessuna push ancora eseguita** al momento della scrittura di questo handoff.

## Proposta di miglioramento

**Un test di parità sullo STATO del terminale dopo un `write()`** (cursore, buffer alternato),
non solo sul contenuto — proposto in `D-0436`, resta valido e non ancora costruito. La stessa
lezione di `D-0439` si applica anche qui: un tetto/cap dichiarato non è la stessa cosa che
misurare la causa reale — un test che calcola l'altezza effettiva di `.coden-bar` dai valori
CSS (come fatto a mano in questa fase) chiuderebbe la classe di difetto senza uno screenshot.
