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
