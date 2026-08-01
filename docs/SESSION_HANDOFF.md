# NOESAR Evolution — Session Handoff

> Aggiornato 2026-08-01 (`D-0281`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
>
> ## ⏭ PRIMA AZIONE ALLA RIAPERTURA (s301 → s302)
>
> I primi tre punti lasciati da s300 sono tutti chiusi in s301: shell orfana+container
> fantasma rimossi (diagnosi corretta: non un loop, un singolo `docker run` bloccato
> dall'ENTRYPOINT supervisore — vedi lezione permanente sotto), lavoro s299+s300 committato
> (`4f220dc`+`11132f0`, non pushato), Debug Evolution spostato su rete dedicata (`D-0281`).
>
> 1. **Push su `origin`?** 2 commit locali avanti (`4f220dc` D-0273..D-0280, `11132f0` +
>    pin), poi il lavoro di questa sessione (`D-0281`) non ancora committato — chiedere.
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
> service-token + credenziali modulo NOESAR-provisioned) e `D-0281` (rete dedicata +
> bug di riconciliazione tool trovato dalla migrazione stessa). Il quarto filo (Passkey/
> WebAuthn → `oci/Dockerfile` → Blocco G) resta l'unico non ancora ripreso.

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

Il tag corrente **`noesar-evolution:phase4-debug-evolution-net-migration`** (`D-0281`,
`FROM :phase4-module-credentials`) è a **15 layer overlay2** (`RootFS.Layers`, non
`docker history`) — ben sotto il limite di 128 che aveva bloccato `D-0273`. Usare questo
tag come base del prossimo `FROM`. **Causa strutturale invariata**: `oci/Dockerfile`
canonico non fa boot — Thread 2 dell'Owner sotto, ancora aperto.

## ⛔ LA PROSSIMA AZIONE — nessuna, sul lato Debug Evolution/rete

Debug Evolution è ora su `noesar-evolution-net`, irraggiungibile dalla LAN (porta 8787
non più pubblicata), reachability interna verificata dal vivo in entrambe le direzioni.
**Nessuna azione dell'assistente è pendente su questo.** Riprende: Passkey/WebAuthn (vedi
sopra).

## ➜ `D-0281` (questa sessione) — cosa è stato fatto

Owner ha chiesto: "abbiamo già fatto il modulo, cosa c'entra la rete dedicata?" — risposta:
`D-0280` ha tolto il login proprio di Debug Evolution, che stava sulla bridge Docker di
default con `192.168.178.100:8787` pubblicato sulla LAN — chiunque sulla LAN entrava senza
autenticarsi. Spostato `debug-evolution` su `noesar-evolution-net` (stessa rete di
`noesar-evolution`), porta LAN rimossa, entrambe le direzioni ripuntate sul nome DNS
interno Docker invece dell'IP LAN dell'host. `NOESAR_ALLOWED_HOSTS` di NOESAR ha guadagnato
`noesar-evolution` (il proprio nome, quello che Debug Evolution ora chiama) — altrimenti il
suo stesso anti-DNS-rebinding l'avrebbe rifiutato con 421.

**Bug reale trovato dalla migrazione stessa**: `seedDebugEvolutionTools()` deduplicava per
NOME, quindi i 3 tool già seedati da `D-0278` mantenevano l'endpoint originale per sempre —
ancora puntati alla porta LAN appena chiusa. Fix: riconciliazione dell'endpoint a ogni
boot quando esiste già, non skip silenzioso.

## ➜ Verificato in `D-0281`

| Verifica | Risultato |
|---|---|
| `npm test` (suite completa) | **1408/1409 PASS** (1 skip pre-esistente, +1 nuovo test reconcile) |
| `tools/run-eslint.sh` | **277 file · 0 errori** |
| `scripts/test.sh` (9 step) | **10/10 PASS** |
| LAN port 8787 | connessione rifiutata (chiusa) |
| NOESAR pubblico 8100 | `/livez` 200 (invariato) |
| reachability interna NOESAR→Debug Evolution | `/api/v2/health` 200 |
| reachability interna Debug Evolution→NOESAR | `/livez` 200 |
| relay end-to-end | `/api/v2/uplink` (via NOESAR) → `state:ready`, `base_url` sul nuovo path |
| riconciliazione tool | log `tool_endpoint_reconciled` ×3, stessi id, endpoint aggiornato |
| dati | `migrations:19 rls_tables:18 production_ready:true` invariato |

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-debug-evolution-net-migration` (`D-0281`) ·
  `Up (healthy)` · `192.168.178.100:8100→8088`. Rollback:
  `noesar-evolution.rollback-pre-d0281-reconcile-fix-20260801T001103Z`
  (`:phase4-module-credentials`).
- **`debug-evolution`**: `Up (healthy)`, stessa immagine `1.1.0-noesar-module`, ora su
  `noesar-evolution-net`, nessuna porta pubblicata. Rollback:
  `debug-evolution.rollback-pre-net-migration-20260801T000358Z`.
- **Due container per progetto ciascuno** — §5a rispettato per entrambi.
- **Un tentativo di ricreazione auto-corretto in questa sessione**: env assemblato a mano
  ha omesso variabili richieste (`exposure_scope` finito `loopback` invece di `lan`,
  token vuoto) — scoperto dal log di boot prima che ricevesse traffico, fermato e
  rimosso, rifatto generando l'env dall'inspect del predecessore anziché ritrascriverlo.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`modules-registry.mjs` esiste ancora sul disco, non importato** — scelta deliberata
  (`CLAUDE10.md` regola 12, nessun emendamento richiesto).
- **Lavoro committato in questa sessione**: `D-0273`…`D-0280` (2 commit, s301), `D-0281`
  ancora da committare a fine sessione. Nessun push eseguito.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata
a fine progetto. `oci/Dockerfile`/layer-depth: Thread 2 dell'Owner sotto, ancora aperto,
margine ampio (15/128 layer sul tag corrente).

## ➜ Le domande all'Owner ancora senza risposta

Nessuna nuova.
