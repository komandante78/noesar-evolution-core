---
name: noesar-evolution-engineering-depth
description: MANDATORY the moment the Owner presents a new substantive request in NOESAR EVOLUTION, however short or casual the wording. Imposes the Automatic Advanced Engineering Orchestrator - classify the message, rebuild the component's real state, write the six-section ENGINEERING CONTRACT for the Owner, set measurable acceptance criteria, target maturity L4 with the architecture ready for L5, and deliver a whole production-grade vertical slice instead of a button, a mock or an unreachable endpoint. Use before scoping, before planning and before the first edit of any request touching chat, WebUI, memory, agents, workflows, voice, search, tools, security, identity, models, API/SDK, install, updates, observability, deployment or any present or future module.
---

# Automatic Advanced Engineering Orchestrator

Applies **only** to NOESAR EVOLUTION. Subordinate to `CLAUDE10.md` section 18; where they
conflict, `CLAUDE10.md` wins. It **adds a standard, it removes no rule**: the phase cycle
(`noesar-evolution`), the verification tiers (`noesar-evolution-verify`), the read economy
(`noesar-evolution-context`) and the length caps (`noesar-evolution-budget`) all still bind.

This is **not** a product feature and has nothing to do with voice. It is the method by
which every future task on this project is analysed, designed, built, verified and closed.

## 0 — Where it activates, and what it does not promise

**Activation boundary (`CLAUDE10.md` rule 79).** The mechanical half — all four hooks — is
registered in this project's `.claude/settings.json` and runs **only for a session whose
workspace root is `/mnt/cachec/NOESAR_EVOLUTION`**. A session opened from the umbrella
directory `/mnt/cachec/NOESAR`, from a parent path, or from anywhere else loads different
settings and fires none of them: no orchestrator reminder, no state digest, no
destructive-command guard, no close guard. Open the session **here**.

**Four layers, never collapsed into one claim (`CLAUDE10.md` rule 80):**

```text
HOOK              mechanical reinjection of the contract requirement — nothing more
SKILL + CLAUDE10  the instructed engineering behaviour
TEST              verification of the governance itself, not of the product
PRODUCT EVIDENCE  the only proof of the maturity level actually reached
```

A green hook suite says the reminder arrives. It never says the work is `L4`. Claiming
otherwise is a false PASS (`CLAUDE10.md` rule 38).

## 1 — Classify the message first. Only one kind opens a contract.

| Kind | Example | What it opens |
|---|---|---|
| **A · new substantive request** | *"Controlla e rielabora la sezione Chat."* | a **new ENGINEERING CONTRACT** |
| **B · continuation of an active contract** | *"vai avanti con il punto 3"* | nothing — carry the active contract |
| **C · answer to a question you asked** | *"la prima"*, *"usa Postgres"* | nothing — resume where you stopped |
| **D · Owner authorization** | *"AUTORIZZO COMMIT …"* | nothing — it unblocks a step already scoped |
| **E · control word** | *procedi · continua · si · no · ok · basta* | nothing |
| **F · read-only / informational** | *"quanti test ci sono?"* | nothing — answer it and stop |

**B, C, D and E are never refused, never deferred and never re-scoped.** Treating an
authorization as a new request is the failure this table exists to prevent: it stalls work
the Owner has already approved.

**Kind A is recognised by what it asks for, not by its length.** Four words that name a
component and a verb (*"rielabora la sezione Chat"*) are a full engineering task. A request
that only *looks* cosmetic ("il colore e brutto") is still kind A when answering it
honestly requires touching a real path — say so, then do the work.

**When two readings are genuinely equivalent and the choice changes the product, ask.**
One question, with a recommendation, and every part that does not depend on the answer
already delivered.

## 2 — The ENGINEERING CONTRACT. You write it; the Owner never fills it in.

For every kind-A request, before the first edit, emit six sections:

```text
ROLE                     the engineering posture this task needs
TASK                     the single capability this makes true, in one sentence
CONTEXT                  measured state: files, surfaces, layers, live facts, what is absent
REASONING & VERIFICATION assumptions, evidence, risks, alternatives, trade-offs, tests+results
STOP CONDITIONS          what ends the work, and what stops it dead
OUTPUT                   what will be delivered, with acceptance criteria that are measurable
```

`REASONING & VERIFICATION` carries **conclusions and evidence only** — declared assumptions,
what was measured, the risks, the alternatives that lost and why, the tests and their
results. It is never a transcript of internal reasoning, and it is never a wall of prose:
the caps in `noesar-evolution-budget` section 3 apply to it like everything else.

**Every claim carries its epistemic status**, always, with no exception for claims that feel
obvious: `VERIFIED` (measured in this session) · `INFERRED` (derived, not run) ·
`UNVERIFIED` (asserted, not checked) · `BLOCKED` (cannot be established, with the reason).

## 3 — The thirteen automatic steps of a kind-A request

1. rebuild the component's **real** state from disk and from the running system — never from
   memory, never from a previous session's summary;
2. name the **user's end goal**, not the literal sentence;
3. reconstruct the **end-to-end path** the user actually walks;
4. name every layer involved: frontend, backend, API, data, memory, agents, tools, security,
   identity, runtime;
5. judge **graphic quality, user experience and accessibility** as first-class, not as polish;
6. find the **functional and architectural gaps**, including the ones nobody reported;
7. define the **complete professional capability** this component should have;
8. set **measurable acceptance criteria** — a criterion no row measures is not closed
   (`noesar-evolution` rule 5);
9. design a **production-grade vertical slice**;
10. leave **extension points** for what comes next, without building it (no overengineering);
11. implement **only the authorized scope**;
12. verify with **evidence produced in this session**;
13. **update project state at close** — state, handoff, decision log.

## 4 — Capability, not element. What "done" is never allowed to mean.

A function is **not** complete when what exists is only: a button · a static page · an
endpoint nothing reaches · a demo script · a mock · a placeholder · a component with no
error handling · an interface with no real backend · a backend with no user path · a
capability that works once and then stops · something not integrated with the system
already shipped.

**Depth checklist — apply the rows that are pertinent, and say which ones are not:**
end goal · full user journey · component boundaries · versioned API/ABI/event contracts ·
frontend+backend really joined · state and persistence · concurrency, cancellation,
idempotency · authentication and authorization · security, privacy, isolation · errors,
timeouts, retries, fallbacks · graceful degradation and recovery · latency, CPU, RAM, GPU,
storage · structured logging, metrics, tracing · accessibility and responsive design ·
design-system consistency · operational visual states · unit, integration, e2e and
acceptance tests · upgrade, migration, rollback · forward compatibility · documentation and
handoff.

**Professional graphics means, where pertinent:** a clear visual hierarchy · consistent
components · the states **loading, empty, processing, success, warning, error** · feedback
for every action · comprehensible navigation · responsive layout · accessibility ·
perceived performance · and **no decorative element that hides an unfinished function**.

## 5 — Maturity ladder

```text
L0 PLACEHOLDER   L1 PROTOTYPE   L2 FUNCTIONAL_ISOLATED
L3 INTEGRATED    L4 PRODUCTION_GRADE          L5 EVOLUTION_READY
```

- The default target of authorized implementation work is **at least L4**.
- The **architecture** is prepared for L5: versioned contracts, real modularity, verifiable
  extension points. L5 never means inventing technology that does not exist.
- If the authorized scope cannot reach L4, **declare the level actually reachable** before
  building, and name what is missing.
- **L0-L3 is never presented as a finished product.** That is a false PASS
  (`CLAUDE10.md` rule 38), the most serious violation in this project.

"Advanced" does not mean implementing every imaginable feature in one session. It means
defining the complete professional objective and then shipping **the smallest end-to-end
vertical slice that is useful, testable, integrated and coherent with that objective**.

## 6 — Autonomy, and where it ends

Once scope and authorization are clear, run this without asking permission at each step:

```text
READ STATE -> ANALYZE -> ENGINEERING CONTRACT -> PLAN -> IMPLEMENT -> TEST -> FIX
-> REGRESSION -> CLEAN TEMPORARY RESOURCES -> UPDATE STATE -> HANDOFF -> STOP
```

**No confirmation is asked for reversible technical decisions already inside the scope.**
Asking anyway is its own failure mode: it stalls authorized work.

**Stop and ask** for: Owner decisions that change the product or the architecture ·
destructive operations · anything involving credential material · work outside the agreed
scope · ATOM · containers and runtime · databases · deployment · commit · push ·
dependencies or technologies that cannot be verified.

Clean-up is part of the loop, not an afterthought: **whatever this work created for a
transient purpose, this work removes** (`CLAUDE10.md` section 5a, `noesar-evolution` step 13).

## 7 — How this coexists with the economy skills

| Tension | Resolution |
|---|---|
| depth vs. token budget | depth is in **what is measured**, never in the length of the prose |
| complete capability vs. scope defence | define the complete objective, **build the authorized slice**, record the rest |
| L5-ready vs. no overengineering | build extension **points**, not extensions |
| improvement duty vs. one phase at a time | generate the proposal always, execute only when the Owner says so |

## 8 — The path to final delivery (Owner, 2026-08-15)

This section governs the run from **wherever the project stands today** to the five final
delivery ZIPs, without re-auditing what is already proven and without stopping at every
intermediate file. It does not replace the phase cycle (`noesar-evolution`) — it is the shape
each phase on this path takes.

1. **State what already works from existing proof, not a fresh audit.** A capability with a
   passing test or a live verification already on record is accepted as working; re-auditing
   it is waste, the same waste `noesar-evolution-context` names for re-reading a file.
2. **Freeze a checklist of what is actually missing** before writing code. Order it by
   dependency (what blocks what) and by criticality — not by file order or convenience.
3. **Implement each missing requirement whole**: code, configuration, UI, error handling and
   tests together, not code now and tests "later" — rule 73's "capability, not element" applies
   to every line of the checklist, not just the first one built.
4. **Do not stop after one file or one small win.** The unit of "done" on this path is the
   phase's whole authorized slice of the checklist, not any single item inside it.
5. **A missing secret does not stop the work around it.** Build the configuration slot and its
   validation, leave the value empty, continue everything that does not depend on it, and
   collect every such gap into **one** final list — never several scattered stops.
6. **An error gets a root cause, a minimal diff, and a verification — never a retry loop.**
   Guessing a fix and re-running is not debugging; `CLAUDE10.md` §40a's "reproduce → root
   cause → fix the cause → prove it" is the only loop this runs.
7. **Test targeted during the work; the full suite once, at the final gate.** Re-running green
   suites mid-phase is the exact waste `noesar-evolution-verify` §"single-pass rules" already
   forbids — this is that rule, restated for the delivery path specifically.
8. **Fix only what blocks.** A non-blocking anomaly found along the way is documented — in
   `docs/DECISION_LOG.md` or as an open finding — and does not reopen or re-scope the phase.
9. **The commercially-necessary surface is whole, not partial**: installation, configuration,
   WebUI, runtime, offline access control, hardware backend, security, update, rollback,
   documentation, tests, uninstallation. A product missing any one of these is not "done with a
   gap" — it is not done.
10. **Access control is registration, not a license key.** Owner, verbatim: *"la licenza con
    codice non la metterei, farei fare solo registrazione utente per usare il prodotto"*. This
    project already builds an owner/account system (`AuthService`, first-owner setup token,
    MFA) for the product's own reasons; a second, code-based license-activation layer would be
    new attack surface and new complexity in tension with §8's offline-by-default rule and this
    project's AGPL open-core posture (§14-15) — commercial differentiation belongs in support,
    hosting or proprietary ATOM modules, never in crippling the FOSS core behind a key check.
    Settled: no license key, ever, on this path. Registration is the whole mechanism.
11. **Verify the product, not just the code**: a clean install, first start, the primary use
    path, a restart, an update and a rollback — each one actually run, not inferred.
12. **Package the five archives of the *delivery* instance**, each with its manifest, version,
    checksum, SBOM, provenance and signature. **The five positions are enumerated in exactly one
    place — `MASTER_PROJECT/09_PIANO.md` §4a — and nowhere else, this skill included.** Repeating
    the list here is how a second, drifting copy is born; `tools/verify-five-archives.mjs` holds
    the single copy and proves it still matches the sealed instance's own filenames.
    **Corrected `D-0588`:** this step used to call the delivery set *"a different five, unrelated"*
    to `CLAUDE10.md` rule 34's five *source* ZIPs. That is wrong in a way that mattered — measured,
    the two carry the **same five titles**, because they are the same five positions in two
    instances: the V4 package **received** and sealed (rule 34 keeps it out of the repository), and
    the package this project must **produce**. So the disambiguation is never "which list" — there
    is one list — it is always **which instance**, and it is stated every time. The collision this
    project was already burned by (`L0-L8`, `02_ATOM.md`) was one vocabulary with two referents;
    calling them unrelated lists was that same mistake being answered with a second error.
13. **Compare the five delivery archives against the frozen checklist from step 2.** All criteria pass →
    declare the product complete and **stop** — no further phase is opened uninvited. Something
    truly indispensable still missing → name **only** the precise blocker and the exact datum
    needed to close it, nothing broader.

The standing rule underneath all thirteen: work from where the project truly stands to the
five deliverables, without widening scope, without re-running what is already proven, and
without a full stop at every intermediate step — the phase cycle's own STOP still applies at
the end of whatever slice was authorized, not before it.

---

*232 lines, measured — not "deliberately under" a number picked before writing it.*
