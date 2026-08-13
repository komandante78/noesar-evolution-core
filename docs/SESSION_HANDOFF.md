# SESSION HANDOFF — 2026-08-13 (`D-0430..D-0432` INSTALLATI: chip modello, banco, menu del terminale)

## ➜ LA PROSSIMA AZIONE

**L'installazione gira su `noesar-evolution:d0432-menu-20260813T155141Z` dalle 15:54:26Z, sana.**
Tre difetti che avevi segnalato dal vivo su `#/coden` sono stati riparati e installati.

1. **Apri `https://<host>:8443/#/coden` con la tua sessione** e controlla tre cose puntuali:
   - la chip in alto ora dice `model phi-4` (o il modello davvero residente), non più `model none`;
   - sotto al terminale, il box col prompt legacy ha ora un'etichetta visibile **"Bench command
     line"** sopra di sé — non è più stato nascosto (nasconderlo rompeva la navigazione reale
     verso 17 dei 25 pannelli bench, misurato e poi annullato: vedi `D-0431`);
   - dentro al **terminale** (non nel box sotto), digita `/` e prova `↑`/`↓`/`Tab`/`Invio`: ora
     spostano ed eseguono davvero, `D-0415(b)` è chiuso.
2. **Se le tre reggono**, `D-0430..D-0432` sono chiusi da capo a fondo.
3. **Poi due filoni già proposti, non ancora iniziati** (l'Owner deciderà l'ordine):
   igiene del repository (`evidence/` vs `EVIDENCE/`, MANIFEST disallineato, tre piani di fase
   mai riconciliati) e la slice 4 di `MASTER_PROJECT/17` (unificare `#codenShell` e il terminale
   in una sola superficie — il fix vero per `D-0431`, non l'etichetta di questa fase).

**Rollback**, se qualcosa non convince:

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260813T155426Z noesar-evolution && docker start noesar-evolution
```

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `D-0430` chip modello | **FATTO.** Installato, verificato per bytes; manca solo la conferma a occhio dell'Owner. |
| `D-0431` "seconda pagina" | **Etichettato, non risolto alla radice.** `#codenShell` resta perché è l'unica via viva verso 17/25 pannelli bench — misurato con l'E2E dopo un tentativo di nasconderlo che ha rotto `#/coden/bench/map`. La soluzione vera è la slice 4. |
| `D-0432` / `D-0415(b)` | **CHIUSO.** Frecce/Tab/Invio muovono ed eseguono nel terminale, provato dal vivo (marcatore `▸` si sposta `WORK`→`DESTINATIONS`). |
| `D-0427` | **APERTO, invariato.** Nessuna suite di questo repository guida il prodotto vivo su TLS. |
| `D-0429` | **PROPOSTA, non eseguita.** Sonda di stretta di mano promossa a gate post-deploy. |
| Igiene repository | **PROPOSTA, non eseguita.** `evidence/` (30 file, fossile dal bootstrap 25/07) vs `EVIDENCE/` (93 file, vivo) — collidono su filesystem case-insensitive (Windows/macOS), violazione §60-64. MANIFEST 5.898 voci contro 6.591 file tracciati. Tre piani di fase (`PHASE_PLAN`, la riscrittura, `MASTER_PROJECT/17`) mai riconciliati fra loro. |
| `F-E2E-001`, `F-I18N-002` | Invariati — vedi `docs/DECISION_LOG.md`. |

## Verificato IN QUESTA SESSIONE (evidenza prodotta qui)

| Strumento | Risultato |
|---|---|
| `node --test …` | **2539/2540** (1 skip preesistente), 0 fallimenti |
| `tools/run-eslint.sh` | **407 file, 0 errori** |
| `tools/run-browser-e2e.sh` | **494/495** — l'unico FAIL è `F-I18N-002`, già dichiarato, **non cresciuto** (644, invariato) |
| `NOESAR_E2E_DRIVER=tools/accessibility-audit.mjs tools/run-browser-e2e.sh` | **27/27** |
| `tools/seeded-defect-proof.mjs` | **19/19 CAUGHT** |
| Byte-verify (5 file cambiati, hash singoli immagine↔albero) | **5/5 MATCH** |
| `docker inspect` + `curl` su https 8443 | `running`/`healthy`, `/readyz` 200, `/` 200 (130.063 byte) |
| Pulizia §5a | rollback vecchio (`…-pre-20260813T141723Z`) rimosso, immagine conservata; reti/volumi diffati invariati; container non di progetto invariati a 52 |
| Secret scan | **EURISTICO** — 0 hit a forma di credenziale nel diff |

## Cosa NON è stato fatto

- **Nessuna conferma a occhio dell'Owner** sulle tre superfici — punto 1 sopra.
- **`D-0431` non è risolto alla radice**: `#codenShell` e il terminale restano due superfici;
  unificarle è la slice 4, deliberatamente non eseguita qui (fuori scope, rischio misurato).
- **Flattening del menu** (`/` come lista unica invece che a gruppi) valutato su richiesta
  dell'Owner e **scartato per questa fase**: `CE-020` misurò già che una lista piatta da 53 voci
  non entra in un viewport terminale; il difetto reale era la non-risposta, non il
  raggruppamento, e questa fase lo chiude senza toccare la matematica di scroll testata di
  `tui-screen.mjs`. Resta un'opzione futura, registrata qui.
- **Igiene repository e riconciliazione dei tre piani**: proposte all'Owner nella stessa
  conversazione, non ancora autorizzate.
- **Nessuna push**: non eseguita in questa sessione.

## Proposta di miglioramento

**La stessa di `D-0429`, ancora valida e non eseguita**: un deploy che non riesce a servire la
propria pagina, o la cui superficie principale non risponde all'input, non dovrebbe poter dire
`DEPLOYED`. Sia `D-0426` (origine TLS) sia questa fase (menu non responsivo) sono difetti che
`/livez` non avrebbe mai visto. **Costo:** ~60 righe più un passo in `redeploy.sh`.
