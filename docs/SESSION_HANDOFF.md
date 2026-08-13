# SESSION HANDOFF — 2026-08-13 (`D-0430..D-0433`: chip, banco corretto due volte, menu, un buco trovato nell'hook)

## ➜ LA PROSSIMA AZIONE

**L'installazione gira su `noesar-evolution:d0431b-transcript-20260813T171059Z` dalle 17:11:14Z,
sana.** Tre difetti live sono riparati e installati; uno di loro (`D-0431`) è stato corretto
**due volte** nella stessa fase — la prima etichetta non bastava, confermato con uno screenshot
reale dopo che tu hai detto che si vedeva ancora tutto come prima.

1. **Apri `https://<host>:8443/#/coden` con la tua sessione** e controlla:
   - la chip in alto dice `model phi-4` (o il modello davvero residente);
   - il box sotto il terminale ora **apre con una frase diversa** da quella del terminale
     ("CodeN Evolution — bench command line, same session as the terminal above…" invece di
     ripetere "attached to the live session" come il terminale sopra) — non è più nascosto (lo
     è stato provato, rompeva la navigazione reale verso 17/25 pannelli bench, vedi `D-0431`);
   - dentro il **terminale**, `/` poi `↑`/`↓`/`Tab`/`Invio` muovono ed eseguono (`D-0415(b)` chiuso).
2. **Se le tre reggono**, `D-0430..D-0432` sono chiusi. Se il box sotto continua a leggersi come
   "la stessa pagina due volte", la soluzione vera resta la slice 4 (una sola superficie) — questa
   fase ha fatto la correzione massima possibile senza romperla di nuovo.
3. **`D-0433` — nuovo, trovato in chiusura di questa fase**: l'hook di chiusura sessione
   (`session-close-guard.sh`) **bloccherà** ogni prossimo `Stop` finché non viene riparato o
   riconosciuto. Causa: questa sessione ha rifatto il deploy di `noesar-evolution` **tre volte**;
   la prova che l'hook chiede (l'id del predecessore preservato deve venire dal baseline di inizio
   sessione) regge per UN redeploy, non per una catena — e la pulizia §5a, corretta, rimuove
   proprio il container che avrebbe portato quella prova per il secondo. **Non riparato qui**:
   tocca la catena di fiducia dello strumento di deploy già testato in modo avversariale
   (`D-0393`), e questo file ha già causato danni reali quando toccato di fretta (`D-0381`).
   Serve una fase dedicata: `redeploy.sh` attesta ogni transizione, l'hook si fida della catena
   attestata, un test avversariale prova che un'attestazione falsa non compra l'esenzione.
4. **Poi, come già proposto e non ancora iniziato**: igiene del repository (`evidence/` vs
   `EVIDENCE/`, MANIFEST disallineato, tre piani di fase mai riconciliati) e la slice 4.

**Rollback**, se qualcosa non convince:

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260813T171114Z noesar-evolution && docker start noesar-evolution
```

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `D-0430` chip modello | **FATTO.** Installato, verificato per bytes. |
| `D-0431` "seconda pagina" | **Corretto (2° tentativo), non risolto alla radice.** Il testo d'apertura ora è distinto; il box resta perché è l'unica via viva verso 17/25 pannelli bench. La soluzione vera è la slice 4. |
| `D-0432` / `D-0415(b)` | **CHIUSO.** Provato dal vivo (screenshot + marcatore che si sposta). |
| `D-0433` | **NUOVO, APERTO, BLOCCANTE per la chiusura sessione.** Vedi punto 3 sopra. Non è un difetto del prodotto installato — è un buco nella prova di provenienza dell'hook dopo redeploy multipli. |
| `D-0427`, `D-0429` | Invariati. |
| Igiene repository | Proposta, non iniziata (vedi sessione precedente). |
| `F-E2E-001`, `F-I18N-002` | Invariati — `F-I18N-002` a 644, non cresciuto nonostante la nuova stringa runtime (registrata in `RUNTIME_ONLY`). |

## Verificato IN QUESTA SESSIONE (evidenza prodotta qui, secondo giro)

| Strumento | Risultato |
|---|---|
| `node --test …` | **2539/2540** (1 skip preesistente) |
| `tools/run-eslint.sh` | **407 file, 0 errori** |
| `tools/run-browser-e2e.sh` | **494/495** — unico FAIL `F-I18N-002`, invariato |
| Screenshot reale (`NOESAR_E2E_DRIVER` su un probe usa-e-getta, mai sull'installazione viva) | ha mostrato la duplicazione reale — la prova diretta che ha portato alla seconda correzione |
| `NOESAR_E2E_DRIVER=tools/accessibility-audit.mjs …` | **27/27** |
| `tools/seeded-defect-proof.mjs` | **19/19** |
| Byte-verify (2 file, terzo deploy) | **2/2 MATCH** |
| Pulizia §5a | rollback vecchio rimosso, container non di progetto invariati a 52 |

## Cosa NON è stato fatto

- **Nessuna conferma a occhio dell'Owner** sul deploy finale.
- **`D-0433` non riparato**: causa nota, riparazione rinviata a una fase dedicata per le ragioni
  scritte sopra e nel decision log — non per pigrizia, per lo stesso principio che ha già
  protetto questo file tre volte in passato (`D-0381`, `D-0383`, `D-0392`).
- **`D-0431` non risolto alla radice**: resta la slice 4.
- Igiene repository, riconciliazione dei tre piani: proposte, non iniziate.
- **Nessuna push**: non eseguita in questa sessione.

## Proposta di miglioramento

**La stessa di prima, ora con una terza prova a favore**: un deploy che non riesce a rendere
davvero chiara la propria superficie non dovrebbe poter dire `DEPLOYED`. Tre difetti in questa
sessione (`D-0426`, `D-0432`, e il primo tentativo fallito di `D-0431`) sarebbero stati visibili
prima se l'accettazione del deploy avesse incluso uno screenshot reale della destinazione
toccata, non solo `/livez`. Lo screenshot usato oggi per diagnosticare `D-0431` è stato deciso
mentre si scriveva questo handoff — costruirlo come passo ripetibile è il prossimo passo naturale
di `D-0429`.
