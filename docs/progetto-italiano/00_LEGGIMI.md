# NOESAR EVOLUTION — Progetto riscritto

**Data:** 26 luglio 2026
**Stato:** progetto. Nulla di quanto segue è implementato.
**Lingua:** italiano, su richiesta esplicita. La versione canonica in inglese si produce
dopo l'approvazione dei contenuti, non prima — tradurre una cosa non ancora approvata è
lavoro fatto due volte.

---

## Perché questa riscrittura esiste

Il progetto V4 consegnato è una specifica seria: 64 documenti, decisioni congelate, registro
dei rischi, cancelli di implementazione. Ma il confronto fra quella specifica e il codice
realmente costruito ha trovato **due assenze critiche**:

1. Il **Security Kernel** — descritto come autorità Rust indipendente fuori dal modello, con
   dodici componenti — è 37 righe che controllano stringhe di percorso. Cinque dei dodici
   componenti sono zero file.
2. **`ReasoningProvider` non esiste.** Zero file. È il contratto a cui ATOM si aggancia, è
   citato in cinque documenti, in una decisione approvata, in un cancello e nel rischio più
   grave del registro. Non è mai stato scritto.

La seconda è quella che conta: **il punto di forza dichiarato del prodotto non aveva una
cucitura a cui attaccarsi.** Questa riscrittura parte da lì.

Non è un restyling della specifica vecchia. Tiene tutto ciò che quella aveva di buono — e ne
aveva molto — e ricostruisce il centro attorno all'unica cosa che questo prodotto ha e gli
altri no.

---

## I documenti

| # | Documento | Cosa contiene |
|---|---|---|
| 01 | `01_VISIONE_E_POSIZIONE.md` | Cos'è, per chi, e la posizione originale che nessun concorrente ha |
| 02 | `02_ATOM.md` | **Il cuore.** Cos'è ATOM, come funziona, come lavora, cosa è già dimostrato |
| 03 | `03_ARCHITETTURA.md` | Come è fatto dentro: piani, processi, contratti |
| 04 | `04_SICUREZZA_E_AUTORIZZAZIONI.md` | La regola sola, i capability token, le sette modalità |
| 05 | `05_MEMORIA_E_PRIVACY.md` | Le tre semantiche, la contaminazione, l'egress verificato |
| 06 | `06_CODEN_EVOLUTION.md` | Il workspace: un solo programma, due shell |
| 07 | `07_INTERFACCIA.md` | WebUI e terminale, undici destinazioni, una sola pagina impostazioni |
| 08 | `08_INSTALLAZIONE.md` | **Cosa va installato**, com'è fatto il container, come si aggiorna |
| 09 | `09_PIANO.md` | In che ordine si costruisce, e quando si può dire "fatto" |
| 10 | `10_DECISIONI.md` | Le decisioni prese, chi le ha prese, e quelle ancora aperte |
| **11** | **`11_REVISIONE_E_CORREZIONI.md`** | **Revisione critica del mio lavoro: 3 errori d'analisi e 7 difetti di progetto, tutti corretti. Le 2 decisioni aperte, chiuse.** |
| **12** | **`12_COSA_E_CAMBIATO.md`** | **Dal progetto reale a questo: cosa è cambiato davvero** |

Leggerli in ordine funziona. Se hai poco tempo: **01 e 02**. Il resto discende da quei due.
Se vuoi sapere **cosa è cambiato** rispetto al progetto consegnato: vai diritto al **12**.
Se vuoi sapere **cosa ho sbagliato io** e come l'ho corretto: il **11**.

---

## Le quattro cose decise che non si riaprono

Prese insieme il 25 e 26 luglio 2026. Tutto il resto del progetto ci sta appoggiato sopra.

1. **Il nome è CodeN Evolution**, e CodeN Ultra con il suo TUI diventano quello — costruito
   col meccanismo di NOESAR Evolution, non portato da un altro prodotto.
2. **Un solo programma, due shell.** WebUI e SSH si agganciano alla *stessa sessione viva*.
   Non divergono in nessun punto.
3. **ATOM è il percorso obbligatorio del ragionamento, ma non è mai un requisito.** Il core
   pubblico funziona interamente senza. ATOM lo rende migliore, non possibile.
4. **I dati di lavoro non raggiungono mai internet e non entrano mai nella semantica del
   prodotto.** Due archivi separati per schema, autorizzazione a ogni contatto.

---

## Come si legge questo progetto rispetto a quello vecchio

| Il V4 diceva | Questo progetto dice |
|---|---|
| ATOM è un provider privato dietro un contratto pubblico | Lo stesso — **più** cosa fa davvero, con i numeri di 38 esperimenti che lo dimostrano |
| Il Security Kernel ha dodici componenti | Gli stessi dodici **collassano in un solo meccanismo**: i capability token |
| La memoria separa record autoritativi e indici | Lo stesso — **più** tre semantiche con muri applicati dallo schema |
| La privacy è verificata da un broker | Lo stesso — **più** l'idea che quella verifica diventi un prodotto: la Prova di Sessione |
| CodeN ha dieci stadi di ciclo di vita | Diventano sedici, nessuno perso, perché dieci ne accorpavano di diversi |
| Il WebUI approvato è vincolante | Lo stesso — l'architettura dell'informazione scende da 26 a 11 destinazioni |

Niente di ciò che il V4 aveva deciso viene buttato. Quello che cambia è che adesso **il
centro c'è**.
