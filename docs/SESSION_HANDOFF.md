# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-31 (`D-0272`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008) → B (SESS-001..003) → C (CUBE-001..009) →
> pausa 1 → **decisione WebUI** → pausa 2 → E+F (debito+packaging) → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C, D COMPLETI. Blocco E+F: 3/7 debito chiuso (`D-0271`), il resto sono
> feature nuove nell'ordine deciso dall'Owner: 1) portale di firma ✅ FATTO (`D-0272`,
> questa sessione) → 2) Passkey/WebAuthn → 3) `oci/Dockerfile` → 4) Blocco G. La prossima
> sessione parte dal punto 2.**

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ CINQUE REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted, mai una modifica
   all'host come rimedio.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: ogni fase produce una proposta
   di miglioramento; eseguirla è decisione dell'Owner.
5. **`EXECUTE` è una decisione del CLIENTE** (`D-0250`), **e così è la custodia di una
   chiave di firma release vera** (`D-0271`/`D-0272`): nessuna decisione di sicurezza/
   capacità presa da solo — sempre nominata come domanda per l'Owner, mai inventata.

## ⛔ LA PROSSIMA AZIONE — punto 2: Passkey/WebAuthn

**Ordine deciso dall'Owner (fine s296), invariato**: 2) Passkey/WebAuthn → 3)
`oci/Dockerfile` → 4) Blocco G. **Non saltare l'ordine.**

**Primo passo reale (non ancora fatto)**: leggere cosa esiste già in `auth.mjs`/
`auth-crypto.mjs` (password+TOTP, sessioni, reauth forte) e cosa la matrice di sicurezza
intende per "Passkey/WebAuthn: MISSING" prima di scrivere codice — stessa disciplina di
`D3c`/`D-0271`/`D-0272`: leggere prima, scopare dopo, non assumere.

## ➜ `D-0272` (questa sessione) — cosa è stato fatto

Letto `update-manager.mjs` per primo, come richiesto: il verificatore lato client (channel
metadata + package manifest, entrambi Ed25519) era completo e testato, ma **inutilizzabile
end-to-end** per due motivi meccanici — `installChannelKey()` esisteva sulla classe ma
**nessuna rotta HTTP la chiamava mai** (irraggiungibile fuori da un unit test che
costruisce la classe direttamente), e **nessun tool nel repository poteva produrre** un
artefatto che il verificatore avrebbe accettato.

Costruito: `POST /api/v1/updates/channel-key` (owner+CSRF+strong-reauth, stesso peso di
`apply`) + `tools/sign-update-artifact.mjs` (`keygen`/`sign-metadata`/`sign-package`, le
due forme esatte che `update-manager.mjs` verifica). **Il portale `noesar.com` resta fuori
scope** (`LICENSING_AND_PORTAL_INTERFACE.md` B7, non cambiato) — nominato, non ignorato una
seconda volta.

**Provato dal vivo, non solo a unit test**: `NO_CHANNEL_KEY` prima del pin; dopo
`keygen`+pin, un bundle e una metadata firmati dal tool verificano entrambi; pipeline
completa `check → stage → approve → apply` fino a un nuovo `installedVersion`.

**Incidente auto-corretto durante il deploy**: il primo `docker run` del container nuovo
ometteva l'hardening (`--read-only --cap-drop=ALL --security-opt no-new-privileges:true` +
i due tmpfs) — un `docker run` scritto a mano invece che dal JSON `HostConfig` salvato.
Fermato e rimosso nello stesso minuto, mai servito traffico, ricreato correttamente. Vedi
`docs/INSTALLATION_LEDGER.md` per il dettaglio completo.

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-update-signing-side` (`D-0272`) · `Up
  (healthy)` · `192.168.178.100:8100→8088` · hardening confermato (`ReadonlyRootfs:true
  CapDrop:[ALL]`) · `migrations:19 rls_tables:18`. Rollback preservato:
  `noesar-evolution.rollback-update-signing-side-20260731T074913Z`
  (`:phase4-audit-ledger-perf`).
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Il portale `noesar.com` NON è stato costruito** — resta design-only per decisione
  esplicita precedente (`LICENSING_AND_PORTAL_INTERFACE.md` B7), non per questa sessione.
- **`tools/sign-update-artifact.mjs` non è nell'immagine Docker** — è tooling operatore/
  dev, eseguito contro il repository, non contro il container in esecuzione.
- **La chiave generata da `keygen` è dimostrativa quanto quella SBOM di `D-0271`** —
  nessuna chiave privata è mai stata scritta nel repository o installata come chiave di
  canale reale.
- **`PROJECT_STATE.json.installation`** (il blocco con `image`/`rollback_containers`) è
  stale da diverse sessioni (ferma a `:phase4-webui`) — non è stato toccato in questa
  sessione, non è nel suo scope. Lo stato vero dell'installazione vive nella tabella
  container Docker + qui, non in quel blocco.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0272`

| Verifica | Risultato |
|---|---|
| `node --test` (suite completa) | **1353/1354 PASS** (1 skip pre-esistente, +4) |
| `tools/run-eslint.sh` | **264 file · 0 errori** (+2, i due file nuovi) |
| `scripts/test.sh` (9 step) | **10/10 PASS** |
| `tools/seeded-defect-proof.mjs` | **19/19 catturati** |
| `tools/auth-http-smoke.mjs` / `tools/http-smoke.mjs` | **PASS / PASS** |
| `MANIFEST.sha256` | **5887/5887** (1 hash cambiato, 1 nuova voce) |
| deploy (`updates-channel-key-http.test.mjs`, 4/4) | stop pulito, backup, §5a, hardening ripristinato dopo l'incidente auto-corretto, `Up (healthy)`, byte identici |
| probe live non autenticato | `POST /api/v1/updates/channel-key` → `401` |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna sull'ordine — deciso** (vedi cima file). Domande che nasceranno scoping il
punto 2 (Passkey/WebAuthn) vanno poste quando emergono, non anticipate qui.
