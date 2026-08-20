# SESSION HANDOFF

**Due fasi in questa sessione.** `D-0604` — `CE-023` misurata e chiusa, verdetto `DIFFERS`;
matrice **65/67**, ratchet **3 → 2**, critical **0**. `D-0606` — la ritenzione del replay store
è collegata, **e collegarla ha scoperto un difetto che avrebbe distrutto `CE-006`**.
Proposto: `D-0605`. **`D-0602` è chiuso.**
**Live installation:** `noesar-evolution:d0601-context-shape-20260820T104316Z`, `running`/
`healthy`, `RestartCount=0`.

## ➜ LA PROSSIMA AZIONE

**C'È UN DEBITO §3a APERTO, ed è la prima cosa da decidere.** `D-0606` è in albero, provato, e
**non installato**: l'installazione viva non ha la superficie `replay.*` e il suo
`referencedDigests()` nomina ancora il campo sbagliato. **Nessun rischio attivo** — sull'immagine
installata `sweep()` non ha chiamanti, che è esattamente perché il difetto era latente — ma il
debito è reale. Il deploy non è stato fatto perché nessuno l'ha autorizzato in questa sessione.

**Se si deploya, §3a 11c non è opzionale e l'ordine È la salvaguardia:** costruire offline →
provare che i byte dell'immagine sono uguali all'albero → fermare con grazia e **leggere** la
chiusura pulita nel log → backup runtime **a servizio fermo** → preservare il predecessore con
nome timestampato → ripartire con la configurazione **riletta dal contenitore che si sostituisce**
→ verificare sul vivo → pulire (§5a). Nessuna migrazione di schema in questa fase.

**Poi restano due caselle senza verdetto, e nessuna è lavoro pronto qui.** `CE-024` chiede il
tempo di revisione umana per cambiamento accettato: **il banco di revisione non esiste**,
chiuderla significa costruirlo. `CE-035` chiede `ssh` + `coden_evolution` da un secondo nodo
reale: serve un VPS col prodotto installato SOPRA, mai questo host esposto a internet; la GPU è
irrilevante (`CE-020` prova che la shell risponde con zero modelli caricati).

**Altro debito, se si preferisce:** `D-0605` (il `expect` di riferimento non ha una guardia per
passo), `D-0589` (provenienza HMAC simmetrica — blocca la posizione 5 di `PKG-001`),
`MANIFEST.sha256` (stale di ~670 file dal `D-0399`, nessun passo della batteria lo verifica).

**Anche aperti:** `D-0564` · `D-0589` · `D-0591` · `D-0593` · `D-0595` · `D-0605` ·
`F-TOOLSCOPE-001`. **`production_ready` resta `false`.**

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`D-0604` — `CE-023` misurata, e la misura non dice quello che ci si aspettava.** Sonda
usa-e-getta dall'immagine viva (`--rm --network none`, tree in sola lettura, `atomd` avviato
dentro la sonda con un token generato lì): produzione non toccata, `docker exec` non usato, token
dell'installazione mai letto. `PER_TASK better=0 worse=1 equal=8 of 9`, `VERDICT=DIFFERS`. Su `T3`
ATOM decompone in **4** passi contro 2, due senza file, e il suo `expect` rifiuta con guardia
**per passo**; il riferimento ha guardia **per piano** e scarta i comandi senza `test`. **Due
contratti di rifiuto diversi**, non «ATOM copre meno». L'aggregato `-0.2615` nasce su denominatori
10 vs 13 ed è **dichiarato artefatto**. Due difetti dello strumento riparati (un `0/n` da rifiuto
era indistinguibile da uno da aspettativa vuota; l'avviso sul denominatore scattava solo sul ramo
`NO_DIFFERENCE`).

**`D-0606` — il difetto che il collegamento ha scoperto, ed è il risultato più importante della
sessione.** `referencedDigests()` costruiva il set vivo da `promptDigest` e **`answerDigest`**. Lo
store contiene invece il prompt e l'**answer record** — `promptDigest` e **`answerRecordDigest`**,
che dal `D-0597` è deliberatamente un'altra cosa. I due **coincidono per una risposta testuale e
divergono per una strutturata**, che è la forma di un provider vero. Un `sweep()` collegato
avrebbe cancellato **la risposta registrata di ogni chiamata strutturata** lasciando il prompt, e
il replay avrebbe risposto `UNRESOLVABLE` mentre il ledger continuava a dirla rigiocabile.
Riparato **nominando entrambi i campi**: le fixture pre-`D-0597` sono nominate da `answerDigest`,
e toglierlo avrebbe scambiato una cancellazione silenziosa con un'altra.

**Costruito sopra la riparazione:** `sweep()` con **dry-run come default**,
`authoringReplayRetention({apply})` sull'orchestratore, due metodi di sessione **bridged**
(`replay.retention` lettura · `replay.sweep` scrittura), due verbi in **entrambe le shell**
(`/retention`, `/sweep`), tradotti, ed evento a ledger `authoring_replay.swept` **solo** per uno
sweep applicato.

**Verificato:** unit **2902** (2901 pass, 1 skip preesistente) · ESLint **463 file 0/0/0** ·
`scripts/test.sh` **18/18** · difetti seminati **19/19 catturati** · matrice PASS, ratchet visto
FALLIRE a 1 · `authoring-replay-retention` **7/7** con **oracolo visto rosso (3 su 7)** ·
`ce-023-projection-coverage-report` **6/6**, oracolo visto rosso · sul vivo `healthy`,
`/livez` e `/readyz` **200**.

## WHAT WAS **NOT** DONE

- **`D-0606` NON è installato** — vedi sopra, è il debito §3a aperto e la prossima decisione.
- **`CE-024` e `CE-035` non toccate.**
- **`D-0605` proposto, non eseguito.**
- **Nessuna prova sul vivo della nuova superficie `replay.*`**: non è installata, quindi non
  esiste lì. Ciò che è provato è provato **in albero**.
- **`/sweep` non è mai stato eseguito con `apply:true` su dati reali** — solo su store temporanei
  nei test. È deliberato: cancella byte che non tornano.
- **Perché `D-0215` (28/07) desse `equal=9 of 9` e oggi `DIFFERS` non è stato stabilito**, e
  `atomd` girava con `simulation=true`, senza modello.
- **HUNT AND FIX: full sweep**, non scoped al diff — un metodo di sessione nuovo è una superficie
  nuova. Strumenti: le suite del repository, `seeded-defect-proof`, `scripts/test.sh`, lettura.
- **`MANIFEST.sha256` non rigenerato**: stale di ~670 file dal `D-0399`.
- **Scansione segreti euristica e dichiarata tale**: né `gitleaks` né `trufflehog` su `PATH`.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato — né `gitleaks` né `trufflehog` sono su `PATH`.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
- **Debito §3a**: `D-0606` in albero, non installato.
