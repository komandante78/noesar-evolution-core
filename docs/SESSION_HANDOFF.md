# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-28. Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai CodeN Ultra, NOESAR V3,
ATOM o altro dell'host. L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Da `D-0172` impone tre skill sempre attive.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**Controllo sistematico Fase 1-7 eseguito su istruzione dell'Owner** (verificare cosa
manca, finirlo, poi andare avanti — non più a salti). Stato reale trovato nel codice:

| Fase | Stato |
|---|---|
| 1 — spina dorsale | Chiusa (D-0203), EXECUTE rifiutato per design |
| 2 — workspace | **Non costruita** come descritta in `09_PIANO.md` (16 stadi/editor/terminale — la visione del prodotto finito). Esiste invece l'ordine di costruzione **per dipendenza** di `15_CODEN_EVOLUTION_DA_ZERO.md` §10: passi 1-8 = Fase 1 già fatta, **passo 9 chiuso oggi (D-0209)**, passo 10 aperto |
| 3 — due shell | Non costruita, zero file |
| 4 — memoria/privacy | Parziale: broker egress 7 stati **fatto e corretto**; MEVCM (contaminazione/canary) zero codice |
| 5 — isolamento | Non applicata: `security/seccomp-noesar.json` esiste ma non è referenziato da nessun codice |
| 6 — ATOM | Fuori da questo repository per decisione (repository privato separato) |
| 7 — mondo esterno | Chiusa (D-0204..D-0208), 31 passi tutti indirizzati |

**`D-0209`: CodeN Evolution, passo 9 — il verificatore per ricalcolo — costruito, CABLATO
(non framework), installato.** `verification.mjs`: ricalcola affermazioni sul contenuto
di un file (esistenza/contenuto/hash/campo JSON) contro lo stato dell'ombra dopo
l'esecuzione — mai eseguendo nulla. Una affermazione comportamentale è sempre dichiarata
non ricalcolabile (EXECUTE resta rifiutato). **Cablato**:
`workspace-actions.mjs::approve()` rifiuta la promozione se una claim ricalcolata è
CONTRADDETTA, anche con confronto percorsi pulito. `:phase4-recompute-verifier`
(**installazione corrente**).

**Prossima azione**: passo 10 (catalogo strumenti a carico zero), oppure — dato che la
Fase 2/3/5 di `09_PIANO.md` restano vuote — una decisione dell'Owner su quale dei due
piani (l'ordine per dipendenza di doc 15, o la Fase 2 originale di doc 9) seguire da qui.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-recompute-verifier` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-oidc-saml-scim-20260728T131609Z`. Due container di progetto,
che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

`D-0203` → `D-0204` → `D-0205` → `D-0206` → `D-0207` → `D-0208` → (controllo Fase 1-7,
nessuna decisione, solo verifica) → `D-0209`. Sette commit pushati su `origin/main`.

## ➜ Verifiche prodotte in sessione (cumulative, ultima misura per voce)

```text
unit 914→...→1040, ESLint 191→...→211 file 0 errori, verify-source/http-smoke/
auth-http-smoke PASS ad ogni passo con rotte/wiring nuovi, browser e2e 315/315
(riverificato 5 volte, 0 regressioni), accessibilità 27/27 (riverificato 5 volte),
difetti seminati 19/19 (riverificato 5 volte), scripts/test.sh pass=5 fail=0 invariato.
MANIFEST 5788→5809 (una riga trovata corrotta durante l'aggiornamento D-0209 e riparata —
vedi «cosa NON è vero» sotto). Cinque deploy live (D-0204..D-0207, D-0209), tutti healthy
al primo tentativo, restarts=0, byte immagine=albero provato ogni volta. gitleaks dopo
ogni commit: 0 leak. DebugLab full-sweep ogni volta che si introduce/tocca una superficie
nuova: sempre 0 finding nei file scritti in questa sessione.
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Fasi 2, 3, 5 del roadmap `09_PIANO.md` restano sostanzialmente vuote** — non solo
  "saltate": verificate nel codice, non nei documenti.
- **MEVCM (contaminazione/canary/promozione) non esiste**: zero file.
- **Il file di policy seccomp non è collegato a nulla** — stesso schema morto trovato nei
  passi 27-29, non ancora riparato per la Fase 5.
- **Il verificatore per ricalcolo copre solo affermazioni sul contenuto dei file** —
  nessuna affermazione comportamentale ("questa funzione ritorna X") è verificabile senza
  riaprire EXECUTE, che resta rifiutato.
- **Un bug reale trovato e riparato durante D-0209**: un `sed` di sessione aveva svuotato
  l'hash di una riga di MANIFEST.sha256, e `sha256sum -c` l'aveva saltata in silenzio
  (0 mismatch dichiarati, 1 riga in realtà corrotta) — riparata, 5809/5809 ora pulite.
  Verificare sempre `sha256sum -c` con stderr, non solo il conteggio "OK".
- Né sector modules, né compliance packs, né Technology Radar, né OIDC sono enforced.
  SCIM lo è. Il verificatore per ricalcolo (D-0209) **lo è anch'esso** — gate reale sulla
  promozione.
- **F7-001 aperto**: reperti pre-esistenti (subprocess a percorso parziale), mai nei file
  scritti in questa sessione.

## ➜ Blocker aperti

`B-002` (low, nessun gitleaks/trufflehog/syft/cyclonedx installabile — regola 45).
Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **Quale piano seguire per "il workspace"**: l'ordine di costruzione per dipendenza di
  `15_CODEN_EVOLUTION_DA_ZERO.md` §10 (passo 10 = catalogo strumenti, poi ATOM), o la
  Fase 2 originale di `09_PIANO.md` (16 stadi/editor/terminale/sotto-agenti — molto più
  grande)? Sono due descrizioni diverse dello stesso pezzo di prodotto.
- **Fase 5 (isolamento)**: si vuole collegare davvero il file seccomp esistente, o è
  fuori scope per ora?
- **Fase 4 (MEVCM)**: si vuole costruire la pipeline di contaminazione/canary?
- Le domande precedenti restano aperte: conservazione dati richieste rifiutate (`D-0136`),
  credenziali in PostgreSQL (`F4-013`), attivare TLS, riaprire EXECUTE, SAML, `F7-001`.
