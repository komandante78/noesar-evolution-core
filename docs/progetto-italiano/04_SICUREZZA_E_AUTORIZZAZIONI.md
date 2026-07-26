# 04 · Sicurezza e autorizzazioni

## 1. La regola sola

> **Il motore non può cambiare nulla se non eseguendo un Piano autorizzato.**

```text
  richiesta ─▶ modello ─▶ ipotesi ─▶ ATOM ─▶ PIANO ─▶ persona ─▶ token ─▶ esecutore
                 ▲                             │                            │
                 └──── può solo proporre ──────┘        può solo agire ──────┘
                       (nessuna superficie             (nessuna superficie
                        d'azione)                       di proposta)
```

In un IDE agentico convenzionale un modello emette chiamate a strumenti e una guardia prova a
intercettare quelle pericolose: il modello guida e la sicurezza è un filtro davanti, quindi
**ogni fuga è un buco nel filtro**.

Qui il modello **non ha alcuna superficie d'azione**. Produce linguaggio e ipotesi.
L'esecutore non accetta niente che non sia un capability token firmato. Fra i due c'è solo un
Piano che una persona ha autorizzato.

**Un file con prompt injection può quindi chiedere qualunque cosa.** Il massimo che ottiene è
far entrare un'*ipotesi* nel mucchio, dove arriva etichettata con la sua fonte, una classe di
rischio, e una persona che sta per leggerla. Metà di un capitolo di sicurezza diventa una
**proprietà strutturale** invece che un elenco di difese.

## 2. Il capability token

Un Piano autorizzato conia token. Un token è:

```text
  capacità     write | read | exec | net | db | secret | model | update
               connector | plugin | promote
  risorsa      un percorso esatto, un comando, un host, una tabella, uno scope di memoria
  ambito       questo passo | questo compito | questa sessione | questo progetto
  scadenza     un orario, sempre presente
  usi          un numero, di solito 1
  condizioni   profilo sandbox, tetti di risorse, checkpoint obbligatorio
  emesso_per   id del piano + id del passo + chi lo ha concesso
  firma        firmato dal motore, non trasferibile
```

Le proprietà che ne discendono, e sono il punto:

- **Nessuna autorità ambientale.** Senza token l'esecutore non può fare *nulla* — nemmeno
  leggere. Non esiste una superficie "permesso di default" in cui rifugiarsi.
- **Un token non si allarga**, si spende o si revoca. Un agente che scopre di aver bisogno di
  un file in più torna da una persona; non può reinterpretare la propria concessione.
- **La revoca è immediata e globale.** Un pannello elenca ogni token vivo in ogni sessione,
  con una revoca su ciascuno e un comando che li uccide tutti — che è l'Emergency Stop.
- **Ogni spesa è un evento di audit**, con piano, passo, attore, risorsa ed esito. Ricostruire
  non è interpretare dei log: è rieseguire.
- **I dinieghi sono di prima classe.** Cosa un agente *continua a chiedere* e continua a
  sentirsi rifiutare è diagnostico. Un registro dei soli "sì" lo nasconde.

## 3. La richiesta di autorizzazione, identica nelle due shell

```text
  ⚑ AUTORITÀ RICHIESTA                        piano 7f3a · passo 4 di 11 · rischio MEDIO

    write   services/auth/session.mjs                          +34 −8
    write   services/auth/session.test.mjs                     nuovo file
    exec    npm test -- auth                                   ~40s, nessuna rete

    raggio d'azione   5 dipendenti · 1 API pubblica invariata · nessun cambio schema
    simulato          il diff si applica pulito · 12 test passano · 1 nuovo fallisce apposta
    checkpoint        preso prima della prima scrittura
    rollback          disponibile, un comando
    scade             15:00

    /grant once   /grant task   /grant project   /deny   /why   /simulate again
```

**`/why` non è decorazione**: restituisce le ipotesi che hanno prodotto quel passo e le prove
dietro. Una richiesta di autorizzazione che non si può interrogare è una richiesta che si
impara ad approvare alla cieca.

**Un tasto solo non concede mai nulla.** In un terminale, `y` è a un incollaggio di distanza
dall'essere digitato da qualcosa che non sei tu.

## 4. Le sette modalità

La modalità è sempre visibile — nella barra in alto e nel prompt del terminale — e il colore
non è mai la sua unica indicazione.

| Modalità | Può | Non può |
|---|---|---|
| **Sola lettura** | leggere, cercare, indicizzare, spiegare, consultare la cronologia | scrivere, eseguire, uscire in rete |
| **Piano** | tutto quanto sopra, più produrre e simulare piani | applicare qualsiasi cosa |
| **Modifica guidata** | scrivere i file nominati in un piano autorizzato, un gruppo per volta | comandi oltre ai formattatori |
| **Esecuzione guidata** | comandi in allowlist, test, build, formattatori | rete, database, comandi privilegiati senza una concessione nuova |
| **Autonoma in sandbox** | lavorare senza presidio dentro workspace isolato, container, rete ristretta, credenziali effimere | uscire dalla sandbox, scalare privilegi, sopravvivere alla revisione |
| **Owner Bypass** | autorità allargata per uno scopo dichiarato | **esistere in silenzio, o durare** |
| **Recupero** | ripristinare checkpoint, ispezionare, produrre rapporti | **fare progresso in avanti** |

### Owner Bypass — dove questa categoria diventa sciatta

Richiede **ri-autenticazione**, non un clic. Concesso **per uno scopo dichiarato**, con durata
in minuti. Dipinge l'intera interfaccia con un trattamento permanente che nessuno può
scambiare per normale — un bordo, una fascia, e nel terminale un prompt che cambia forma.
Scritto nel registro immutabile **prima** di avere effetto, non dopo. Scade da solo e non si
rinnova in silenzio: il rinnovo è una decisione nuova. E si esce con un tasto, da ovunque.

**Cosa non può fare, in nessun caso e per nessuno:** disabilitare la prevenzione del furto di
credenziali, la prevenzione della persistenza di malware, le protezioni contro il danno
fisico, la verifica degli aggiornamenti firmati, l'integrità dell'audit, la conferma delle
azioni distruttive, il backup recuperabile, l'isolamento dei segreti, l'arresto d'emergenza o
l'identità dell'installazione.

**Nessun segreto universale, nessuna password nascosta, nessuna backdoor del fornitore.**
Un prodotto self-hosted in cui **il proprietario non è onnipotente** è controcorrente, ed è
deliberato: esiste un pavimento che nemmeno root può togliere.

### Recupero — la modalità aggiunta

Non è nella specifica vecchia. Quando un compito è andato male l'istinto è continuare. Una
modalità in cui **il progresso in avanti è impossibile** e restano solo ispezione e ripristino
è il modo in cui una brutta sessione non diventa una brutta giornata.

## 5. I livelli di azione

| Livello | Cosa | Cosa serve |
|---|---|---|
| L0 | informativo | niente |
| L1 | reversibile, personale | niente |
| L2 | delimitato al progetto | piano + autorità |
| L3 | host o server | conferma forte + rollback |
| L4 | distruttivo o sensibile alla sicurezza | ri-autenticazione + doppia conferma |
| L5 | impatto umano o fisico | controllo umano **+ interblocco di sicurezza esterno** |

**NOESAR non è mai il solo controllore di sicurezza** di strumenti chirurgici, aeromobili,
veicoli, macchinari industriali o sistemi energetici. I moduli di attuazione sono spenti di
default e richiedono validazione separata, allowlist, limiti di frequenza e di intervallo, e
disconnessione d'emergenza.

## 6. I segreti

Non compaiono **da nessuna parte**: non nella chat, non nei log, non nei commit, non nei
rapporti, non in chiaro nell'archivio, non nei prompt inviati ai modelli.

Vault o keychain del sistema, credenziali effimere, iniettate solo nel processo che ne ha
bisogno, e **mascherate al punto di uscita e non all'origine** — così un percorso di codice
nuovo non può dimenticarsi di mascherare.

**La redazione è verificata da un canary nella suite di test.** Un redattore che nessuno
testa è un redattore che ha già fallito — ed è successo davvero su questo prodotto: una regola
di redazione corrompeva il 6,75% di tutti gli identificatori e nessuno se ne era accorto per
due fasi.

## 7. Prompt injection: la difesa è strutturale

Il contenuto del repository, i documenti, le pagine web, l'output degli strumenti e la memoria
sono **dati non fidati**. Un file può *chiedere*. Non può mai *istruire*.

Un unico file del tuo repository porta autorità — **`PROJECT_RULES`**, perché l'hai scritto
tu: linguaggi, versioni, convenzioni, comandi, percorsi vietati, criteri di completamento,
requisiti di sicurezza. È autenticato come tuo alla prima lettura, e una sua modifica viene
mostrata per conferma invece di essere assorbita.

## 8. La catena, per intero

```text
  AI PROPONE  →  POLICY DECIDE  →  UTENTE O POLICY AUTORIZZA
     →  SANDBOX ESEGUE  →  VERIFICATORE RICALCOLA  →  AUDIT REGISTRA
```

Questa catena è nella specifica V4 ed è **completamente assente dal codice attuale** — non
come modulo, non come funzione, nemmeno come commento. Ricostruirla è il lavoro.

Nota sull'ultimo passaggio: il verificatore **ricalcola**, non giudica. Un verificatore che
valuta somiglianza ha dato, misurato, **fra il 37% e il 95% di falsi allarmi**; uno che
ricalcola ha dato **100% di cattura e 0% di falsi positivi** anche fuori dal dominio di
addestramento. Non è un'opinione di design: è la differenza fra un controllo che si usa e uno
che si impara a saltare.
