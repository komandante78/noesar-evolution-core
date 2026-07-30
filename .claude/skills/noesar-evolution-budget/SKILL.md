---
name: noesar-evolution-budget
description: MANDATORY before the EXECUTE step of any NOESAR EVOLUTION phase and before writing any documentation, handoff, decision entry or session write-up. Imposes a declared phase contract with a token/tool budget, a stop-and-ask rule when the budget breaks instead of grinding on, and hard length caps with fixed templates for the decision log, the installation ledger, the handoff and the reply to the Owner. Use at the start of a phase, at the 60% checkpoint, and before writing prose.
---

# Phase budget and prose discipline — small phases, short records

Applies **only** to NOESAR EVOLUTION. Subordinate to `CLAUDE10.md`.
Owner instruction, 2026-07-27: *"senza spendere sessioni di 1 ora e passa di token"*.

The cost of a phase is not mostly the thinking. It is **(a)** loading state that was not
needed, **(b)** verifying what did not change, **(c)** writing history at essay length.
The first two have their own skills. This one covers the third, and the size of the phase
itself.

## 1 — Declare the contract before executing

Before the EXECUTE step, state this, in **six lines**, and get no further until it holds
together:

```text
OBJECTIVE   one sentence — the single thing this phase makes true
FILES       the files expected to change (a list, not "various")
TIER        T0 / T1 / T2 / T3 (see the verify skill), and whether it installs
READ        the digest + the ranges to be read  (see the context skill)
BUDGET      expected tool calls, e.g. ~25
STOP        the observable condition that ends this phase
```

A phase whose FILES list cannot be written before starting is not scoped — it is a hope.
Split it and say so.

## 2 — The budget is a tripwire, not a target

- At **60% of BUDGET**, emit one line: what is done, what remains, on track or not.
- At **150% of BUDGET**, **stop**. Report what is complete and verified, what is not, and
  propose the split. Do not push on to "finish anyway": an hour-long phase is not a phase
  that was hard, it is a phase that should have been two.
- Discovering that the work is larger than declared is a **normal, reportable outcome**.
  Grinding silently is the failure.
- A blocked or ambiguous point does not stop everything: do every part that does not depend
  on it, then put the question to the Owner with the rest already delivered.

## 3 — Length caps, with the templates that satisfy them

Measured 2026-07-27: decision entries in `docs/DECISION_LOG.md` run **30–40 lines each**,
and `docs/SESSION_HANDOFF.md` is 293 lines. Every future session pays to scroll past both.

**Decision entry — 6 fields, ≤ 12 lines, appended:**

```markdown
## D-0xxx · <what was decided> — <UTC date>
**Decision.** one or two sentences.
**Why.** the reason, not the story.
**Rejected.** the alternative and the one reason it lost.
**Evidence.** the command/test/file that proves it, with counts.
**Reversal cost.** what breaks if this is undone — or "none".
**Status.** applied / installed / deferred (+ blocker id).
```

**Installation ledger entry — ≤ 20 lines**: tag, UTC, what changed, verification lines
(health, bytes-equal-tree, surfaces answered), the preserved predecessor, and the rollback
cost. No narrative.

**`docs/SESSION_HANDOFF.md` — ≤ 150 lines**, rewritten, in this order: next action first,
then blockers, then what was verified, then what was **not** done. History belongs in the
decision log; the handoff describes *now*. If it exceeds the cap, cut history, never the
next action.

> **Measure the cap, do not intend it.** Measured 2026-07-30: the handoff was **382 lines —
> 2.5× the cap**, because every phase prepended its own `D-0xxx` section and none ever cut the
> tail. A cap nobody measures is not a cap. **Run this before closing the phase:**
>
> ```sh
> wc -l docs/SESSION_HANDOFF.md   # must be ≤ 150
> ```
>
> Over the cap, delete **whole trailing `## ➜ <D-0xxx>` sections** — they are already in
> `docs/DECISION_LOG.md`, which is the file that owns history. Deleting a duplicate is not
> losing information; keeping it is paying for it every session. What is never cut: the next
> action, the open blockers, and what was **not** done.

**Reply to the Owner — ≤ 25 lines** unless more is asked: what changed, the verification
counts, what is open, **one improvement proposal**, one recommendation. Findings go in a
table, not in paragraphs. Any session write-up produced outside this repository obeys the
same cap.

**Improvement proposal — one line, mandatory, every phase** (`noesar-evolution` §MENTALITÀ):
the single best thing that would make the platform more advanced than what exists elsewhere,
with its expected benefit and its cost. It is **recorded and proposed, never executed
silently** — see §5. A phase that reports no proposal has not looked.

## 4 — Do not narrate what is already written

- The reply does not restate the handoff, and the handoff does not restate the decision log.
  Each fact is written **once**, in the place that owns it, and referenced elsewhere.
- No preamble ("I will now…"), no recap of what the previous turn already established, no
  restating of a rule this skill already imposes.
- Corrections: make them and continue. Do not audit your own earlier phrasing.
- One exception, and it is not negotiable: what was **not** done, what was skipped, and what
  is `[UNVERIFIED]` is always stated in full, however short the rest is. Brevity is taken
  out of narration, never out of honesty.

## 5 — Scope defence

Everything found that is outside OBJECTIVE goes to `docs/DECISION_LOG.md` for a later
phase — with one exception already binding: a defect the HUNT AND FIX step is required to
repair (`CLAUDE10.md` §40a). "While we are here" is how a 25-call phase becomes a
250-call one.

**How this coexists with the duty to improve, so the two are never in conflict.** The
`noesar-evolution` skill requires *looking for* a better solution in every phase; this section
forbids *executing* it uninvited. Both hold at once:

| Found mid-phase | Do |
|---|---|
| a defect in scope for HUNT AND FIX | **fix it now** — already binding |
| a better design for what this phase is building | **say it before building**, then build the agreed one |
| a better design for something else | **record + propose**, do not touch |
| a portability breach (host-coupled code) | **treat as a defect**, not an improvement — the platform law is not optional |

Generating the idea is mandatory. Executing it in the same phase is the Owner's call. The
failure mode this prevents is a phase that silently triples because every improvement was
taken as authorisation.

Adding a new top-level key to `PROJECT_STATE.json`, a new document to `docs/` (80 already),
or a new tool to `tools/` is a scope decision, not a detail: name it in the contract or do
not do it.

---

*This skill is deliberately under 110 lines, for the same reason it exists.*
