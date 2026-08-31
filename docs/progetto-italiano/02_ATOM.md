# 02 · ATOM — il cuore

**Questo documento non descrive più ATOM.** Superato dalla riscrittura del 2026-07-26
(`CLAUDE10.md` §1a): il progetto di riferimento è `MASTER_PROJECT/`, e dentro di esso
**`MASTER_PROJECT/02_ATOM.md`** è il documento pubblico che sostituisce questo — stesso
titolo, stesso ruolo, contenuto rifatto lo stesso giorno.

ATOM, per decisione dell'Owner del 2026-07-26, è definito da **un solo documento, in un
solo posto**:

> `NOESAR-ATOM-PRIVATE/docs/ATOM_IMPLEMENTATION_BLUEPRINT_V1.md`
> più il crate `NOESAR-ATOM-PRIVATE/` che lo implementa.
> Repository **privato, separato, mai pubblicato, nessun remote**.

## Perché è stato tolto anche da qui

Questo file conteneva la stessa classe di dettaglio che `MASTER_PROJECT/02_ATOM.md`
aveva prima del 26/07 — come ATOM lavora passo per passo, la scala di maturità a otto
gradini, i numeri degli esperimenti — e non è mai stato aggiornato quando l'altro fu
svuotato lo stesso giorno. Due documenti con lo stesso contenuto proprietario, uno
segnalato come superato e uno no, è esattamente la collisione già registrata su
`L0-L8` fra il blueprint privato e la vecchia versione di `02_ATOM.md`: stesso
vocabolario, letture diverse, nessuno dei due che cita l'altro.

## Cosa resta qui

Nulla che non sia già in `MASTER_PROJECT/02_ATOM.md`: il contratto `ReasoningProvider`
è pubblico, versionato, e vive lì. Per la tabella delle sue superfici (`interpret`,
`hypothesize`, `plan`, `decompose`, `expect`, `constrain`, `classify`, `confidence`,
`evidence`, `cancel`, `simulate`, `fixtures`) e per l'invariante
`FOSS_CORE_DEPENDS_ON_ATOM = false`, leggere quel documento.

Tutto il resto — come ATOM lavora, la scala di maturità, i numeri di laboratorio — sta
nel blueprint privato, non qui.
