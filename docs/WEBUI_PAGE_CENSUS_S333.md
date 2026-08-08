# Censimento delle pagine della WebUI — s333 punto 3a

> **Generato**, non scritto a mano: `node tools/measure-page-liveness.mjs --markdown`.
> Una tabella battuta a mano è giusta il giorno in cui la scrivi e sbagliata in silenzio dopo —
> questo progetto l'ha già pagato (`PANEL_NAMES` diceva 14 contro 25 indirizzi veri, `D-0300`).
> Rigenerarlo è il modo di aggiornarlo.

**Richiesta dell'Owner:** *«devi controllare tutte le pagine della webui, capire cosa fanno,
come funzionano … perché mi sembrano tutte pagine statiche»*.

## L'Owner aveva ragione, e adesso è un numero

Misurato **prima** di toccare qualunque cosa:

| Stato | Prima | Dopo |
|---|---|---|
| **viva** — aprirla chiede qualcosa al server | 19 | **29** |
| **solo all'accesso** — dati veri, presi una volta al login, mai più | **7** | **0** |
| **statica** — nulla cambia dopo che il markup è stato letto | 9 | 6 |

Le **sette** erano il caso peggiore dei tre, e sono esattamente ciò che l'Owner ha visto: non
erano vuote, erano **piene di valori veri e fermi al momento dell'accesso**. Un numero stantio
somiglia in tutto a un numero attuale, quindi quelle pagine erano vive, sbagliate e sicure di sé.
`chat`, `tools`, `projects`, `documents`, `knowledge`, `agents` e `settings/privacy` leggevano
tutte lo **stesso** caricamento iniziale, e nessuna lo rileggeva mai.

Due sezioni avevano invece un caricatore **già scritto e mai raggiunto aprendo la pagina**:
`settings/models-hardware` (la sonda hardware partiva solo premendo *Refresh*) e
`settings/remote-targets` (la lista arrivava solo dopo che agivi su di essa). Una pagina il cui
contenuto compare soltanto se premi qualcosa è indistinguibile da una pagina senza contenuto.

## Statico non è un difetto

Sei pagine restano statiche **di proposito**, e ognuna ha la sua ragione scritta in
`services/reference-control-plane/test/page-liveness.test.mjs`. `#/not-found` deve essere
statica. Ciò che sarebbe un difetto è una pagina che ammutolisce **senza che nessuno se ne
accorga** — ed è precisamente quello che era successo alle sette. Perciò l'elenco delle statiche
è l'**eccezione** e va argomentata; tutto ciò che non vi compare deve andare a chiedere.

## Tre difetti trovati nello strumento di misura stesso

Prima di fidarmene, perché una misura sbagliata nella direzione rassicurante è peggio di nessuna
misura. Tutti e tre facevano leggere come *statica* una pagina viva:

1. la regex delle voci **rifiutava qualunque valore contenente una virgola**, quindi
   `sessions:()=>loadWorkSessions(sessionPlaceFromHash(),1)` spariva;
2. prendeva il **primo identificatore** di una lambda, e su
   `()=>{benchOpenedAt=…;loadCoden();…}` risolveva un'assegnazione — dichiarando statica
   `#/coden`, una delle pagine più vive del prodotto;
3. **leggeva anche i commenti** (la trappola già a verbale in questo repository): una virgola
   dentro un `//` spezzava a metà la voce successiva, e una chiave fra apici
   (`'models-hardware':`) non combaciava con un pattern che accettava solo identificatori nudi.

## La tabella

| Address | Kind | Loader | Live | Declared-empty panels | Fields | Buttons |
|---|---|---|---|---|---|---|
| `home` | destination | `loadHome` | yes | 0 | 7 | 8 |
| `chat` | destination | `refreshWorkspaceData` | yes | 0 | 6 | 13 |
| `coden` | destination | `()=>{benchOpenedAt=benchOpenedAt||Date.now();loadCoden();renderBenchNavigator();renderBenchStatus();renderTerminals();}` | yes | 18 | 14 | 18 |
| `tools` | destination | `refreshWorkspaceData` | yes | 0 | 7 | 2 |
| `coden-tui` | destination | — | no | 0 | 0 | 1 |
| `projects` | destination | `refreshWorkspaceData` | yes | 0 | 6 | 1 |
| `documents` | destination | `refreshWorkspaceData` | yes | 0 | 4 | 1 |
| `knowledge` | destination | `refreshWorkspaceData` | yes | 0 | 12 | 7 |
| `memory` | destination | `loadMemoryDestination` | yes | 0 | 2 | 1 |
| `agents` | destination | `refreshWorkspaceData` | yes | 0 | 5 | 2 |
| `workflows` | destination | `loadWorkflows` | yes | 0 | 4 | 1 |
| `models` | destination | `loadModelCatalogue` | yes | 0 | 4 | 4 |
| `research` | destination | `loadResearchDestination` | yes | 0 | 3 | 2 |
| `settings` | destination | — | no | 0 | 0 | 16 |
| `settings/sessions` | settings-section | `()=>loadWorkSessions(sessionPlaceFromHash(),1)` | yes | 0 | 1 | 8 |
| `settings/appearance` | settings-section | `renderAppearance` | no | 0 | 4 | 8 |
| `settings/language` | settings-section | `loadSettings` | yes | 0 | 3 | 4 |
| `settings/about` | settings-section | `loadAbout` | yes | 0 | 0 | 0 |
| `settings/licence` | settings-section | — | no | 0 | 0 | 0 |
| `settings/privacy` | settings-section | `refreshWorkspaceData` | yes | 0 | 6 | 1 |
| `settings/people` | settings-section | `loadUsers` | yes | 0 | 3 | 1 |
| `settings/security` | settings-section | `loadSecurity` | yes | 0 | 15 | 9 |
| `settings/models-hardware` | settings-section | `refreshHardware` | yes | 0 | 0 | 0 |
| `settings/hardware` | settings-section | `refreshHardware` | yes | 0 | 2 | 2 |
| `settings/storage` | settings-section | `loadBackups` | yes | 0 | 2 | 4 |
| `settings/audit` | settings-section | `refreshApprovals` | yes | 0 | 0 | 1 |
| `settings/health` | settings-section | `()=>{loadHealth();loadLogs();}` | yes | 0 | 0 | 0 |
| `settings/health` | settings-section | `()=>{loadHealth();loadLogs();}` | yes | 0 | 0 | 2 |
| `settings/logs` | settings-section | `()=>{loadHealth();loadLogs();}` | yes | 0 | 6 | 4 |
| `settings/updates` | settings-section | `loadUpdates` | yes | 0 | 1 | 5 |
| `settings/skills` | settings-section | `loadSkillCatalog` | yes | 0 | 0 | 0 |
| `settings/modules` | settings-section | `loadOwnerModules` | yes | 0 | 0 | 0 |
| `settings/remote-targets` | settings-section | `loadRemoteTargets` | yes | 0 | 5 | 1 |
| `not-found` | destination | — | no | 0 | 0 | 1 |
| `access-denied` | destination | — | no | 0 | 0 | 1 |
