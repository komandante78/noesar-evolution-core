# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-27. Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai CodeN Ultra, NOESAR V3,
ATOM o altro dell'host. L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Da `D-0172` impone tre skill sempre attive.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
   L'ordine di lettura alla lettera costa ~400 KB ≈ 100k token; il digest 6,3 KB.
3. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**Fase 1, passo 7 — l'ultimo della fase**: comprensione minima del repository
(`09_PIANO.md` §7): rilevamento linguaggi, punti d'ingresso, indice dei simboli, ricerca
letterale, mappa delle dipendenze. È stata spostata nella fase 1 perché **pianificare la
richiede comunque**, e senza di essa la fase non può superare il proprio criterio di "fatto".

**Poi, e conta più del passo 7**: la fase 1 va **misurata contro il suo criterio**, che è
*«il motore non cambia nulla se non eseguendo un Piano autorizzato»*. Oggi quel criterio è
soddisfatto **dai componenti** e **non dal prodotto**:

- `executorWiredToProductActions = false` — nessuna superficie del prodotto instrada le
  proprie modifiche attraverso l'esecutore
- nessun sottosistema scrive nel registro causale, quindi `chainValid` su una catena vuota
  significa «niente da contraddire», non «tutto verificato»
- il registro dei token e quello degli eventi vivono **in memoria**: un riavvio li azzera

Chiudere quel divario è una decisione di progetto, non un dettaglio: significa scegliere
**quale** superficie del prodotto diventa la prima a cambiare qualcosa solo spendendo un
token. Va posta all'Owner prima di costruirla.

**Build offline Rust**: serve `RUSTUP_TOOLCHAIN` pinnato al toolchain dell'immagine
(`D-0173`) — `rust-toolchain.toml` chiede `stable` e rustup tenta la rete prima di cargo —
**e `conformance/` montata a `/conformance`**, altrimenti i test di conformance Rust non
trovano gli oracoli e falliscono per un motivo che non è il codice.

**Il passo 4 è stato rifatto il 2026-07-27** (`D-0185`, installato `:phase4-cow`): l'ombra è
ora copy-on-write sull'intero workspace, e la metà pericolosa del confronto — *è successo
qualcosa che nessuno aveva dichiarato* — **era strutturalmente vuota** fino a quel momento,
perché `observe()` guardava solo il baseline e il baseline lo forniva il chiamante.

**Due reperti aperti da quella fase, entrambi nominati e non riparati:**

- **`F4-014`** — l'esecutore è **l'unico dei sei passi con due implementazioni e nessun
  oracolo condiviso**: `conformance/executor-vectors.json` non esiste e non è mai esistito,
  benché `executor.mjs` lo affermasse e il MANIFEST portasse una voce a digest **vuoto** per
  un runner Rust mai scritto. I due lati sono retti da test nativi *equivalenti*, che è più
  debole. Costruire l'oracolo è lavoro di una fase propria.
- **`F4-015`** — `shadowStatus()` **scrive** su una **GET**: crea `shadows/` e un file sonda
  a ogni richiesta autenticata di `/api/v1/shadow`. La riparazione è sondare l'antenato
  esistente senza creare nulla, e richiede una ricostruzione.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-cow` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-events-20260727T183606Z` (`:phase4-events`, il predecessore).
Due container di progetto, che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.
Dal vivo: `MECHANISM=REFLINK_CLONE · copyOnWrite=true · measured=true ·
coverage=WHOLE_WORKSPACE`. ⚠️ Il rollback **reintroduce l'`unexpected` strutturalmente
vuoto**: una run dell'esecutore che tocca un file non dichiarato tornerebbe pulita.

## ➜ Cosa è stato fatto in questa sessione

**Fase 1, passi 1-6, tutti costruiti E installati** (`D-0175`…`D-0184`), più la riparazione
del debito che restava aperto.

| Passo | Cosa | Immagine |
|---|---|---|
| 1 | Contratto `ReasoningProvider`, congelato a `1.0.0` | — |
| 2 | Provider di riferimento: undici superfici, nessun modello, nessun ATOM | — |
| — | Il seam nel prodotto, oracolo condiviso Node/Rust | `:phase4-reasoning` |
| 3 | Capability token: un manifest è una richiesta, il motore emette | `:phase4-capability` |
| 4 | Esecuzione in ombra: confronto atteso/reale **a due lati** | `:phase4-shadow` |
| 5 | Esecutore che accetta **solo** token, speso **prima** dell'effetto | `:phase4-executor` |
| 6 | Registro causale: correlazione, causazione, catena di digest | `:phase4-events` |

**Il debito precedente, ripagato prima di costruire**: percorso di release reso eseguibile
offline (`D-0173`, `D-0174`); i report che la catena di provenance pretendeva e **che nessuno
produceva** ora esistono; provenance **firmata** (`PROVENANCE_SIGNED` era `false` dalla
nascita del pacchetto, perché la firma era facoltativa e quindi non la produceva nessuno);
trasporto Windows **rifiutato per nome** invece che per caso; `B-002` chiuso con uno scanner
vero (`D-0177`).

## ➜ I difetti trovati costruendo, non leggendo

1. **Il livello capability si fidava di una dichiarazione.** `reachesOutsideWorkspace` è un
   campo che chi costruisce il piano compila — e il piano arriva **dal corpo della
   richiesta**. Un passo che nominava `../etc/passwd` dichiarandosi contenuto **coniava un
   token**. Ora i percorsi sono ispezionati comunque, su entrambi i lati (`D-0183`).
2. **Il percorso di release non l'aveva mai eseguito nessuno**: tre strumenti lo affermavano
   per corrispondenza testuale. Terza volta in due sessioni per questa classe.
3. **Il verdetto sui test veniva dal chiamante**: `NOESAR_RUST_TEST_REPORT` era un *input*.
   Ora è un **output**, scritto dallo script dall'esito del proprio `cargo test`.
4. **Due difetti erano nella misura, non nel prodotto**: un tetto di confidenza alzato a
   certezza non rompeva nessun test perché l'asserzione era `< 1.0` e le ragioni sottraggono;
   e il primo helper anti-manomissione ricollegava solo i digest precedenti, **lasciando
   passare un payload alterato**. Entrambi riparati con un test che percorre il caso vero.

## ➜ Verifiche prodotte in sessione

```text
unit                  836/836
ESLint                181 file · 0 errori · 0 warning · 0 no-undef
workspace Rust        23 binari · 91 passati · 0 falliti   (offline, --network=none)
browser reale         315/315
accessibilità         27/27 su 27 superfici · 0 fail
difetti seminati      19/19 catturati
vettori condivisi     ragionamento 18 · capability 17 · ombra 10 · eventi 14
                      ognuno eseguito da ENTRAMBI i lati, Node e Rust
conformance autorità  52 check · 0 fallimenti
MANIFEST              5779 voci · 0 mismatch
SOURCE_VERIFY         PASS · 16 migrazioni CURRENT
AUTH_HTTP_SMOKE       PASS   (server reale, con sessione)
secret scan           gitleaks 118 commit · 0 reperti di prima parte
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`executorWiredToProductActions = false`** — l'esecutore esiste, applica i token, e
  **nessuna superficie del prodotto ci passa attraverso**.
- **`executesPlans = false`** — nulla esegue un piano dentro l'ombra: l'osservazione la
  fornisce ancora il chiamante.
- **Registri in memoria** — token ed eventi non sopravvivono a un riavvio. È la direzione
  sicura, ed è **dichiarata dallo stato**, non dedotta.
- **La firma della provenance è simmetrica** (HMAC-SHA256): chi verifica può falsificare.
  `publiclyVerifiable: false` è nel documento. Ed25519 è la strada, non presa perché
  richiederebbe di scrivere la primitiva a mano.
- **Gli `.ps1` sono letti da PowerShell, mai eseguiti** — cmdlet e percorsi solo-Windows.
- **L'ombra non è copy-on-write** — si copiano solo i percorsi che il piano nomina.
- ⚠️ **Tornare a `:phase4-shadow` reintroduce il difetto del flag** (punto 1 sopra).

## ➜ Blocker aperti

- **`B-001`** — nessun remote, nessun commit mai pushato. `gh` non installabile: serve che
  l'Owner crei il repository privato e dia l'URL. **13 commit** in questa sessione.
- **`B-008`** — due store d'identità (`state/auth.json` vs `noesar_identity.users` vuota).
  Migrazione su dati vivi: merita una fase propria e la scelta del modello di arrivo.
- **`B-002`** — **chiuso** (`D-0177`).

## ➜ Le domande all'Owner ancora senza risposta

Poste all'apertura di questa sessione; risposte solo alle prime due (fase 1, e Ricerca
rimandata a dopo la fase 1). Restano: **(3)** rimuovere `apps/webui-react` (serve un
emendamento a `CLAUDE10.md`); **(4)** `B-008`, quale store è la destinazione; **(5)**
`B-001`, si vuole un remote; **(6)** cinque destinazioni dell'interfaccia «da decidere»;
**(7)** conformità della conservazione dei dati delle richieste rifiutate; **(8)** TLS —
il browser scarta `Cross-Origin-Opener-Policy` perché si è serviti in HTTP semplice.
