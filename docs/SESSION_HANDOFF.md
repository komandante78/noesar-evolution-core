# SESSION HANDOFF

**Phase:** `D-0588` — «i cinque archivi» nominava due cose; una lista sola, due istanze.
Matrice **66 → 67** criteri (`PKG-001`, verdetto ❌ onesto), **unstated fermo a 11, critical 0**.
`D-0589` proposto.
**Live installation:** unchanged — `noesar-evolution:d0586-induced-facts-and-spaces-20260819T180231Z`,
`running`/`healthy`. **This phase installed nothing**: documents, one new verifier, no shipped
code path touched.

## ➜ LA PROSSIMA AZIONE

```text
node tools/verify-acceptance-matrix.mjs   ->  67 criteri, unstated 11, critical 0
node tools/verify-five-archives.mjs       ->  PASS  (25 file, 10 menzioni, 0 ambigue)
```

**Le 11 righe senza verdetto sono le stesse di prima — `PKG-001` non le tocca**, perché è nata
con un verdetto. Nessuna delle 11 è a buon mercato, e questo è misurato, non ipotizzato. Tre
classi; la prossima fase dica quale prende:

- **(a) serve un banco che non esiste** — `CE-005` (il contesto alla chiamata *n* > 300 ha la
  forma della chiamata 3) · `CE-006` (ogni chiamata al modello rieseguibile isolata).
- **(b) serve una seconda macchina** — `CE-031` `CE-032` `CE-035` (raggiungibilità `ssh` e
  portabilità dell'avviatore). **Non chiudibili onestamente su questo host solo**: dichiararlo
  è la risposta giusta, approssimare un verdetto di portabilità è il falso PASS della regola 38.
- **(c) serve prodotto non costruito** — `CE-023` · `CE-024` · `CE-027`/`CE-028`/`CE-030`.

**`CE-020` sta da solo** (ogni capacità ha una forma da tastiera completa): l'unico le cui parti
forse esistono già — `tools/tui-fullscreen.mjs`, `test/ce-020-tui-fullscreen.test.mjs`.
**Scoparlo prima**: elencare le capacità, vedere quali non hanno percorso da tastiera.

**Anche aperti:** `D-0564` (la testa del registro eventi è un hash senza chiave: rileva una
modifica, non una riscrittura), `D-0589` (la provenienza è firmata **HMAC simmetrico**, quindi
non verificabile da un auditor indipendente — blocca la posizione 5 di `PKG-001`),
`F-TOOLSCOPE-001`.

**`production_ready` resta `false`.** 11 righe senza verdetto, e `PKG-001` a ❌.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**«I cinque archivi» era leggibile in due modi opposti, e la lista non esisteva.** Otto punti
dell'albero dicevano *cinque archivi* / *five ZIPs* intendendo **due artefatti diversi**: il
pacchetto V4 **ricevuto e sigillato** (fuori dal repository, regola 34) e il pacchetto che questo
progetto deve **produrre**. `MASTER_PROJECT/` non le enumerava affatto — l'unica enumerazione era
nella documentazione V4, rimossa dal `D-0097`. L'ultima clausola del "fatto" del prodotto era una
frase senza contenuto leggibile.

Adesso: **una lista sola, in `MASTER_PROJECT/09_PIANO.md` §4a**, con il contenuto di ognuna delle
cinque posizioni; ogni punto che governa dice **quale istanza** intende o punta lì; e
`tools/verify-five-archives.mjs` — nella batteria, `scripts/test.sh` — tiene l'unica copia e
**prova che coincide con i cinque nomi incisi nei nomi degli archivi sigillati**.

**Correzione a una skill, non solo ai documenti.** `engineering-depth` §8 passo 12 diceva che i
cinque di consegna erano *«a different five, unrelated»* ai cinque sorgente. Misurato: portano
**gli stessi cinque titoli**. Rispondere a una collisione di nomi con «sono liste diverse» era un
secondo errore sopra il primo.

**Verificato in questa sessione:** guard visto **FALLIRE su 6 difetti reali** prima della
correzione, e visto fallire di nuovo apposta rinominando la posizione 2. Unit **2860/2861**
(1 skip preesistente), ESLint **454 file 0/0/0**, `SOURCE_VERIFY=PASS`, matrice **PASS**.

## WHAT WAS **NOT** DONE

- **`PKG-001` è ❌ e resta ❌.** Questa fase ha chiuso il **contenuto** del criterio, non il
  criterio: nessun archivio di consegna è mai stato prodotto. Non contarla come progresso verso
  la consegna — è progresso verso il *poterla misurare*.
- **`docs/progetto-italiano/` non è stato toccato**, e porta tre delle stesse righe ambigue. È
  uno **specchio stantio** di `MASTER_PROJECT/` (7 file su 14 divergono, già registrato in
  `docs/COSA_MANCA.md:167`), e `docs/DECISION_LOG.md:5992` dice che **quale dei due sia canonico
  non è deciso**. Allinearlo qui avrebbe preso quella decisione in silenzio. Il guard lo esclude
  **per nome, con la ragione scritta nel codice**, non per dimenticanza.
- **Gli 80 report sotto `docs/` non sono sorvegliati dal guard**, per scelta: una regola che
  cercasse una formulazione approvata in ogni report sorveglierebbe la prosa, non la sostanza —
  la ragione per cui `D-0531` rifiutò un hook per la riga del finanziamento. Sorvegliato è ciò
  che **governa**: `MASTER_PROJECT/`, `CLAUDE10.md`, le skill (25 file).
- **`CLAUDE10.md` non è stato modificato.** La regola 34 dice già *«five **source** ZIP
  archives»*: è già disambigua, e emendare il file d'autorità è dell'Owner, non di una fase.
- **Nessuna suite browser/accessibilità, nessun T2, nessun T3.** Nessun markup, DOM, token CSS o
  percorso di prodotto è cambiato. `MANIFEST.sha256` non aggiornato: è lo snapshot d'estrazione
  della fase 1, nessun passo della batteria lo verifica, e non elenca gli strumenti recenti.
- **`D-0589` proposto, non eseguito.**

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato in questa sessione — **né `gitleaks` né `trufflehog`
  sono su `PATH`**, quindi la scansione è stata **euristica e dichiarata tale**. La premessa che
  il blocker registra come "falsa" è tornata vera; va richiuso o riscritto.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner,
  backup bundle preso.
