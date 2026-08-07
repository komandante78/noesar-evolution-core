# NOESAR EVOLUTION — cosa manca da fare

**Documento vivo.** Scritto a fine s332 (2026-08-07) su richiesta dell'Owner. Misurato contro
`PROJECT_STATE.json`, `docs/OPEN_FINDINGS.tsv` e l'installazione viva, **non** contro il
riassunto in `CLAUDE.md` — che era incompleto: diceva che restava «solo il pentest esterno»,
e non è vero.

**Scope:** NOESAR EVOLUTION soltanto. ATOM EVOLUTION fa parte di NOESAR EVOLUTION (da repo
separato, decisione Owner s302). **Debug Evolution è un prodotto separato e NON entra qui**
(decisione Owner s311).

**Stato al momento della scrittura:** repo `6f09d06` = `origin/main`, immagine
`noesar-evolution:d0347-declared-gaps-closed`, tre livelli identici, 5/5 container healthy.
Unit 2041 (0 fail), ESLint 0/0, e2e browser 413/413.

---

## 0. PRIMA COSA: cosa verificare dal vivo

L'Owner ha detto che alla prossima sessione verifica dal vivo prima di decidere. Questa è la
lista di cosa è stato consegnato in s332 e come controllarlo. **Niente qui richiede di
scrivere codice** — sono controlli.

### 0.1 L'accesso — le tre vie

| # | Cosa provare | Come | Cosa deve succedere |
|---|---|---|---|
| 1 | **Browser** | apri `http://192.168.178.100:8100/` da qualunque dispositivo | la pagina carica, `200` |
| 2 | **La pagina di installazione della CLI** | `http://192.168.178.100:8100/cli` | testo che nomina **prima** il browser, poi i comandi con l'impronta |
| 3 | **L'installatore, dall'URL** | vedi blocco sotto | installa `coden_evolution` in `~/.local/bin`, senza `root` |
| 4 | **La parola** | `coden_evolution` | `attaching via …` → `Connected — protocol noesar-tui/1` → chiede il codice di aggancio |
| 5 | **Disinstallare** | `install.sh --uninstall` | rimuove, e **dice cosa NON ha disfatto** |

```sh
curl -fsSLO http://192.168.178.100:8100/cli/install.sh
curl -fsSL  http://192.168.178.100:8100/cli/install.sh.sha256   # confronta, poi:
sh install.sh
coden_evolution
```

> **Se durante la prova gira una e2e**, `coden_evolution` esce `4` e nomina due installazioni:
> la sonda e2e porta la stessa label del prodotto. È **corretto** (due match si nominano, non
> si indovinano), non è un guasto.

### 0.2 Che l'host non sia stato toccato

```sh
ls /etc/sudoers.d/          # solo coden-evolution, dalla ricetta §12.3 di s331
sha256sum /etc/ssh/sshd_config
tail -5 /var/log/noesar-coden-access.log   # deve dire "launcher already matches the running image"
```

L'installatore non scrive **nulla** fuori dalla tua home. `CE-036` lo misura confrontando
`/etc/sudoers.d`, `/usr/local/bin`, `/etc/noesar-evolution`, `sshd_config` e `/etc/passwd`
prima e dopo:

```sh
cd /mnt/cachec/NOESAR_EVOLUTION && node tools/acceptance/ce-036-portable-cli-install.mjs
# atteso: CE036_CHECKS=23  CE036_FAILURES=0
```

### 0.3 Le tre chiusure di s332

| Cosa | Come verificarla |
|---|---|
| **`D-0345`** una skill adottata arriva all'Autore | `GET /api/v1/skill-catalog` (autenticato) → `enforced: true` + `enforcementSite` |
| **`D-0346`** le run non crescono senza limite | `docker exec noesar-evolution ls /workspace/state/runs \| wc -l` → mai oltre 500; una `PENDING_APPROVAL` non viene mai potata |
| **`D-0347`** lo stato del motore è invisibile allo scanner | cerca `auth.json` o una stringa dell'audit dalla WebUI: **non deve comparire**; una tua `state/` di progetto **deve** restare visibile |

### 0.4 Le suite

```sh
cd /mnt/cachec/NOESAR_EVOLUTION
npm test                      # atteso: 2041 pass, 0 fail, 1 skip
npx eslint .                  # atteso: 0 errori
bash tools/run-browser-e2e.sh # atteso: 413/413
```

---

## 1. 🔴 BLOCCA TUTTO — cinque voci, e sono dell'Owner

`PROJECT_STATE.json → phase_5_release_gate`. La nota nel file è categorica: *«nessuna può
essere segnata PASS da altri che dall'Owner completando il flusso in
`docs/OWNER_BOOTSTRAP.md`. Fino ad allora la fase 5 può produrre solo documentazione
preliminare.»*

| Voce | Stato oggi | Cosa significa |
|---|---|---|
| `OWNER_BOOTSTRAP` | `AWAITING_OWNER_INTERACTION` | fare il primo avvio da zero seguendo `docs/OWNER_BOOTSTRAP.md` |
| `MFA_TOTP` | `AWAITING_OWNER` | iscrivere il TOTP e provarne uno giusto e uno sbagliato |
| `TOKEN_REUSE_REJECTED` | `AWAITING_OWNER` | provare che un token di setup riusato viene rifiutato |
| `STEP_UP_AUTH` | `AWAITING_OWNER` | provare la richiesta di secondo fattore su un'azione sensibile |
| `CLIENT_BROWSER_TEST` | `AWAITING_OWNER` | il giro completo da browser vero |

**Non è il pentest esterno a tenere fermo il progetto: è questo.** Sono cinque prove al
browser, plausibilmente un'ora. Il pentest è il gate su `productionReady`; queste cinque sono
il gate sulla **fase 5**.

---

## 2. 🟠 Lavoro di codice ancora aperto, in ordine di peso

### 2.1 `F4W-006` (medium) — ci sono **due archivi di identità**

L'account che fa login vive in `state/auth.json`; la directory multi-utente in PostgreSQL
(`noesar_identity.users`) è **vuota** sull'installazione reale. Il gate di fase 4 aveva
esercitato la tabella, **non** il percorso di login — quindi l'accettazione multi-utente
registrata allora non copre chi entra davvero.

Registrato «per una fase dedicata» perché riconciliare due archivi di identità è una decisione
di **modello dati con conseguenze di migrazione**, non una riparazione della WebUI. È
l'elemento architetturale più grosso rimasto.

### 2.2 Fase 5 — documentazione e impacchettamento finale

`phase_5_documentation_ready: false`, `phase_5_final_packaging_ready: false`. La parte
«finale» è sbloccata solo dal punto 1. La documentazione **preliminare** si può fare adesso, e
dentro ci va per forza il punto 2.5 qui sotto.

### 2.3 Catalogo modelli — progettato, **zero codice**

`docs/MODEL_CATALOG_DESIGN.md` esiste; moduli sorgente corrispondenti: **nessuno** (misurato).
Requisito Owner s318: deve accettare **qualsiasi** modello, non una lista chiusa.

### 2.4 `F4W-005` (medium) — l'encoder QR è corretto solo per le versioni 1-6

Sopra la 6 **rifiuta esplicitamente** invece di emettere un simbolo che si disegna e non si
decodifica — scelta deliberata e provata. Conseguenza: un username oltre i **25 caratteri** non
ha QR e deve usare la chiave manuale. Le versioni 7+ portano un blocco di informazione di
versione da 18 bit e qualcosa in quel percorso resta sbagliato.

### 2.5 `F4-013` — il backup completo **non è cifrato** e contiene la chiave master

Nessuna azione di codice prevista: va **scritto nella documentazione di fase 5** che è un
dovere dell'operatore, invece di lasciar credere che il prodotto cifri i backup. Se si decide
di cifrarlo davvero, è una funzionalità nuova, non una correzione.

### 2.6 `moduleRuntimeExecutionExists: false`

Un modulo «attivo» è un **flag di fiducia**, non una sandbox che ne esegue il codice.
Dichiarato, non nascosto. Diventa lavoro solo se si vuole che «attivo» significhi di più.

### 2.7 `packaging_filter_regression: PARTIAL`

12/12 casi `gitignore` verdi, ma la metà **Python è UNVERIFIED** su questo host: non c'è
`python3`. Va verificata su una macchina che ce l'ha.

---

## 3. 🟡 Registrati e accettati — nessuna azione

| ID | Sostanza |
|---|---|
| `F4-010` | la validazione URL controlla il **nome host**, non l'indirizzo raggiunto: un nome che risolve a un indirizzo interno passa. Rischio accettato; sfruttarlo richiede `provider.manage`/`agent.manage`, cioè owner o admin |
| `F4-011` | l'estrazione è instradata per **estensione e MIME dichiarato**, senza content sniffing. Limite di correttezza, non di esecuzione |
| `F4-012` | il limite dichiarato di 48 MiB non è raggiungibile via API JSON (base64 gonfia fino al cap da 64 MiB); entrambi i limiti valgono, cambia solo l'errore mostrato |
| `F4C-013` | `postgres.ready` riporta `migrations=0` a un riavvio già migrato; la riga adiacente porta il numero vero |
| `F4L-007` | `--memory-swap` accettato dal demone e scartato da questo kernel (niente swap accounting) |
| `META-001` | il registro copre solo la fase 4; i difetti successivi vivono nel `DECISION_LOG` |
| `F4-003` | ritirato: non era un difetto |

---

## 4. ⚪ Decisioni di contenuto dell'Owner

1. **Deriva `MASTER_PROJECT/` vs `docs/progetto-italiano/`** — 7 file su 14 divergono. Non
   riparata per scelta: è contenuto, non codice.
2. **`B-011`** — token in chiaro nell'`EVIDENCE/` di `D-0325`. Rotazione rimandata a fine
   progetto per istruzione Owner; la storia git non è stata riscritta senza autorizzazione.
3. **Un riavvio dell'host.** §12.5 dice che un'installazione non è finita finché non ne ha
   superato uno, e qui l'ordine di boot è **dedotto, non misurato**. **Non è più un
   prerequisito per accedere** (`D-0344`): se andasse storto, browser e installatore
   continuano a funzionare.

---

## 5. 🔵 Non chiudibile scrivendo codice

**Gruppo 6 — pentest indipendente di terza parte.** Unico gate che tiene
`productionReady=false`. «Indipendente» significa per definizione una parte esterna: non è
qualcosa che questo assistente possa eseguire. Scope già pronto:
`docs/security/INDEPENDENT_PENTEST_SCOPE.md`. Va commissionato.

---

## 6. Come consiglierei di procedere

1. **Verifica dal vivo** la sezione 0. Se qualcosa non torna, si ripara prima di aggiungere.
2. **Le cinque voci del gate** (sezione 1). È l'ora meglio spesa del progetto: sblocca la
   fase 5, che è ferma da prima di questa sessione.
3. Poi si sceglie **uno** fra `F4W-006` (due identità) e il **catalogo modelli** (2.3). Sono i
   due pezzi veri rimasti, e sono di natura diversa: il primo è modello dati e migrazione, il
   secondo è funzionalità nuova.
4. **Il pentest si commissiona in parallelo**, perché ha tempi che non dipendono da noi.

**Il resto della sezione 2 è piccolo** e si può fare a margine di uno dei due.
