# Progetto dell'interfaccia — v3, accettata dall'Owner

**Data:** 2026-07-27 · **Stato:** impianto **APPROVATO**. Alla data in cui questa riga fu scritta
nulla era implementato; **il primo dei tre passi della grafica — la struttura — è ora costruito**:
vedi **§22**. Nulla è installato.
**Anteprima navigabile:** `docs/design/ANTEPRIMA_WEBUI_V3.html` (autonoma, si apre in un browser).
**Riferimento visivo:** `docs/design/APPROVED_WEBUI_REFERENCE.png`.
**Riferimento normativo:** `MASTER_PROJECT/07_INTERFACCIA.md`.

> **Lingua.** Questo documento è in italiano come il resto di `MASTER_PROJECT/`. Ricade sotto il
> punto 5 della fase 0 ancora aperto — *traduzione canonica in inglese* — e non è un'eccezione
> nuova alla regola 49.

---

## 1. Che cosa è stato deciso

| | Decisione | Stato |
|---|---|---|
| Nome | Il prodotto interno si chiama **CodeN Evolution**. Il PNG di riferimento resta vincolante su **impianto e colore**, **non** sulle etichette: la sua sesta voce porta un nome che il prodotto ha già rimosso | chiusa |
| Destinazioni | **Undici**, contro le ventitré di oggi | chiusa |
| Impostazioni | **Una sola destinazione**, con **menu dentro il menu** — tre gruppi, quindici voci che oggi occupano la barra | chiusa |
| Barra laterale | Tre stati — completa · icone · via — su `[` e `]`, scelta memorizzata | chiusa |
| Pannello contestuale | Tre stati — agganciato · flottante · via — e **la memoria è per destinazione** | **chiusa oggi** |
| Colore | Nove temi **più** un selettore libero: la persona sceglie qualunque tinta | chiusa |
| Sessioni | Gestione completa (§4) | chiusa |
| Ordine dei lavori | **Prima la grafica, poi si costruisce tutto** | **chiusa oggi** |
| Voce | Disegnata (§6 · IV). **Idea, non ancora una riga di piano** | aperta |
| Installazione | Nessun deploy. Richiede autorizzazione esplicita dell'Owner | aperta |

---

## 2. Le undici destinazioni

```text
  ⌂  Home                        ◈  Conoscenza
  ◗  Chat                        ◍  Agenti
  ⌁  CodeN Evolution             ⇉  Flussi di lavoro
  ▤  CodeN Evolution TUI         ▦  Modelli
  ▢  Progetti                    ⚙  Impostazioni  ← UNA sola
  ▥  Documenti
```

**Una destinazione è un posto dove si decide di andare. Tutto il resto è una sezione dove si
arriva.** Quindici voci cambiano rango — non spariscono: sicurezza, utenti, privacy, audit,
conformità, salute, log, aggiornamenti, backup, licenza, provider, hardware, storage, connettori,
evidenza.

Le ventitré di oggi, per il confronto: `home chat projects tasks documents agents workflows
approvals tools knowledge memory providers models coden hardware settings security users health
updates logs backups about`.

**Progetti, Documenti, Conoscenza e Agenti sono superfici di lavoro, non elenchi.** Ognuna porta la
propria barra di azioni — l'anteprima le disegna.

---

## 3. Impostazioni: menu dentro il menu

```text
IL TUO LAVORO          IL PRODOTTO                IL SISTEMA
  Sessioni               NOESAR Evolution           Modelli e hardware
  Aspetto                Licenza                    Storage e backup
  Lingua                 Privacy e connettori       Audit ed evidenza
                         Persone e accessi          Salute e log
                                                    Aggiornamenti
```

---

## 4. Sessioni — criteri di accettazione

| ID | Criterio | Severità |
|---|---|---|
| `UI-001` | Le **cinque** sessioni attive più recenti sono distese nella sezione | Alta |
| `UI-002` | **Dalla sesta** in poi le attive stanno in un riquadro a scorrimento, con il **conteggio dichiarato sopra** | Alta |
| `UI-003` | Ogni riga porta **Archivia** ed **Elimina** | Alta |
| `UI-004` | Un pulsante apre l'**Archivio** come pagina propria, con ritorno sempre visibile | Alta |
| `UI-005` | L'archivio impagina a **dieci per pagina**, con l'intervallo dichiarato (`11–20 di 31`) | Alta |
| `UI-006` | Ogni riga d'archivio porta **Ripristina** ed **Elimina** | Alta |
| `UI-007` | Selezione multipla con casella «tutte in questa pagina», **contatore delle selezionate** e un solo pulsante di eliminazione | Alta |
| `UI-008` | **Ogni** azione distruttiva o di spostamento chiede conferma. Nessuna eccezione | Critica |
| `UI-009` | La conferma dichiara **che cosa** succede e **a quante** sessioni; l'eliminazione multipla **elenca** i titoli (troncando con «e altre N») | Critica |
| `UI-010` | Nella conferma il pulsante pericoloso **non è mai** quello preselezionato, e `Esc` annulla | Alta |
| `UI-011` | *Archivia* **sposta**, non distrugge: la sessione resta intera e ripristinabile | Alta |
| `UI-012` | *Elimina* manda in un **cestino recuperabile 30 giorni**, e la conferma lo dice | Media |

`UI-012` è un'aggiunta proposta, non richiesta: in uno spazio di lavoro «cancellato per sbaglio» è
l'incidente più comune, e la protezione costa una riga di testo. **L'Owner può toglierla.**

---

## 5. Colore

**La palette è estratta dai pixel del riferimento**, non scelta a occhio: indaco `#3958c3`, verde
`#44a259`, ambra `#c5882c`, viola `#7c56b7`, ciano `#34aace`, fondi `#081018` e `#0c1824`.

| ID | Criterio | Severità |
|---|---|---|
| `UI-020` | Nove temi come **rimappature di token**: accento e tinta dei neutri | Alta |
| `UI-021` | Fra i nove: un tema **chiaro** e uno ad **alto contrasto** | Alta |
| `UI-022` | **Selettore di colore libero**: qualunque tinta scelta dalla persona | Alta |
| `UI-023` | Il contrasto è **misurato mentre si sceglie** e mostrato in cifre | Alta |
| `UI-024` | Una tinta che non regge come testo **non viene rifiutata**: resta l'indicatore, e la variante testuale è **derivata** allontanandosi dal fondo finché non raggiunge 4,5:1 | Alta |
| `UI-025` | I **sette stati semantici** non cambiano significato con il tema, e ognuno porta **glifo + parola** oltre alla tinta | Critica |
| `UI-026` | *Chiaro* e *Alto contrasto* possono spostare la **chiarezza** della tinta semantica per restare leggibili — mai il significato né il glifo | Alta |

### Due misure che correggono un'affermazione precedente

Calcolate sul fondo dei pannelli `#0c1824`, **da rimisurare** con `tools/accessibility-audit.mjs`:

| Tinta | Come riempimento | Come **testo** | Variante testuale derivata |
|---|---|---|---|
| indaco `#3958c3` | 6,2:1 col bianco sopra ✓ | **2,9:1 ✗** | `#6b82d2` → 4,9:1 ✓ |
| viola `#7c56b7` | usabile come indicatore (3:1) | **3,3:1 ✗** | `#9a78d0` → 5,1:1 ✓ |
| verde `#44a259` | — | 5,6:1 ✓ | — |
| ambra `#c5882c` | — | 5,9:1 ✓ | — |
| ciano `#34aace` | — | 6,7:1 ✓ | — |

**Nella v2 dell'anteprima avevo scritto che l'indaco del riferimento non rompe il contrasto.** È
vero solo con il bianco *sopra*. Come testo è sotto soglia esattamente come il viola: non è un
difetto del riferimento, è un uso sbagliato del riferimento. La derivazione di `UI-024` lo copre in
tutti e nove i temi e in qualunque colore scelto.

---

## 6. Perché uno dovrebbe sceglierlo — quattro cose, e i numeri da cui vengono

### I numeri (ricerca di terzi, **non riprodotta qui**)

| | |
|---|---|
| 84% | lo usa quotidianamente |
| 3% | si fida molto di ciò che riceve |
| 66% | «quasi giusto, ma non del tutto» — la frustrazione numero uno |
| 38% | rivedere codice generato costa **più** che rivedere quello di un collega |
| 65% | dei fallimenti degli agenti viene dal **contesto che si degrada**, non dal modello |
| 73% → 33% | rispetto dei vincoli fra il turno 5 e il turno 16 di una sessione lunga |

Fonti: Developer AI Trust Crisis 2026 (byteiota) · AI Code Review Trust Gap (Futurum) · Context Rot
(Morph, Redis) · Agent Context Engineering 2026 (AgentMarketCap) · orchestrazione di agenti vocali
2026 (AssemblyAI). **Valgono come direzione, non come misure di questo prodotto** — la stessa
regola che `D-0110` impone al prodotto vale per il documento che la cita.

**La lettura:** il collo di bottiglia non è più scrivere, è **fidarsi**. E l'ultima riga è la più
importante: più lunga è la sessione, meno il sistema rispetta le regole ricevute.

### Le quattro conseguenze

| | Cosa | Perché non è copiabile |
|---|---|---|
| **I** | **Si promuove un risultato, non si autorizza un'intenzione.** Il lavoro è già girato in ombra: diff vero, test eseguiti, tempo, rischio. Il pulsante dice **Promuovi** | richiede l'esecuzione in ombra prima dell'autorizzazione (`D-0109`) |
| **II** | **Copertura di verifica sempre visibile**: quanto è stato ricalcolato, quanto resta inferenza, e **quali** affermazioni sono rimaste fuori | richiede la verifica per ricalcolo e la copertura obbligatoria (`D-0110`) |
| **III** | **Riavvolgi e rami**: si torna a un punto della sessione e si riparte con una decisione diversa, **senza riesecuzione** | possibile **solo** perché il contesto è una proiezione ricostruita da stato (`D-0107`). Chi ha una trascrizione può soltanto scorrerla |
| **IV** | **La voce come torre di controllo**: dire lo stato senza guardare, e autorizzare a mani libere. Frasi brevi, formato fisso, conferma ripetuta | il vincolo è nostro: **la voce non può allargare l'autorità** — concede solo dentro i limiti già calcolati, revoca sempre ammessa, e se non ha capito ripete invece di indovinare |

**III è la risposta diretta al 73→33%**: un ramo riparte da uno stato ricostruito, non da un
riassunto della conversazione.

**IV resta un'idea.** Il mercato vocale 2026 è fatto di centralini parlato→modello→parlato:
copiarlo non aggiungerebbe niente. La forma qui disegnata è diversa, ma **non è ancora una riga di
piano** e non è stata stimata.

---

## 7. Il costo, dichiarato

Oggi i colori sono **letterali sparsi in ~23 KB di foglio di stile** e non esiste alcun layer di
token: nessuna occorrenza di collasso della barra o di aggancio del pannello in
`apps/webui-static/`. Quindi:

1. i nove temi e il selettore libero **non sono un'impostazione** — sono il layer di token che oggi
   non c'è;
2. cambiare rango a quindici voci **sposta i selettori di tutte le pagine**: i controlli in browser
   e i criteri di accessibilità vanno **rieseguiti**, non riletti;
3. per questo l'ordine deciso è **struttura → token → palette e temi**: ridipingere superfici che
   stanno per essere smontate si paga due volte.

---

## 8. Cosa resta aperto

- **Voce** — decisione dell'Owner se diventa lavoro pianificato o resta un disegno.
- **Installazione** — nulla è deployato; il box vivo gira la build precedente.
- **Rimisura** — tutti i contrasti di §5 sono **calcolati**, non misurati dall'audit del progetto.
- **L'anteprima non è mai stata aperta in un browser su questo host**: non ce n'è uno installato e
  la regola 45 vieta di installarlo. È stata verificata per sintassi (`node --check`), per
  bilanciamento dei tag e sulla matematica del colore, eseguita isolata.

---

## 9. Rilettura contro il riferimento normativo — cosa manca ancora

Fatta il 2026-07-27 **dopo** l'accettazione dell'impianto, confrontando riga per riga
`MASTER_PROJECT/07_INTERFACCIA.md`, `06_CODEN_EVOLUTION.md` §2, la matrice `CE-*` e il PNG
approvato. **L'impianto regge; il dettaglio no.** Niente di quanto segue è stato deciso: sono
buchi, e vanno chiusi prima o durante la costruzione.

### 9.1 · Cinque delle ventitré destinazioni di oggi non hanno una casa dichiarata

La mappa 23 → 11 va **completata per intero**, o qualcosa si perde in silenzio.

| Oggi | Dove va nel disegno v3 |
|---|---|
| home · chat · projects · documents · agents · workflows · models · settings | destinazione omonima ✓ |
| coden | CodeN Evolution + il TUI, nuova ✓ |
| knowledge + memory | **Conoscenza** (i quattro cubi) ✓ |
| providers + hardware | Impostazioni → Modelli e hardware ✓ |
| users | Impostazioni → Persone e accessi ✓ |
| health + logs | Impostazioni → Salute e log ✓ |
| updates | Impostazioni → Aggiornamenti ✓ |
| backups | Impostazioni → Storage e backup ✓ |
| approvals | striscia permanente + storico in Audit ed evidenza ✓ |
| **tasks** | **da decidere** — i compiti *attivi* stanno in Home, ma i **compiti programmati** che `07` §9 mette nella schermata iniziale non hanno posto |
| **tools** | **da decidere** — «strumenti» e «plugin» compaiono nel navigatore del banco (`07` §4), non fra le quindici sezioni |
| **security** | **da decidere** — «sicurezza» è fra le quindici sezioni di `07` §2 ma non ha etichetta nel menu di §3 |
| **about** | **da decidere** — presumibilmente Impostazioni → NOESAR Evolution |
| **conformità** | **da decidere** — nominata fra le quindici, assente da ogni menu |

### 9.2 · Il banco di lavoro è disegnato a metà

`07` §4 lo specifica in dettaglio. Mancano:

- **La riga di stato in fondo al banco** — stadio *n*/16, file toccati, test, warning, processi,
  scostamento dal remoto, token consumati, costo, tempo trascorso, rete, sandbox, **token di
  autorità vivi**. È distinta dalla striscia di approvazione e nell'anteprima **non c'è**.
- **La colonna NAVIGATORE** (progetti, recenti, sessioni, compiti, agenti, strumenti, plugin,
  cronologia, preferiti): assente. Il banco v3 è a due colonne, la specifica ne vuole tre.
- **Schede mancanti** nel banco: anteprima, documentazione, problemi.
- **Il terminale multiplo e persistente** come regione propria: v3 ne mostra uno solo, in linea.
- **Nella colonna AGENTE** mancano: ipotesi ed evidenza, attività degli strumenti, file letti e
  scritti, comandi eseguiti, sotto-agenti.
- **La casella `NON FATTO` dello stadio 16** — obbligatoria per `06` §2, e citata da `15` §12 fra
  le cose che riducono il costo di revisione. **Non è disegnata da nessuna parte.** È una delle
  differenze del prodotto e nel disegno non compare.

### 9.3 · La barra superiore ha perso pezzi rispetto al riferimento approvato

Il PNG porta: ricerca · **progetto** · modello · privacy · **lingua** · **fuso orario** · profilo.
La v3 ha sostituito progetto, lingua e fuso con l'indicatore di copertura. **Regressione**: quei
tre vanno rimessi, la copertura si aggiunge, non li rimpiazza.

### 9.4 · L'accessibilità è dichiarata «requisito di costruzione» e il disegno ne copre due voci su otto

`07` §8. Presenti: tema ad alto contrasto, navigazione da tastiera parziale (`[` `]`).
**Assenti dal disegno:** dimensione del testo regolabile · zoom dell'interfaccia · regioni live che
annunciano l'output in streaming senza inondarlo · riduzione delle animazioni come impostazione ·
localizzazione completa con rilevamento automatico di lingua e fuso e sovrascrittura manuale ·
**layout pronto per lingue da destra a sinistra** · timestamp in UTC resi con identificatori IANA.

Due note che pesano: l'RTL ha già prodotto un difetto reale in una sessione precedente, e i 26
criteri di accessibilità oggi verdi sono stati ottenuti **sull'interfaccia attuale** — la
ristrutturazione li sposta e vanno rieseguiti.

### 9.5 · `CE-020` non è soddisfatto dal disegno

> *Ogni capacità ha una forma da tastiera completa — ogni capacità esercitata dal TUI, senza
> mouse.* Severità **A**.

La gestione delle sessioni (§4) è disegnata **solo a mouse**: archivio, impaginazione, selezione
multipla ed eliminazione non hanno né forma da tastiera né comando nel TUI. O si progettano, o
`CE-020` fallisce sul primo criterio che abbiamo scritto.

### 9.6 · La schermata iniziale è incompleta

`07` §9 chiede sei azioni d'ingresso (apri progetto · clona repository · nuovo progetto · importa
archivio · connetti repository remoto · **riprendi ultima sessione**): nella v3 stanno in Progetti,
non in Home. Mancano inoltre **compiti programmati**, **salute dei servizi** e **strumenti
installati**. Le azioni rapide formulate come obiettivi sono **sei delle dieci** elencate.

### 9.7 · La metrica del prodotto non è raccolta da nessuna parte

`CE-024` e `15` §12: la metrica è il **tempo di revisione umana per cambiamento accettato**. È
l'interfaccia il posto dove quel tempo si misura, e nel disegno **non è misurato**. Un prodotto che
dichiara una metrica e non la raccoglie ha lo stesso difetto di una protezione dichiarata che
nessuno applica.

### 9.8 · Due cose che non sono buchi ma vanno ricordate

- I **pannelli staccabili in finestre proprie** per il secondo monitor (`07` §5) e le **viste a
  schermo intero** del TUI dietro un tasto guida: rimandabili, ma sono nella specifica.
- Il **MANIFEST** non copre questi documenti né `docs/design/` — vedi la nota in
  `docs/SESSION_HANDOFF.md`.

---

# v4 — gli otto buchi chiusi

**Data:** 2026-07-27, stessa giornata. **Anteprima:** `docs/design/ANTEPRIMA_WEBUI_V4.html`
(sostituisce la v3, che resta per confronto). Istruzione dell'Owner: *«prima riscrivere tutto ciò
che manca»*, e la mappa delle cinque destinazioni senza casa **approvata** come proposta.

## 10. Mappa 23 → 11, completa

| Oggi | Dove va | Nota |
|---|---|---|
| home · chat · projects · documents · agents · workflows · models · settings | destinazione omonima | |
| coden | CodeN Evolution **+ TUI** | due destinazioni, tre superfici di conversazione con Chat |
| knowledge + memory | **Conoscenza** | i quattro cubi; la memoria non è una destinazione a parte |
| providers + hardware | Impostazioni → Modelli e hardware | |
| users | Impostazioni → Persone e accessi | |
| health + logs | Impostazioni → Salute e log | |
| updates | Impostazioni → Aggiornamenti | |
| backups | Impostazioni → Storage e backup | |
| approvals | striscia permanente + storico in Audit ed evidenza | |
| **tasks** | **Home** (attivi *e* programmati) + navigatore del banco | `07` §9 chiede i programmati nella schermata iniziale |
| **tools** | **navigatore del banco** (strumenti · plugin) | è lì che si usano, non in una pagina a sé |
| **security** + **conformità** | Impostazioni → **Sicurezza e conformità** (sezione nuova) | erano fra le quindici e non avevano etichetta |
| **about** | Impostazioni → NOESAR Evolution | |

**Nessuna delle ventitré resta senza casa.**

## 11. Il banco di lavoro — criteri

| ID | Criterio | Severità |
|---|---|---|
| `UI-030` | Tre regioni: **navigatore** (dentro il banco), **banco a schede**, **agente** (è il pannello contestuale) | Alta |
| `UI-031` | Navigatore: progetti · recenti · sessioni · compiti · agenti · strumenti · plugin · cronologia · preferiti | Alta |
| `UI-032` | Schede: ombra · editor · diff · test · log · terminale · anteprima · mappa · documentazione · problemi · **chiusura** | Alta |
| `UI-033` | Terminale **multiplo e persistente** come regione propria, non una scheda che sparisce | Alta |
| `UI-034` | Colonna agente: conversazione · piano · **ipotesi ed evidenza** · attività degli strumenti · file letti/scritti · comandi eseguiti · richieste di autorità · sotto-agenti · rischio residuo | Alta |
| `UI-035` | **Riga di stato** propria del banco, distinta dalla striscia di approvazione: stadio · file · test · warning · processi · scostamento dal remoto · token · costo · tempo · rete · sandbox · **token di autorità vivi** | Alta |
| `UI-036` | **Casella `NON FATTO`** nella chiusura: non può essere vuota senza dirlo, porta il rischio residuo e il tempo di revisione | **Critica** |
| `UI-037` | La barra superiore porta ricerca · **progetto** · modello · copertura · privacy · **lingua** · **fuso** · profilo. La copertura si **aggiunge**, non rimpiazza | Alta |

`UI-036` è la più importante e nella v3 non esisteva: un rapporto che elenca solo i successi
insegna a fidarsi in modo uniforme, che è l'opposto di utile.

## 12. Accessibilità — otto su otto

| ID | Criterio | Severità |
|---|---|---|
| `UI-040` | Dimensione del testo regolabile su quattro passi, che scala **tutta** l'interfaccia | Alta |
| `UI-041` | Zoom dell'interfaccia, indipendente dal testo | Alta |
| `UI-042` | Riduzione delle animazioni come **impostazione**, oltre alla preferenza di sistema | Alta |
| `UI-043` | Regione live che annuncia **una sintesi per evento**, non un token per volta | Alta |
| `UI-044` | Lingua e fuso rilevati, **sempre** sovrascrivibili | Alta |
| `UI-045` | Istanti in **UTC**, resi con identificatore **IANA**; pianificazioni espresse con la regola e non con lo scostamento, quindi sicure rispetto all'ora legale | Alta |
| `UI-046` | **RTL**: nessuna proprietà fisica `left`/`right` nel foglio di stile — solo `inline-start` / `inline-end` | **Critica** |
| `UI-047` | Tema ad alto contrasto vero fra i nove | Alta |

**`UI-046` è verificabile meccanicamente, ed è stato verificato**: 0 occorrenze di
`left`/`right`/`margin-left`/`padding-right`/`text-align:left|right` nel CSS del provino. Il rimedio
non è ricordarsi dell'RTL — è rendere impossibile scriverlo male. Un difetto reale di una sessione
precedente nasceva esattamente da un `left:-9999px`.

## 13. Tastiera e TUI — `CE-020`

| ID | Criterio | Severità |
|---|---|---|
| `UI-050` | **Ogni** azione delle sessioni ha una forma da tastiera *e* un comando TUI | **Critica** |
| `UI-051` | La conferma non si salta mai da tastiera: `Canc` **apre il modale**, non elimina | **Critica** |
| `UI-052` | Nel modale `Esc` annulla, `Invio` conferma, e il pulsante pericoloso non è preselezionato | Alta |
| `UI-053` | In RTL la direzione della paginazione **segue la lingua**: «avanti» è `←` | Media |
| `UI-054` | I pannelli dell'agente sono raggiungibili a schermo intero dal TUI (`F1…F9`, `/pannello <nome>`) e la shell porta la **stessa** riga di stato | Alta |

| Azione | Tastiera | TUI |
|---|---|---|
| scorrere · aprire | `↑` `↓` · `Invio` | `/sessioni` · `/sessione <n>` |
| archiviare · eliminare | `a` · `Canc` | `/archivia <n>` · `/elimina <n>` |
| selezionare · tutta la pagina | `Spazio` · `Ctrl+A` | `/seleziona <n…>` · `/seleziona --pagina` |
| archivio · pagina | `→` `←` | `/archivio --pagina <n>` |
| ripristinare | `r` | `/ripristina <n>` |
| confermare · annullare | `Invio` · `Esc` | `[s/N]` |
| cosa non è stato fatto | — | `/non-fatto` |

## 14. La schermata iniziale — completa

| ID | Criterio | Severità |
|---|---|---|
| `UI-060` | Sei azioni d'ingresso: riprendi l'ultima sessione · apri · nuovo · clona · importa archivio · connetti remoto | Alta |
| `UI-061` | **Dieci** azioni rapide formulate come obiettivi, non come funzioni | Media |
| `UI-062` | Compiti **attivi e programmati** insieme, i programmati con la loro regola e il loro fuso | Alta |
| `UI-063` | Salute dei servizi · strumenti installati con provenienza · modelli con provenienza | Alta |

## 15. La metrica del prodotto — `CE-024`

| ID | Criterio | Severità |
|---|---|---|
| `UI-070` | Si misura il tempo fra «risultato pronto in ombra» e «l'umano ha deciso», per ogni cambiamento | **Critica** |
| `UI-071` | Mostrata in Home come tendenza e nella chiusura del singolo cambiamento — mai come voto, sempre come **tempo** | Alta |
| `UI-072` | Un cambiamento **rifiutato** conta come tempo speso: escluderlo sarebbe scegliere il denominatore che conviene | **Critica** |

## 16. Cosa resta aperto dopo la v4

- **Voce** (`D-0123`) — disegnata, non pianificata né stimata.
- **Pannelli staccabili in finestre proprie** per il secondo monitor (`07` §5) — nella specifica,
  rimandabili.
- **Rimisura** — tutti i contrasti restano **calcolati**; i 26 criteri di accessibilità oggi verdi
  valgono sull'interfaccia attuale e vanno rieseguiti dopo la ristrutturazione.
- **Installazione** — nulla di tutto questo è deployato.

## 17. Verifiche della v4

```text
sintassi JS            node --check   OK
tag bilanciati         div 202/202 · span 215/215 · button 57/57 · table 5/5
UI-046 (RTL)           0 proprieta fisiche left/right nel CSS del provino — verificato, non asserito
matematica colore      invariata dalla v3, gia eseguita isolata
```

**Non eseguito:** l'apertura in un browser reale su questo host — non ce n'è uno installato e la
regola 45 vieta di installarlo.

---

# v5 — la destinazione Ricerca

**Data:** 2026-07-27. **Anteprima:** `docs/design/ANTEPRIMA_WEBUI_V5.html`. Richiesta dell'Owner:
una destinazione per la **ricerca sul web** che produca un rapporto raggiungibile da un **link
provvisorio**, con il confronto fra candidati e le ragioni della scelta — e un gate di sicurezza.

## 18. Undici diventa dodici, dichiarato

La ricerca **è** un posto dove si decide di andare, quindi è una destinazione e non una sezione.
Non è stata nascosta dentro un'altra pagina per far tornare il conto: **il numero difeso in
`D-0120` cambia da undici a dodici**, e la decisione è dell'Owner che l'ha chiesta.

## 19. Come si comporta — criteri

| ID | Criterio | Severità |
|---|---|---|
| `UI-080` | La ricerca prende **obiettivo + criteri**, non una stringa: i criteri restano visibili come etichette rimovibili e compaiono come colonne nel rapporto | Alta |
| `UI-081` | Il risultato è un **rapporto**, raggiungibile da un **link provvisorio** con scadenza dichiarata e revoca immediata | Alta |
| `UI-082` | **Il link non è pubblico di suo**: serve una sessione su questa installazione. Condividere fuori è un atto separato, con la propria scadenza e il proprio avviso | **Critica** |
| `UI-083` | Ogni prezzo o dato volatile porta **l'ora in cui è stato letto** | Alta |
| `UI-084` | Le righe del «perché» sono etichettate per tipo: **fatto dalla fonte · aggregato misurato · inferenza · cosa NON è stato verificato** | **Critica** |
| `UI-085` | La **qualità dell'evidenza** è dichiarata per candidato: numero di recensioni, arco temporale, quota da acquisto verificato, e segnalazione della distribuzione anomala | **Critica** |
| `UI-086` | Un candidato scartato dice **perché** — «fuori dal tuo criterio» non è un giudizio di merito | Media |
| `UI-087` | **Nessun link di affiliazione, mai.** Un risultato sponsorizzato è dichiarato sulla sua riga | **Critica** |
| `UI-088` | Il pannello mostra **alla lettera** la stringa uscita; la query è costruita dal motore e nessun contenuto dell'utente vi compare (eredita `CE-014`) | **Critica** |
| `UI-089` | La ricerca è un **egress dichiarato**: lo stato di privacy passa a «rete usata» e il rapporto resta conservato solo qui | Alta |

`UI-085` è la ragione per cui questa superficie vale qualcosa. **Le recensioni si comprano**, quindi
un voto medio non è evidenza. Nell'esempio disegnato il candidato con il voto *più alto* è quello
con l'evidenza *più debole* — 31 recensioni su 38 nella stessa quindicina — e il rapporto lo dice
invece di premiarlo.

## 20. Il gate di sicurezza — criteri

| ID | Criterio | Severità |
|---|---|---|
| `UI-090` | **Nessuna denylist testuale.** Il gate classifica intento ed effetto richiesto — coerente con `D-0111`: una lista di parole è battuta da un sinonimo, un'altra lingua o una perifrasi | **Critica** |
| `UI-091` | **Due porte**: sull'intento **prima** che qualcosa esca, e sul contenuto tornato **prima** di mostrarlo. Un gate solo sull'ingresso è aggirabile da ciò che rientra | **Critica** |
| `UI-092` | **Tre esiti**, non due: procedi · **chiedi** · rifiuta. Con solo sì/no ogni ambiguità diventa un errore in una delle due direzioni. «Chiedi» è lo stesso stadio 3 del ciclo di lavoro | **Critica** |
| `UI-093` | Il rifiuto **nomina la categoria** e dice cosa resta disponibile. Un rifiuto senza nome è indistinguibile da un guasto | Alta |
| `UI-094` | Si rifiutano le **istruzioni operative**, non gli argomenti: normativa, storia, prevenzione, sicurezza sul lavoro e bonifica restano accessibili | **Critica** |
| `UI-095` | Quando il gate rifiuta sull'intento, **nessuna query è emessa** | **Critica** |
| `UI-096` | Il rifiuto è **contestabile**, e la contestazione è registrata | Media |

### Le categorie e chi può cambiarle

| Categoria | Esito | Modificabile da |
|---|---|---|
| **Sfruttamento di minori** | rifiuto assoluto · nessun risultato · nessuna riformulazione suggerita · evento registrato | **nessuno** — non aggirabile da alcun ruolo, Owner compreso |
| Istruzioni per un danno fisico (armi, esplosivi, veleni, incendi) | rifiuto delle istruzioni operative; l'argomento resta | solo con motivazione registrata |
| Danno ad animali | rifiuto delle istruzioni per ferire o uccidere | solo con motivazione registrata |
| Acquisto regolamentato (armi, farmaci, sostanze) | **ristretta**: il prodotto chiede invece di indovinare | impostabile |
| Autolesionismo | risposta di sostegno con contatti, mai istruzioni | impostabile solo verso il più restrittivo |
| Contenuti per adulti | filtrati — **legale ma restringibile**, spento di default | impostabile per installazione e per account |

**La distinzione che regge tutto:** non è l'argomento a essere vietato, è l'**effetto**. Un prodotto
che rifiuta «quali sono le leggi sugli esplosivi» è rotto, non sicuro. «Dove comprare armi» diventa
*requisiti per la licenza*, *armerie autorizzate*, *normativa su trasporto e custodia* — oppure è
rifiutata, se ciò che si cerca è aggirare i controlli.

**Registrazione.** L'evento, la categoria e l'impronta della richiesta vanno nel ledger di audit.
Il testo in chiaro **non** viene conservato, con l'eccezione della categoria più grave, dove la
conservazione è ristretta e dichiarata. Questa è una scelta da confermare con l'Owner e da
verificare rispetto agli obblighi applicabili: **è registrata qui come proposta, non come
conformità accertata.**

## 21. Verifiche della v5

```text
sintassi JS       node --check OK
tag bilanciati    div 254/254 · span 238/238 · button 66/66 · table 7/7 · tr 52/52
UI-046 (RTL)      0 proprieta fisiche left/right — invariato dopo l'aggiunta
```

**Non eseguito:** apertura in un browser reale (nessuno installato, regola 45).

---

# Costruito — passo 1 della grafica: la struttura

**Data:** 2026-07-27. **Ordine vincolato** (`D-0118`): **struttura → layer di token → palette e
temi**. Questo è il primo passo, e solo il primo. Decisioni `D-0137…D-0142`.

## 22. Che cosa esiste ora nel codice

| Cosa | Stato | Dove |
|---|---|---|
| **Dodici destinazioni** nella barra laterale, contro ventitré | costruito | `index.html`, `app.js::ROUTES` |
| **Una sola pagina Impostazioni** con menu dentro il menu, tre gruppi, **tredici sezioni** | costruito | `app.js::SETTINGS_SECTIONS`, `#/settings/<sezione>` |
| Le tredici pagine demosse, **spostate verbatim** e non riscritte | costruito | id originali conservati (`#view-users`, `#view-logs`, …) |
| **Inoltro di ogni vecchio indirizzo** alla sezione che ora lo possiede | costruito | `app.js::LEGACY_ROUTES` |
| I **gate di ruolo** scesi da rotta a sezione, con rifiuto reso dentro Impostazioni | costruito | `app.js::SECTION_ACCESS`, `#settingsDenied` |
| **Barra laterale a tre ranghi** — completa · icone · via — su `[` e `]`, ricordata | costruito | `app.js::initSidebarRank` |
| **Pannello contestuale a tre ranghi** — agganciato · flottante · via — **memoria per destinazione** (`D-0117`) | costruito | `app.js::applyPanelRank` |
| *Compiti* dentro Home · *Strumenti* dentro CodeN Evolution · *Memoria* dentro Conoscenza | costruito | blocchi `.work-block` |
| **CodeN Evolution TUI** e **Ricerca** come destinazioni | **dichiarate, non costruite** (`D-0141`) | pagine che dicono cosa manca |
| Il **gate della Ricerca** (`UI-090…UI-096`) | **non costruito** — e per questo la superficie non esiste (`D-0142`) | nessun campo che possa emettere una query |
| Nove temi, selettore di colore libero, layer di token | **non costruito** — è il passo 2 e 3 | sezione *Aspetto*, dichiarata |
| Gestione delle sessioni `UI-001…UI-012` | **non costruita** | sezione *Sessioni*, dichiarata |

## 23. Verifiche prodotte, tutte eseguite in sessione

```text
unit                     635/635   0 falliti · 44 suite      (erano 631)
guardia di struttura      17/17    0 falliti                 (erano 13)
accettazione in browser  265/265   0 falliti · browser reale  (erano 233)
accessibilita WCAG 2.2    26/26    0 falliti · 25 superfici   (erano 26 su 23 rotte)
eslint                   158 file · 0 errori · 0 warning · 0 no-undef
MANIFEST                5721/5721  0 falliti
difetti seminati           4/4     ognuno catturato da esattamente una guardia
```

**La copertura dell'audit è cresciuta, non calata**: 630 controlli con indicatore di focus e 944
misure di contrasto, su **venticinque** superfici — dodici destinazioni **più le tredici sezioni**.
Auditare le sole destinazioni avrebbe fatto sparire tredici superfici dalla misura lasciando il
numero `26/26` identico: è il modo in cui una ristrutturazione trasforma un audit verde in un audit
più piccolo.

**Non eseguito, dichiarato:** nessuno screen reader reale ha partecipato (l'audit stampa il proprio
blocco `NOT_TESTED` a ogni giro) e `forced-colors` non è emulabile su questo Chromium.

## 24. Cosa resta aperto dopo il passo 1

- **Passo 2 — il layer di token.** Senza, i nove temi e il selettore libero non sono
  implementabili: i colori sono ancora letterali sparsi nel foglio di stile.
- **Passo 3 — palette e temi**, e la **rimisura** dei contrasti di §5, che restano **calcolati**.
- **Il banco di lavoro** (`UI-030…UI-037`), la **casella `NON FATTO`** (`UI-036`, Critica), la
  **metrica del prodotto** (`UI-070…UI-072`) e le otto voci di accessibilità `UI-040…UI-047` che
  non sono strutturali: nessuna di queste è toccata dal passo 1.
- **Installazione:** nulla è deployato. Il box vivo gira `:phase4-wp2`, cioè l'interfaccia a
  ventitré destinazioni.

---

# Costruito — passo 2 della grafica: il layer di token

**Data:** 2026-07-27. Decisioni `D-0144…D-0146`. **Installato** (`:phase4-tokens`).

## 25. Il layer, in sei gruppi

`apps/webui-static/styles.css` non contiene più **nessun** colore letterale fuori da `:root`:
102 token, tutti definiti in un posto solo, raggruppati per ruolo.

| Gruppo | Esempi | A che serve nel passo 3 |
|---|---|---|
| **superfici** | `--surface-root` · `--surface-card` · `--panel` · `--scrim` · `--surface-good-soft` | il tema chiaro le ribalta in blocco |
| **testo** | `--text-primary` · `--text-body` · `--text-on-accent` · `--muted` | la scala di leggibilità, indipendente dall'accento |
| **accento** | `--accent-fill-from` · `--accent-fill-to` · `--accent-link` · `--accent-wash` | è ciò che il selettore di colore libero muove |
| **stati semantici** | `--state-warn-text` · `--state-critical-text` · `--green` · `--amber` · `--red` | `UI-025`: il significato non cambia col tema |
| **linee, bordi e fuoco** | `--line` · `--focus-ring` · `--border-critical` | il fuoco visibile non deve mai dipendere dall'accento scelto |
| **ombre e bagliori** | `--shadow-panel` · `--glow-brand` | l'alto contrasto le azzera |

**La sostituzione è consapevole della proprietà** (`D-0145`): lo stesso `#fff` è
`--text-on-accent` dove è testo e `--surface-inverse` dove è sfondo. Oggi hanno lo stesso valore;
in un tema chiaro non l'avranno, ed è esattamente il motivo per cui sono due nomi.

## 26. Ciò che il passo 2 NON ha cambiato — misurato

```text
superfici 25 · elementi 39.320 · firme 6.133 · tuple di colore cambiate 0
sensibilita provata: 1 token spostato di 1 unita di blu -> 29 firme si muovono
```

I contrasti di §5 restano quelli di prima **perché nessun colore si è mosso**; restano comunque
**calcolati e non rimisurati** per i valori che il passo 3 introdurrà.

## 27. Cosa resta per il passo 3

- I **nove temi** come rimappature di questi token, fra cui uno chiaro e uno ad alto contrasto.
- Il **selettore di colore libero** con contrasto misurato mentre si sceglie e variante testuale
  derivata (`UI-024`).
- La **rimisura** dei contrasti con `tools/accessibility-audit.mjs`, che ora gira su 25 superfici.
- `--violet` è stato **rimosso** perché nulla lo dipingeva (`D-0146`): se il passo 3 vuole un
  viola semantico, lo introduce **cablato**, non dichiarato e basta.

---

# Costruito — passo 3 della grafica: palette e nove temi

**Data:** 2026-07-27. Decisioni `D-0147…D-0151`. **Installato** (`:phase4-themes`).
**Con questo, i tre passi della grafica sono completi.**

## 28. I nove temi

`midnight` (il default) · `slate` · `graphite` · `indigo` · `teal` · `amber` · `violet` ·
**`daylight`** (chiaro) · **`contrast`** (alto contrasto vero). Il default **non ha un blocco**: è
il valore dei token stessi, quindi non può divergere da loro.

Sono **generati** da `tools/generate-themes.mjs`, che conserva il **rango** del default: quale
superficie è più profonda di quale, quale testo è più quieto di quale. `--check` fallisce se i
blocchi sono stale rispetto ai token.

## 29. Il colore libero, e la derivazione

| Criterio | Come è soddisfatto |
|---|---|
| `UI-022` | Selettore di colore **e** campo esadecimale: qualunque tinta |
| `UI-023` | Tre cifre mostrate mentre si sceglie: bianco **sul** colore, il colore **come testo**, e la variante derivata. Il rapporto non viene mai arrotondato *verso* il superamento |
| `UI-024` | Una tinta che non regge come testo **non è rifiutata**: resta il riempimento, e la variante testuale è derivata muovendo solo la chiarezza. Se 4,5:1 non è raggiungibile da quella tinta, **lo dice** invece di lasciarlo intendere |
| `UI-025` | Sette stati, ognuno con **glifo + parola**. Il glifo lo genera il foglio di stile, non il punto di chiamata |
| `UI-026` | Nei temi chiaro e alto contrasto gli stati muovono **solo la chiarezza**, derivata finché reggono |

## 30. Cosa questa fase ha scoperto sullo strumento di misura

**Tre difetti nell'audit**, tutti invisibili finché esisteva un tema solo: fermate di gradiente
trasparenti fuse contro un fondo pagina **scritto a mano**; quel fondo era una **costante presa
dalla cosa misurata**; e un gradiente opaco proprio non fermava la ricerca del fondo. È il
risultato più importante del passo, perché rimette in discussione ciò che si credeva già misurato:
**il `26/26` precedente era in parte fortuna** — la costante coincideva col colore dell'unico tema.

E **due difetti nel prodotto** che gli stessi nove temi hanno fatto emergere: le **parole-chiave**
di colore erano sfuggite al layer di token, e marchio e avatar **ereditavano** il colore del testo
invece di nominarlo.

**Resta aperto:** i valori di §5 non sono più solo calcolati — la ruota delle tinte è ora
esercitata dai test e ogni tema è misurato dall'audit. Restano non testati gli **screen reader
reali** e il rendering `forced-colors`, dichiarati a ogni giro.

---

# Costruito — le parti che la grafica non copriva

**Data:** 2026-07-27. Decisioni `D-0152…D-0160`. **Installato nella stessa fase** (`D-0143`).
La grafica era struttura, token e temi. Questo è ciò che il disegno chiedeva **oltre** ad essa.

## 31. Che cosa esiste ora nel codice

| Criterio | Stato | Dove |
|---|---|---|
| `UI-001…UI-012` **gestione delle sessioni** | costruita | tre posti indirizzabili (`#/settings/sessions/{archived,bin}`), cinque distese + scorrevole col conteggio sopra, archivio a dieci con l'intervallo dichiarato, selezione multipla con contatore, un solo pulsante di eliminazione |
| `UI-008…UI-010` **conferma su ogni azione** | costruita | un componente unico: dice cosa e a quante, **nomina** e tronca con «e altre N», nessun bottone preselezionato, `Esc` annulla |
| `UI-050…UI-053` **forma da tastiera** | costruita **sulla tastiera** | `↑↓` `Invio` `a` `r` `Spazio` `Ctrl+A` `←→` e `Canc` che **apre il dialogo**; la paginazione segue la lingua in RTL |
| `UI-050` **comando TUI** | **aperto** | il TUI è dichiarato-e-non-costruito: i comandi sono mostrati, non raggiungibili |
| `UI-040` **dimensione del testo** | costruita | quattro passi; **45** `font-size` in pixel nudi diventano `calc(var(--text-scale)*Npx)`, guardia inclusa |
| `UI-041` **zoom dell'interfaccia** | costruita | moltiplicatore indipendente sul `body`, così porta con sé gate, toast e conferma |
| `UI-042` **riduzione animazioni come impostazione** | costruita | oltre alla preferenza di sistema, e più forte di essa in entrambe le direzioni |
| `UI-043` **regione live** | costruita | una sintesi per evento; il ramo dello streaming **non annuncia**, ed è una guardia |
| `UI-044` **lingua e fuso rilevati e sovrascrivibili** | già presente, ora **verificato** | rilevamento del browser + preferenza per utente + default del server |
| `UI-045` **istanti UTC con identificatore IANA** | costruita | ogni istante passa da un formattatore solo, che nomina la zona e conserva l'ISO in `title` |
| `UI-046` **RTL senza proprietà fisiche** | **ora vera del foglio spedito** | 14 dichiarazioni convertite alla fonte, blocco di override cancellato, guardia meccanica |
| `UI-047` **alto contrasto** | già costruito (passo 3) | fra i nove temi |
| `UI-030…UI-034` **banco a tre regioni** | costruito | navigatore (9 gruppi) · banco a **undici** schede · colonna agente (9 blocchi, l'autorizzazione dei percorsi è lì perché è una richiesta d'autorità) |
| `UI-033` **terminale persistente e multiplo** | costruito | regione propria, fuori dai pannelli; una guardia fallisce se ci rientra |
| `UI-035` **riga di stato del banco** | costruita | dodici campi, e la riga **dichiara quanti hanno una fonte**: oggi tre |
| `UI-036` **casella `NON FATTO`** | costruita, **imposta dal server** | vuota-e-silenziosa è **rifiutata**; rischio residuo obbligatorio |
| `UI-037` **barra superiore** | completata | fuso e copertura aggiunti; la copertura legge `—` perché nulla ricalcola |
| `UI-070…UI-072` **metrica del prodotto** | costruita | tempo di revisione per cambiamento deciso, **rifiuti inclusi**, tendenza in Home e cifra nella chiusura |

## 32. Verifiche prodotte, tutte eseguite in sessione

```text
unit                       677/677   0 falliti · 48 suite        (erano 648)
guardia di struttura        28/28    0 falliti                   (erano 19)
accettazione in browser    291/291   0 falliti · browser reale    (erano 265)
accessibilita WCAG 2.2      27/27    0 falliti · 27 superfici     (erano 26 su 25)
eslint                     165 file · 0 errori · 0 warning · 0 no-undef
MANIFEST                  5732/5732  0 falliti
difetti seminati            11/11    ognuno catturato da esattamente una guardia
```

**La copertura è cresciuta di nuovo:** l'audit misura ora **27** superfici, perché l'archivio e il
cestino rendono controlli diversi dalla lista di lavoro — auditare la sola lista avrebbe lasciato
due superfici non misurate con il numero ancora all'aria di completo.

**Un'esclusione nuova nell'audit, dichiarata:** i controlli **disabilitati** non sono più contati
dai criteri di fuoco e dimensione. Non sono nell'ordine di tabulazione e non possono ricevere il
fuoco, quindi 2.4.7 non si applica a loro; l'audit stampa **quanti** ne ha saltati, e la suite in
browser prova separatamente che gli stessi bottoni, **abilitati**, mostrano l'anello di fuoco.
Un'esclusione che nessuno conta è il modo in cui un audit verde inizia a valere meno di quel che dice.

**Non eseguito, dichiarato:** nessuno screen reader reale · `forced-colors` non emulabile su questo
Chromium · i comandi TUI di `UI-050` non esistono.

## 33. Cosa resta aperto

- **`UI-050` lato shell** — ogni azione delle sessioni ha una forma da tastiera; il comando nel
  terminale no, perché il TUI non è costruito. `CE-020` resta **non soddisfatto**.
- **La schermata iniziale** (`UI-060…UI-063`): sei azioni d'ingresso, dieci azioni rapide, compiti
  programmati, salute dei servizi e provenienza degli strumenti. Non toccata da questa fase.
- **La superficie della Ricerca** (`UI-080…UI-089`), che richiede **prima** il suo gate
  (`UI-090…UI-096`).
- **Nove campi su dodici** della riga di stato non hanno una fonte, e non l'avranno finché non
  esiste il motore. La riga lo dichiara a ogni giro.
- **Voce** (`D-0123`) e **pannelli staccabili** (`07` §5).

---

# La schermata iniziale — costruita

**Data:** 2026-07-27. Scelta dall'Owner fra le tre cose aperte. Decisioni `D-0161…D-0168`.

## 34. Che cosa esiste ora nel codice

| Criterio | Stato | Dove |
|---|---|---|
| `UI-060` sei azioni d'ingresso | **costruito** — tre agiscono, tre dichiarano cosa aspettano | `entryActions()` in `home-overview.mjs`, rese da `renderEntryActions` |
| `UI-061` dieci azioni rapide come obiettivi | **costruito** — riempiono il campo di scrittura, non spediscono | `QUICK_ACTIONS`, `renderQuickActions` |
| `UI-062` attivi e programmati insieme, con regola e fuso | **costruito** — un pannello, due gruppi che partizionano | `splitTasks()` in `schedule.js`, `renderTasks` |
| `UI-063` salute · strumenti · modelli con provenienza | **costruito** — al rango che il ruolo consente | `summariseServices`/`describeTools`/`describeModels` |

**Una rotta nuova, `GET /api/v1/home`.** Assembla la schermata **lato server**, perché ogni blocco
dipende da cosa quel chiamante può vedere e un browser non può essere incaricato di nascondere
qualcosa a sé stesso. Un blocco negato torna negato **con il permesso che servirebbe**.

**Un modulo nuovo, `apps/webui-static/schedule.js`.** Aritmetica del tempo, pura e provata senza
browser: quadrante+fuso → istante, riconoscimento di un valore senza fuso, e il raggruppamento di
`UI-062`. Sta fuori da `app.js` per la stessa ragione per cui ci sta l'aritmetica del colore.

## 35. Verifiche prodotte, tutte eseguite in sessione

```text
unit                       734/734   0 falliti · 50 suite        (erano 677)
guardia di struttura        35/35    0 falliti                   (erano 28)
accettazione in browser    312/312   0 falliti · browser reale    (erano 291)
accessibilita WCAG 2.2      27/27    0 falliti · 729 controlli    (erano 725 — vedi D-0167)
eslint                     170 file · 0 errori · 0 warning · 0 no-undef
MANIFEST                  5737/5737  0 falliti · 0 duplicati
difetti seminati            19/19    ognuno catturato da esattamente una guardia
```

**Caccia con gli strumenti reali** (`noesar-debuglab`, avviato e rifermato nella stessa fase):
`services/…/src` **0 finding**, `test/` **0 finding**, `apps/webui-static` **due** — un
`Object.assign` su un `Error` appena costruito, preesistente e scartato con la riga alla mano, e un
`unsafe-formatstring` **mio**, vero e riparato: il valore digitato dall'utente stava in posizione di
stringa di formato in un `console.warn`, e un input contenente `%s` avrebbe consumato l'argomento
successivo. `tools/` riporta gli stessi 12 finding di prima in due strumenti Python non toccati da
questa fase e non eseguibili su questo host.

## 36. Cosa resta aperto dopo la schermata iniziale

- **La superficie della Ricerca** (`UI-080…UI-089`), che richiede **prima** il suo gate
  (`UI-090…UI-096`). Non toccata.
- **`UI-050` lato shell** — il TUI non è costruito, `CE-020` resta non soddisfatto.
- **Tre delle sei azioni d'ingresso** non possono agire finché non esiste l'esecutore. La schermata
  lo dichiara a ogni giro, e il numero è nel payload.
- **Nove campi su dodici** della riga di stato del banco restano senza fonte.
- La **provenienza di chi ha registrato uno strumento** non è sul record: sta nel registro di audit.
  Portarla sul record sarebbe un cambio di schema, quindi un costo di rollback, per un campo che
  esiste già altrove.
