# CHIUSURA del 01/09/2026, sera — la FAQ del fondo, e una data che avevo sbagliato io

Questa supera `CHIUSURA_20260901.md` come stato buono. Il dossier è **chiuso alle modifiche**
salvo tre interventi già decisi, e l'unica cosa che blocca l'invio resta il congelamento.

---

## Stato, verificato alla chiusura

| | |
|---|---|
| `HEAD` = `origin/main` | **`f1a39215`** — 6 commit oggi pomeriggio, tutti pushati |
| Albero | pulito (`git status --porcelain` → 0 righe) |
| Suite unitaria | **3164 test, 346 suite — 3163 pass, 0 fail, 1 skip** (erano 3161/345) |
| ESLint 9.39.5 | **494 file, 0 errori, 0 warning** |
| MANIFEST | **6747 file**, completo contro git |
| Container | `running healthy` |
| Registro difetti | **9 righe aperte, nessuna `high`** — invariato |
| Restack | **non ancora aperto**, e l'1/09 questo non significa niente: apre il 3/09 |

---

## 1. La scoperta della giornata, e viene dall'Owner

L'Owner ha letto la FAQ di Restack e ha trovato questo, che il dossier **non aveva mai visto**:

> *«Can I use generative AI to write parts of my proposal — The short answer is: no. Grant
> applications are short and we spend a lot of effort evaluating proposals. Please grant us the
> courtesy of writing the proposal yourself. If you do use generative AI to write (part of your)
> proposal, please put this in the text **and explain why this was necessary**. Failure to do so
> is likely to result in the proposal being rejected, and tarnishing your reputation.»*

**Il dossier aveva letto la pagina sbagliata.** `20_GENAI_DISCLOSURE.md` cita una sola fonte,
`nlnet.nl/foundation/policies/generativeAI/` — permissiva: *«may use... must be disclosed»*. La
FAQ del **fondo** dice «in breve, no» e aggiunge un secondo obbligo. Le due frasi vengono dallo
stesso programma. `04` cita quella stessa pagina FAQ per altre due domande: la pagina era stata
letta, questa risposta non era stata estratta.

**Delle due richieste il dossier ne soddisfa una:** «put this in the text» ✅ con abbondanza;
**«explain why this was necessary» ❌ da nessuna parte**, in nessuno dei 21 file.

E `17_APPLICATION_ANSWER_BANK.md` si presenta da sé come *«Answers meant to be pasted into an
application form»* — cioè il file che diventa la proposta è prosa scritta dall'AI.

## 2. La FAQ letta per intero, riga per riga — cosa ne è uscito

**🔴 Il test che il dossier non affronta.** Dentro la risposta sull'open-core:

> *«If the fate of a certain technology depends on leadership decisions and the internal economy
> of a single commercial entity this should probably not be considered 'sustainably open'.»*

**Verificato assente da tutti i 21 file.** È la domanda più affilata contro questa domanda — un
manutentore, un host, componenti estratti da un prodotto con licenza commerciale e ATOM
proprietario. La risposta **esiste già in `13`** (i quattro deliverable sono *estrazioni* fatte
per sopravvivere al monorepo): va puntata contro questa frase.

**🟡 Materiale favorevole non usato**, dalla stessa risposta:
*«We look at what you research and develop inside the project you propose, **not to anything
else**.»* Dice esplicitamente che ATOM non entra nella valutazione. `04` non ce l'ha e costruisce
da solo un argomento che loro regalano.

**🟠 «Meno di un'ora».** Altrove la FAQ dice *«unlike most procedures you should be able to
complete a proposal in less than an hour»*, e nella risposta GenAI *«Grant applications are
short»*. Tre punti che convergono: **vogliono una proposta corta, scritta a mano.**

**🔵 Fatti di processo, tutti assenti dal dossier:**

| Fatto | Conseguenza |
|---|---|
| **3-5 mesi** per l'esito, *«counted from the date of the deadline»* | scadenza 3/11 → esito ~feb-apr 2027 |
| Ciclo **bimestrale**; programma fino a **maggio 2030** | riprovare costa 2 mesi, non un anno |
| Nessun anticipo: *«divide your project into milestones and allocate an amount to each»* | `08` ha le milestone ma **non gli importi**; `10` ha gli importi. I due non sono uniti |
| Durata di default **12 mesi** | il piano è 7 persona-mesi ✓, ma non è detto |
| *«We cannot make donations for any effort completed prior to the grant»* — ma se completi parti, *«we can discuss replacing those parts with other tasks (rather than reducing the budget)»* | **meglio di come si temeva**: lavorare durante la revisione non punisce |
| *«Just resubmit... this happens all the time»* | correggere una domanda è normale ed economico |

Nota su `21_QUESTION_FOR_NLNET.md`: la FAQ rifiuta i pre-controlli di ammissibilità
(*«Unfortunately, you can't»*) ma chiude con *«My question is not here — let us know»*. La
domanda è di policy, non un pre-controllo: va formulata così.

## 3. Le correzioni al dossier — `1bf64784`, `65e2b354`, `c7acbbd7`

**La cifra che non esisteva.** *«446 commits across 406 files (+62 161 / −13 437)»*, citata in
cinque file, **senza comando registrato da nessuna parte**. Spazzate tutte le coppie `base..end`
della finestra 13/08-02/09: **zero** producono quei numeri. 446 commit è raggiungibile, ma mai
insieme a 406 file o a quelle righe. Sostituita con l'intervallo che la frase stessa definisce,
`03e3a6c3..03e38690` — **433 commit, 413 file, +62 066 / −13 842** — coi due comandi ora in
`16_EVIDENCE_INDEX.md`.

**`20` diceva «twenty files»**, mentre `00` e il glob accanto dicono ventuno.

**`05` diceva «otto» findings aperti**, mentre `12`, `13`, `16` e il registro dicono **nove**:
non aveva mai saputo di `F-WIN-001`, aperto il 31/08. Tolta da `05` la ripartizione duplicata —
due copie sono ciò che l'ha fatta derivare.

**Il pattern, e vale oltre oggi:** tutte e tre — più 68/274-vs-76/291 di stamattina — sono **una
cifra ripetuta a parole in un secondo file invece che citata**. Quando un numero serve in due
posti, il secondo deve **rimandare**.

**La rilettura di Restack** è in `04` e `10`, con la frase FAQ collocata nel punto dove fa
lavoro: è la *ragione* per cui la condizione è sulla dipendenza e non sulla proprietà.

## 4. `packages/sdk` — `a47d5885` e `84844c14`

**L'Apache-2.0 non era un'anomalia** e non serviva nessuna decisione: è nella lista `approved`
di `capabilities/security/license-policy.json`, ogni sorgente ha l'header SPDX, l'inventario la
dichiarava già, e permissiva-sui-contratti è esattamente ciò che `04` dichiara. Mancavano quattro
cose piccole, tutte fatte: il file **`LICENSE`** (copiato da `rust/vendor/anyhow-1.0.104/`),
**`"private": true"`** come i tre fratelli — era l'unico pacchetto che `npm publish` non avrebbe
rifiutato — una **sezione 1a in `docs/LICENSE_STRATEGY.md`** che dica quale cartella non è AGPL e
perché, e la **nota stantia in `tools/generate-inventory.mjs`** che scriveva in ogni inventario
generato che manca una `LICENSE` di radice: esiste dal 14/08 (`D-0453`).

**`F-SDK-001`, aperto e chiuso.** `packages/sdk` è uno **specchio tipizzato** di un contratto che
vive altrove come JSON — nessuno leggeva i due insieme, quindi poteva derivare senza far fallire
niente. Era derivato di **due campi**: `compatibility` e `rollback`. I permessi invece **non**
erano derivati (tutti e 14 esistono vivi: 7 nel catalogo broker, 7 in `policy.py`).

**Il cancello è il punto, non i due campi**: `packages/sdk/test/manifest-contract.test.mjs`,
preso in automatico dal glob `packages/*/test/*.test.mjs` del pre-commit. **Oracolo**: eseguito
prima della riparazione falliva nominando esattamente `compatibility, rollback`.

Non coperto e lasciato all'Owner: le due metà TypeScript e Python descrivono lo stesso manifest
in modo diverso; la metà Python **non è installabile per costruzione**; `capabilities/reference/`
non ha un cancello suo.

## 5. L'errore mio, e va letto perché è lo stesso difetto allo specchio

**Ho creduto per tutto il pomeriggio che fosse il 3 settembre.** L'avevo preso dalla milestone
del piano («3/09 — rileggere Restack»), non da un orologio, e l'ho stampato su **nove file** e
**due messaggi di commit**.

In un dossier la cui disciplina è *«un criterio è un fatto su un programma **in una data**»*,
non è un refuso: è esattamente il difetto che quel dossier dichiara di aver risolto.

Peggio del numero era la **conclusione**: `04` e `10` dicevano che *la data di apertura era
passata senza che il fondo aprisse*, e ci costruivano sopra un ragionamento. **Falso.** L'1/09
l'apertura è ancora a due giorni: un fondo non aperto non dice niente. Ora entrambi registrano
una lettura **anticipata e datata**, dicono che a quel punto un fondo chiuso è atteso e non
informativo, e **programmano la lettura che conterà, il 3/09 o dopo**.

Riparato in `f1a39215`. **I due messaggi di commit restano sbagliati** — la regola 14 vieta di
riscrivere la storia, e un file corretto con un messaggio sbagliato è una bugia più piccola di
un log riscritto. Trovato solo perché alla chiusura ho letto `date` sul Tower invece di fidarmi
della cifra che avevo in testa.

**Regola per la prossima sessione: leggi `date` sul Tower prima di datare qualunque cosa.**

---

## 6. Dove riprendere — l'ordine è concordato

### 🟢 Sbloccato, non serve il modulo — si può fare subito

1. **`04`** — la frase *«not to anything else»* va messa **in apertura**, e il test
   *«sustainably open / single commercial entity»* affrontato di petto.
2. **`13`** — l'argomento delle estrazioni puntato **contro quella frase**.
3. **`10` / `11`** — i fatti di processo (3-5 mesi, bimestrale, 12 mesi), e **unire `08` e `10`
   in uno scadenzario milestone→importo**, che la FAQ richiede esplicitamente.

### 🟠 Bloccato sull'apertura del bando — aspetta loro

4. **Le risposte del modulo le scrive l'Owner**, con le domande vere davanti. `17` diventa la
   fonte dei **fatti**, non delle frasi. La FAQ dice meno di un'ora, ed è ciò che chiude il
   problema GenAI alla radice invece di argomentarci sopra.

### 🔴 Ultima seduta, corta — dopo il punto 4, e blocca l'invio

5. **`20`** cita la FAQ (non solo la policy) e aggiunge la **necessità**, limitata al materiale
   di supporto: un manutentore solo, l'AI usata come **strumento di misura** — è così che sono
   venuti fuori `F-HARD-001`, la cifra irriproducibile e quattro contraddizioni interne.
6. **Congelamento**: rigenera il log → rimisura `20` → invio.

Il 5 non può precedere il 4: la disclosure misura il set consegnato con un `git blame`, e se
`17` viene riscritto la tabella cambia tutta.

**Il costo del congelamento, misurato:** estrazione **0,3 s**, cancello pre-commit **24 s**
(suite 19 + manifest 1 + ESLint 4). La sola parte vera è rimisurare `20`: **30-45 minuti**.
Congelare non è uno stato, è un ciclo da meno di un'ora — quindi si congela **il giorno
dell'invio**, non prima.

**Il log: mancano tre sessioni, non una.** `928db29a` (31/08, 6 prompt — **generò il log stesso**,
quindi non poteva starci dentro), `455f4b23` (1/09 mattina, 38), e questa. Il log committato sta
a 76/291; con le prime due diventa **120/478**. `20` ora lo dichiara in tabella, insieme alla
regola generale: **la sessione che rigenera il log non può stare nel log che genera.**

### 🔵 Indipendente dal bando, e la FAQ incoraggia a farlo

- **Con quale autorità agisce un'esecuzione in background** — `agent-service.mjs:68` e
  `workflow-service.mjs:617`. Due righe, ferme su una decisione dell'Owner.
- **Commissionare il pentest** — unico gate su `productionReady`, tempi esterni.
- Se e quando pubblicare `@noesar/sdk` — **non in questo stato**: metà Python non installabile,
  le due metà in disaccordo. Il candidato pronto all'apertura è `packages/capability-token/`.

---

## 7. Il metodo

Invariato, più due cose imparate oggi.

**Ogni riga si verifica misurandola** — oggi ha trovato una cifra inventata in cinque file, due
contraddizioni interne, due campi persi da un contratto pubblico, e una data sbagliata mia.

**E si misura anche l'ovvio.** La data, l'orologio, il numero che «si sa». Le quattro cose più
imbarazzanti della giornata erano tutte cose che nessuno pensava di controllare.

Dopo ogni modifica `node tools/generate-manifest.mjs`. **Con un file nuovo l'ordine conta**:
`git add -A` → manifest → `git add -A` → commit; il manifest enumera i file *tracciati*.
Se hai toccato un documento con matrice di accettazione, anche `node tools/acceptance-matrix.mjs
extract`. Il deploy lo lancia l'Owner. Comandi per Unraid **nudi**, mai avvolti in `ssh`.
