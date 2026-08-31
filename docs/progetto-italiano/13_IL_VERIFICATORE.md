# 13 · Il verificatore — la soluzione al problema della probabilità

**Questo documento non descrive più il meccanismo.** Conteneva l'algoritmo del verificatore
a proiezioni di ATOM (riduzione, classificazione, proiezione, ricalcolo, confronto,
localizzazione, copertura di proiezione), la tassonomia dei tipi di affermazione, e tre round
di esperimenti misurati con i loro numeri — materiale dello stesso genere già tolto da
`02_ATOM.md` il 2026-07-26, rimasto qui per svista, in entrambe le copie del progetto
(`MASTER_PROJECT/` e `docs/progetto-italiano/`).

Per decisione dell'Owner del 2026-07-26, ATOM è definito da **un solo documento, in un solo
posto**:

> `NOESAR-ATOM-PRIVATE/docs/ATOM_IMPLEMENTATION_BLUEPRINT_V1.md`
> più il crate `NOESAR-ATOM-PRIVATE/` che lo implementa.
> Repository **privato, separato, mai pubblicato, nessun remote**.

## Cosa resta pubblico

Solo che esiste, non come funziona: il contratto `ReasoningProvider` (`02_ATOM.md`) acquisisce
una superficie `project`, accanto a `expect`, e `decompose` scende fino al livello che quella
superficie può verificare. La meccanica dietro `project` — come si riduce un'affermazione, come
si proietta, come si ricalcola — sta nel blueprint privato, non qui.
