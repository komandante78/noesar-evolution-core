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

---

*Deliberately under 175 lines, for the same reason the other four skills are short.*
