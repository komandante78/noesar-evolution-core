---
name: noesar-evolution
description: MANDATORY for every NOESAR EVOLUTION phase. Imposes the fixed 15-step phase cycle (READ STATE → … → HUNT AND FIX → … → CLEAN UP → STOP), the duty to fix defects as they are found rather than only logging them, the duty to remove every throwaway container the phase created, atomic phase-scoped commits, and the non-negotiable stop condition. Use before starting, resuming, or closing any phase of the NOESAR EVOLUTION installation, and before any commit or push in /mnt/cachec/NOESAR_EVOLUTION.
---

# NOESAR EVOLUTION — Phase Execution Skill

Applies **only** to NOESAR EVOLUTION (`/mnt/cachec/NOESAR_EVOLUTION`).
Subordinate to `CLAUDE10.md`; where they conflict, `CLAUDE10.md` wins.

## 🛑 REGOLA ZERO — un solo progetto esiste

**Ordine esplicito dell'Owner, 2026-07-26:** *"non devi fare riferimento ad altri progetti…
altrimenti non finiamo più"*.

Lavorando qui, **l'unico progetto che esiste è NOESAR EVOLUTION**. Non si nomina, non si cita,
non si confronta e non si tocca nessun altro sistema di questo host — **CodeN Ultra, NOESAR V3,
ATOM, EvalBench, BrainLab, DataFactory, NOVA, CodeN Mind**. Non come riferimento, non come
esempio, non come precedente, nemmeno "solo per contesto".

**CodeN Evolution è un prodotto nuovo.** Non è CodeN Ultra e non eredita da esso nome, codice,
architettura o convenzioni. Il nome "CodeN Ultra" dentro un artefatto di questo progetto è un
**difetto**: si rimuove, non si spiega. (Rimosso dal prodotto il 2026-07-26 — era nella feature
list di `/api/v1/bootstrap`, quindi il prodotto dichiarava di contenere un altro prodotto.)

**In pratica:**

- Si leggono solo `PROJECT_STATE.json`, `docs/SESSION_HANDOFF.md`,
  `docs/WORK_PLAN_V5_REWRITE.md`, `MASTER_PROJECT/`, `docs/DECISION_LOG.md`,
  `docs/INSTALLATION_LEDGER.md`. **Non** si apre il file di memoria di un altro progetto.

## 🛑 LEGGE DI PIATTAFORMA — self-hosted su QUALSIASI PC, server e OS

**Ordine esplicito dell'Owner, 2026-07-30** (dato dopo che una sessione ha sbagliato):
*"NON DEVI FARE NULLA CHE SIA COLLEGATO AD UNRAID, È UN PROGETTO SELF HOSTED CHE VA SU TUTTI
PC SERVER E OS"*.

NOESAR EVOLUTION è software **self-hosted destinato a essere installato da altri**, su
qualunque PC, server o sistema operativo. L'host Unraid su cui si lavora
(`/mnt/cachec/NOESAR_EVOLUTION`) è **una delle installazioni possibili, non il bersaglio del
progetto**. Il prodotto **non possiede l'host** su cui gira — in nessuna installazione reale.

**Vietato, senza eccezioni:**

- Proporre o eseguire una modifica **all'host** come via per chiudere un criterio del prodotto:
  ricompilare il kernel, cambiare la configurazione del demone Docker, delegare cgroup,
  installare pacchetti di sistema, toccare il boot. Non è una scelta da sottoporre all'Owner:
  è fuori dal progetto.
- Scrivere codice, test o documentazione che **presuppongano** Unraid, questo kernel, questi
  percorsi (`/mnt/cachec`, `/mnt/user`), questa versione di Docker o questa GPU.
- Dichiarare un criterio impossibile perché *questo* host non offre un meccanismo.

**Come si risponde invece — la regola positiva.** Un limite trovato su questo host è **un dato
reale su una CATEGORIA di host che il prodotto deve gestire**, non un blocco. La risposta
corretta è sempre **adattiva e portabile**:

1. **Rilevare a runtime** cosa l'host offre davvero, senza presumerlo.
2. **Una base minima che funziona ovunque**, e sempre quella se non c'è altro.
3. **Meccanismi migliori usati in modo opportunistico** dove esistono.
4. **Dichiarare** per installazione quale livello è attivo — mai lasciarlo intendere.

*Caso reale, `D-0246`/`ARCH-008`*: Landlock non è compilato in questo kernel e Docker non
delega un sottoalbero cgroup scrivibile. La risposta sbagliata (già data una volta) è chiedere
all'Owner di sbloccare l'host. La risposta giusta è un Sandbox Manager che **rileva** le
primitive disponibili, usa seccomp come base garantita ovunque, e aggiunge Landlock/cgroup solo
dove l'host li offre. Il probe su questo host resta prezioso: ha misurato **come si comporta
il prodotto su un host che non ha quelle primitive** — condizione che si presenterà su Windows,
macOS, distro minimali e altri NAS.

**Verifica di portabilità, prima di chiudere una fase**: ciò che questa fase ha costruito
funzionerebbe su un host senza Landlock, senza GPU, senza cgroup delegati, con percorsi
diversi? Se no, è un difetto della fase — non un limite dell'host.

## 🎯 MENTALITÀ IMPOSTA — piattaforma avanzata, sempre rivolta al domani

**Ordine esplicito dell'Owner, 2026-07-30:** *"CERCA SEMPRE UNA SOLUZIONE PER MIGLIORARE IL
PROGETTO … FAI SEMPRE PER PENSARE AD UN DOMANI, DEVE ESSERE SEMPRE MEGLIO DI ALTRI PROGETTI,
DEVE ESSERE UNA PIATTAFORMA AVANZATA"*.

Si lavora come **senior software engineer e AI engineer**, con la mentalità di chi sa come si
rompono i sistemi: si cerca il modo in cui una cosa cede *prima* che ceda, e si progetta per
l'installazione di domani, non per il test di oggi.

**Quattro doveri, ad ogni fase:**

1. **Non fermarsi al minimo che chiude il criterio.** Chiudere una riga della matrice è la
   soglia, non l'obiettivo. Dopo aver soddisfatto il criterio, si dichiara in una riga **se
   esiste una forma migliore** — e quale.
2. **Progettare per il domani.** Prima di consegnare: questa scelta regge con dieci volte i
   dati, su un host più povero, con un secondo modello, con un secondo utente, fra un anno?
   Un vincolo di oggi è **stile, non tetto** — non si progetta al ribasso perché *questo* host
   è quello che si ha sotto mano.
3. **Migliorare attivamente, non aspettare che sia chiesto.** Ogni fase produce almeno una
   proposta concreta di miglioramento — architettura, sicurezza, prestazioni, portabilità,
   esperienza d'uso — con il beneficio atteso e il costo. Va in `docs/DECISION_LOG.md`, e la
   migliore si nomina nella risposta all'Owner. **E dichiara la sua aderenza al finanziamento**
   (`D-0531`): quale piattaforma di `noesar-evolution-funding-fit` §1 e quale dei sette tratti —
   *"nessuna"* è una risposta valida e va scritta, non aggirata con una pretesa allargata.
4. **Il metro è esterno.** La domanda non è "soddisfa la matrice", è **"è più avanzato di ciò
   che esiste altrove, e in che cosa esattamente"**. Se la risposta onesta è no su un punto,
   si dice, con il punto nominato.

**Il confine con la disciplina di scope, perché non si contraddicano.** Migliorare **non**
significa allargare la fase in corso: un'idea trovata a metà lavoro si **registra** e si
propone, non si esegue di nascosto (`noesar-evolution-budget` §5). L'unica eccezione resta
quella già vincolante: un difetto che il passo `HUNT AND FIX` deve riparare. Generare l'idea è
obbligatorio; eseguirla nella stessa fase è una decisione dell'Owner.

**E il lavoro si fa in fretta e pulito**: token risparmiati con le tre skill di economia,
letture mirate, verifica a livelli, niente narrazione — la qualità non sta nella lunghezza
della risposta ma in ciò che è stato **misurato**.

## 🧭 ORCHESTRATORE — richiamo OBBLIGATORIO prima di qualunque richiesta sostanziale

**Ordine dell'Owner, 2026-08-11** (`CLAUDE10.md` §18): ogni nuova richiesta sostanziale — per
quanto breve o detta di passaggio — si affronta con l'**Automatic Advanced Engineering
Orchestrator**, e la skill che lo impone si legge **prima** di questo ciclo, non dopo:

> `.claude/skills/noesar-evolution-engineering-depth/SKILL.md`

**Non è una funzione del prodotto e non c'entra con la voce.** È il metodo, e vale per chat,
WebUI, memoria, agenti, workflow, voce, ricerca, strumenti, sicurezza, identità, modelli,
API/SDK, installazione, aggiornamenti, osservabilità, deployment e ogni modulo futuro.

**In quattro righe, il resto sta nella skill:**

1. **Classifica il messaggio prima di agire.** Solo una *nuova richiesta sostanziale* apre un
   contratto. Continuazione, risposta a una tua domanda, autorizzazione dell'Owner, parola di
   controllo (*procedi · continua · sì · no*) e domanda di sola lettura non ne aprono nessuno,
   e **non si rifiutano, non si rinviano, non si ri-scopano** mai.
2. **Il contratto lo scrivi tu**, in sei sezioni (`ROLE`, `TASK`, `CONTEXT`,
   `REASONING & VERIFICATION`, `STOP CONDITIONS`, `OUTPUT`), **prima** della prima modifica.
   L'Owner non deve compilare niente.
3. **Si progetta una capacità, non un elemento.** Un bottone, una pagina statica, un endpoint
   che nessuno raggiunge, un mock, un placeholder, un'interfaccia senza backend vero o una
   funzione che opera una volta sola **non sono "fatto"**.
4. **Bersaglio L4 (`PRODUCTION_GRADE`), architettura pronta per L5.** Se lo scope non lo
   consente, si dichiara il livello davvero raggiungibile **prima** di costruire. `L0`…`L3` non
   si presenta mai come prodotto completo — sarebbe un falso PASS (regola 38).

Il contratto a sei sezioni **non sostituisce** il contratto a sei righe di
`noesar-evolution-budget` §1: quello dimensiona la fase (FILES/TIER/READ/BUDGET/STOP), questo
dimensiona la **capacità**. Si scrivono entrambi, ed entrambi stanno dentro i tetti di lunghezza.

## 🛑 ATOM EVOLUTION — progetto nuovo, in un repository separato, MAI copiare dal vecchio

**Ordine esplicito dell'Owner, 2026-07-28** (dato con forza, dopo che una sessione ha
sbagliato mettendoci dentro roba vecchia): *"NON DEVI METTERE NULLA DEL VECCHIO"*.

Il "seam" ATOM per NOESAR EVOLUTION (passo 11 dell'ordine di costruzione,
`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §10) vive in un repository **suo**,
**separato**, creato il 2026-07-28: **`/mnt/cachec/ATOM_EVOLUTION`** — nato **vuoto**,
zero commit alla creazione, deliberatamente.

**Licenza, deciso dall'Owner il 2026-08-15 (`D-0468`)**: `ATOM_EVOLUTION` è **aperto**,
AGPL-3.0-or-later come il core — non più proprietario. Resta comunque un repository **suo**,
separato: la separazione è ciò che rende verificabile che il core non dipende da ATOM
(`CLAUDE10.md` §14), e non cambia per il cambio di licenza. Aprire `ATOM_EVOLUTION` **non**
allenta di una virgola la regola sotto — anzi la rende più importante da dichiarare
esplicitamente: aprire la licenza del progetto NUOVO non è permesso a copiarci dentro IP dei
quattro percorsi VECCHI e ancora chiusi elencati sotto.

**Non copiare, non importare, non "riprendere" dentro `ATOM_EVOLUTION` nulla da:**

- `/mnt/cachec/NOESAR-ATOM-PRIVATE` — il vecchio blueprint privato per NOESAR EVOLUTION
  (`MASTER_PROJECT/02_ATOM.md` lo definiva "l'unica fonte di verità", ma l'Owner ha deciso
  di ripartire da zero: quella decisione **sostituisce** quella precedente).
- `/mnt/cachec/ATOM`, `/mnt/cachec/ATOM_MODEL`, `/mnt/cachec/ATOM_INTERNAL` — il progetto
  ATOM **originale e separato** (modelli addestrati, esperimenti Gradino, governato dalla
  skill `atom-model-lab`). Un progetto diverso, con la sua storia, il suo repository
  pubblico (`github.com/komandante78/ATOM`). Non c'entra con `ATOM_EVOLUTION`.

**Perché la regola esiste, per non doverla riscoprire**: `02_ATOM.md` racconta già un
episodio quasi identico — due documenti diversi usavano lo stesso vocabolario (`L0-L8`)
per due cose diverse, e nessuno dei due citava l'altro, producendo confusione reale su
cosa "il provider di riferimento sta a L3-L5" volesse dire. Mescolare progetti ATOM
diversi con lo stesso nome è **esattamente** la classe di errore che ha già causato un
incidente in questo progetto una volta.

**Come applicarla**: prima di scrivere qualunque file dentro `ATOM_EVOLUTION`, controllare
che non sia una copia — anche parziale, anche "solo per riferimento" — di un file che
esiste in uno dei quattro percorsi sopra. Il nuovo progetto si scrive da zero, seguendo
solo il contratto `ReasoningProvider` già pubblico in `MASTER_PROJECT/02_ATOM.md` e ciò
che l'Owner chiede in sessione.
- Tutto fuori da `PROJECT_ROOT` è **sola lettura** e fuori discussione: non si cancella, non si
  sposta, non si modifica. Una richiesta di cancellare artefatti di altri progetti è un
  **blocker**, non un compito — si dichiara e ci si ferma.
- Se una risposta sta per contenere il nome di un altro progetto, l'unica forma ammessa è
  dichiarare che non c'entra e proseguire.

## ⚠️ IL PROGETTO DI RIFERIMENTO È `MASTER_PROJECT/` — leggilo per primo

**Deciso dall'Owner il 2026-07-26.** Il progetto di riferimento è la **riscrittura**, che vive
in `MASTER_PROJECT/` (14 documenti in italiano, importati da
`/mnt/user/downloads/NOESAR_EVOLUTION/` con checksum di provenienza in
`MASTER_PROJECT/PROVENANCE.sha256`).

**La documentazione V4 (`MASTER_REFERENCE/`) è stata rimossa dall'albero di lavoro** e non è
più il metro di niente. Resta recuperabile dalla storia git e dagli archivi sigillati in
`/mnt/user/downloads/NOESAR_EVOLUTION_FINAL/`, i cui SHA-256 sono registrati nel repository.
**Non reintrodurla come metro senza una nuova decisione dell'Owner.**

Ordine di lettura, ogni sessione:

1. `PROJECT_STATE.json`, `docs/SESSION_HANDOFF.md`
2. **`docs/WORK_PLAN_V5_REWRITE.md`** — cosa è fatto, cosa cambia, cosa va modificato, il piano
3. **`MASTER_PROJECT/09_PIANO.md`** — l'ordine di costruzione e il criterio di "fatto"
4. `MASTER_PROJECT/00_LEGGIMI.md` → `01` e `02` sono i due che reggono tutto il resto
5. `docs/DECISION_LOG.md`, `docs/INSTALLATION_LEDGER.md`

Se hai poco contesto: `09_PIANO.md` §1 dice **dove siamo davvero, misurato**, e §3 dice
**quando la fase 1 si può dire finita**. Quei due paragrafi valgono più di qualsiasi riassunto.

**Tre cose della riscrittura che cambiano il lavoro, non solo la prosa:**

- I **dodici componenti** del kernel di sicurezza **collassano in uno**: i capability token.
  Non si costruiscono dodici sottosistemi.
- Lo **stack è deciso** (`11_REVISIONE_E_CORREZIONI.md`, D-A): **Rust** per ciò che *decide e
  confina*, **JavaScript** per ciò che *propone e presenta*.
- Il criterio di "fatto" della fase 1 **si misura senza ATOM**. Se passa solo con ATOM, non è
  finita.

**Lingua.** `MASTER_PROJECT/` è in italiano su richiesta esplicita dell'Owner. La regola 49
(inglese canonico) resta valida per il codice e per gli artefatti prodotti; la traduzione
canonica del progetto si fa **dopo** l'approvazione dei contenuti, mai prima.

## 🎯 IL PROGRAMMA ATTIVO — CodeN Evolution, e i due documenti che lo governano

**Deciso dall'Owner il 2026-08-05.** Il lavoro in corso è **CodeN Evolution**, e vive in due
documenti che si leggono **prima di qualunque altra cosa** quando la sessione lo tocca:

| Documento | Cosa dà |
|---|---|
| `MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` | **cosa deve fare** (§0, in chiaro) e le decisioni `D-0304`…`D-0314` |
| `MASTER_PROJECT/17_CODEN_EVOLUTION_PIANO_DI_LAVORO.md` | **le 8 fasi**, ognuna con contratto, misura e condizione di stop |

**Il requisito dell'Owner, in una riga:** CodeN Evolution deve **poter modificare e creare ciò
che l'Owner vuole**, raggiungibile con `ssh` dalla rete scrivendo `coden_evolution`, e la WebUI
**è** la TUI resa in un browser — non una seconda interfaccia.

**La catena del ragionamento, che non si rinegozia:** qualsiasi modello sotto → **ATOM** controlla
e rigenera → **ATOM è ciò che risponde**, su Chat, CodeN Evolution e TUI. Il modello è
intercambiabile, ATOM no, e **ATOM resta fuori da git**. Se ATOM cade il prodotto continua sul
modello **dichiarandolo** (`D-0312`) — mai in silenzio.

**Il buco che il programma esiste per chiudere:** nessuna superficie del prodotto produce il
contenuto di un file. L'esecutore scrive ciò che il chiamante gli passa
(`workspace-actions.mjs:537`). Tutto l'apparato di autorizzazione e prova è costruito attorno a
un cambiamento che l'Owner deve scrivere a mano.

### Le cinque regole contro l'errore che questo progetto commette davvero

Non sono generiche: ognuna nasce da un fallimento **misurato in questo repository**.

1. **Apri `17`, trova la fase corrente, scrivi il contratto a sei righe PRIMA di toccare un
   file.** Se la lista dei file non si riesce a scrivere prima, la fase non è scoperta: si
   divide e lo si dice. *(Perché: le 5 fasi di luglio hanno lasciato fuori tre Card e nessuno
   se n'è accorto, perché la consegna non era scritta prima di cominciare.)*

2. **Non dichiarare funzionante ciò che non hai eseguito in questa sessione** — soprattutto ciò
   che "ovviamente funziona" perché il codice sembra dirlo. *(Perché: la pagina diceva di
   eseguire un client che non era nell'immagine; `plan()` non restituiva `status` ed entrambe le
   shell lo inventavano; un verdetto TLS è stato inventato su una sonda che la policy aveva
   rifiutato.)*

3. **Se costruisci per una shell, dichiara lo stato dell'altra nella stessa risposta** — sempre,
   anche quando non l'hai toccata. *(Perché: s320 ha cablato la prosa nel browser e non nel
   terminale, senza dirlo, contro «le due shell non divergono in nessun punto».)*

4. **Prima di rimuovere, prova che il sostituto funziona. Non dopo.** *(Perché: la fase 3
   rimuove 25 pannelli fissi contando che siano raggiungibili come indirizzi — e "l'address book
   ne dichiara 25" non è la stessa cosa che averli aperti tutti e venticinque.)*

5. **Un criterio che nessuna riga di matrice misura NON è chiuso**, per quanto il documento lo
   affermi. Se manca la riga, la si aggiunge. *(Perché: «le due shell non divergono in nessun
   punto» è scritto dal 26 luglio, mai applicato, e niente lo faceva fallire. Ed è la stessa
   ragione per cui nessuno aveva notato il buco della generazione: 24 righe misuravano il
   cambiamento, **nessuna chiedeva chi lo avesse scritto**.)*

### Chiusura di ogni fase — tre righe, mai di più

```text
FATTO        cosa è vero adesso che prima non lo era, con la misura
NON FATTO    cosa era in questa fase e non è stato consegnato, e perché
PROSSIMA     la fase successiva, e la prima cosa da misurare quando si apre
```

`NON FATTO` non può essere vuoto senza dirlo. È la stessa regola che il prodotto impone a sé
stesso nel rapporto finale (`CE-019`), e vale per chi lo costruisce.

## The cycle — mandatory, ordered, no step skipped

Every phase executes exactly these steps, in this order:

```text
READ STATE
VERIFY INPUTS
ASSESS RISKS
BACKUP
EXECUTE MINIMAL SCOPE
TEST
HUNT AND FIX          <- find defects and repair them, do not merely log them
DOCUMENT
SECRET SCAN
GIT DIFF REVIEW
COMMIT
PUSH
CLEAN UP              <- remove every throwaway container and tag this phase created
WRITE HANDOFF
STOP
```

No step is skipped. A step that cannot be performed is **declared as a blocker**,
never silently omitted and never marked done.

### 1. READ STATE
Read `PROJECT_STATE.json`, `docs/SESSION_HANDOFF.md`, `docs/PHASE_PLAN.md`,
`docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md`. Confirm `current_phase`
matches the phase you were asked to run. If it does not, stop and report.

### 2. VERIFY INPUTS
Verify every input this phase consumes actually exists and is what it claims:
checksums for archives, paths for directories, versions for tools. Record the
verification result. Never assume an input from a previous phase is still valid.

### 3. ASSESS RISKS
State, before acting: what could be destroyed, what is irreversible, what touches
anything outside `PROJECT_ROOT`, what could leak a secret. Anything forbidden by
`CLAUDE10.md` is raised now, not discovered mid-execution.

### 4. BACKUP
Back up anything a mutation could damage, timestamped, inside the project. If the
phase mutates nothing, state that explicitly — do not silently skip.

### 5. EXECUTE MINIMAL SCOPE
Do only what this phase specifies. Nothing anticipatory, nothing "while we're here".
Out-of-scope findings go to `docs/DECISION_LOG.md` for a later phase.

### 6. TEST
Run the verification appropriate to what changed, and show real output. No test
result is asserted without evidence produced in this session. `[UNVERIFIED]` is a
valid, required label — a fabricated PASS is not.

### 7. HUNT AND FIX
**Do not close a phase without actively looking for defects, and do not merely log
what you find — repair it.** A phase that "found bugs" and left them is not finished.

Hunt with real tools, not by reading alone — and with tools **this repository carries**, so
the hunt works for anyone who clones it, on any host (see the platform law above).

**The portable hunt, in this order:**

1. **The repository's own suites** — they are the primary instrument, not a fallback:
   `node --test services/reference-control-plane/test/*.test.mjs`, `tools/run-eslint.sh`,
   `tools/verify-source.mjs`, and the targeted suites in `noesar-evolution-verify`'s change
   map. Measured 2026-07-30: 1168 unit tests, 239 files linted.
2. **The adversarial and oracle tools** — this project's real defect-finders:
   `tools/seeded-defect-proof.mjs` (proves the detectors fire), the `*-adversarial.test.mjs`
   files, `tools/accessibility-audit.mjs`, `tools/browser-e2e.mjs`.
3. **External analysers, only through a disposable container built from the repo** — never a
   host-installed tool and never a long-lived service. `scripts/test.sh` already carries the
   portable pattern for exactly this (`docker run --rm --network none -v "$ROOT:/repo:ro"`),
   which is how the Python verifiers run on a host with no `python3`. The same shape carries
   `semgrep`/`ruff`/`shellcheck` when a phase needs them. Offline, read-only, removed at once.
4. **Reading, last** — for the defect classes no scanner sees: configuration, design,
   authority boundaries, a missing endpoint, an unenforced cap.

Scan whatever this phase touched, plus — when the verify skill requires a full sweep — the
first-party surface: `services/`, `ai-workspace/`, `capabilities/`, `tools/`, `apps/`,
`rust/crates/`, `oci/`, and the shell installers.

> **Repaired 2026-07-30.** This step used to *mandate* starting `noesar-debuglab` (`:8099`)
> as the hunting instrument. That container **and its image no longer exist** on this host
> and port 8099 is dead — verified, not assumed. A mandatory step pointing at a nonexistent
> tool is a step that gets silently skipped, which is worse than no step. It was also
> host-coupled: a hunt that only works on one machine is not a hunt this project owns. Any
> such external service is now **optional, and only if already present** — its absence is
> never a reason to skip the hunt, and it is stopped in the same phase if started.

Then fix. The order is: reproduce → understand the root cause → fix the cause, not the
symptom → prove the fix.

**Triage every finding before acting on it.** Static analysers are noisy, and a false
positive "fixed" is a real regression introduced for nothing. Verify each hit against
the actual code — real examples already seen on this project: `SC1007` on the correct
`CDPATH= cd` idiom; `insecure-file-permissions` telling you 0o700 is too permissive
when 0o644 is *less* restrictive; a hardcoded-password hit on a test canary literally
named `must-not-leak`; 5,078 "high entropy" hits that were all SHA-256 checksums.
Record what you dismissed and why — a dismissal you cannot justify is a finding.

**Fix inside the phase when** the defect is in scope, understood, repairable without
starting containers or touching the host, and provable by a test. Every fix still obeys
the rest of this cycle: back it up first, test it, document it, commit it atomically.

**Do not fix, record instead, when** the repair would exceed the phase's scope, require
fabricating content you cannot verify (upstream source, a checksum, a licence), demand
a destructive or outward-facing action, or rest on a root cause you have not actually
found. Guessing is not fixing. Say plainly what is left open and why.

**Also fix the rule that produced the defect**, not just the instance. If a filter
deleted real files, correct the filter and add a regression test; if a check was silently
passing, prove the detector fires before trusting a clean result. Both have already
happened here.

A defect that cannot be reached by tooling still counts: configuration, host and design
defects (a weak seccomp profile, a port collision, a missing endpoint) are invisible to
every scanner on this list. **A clean scan is not a verdict of "safe".**

### 8. DOCUMENT
Update the documentation affected by this phase in this phase. At minimum
`docs/INSTALLATION_LEDGER.md`; plus `docs/DECISION_LOG.md` for every decision taken.
Record what was found, what was fixed, what was dismissed as a false positive and on
what evidence, and what remains open.

### 9. SECRET SCAN
Scan the working tree and the staged set for keys, tokens, passwords, cookies,
private keys, and credential-bearing strings. Use tooling already present; if
`gitleaks` is absent, run a heuristic scan and **declare it heuristic**. Confirm no
ZIP, binary, database, backup, or `.env` file is staged.

### 10. GIT DIFF REVIEW
Review `git status --short` and `git diff --staged` in full before committing.
Unexpected content is a stop condition, not a footnote.

### 11. COMMIT
One atomic commit per logical unit, always phase-scoped:

```text
<type>(phase-<N>): <imperative summary>
```

`<type>` ∈ `chore | feat | fix | docs | build | test | refactor | security`.
State updates that land after the main commit get their own atomic commit.

### 12. PUSH
Push when a remote exists and is authenticated. Never force-push. If the remote is
unavailable or unauthenticated, complete the local repository and record the
condition as a blocker.

### 13. CLEAN UP

**Work clean.** Every container this phase created for a transient purpose is removed
before the phase closes — passed or failed, no exceptions, no "I might need it later".
The stopped container is not what makes a run reproducible; the image and the evidence
file are. Governing rules: `CLAUDE10.md` §5a.

**What survives a phase — exactly two containers:**

| Keep | Why |
|---|---|
| `noesar-evolution` (running) | the installation itself |
| **one** rollback container, the most recent | the parachute for what is running now |

Everything else named `noesar-evolution.*` is removed: e2e probes and runners,
screenshot instances, verification and analysis sondas, and **older rollback containers**
— their images stay on disk, so every rollback path documented in
`docs/INSTALLATION_LEDGER.md` still works.

**Image tags and networks are litter too, and are easy to forget.** Build overlays
(`noesar-evolution:webui-e2e-<ts>`), probe tags, and per-run bridge networks
(`noesar-e2e-<ts>`) all go. Networks are not free: each bridge takes a subnet from
Docker's finite address pool, and exhausting it breaks network creation for **every**
project on this host — so a forgotten network is worse than a forgotten container, not
better. Kept: the image lineage referenced by the running container, the kept rollback or
a documented procedure; and the stable unstamped networks `noesar-evolution-net` and
`noesar-e2e-net`. `noesar-local` belongs to NOESAR V3 — never touch it.

**Procedure — never skip a line of it:**

1. Write the full inventory to `EVIDENCE/docker_inventory_pre_cleanup_<UTC>.txt`:
   `docker ps -a`, `docker images`, `docker network ls`, `docker volume ls`.
2. Build the target list **by name prefix (`noesar-evolution`, `noesar-e2e-<stamp>`)
   only**, excluding the keepers. Print it and confirm **no target is `Up`** — and, for a
   network, that it has zero attached containers — before removing anything.
3. `docker rm` / `docker rmi` / `docker network rm` the named targets. **Never**
   `docker system prune`, `container prune`, `image prune`, `network prune` or
   `volume prune` — they act host-wide and would destroy other projects on this host.
   This is forbidden without exception.
4. Diff `volume ls` against the pre-cleanup inventory, re-count the non-project
   containers, and confirm the surviving networks are exactly the intended ones. Anything
   outside this project must be **unchanged** — say so with the real output.
5. Prove the product still works: `docker inspect` state/health plus a live `/livez` and
   `/readyz`. A cleanup that ends without this proof is not finished.

If a container must be kept beyond the two above, name it in `docs/DECISION_LOG.md` with
the reason and the phase that will remove it. An unexplained survivor is a defect.

### 14. WRITE HANDOFF
Rewrite `docs/SESSION_HANDOFF.md` so a cold session can resume with no other
context: what was done, what was verified, what was **not** done, open blockers,
and the exact next action. Update `PROJECT_STATE.json` (`current_phase`,
`phase_status`, `next_phase`, `last_commit`, `last_updated_utc`, `blockers`).

### 15. STOP
Emit the phase output and **stop**. Do not begin, scaffold, or preview the next
phase. Continuation requires a new, explicit instruction from the owner.

## Standing rules

- One phase per invocation.
- Nothing outside `PROJECT_ROOT` is modified.
- **Defects are fixed, not just filed.** Finding a bug and leaving it for "a later
  phase" is only acceptable when step 7 names a reason it cannot be fixed here. The
  default is to repair it, with a backup, a test and an atomic commit.
- No database, network, or external dataset is touched, and no product container is
  created, started or stopped. **One narrow exception:** step 7 may run a **disposable,
  offline, read-only analysis container built for that run** (`docker run --rm
  --network none -v "$ROOT:/repo:ro"`, the pattern `scripts/test.sh` already uses) and it
  is removed in the same phase. Nothing it reports is trusted without triage against the
  real code. No long-lived analysis service is depended on, and none is required to exist.
- **Nothing this project builds may depend on this host.** No kernel feature, package,
  path, Docker version or GPU is presumed present; capability is detected at runtime and
  declared per installation. Host-level changes are never proposed as a fix (platform law).
- **Every phase leaves at least one recorded improvement proposal**, with its expected
  benefit and cost — generated always, executed only when the Owner says so.
- **Whatever this project creates, this project removes.** Containers created under an
  authorised installation phase are cleaned up in step 13 — two survive a phase, the
  running installation and one rollback. Host-wide `prune` commands are never used.
- No secret is ever written to a tracked file.
- No archive, binary, model, cache, or database is ever committed.
- English is canonical for all artifacts.
- The FOSS core never depends on ATOM; proprietary ATOM code never enters a public repository.
- A blocker is stated plainly and immediately. A false PASS is never acceptable.
- A clean scan proves the scanner found nothing, not that the code is correct.
