# 02 · Il contratto di ragionamento — e dove vive ATOM

**Questo documento non descrive più ATOM.** Per decisione dell'Owner del 2026-07-26, ATOM è
definito da **un solo documento**, in un solo posto:

> `NOESAR-ATOM-PRIVATE/docs/ATOM_IMPLEMENTATION_BLUEPRINT_V1.md`
> più il crate `NOESAR-ATOM-PRIVATE/` che lo implementa.
> Repository **privato, separato, mai pubblicato, nessun remote**.

## Perché è stato tolto da qui

Le due descrizioni divergevano su una cosa che non poteva restare ambigua: **`L0-L8`
significava due cose diverse.**

| | Blueprint privato | Questo documento, prima |
|---|---|---|
| `L3` | **World Simulator** — un modulo, `src/simulator/` | fascia di maturità: *ipotesi in competizione* |
| `L5` | **Safety and Consistency** — l'unico livello che conia autorità | ancora dentro la fascia L3-L5 |
| `L0-L8` | **nove moduli architetturali** | quattro fasce di capacità |

La frase *"il provider di riferimento sta a L3-L5"* significava **"implementa Simulator +
Evaluator + Safety"** in un vocabolario e **"sa fare ipotesi in competizione"** nell'altro.
Due letture opposte della stessa riga, e nessuno dei due documenti citava l'altro.

Una sola fonte di verità per ATOM elimina la collisione. E rispetta il confine open-core meglio
di prima: **il contratto è pubblico e vive qui; l'implementazione è privata e vive là.**

## Cosa resta qui, e perché

Il contratto `ReasoningProvider` **non è ATOM**. È la superficie pubblica e versionata che il
core definisce e che *qualunque* implementazione può soddisfare — ATOM è solo una di quelle.
Toglierlo da qui avrebbe spostato nel repository privato un pezzo di core pubblico, che è
esattamente ciò che la regola 56 di `CLAUDE10.md` vieta nella direzione opposta.

Resta quindi solo la tabella del contratto. Tutto il resto — come ATOM funziona, i suoi nove
livelli, i loro undici campi, i numeri dei 38 esperimenti — sta nel blueprint privato.

## 5. Il contratto: come il prodotto parla ad ATOM

`ReasoningProvider` è un contratto **pubblico, versionato e congelato**. È l'unica strada che
il motore ha per ottenere un piano. Oggi **non esiste in codice**: è il primo pezzo da
costruire.

| Superficie | Il motore manda | Torna indietro | Obbligatoria? |
|---|---|---|---|
| `interpret` | la richiesta, le regole di progetto, il digest della mappa | **Intent Frame**: obiettivo, non-obiettivi, criteri di successo, ambiguità | sì |
| `hypothesize` | l'Intent Frame, l'evidenza raccolta | **ipotesi causali in ordine**, ognuna con prove a favore *e contrarie* | sì |
| `plan` | le ipotesi scelte, i vincoli, la modalità | **Piano**: passi ordinati, file, comandi, dipendenze, raggio d'azione | sì |
| `decompose` | un passo troppo grosso per essere verificato | lo stesso passo spezzato fino al livello verificabile | sì |
| `expect` | il Piano | **cosa deve succedere**: quali test passano, quali falliscono apposta, cosa il diff deve toccare | **sì — è ciò che rende definibile la "sorpresa"** |
| `constrain` | il Piano e la policy attiva | il Piano ristretto, o rifiutato con una ragione | sì |
| `classify` | il Piano | classe di rischio per passo e per piano | sì |
| `confidence` | Piano e risultati | un numero, **e le ragioni per cui non è più alto** | sì |
| `evidence` | qualunque affermazione mostrata a una persona | le fonti che la sostengono, oppure "inferenza, non supportata" | sì |
| `cancel` | un piano in corso | uno stop pulito che lascia un checkpoint riprendibile | sì |
| `simulate` | il Piano contro un workspace ombra | diff previsto ed esito previsto **senza eseguire** | **no — è il vantaggio di ATOM** |
| `fixtures` | l'id di una sessione | il pacchetto di replay deterministico | sì |

Le cinque portanti sono `interpret`, `hypothesize`, `plan`, `decompose`, `expect`. Le altre
sono ciò che rende il prodotto onesto.


## Il vincolo che non cambia

`FOSS_CORE_DEPENDS_ON_ATOM = false` è un invariante, non un'aspirazione. Il prodotto si avvia,
gira, passa i suoi test e consegna le sue funzioni documentate **con il solo provider di
riferimento**. ATOM lo rende migliore, non possibile.

Conseguenza operativa sul piano: il criterio di "fatto" della fase 1 (`09_PIANO.md` §3) **si
misura senza ATOM**. Se passa solo con ATOM, non è finita.

## Stato di ATOM, misurato il 2026-07-26

```text
ATOM_CONCEPT                  = DOCUMENTED
ATOM_IMPLEMENTATION_BLUEPRINT = PRESENT              nove livelli × undici campi
ATOM_CRATE_STRUCTURE          = PRESENT              45 file .rs, compila offline
ATOM_L0_KERNEL                = IMPLEMENTED          27 test, 0 falliti
ATOM_L1_L8                    = DECLARED_NOT_IMPLEMENTED
ATOM_RUNTIME                  = MISSING
ATOM_WEBUI                    = MISSING
ATOM_PRODUCT_READY            = false
```
