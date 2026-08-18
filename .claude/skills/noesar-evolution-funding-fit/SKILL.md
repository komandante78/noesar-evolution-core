# Funding fit — the named platforms, their licence terms, and the rule they impose

Applies **only** to NOESAR EVOLUTION. Subordinate to `CLAUDE10.md`; where they conflict,
`CLAUDE10.md` wins. This skill gives concrete, **sourced** content to `CLAUDE10.md` §17 rule 68
("the measuring stick is external") and rule 69a, which names this file as its governing detail.
It replaces nothing in rules 36-40: every claim below carries the date it was read.

## Why — two Owner instructions

**2026-08-14, verbatim:** *"ADESSO CREATI LA SKILL CON QUESTE FUNZIONI ISTRUZIONI DI OBBLIGO POI
LEGGITI TUTTO QUESTO… COSI COMPRENDI DA ORA CHE DIREZZIONE DEVE ANDARE IL PROGETTO E PERCHE MI
SERVE URGENTE."*

**2026-08-18, verbatim:** *"nelle skills di noesar evolution dovrebbe esserci il riferimento per
richiesta del finanziamento https://nlnet.nl/news/2026/20260612-NGIZero-stocktaking.html o
piattatorme simili, verifica queste piattaforme cosa vogliono di licenze ed altro e devi
aggiornare la skills che deve fare riferimento a queste piattaforme di finanziamento sui
requisiti che chiedono e lavorare su questo tassativamente"*

The second instruction is why this file now carries **URLs and verification dates** instead of
remembered criteria. It was justified: between the two instructions, the programme this skill was
built around **ended**.

## 0 — What changed, and why nothing here may be quoted from memory

**Read 2026-08-18 · `[VERIFIED]` · <https://nlnet.nl/news/2026/20260612-NGIZero-stocktaking.html>**

NGI Zero is **concluding** after a decade: ~1,215 projects funded across five NGI Zero programmes,
plus ~215 through adjacent ones, from >10,000 applications. **Open calls are temporarily paused**;
regular submissions resume **after summer 2026**. The Commons Fund's final call closed
**2026-06-01**. Three successor programmes launch under the **Open Internet Stack** (€10M):
**Restack**, **CodeSupply**, **ELFA**.

**The lesson is procedural and binding:** this skill was written on 2026-08-14 describing an open
programme that had in fact closed on 2026-06-01. **Nothing here is quoted to the Owner without
re-reading its source first.** A funding criterion is not a fact about the world; it is a fact
about a programme on a date.

## 1 — The platforms, what they require, and whether this project can apply

Every row read **2026-08-18**. `[VERIFIED]` = read from the source named. Re-read before use.

| Platform | Funds | **Licence requirement** | Who may apply | Money · status |
|---|---|---|---|---|
| **Restack** (NLnet, Open Internet Stack) <br><https://nlnet.nl/restack/> | "new internet commons across the technology stack, from libre chips to middleware **without vendor lock-in**", local-first infrastructure, end-user apps | *"Project results shall always become available under a recognised free or open source license."* **Dual licensing explicitly allowed** — copyright holders "may deal with your project results under **additional** licenses, even proprietary ones". No OSI/FSF list named, no copyleft-vs-permissive preference stated. | **No categorical exclusion of anyone.** EU / Horizon-associated countries get priority on equal proposals; outside them, "a clear European dimension" is required. Minors may apply. | **€5,000–50,000** per grant, €7M to 2030 · **"Coming soon"** on 2026-08-18 |
| **CodeSupply** (NLnet pilot) <br><https://nlnet.nl/> | software **supply-chain** tooling: correct, trusted, verified software metadata as an open, federated, sovereign catalogue | same NLnet rule: results under a recognised free/open licence | consortium pilot | launching after summer 2026 |
| **ELFA** — Encrypted Local First Architecture (NLnet) <br><https://nlnet.nl/ELFA/> | decentralised collaboration, private workspaces, **end-to-end encrypted** app suites | same NLnet rule | 13-organisation consortium + open calls | deadline **2026-08-01** for the round read |
| **Sovereign Tech Agency / Fund** (DE, public) <br><https://www.sovereign.tech/> | **critical open base technologies** other software depends on; also Fellowship, Resilience, Standards programmes | *All code and documentation must be licensed to be freely reusable, changeable, redistributable.* **OSI-approved or FSF Free/Libre for code**; documentation under Creative-Commons-like terms **with no `NC` and no `ND` clauses.** | maintainers of infrastructure others depend on | rolling programmes |
| **Prototype Fund** (DE) <br><https://www.prototypefund.de/en> | early prototypes with social value; since 2025 focused on **data security and software infrastructure** | results must be published under an open source licence | **residence or company seat in Germany — hard requirement.** Individuals / teams of max 4 | application window **1 Oct – 30 Nov 2026** |
| **EU Sovereign Tech Fund (EU-STF)** <br><https://eu-stf.openforumeurope.org/> | proposed pan-European fund for critical open digital infrastructure | not yet defined | — | **Advocacy/research phase, NOT accepting applications** on 2026-08-18. Track it; do not plan on it. |

**Two rows are disqualifiers and are stated as such rather than left to be discovered:** the
Prototype Fund requires a German seat, and EU-STF does not exist as a programme yet.

## 2 — The licence answer, which is what the Owner asked for

**What every platform above demands, in one line:** the results must be published under a
**recognised free/open source licence**. None of them accepts a proprietary-only release, and none
of them accepts "open in name" — a licence with a non-commercial or no-derivatives clause is
explicitly refused by the Sovereign Tech Agency for documentation, and would not be a free licence
anywhere else either.

**Three consequences for this project, and only the first is settled:**

1. **`CLAUDE10.md` §15's AGPL-3.0-or-later posture is compatible with every platform above, and so
   is the planned commercial licence.** NLnet states the dual-licence case explicitly: a copyright
   holder "may deal with your project results under additional licenses, even proprietary ones".
   Open core + a separate commercial licence is not a disqualifier. `[VERIFIED]` — Restack FAQ.
2. **Whether a component meant for adoption should be more permissive is still open.** Copyleft is
   not penalised by these programmes, so the argument for a permissive licence on
   `packages/verified-acquisition` (`D-0526`) is about **adoption**, not about eligibility. That is
   the Owner's decision and this skill does not take it.
3. **Documentation licensing has a rule this project has never stated.** `NC` and `ND` clauses
   disqualify under the Sovereign Tech Agency's terms. If this project ever licenses its docs
   separately from its code, it must not reach for a `CC BY-NC` out of habit.

**What no source above says, and must therefore not be claimed:** that a specific licence is
preferred; that OSI approval is required by NLnet (only the Sovereign Tech Agency names OSI/FSF);
that proprietary *dependencies* are forbidden — NLnet permits them provided the funded part is
open and **does not itself depend on closed technology**, and warns that "technology that can only
be used with an individual closed source application will not adequately scale".

## 3 — What they fund, beyond the licence

**Not funded:** AI as a plain commercial product; a generic ChatGPT clone.

**Funded:** AI technology that becomes open digital infrastructure — fully open code; local,
self-hosted or decentralised operation; privacy and data control; interoperability and open
standards; security, verifiability and reproducibility; utility to other developers beyond the
origin product; independence from a single cloud vendor.

**Restack's own words set the bar this project is measured against:** *"middleware without a
vendor lock-in"*, and proposals must *"fit within the goal of an Open Internet Stack and make a
concrete contribution to bring that goal closer."*

**Eligible cost categories, read from Restack's eligibility page** — useful because they say what a
proposal may actually contain: research and FOSS/open-hardware development · technical validation
and engineering improvement · **security audits, testing infrastructure, formal proofs** ·
documentation and educational material · standards participation · usability and inclusive design ·
packaging and deployment · event participation (IETF, FOSDEM, hackathons) · project management and
essential infrastructure.

## 4 — The seven recurring traits of an approved project

1. **Delimited, realizable component.** Not "we're building universal AI" — a precise result: a
   library, protocol, runtime, driver, evaluation system, or verifiable function.
2. **Reusable result.** Useful beyond the origin product: a building block, API, spec, test suite,
   or reference implementation.
3. **Privacy and autonomy.** Local processing, self-hosting, offline-first, no mandatory telemetry.
4. **No lock-in.** Depending exclusively on one proprietary model or cloud is a weak position — not
   an automatic disqualifier, but it reduces autonomy, reusability and strategic value.
5. **Measurable reliability.** Benchmarks, threat model, tests, reproducibility, provenance, audit
   trail, conformance suite, error handling, documentation.
6. **Ecosystem impact.** Who adopts it, which upstreams it works with, which standards it uses.
7. **Proportionate cost.** €5,000–50,000 for a first grant, with concrete milestones and verifiable
   results.

**Scoring — the actual gate:** 30% technical excellence and feasibility · 40% relevance, impact and
strategic potential · 30% cost/value ratio. Must clear **>5/7** to pass the first phase. Most
recent published round: **60 of 599 selected (~10%)**, February 2026.

## 5 — Red flags. Never propose one of these as the phase's improvement

A generic ChatGPT clone · a plain WebUI over commercial APIs · an "AI operating system" as one huge
project with no narrow milestones · a proprietary SaaS with one small module published as the
"open" part · a closed model with unverifiable weights, data or pipeline · training a large
foundation model with no realistic data/compute/results · a vertical product for a single client ·
a token/cryptocurrency/GPU network where public utility comes after speculation · a system with a
mandatory dependency on one private technology · a proposal full of unsubstantiated claims.

## 6 — The rule this imposes on every phase — *tassativamente*

1. **Every mandatory improvement proposal (`CLAUDE10.md` §17 rule 67) names, in the same line,
   which platform of §1 it would fit and which of §4's seven traits it satisfies.** "It is better"
   is not the standard; "it is a delimited, reusable piece that reduces lock-in and can be
   measured" is. **"Fits none" is a valid answer and is written as such** — a guard repair or an
   internal cleanup fits no funding programme, and a stretched claim is worse than an honest no.
   Enforced by the templates that already bind — `noesar-evolution-budget` §3 and
   `noesar-evolution` §MENTALITÀ point 3 — and deliberately **not** by a hook: a check that
   grepped for a platform name would police wording rather than substance (`D-0531`).
2. **Every new-capability contract** (`noesar-evolution-engineering-depth` §2) answers an implicit
   eighth question in `REASONING & VERIFICATION`: does this work fully with ATOM absent, or with a
   local/interchangeable model — or does it require one proprietary provider to function at all?
   `CLAUDE10.md` §14 (`FOSS_CORE_DEPENDS_ON_ATOM = false`) already sets the floor; this is the
   funding reason it must never erode.
3. **A criterion is re-read before it is relied on.** Section 0 is the proof of why: this file
   described an open programme two months after it closed. Before any submission, before any claim
   to the Owner about what a programme wants, **fetch the source and re-date the row**.
4. **This is a lens, not new scope.** `noesar-evolution-budget` §5 stands: an idea found mid-phase
   is recorded in `docs/DECISION_LOG.md` and proposed, never built silently.
5. **A proposal shaped like a §5 red flag is not offered as the phase's improvement.** If the best
   idea found is a UI over a commercial model API with no local fallback, name that limitation
   instead of presenting it as the advancement.

## 7 — What is NOT verified here

- **Restack's application form, review timetable and reporting duties** — the fund read "Coming
  soon" on 2026-08-18. `[UNVERIFIED]`, and it is the first thing to read when calls reopen.
- **Whether this project, as it stands, would place.** No submission has been made and no assessor
  has seen it. Nothing in this file is a prediction of an outcome.
- **Any platform not listed above.** Absence here means "not looked at", never "not suitable".

---

*Sourced 2026-08-18 from nlnet.nl (stocktaking, restack, restack/eligibility, restack/faq, ELFA),
sovereign.tech, prototypefund.de and eu-stf.openforumeurope.org. Re-verify before use.*
