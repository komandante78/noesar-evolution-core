# Progetto dell'interfaccia — v3, accettata dall'Owner

**Data:** 2026-07-27 · **Stato:** impianto **APPROVATO**, nulla implementato, nulla installato.
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
