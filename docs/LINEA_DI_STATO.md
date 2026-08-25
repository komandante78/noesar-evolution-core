# LINEA DI STATO — NOESAR EVOLUTION e ATOM EVOLUTION

> Misurata il **2026-08-25 (sera)** contro i sistemi vivi: `docker`, i log, il repository, il file
> di stato del prodotto, la suite. Nulla qui è ricordato: tutto è stato letto. Ciò che **non** è
> stato rimisurato in questa sessione porta la data dell'ultima misura vera, invece di essere
> ripetuto come se fosse di oggi.
>
> Documento vivo. Va riletto e riscritto, non accumulato. La versione precedente (10/08) era vecchia
> di quindici giorni e in mezzo il prodotto ha perso la voce, cambiato modello e riacquistato il
> proprio indirizzo: **quasi ogni riga era falsa**, e nessuna lo dichiarava.

---

## 1. In una riga

**NOESAR EVOLUTION è un prodotto funzionante, in produzione, che nessuno tranne il proprietario può
dichiarare pronto** — mancano cinque prove manuali al browser e un pentest di terza parte, non del
codice. **ATOM EVOLUTION è il pezzo che lo distingue** dai concorrenti e gira dentro di esso.

---

## 2. Dove sta il prodotto, oggi

| | Stato misurato |
|---|---|
| Immagine in produzione | **`noesar-evolution:no-voice-20260825T132405Z`**, repo `15280ad` su `origin/main` (allineato) |
| Salute | `healthy`, `/readyz` **200** su http e https, **36 variabili**, IP fisso **`172.22.0.5`** |
| `production_ready` | **`false`** — dichiarato dal prodotto stesso, non da un'opinione |
| Decisioni registrate | **639** voci (`D-0001`…`D-0691`, con **52** numeri senza voce, noti) |
| Verifiche | unit **3037** (3036 pass, 0 fail, 1 skip) · ESLint **0/0/0** su **483** file |
| Verifiche non rimisurate | browser-e2e **472/472**, postgres-integration **60/60**, i18n **COVERED** — misurati il **10/08**, non oggi |

### Cosa gira davvero

| Componente | Stato |
|---|---|
| `noesar-evolution` | il prodotto. HTTP 8100, proxy 8089, **TLS 8443**. ATOM gira **dentro**, su `127.0.0.1:8410`. Indirizzo fisso `172.22.0.5`, **ripinnato oggi** dopo che i redeploy l'avevano perso |
| `atom-evolution-model` | **`qwen2.5-7b-instruct` Q4_K_M**, **4 939 di 12 288 MiB** di VRAM. Sostituisce phi-4, che non sapeva emettere tool call: il vincolo VRAM che decideva tutto il resto **si è dimezzato** ⚠️ **non è pinnato**: sta a `172.22.0.4` per caso, e il prodotto ora lo chiama per nome apposta |
| `noesar-search` | SearXNG ospitato da noi. ⚠️ **non collegato** — manca un passo di sintesi *(stato del 10/08, non rimisurato)* |
| `debug-evolution` + runner | modulo separato, uid 10010, il runner **senza rete** |
| `atomd` | 🛑 fermo **di proposito** da s336 e non rimosso: è il ritorno indietro. Uscito pulito, due settimane fa |
| ~~`noesar-voice-hear`~~ · ~~`noesar-voice-speak`~~ | **non esistono più.** La voce è stata rimossa dal prodotto il 25/08 per ordine esplicito dell'Owner |

---

## 3. La catena che distingue questo prodotto

```
tu scrivi  →  modello locale  →  ATOM controlla e rigenera  →  risposta
                                          │
                                ogni risposta porta il GRADO
                                della propria garanzia, e il
                                grado può solo SCENDERE
```

**Niente in questa catena esce da questa macchina.** È l'argomento del prodotto, ed è verificabile:
il motore di ricerca è nostro, il modello è locale, ATOM è un processo fratello in ascolto su
`127.0.0.1` — quindi **irraggiungibile persino dagli altri container**.

La catena era più lunga: fino al 25/08 cominciava con Whisper e finiva con Kokoro, entrambi nostri.
La voce è stata tolta perché **quello che faceva non era all'altezza dell'argomento** — trascriveva
parole mai dette e le voci italiane disponibili erano povere. Se torna, torna come modulo separato.
L'argomento non è cambiato: è più corto e tutto vero, invece che più lungo e in parte no.

---

## 4. ATOM EVOLUTION — dove sta

Repository **separato** (`/mnt/cachec/ATOM_EVOLUTION`), commit che non si mescolano mai con quelli
di NOESAR. Ultimo: **`7ebec54`**, pushato — **invariato dal 10/08**.

| Traguardo | Stato |
|---|---|
| `A-0026` — l'indirizzo del modello esce dal Rust | chiuso |
| `A-0027` — **il Warrant** | chiuso e **in produzione** (`efc05eff…` dentro l'immagine del prodotto) |
| Calcolo esatto su razionali | `(3/4)+(5/6)` = **`19/12`**, non `1.5833…` |
| Rifiuto invece di invenzione | `1/0` → **REFUSED**; prosa non dimostrabile → **UNSUPPORTED** |
| Test | **162** *(10/08 — non rimisurati: `cargo` non è installato sull'host, servirebbe un contenitore)* |

**Perché conta:** un modello che sbaglia in silenzio e uno che dichiara «non posso garantirlo» sono
due prodotti diversi. ATOM è il secondo.

---

## 5. Cosa manca davvero — in ordine di chi può farlo

### 🔴 Solo l'Owner. Nessuno può farlo al posto suo.

1. **Le 5 voci `AWAITING_OWNER`** del gate di fase 5 — `OWNER_BOOTSTRAP`, `MFA_TOTP`,
   `TOKEN_REUSE_REJECTED`, `STEP_UP_AUTH`, `CLIENT_BROWSER_TEST`. Circa **un'ora al browser**, ed è
   **il vero collo di bottiglia** verso `productionReady`, più del pentest.
2. **Le tre decisioni del punto 7** (multimodale + pseudonimizzazione **reversibile**): dove vive la
   mappa segnaposto→dato reale, chi non deve vederla mai, che fine fa il documento ricomposto.
3. **Schedulare il pentest indipendente** con una terza parte vera. Scope già pronto — e da oggi
   punta di nuovo a un indirizzo che esiste davvero.

### 🟠 Lavoro di progetto, aperto

| Cosa | Perché non è ancora fatto |
|---|---|
| **Punto 7** — multimodale + pseudonimizzazione reversibile | è l'unico punto grosso aperto, e **la parte che claude.ai e ChatGPT non fanno**. Bloccato sulle tre decisioni sopra |
| **SearXNG collegato** | manca un **passo di sintesi** (risultati grezzi → candidati con evidenze tipizzate). È una decisione di progetto, non un adattatore *(10/08)* |
| **Motore CodeN Evolution** | le 5 fasi consegnarono **trasporto + navigazione**; il motore del design canonico non esiste ancora *(10/08)* |
| **`F4W-006`** due archivi di identità | `state/auth.json` è autorevole, `noesar_identity.users` è una proiezione. Convergenza riparata; **il modello dati resta doppio** *(10/08)* |
| **`F-MODEL-001`** | dire chi serve davvero il modello: è **funzionalità nuova**, non una riparazione. Decisione dell'Owner |

### 🟡 Debiti dichiarati, non nascosti

- **`atom-evolution-model` non è pinnato.** Sta a `172.22.0.4` per fortuna, non per configurazione.
  Il prodotto ora lo chiama per nome, quindi non si rompe se si sposta — ma qualunque altra cosa lo
  nomini per indirizzo sì. È la stessa malattia di `F-ROT-001`, non ancora curata alla radice.
- **52 decisioni senza voce** nel log, tutte più vecchie di s335.
- **`B-011`** token in chiaro in `EVIDENCE/` — rotazione rimandata a fine progetto per istruzione
  Owner.
- **`F4W-005`** encoder QR verificato solo per le versioni 1-6; da `D-0372` un URI troppo lungo
  **lo dice** invece di disegnare il vuoto.
- **`F4-013`** il backup completo **non è cifrato** e contiene la chiave maestra — con la mappa del
  punto 7 dentro smetterebbe di essere una nota di documentazione. *(`F4-012` è stato **chiuso** il
  25/08 in `0da3ca9`: il difetto era il messaggio d'errore, non i limiti.)*
- **Backup:** una sola destinazione, passphrase sulla stessa macchina, nessun `sha256` accanto agli
  archivi. Il prodotto vive su **un solo NVMe senza parità**.
- **Deriva** `MASTER_PROJECT/` vs `docs/progetto-italiano/`: 7 file su 14. Scelta di contenuto
  dell'Owner, non un bug.

---

## 6. Cosa è cambiato dal 10/08 a oggi

- **La voce è stata eliminata dal prodotto** (25/08, ordine esplicito dell'Owner): tre moduli
  browser, tre server, quattro rotte, il pacchetto `spoken-intent`, dodici test, i due container.
  Rimosso anche il messaggio di sistema che continuava a dichiarare al modello *«this installation
  can hear the person and speak back»*, letto da variabili sopravvissute al codice.
- **`B-016` chiuso, con una diagnosi diversa da quella scritta:** non mancava `--jinja` — era
  **phi-4 a non saper fare tool call**, per template. Sostituito con `qwen2.5-7b-instruct`, che le
  fa: `finish_reason: "tool_calls"` verificato dal vivo, e ~62 token/s contro ~35.
- **`B-015` chiuso:** origin passato a SSH, 19 commit pushati.
- **`F-ROT-001` chiuso, e anche qui la diagnosi registrata era rovesciata.** Non un allowed-host
  stantio: **l'indirizzo statico perso**. `redeploy.sh` non lo riportava e `docker run` senza `--ip`
  non protesta, quindi ogni redeploy spostava l'installazione in silenzio mentre il SAN del
  certificato, lo scope del pentest e l'allowlist continuavano a nominare `172.22.0.5`. Ora
  l'indirizzo è riportato come ogni altra impostazione del container, `--ip` lo ristabilisce, e
  `--set`/`--unset` permettono di correggere una variabile con un deploy normale invece di
  ricopiarla in avanti per sempre.
- **Il profilo provider locale non mente più:** puntava a `172.22.0.4` cablato a mano e dichiarava
  `phi-4` mentre ne serviva un altro.

---

## 7. La regola che governa il resto

> Il progetto si chiama **NOESAR EVOLUTION**. Ogni cosa va costruita per **evolvere** e nasce
> **dieci passi avanti** alla tecnologia attuale, non al pari. La versione minima che passa non si
> consegna. — *Owner, s340.*
