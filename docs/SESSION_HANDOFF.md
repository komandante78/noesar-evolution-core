# SESSION HANDOFF — 2026-08-13 (`D-0426` INSTALLATO: l'origine su TLS)

## ➜ LA PROSSIMA AZIONE

**L'installazione gira su `noesar-evolution:d0426-origin-20260813T140526Z` dalle 14:17:24Z,
sana.** Non rifiuta più la propria pagina sul listener cifrato.

1. **Apri `https://<host>:8443/#/coden` nel browser, con la tua sessione, e usa il terminale.**
   È l'unica parte che nessuna sonda qui può provare: senza sessione la stretta di mano si ferma
   a `401`, che è il gate della sessione, **a valle** di quello dell'origine.
   Mentre è aperto: `docker logs noesar-evolution | grep "foreign origin"` deve restare **vuoto**.
   Le uniche due righe presenti sono delle 14:18:50Z e vengono dalla sonda, che ha mandato
   apposta due origini sbagliate.
2. **Se il terminale attacca senza `1006`**, `D-0426` è chiuso da capo a fondo e si apre la
   **slice 4** (rimozione dei 25 pannelli fissi, seconda voce di sidebar, rotte morte).
3. **Se non attacca**, cattura il close code e la riga di log: l'origine non è più il sospetto.

**Rollback** (riporta l'installazione a rifiutare ogni stretta di mano https):

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260813T141723Z noesar-evolution && docker start noesar-evolution
```

## Blockers e finding aperti

| Id | Stato |
|---|---|
| deployment `D-0426` | **FATTO.** Installato 14:17:24Z, `healthy`, verificato in differenziale (`D-0428`). |
| accettazione Owner | **APERTA.** Serve un browser con sessione su `#/coden` via https — punto 1 qui sopra. |
| `D-0427` | **APERTO, invariato.** Nessuna suite di questo repository guida il prodotto **vivo** su TLS; `tls-smoke` copre solo la stretta di mano su listener propri. |
| `D-0429` | **PROPOSTA, non eseguita.** Rendere la sonda un gate post-deploy dentro `redeploy.sh`. |
| `F-E2E-001` | OPEN, visto una volta: la riga `s327/4b` ha traballato nel run 17. Registrato, non inseguito. |
| `F-I18N-002` | OPEN. Ratchet 607 → 644, **volutamente non ri-baselinato**. |
| `B-002`, `B-011`, A2 live, `D-0395`, `F-MANIFEST-001` | Invariati, **non toccati**. |

## Verificato IN QUESTA SESSIONE (evidenza prodotta qui)

| Strumento | Risultato |
|---|---|
| `tools/deploy/redeploy.sh … --apply --authorized-by-owner` | PREFLIGHT PASS · uscita pulita confermata · workspace salvato a servizio fermo · predecessore preservato · 4 figli avviati · **0 righe di auth-failure** |
| `docker inspect noesar-evolution` | `image=d0426-origin-20260813T140526Z` · `running` · `healthy` |
| `curl` sui due listener | `http://<host>:8100/livez` **200**, `/readyz` **200** · `https://<host>:8443/livez` **200**, `/readyz` **200** · `https://<host>:8443/` **200**, 129.426 byte |
| Sonda di stretta di mano TLS (sola lettura, nessuna mutazione) | `Origin: https://<host>:8443` → **401** (passa il gate dell'origine) · `http://<host>:8443` → **403** · `https://evil.example` → **403** · nessuna origine → 401 |
| Log, differenziale | predecessore `d0423`: **107** `refused a foreign origin`, **tutte** `https://<host>:8443` (la sua stessa pagina) · `d0426`: **0** auto-rifiuti, solo le 2 origini sbagliate della sonda |
| Pulizia §5a | rollback vecchio `…-pre-20260813T135635Z` rimosso (immagine conservata) · reti e volumi **diffati invariati** · container non di progetto 53 → 52 · dopo: esattamente **due** container di progetto |
| Secret scan | **EURISTICO** — l'immagine `gitleaks` è assente e scaricarla richiede la rete. 0 hit a forma di credenziale nel diff; nessun archivio, binario o `.env` in stage. |

**Nessuna suite ri-eseguita.** T2 era verde su questo albero nella sessione che ha costruito
l'immagine e **nessun file di prodotto è cambiato da allora** — questa sessione ha modificato
solo `docs/` e `PROJECT_STATE.json` (verify skill, regola del passaggio singolo). Il TIER di
questa fase è **T3 · LIVE INSTALL**.

## Cosa NON è stato fatto

- **La prova con sessione autenticata**: non fatta, non falsificabile da qui. Punto 1.
- **`D-0429` non è stato eseguito**: la sonda vive ancora nello scratchpad, non è un tool
  dell'albero. Eseguirla è una decisione dell'Owner (§69).
- **`D-0427` non è stato chiuso**: continua a non esistere una suite che guidi il prodotto
  installato su TLS.
- **Push fatta**: `a48e7a5..1146a48 main -> main` su `origin`, in questa sessione.

## Proposta di miglioramento (`D-0429`)

**Un deploy che non riesce ad accettare la propria pagina non deve poter dire `DEPLOYED`.**
Questo difetto è arrivato in produzione perché l'accettazione del deploy misurava la
*vivacità*, non **la prima azione dell'utente**: `/livez` è rimasto verde per tutta la durata
dei 107 rifiuti. La proposta è promuovere la sonda a `tools/live-origin-probe.mjs` e farla
girare da `redeploy.sh` contro il rimpiazzo, prima dell'annuncio. **Beneficio:** la classe
intera di difetti "il prodotto rifiuta sé stesso" diventa impossibile da spedire.
**Costo:** ~60 righe più un passo nello script, rimovibile senza toccare il prodotto.
