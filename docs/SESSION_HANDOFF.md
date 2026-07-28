# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-28. Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai CodeN Ultra, NOESAR V3,
ATOM o altro dell'host. L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ DUE REGOLE AGGIUNTE IN QUESTA SESSIONE (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
   Prima di dichiarare un gap non risolvibile o iniziare a costruire, controllare
   `find docs/ MASTER_PROJECT/ -newer <ultimo documento letto>`. `D-0210` ha corretto un
   errore reale nato dal non averlo fatto.
2. **`ATOM_EVOLUTION` (repository nuovo, separato, `/mnt/cachec/ATOM_EVOLUTION`) non
   copia MAI nulla dal vecchio** — né da `NOESAR-ATOM-PRIVATE`, né dal progetto ATOM
   originale (`ATOM`/`ATOM_MODEL`/`ATOM_INTERNAL`). Corretto con forza dall'Owner dopo che
   un primo tentativo aveva provato a preservare lavoro vecchio "per non perderlo" — vedi
   `D-0212` e `.claude/skills/noesar-evolution/SKILL.md`, sezione dedicata.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Da `D-0172` impone tre skill sempre attive.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. `.claude/skills/noesar-evolution/SKILL.md` — include ora la regola ATOM EVOLUTION sopra.
4. `find docs/ MASTER_PROJECT/ -newer docs/SESSION_HANDOFF.md` — regola 1 sopra.
5. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**Sessione chiusa su istruzione esplicita dell'Owner.** Il lavoro di questa sessione (Fase
7 completa, passi 9-10 dell'ordine di costruzione CodeN Evolution) è tutto committato,
pushato e installato — vedi sotto. L'unica cosa aperta è **`ATOM_EVOLUTION`**, che resta
**deliberatamente vuoto**: nessun codice scritto, nessun file, `git init` senza commit.

**Alla ripresa**: si lavora su ATOM dentro `/mnt/cachec/ATOM_EVOLUTION` (repository
separato da NOESAR EVOLUTION, ma il lavoro si fa nell'ambito di una sessione NOESAR
EVOLUTION — l'Owner ha detto esplicitamente "alla ripresa della nuova sessione lavoriamo
su atom dentro noesar evolution"). Il punto di partenza dichiarato: il contratto
`ReasoningProvider` già pubblico in `MASTER_PROJECT/02_ATOM.md` — **non** il vecchio
blueprint di `NOESAR-ATOM-PRIVATE`, che resta intoccato ma non è più la fonte.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-tool-catalog` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-recompute-verifier-20260728T142717Z`. Due container di
progetto, che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione. **Invariata da
`D-0211`** — la creazione di `ATOM_EVOLUTION` non tocca nulla di installato.

## ➜ Cosa è stato fatto in questa sessione (la più lunga finora)

`D-0203` (chiusura Fase 1) → `D-0204` passo 27 → `D-0205` passo 28 → `D-0206` passo 29 →
`D-0207` passo 30 → `D-0208` passo 31, **chiudendo l'intero roadmap `09_PIANO.md`** →
`D-0209` CodeN Evolution passo 9 (verificatore per ricalcolo, cablato) → `D-0210`
correzione SBOM → `D-0211` CodeN Evolution passo 10 (catalogo strumenti) → `D-0212`
repository `ATOM_EVOLUTION` creato vuoto. Dieci commit pushati su `origin/main`.

## ➜ Verifiche prodotte in sessione (cumulative, ultima misura per voce)

```text
unit 914→1061, ESLint 191→213 file 0 errori, verify-source/http-smoke/auth-http-smoke
PASS ad ogni passo con rotte/wiring nuovi, browser e2e 315/315 (riverificato 6 volte,
0 regressioni), accessibilità 27/27, difetti seminati 19/19 (riverificato 6 volte),
scripts/test.sh pass=5 fail=0 invariato. MANIFEST 5788→5812, sempre N/N verificate (una
riga trovata corrotta e riparata durante D-0209). Sei deploy live, tutti healthy al primo
tentativo, restarts=0, byte immagine=albero provato ogni volta. gitleaks dopo ogni
commit: 0 leak, 151 commit alla penultima chiusura. DebugLab full-sweep ad ogni superficie
nuova: sempre 0 finding nei file scritti in questa sessione. Un vero SBOM CycloneDX 1.7 +
SPDX 2.3 rigenerato dal vivo (D-0210).
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Fasi 2, 3, 5 del roadmap `09_PIANO.md` restano sostanzialmente vuote.**
- **MEVCM (contaminazione/canary/promozione) non esiste**: zero file.
- **Il file di policy seccomp non è collegato a nulla.**
- **Il catalogo strumenti non è ancora cablato** su un mint di token reale.
- **`ATOM_EVOLUTION` è vuoto** — zero commit, zero file. Non è un errore, è lo stato
  voluto a fine sessione.
- **`docs/REMAINING_WORK.md` (26 luglio) elenca molto altro** non toccato in questa
  sessione: WCAG "misurato non certificato", nessun collaudo di sicurezza indipendente,
  passkey/WebAuthn parziali.
- **F7-001 aperto**: reperti pre-esistenti (subprocess a percorso parziale), mai nei file
  scritti in questa sessione.
- SCIM e il verificatore per ricalcolo sono **enforced**. Sector modules, compliance
  packs, Technology Radar, OIDC, catalogo strumenti **non lo sono ancora**.

## ➜ Blocker aperti

`B-002` (low, nessun gitleaks/trufflehog installabile — regola 45; syft invece esiste già
in cache, vedi `D-0210`). Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **`ATOM_EVOLUTION`**: da dove iniziare esattamente — solo il contratto
  `ReasoningProvider`, o anche una prima implementazione minima?
- **Quale piano seguire per "il workspace"**: continuare l'ordine per dipendenza di
  `15_CODEN_EVOLUTION_DA_ZERO.md` (passo 11 = ATOM, ora con repository proprio), o
  costruire la Fase 2 originale di `09_PIANO.md`?
- **Fase 5 (isolamento)**: collegare davvero il file seccomp esistente?
- **Fase 4 (MEVCM)**: costruire la pipeline di contaminazione/canary?
- **`docs/REMAINING_WORK.md`**: quali dei suoi punti contano ancora, dato che il metro è
  cambiato dal V4 alla riscrittura il 26 luglio?
- Le domande precedenti restano aperte: conservazione dati richieste rifiutate (`D-0136`),
  credenziali in PostgreSQL (`F4-013`), attivare TLS, riaprire EXECUTE, SAML, `F7-001`.
