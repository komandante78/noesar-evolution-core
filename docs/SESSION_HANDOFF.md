# NOESAR EVOLUTION — Session Handoff

**Riscritto alla fine di ogni fase. Una sessione fredda deve poter ripartire da questo file e
da `PROJECT_STATE.json` soltanto.**

---

## 🛑 REGOLA ZERO — un solo progetto esiste

**Ordine esplicito dell'Owner, 2026-07-26.** Lavorando qui, l'unico progetto che esiste è
**NOESAR EVOLUTION**. Nessun altro sistema di questo host si nomina, si cita, si confronta o si
tocca — non come riferimento, non come esempio, nemmeno "solo per contesto". Scritta in
`CLAUDE10.md` §1 e in cima alla skill, perché veniva letta e poi aggirata.

**CodeN Evolution è un prodotto nuovo** e non eredita nome, codice, architettura o convenzioni da
nessun altro.

**Tutto ciò che sta fuori da `PROJECT_ROOT` è in sola lettura.** Una richiesta di cancellare
artefatti di altri progetti è un **blocker**, non un compito.

## ➜ IL PROGETTO DI RIFERIMENTO È `MASTER_PROJECT/`

Deciso dall'Owner il 2026-07-26. Il metro non è il master V4: è la **riscrittura**.
`MASTER_REFERENCE/` è stata rimossa dall'albero — eccezione nominata, registrata in
`CLAUDE10.md` §1a e `D-0097`, recuperabile su tre percorsi con le prove in
`EVIDENCE/v4_removal_recovery_20260726T163433Z.txt`. **Non reintrodurla come metro senza una
nuova decisione dell'Owner.**

## ➜ Leggi in quest'ordine

1. `PROJECT_STATE.json` e questo file
2. **`docs/WEBUI_DESIGN_V3.md`** — il progetto dell'interfaccia, completo e autorizzato, **più
   `§22-33`, che dicono cosa di esso è ora costruito.** §1-9 la v3 · §10-17 la v4 · §18-21 la v5
   (destinazione Ricerca e il suo gate) · §22-24 la struttura · §25-27 i token · §28-30 i nove
   temi · **§31-33 le parti che la grafica non copriva**. Criteri `UI-001…UI-096`
3. `MASTER_PROJECT/07_INTERFACCIA.md` — il riferimento normativo dell'interfaccia
4. `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` (matrice `CE-001…CE-024`) ·
   `MASTER_PROJECT/09_PIANO.md` §1 e §3 · `docs/WORK_PLAN_V5_REWRITE.md`
5. `docs/DECISION_LOG.md` (ultime: **`D-0152…D-0160`**), `docs/INSTALLATION_LEDGER.md`

---

## ➜ LA PROSSIMA AZIONE

> **L'interfaccia è ora la parte più completa del progetto. Il motore non esiste ancora.**

Restano aperte tre cose, in ordine di dipendenza. **Nessuna è iniziata.**

**(a) Fase 0, punti 5 e 6** — traduzione canonica in inglese di `MASTER_PROJECT/` (regola 49) ed
emendamenti registrati a `V4-D001` / `V4-D002` (`GAP-F`: il prodotto e i documenti che lo governano
dicono cose diverse e nulla registra quale dei due debba muoversi). Il punto 5 dipende dal punto
**4** — le domande dell'Owner sui contenuti — che risulta ancora *in attesa*: tradurre prima
significa tradurre due volte. **Il punto 6 è un atto di governo, fattibile subito.**

**(b) Ciò che dell'interfaccia resta scoperto**, ora molto meno di prima:

- la **schermata iniziale** (`UI-060…UI-063`) — sei azioni d'ingresso, dieci azioni rapide
  formulate come obiettivi, compiti programmati con la loro regola e il loro fuso, salute dei
  servizi e provenienza di strumenti e modelli
- la **superficie della Ricerca** (`UI-080…UI-089`), che richiede **prima** il suo gate
  (`UI-090…UI-096`): costruire la superficie per prima significherebbe consegnare una via d'uscita
  verso la rete senza nulla che la classifichi
- `UI-050` **lato shell** — ogni azione delle sessioni ha una forma da tastiera, il comando nel
  terminale no, perché il TUI è dichiarato-e-non-costruito. **`CE-020` resta non soddisfatto**
- **nove campi su dodici** della riga di stato del banco non hanno una fonte, e non l'avranno finché
  non esiste il motore. La riga lo dichiara a ogni giro

**(c) La fase 1, la spina dorsale** — `ReasoningProvider`, capability token, esecuzione in ombra,
esecutore che accetta solo token, registro eventi, comprensione del repository. Rust dalla prima
riga, su un host senza toolchain Rust. **È il lavoro grande**, ed è quello che trasformerebbe metà
delle caselle vuote di questa interfaccia in caselle piene.

**Regola in vigore** (`D-0143`, `CLAUDE10.md` §3a): **si costruisce, si installa e si verifica nella
stessa fase.** Le suite vanno lanciate con `NOESAR_E2E_BASE_IMAGE=noesar-evolution:phase4-parts`.

---

## ➜ Cosa è stato fatto in questa sessione

**Le parti dell'interfaccia che il disegno chiedeva e la grafica non copriva** — sessioni,
accessibilità non strutturale, metrica del prodotto, banco di lavoro — costruite, **installate e
verificate sull'installazione viva**.

### 1 · Le sessioni, e un cestino che mantiene la promessa che fa

Tre posti e non sono lo stesso posto: lista di lavoro, archivio, cestino — ognuno con un indirizzo
proprio (`#/settings/sessions/archived`), perché una «pagina» che non si può collegare, ricaricare o
raggiungere col tasto indietro è un pannello che indossa la parola. Archiviare **sposta**; eliminare
va in un cestino che tiene **trenta giorni**.

**La scadenza è calcolata, non è un contrassegno** (`D-0152`): un contrassegno andrebbe spazzato, e
un contrassegno non spazzato è una sessione che *sembra* viva dopo la fine del periodo. Passata la
data non è elencata **né ripristinabile**, che la spazzata sia girata o no. E la sparizione è
totale: una sessione nel cestino esce **da ogni altra superficie**, non solo dalla pagina che l'ha
eliminata — è un test a sé, perché è la scorciatoia che un'implementazione frettolosa prende.

**La conferma è un componente** (`D-0154`), non un'abitudine: dice cosa succede e **a quante**, per
più di una le **nomina** e tronca con «e altre N». Il fuoco non parte da nessun bottone, e la
ragione è una contraddizione vera fra due criteri — `UI-010` vieta di preselezionare il pulsante
pericoloso, `UI-052` vuole che `Invio` confermi. Il fuoco sul **dialogo** soddisfa entrambi.

### 2 · Dimensione del testo e zoom sono due cose diverse, e si vedono muovere

`--text-scale` moltiplica **ogni** dimensione del foglio: le **45** `font-size` in pixel nudi sono
diventate `calc(var(--text-scale)*Npx)`. Un solo pixel nudo sarebbe un difetto **invisibile** —
l'interfaccia cresce attorno a un'etichetta rimasta indietro. `--ui-zoom` muove tutto, ed è sul
`body` perché porti con sé gate, toast e **la conferma**: uno zoom che si ferma alla shell lascia
alla dimensione originale l'unico dialogo che chiede della distruzione.

**Misurati in browser vero**, non asseriti: 38px → 49,4px per il testo, 44px → 58px di altezza resa
per lo zoom. Una preferenza che memorizza e non muove nulla è il niente più convincente che esista.

### 3 · L'RTL riparato alla fonte, e un criterio Critico che diventa meccanico

`UI-046` diceva *«nessuna proprietà fisica nel foglio di stile»* ed era vera **del provino**, non
del foglio spedito: quattordici dichiarazioni fisiche erano rimaste, ognuna *corretta dopo* da un
override direzionale. Funzionava — ed era ricordarsi dell'RTL invece di renderlo impossibile da
scrivere male. Ora le dichiarazioni fisiche **non esistono** e il blocco di override è **cancellato
con loro**: un override per una proprietà che non c'è più è una regola su cui nessuno può ragionare.
Il criterio è ora **verificato da una guardia**.

### 4 · La metrica che il prodotto accetta di farsi misurare — rifiuti inclusi

`UI-072` è Critica e vive nel codice: `record()` prende la decisione e **non filtra mai** su di
essa. Escludere i rifiuti sarebbe scegliere il denominatore che conviene — la revisione è avvenuta,
i minuti sono stati spesi, e «no» è esattamente l'esito che un utensile degno di fiducia deve saper
riportare.

**Il bordo sinistro dell'intervallo viaggia dentro la risposta dell'API** (`readyDefinition`). Nel
disegno finito è «il giro in ombra ha prodotto un risultato»; l'ombra non esiste in questo build,
quindi è l'istante in cui l'approvazione è stata sollevata. Un numero la cui definizione sta altrove
è un numero che verrà citato senza.

### 5 · La casella `NON FATTO`, imposta dal server

`UI-036`, Critica. Tre stati e quello di mezzo non è ammesso: elencati · nulla **e dichiarato** ·
nulla **e silenzio → RIFIUTATO**. Un rapporto che elenca solo i successi insegna una fiducia
uniforme, che è l'opposto di utile; una casella semplicemente vuota è indistinguibile da una che
nessuno ha guardato. Anche il rischio residuo è obbligatorio: «nessuno» è una risposta, il silenzio
no. E un contrassegno «nulla rimasto indietro» **non può contraddire il proprio contenuto**.

### 6 · Un banco che ammette quello che non sa

Tre regioni, undici schede, un terminale che è una **regione** e non una scheda che sparisce. La riga
di stato ha dodici campi e **dichiara quanti hanno una fonte in questo build: tre** (`D-0160`). Il
lettore non può altrimenti sapere quale metà credere. Per la stessa ragione la pastiglia **Coverage**
legge `—`: una copertura di verifica inventata sarebbe il numero più dannoso del prodotto, visto che
il suo scopo è dire quanto ci si può fidare.

**Una rotta nuova**, `GET /api/v1/coden/authorisations`: le autorizzazioni di percorso venivano
**scritte e mai rilette**, quindi «token di autorità vivi» era un campo senza sorgente.

### 7 · Difetti trovati — e la maggior parte erano miei

1. **Collisione di nomi reale.** «Sessione» significa due cose in questo prodotto: l'accesso e il
   lavoro. Il mio `renderSessions` collideva con quello che elenca le **sessioni di accesso**, e il
   suo parametro avrebbe **oscurato** il mio stato globale. Rinominato il mio, non il suo, con la
   nota sul perché.
2. **`ESLint no-undef` ha pagato di nuovo**, contestando `HTMLButtonElement`.
3. **Mio, trovato dall'audit:** un bottone del terminale a **22px**, due sotto il minimo di 24 — il
   tipo di miss che leggere il CSS non trova.
4. **Mio, nella suite in browser:** la creazione delle sessioni mandava l'header CSRF
   *convenzionale* invece di quello che il prodotto legge, quindi **sette scritture rispondevano
   403** e la superficie non aveva niente da mostrare: un difetto dell'harness che imita
   perfettamente un difetto del prodotto.
5. **Mio, di nuovo nella misura:** `.page-title` risolveva a una sezione **nascosta**. Un controllo
   falliva per la ragione sbagliata, e l'altro sarebbe passato misurando qualcosa che nessuno vede.
6. **Mio, e il più istruttivo:** il controllo dell'anello di fuoco falliva mentre il prodotto era
   corretto. Chromium concede `:focus-visible` per **modalità d'ingresso**: dopo un click un
   `focus()` programmatico non mostra nulla. Ora il bottone si raggiunge con un **Tab vero** — la
   stessa lezione che un evento di tastiera sintetico aveva già insegnato a questo progetto.
7. **Limite dello strumento, non del prodotto:** l'audit contava i controlli **disabilitati**, che
   non sono nell'ordine di tabulazione e non possono ricevere il fuoco. Esclusi — ma l'esclusione è
   **dichiarata** (l'audit stampa quanti ne salta) e **coperta** (la suite prova che gli stessi
   bottoni, abilitati, mostrano l'anello). Un'esclusione che nessuno conta è il modo in cui un audit
   verde inizia a valere meno di quel che dice.
8. **Incoerenza di stato trovata verificando gli input:** `PROJECT_STATE.last_commit` nominava un
   commit **non raggiungibile** — la fase precedente aveva scritto lo stato e poi emendato il
   commit. Riparata l'istanza, e **la regola**: il commit di testa si registra in un commit
   successivo, mai con un emendamento.

## ➜ Verifiche prodotte in sessione

```text
unit                       677/677   0 falliti · 48 suite        (erano 648)
guardia di struttura        28/28    0 falliti                   (erano 19)
accettazione in browser    291/291   0 falliti · browser reale    (erano 265)
accessibilita WCAG 2.2      27/27    0 falliti · 27 superfici     (erano 26 su 25)
eslint                     166 file · 0 errori · 0 warning · 0 no-undef
MANIFEST                  5733/5733  0 falliti
difetti seminati            11/11    ognuno catturato da esattamente una guardia
```

**La copertura è cresciuta di nuovo**: l'audit misura **27** superfici, perché archivio e cestino
rendono controlli diversi dalla lista di lavoro.

**Caccia con gli strumenti reali** (`noesar-debuglab`, avviato e **rifermato nella stessa fase**):
`services/…/src` **0 finding**, `test/` **0 finding**, `apps/webui-static` **1 MEDIUM** — un
`Object.assign` su un `Error` appena costruito, per attaccargli stato e correlation id: falso
positivo, codice preesistente, scartato con la riga alla mano. `tools/` riporta **12 finding**,
tutti in due strumenti Python **non toccati da questa fase** e non eseguibili su questo host
(nessun `python3`): invocazioni `subprocess` con argomenti fissi e un `import` inutilizzato.
**Registrati, non riparati** — una riparazione che non posso provare non è una riparazione.

**Non eseguito, dichiarato:** nessuno screen reader reale (l'audit stampa il proprio blocco
`NOT_TESTED` a ogni giro) · `forced-colors` non emulabile su questo Chromium · i quattro passi
Python di `scripts/test.sh` (`python3` assente, regola 45) · i comandi TUI di `UI-050`, che non
esistono.

## ➜ L'installazione — SOSTITUITA E VERIFICATA

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-parts
bind        192.168.178.100:8100 -> 8088   (LAN, NON loopback — vedi nota)
endpoint    livez 200 · readyz 200 · metrics 401 (hardening LAN intatto)
dati        postgres 18.4 · pgvector 0.8.5 · 16 migrazioni · 15 tabelle RLS
            identity projected=1
interfaccia app.js · index.html · styles.css byte IDENTICI al repository
rotte nuove /sessions · /metrics/review-time · /closures · /coden/authorisations
            tutte 401 senza sessione, contro 404 su una rotta inesistente
igiene      due soli container noesar-evolution* · reti e volumi invariati
            37 container non del progetto prima e dopo · nessun prune
```

**Nota verificata di nuovo qui:** l'installazione **non** ascolta su `127.0.0.1`. Un controllo di
salute contro il loopback restituisce `000` e sembra un servizio morto mentre il servizio è sano.
Usare l'indirizzo di bind reale, che si ricava con `docker port noesar-evolution`.

**Cosa NON è stato verificato dal vivo, e va detto.** Il *comportamento* dell'interfaccia non è
esercitato su questa installazione (§3a, `11e`): le suite creano un Owner, creano sessioni e ne
eliminano, quindi girano contro una sonda usa-e-getta. Dal vivo è provato che i byte serviti sono
**identici** all'albero che quelle suite hanno esercitato, che il servizio è sano e che le rotte
nuove esistono e sono protette.

## ➜ ⚠ Rollback — questa volta ha un costo, ed è dichiarato

`AI_STATE_VERSION` passa da **2 a 3** (`reviewSamples`, `closures`, e i due campi delle sessioni).
La migrazione c'è, è testata, e la catena gira **1 → 3 in una lettura sola**.

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-themes-20260727T110341Z
```

**Controllare prima `state/ai-workspace.json`.** Finché legge `"schemaVersion": 1` — come al momento
di scrivere questa riga, verificato tre volte — tornare indietro è **solo** riavviare il vecchio
container. Se legge `3`, va ripristinato anche `state/` da
`BACKUPS/runtime_pre_parts_deploy_20260727T110330Z/` (75 MB, preso a servizio fermo), o
`:phase4-themes` **rifiuterà di caricare il workspace AI**: il suo validatore pretende
corrispondenza esatta e un file dal futuro viene rifiutato invece che indovinato.

Per tornare indietro sul **sorgente** basta ricopiare da
`BACKUPS/webui_missing_parts_20260727T101551Z/`, che contiene i file dell'interfaccia, del control
plane, le suite e il MANIFEST come erano prima di questa fase.

## ➜ Blocker aperti

`B-001` nessun remote GitHub (nessun commit è mai stato pushato) · `B-002` secret scan euristico
(`detect-secrets` restituisce 0 finding su una chiave AWS letterale) · `B-008` due store di
identità.

**Aperto e non risolvibile qui:** la **conformità** della conservazione dei dati delle richieste
rifiutate. L'Owner ha autorizzato il **disegno** (`D-0136`); la verifica rispetto agli obblighi
applicabili non è stata fatta e non è accertabile su questo host.

**Aperto e non pianificato:** la **voce** (`D-0123`) e i **pannelli staccabili** su secondo monitor
(`07` §5).

**Osservazione registrata e non riparata:** il browser **scarta** l'intestazione
`Cross-Origin-Opener-Policy` che il server invia, perché si è serviti in HTTP semplice su un nome
che non è `localhost`. Vale anche per l'installazione viva in LAN. Richiede TLS — decisione di host
e di fase d'installazione.
