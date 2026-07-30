# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0251`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).

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

**`D-0250` è ora deployato dal vivo (`D-0251`)** — `:phase4-execute-client-decision`,
`Up (healthy)`, `NOESAR_EXECUTE_SANDBOX=disabled` confermato via `docker exec` sul processo
reale. `EXECUTE` è una decisione del cliente, per installazione, reale end-to-end. Nessuna
domanda aperta all'Owner.

**Una scelta aperta e nominata, non urgente**: il mirror Rust di `noesar-executor` per
EXECUTE-abilitato **non è stato fatto**, per decisione di scope esplicita — `noesar-executor`
non è nel percorso live (`services/reference-control-plane` serve ogni richiesta), e aggiungere
un vettore di conformità condiviso per un comportamento che un solo lato implementa avrebbe
tradito la ragione stessa per cui quell'oracolo esiste (`F4-014`). Se si vuole la parità
Rust↔JS per una futura direzione architetturale ("Rust decide e confina"), è una fase propria.
In alternativa: cablare la superficie che potrebbe davvero voler chiedere `EXECUTE` — test
eseguiti in sandbox (`execute()`'s parametro `tests`, già esistente, mai popolato).

**Non rifare**: il probe di `D-0246`, le misure di `D-0248`/`D-0249`, la verifica del
meccanismo JS di `D-0250` (tutte registrate e provate contro il binario reale).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-execute-client-decision` (`D-0251`) ·
  `Up (healthy)` · `192.168.178.100:8100→8088` · hardening intatto ·
  `migrations:16 rls_tables:15` invariate · byte immagine identici.
  Rollback preservato: `noesar-evolution.rollback-execute-client-decision-20260730T104115Z`
  (`:phase4-sandbox-binary`).
- **`NOESAR_EXECUTE_SANDBOX=disabled`**, confermato dal processo reale (`docker exec`).
- **atomd**: `atom-evolution:atomd`, `noesar-evolution-net`. Serve **Phi-4-14B Q4_K_M**.
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`ARCH-008` è ⚠ parziale, per UNA sola ragione ora**: il mirror Rust di EXECUTE non esiste.
  Tutto il resto (ladder adattivo, limiti sotto il MAC, binario spedito, decisione del
  cliente via `NOESAR_EXECUTE_SANDBOX`, wiring reale in `executor.mjs`) è fatto e provato.
- **`ARCH-005` parziale**: solo `launch()` gated; altri 6 adattatori di `03 §4` non esistono.
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

## ➜ Verificato in `D-0250` (misurato in sessione — tabelle di `D-0248`/`D-0249` in
`docs/DECISION_LOG.md`, non ripetute qui)

| Verifica | Risultato |
|---|---|
| unit Node | **1220/1220** (1219 pass + 1 skip onesto, 0 fail) |
| Rust workspace | **47 binari, 135 passati, 0 falliti** (+2: bug `rename_all` trovato e riparato) |
| ESLint | **244 file**, 0 errori |
| `MANIFEST.sha256` | **5857/5857** |
| default EXECUTE | byte-identico a prima di `D-0250` (`EXEC-007` intatto) |
| EXECUTE abilitato, dal vivo (test) | `/bin/echo` gira per davvero attraverso `noesar-sandbox`, `performed:true`, `stdout` catturato; token forgiato → `performed:0` |
| bug trovato | `CapabilityLimits` Rust senza `rename_all=camelCase` — un JSON `memoryBytes` si perdeva silenziosamente a `None`, mai esercitato prima |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.** La domanda di `D-0249` è chiusa da `D-0250`: `EXECUTE` è una decisione del
cliente, per installazione, via `NOESAR_EXECUTE_SANDBOX`.
