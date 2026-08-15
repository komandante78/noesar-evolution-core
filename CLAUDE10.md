# CLAUDE10.md — NOESAR EVOLUTION Operating Authority

**Status:** permanent and binding.
**Scope:** `/mnt/cachec/NOESAR_EVOLUTION` and the `NOESAR-EVOLUTION` repository only.

This file is the sole authority for Claude Code when working on NOESAR EVOLUTION.
It supersedes habit, prior sessions, and any convention inherited from other projects.

---

## 1. Applicability

1. These rules apply **exclusively** to the NOESAR EVOLUTION project.
2. These rules **must never** be applied to, exported to, or invoked for any other
   project, repository, container, or workspace on this host — including NOESAR V3,
   CodeN Ultra, ATOM, EvalBench, BrainLab, DataFactory, or any other system.
3. Conversely, rules and habits from those projects have **no authority here**.
   Where they conflict with this file, this file wins.
4. Work performed under this authority stays inside `PROJECT_ROOT`. Anything outside
   it is read-only unless the phase specification names the path explicitly.

## 1a. Il progetto di riferimento — deciso dall'Owner il 2026-07-26

4a. **Il progetto di riferimento è la riscrittura, in `MASTER_PROJECT/`.** Sostituisce il
    master V4 come metro di ogni decisione, di ogni piano e di ogni criterio di "fatto".
4b. **La documentazione V4 (`MASTER_REFERENCE/`) è rimossa dall'albero di lavoro** per
    istruzione esplicita dell'Owner. Questa è un'eccezione nominata alla regola 12, concessa
    con lo stesso meccanismo dell'eccezione §5a: l'Owner emenda questo file, non lo si aggira.
    La rimozione è **recuperabile** — il contenuto resta nella storia git e negli archivi
    sigillati in `/mnt/user/downloads/NOESAR_EVOLUTION_FINAL/`, i cui SHA-256 sono registrati.
    Nessun file è stato distrutto.
4c. **Conseguenza dichiarata, non nascosta:** la parte legale, di licenza, di conformità e di
    confine d'uso che la riscrittura dichiara di conservare (`50-57`, `60-66`, `70-77`,
    `09_LEGAL_TEMPLATES`) è conservata **per decisione, non per contenuto**. La fase 7 ne avrà
    bisogno e andrà recuperata dagli archivi. Allo stesso modo, la riscrittura **non ha**
    matrice di accettazione, tracciabilità né registro dei rischi: vanno ricostruiti dentro di
    essa, o si perde il modo di dire "fatto" in maniera controllabile.
4d. Il V4 **non si reintroduce come metro** senza una nuova decisione registrata dell'Owner.

## 2. State and handoff — read before operating

5. Before any action in a new session or a new phase, read **in this order**:
   `PROJECT_STATE.json`, `docs/SESSION_HANDOFF.md`, **`docs/WORK_PLAN_V5_REWRITE.md`**,
   **`MASTER_PROJECT/09_PIANO.md`**, `docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md`.
6. Never infer project state from memory, from a summary, or from a previous
   conversation. The files on disk are the only source of truth.
7. If state files are missing, inconsistent, or contradict observable reality,
   stop and declare a blocker. Do not "repair" state by guessing.

## 2a. Working economy — read the state, do not load it

**Owner instruction, 2026-07-27:** *"skill che ti aiutano a risparmiare, controllare e
lavorare meglio senza spendere sessioni di 1 ora e passa di token"*. Amends rule 5.

7a. **The read order of rule 5 is satisfied by a digest, not by loading the files.**
    Executing it literally costs ~400 KB (~100k tokens) before any work begins:
    `PROJECT_STATE.json` is 80 KB across ~120 keys, `docs/DECISION_LOG.md` 160 KB,
    `docs/INSTALLATION_LEDGER.md` 116 KB. `.claude/skills/noesar-evolution-context/
    state-digest.sh` returns the same operative facts in 6.3 KB, measured. Those three
    files, `MANIFEST.sha256` and the `MASTER_PROJECT/` bundle are **never read whole**;
    they are reached by `jq`, by line range, or by `grep`.
7b. **This narrows nothing about what must be known.** Rule 6 stands: state comes from the
    files on disk, never from memory or a summary. A fact the digest does not carry is
    read from its file, by range, and the read is declared.
7c. **The state files are append-only, and `PROJECT_STATE.json` does not grow a key per
    phase.** They reached this size because every phase added and none pruned. A phase's
    narrative belongs in the handoff and the decision log.
7d. Governing detail: `.claude/skills/noesar-evolution-context/SKILL.md`,
    `…/noesar-evolution-verify/SKILL.md`, `…/noesar-evolution-budget/SKILL.md`. They are
    subordinate to this file and impose the phase contract, the verification tiers and the
    length caps for every record this project writes.

## 3. One phase at a time

8. The project has **6 phases (0–5)**, defined in `docs/PHASE_PLAN.md`.
9. Execute **one and only one** phase per invocation. Never start the next phase,
   never "prepare" it, never partially anticipate it.
10. A phase ends with: state updated, handoff written, commit made, and a full stop.
11. Scope creep is a violation. Work outside the current phase's stated objective
    is not performed — it is recorded in `docs/DECISION_LOG.md` for a later phase.

## 3a. Build, install, verify — one phase, not three

**Owner instruction, 2026-07-27:** *"è inutile che prepari e non installi… preferisco che
installi e verifichi subito"*. Amends §3 and §5, and supersedes the habit of leaving
verified work in the source tree for a deployment that never comes.

11a. **A phase that changes the product installs what it changed and verifies it on the
     running installation, in the same phase.** Building, deploying and verifying are one
     unit of work, not three phases. Leaving a repaired defect in the source while the
     installation keeps serving the defect is the outcome this rule removes: at the moment
     this was written the live box had been running behind four such fixes.
11b. **This is a standing authorisation for the deployment step only**, and it does not
     widen anything else. §5 rules 17-21 stand untouched: no other container, no network,
     no volume, no database outside this project, no host-level change. The containers this
     authorisation permits are the product's own, and §5a still governs what survives.
11c. **The sequence is not optional, and its order is the safeguard.** Build the image
     offline; prove the image's contents equal the repository tree; stop the service with a
     grace period and confirm a clean shutdown in the log rather than assuming it; take a
     full runtime backup **with the service stopped**, so the database copy is consistent;
     preserve the previous container under a timestamped name; start the replacement with
     the configuration **read back from the container it replaces**, not from memory;
     verify on the live installation; then clean up under §5a.
11d. **A deployment whose rollback has a cost states that cost before it runs**, in the
     image's own build file and in `docs/INSTALLATION_LEDGER.md` — see `D-0082`. A rollback
     that turns out to need a backup nobody took is not a rollback.
11e. **Verification on the live installation never uses a suite that mutates data.** The
     browser suites bootstrap an owner and change settings; they run against a disposable
     probe, never against the installation. What is proven live is that the deployed bytes
     equal the tree the suites exercised, that the service is healthy, and that the
     surfaces answer.

## 4. Non-destructive operation

12. **No deletion.** Do not delete files, directories, containers, images, volumes,
    branches, or history. Not with `rm -rf`, not with `git clean`, not implicitly.
    **One named exception**, added by the owner on 2026-07-26: the throwaway Docker
    containers and image tags this project itself creates are not artifacts to be
    preserved — they are litter, and leaving them is the violation. They are removed
    under §5a, which states exactly what may be removed and what must survive.
    **Second named exception**, added by the owner on 2026-07-28: `apps/webui-react/` —
    three files, twelve lines, no component, superseded by `apps/webui-static` (`V4-D002`
    amended by `D-0169`). Removed under `D-0195`, same mechanism as §1a: an explicit
    Owner amendment to this file, not a decision taken elsewhere. The content survives in
    git history and in the sealed archives (`/mnt/user/downloads/NOESAR_EVOLUTION_FINAL/`,
    SHA-256 recorded) — nothing is destroyed, only removed from the working tree.
13. **No destructive modification by implication.** Overwriting, truncating,
    renaming, moving, or replacing an existing artifact requires that the phase
    specification explicitly asks for it, and requires a backup first (§6).
14. Never `git push --force`, `git reset --hard` on shared history, or rewrite
    published commits.
15. Existing directories are inventoried and verified as belonging to NOESAR
    EVOLUTION before any write.

## 5. External systems are off-limits

16. Do not create, start, stop, restart, remove, or exec into any Docker container.
    **One named exception**, so that defect hunting is possible at all: the
    `HUNT AND FIX` step may run a **disposable, offline, read-only analysis container
    built for that run** — `docker run --rm --network none -v "$ROOT:/repo:ro"`, the
    portable pattern `scripts/test.sh` already uses for the Python verifiers — and it is
    **removed within the same phase**. No other container may be touched, and no product
    container may be created or started outside an authorised installation phase.
    Containers this project is authorised to create are also **removed** by it — see §5a.
    **Amended 2026-07-30**: this exception previously named a long-lived host service
    (`noesar-debuglab`, `:8099`) as the *only* place carrying semgrep/bandit/ruff/
    detect-secrets/shellcheck/mypy. That container and its image no longer exist and the
    port is dead — verified, not assumed — so the mandatory hunt step pointed at nothing,
    and a mandatory step that cannot run is a step that gets skipped. It was also
    host-coupled, which §60–64 forbid. An external analysis service is now **optional and
    only if already present**; its absence is never a reason to skip the hunt, and the
    repository's own suites and adversarial/oracle tools are the primary instrument.
17. Do not modify Docker networks, volumes, `docker-compose` files, or `.env` files
    belonging to any system.
18. Do not read, write, migrate, or mutate any database, vector store, or queue
    outside this project (Postgres, Qdrant, SQLite of other products, etc.).
19. Do not touch production services, GPU allocation, or any running workload.
20. Host-level changes (packages, services, cron, firewall) are out of scope.
21. Actions the phase requires but these rules forbid are raised as blockers, not
    performed "just this once".

## 5a. Container hygiene — work clean

Owner instruction, 2026-07-26: *"devi lavorare pulito"*. Every container this project
creates for a transient purpose is removed by this project. The duty is narrow and the
boundary is absolute — it authorises cleaning up **our own litter**, nothing else.

21a. **Every transient container is removed inside the phase that created it**, whether
     it passed or failed: e2e probes and runners, screenshot instances, one-off
     verification and analysis containers, and any container-sonda used to avoid mutating
     the real installation. "I might need it later" is not a reason to keep one — the
     image it ran from is what makes it reproducible, not the stopped container.
21b. **At phase close exactly two containers may exist**: the running installation
     `noesar-evolution`, and **one** rollback container — the most recent one, the
     immediate predecessor of what is running. Older rollback containers are removed;
     their **images stay on disk**, so every documented rollback path survives.
21c. **Throwaway image tags and networks are removed too** — build overlays such as
     `noesar-evolution:webui-e2e-<ts>`, probe tags, and per-run bridge networks such as
     `noesar-e2e-<ts>`. Networks are not free: each bridge consumes a subnet from Docker's
     finite address pool, and exhausting it breaks network creation for every project on
     this host. Kept: the lineage of images referenced by the running container, by the
     kept rollback, or by a documented procedure; and the stable, unstamped networks
     (`noesar-evolution-net`, `noesar-e2e-net`). `noesar-local` belongs to NOESAR V3 and
     is never touched.
21d. **Scope is by name prefix `noesar-evolution` only**, and never wider.
     `docker system prune`, `docker container prune`, `docker image prune` and
     `docker volume prune` are **forbidden without exception** — they act host-wide and
     would destroy other projects on this host. Removal always names its targets.
21e. **Never remove a running container.** Before removing anything: capture the full
     `docker ps -a` / `images` / `network ls` / `volume ls` inventory to `EVIDENCE/`,
     confirm no target is `Up`, and after removal diff networks and volumes against that
     inventory and re-count the non-project containers. Both must be unchanged.
21f. After cleanup, **prove the product is still healthy** (`docker inspect` state plus a
     live `/livez` and `/readyz`) before declaring the step done.

## 6. Backups before mutation

22. Any non-trivial mutation of an existing file or dataset is preceded by a
    timestamped backup inside the project (e.g. `BACKUPS/<name>.<UTC-timestamp>`).
23. Backups are never deleted within a phase. Retention decisions are separate and
    explicit.
24. Git is not a substitute for a backup of uncommitted or ignored content.

## 7. Secrets

25. **No secret in any tracked artifact.** No API key, token, password, cookie,
    session, private key, certificate key, connection string with credentials, or
    canary/owner token in code, configuration, documentation, comments, commit
    messages, log files, test fixtures, or Git history.
26. Credentials are supplied **only** through a secret store or runtime environment
    variables that are never versioned. Reference them by name, never by value.
27. `.env`, `.env.*`, `secrets/`, and `credentials/` are always ignored by Git.
28. Any secret that reaches a tracked file is a blocker: stop, rotate, record.
29. Absolute host paths, internal hostnames, and infrastructure details are
    published only when technically necessary.

## 8. External APIs disabled by default

30. All outbound/external API integrations ship **disabled by default**. Enabling
    one is an explicit, documented, opt-in configuration choice by the operator.
31. No network call is introduced as a silent side effect of a build, test, or
    start-up path.
32. Offline operation is the baseline: the core must be usable with no external
    service reachable.

## 9. Repository hygiene

33. The repository never contains: `*.zip`, `*.tar`, `*.tar.gz`, `*.7z`, compiled
    binaries (`*.exe`, `*.dll`, `*.so`, `*.dylib`), build output (`target/`,
    `build/`, `dist/`), caches, model weights, databases (`*.sqlite*`), backups, or
    build artifacts.
34. The five source ZIP archives are **never** added to the repository.
35. The repository stays **private** until an explicit, recorded decision to publish.

## 10. Verification and honesty

36. Every modification is followed by the tests appropriate to what changed.
    "It should work" is not a test result.
37. Report outcomes faithfully: if a test fails, show the output; if a step was
    skipped, say so; if something is unverified, label it `[UNVERIFIED]`.
38. **Never declare PASS, DONE, COMPLETE, or PRODUCTION-READY without evidence
    produced in this session.** A false PASS is the most serious violation in this
    file.
39. Errors, gaps, and blockers are declared explicitly and immediately, in the
    phase output and in `PROJECT_STATE.json.blockers`.
40. Do not fabricate state, checksums, test counts, or command output.
40a. **Defects are hunted and repaired, not merely reported.** Every phase runs the
    `HUNT AND FIX` step of the skill cycle before it closes. Finding a defect and
    leaving it for "a later phase" is acceptable only for the reasons that step names:
    out of scope, unverifiable without fabricating content, requiring a destructive or
    outward-facing action, or resting on a root cause not yet found. Otherwise it is
    fixed here — with a backup, a test, and an atomic commit.
40b. **Triage before repairing.** A false positive "fixed" is a real regression
    introduced for nothing. Every finding is checked against the actual code, and
    every dismissal is recorded with its evidence.
40c. **Fix the rule, not only the instance.** When a filter, ignore rule, or check
    caused the defect, correct it and add a regression test. A clean scan proves the
    scanner found nothing — never that the code is correct.
40d. **The hunt is scoped to what the phase changed, by default** (Owner authorisation,
    2026-07-27). The duty to hunt and to repair is unchanged; the default target is the
    phase diff and the surfaces it reaches, not the entire first-party tree every time.
    A **full sweep** remains required when a new surface is introduced, when the phase
    touches security, authority, installers or packaging, when the last full sweep is more
    than five phases old, or when the Owner asks. **Which of the two ran is always
    declared** — "scoped to the diff (N files)" and "full sweep" are different claims and
    are never reported as the same thing. Verification is tiered by the same principle:
    `.claude/skills/noesar-evolution-verify/SKILL.md`. What is removed is re-verification
    of what the change could not have touched — never verification itself, and never
    rule 38.

## 11. Documentation duty

41. Documentation is updated **in the same phase** as the change it describes —
    never deferred to "later".
42. Every phase updates: `PROJECT_STATE.json`, `docs/SESSION_HANDOFF.md`,
    `docs/INSTALLATION_LEDGER.md`, and `docs/DECISION_LOG.md` where a decision was made.
43. Documentation claims must match the code. A doc that describes behavior the
    code does not have is a defect of the same severity as a code bug.

## 12. Git discipline

44. Before **every** commit: run a secret scan (§7), review the staged file list,
    and review `git diff --staged` in full.
45. If `gitleaks` is unavailable, perform a heuristic scan and **declare** that it
    was heuristic. Do not install new tooling to satisfy this rule.
46. Commits are atomic and reference their phase, e.g. `chore(phase-0): …`.
47. Each phase concludes with a commit and, when a remote is available and
    authenticated, a push.
48. When the remote is unavailable, the local repository is still completed and the
    condition is recorded as a blocker.

## 13. Language

49. **English is canonical** for source code, identifiers, API surfaces, log
    messages, error strings, commit messages, and technical documentation.
50. UI localization is a **separate layer** (translation catalogs/resources). No
    non-English string is hardcoded outside that layer.
51. Operator-facing conversation may be in any language; artifacts may not.

## 14. Open core and the ATOM boundary

> **Amended by the Owner, 2026-08-15 (`D-0468`).** ATOM stops being proprietary. It stays
> **architecturally separate** — its own repository, `ATOM_EVOLUTION` — but its licence
> becomes **AGPL-3.0-or-later**, matching the core. This is a licensing change, not an
> architectural one: rules 54-55 (no dependency, public-interface-only integration) are
> **unchanged** — the repository split is what makes "the core does not depend on ATOM" a
> checkable fact rather than a promise, and that stays true regardless of ATOM's licence.
> What rule 56 protected against — proprietary ATOM material leaking into a public
> repository — no longer applies to `ATOM_EVOLUTION` itself, since it is now meant to be
> public; it is **replaced** by the boundary that was always separate and still stands: the
> **old**, genuinely different, still-proprietary ATOM projects on this host (`ATOM`,
> `ATOM_MODEL`, `ATOM_INTERNAL`, `NOESAR-ATOM-PRIVATE`) remain fully off-limits as a source.
> Opening `ATOM_EVOLUTION`'s own licence is not permission to copy their IP into it.

52. The **FOSS core must be complete and independently useful** on its own. A user
    with only the open core gets a working product, not a demo.
53. **ATOM is open and architecturally separate** — its own repository
    (`ATOM_EVOLUTION`), licensed AGPL-3.0-or-later like the core, not merged into this
    repository. The core must not require ATOM to build, start, pass its tests, or
    deliver its documented functionality — that requirement does not soften because
    ATOM is no longer proprietary; separation is what keeps it checkable.
54. `FOSS_CORE_DEPENDS_ON_ATOM = false` is an invariant, not an aspiration.
55. Integration happens through **public interfaces only** — a stable, documented
    boundary the open core defines and any implementation may satisfy.
56. **No material from the old, separate, still-proprietary ATOM projects on this
    host — `ATOM`, `ATOM_MODEL`, `ATOM_INTERNAL`, `NOESAR-ATOM-PRIVATE` — may ever be
    copied into `ATOM_EVOLUTION` or this repository**: not as code, not as vendored
    files, not as weights or corpora, not as test fixtures, not as documentation
    detail. `ATOM_EVOLUTION` is built from scratch, from the public `ReasoningProvider`
    contract (`MASTER_PROJECT/02_ATOM.md`) and what the Owner specifies in session —
    never from those four paths. See the `noesar-evolution` skill's own "🛑 ATOM
    EVOLUTION" section for the mechanism this already relies on.
57. Work funded under public/FOSS funding programs must itself be FOSS. `ATOM_EVOLUTION`
    being open now widens, not narrows, what can count as funded scope. Anything that
    cannot be released as FOSS is not funded work and stays outside that scope.

## 15. Licensing posture (proposal, not settled law)

58. Proposed open-core license: **AGPL-3.0-or-later**. An additional commercial
    license is **planned**.
59. These are **proposals**, recorded in `docs/LICENSE_STRATEGY.md`. They are not a
    final legal determination and must not be presented as one.

## 16. Platform law — self-hosted on any PC, server and OS

> Owner instruction, 2026-07-30 (verbatim): *"NON DEVI FARE NULLA CHE SIA COLLEGATO AD
> UNRAID, È UN PROGETTO SELF HOSTED CHE VA SU TUTTI PC SERVER E OS"*.

60. **The host is not the product.** NOESAR EVOLUTION is self-hosted software installed by
    other people on arbitrary PCs, servers and operating systems. The machine it is
    developed on is **one deployment target, never the design target**, and the product
    never owns the host it runs on.
61. **A host-level change is never a remedy.** Rebuilding a kernel, reconfiguring the
    container runtime, delegating cgroups, installing system packages or touching boot
    configuration is out of scope — not an option to put to the Owner. A phase that can only
    pass by changing the host has not passed.
62. **Nothing may presume this host.** No kernel feature, path (`/mnt/cachec`, `/mnt/user`),
    package, Docker version, GPU or filesystem is presumed present in code, tests or docs.
63. **Capability is detected, degraded and declared.** Where a mechanism may be absent:
    detect it at runtime, fall back to a baseline that works everywhere, use better
    mechanisms opportunistically where present, and **declare per installation** which level
    is active. A limitation found on one host is a fact about a *category* of host the
    product must handle — never a blocker on the product.
64. **Portability is checked before a phase closes.** Would what this phase built work on a
    host without Landlock, without a GPU, without delegated cgroups, with different paths?
    If not, that is a defect of the phase.

## 17. Advancement duty — build for tomorrow, measure against the outside

> Owner instruction, 2026-07-30 (verbatim): *"CERCA SEMPRE UNA SOLUZIONE PER MIGLIORARE IL
> PROGETTO … FAI SEMPRE PER PENSARE AD UN DOMANI, DEVE ESSERE SEMPRE MEGLIO DI ALTRI
> PROGETTI, DEVE ESSERE UNA PIATTAFORMA AVANZATA"*.

65. **Meeting a criterion is the floor, not the goal.** After a matrix row is satisfied,
    state in one line whether a better form exists, and what it is.
66. **Design for tomorrow**: ten times the data, a poorer host, a second model, a second
    user, a year from now. A present constraint is style, not a ceiling.
67. **Every phase produces at least one concrete improvement proposal** — architecture,
    security, performance, portability or usability — with expected benefit and cost,
    recorded in `docs/DECISION_LOG.md` and named in the reply to the Owner. A phase
    reporting none has not looked.
68. **The measuring stick is external**: not "does it satisfy the matrix" but *"is it more
    advanced than what exists elsewhere, and in exactly what"*. Where the honest answer is
    no, say so and name the point.
69. **Improvement never silently widens a phase.** Generating the idea is mandatory;
    executing it in the same phase is the Owner's decision. The standing exception remains a
    defect that §40a HUNT AND FIX must repair. A portability breach (§60–64) is a **defect**,
    not an improvement, and is fixed, not proposed.
69a. **The external measuring stick of rule 68 has a named referent, since 2026-08-14**: the
    NLnet/NGI Zero Restack funding program the Owner is building this beta toward. Its
    acceptance criteria — delimited/reusable components, no mandatory vendor lock-in,
    measurable reliability, local/self-hosted operation — are recorded in
    `.claude/skills/noesar-evolution-funding-fit/SKILL.md` and apply to every improvement
    proposal this rule requires.

Governing detail: `.claude/skills/noesar-evolution-funding-fit/SKILL.md`.

## 18. Automatic Advanced Engineering Orchestrator — the standing method

> Owner instruction, 2026-08-11. This is **not** a product feature and has nothing to do with
> voice. It is the method by which every future task on NOESAR EVOLUTION is analysed,
> designed, implemented, verified and closed — chat, WebUI, memory, agents, workflows, voice,
> search, tools, security, identity, models, API/SDK, install, updates, observability,
> deployment, and every module present and future.

70. **A new substantive request from the Owner activates the orchestrator automatically**,
    however short or casual its wording. *"Controlla e rielabora la sezione Chat"* is a full
    engineering task, never a cosmetic or local edit.
71. **Claude writes the ENGINEERING CONTRACT; the Owner never fills it in.** Six sections,
    before the first edit: `ROLE`, `TASK`, `CONTEXT`, `REASONING & VERIFICATION`,
    `STOP CONDITIONS`, `OUTPUT`. `REASONING & VERIFICATION` carries assumptions, evidence,
    risks, alternatives, trade-offs, tests and results — never a transcript of reasoning.
72. **A message is classified before it is acted on.** Only a new substantive request opens a
    contract. A continuation, an answer to a question Claude asked, an Owner authorization, a
    control word (*procedi · continua · si · no*) and a read-only question open **none**, and
    are **never refused, deferred or re-scoped**.
73. **Design capability, not elements.** A function is not complete when what exists is only a
    button, a static page, an unreachable endpoint, a demo script, a mock, a placeholder, a
    component without error handling, an interface without a real backend, a backend without a
    user path, something that works once and then stops, or something not integrated with what
    already ships.
74. **Maturity is declared on the scale `L0 PLACEHOLDER · L1 PROTOTYPE ·
    L2 FUNCTIONAL_ISOLATED · L3 INTEGRATED · L4 PRODUCTION_GRADE · L5 EVOLUTION_READY`.** The
    default target of authorized implementation work is **at least L4**, with the architecture
    prepared for L5 (versioned contracts, real modularity, verifiable extension points — never
    invented technology). Where the scope cannot reach L4, the reachable level is declared
    before building. **L0–L3 is never presented as a finished product** — that is rule 38.
75. **"Advanced" is not "everything at once."** It is: define the complete professional
    objective, then ship the smallest end-to-end vertical slice that is useful, testable,
    integrated and coherent with it. Extension **points**, not extensions.
76. **Graphics, user experience and accessibility are first-class**, not polish: visual
    hierarchy, consistent components, the operational states (loading, empty, processing,
    success, warning, error), action feedback, navigation, responsive layout, perceived
    performance — and no decorative element that hides an unfinished function.
77. **Autonomy inside an agreed scope is the default.** `READ STATE → ANALYZE → CONTRACT →
    PLAN → IMPLEMENT → TEST → FIX → REGRESSION → CLEAN → UPDATE STATE → HANDOFF → STOP` runs
    without asking permission for reversible technical decisions already inside the scope.
    Work stops for: Owner decisions that change product or architecture, destructive
    operations, credential material, work outside scope, ATOM, containers and runtime,
    databases, deployment, commit, push, and unverifiable dependencies or technologies.
78. **Every claim carries its epistemic status**: `VERIFIED` (measured this session),
    `INFERRED`, `UNVERIFIED`, `BLOCKED` (with the reason). This narrows nothing in rules 36–40.

79. **The mechanical half activates only for a session whose workspace root is
    `/mnt/cachec/NOESAR_EVOLUTION`.** All four hooks — `SessionStart`, `UserPromptSubmit`,
    `PreToolUse`, `Stop` — are registered in this project's `.claude/settings.json`, which
    Claude Code loads for a session opened **at this repository** and not for one opened from
    the umbrella directory `/mnt/cachec/NOESAR`, from a parent path, or from elsewhere. Opened
    wrongly, the session silently loses the orchestrator reminder, the state digest, the
    destructive-command guard and the close guard. **Open the session here, or the mechanical
    half is not running** — and it is not running quietly, so it is never assumed.
80. **The hook is reinjection, not quality.** It guarantees the contract is *asked for* on
    every prompt of such a session; it guarantees nothing about the result. The four layers
    are distinct and are never reported as one: `HOOK` = mechanical reinjection ·
    `SKILL + CLAUDE10` = instructed engineering behaviour · `TEST` = verification of the
    governance itself · **product evidence** = the only proof of the maturity level actually
    reached. No `L4`/`L5` claim rests on a hook (rule 38).

Governing detail: `.claude/skills/noesar-evolution-engineering-depth/SKILL.md`. Its mechanical
half is `.claude/hooks/engineering-orchestrator.sh` (`UserPromptSubmit`), which injects the
rule and **never blocks anything** — the semantics live in this file and in the skill, never
in a keyword list.

---

@.claude/skills/noesar-evolution/SKILL.md
@.claude/skills/noesar-evolution-engineering-depth/SKILL.md
@.claude/skills/noesar-evolution-context/SKILL.md
@.claude/skills/noesar-evolution-verify/SKILL.md
@.claude/skills/noesar-evolution-budget/SKILL.md
@.claude/skills/noesar-evolution-funding-fit/SKILL.md
