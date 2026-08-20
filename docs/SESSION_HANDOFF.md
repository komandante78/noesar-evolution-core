# SESSION HANDOFF

**Sei fasi in questa sessione:** `D-0594` (`CE-031` ⚠️) · `D-0596` (un byte NUL rendeva
`author.mjs` invisibile a `grep`) · `D-0597` (`CE-006` ✅) · `D-0599` (`CE-030` ✅) · `D-0600`
(`CE-027` ✅, `CE-028` ✅) · `D-0601` (`CE-005` ✅). Ratchet **9 → 3**, critical **0**.
Proposti: `D-0595`, `D-0598`. Bloccato: `D-0602` (`CE-023`).
**Live installation:** ancora **`noesar-evolution:d0590-keyboard-coverage-20260820T050637Z`**,
`running`/`healthy`, **mai toccata in questa sessione**.

## ➜ LA PROSSIMA AZIONE

**IL DEPLOY È PRONTO, PROVATO, E VA LANCIATO DALL'OWNER.** Tutto il preparatorio è fatto e
verificato **oggi**; manca **solo** il comando che muta, rifiutato dal classificatore di permessi
di Claude Code — **non** dal progetto, e nulla è stato toccato:

```
tools/deploy/redeploy.sh --source noesar-evolution --apply --authorized-by-owner \
  --image noesar-evolution:d0600-author-replay-20260820T084734Z
```

L'Owner può lanciarlo col prefisso `!` nella prompt, o aggiungere una regola di permesso Bash.

**Cosa è già provato, e non va rifatto:**

| Passo | Esito, misurato oggi |
|---|---|
| immagine costruita offline dal `oci/Dockerfile` canonico | `noesar-evolution:d0600-author-replay-20260820T084734Z` |
| byte-uguale albero↔immagine | **466/466**, 0 differenti, 0 assenti dall'albero, 2 generati in immagine; `expected from directory COPYs: 448, missing: 0` |
| browser e2e **contro quella stessa immagine** | **0 fallimenti non dichiarati**; l'unico rosso è il gap dichiarato `F-I18N-002`, **invariato a 647** |
| audit di accessibilità, stessa immagine | **27/27**, 0 fallimenti |
| preflight `redeploy.sh --check` | **PASS**, 21 righe su 21 — rollback: rinominare il predecessore e riavviarlo, **porta la configurazione corrente** |

**Dopo il deploy:** verifica viva (`/livez` `/readyz` `/healthz`, `RestartCount`, i 4 figli),
pulizia §5a, e la voce di `docs/INSTALLATION_LEDGER.md`. **Costo di rollback (§3a 11d): nessuno** —
nessuna migrazione in questo rilascio, `MIGRATION_MANIFEST=CURRENT 20 migrations` invariato;
tornare indietro riporta l'installazione senza il byte NUL riparato, senza lo store di replay,
senza il budget di novità e senza il replay di sessione.

**Poi le tre righe rimaste.** `CE-023` chiede **ATOM e il suo token** — `D-0602`, condizione di
stop doppia. `CE-024` chiede di strumentare il banco di revisione. `CE-035` chiede una macchina
**che non è questa**: il VPS senza GPU col prodotto installato SOPRA, mai questo host esposto a
internet — la GPU è irrilevante, `CE-020` prova che la shell risponde con zero modelli caricati.

**Anche aperti:** `D-0564` · `D-0589` (provenienza HMAC **simmetrica**: blocca la posizione 5 di
`PKG-001`) · `D-0591` · `D-0593` · `D-0595` · `D-0598` · `D-0602` · `F-TOOLSCOPE-001`.

**`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Il filo che lega quattro delle sei fasi: un meccanismo che esisteva, collegato a nulla, e un
campo che non poteva dire altro che «va bene».**

- **`D-0594` `CE-031`** — il ✅ nel ledger era stato ottenuto modificando **questo host** (account,
  `sudoers`, `sshd`): vietato al prodotto, irripetibile, cancellato dal `/etc` in RAM. Ora una
  seconda macchina che **misura** il proprio isolamento registra l'Owner col secondo fattore e
  **guida la sessione** sopra il solo TCP (10/10), più 3/3 sull'host a privilegi abbassati.
- **`D-0596`** — **un byte NUL** rendeva `author.mjs` binario per `grep`, che senza `-a` **non
  stampa nulla**: il file spariva da ogni `grep -rn` su `services/` rispondendo «nessuna
  corrispondenza» invece di «non scandito». Riparato **e** la regola (1148 file, vista fallire).
- **`D-0597` `CE-006`** — il record di ogni chiamata al modello era **cinque digest e zero byte**:
  poteva verificare una chiamata rieseguita da altri e non rieseguirne nessuna.
- **`D-0599` `CE-030`** — non un verdetto mancante, **un buco**: l'unico chiamante non passava
  `previousAttemptDigests` né `attempts`, quindi `novelty` valeva `novel` su **ogni run mai
  fatto** e **nessun budget esisteva**.
- **`D-0600` `CE-027`/`CE-028`** — `replay()` diceva `faithful:true` senza guardare i byte. Ora è
  un **AND**. `CE-028` provata su **due repository git veri** con storie opposte.
- **`D-0601` `CE-005`** — misura eseguita: **1188 byte a call 300 e a call 400**, rapporto 300/3 =
  **2,08×** contro il **81,6×** di prima del proiettore, tetto derivato dallo schema 15.198.
  E il test non diceva **dove** la forma si assesta: è la **chiamata 25**, ora asserito.

**Verificato oggi:** `scripts/test.sh` **18/18** · unit **2888/2889** (1 skip preesistente) ·
ESLint **461 file 0/0/0** · browser e2e **0 rossi non dichiarati** · accessibilità **27/27** ·
matrice **64 verdetti su 67**, ratchet visto **FALLIRE a 2** · **sei oracoli visti rossi**.

## WHAT WAS **NOT** DONE

- **Il deploy non è stato eseguito** — preparato, provato, e il comando che muta è stato
  **rifiutato dal classificatore di permessi**. L'installazione viva è **intatta** e `healthy`:
  stesso contenitore, mai riavviato (verificato dopo il rifiuto).
- **`CE-023` non è stata misurata oggi** (`D-0602`): lo strumento **rifiuta ed esce 2** senza un
  provider esterno selezionato, e selezionarne uno significa **ATOM e il suo token** — due
  condizioni di stop. Registrare il verdetto sull'evidenza del `D-0215` (2026-07-28) violerebbe la
  regola 38, ed è esattamente il caso per cui quella regola esiste.
- **`CE-024` e `CE-035` non toccate.**
- **`CE-031` è ⚠️, non ✅:** un altro namespace di rete non è un altro OS, un altro kernel, un
  `sshd` reale né un computer che non è questo.
- **`CE-028` non asserisce che un modello VIVO obbedisca** alle convenzioni che gli si mostrano.
- **La ritenzione dello store di replay non è decisa** (`D-0598`): `sweep()` esiste, è provato, e
  **non è chiamato da nulla**.
- **`MANIFEST.sha256` non rigenerato**: stale di ~670 file dal `D-0399`, nessun passo della
  batteria lo verifica.
- **`D-0595` e `D-0598` proposti, non eseguiti.**
- **Un errore mio:** uno script di sostituzione ha corrotto il **titolo** di `MASTER_PROJECT/16`.
  Ripristinato da git — l'unica modifica non committata era la corruzione — e i verdetti riscritti
  uno per uno.
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
- **`D-0602`**: `CE-023` ferma su ATOM + token.
