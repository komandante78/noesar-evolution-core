# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0252`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008 + pulizia matrice) → B (SESS-001..003) →
> C (CUBE-001..009) → pausa 1 → decisione WebUI → pausa 2 → E+F (debito+packaging) →
> pausa 3 → G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> Questo blocco A, appena iniziato: `D-0252` fatto, `ARCH-008` Rust mirror ancora da fare.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

**Unica eccezione documentata (`D-0232`)**: il peso `phi-4-Q4_K_M.gguf` è stato **letto**
(copia read-only) su istruzione diretta dell'Owner che l'ha nominato.

## ⚠️ QUATTRO REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
   Prima di dichiarare un gap non risolvibile: `find docs/ MASTER_PROJECT/ -newer <ultimo letto>`.
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted su qualunque
   PC/server/OS. Una modifica all'host non è mai un rimedio. Capacità rilevate a runtime,
   degradate a una base che funziona ovunque, dichiarate per installazione.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: chiudere un criterio è la soglia,
   non l'obiettivo. Ogni fase produce una proposta di miglioramento. Generarla è obbligatorio;
   eseguirla nella stessa fase è decisione dell'Owner.
5. **`EXECUTE` è una decisione del CLIENTE, non mia (Owner, `D-0250`, verbatim: "FAI MODO CHE
   IL CLIENTE POSSA DECIDERE")**: `NOESAR_EXECUTE_SANDBOX`, default `disabled`, per
   installazione. Non riproporre "abilitalo di default" né "rifiutalo per sempre" — è già
   risolto come config.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — il digest, non i file interi.
3. `find docs/ MASTER_PROJECT/ -newer docs/SESSION_HANDOFF.md`.
4. Questo file, «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**Blocco A del piano multi-fase, in corso.** `D-0252` fatto e deployato: `ARCH-005` ridotto al
suo gap reale (`VectorStoreAdapter` no pluggable surface, `ObjectStoreAdapter` capacità
mancante, `HostBridgeAdapter` già coperto altrove). **Prossimo passo dichiarato: `ARCH-008`, il
mirror Rust di `noesar-executor` per EXECUTE-abilitato** — non è stato fatto in `D-0250` per
decisione di scope esplicita (`noesar-executor` non è nel percorso live, `services/
reference-control-plane` serve ogni richiesta; un vettore di conformità condiviso per un
comportamento che un solo lato implementa tradirebbe la ragione per cui l'oracolo esiste,
`F4-014`). Poi: pulizia matrice di accettazione per gli ID chiudibili di riflesso, poi Blocco B
(`SESS-001..003`).

**Non rifare**: il probe di `D-0246`, le misure di `D-0248`/`D-0249`, la verifica del
meccanismo JS di `D-0250`, l'audit dei tre adapter di `D-0252` (tutte registrate e provate).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-arch005-manifest-precision` (`D-0252`) ·
  `Up (healthy)` · `192.168.178.100:8100→8088` · hardening intatto ·
  `migrations:16 rls_tables:15` invariate · byte immagine identici.
  Rollback preservato: `noesar-evolution.rollback-arch005-manifest-precision-20260730T111600Z`
  (`:phase4-execute-client-decision`).
- **`NOESAR_EXECUTE_SANDBOX=disabled`**, confermato dal processo reale (`docker exec`, ereditato
  invariato da `D-0250`/`D-0251`).
- **atomd**: `atom-evolution:atomd`, `noesar-evolution-net`. Serve **Phi-4-14B Q4_K_M**.
- **Due container per progetto** — §5a rispettato.
- ⚠️ **Lezione operativa da `D-0252`**: ricostruire `docker run` da un sottoinsieme di campi
  `HostConfig` letto a mano (invece del JSON completo) ha causato un crash-loop transitorio
  (`Tmpfs` di `/run` omesso — `EROFS`). Mai più: leggere SEMPRE `docker inspect --format
  '{{json .HostConfig}}'` per intero, non i singoli campi che sembrano rilevanti.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`ARCH-008` è ⚠ parziale, per UNA sola ragione ora**: il mirror Rust di EXECUTE non esiste.
  Tutto il resto (ladder adattivo, limiti sotto il MAC, binario spedito, decisione del
  cliente via `NOESAR_EXECUTE_SANDBOX`, wiring reale in `executor.mjs`) è fatto e provato.
- **`ARCH-005` parziale, ma per un motivo preciso ora (`D-0252`)**: `launch()` gated;
  hardware-probe/sector-modules/compliance-packs hanno manifest espliciti a `operations:[]`
  (codice reale, zero operazioni privilegiate, non un buco); vector-store/object-store/
  host-bridge non hanno voce (nessuna superficie pluggable / capacità mancante / già coperto).
- **`INST-002`**: nessun token di installazione — nessuna superficie lo richiede.
- **`SESS-001..003` e `CUBE-001..009`**: due sottosistemi interi mai costruiti.
- **`NOESAR_LOCAL_MODEL_RUNTIME=disabled`** e **`NOESAR_EXECUTE_SANDBOX=disabled`** sul
  container vivo — nessuno dei due gate ha ancora qualcosa che li attraversi in produzione
  (nessuna superficie chiede `launch()`, nessun piano emette mai un passo `EXECUTE`).
- **`MANIFEST.sha256` non copre `.claude/` né `CLAUDE10.md`**, nessun tool lo verifica —
  proposta di miglioramento registrata in `D-0247`, non riparata.
- **Bug menu "Ramo"** (`D-0235`): mai riprodotto, resta aperto.

## ➜ Blocker aperti

`B-002` (low): né `gitleaks` né `trufflehog` installabili (regola 45); scan euristico
dichiarato tale. Nessun altro.

## ➜ Verificato in `D-0252` (tabelle di `D-0248`/`D-0249`/`D-0250` in `docs/DECISION_LOG.md`, non ripetute qui)

| Verifica | Risultato |
|---|---|
| unit Node | **1222 tests, 1221 pass, 1 skip onesto, 0 fail** (+2 su `D-0251`) |
| ESLint | **244 file**, 0 errori |
| `MANIFEST.sha256` | **5858/5858** (2 hash file sorgente + 1 hash doc dimenticato al primo giro, poi corretto) |
| byte-identità pre-deploy | `docker cp` + `diff` su entrambi i file cambiati, confermata prima del deploy |
| deploy live | stop pulito (`postgres.stopped clean:true`), backup 12,5 MB, §5a rispettato, `Up (healthy)`, `/livez`/`/readyz` 200, hardening+`migrations:16 rls_tables:15` invariati |
| `GET /api/v1/adapters` senza sessione | `401` — invariato, i nuovi manifest non allargano l'auth della route |
| difetto auto-corretto | crash-loop transitorio da `Tmpfs` omesso nella ricostruzione — vedi nota in "Stato dell'installazione" |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.** La domanda di `D-0249` è chiusa da `D-0250`: `EXECUTE` è una decisione del
cliente, per installazione, via `NOESAR_EXECUTE_SANDBOX`.
