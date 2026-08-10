# LINEA DI STATO — NOESAR EVOLUTION e ATOM EVOLUTION

> Misurata il **2026-08-10 (s340)** contro i sistemi vivi: `docker`, i log, i byte serviti, il
> database, `PROJECT_STATE.json`. Nulla qui è ricordato: tutto è stato letto. Ciò che non è stato
> verificato in questa sessione è marcato **`[UNVERIFIED]`**.
>
> Documento vivo. Va riletto e riscritto, non accumulato.

---

## 1. In una riga

**NOESAR EVOLUTION è un prodotto funzionante, in produzione, che nessuno tranne il proprietario può
dichiarare pronto** — mancano cinque prove manuali al browser e un pentest di terza parte, non del
codice. **ATOM EVOLUTION è il pezzo che lo distingue** dai concorrenti e gira dentro di esso.

---

## 2. Dove sta il prodotto, oggi

| | Stato misurato |
|---|---|
| Immagine in produzione | **`d0373-voice-conversation`**, repo `6732b5e` su `origin/main` |
| Salute | `healthy`, `/readyz` 200 su http e https, 44 variabili, IP fisso `172.22.0.5` |
| `production_ready` | **`false`** — dichiarato dal prodotto stesso, non da un'opinione |
| Decisioni registrate | **329** (`D-0001`…`D-0373`, con 51 numeri più vecchi senza voce, noti) |
| Verifiche | unit **2372** (0 fail) · ESLint **0/0/0** su 388 file · browser-e2e **472/472** · postgres-integration **60/60** · i18n **COVERED** |

### Cosa gira davvero

| Componente | Stato |
|---|---|
| `noesar-evolution` | il prodotto. HTTP 8100, proxy 8089, **TLS 8443**. ATOM gira **dentro**, su `127.0.0.1:8410` |
| `atom-evolution-model` | **phi-4 Q4_K_M**, 10 353 di 12 288 MiB di VRAM — è il vincolo che decide tutto il resto |
| `noesar-voice-hear` | Whisper `small` su GPU, 412 MiB, ~1,8 s. **Sente davvero** |
| `noesar-voice-speak` | Kokoro-82M su CPU **di proposito** (la VRAM è finita). RUNE=`im_nicola`, ESTRELA=`if_sara` |
| `noesar-search` | SearXNG ospitato da noi, 30 risultati veri. ⚠️ **non collegato** — manca un passo di sintesi |
| `debug-evolution` + runner | modulo separato, uid 10010, il runner **senza rete** |
| `atomd` | 🛑 fermo **di proposito** da s336 e non rimosso: è il ritorno indietro |

---

## 3. La catena che distingue questo prodotto

```
tu parli  →  Whisper (nostro)  →  modello  →  ATOM controlla e rigenera  →  risposta  →  Kokoro (nostro)
                                                      │
                                            ogni risposta porta il GRADO
                                            della propria garanzia, e il
                                            grado può solo SCENDERE
```

**Niente in questa catena esce da questa macchina.** È l'argomento del prodotto, ed è verificabile:
il motore di ricerca è nostro, la trascrizione è nostra, la sintesi vocale è nostra, il modello è
locale, ATOM è un processo fratello in ascolto su `127.0.0.1` — quindi **irraggiungibile persino
dagli altri container**.

---

## 4. ATOM EVOLUTION — dove sta

Repository **separato** (`/mnt/cachec/ATOM_EVOLUTION`), commit che non si mescolano mai con quelli
di NOESAR. Ultimo: **`7ebec54`**, pushato.

| Traguardo | Stato |
|---|---|
| `A-0026` — l'indirizzo del modello esce dal Rust | chiuso |
| `A-0027` — **il Warrant** | chiuso e **in produzione** (`efc05eff…` dentro l'immagine del prodotto) |
| Calcolo esatto su razionali | `(3/4)+(5/6)` = **`19/12`**, non `1.5833…` |
| Rifiuto invece di invenzione | `1/0` → **REFUSED**; prosa non dimostrabile → **UNSUPPORTED** |
| Test | **162** |

**Perché conta:** un modello che sbaglia in silenzio e uno che dichiara «non posso garantirlo» sono
due prodotti diversi. ATOM è il secondo.

---

## 5. Cosa manca davvero — in ordine di chi può farlo

### 🔴 Solo l'Owner. Nessuno può farlo al posto suo.

1. **Le 5 voci `AWAITING_OWNER`** del gate di fase 5 — `OWNER_BOOTSTRAP`, `MFA_TOTP`,
   `TOKEN_REUSE_REJECTED`, `STEP_UP_AUTH`, `CLIENT_BROWSER_TEST`. Circa **un'ora al browser**, ed è
   **il vero collo di bottiglia** verso `productionReady`, più del pentest. Due su cinque sono già
   state esercitate di fatto stanotte durante il primo avvio.
2. **Le tre decisioni del punto 7** (multimodale + pseudonimizzazione **reversibile**): dove vive la
   mappa segnaposto→dato reale, chi non deve vederla mai, che fine fa il documento ricomposto.
3. **Schedulare il pentest indipendente** con una terza parte vera. Scope già pronto.

### 🟠 Lavoro di progetto, aperto

| Cosa | Perché non è ancora fatto |
|---|---|
| **Punto 7** — multimodale + pseudonimizzazione reversibile | è l'unico punto grosso aperto, e **la parte che claude.ai e ChatGPT non fanno**. Bloccato sulle tre decisioni sopra |
| **SearXNG collegato** | manca un **passo di sintesi** (risultati grezzi → candidati con evidenze tipizzate). Provato: collegarlo così darebbe **502 alla prima ricerca**. È una decisione di progetto, non un adattatore |
| **Motore CodeN Evolution** | le 5 fasi consegnarono **trasporto + navigazione**; il motore del design canonico (sessione come unità di stato, `expect` obbligatorio, token di autorità, ciclo a stadi) **non esiste ancora** |
| **`F4W-006`** due archivi di identità | `state/auth.json` è autorevole, `noesar_identity.users` è una proiezione. In s340 la divergenza ha impedito al prodotto di riavviarsi (`D-0371`). Riparata la convergenza; **il modello dati resta doppio** |

### 🟡 Debiti dichiarati, non nascosti

- **51 decisioni senza voce** nel log (`D-0108`…`D-0151`, `D-0304`…`D-0316`, `D-0325`, `D-0327`) —
  tutte più vecchie di s335.
- **`B-011`** token in chiaro in `EVIDENCE/` — rotazione rimandata a fine progetto per istruzione
  Owner.
- **`F4W-005`** encoder QR verificato solo per le versioni 1-6; da `D-0372` un URI troppo lungo
  **lo dice** invece di disegnare il vuoto.
- **`F4-012`** limite di 48 MiB non raggiungibile via API JSON · **`F4-013`** il backup completo
  **non è cifrato** e contiene la chiave maestra — con la mappa del punto 7 dentro smetterebbe di
  essere una nota di documentazione.
- **Backup:** una sola destinazione, passphrase sulla stessa macchina, nessun `sha256` accanto agli
  archivi. Il prodotto vive su **un solo NVMe senza parità**.
- **Deriva** `MASTER_PROJECT/` vs `docs/progetto-italiano/`: 7 file su 14. Scelta di contenuto
  dell'Owner, non un bug.

---

## 6. Cosa è cambiato in s340

Quattro decisioni, tutte deployate:

- **`D-0370`** — la voce era morta per **chiunque** dal login: chiesta al server due istruzioni
  prima che l'autenticazione esistesse, 401, e mai più richiesta.
- **`D-0371`** — 🛑 **il prodotto non poteva più riavviarsi** da s339: la proiezione dell'identità
  sbatteva su `users_username_key`. Trovato mandando giù la produzione, **~7 minuti**.
- **`D-0372`** — il microfono si chiude da solo, e una trascrizione che il motore stesso ha
  dichiarato degenerata (`compression_ratio 26.2`) **non viene più consegnata come parlato**.
- **`D-0373`** — parlare è un **turno**, non dettatura: va al modello e torna a voce, con la
  finestra mobile che mostra lo **spettro della risposta**, mai la voce di chi parla.

---

## 7. La regola che governa il resto

> Il progetto si chiama **NOESAR EVOLUTION**. Ogni cosa va costruita per **evolvere** e nasce
> **dieci passi avanti** alla tecnologia attuale, non al pari. La versione minima che passa non si
> consegna. — *Owner, s340; scritta nelle skills, non solo qui.*
