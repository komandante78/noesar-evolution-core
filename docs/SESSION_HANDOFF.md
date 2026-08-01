# NOESAR Evolution — Session Handoff

> Aggiornato 2026-08-01 (`D-0282`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
>
> ## ⏭ PRIMA AZIONE ALLA RIAPERTURA (s301 → s302)
>
> `D-0281` (rete dedicata) ha rotto il link della sidebar del modulo — la sua
> `externalUrl` era un indirizzo LAN diretto, appena chiuso. Riparato nella stessa
> sessione con `D-0282` (proxy autenticato via NOESAR). Nessun debito noto rimasto su
> Debug Evolution/rete/link.
>
> 1. **Push su `origin`?** 4 commit locali avanti (`4f220dc` D-0273..D-0280, `11132f0`
>    pin, `7339c92` D-0281, `cb9c048` pin) + il lavoro di questa sessione (`D-0282`) non
>    ancora committato — chiedere.
> 2. Il quarto filo dell'Owner (Passkey/WebAuthn → `oci/Dockerfile` → Blocco G) riprende
>    ora, nessun altro filo davanti. Primo passo: leggere `auth.mjs`/`auth-crypto.mjs`
>    (password+TOTP, sessioni, reauth forte) e cosa la matrice di sicurezza intende per
>    "Passkey/WebAuthn: MISSING" prima di scrivere codice.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase Owner** ("finisci tutto il progetto, massimo 4 pause"):
> A → B → C → pausa 1 → **decisione WebUI** → pausa 2 → E+F → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C, D COMPLETI. Blocco E+F: 3/7 debito chiuso (`D-0271`), poi SEI pivot
> Owner** — `D-0273`…`D-0278` — **tutti chiusi**, seguiti da `D-0279`/`D-0280` (auth
> service-token + credenziali modulo NOESAR-provisioned), `D-0281` (rete dedicata + bug
> di riconciliazione tool) e `D-0282` (link sidebar riparato via proxy autenticato). Il
> quarto filo (Passkey/WebAuthn → `oci/Dockerfile` → Blocco G) resta l'unico non ancora
> ripreso.

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
   (`D-0250`, `D-0271`-`D-0275`): mai prese da sole.

## ⛔ IMPORTANTE PER QUALSIASI BUILD FUTURO — layer depth del base image

Il tag corrente **`noesar-evolution:phase4-module-console-proxy`** (`D-0282`, `FROM
:phase4-debug-evolution-net-migration`) è a **16 layer overlay2** (`RootFS.Layers`, non
`docker history`) — ben sotto il limite di 128. Usare questo tag come base del prossimo
`FROM`. **Causa strutturale invariata**: `oci/Dockerfile` canonico non fa boot — Thread 2
dell'Owner sotto, ancora aperto.

## ⛔ LA PROSSIMA AZIONE — nessuna, sul lato Debug Evolution/rete/link

Debug Evolution è su `noesar-evolution-net`, irraggiungibile dalla LAN direttamente. Il
link della sidebar ora passa da un proxy autenticato su NOESAR (`192.168.178.100:8089`,
gate su sessione NOESAR reale, `workspace.read`). **Nessuna azione dell'assistente è
pendente su questo.** Riprende: Passkey/WebAuthn (vedi sopra).

## ➜ `D-0282` (questa sessione) — cosa è stato fatto

Owner ha segnalato: "non si apre nessun link neanche il link sulla sidebar del modulo".
Causa: `owner-module-catalog.mjs` aveva `externalUrl: 'http://192.168.178.100:8787'`
(link diretto voluto in `D-0273`, CSP del modulo vieta l'iframe) — `D-0281` ha chiuso
quella porta, rompendo l'unico modo con cui un umano apriva la console. Ripubblicare la
porta è stato scartato subito: riapre esattamente il buco appena chiuso (il modulo non
ha più login proprio da `D-0280`). Costruito `module-console-proxy.mjs`: un secondo
listener su NOESAR, gated sulla stessa sessione cookie di ogni altra rotta NOESAR
(`workspace.read`), proxy a path radice (deliberatamente **senza prefisso** — il modulo
usa path assoluti tipo `href="/styles.css"`, che un mount con prefisso romperebbe
silenziosamente; `<base href>` non aiuta, non copre i path root-relative). Il catalogo
ora calcola `externalUrl` per `debug-evolution` come `bindAddress` di NOESAR sulla nuova
porta proxy (`8089` default, `NOESAR_MODULE_PROXY_PORT`), non più l'indirizzo diretto
del modulo. Frontend invariato (`app.js` renderizza semplicemente qualunque
`externalUrl` arrivi dall'API).

## ➜ Verificato in `D-0282`

| Verifica | Risultato |
|---|---|
| `npm test` (suite completa) | **1416/1417 PASS** (1 skip pre-esistente, +8 nuovi) |
| `tools/run-eslint.sh` | **280 file · 0 errori** |
| unit proxy isolato | 5/5: 401 pre-upstream, GET/POST passthrough esatto, cookie non inoltrato, 502 su upstream irraggiungibile |
| integrazione catalogo | 3/3: `externalUrl` = `bindAddress:proxyPort`, proxy rifiuta senza sessione, proxy serve con sessione reale (flusso setup+TOTP reale) |
| live: boot log | `module-console-proxy.started port:8089 target:http://debug-evolution:8787` |
| live: proxy senza cookie | `401` |
| live: NOESAR pubblico 8100 | `/livez` 200 (invariato) |
| live: target del proxy raggiungibile | `docker exec` → `/styles.css` 200 |
| **non verificato dal vivo** | passaggio con una sessione Owner REALE su questa installazione — nessuna password/TOTP disponibile in questa sessione, stessa cautela di `D-0279` |
| dati | `migrations:19 rls_tables:18 production_ready:true` invariato |

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-module-console-proxy` (`D-0282`) ·
  `Up (healthy)` · `192.168.178.100:8100→8088` + `192.168.178.100:8089→8089` (proxy
  modulo, nuovo). Rollback: `noesar-evolution.rollback-pre-module-proxy-20260801T002903Z`
  (`:phase4-debug-evolution-net-migration`).
- **`debug-evolution`**: `Up (healthy)`, invariata da `D-0281`, non toccata in questa
  fase.
- **Due container per progetto ciascuno** — §5a rispettato per entrambi.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`modules-registry.mjs` esiste ancora sul disco, non importato** — scelta deliberata
  (`CLAUDE10.md` regola 12, nessun emendamento richiesto).
- **Lavoro committato in questa sessione**: `D-0273`…`D-0281` (4 commit, s301), `D-0282`
  ancora da committare a fine sessione. Nessun push eseguito.
- **Il proxy funziona per QUALSIASI utente NOESAR autenticato con `workspace.read`**, non
  solo Owner — stesso livello di permesso già usato dalla rotta GET del catalogo.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata
a fine progetto. `oci/Dockerfile`/layer-depth: Thread 2 dell'Owner sotto, ancora aperto,
margine ampio (16/128 layer sul tag corrente).

## ➜ Le domande all'Owner ancora senza risposta

Nessuna nuova.
