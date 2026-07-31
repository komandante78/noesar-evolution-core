# NOESAR Evolution — Session Handoff

> Aggiornato 2026-07-31 (`D-0280`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
>
> ## ⏭ PRIMA AZIONE ALLA RIAPERTURA (s300 → s301)
>
> 1. **Shell orfana appesa sull'host, non risolta — autorizzazione Owner richiesta.** PID `444054`,
>    `/bin/bash -c … docker run --rm noesar-evolution:phase4-sess002-003-replay ls
>    /usr/lib/postgresql/18/bin/`, orfana (`ppid=1`) da **>25 ore**, figlia di una sessione Claude
>    Code di ieri ancora viva (PID `72349`). Quel `docker run` non esce **mai**: l'ENTRYPOINT
>    dell'immagine è `noesar-supervisord`, che ignora il comando e avvia i peer, quindi `--rm` non
>    scatta. Ha già prodotto **due** container fantasma con un PostgreSQL vero dentro. Il primo
>    (`beautiful_leakey`) è stato rimosso in s300 — **e la rimozione ha sbloccato la shell, che è
>    passata al comando successivo del suo script e ne ha creato un secondo** (`silly_knuth`, tuttora
>    in esecuzione, `unhealthy`). **Rimuovere il container senza uccidere prima la shell ne genera un
>    terzo.** Ordine corretto: `kill 444054` → `docker rm -f -v silly_knuth` → verificare che non ne
>    compaia un altro. È un processo dell'host, non un container: chiedere prima.
>    **Lezione permanente**: su un'immagine con ENTRYPOINT supervisore un probe una-tantum si scrive
>    `docker run --rm --entrypoint sh <tag> -lc '<comando>'`, mai `docker run --rm <tag> <comando>`.
> 2. **Albero di lavoro non committato, seconda sessione di fila.** `git status` porta le modifiche di
>    s299 **e** s300 (≈20 file: `apps/webui-static/*`, `sector-modules.mjs`, `auth.mjs`, `server.mjs`,
>    test, `MANIFEST.sha256`, `docs/*`). Verificate e installate dal vivo, mai committate — nessuna
>    richiesta esplicita dell'Owner in nessuna delle due sessioni. Scansione materiale riservato:
>    pulita. Chiedere se committare e pushare.
> 3. **Decisione aperta lasciata all'Owner**: Debug Evolution non ha più un cancello proprio e sta
>    sulla bridge Docker di default insieme a `Cloudflare-DDNS` e a qualunque container vi finisca —
>    provato dal vivo che da lì la sua API si raggiunge senza autenticarsi. Proposta: spostarlo su una
>    rete dedicata con NOESAR, così l'assenza di gate resta una scelta locale e non un'apertura.
> 4. Il quarto filo dell'Owner (Passkey/WebAuthn → `oci/Dockerfile` → Blocco G) riprende dopo.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008) → B (SESS-001..003) → C (CUBE-001..009) →
> pausa 1 → **decisione WebUI** → pausa 2 → E+F (debito+packaging) → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C, D COMPLETI. Blocco E+F: 3/7 debito chiuso (`D-0271`), poi SEI pivot
> espliciti dell'Owner** — `D-0273`…`D-0278` (modulo esterno ad-hoc → framework di
> attivazione reale → registry publisher-key reale → meccanismo ad-hoc ritirato → catalogo
> Owner a un click → Debug Evolution come tool reale + grafica + reauth rimossa) — **tutti
> e sei ora chiusi**. Il quarto filo dell'Owner (Passkey/WebAuthn → `oci/Dockerfile` →
> Blocco G) resta in pausa dietro questo lavoro, riprende quando l'Owner lo richiede.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ CINQUE REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted, mai una modifica
   all'host come rimedio.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: ogni fase produce una proposta
   di miglioramento — `D-0275` è la prova che viene eseguita, non solo registrata.
5. **`EXECUTE`, la custodia di chiavi di firma, la forma di un modulo, l'attivazione ad
   alto rischio e la registrazione/revoca publisher sono tutte decisioni del CLIENTE**
   (`D-0250`, `D-0271`-`D-0275`): mai prese da sole. `D-0277`/`D-0278` non cambiano questo
   — il server firma per conto dell'Owner solo per il catalogo NOESAR; togliere il passo
   di reauth (`D-0278`) è stata un'istruzione esplicita dell'Owner, non una scelta mia di
   ridurre attrito su una decisione che spettava a lui.

## ⛔ IMPORTANTE PER QUALSIASI BUILD FUTURO — layer depth del base image

Il tag corrente **`noesar-evolution:phase4-debug-evolution-tools`** (`D-0278`, `FROM
:phase4-owner-modules-catalog`) è a **42 layer overlay2** — ben sotto il limite di 128
che aveva bloccato `D-0273`. Usare questo tag come base del prossimo `FROM`. **Causa
strutturale invariata**: `oci/Dockerfile` canonico non fa boot — Thread 3 dell'Owner,
ancora aperto, margine ora a ~86 build.

## ⛔ LA PROSSIMA AZIONE — nessuna, sul lato Debug Evolution/Modules

Debug Evolution è installabile/attivabile dall'Owner dalla WebUI (Settings > Modules, un
click ciascuno, nessun reauth) ed è già un tool reale utilizzabile da qualsiasi Agent o
Workflow (3 tool seedati al boot + rotta di rescan). **Nessuna azione dell'assistente è
pendente su questo.**

Il filo dell'Owner rimasto in pausa (fine s296): 2) Passkey/WebAuthn → 3) `oci/Dockerfile`
→ 4) Blocco G. Primo passo reale quando ripreso: leggere cosa esiste già in `auth.mjs`/
`auth-crypto.mjs` (password+TOTP, sessioni, reauth forte) e cosa la matrice di sicurezza
intende per "Passkey/WebAuthn: MISSING" prima di scrivere codice. **"Moduli utenti"**
(customer-private/community, self-service) resta lavoro futuro non ancora scoping-ato.

## ➜ `D-0278` (questa sessione) — cosa è stato fatto

Owner ha chiesto se Debug Evolution "funziona con tutte le chat, anche con CodeN
Evolution" — risposta onesta: la chat semplice non ha un loop di tool-calling per NESSUN
tool in questo prodotto, è un limite dell'intera reference implementation. Owner ha
quindi ordinato, verbatim, tre cose: "FAI LA B" (bridge verso il tool system reale già
esistente, `agent-service.mjs`/`tool-executor.mjs`, non una riscrittura da zero delle
~8.000 righe di Debug Evolution), "la grafica webui devi cambiarla, ho bisogno di
professionalità", "togli l'autenticazione dai moduli, basta solo quella di noesar".
Fatte tutte e tre: `debug-evolution-bridge.mjs` (nuovo) seeda 3 tool a endpoint fisso al
boot (list projects/all findings/SARIF, credenziale in vault) + rotta dedicata
`POST /api/v1/debug-evolution/rescan` (owner+CSRF) per l'unica azione che l'executor
generico non sa esprimere (id progetto nel path). Card Modules ridisegnate
(`.module-card`/`.module-grid`, icona, riga trust/versione/publisher, tag settore) sullo
stesso linguaggio grafico di `.panel` invece del look piatto di `.entity-card`. Reauth
forte rimossa dalle rotte install/activate del catalogo (solo sessione+CSRF).

## ➜ Verificato in `D-0278`

| Verifica | Risultato |
|---|---|
| `node --test` (suite completa) | **1403/1404 PASS** (1 skip pre-esistente, +8) |
| `tools/run-eslint.sh` | **274 file · 0 errori** |
| `scripts/test.sh` (9 step) | **10/10 PASS** |
| `tools/seeded-defect-proof.mjs` | **19/19 catturati** |
| `MANIFEST.sha256` | **5894/5894** (5 hash cambiati, 0 nuove voci) |
| Browser E2E | **341/341 PASS** |
| Accessibility audit | **27/27 PASS** (contrasto AA icona nuova su 9 temi, stessa coppia gradiente/testo di `.primary`) |
| deploy | stop pulito, backup, §5a, hardening dal primo tentativo, `Up (healthy)`, byte identici, 3 tool confermati seedati via `state/ai-workspace.json` (non login Owner), probe live `401` |

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-debug-evolution-tools` (`D-0278`) · `Up
  (healthy)` · `192.168.178.100:8100→8088` · `migrations:19 rls_tables:18
  production_ready:true` (invariato). Rollback preservato:
  `noesar-evolution.rollback-debug-evolution-tools-20260731T132646Z`
  (`:phase4-owner-modules-catalog`).
- **Due container per progetto** — §5a rispettato. `beautiful_leakey` (segnalato in
  `D-0273`, `Up (unhealthy)`) **preesiste ancora, non toccato**.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Nessun modulo Debug Evolution è installato/attivo sulla vera installazione** — solo i
  3 tool sono seedati (letti da endpoint pubblici, nessuna scrittura). Install/Activate
  restano un'azione dell'Owner dalla WebUI, quando vuole.
- **`modules-registry.mjs` esiste ancora sul disco, non importato** — scelta deliberata
  (`CLAUDE10.md` regola 12, nessun emendamento richiesto).
- **Lavoro NON committato**: `D-0273`…`D-0278` restano tutte non committate (regola hard:
  mai commit senza richiesta esplicita dell'Owner in QUESTA conversazione).

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata
a fine progetto. `oci/Dockerfile`/layer-depth (`D-0271`): Thread 3, ancora aperto, margine
ampio (42/128 layer). `beautiful_leakey`: ancora da indagare/rimuovere, decisione
dell'Owner.

## ➜ Le domande all'Owner ancora senza risposta

Nessuna nuova. `beautiful_leakey` resta l'unica, invariata da `D-0273`.
