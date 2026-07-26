# CodeN Evolution — Design v1

**Status:** proposal. Nothing here is implemented.
**Date:** 2026-07-26
**Scope:** the CodeN Evolution workspace of NOESAR Evolution, in both its shells.

This document answers questions 1 and 2 left open by WebUI proposal v2, and turns the
Owner's capability list into a design that belongs to this product. The list described a
generic agentic coding environment. Reproducing it would have produced another one of
those. What follows keeps the ambition of the list — all of it, and more where the list
stopped short — and rebuilds it around the one thing this product has that the others do
not: **ATOM**.

---

## 0. The two answers

### 0.1 The name is CodeN Evolution

Settled by the Owner. `MASTER_REFERENCE/04_AI_PLATFORM/47_CODEN_ULTRA_PRODUCT_SPEC.md`
still files it under the old name and should be renamed so the specification and the
product stop disagreeing. That is a documentation change, tracked, not a silent edit.

### 0.2 One program, two shells

CodeN Evolution is **one program**. The WebUI and the SSH client are two shells over the
same engine, the same session, the same state.

```text
                         ┌──────────────────────────────┐
   browser ──────────────┤                              │
   (WebUI shell)         │   CodeN Evolution engine     │
                         │   sessions · plans · tokens  │
   ssh user@host codev ──┤   memory · audit · sandbox   │
   (terminal shell)      │                              │
                         └──────────────────────────────┘
```

This is not "a terminal drawn in a web page" and not "a CLI that talks to a server". Both
shells **attach to a live session**. You start a task in the browser, walk away, `ssh` in,
attach, and you are looking at the same plan mid-flight — same stage, same pending
authority request, same log tail. Detach from one and the task keeps running; it belongs
to the engine, not to the window.

Consequences that shape everything downstream:

- **The session is the unit of state**, not the connection. Shells are stateless viewers.
- **Every capability must render in both shells.** A feature that only works with a mouse
  is not finished. A diff, an authority prompt, a task board and a repository map each
  need a keyboard-complete terminal form, designed at the same time as the graphical one.
- **The protocol between shell and engine is public and versioned.** A third shell — an
  editor plugin, a mobile viewer, a CI reporter — is then a client, not a fork.
- **`ssh` is the transport, not a mode.** The terminal shell over a local TTY and over SSH
  are the same client; remote is the deployment, not a different product.

---

## 1. The one rule

> **The engine cannot change anything except by executing an authorized Plan.**

This is the architectural spine, and it is what separates CodeN Evolution from every tool
in the category the Owner's list describes.

In a conventional agentic IDE, a language model emits tool calls and a guard layer tries
to catch the dangerous ones. The model is in the driving seat and safety is a filter
bolted in front of it. Every escape in that design is a hole in the filter.

Here the model **cannot emit actions at all**. It produces language and hypotheses. A
`ReasoningProvider` — ATOM, or the public reference provider — converts hypotheses into a
**Plan**: a typed, versioned object carrying constraints, a risk classification, a
simulation result, evidence and a confidence figure. A human authorizes the Plan. The
Permission Engine mints **capability tokens** from the authorized Plan. The executor
accepts nothing but capability tokens.

```text
  request ─▶ model ─▶ hypotheses ─▶ ATOM ─▶ PLAN ─▶ human ─▶ tokens ─▶ executor
              ▲                              │                          │
              └──── may only propose ────────┘         may only act ────┘
                    (no action surface)                (no proposal surface)
```

The model has no action surface. The executor has no proposal surface. Nothing bridges
them but a Plan a person signed. A prompt-injected file can therefore ask for anything it
likes: the worst it can do is get a hypothesis into the pile, where it arrives as a
proposal with a source, a risk class and a person about to read it.

This one inversion collapses most of the security chapter of the Owner's list into a
structural property rather than a list of defences.

---

## 2. ATOM — the heart

`43_ATOM_PRIVATE_PROVIDER_BOUNDARY` defines ATOM as a proprietary reasoning and
orchestration provider behind a public versioned contract, with a **functional** reference
provider in the public core, and the standing constraint that public builds and funded
demonstrations can never require or expose ATOM. Risk `R-001` classes "public core
unusable without ATOM" as *Critical*.

Design consequence, and it is the hinge of the whole project: **ATOM must never be a
capability gate. It is a quality gate.** Everything works without it. With it, the same
things work better — deeper causal search, stronger simulation, higher-confidence plans,
larger tasks attempted safely.

### 2.1 What ATOM is asked for

The contract is the engine's only route to a Plan. Every method is mandatory; the
reference provider implements all of them honestly, if plainly.

| Contract surface | What the engine sends | What comes back |
|---|---|---|
| `interpret` | the request, the project rules, the repository map digest | an **Intent Frame**: goal, non-goals, success criteria, ambiguities to resolve |
| `hypothesize` | the Intent Frame, retrieved evidence | ranked **causal hypotheses**, each with support and contradicting evidence |
| `plan` | the chosen hypotheses, constraints, mode | a **Plan**: ordered steps, files, commands, dependencies, blast radius |
| `constrain` | the Plan and the active policy | the Plan narrowed, or refused with a reason |
| `simulate` | the Plan against a shadow workspace | predicted diff, predicted test outcome, predicted failure modes |
| `classify` | the Plan | a **risk class** per step, and a single class for the Plan |
| `confidence` | the Plan and the simulation | a figure with the reasons it is not higher |
| `evidence` | any claim the engine will show a person | the sources that support it, or an explicit "inference, unsupported" |
| `cancel` | a running plan | a clean stop that leaves a resumable checkpoint |
| `fixtures` | a session id | a deterministic replay bundle |

`interpret`, `hypothesize`, `plan`, `simulate` and `classify` are the load-bearing five.
The others are what make the product honest.

### 2.2 The maturity ladder, and what it actually unlocks

Private ATOM may implement L0–L8 maturity, proprietary causal search, evolutionary
evaluation and protected optimizations. In this design the ladder is not marketing: **the
provider's declared maturity determines which operating modes the engine will offer**, and
the UI says so plainly rather than hiding a degraded experience.

| Level | What the provider can do | Modes it unlocks |
|---|---|---|
| L0–L2 | interpret, single-hypothesis plans, static risk classing | Read-only, Plan |
| L3–L4 | ranked competing hypotheses, dependency-aware blast radius | Guarded edit |
| L5–L6 | simulation against a shadow workspace, predicted test outcomes | Guarded execute |
| L7–L8 | multi-step causal search, self-critique, evolutionary evaluation of alternative plans | Sandboxed autonomous |

The public reference provider sits honestly at L2–L3: it plans, it classes risk, it
refuses to claim simulation it cannot perform. So the public build gives you a real,
useful, safe assistant that stops at guarded edits — which is exactly what
`55_GRANT_COMPATIBILITY` needs, a fully buildable core free of private dependencies. With
ATOM attached the same product will attempt a two-hour refactor across forty files,
because now something can simulate it first.

**The ladder is visible.** The top bar carries the provider name and level. If a mode is
unavailable, the reason given is "the attached reasoning provider does not do simulation",
not a greyed-out button.

### 2.3 ATOM never touches the outside world

ATOM reasons. It has no filesystem handle, no shell, no network, no model credentials. It
receives digests and evidence bundles the engine prepared, and returns objects. This is
what makes a private provider safe to attach at all: attaching ATOM cannot widen the
product's blast radius, because the provider has no blast radius. `25_INTERFACE_AND_EVENT_CONTRACTS`
already states the general rule — *adapters cannot self-grant permissions* — and here it
is load-bearing.

---

## 3. The task lifecycle

`47_CODEN_ULTRA_PRODUCT_SPEC` fixes ten stages. This design expands them to sixteen,
because the ten collapse several distinct decisions into single words. The original ten
remain identifiable and none is dropped.

```text
 1  Intake              the request, verbatim, with its constraints
 2  Interpret           Intent Frame — goal, non-goals, success criteria       [ATOM]
 3  Clarify             ambiguities resolved with the person, or recorded as assumptions
 4  Survey              repository map, entry points, ownership, recent change
 5  Retrieve            evidence gathered — code, docs, tests, history, prior tasks
 6  Hypothesize         ranked causes or approaches, with support and contradiction [ATOM]
 7  Plan                ordered steps, files, commands, dependencies             [ATOM]
 8  Blast radius        what else this touches — dependents, APIs, data, other agents
 9  Simulate            shadow workspace: predicted diff, predicted test outcome [ATOM]
10  Classify            risk per step and for the plan                          [ATOM]
11  Authorize           the human decision — scoped, timed, revocable
12  Checkpoint          snapshot taken before the first mutation
13  Execute             capability tokens spent, step by step, cancellable
14  Verify              targeted tests, then broadening, then the full suite
15  Review              diff, evidence bundle, residual risk, what was not done
16  Settle              accept · commit · patch · rollback
```

Stages 2, 6, 7, 9 and 10 are the provider's. Stage 3 is the one most tools skip: a request
with an unresolved ambiguity produces confident work aimed at the wrong target, and the
cheapest moment to catch that is before the plan exists.

Stage 9 is the one that makes large autonomous work defensible. A simulation that predicts
the diff and the test outcome, run against a shadow copy, turns "let it try and see" into
"it already tried, here is what happened".

Stage 15 has an explicit **"what was not done"** slot, and it is mandatory. A report that
lists only successes teaches you to trust it uniformly, which is the opposite of useful.

---

## 4. Capability tokens — one grammar for every authorization

The Owner's list has separate authorization dialogs for commands, for files, for network,
for plugins. That produces four consent habits and four places to get it wrong. Here there
is one.

An authorized Plan mints **capability tokens**. A token is:

```text
capability   write | read | exec | net | db | connector | plugin | promote
resource     an exact path, command, host, table, or memory scope
scope        this step | this task | this session | this project
expiry       a wall-clock deadline, always present
uses         a count, usually 1
conditions   sandbox profile, resource ceilings, required checkpoint
issued_for   plan id + step id + the human who granted it
signature    engine-signed, non-transferable
```

Properties that follow, and are worth stating because they are the point:

- **The executor has no ambient authority.** With no token it can do nothing at all — not
  even read. There is no "default allow" surface to escape into.
- **A token cannot be widened**, only spent or revoked. An agent that discovers it needs
  one more file must go back to a human; it cannot reinterpret its own grant.
- **Revocation is immediate and global.** One panel lists every live token across every
  session with a revoke on each, and a single control that revokes all of them.
- **Every token spend is an audit event** carrying plan, step, actor, resource and result.
  Reconstruction is not a log-parsing exercise; it is a replay.
- **Denials are first-class.** A refused request is recorded with the same weight as a
  granted one, because the pattern of what the agent keeps asking for is diagnostic.

### 4.1 The authority prompt, in both shells

Graphical and terminal forms carry identical information, and the terminal form is not a
degraded copy:

```text
  ⚑ AUTHORITY REQUESTED                        plan 7f3a · step 4 of 11 · risk MEDIUM

    write   services/auth/session.mjs                          +34 −8
    write   services/auth/session.test.mjs                     new file
    exec    npm test -- auth                                   ~40s, no network

    blast radius   5 dependents · 1 public API unchanged · no schema change
    simulated      diff applies clean · 12 tests pass · 1 new test fails as intended
    checkpoint     will be taken before the first write
    rollback       available · single command
    expires        15:00

    /grant once   /grant task   /grant project   /deny   /why   /simulate again
```

`/why` is not decoration. It returns the hypotheses that produced this step and the
evidence behind them. An authorization prompt you cannot interrogate is a prompt you
learn to approve blind.

A single keypress never grants anything. In a terminal, `y` is one paste away from being
typed by something that is not you.

---

## 5. Operating modes

Seven, ordered by what the engine is permitted to do. The mode is always visible, always
in the top bar and the terminal prompt, and colour is never its only indication.

| Mode | The engine may | It may not |
|---|---|---|
| **Read-only** | read, search, index, explain, consult history | write, execute, reach the network |
| **Plan** | everything above, plus produce and simulate plans | apply anything |
| **Guarded edit** | write to files named in an authorized plan, one group at a time | run commands beyond formatters |
| **Guarded execute** | run allowlisted commands, tests, builds, formatters | network, database, privileged commands, without a fresh grant |
| **Sandboxed autonomous** | work unattended inside an isolated workspace, container, restricted network, ephemeral credentials | touch anything outside the sandbox; escalate; persist beyond the task without review |
| **Owner Bypass** | widened authority for a named purpose | exist quietly, or last |
| **Recovery** | restore checkpoints, inspect state, produce reports | make forward progress |

**Owner Bypass** deserves its own paragraph because it is where products in this category
get careless. It requires re-authentication, not just a click. It is granted **for a stated
purpose**, with a duration measured in minutes. It paints the entire interface with a
persistent treatment nobody can mistake for normal — a border, a banner, and in the
terminal a prompt that changes shape. It is written to an immutable audit record before it
takes effect, not after. It expires on its own and cannot be renewed silently; renewal is
a fresh decision. And leaving it is one keystroke from anywhere.

**Recovery mode** is not in the Owner's list and is added deliberately. When a task has
gone wrong, the instinct is to keep going. A mode where forward progress is impossible and
only inspection and restoration are available is how you stop a bad session from becoming
a bad day.

---

## 6. Memory — three semantics, and the walls between them

WebUI v2 established two separated stores at the Owner's instruction. The coding workspace
adds a third, and the separation is enforced by schema and by row-level security, not by
convention at call time.

| | **Product semantics** | **Work semantics** | **Task semantics** |
|---|---|---|---|
| Holds | how the product works, your conventions, procedures, Owner memory | your documents, knowledge graph, repository index, embeddings, citations | files read this task, command output, the plan, errors, test results |
| Lifetime | permanent | as long as the project | the task, then discarded |
| Trust | authoritative | **untrusted data, always** | untrusted |
| Leaves the machine | never without a grant | **never without an explicit, single-item, logged grant** | never |
| Feeds a prompt | yes | only under an active grant | yes, within the task |

**The walls, stated as rules:**

1. **Nothing is promoted automatically.** `44_MEVCM` requires validation, policy, conflict
   detection, a contamination canary, human approval and audit before untrusted content
   becomes authoritative. Promotion is a deliberate act with a record. Reading a file is
   not promotion. Neither is being told something by a file.
2. **Repository content is untrusted data.** `46` states document text never becomes system
   authority; the same applies to source, comments, READMEs, commit messages, issue text
   and dependency metadata. A repository can request; it can never instruct.
3. **Projects cannot see each other.** Task semantics are scoped to a task, work semantics
   to a project, and the row-level security already verified in the completion gate carries
   the boundary. Cross-project contamination is a schema-level impossibility, not a policy.
4. **A `PROJECT_RULES` file is authoritative — because you wrote it.** Languages, versions,
   conventions, commands, forbidden paths, completion criteria, security requirements. It
   is the one file in a repository that carries authority, it is authenticated as yours on
   first sight, and a change to it is surfaced for confirmation rather than absorbed.

### 6.1 Context management

Token estimation before sending. Relevant-section retrieval rather than whole files.
Summarization of old turns with the originals retained and addressable. **Per-agent context
isolation** — a reviewing sub-agent must not inherit the implementer's context, or it will
agree with it. And a hard rule: the engine reports what it sent, so "why did it not know
that" has an answer instead of a shrug.

---

## 7. Understanding the repository

The map is built incrementally, on open and then on change, never as a blocking full scan.

**Extraction:** language and framework detection, package managers, configuration, entry
points, modules, classes, functions, public API surface, database schemas and migrations,
tests and their targets, CI pipelines, containers, infrastructure definitions.

**Structure:** AST parsing via Tree-sitter for breadth, Language Server Protocol where a
server exists for depth, fast literal search, a symbol index, and a semantic index in the
work-semantics vector store. Dependency graph, call graph, import graph, and the history
graph from Git.

**Signals the map carries that a file tree does not:**

- **Ownership and recency** — who last touched this, how often it changes.
- **Test coverage per module**, and which tests actually exercise a given file.
- **Criticality** — reached from an entry point, in the authentication path, touching
  persistence or money.
- **Fragility** — churn against defect history; where fixes keep landing.
- **Ambiguity** — where the map is uncertain, marked as uncertain rather than smoothed over.

Selecting any node reveals related files, dependents and dependencies, associated tests,
recent change, open findings, and the tasks that previously touched it. That last one
compounds: the workspace gets better at a repository the longer it works on it, without
ever writing your code into product semantics.

---

## 8. The interface

Multipanel, technical, dense, and identical in capability between the two shells.

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ project · workspace · branch · model · provider L4 · mode · context 38% ·      │
│ local-only ✓ · sandbox ● · cpu/gpu · git ↑2 · notifications · settings         │
├──────────────┬─────────────────────────────────────┬───────────────────────────┤
│ NAVIGATOR    │ WORKBENCH (tabbed)                  │ AGENT                     │
│              │                                     │                           │
│ projects     │ editor · diff · tests · logs        │ conversation              │
│ recent       │ terminal · preview · repo map       │ plan — 16 stages, live    │
│ sessions     │ documentation · problems            │ hypotheses & evidence     │
│ tasks        │                                     │ tool activity             │
│ agents       ├─────────────────────────────────────┤ files read / written      │
│ tools        │ TERMINAL — multiple, persistent     │ commands run              │
│ plugins      │ build · test · server · logs        │ authority requests        │
│ history      │                                     │ sub-agents                │
│ favourites   │                                     │ residual risk             │
├──────────────┴─────────────────────────────────────┴───────────────────────────┤
│ stage 9/16 · 4 files · 12/13 tests · 2 warnings · 3 processes · ↑2 · 41k tokens │
│ · €0.00 local · 04:12 elapsed · net blocked · sandbox active · 2 live tokens    │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Every panel is dismissible and dockable**, and the layout is remembered per project.
Multi-monitor by detaching panels into windows. The terminal shell reaches the same panels
as full-screen views with a leader key, and the status line carries the same bottom bar.

**Components:** syntax-highlighted editor with minimap, breadcrumbs and inline diagnostics;
project tree; side-by-side and inline diff; multiple persistent terminals; problems panel;
test panel; activity timeline; task board; command palette; non-blocking notifications;
authority dialogs; progress indicators; drag-and-drop; context menus; resizable layout.

**State colours** are semantic and never the sole signal — each pairs with a glyph and a
word: safe (green ✓), running (blue ◐), authority requested (amber ⚑), error (red ✕),
destructive (deep red ⚠), read-only (grey ○), sandboxed (violet ◈).

**Accessibility is a build requirement, not a setting:** complete keyboard navigation,
adjustable type, a genuine high-contrast theme, screen-reader semantics on live regions so
streaming output is announced without flooding, reduced motion, interface zoom, full
localization, automatic language and timezone detection with manual override.

### 8.1 The home screen

Open project · clone repository · new project · import archive · connect remote · resume
last session. Then recent activity, scheduled tasks, available models with their
provenance, service health and installed tools.

Quick actions phrased as objectives, because the Intent Frame starts from an objective:
analyse this repository · find and fix a bug · implement a feature · generate missing
tests · review security · update dependencies · explain the architecture · improve
performance · prepare a release · review my changes.

---

## 9. Sub-agents and parallel work

A coordinator decomposes an objective and assigns work. Specialists: architecture,
backend, frontend, test, security, documentation, performance, and a **reviewer**.

**The reviewer is structurally independent.** Separate context, separate model where
possible, and it never sees the implementer's reasoning — only the diff, the tests, the
Plan and the stated criteria. A reviewer that inherits the implementer's context inherits
its blind spots and produces agreement, not review.

**Isolation is real, not scheduling.** Concurrent agents work in separate Git worktrees,
separate containers, or separate workspace copies. Two agents cannot hold write tokens for
the same file; the coordinator serializes or splits the work. Merge is an explicit stage
with its own diff and its own authorization.

Every task shows state, owning agent, elapsed time, files, tools, result, errors, and a
cancel that actually kills the process tree rather than orphaning it.

---

## 10. Verification

The engine decides what to run from what changed, and widens as confidence is required:
targeted tests for touched modules, then their dependents, then type checking and lint,
then the build, then the full suite. Integration, end-to-end, contract, API, database,
container, security scans and benchmarks are available and selected by relevance.

```text
  change ─▶ targeted tests ─▶ failure analysis ─▶ correction ─▶ retarget
                                                        │
                     bounded iterations, configurable ──┘
                                                        ▼
                            broaden ─▶ full suite ─▶ diff review ─▶ report
```

The iteration bound is configurable and **enforced**. An agent that has failed the same
test four different ways has not found the cause and should stop and say so, which is more
useful than a fifth attempt.

**Bug work is test-first by construction:** reproduce, write the regression test, watch it
fail for the right reason, fix the cause, watch it pass, run the suite. A fix that arrives
without a test that failed before it is reported as unverified, in those words.

---

## 11. Checkpoints, rollback and replay

Checkpoints are automatic before every task, every mutation group, every dependency
change, every migration, every high-risk command and every commit. Each carries a file
snapshot, Git state, the Plan, commands run, relevant output, dependency versions and
session configuration.

Restore granularity is per file, per change group, per whole workspace — or **only the
conversation**, **only the plan**, **only tool state**. Being able to rewind the agent's
reasoning while keeping your code is a distinct and frequently wanted operation.

**Deterministic replay** is the property the `fixtures` contract surface exists to give,
and it is the strongest audit claim in this design. The event log carries id, type, schema
version, UTC time, actor, tenant, correlation, causation, resource, classification and
payload digest. With the fixture bundle, an entire session can be re-executed and must
produce the same plans, the same decisions and the same diffs. That turns "explain what the
agent did last Tuesday" from an interpretation of logs into a re-run.

---

## 12. Models

A gateway with no hardcoded provider. Local runtimes and remote APIs behind one adapter
contract. Per-task routing: a small fast model classifies, an economical one searches, a
strong one plans and edits, a **different** one reviews, a local embedding model indexes.
Fallback chains, cost and token ceilings, timeouts, bounded retries, streaming throughout.

Every model carries provenance, licence, hash, signature, format, resource requirements,
validated context length, benchmark evidence and advisories — and the interface shows them
before you select one.

**Detection and recommendation are automatic; installation is not.** Driver installation,
runtime installation, model download and any host mutation are authorized actions with a
capability token, never an initiative. The engine will tell you precisely what it needs
and what it would run.

Credentials are encrypted at rest, injected per process, rotatable, and redacted from every
log, prompt, report and error path. Redaction is verified by a canary in the test suite, on
the principle that a redactor nobody tests is a redactor that has already failed.

---

## 13. Extension

Adapters (`ReasoningProvider`, `ModelRuntimeAdapter`, `HardwareProbeAdapter`,
`VectorStoreAdapter`, `ObjectStoreAdapter`, `IndustryModuleProvider`,
`CompliancePackProvider`, `HostBridgeAdapter`) are the frozen, versioned seams. Plugins are
built on them.

A plugin declares identity, version, capabilities, and **exactly** the permissions it
wants — filesystem scope, network hosts, shell binaries, database access. It is signed,
checksummed, sandboxed, version-pinned, auditable, removable cleanly, and disablable
instantly.

**A plugin cannot self-grant.** Its manifest is a request; the Permission Engine issues the
tokens, the same tokens everything else uses, and a plugin acting beyond its declaration is
stopped by the executor rather than caught by review.

Connectors — repositories, issue trackers, CI, documentation, databases, APIs,
observability, storage, registries, remote hosts — each get their own scope, their own
credential, their own duration, their own audit trail, their own revoke, and their own
network boundary. Connecting one changes the privacy indicator, visibly, before data moves.

---

## 14. Security

Most of it is already implied by section 1 and section 4. What remains:

Filesystem sandbox with the workspace as an explicit mount; process sandbox with
namespaces and cgroup ceilings; **network denied by default**, allowed per host under a
token; automatic secret redaction; destructive command classes blocked outright and not
merely warned about; privilege escalation blocked; database protection; timeouts; resource
quotas; an immutable append-only audit ledger; signed updates with anti-rollback; plugin
integrity verification.

Path protections are enforced at the executor and re-checked after resolution: no writes
outside the workspace, no traversal, no symlink escape, no blind overwrite, no mass
deletion without an explicit and separately-classed authorization, no `.env` or secret
modification without a distinct grant.

**Secrets appear nowhere** — not in chat, not in logs, not in commits, not in reports, not
in plaintext storage, not in prompts. Vault or OS keychain, ephemeral credentials, injected
only into the process that needs them, masked at the sink rather than at the source, so a
new code path cannot forget to mask.

---

## 15. Audit and the final report

Recorded: user, session, model, provider and its level, prompts, tools, files read, files
written, commands, authorizations granted **and denied**, results, errors, checkpoints,
cost, duration. Append-only, tamper-evident, and exportable.

Every task ends with a report in a fixed shape, in both shells:

```text
  OBJECTIVE        what was asked, and how it was interpreted
  ASSUMPTIONS      ambiguities resolved without asking, and how
  PLAN EXECUTED    stages reached, stages skipped and why
  CHANGED          files, with the reason for each
  COMMANDS         what ran, and what it returned
  VERIFIED         tests run · passed · failed · not run, and why not
  EVIDENCE         every claim above, linked to its source
  RESIDUAL RISK    what could still be wrong
  NOT DONE         what was asked for and not delivered
  CHECKPOINT       how to undo all of it
  STATE            accepted · pending commit · rolled back
```

`ASSUMPTIONS`, `NOT DONE` and `RESIDUAL RISK` are mandatory and may not be empty without
saying so. A report that only lists what worked is how you train someone to stop reading
reports.

---

## 16. Data model

`User` · `Workspace` · `Project` · `ProjectRules` · `Session` · `Task` · `TaskStage` ·
`IntentFrame` · `Hypothesis` · `Plan` · `PlanStep` · `Simulation` · `RiskClassification` ·
`Agent` · `SubAgentRun` · `Model` · `ModelRoute` · `Tool` · `Adapter` · `Plugin` ·
`Capability` · `CapabilityToken` · `AuthorizationDecision` · `CommandExecution` ·
`FileOperation` · `Checkpoint` · `TestRun` · `Finding` · `Connector` · `SecretReference` ·
`EvidenceItem` · `AuditEvent` · `Notification` · `ScheduledTask` · `ReplayFixture`.

`AuthorizationDecision` records denials as well as grants. `EvidenceItem` is referenced by
anything shown to a person, which is what makes the evidence column of the report possible
rather than aspirational.

---

## 17. Architecture and stack

```text
    WebUI shell (browser)        Terminal shell (TTY / SSH)
              └───────────┬───────────────┘
                 session protocol — public, versioned, streaming
                          │
         ┌────────────────▼─────────────────┐
         │        CodeN Evolution engine     │
         ├───────────────────────────────────┤
         │ Session Manager   Task Scheduler  │
         │ Agent Orchestrator                │
         │ Context Manager   Memory (3 sem.) │
         │ Reasoning Gateway ──▶ ReasoningProvider  (reference | ATOM)
         │ Model Gateway     Tool Registry   │
         │ Permission Engine ──▶ capability tokens
         │ Checkpoint Manager  Audit Service │
         │ Plugin Manager    Connector Broker│
         └────────────────┬──────────────────┘
                          │  tokens only
              ┌───────────▼────────────┐
              │    Sandbox Runtime      │
              └───┬────┬────┬────┬─────┘
              files shell  git  browser  tests  connectors
```

**Stack, chosen against what this product already is rather than from a generic
recommendation.** Two deliberate departures from the Owner's list are worth naming:

- **PostgreSQL with pgvector, not SQLite.** The list suggests SQLite for a first version
  with PostgreSQL only for multi-user. This product already runs PostgreSQL 18.4 with
  pgvector as a supervised child process inside its single container, with row-level
  security enabled and forced on fifteen tables and per-user and per-project isolation
  verified live. Dropping to SQLite would throw away the isolation that makes the three
  memory semantics enforceable, and would have to be undone immediately. One store,
  RESTRICTIVE policies, no regression.
- **Shells over a session protocol, not a Tauri desktop app.** The list proposes Tauri.
  This product is a server reached over loopback or LAN, and the Owner's requirement is one
  program in an SSH form and a WebUI form. A desktop wrapper is a later packaging decision
  over the same protocol, not the architecture.

Otherwise: Node for the engine and Rust crates where the work is systems-shaped —
sandboxing, process supervision, filesystem enforcement, indexing. Tree-sitter for parsing,
LSP for depth, fast literal search for breadth, Git natively. Containers with namespaces
and cgroups for isolation. Object storage for logs, checkpoints and evidence bundles.
Streaming over the session protocol. Telemetry off by default and off unless asked, always.

---

## 18. Delivery

**Stage 1 — the honest MVP.** Open a repository, one shell then the second, chat,
read and search, Read-only and Plan modes, the Intent Frame, the reference provider,
capability tokens, guarded edit with diff review, integrated terminal, tests and build,
Git status and diff, checkpoints and rollback, one agent, project rules, complete audit,
the final report, local sandbox.

**Stage 2 — the workspace becomes a workspace.** Both shells at parity, simulation,
sub-agents and the independent reviewer, parallel tasks in worktrees, the repository map,
semantic index, guarded execute, integrated browser and preview, signed plugins, external
connectors, scheduled tasks, cost dashboard, deterministic replay.

**Stage 3 — ATOM's range.** Sandboxed autonomous mode, multi-step causal search,
evolutionary plan evaluation, distributed orchestration across machines, task-aware model
routing, organizational policy, centralized audit, industry modules, a plugin marketplace
with signing and review.

**Definition of done for Stage 1** — it is finished when it can open a real repository,
understand its structure, take a request, produce a plan, obtain authorization, change
several files, show the diff, run the tests, correct a failure, produce a verifiable
result, restore the previous state on demand, record every operation, and **never once step
outside the authority it was given** — with that last clause proven by a test suite that
tries to make it happen.

---

## 19. What I deliberately did not carry over

Named, so the omissions are decisions rather than oversights.

- **A separate authorization dialog per subsystem.** Collapsed into capability tokens. Four
  consent habits are four chances to build the wrong reflex.
- **"The agent updates dependencies."** Kept as an objective, but dependency installation is
  a token-gated action with a checkpoint, never an initiative — host mutation is prohibited
  by `41_MODEL_GOVERNANCE` and the same principle applies here.
- **Optional cloud execution and a mobile app.** Not rejected, deferred: both are egress
  surfaces, and this product's local-first commitment has to be designed *through* them
  rather than around them. That is a conversation, not a bullet.
- **Telemetry as a default.** Off by default and stays off.
- **Single-keypress confirmation anywhere.** Removed on purpose.

---

## 20. Open decisions for the next session

1. **How far does Sandboxed autonomous go without a person?** A time limit, a file-count
   limit, a "stop at the first surprise" rule — or all three.
2. **Where do the shells diverge, if at all?** My position is nowhere, which is expensive
   and is the reason to decide it now rather than discover it later.
3. **Does CodeN Evolution ship inside the single container, or as a second supervised
   process?** It affects the update path, the rollback story and the OCI image.
4. **Does the reference provider get simulation?** It would raise the public build to L5 and
   move the whole product's honest floor upward — and it narrows ATOM's advantage. That is a
   commercial decision, not a technical one.
5. **Renaming `47_CODEN_ULTRA_PRODUCT_SPEC`** in the master reference, and whether the
   master specification is amended or annotated.
