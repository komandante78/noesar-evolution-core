# NLnet / Restack funding fit — the external measuring stick, named

Applies **only** to NOESAR EVOLUTION. Subordinate to `CLAUDE10.md`; where they conflict,
`CLAUDE10.md` wins. This skill gives concrete content to `CLAUDE10.md` §17 rule 68 ("the
measuring stick is external … is it more advanced than what exists elsewhere") and to the
project memory `noesar-evolution-funding-context`. It does not replace either.

## Why — Owner instruction, 2026-08-14 (verbatim)

*"ADESSO CREATI LA SKILL CON QUESTE FUNZIONI ISTRUZIONI DI OBBLIGO POI LEGGITI TUTTO QUESTO…
COSI COMPRENDI DA ORA CHE DIREZZIONE DEVE ANDARE IL PROGETTO E PERCHE MI SERVE URGENTE."*

The Owner is building NOESAR EVOLUTION's beta toward a funding application in the NLnet/NGI
Zero family (project memory: `noesar-evolution-funding-context`, referencing
`nlnet.nl/news/2026/20260612-NGIZero-stocktaking.html`). This skill records, verbatim in
substance, the acceptance criteria the Owner supplied, so every phase's mandatory improvement
proposal (`CLAUDE10.md` §17 rule 67) and every new-capability contract
(`noesar-evolution-engineering-depth` §2) can be checked against a program that actually
exists, not a guess about what "advanced" might mean to a grant committee.

## What NLnet does not fund, and what it does

**Not funded**: AI as a plain commercial product, or a generic ChatGPT clone.

**Funded**: AI technology that becomes open digital infrastructure —

- fully open-source code;
- local, self-hosted or decentralized operation;
- privacy and data control;
- interoperability and open standards;
- security, verifiability and reproducibility;
- utility for other developers and projects, beyond the origin product;
- independence from a single cloud vendor.

**Restack program** (the specific track this Owner is aiming at): replace proprietary
components and closed services with an open, local, interoperable, genuinely distributable
internet stack. **€7,000,000 total budget; first proposals €5,000–€50,000.**

## Categories already funded (pattern reference, not a checklist to copy)

| Category | Approved examples | Why NLnet cares |
|---|---|---|
| Local, private AI | LLM2FPGA, OpenVoiceOS, SensifAI | removes cloud dependency, keeps data under user control |
| Distributed generative infrastructure | AI Horde | shares compute to run LLMs/Stable Diffusion over free infrastructure |
| Agent reliability and control | Provability Fabric | provenance, replay, attestations, verifiable audit of AI/LLM sessions |
| Efficient, specialized AI | Spacylize | distills LLM capability into small, interpretable, private NLP models |
| ML evaluation and transparency | PyCM, PRESC | metrics, comparison, auditing, black-box model analysis |
| Causal and scientific AI | pgmpy | reusable library for causal discovery, inference, root-cause analysis |
| AI for security | Slips Immune, AI-VPN | local ML, intrusion detection, P2P cooperation, LLM security assistance |
| Open AI hardware | LLM2FPGA, open FPGA accelerator, free NPU drivers | removes proprietary toolchains/drivers/accelerators |
| Accessible AI | live-stream auto-captioning, multilingual voice assistants | AI used for real accessibility, not ornament |
| AI inside open tools | Stencila | LLMs embedded in an open, collaborative, CRDT-based scientific tool |

The broader "Data and AI" catalogue also covers open data/NLP/semantic search/knowledge-graph
infrastructure that is not necessarily ML — a wider net than "AI project" alone.

## The seven recurring traits of an approved project

1. **Delimited, realizable component.** Not "we're building universal AI" — a precise
   result: a library, protocol, runtime, driver, evaluation system, or verifiable function.
2. **Reusable result.** Useful beyond the origin product: a building block, API, library,
   spec, test suite, or reference implementation NLnet explicitly favours.
3. **Privacy and autonomy.** Local processing, self-hosting, offline-first, encryption, no
   mandatory telemetry, user control — strong positives.
4. **No lock-in.** A system depending exclusively on OpenAI, Anthropic, Google, or one
   proprietary model is a weak position — not an automatic disqualifier, but it reduces
   autonomy, reusability and strategic value.
5. **Measurable reliability.** Benchmarks, threat model, tests, reproducibility, provenance,
   audit trail, conformance suite, error handling, documentation.
6. **Ecosystem impact.** The proposal must say who will adopt it, which upstream projects it
   collaborates with, which standards it uses.
7. **Proportionate cost.** The first project normally sits in **€5,000–€50,000**, with
   concrete milestones, effort, rates and verifiable results.

## Scoring — the actual gate

- **30%** technical excellence and feasibility
- **40%** relevance, impact and strategic potential
- **30%** cost/value ratio
- Must clear **>5/7** to advance past the first phase.
- Most recent published round: **60 of 599 proposals selected (~10%)**, February 2026.

## Red flags — patterns with low odds, never propose these as the improvement

- a generic ChatGPT clone;
- a plain WebUI over commercial APIs;
- an "AI operating system" described as one huge project with no narrow milestones;
- a proprietary SaaS with one small module published as the "open" part;
- a closed model with unverifiable weights, data, or pipeline;
- training a large foundation model with no realistic data/compute/results;
- a vertical product limited to a single client;
- a token/cryptocurrency/GPU network where public utility comes after speculation;
- a system with a mandatory dependency on one private technology;
- a proposal full of unsubstantiated claims.

## How this applies to NOESAR EVOLUTION work

1. **`CLAUDE10.md` §17's mandatory improvement proposal** is evaluated against the seven
   traits above, not only "is it better than what exists". Does it name a delimited, reusable
   piece, with measurable reliability, that reduces rather than deepens lock-in to one
   proprietary provider?
2. **New-capability contracts** (`noesar-evolution-engineering-depth` §2, the six-section
   contract) get an implicit eighth question in `REASONING & VERIFICATION`: does this design
   work fully with ATOM absent or with a local/interchangeable model, or does it require a
   specific proprietary provider to function at all? `CLAUDE10.md` §14 (`FOSS_CORE_DEPENDS_ON_ATOM
   = false`) already sets this floor; this skill adds the funding reason it must never erode.
3. **This is a lens, not a phase and not new scope.** It does not authorize executing
   anything beyond what a phase already has authorization for —
   `noesar-evolution-budget` §5 stands: an NLnet-relevant idea found mid-phase is
   **recorded** in `docs/DECISION_LOG.md` and proposed, never built silently.
4. **A proposal shaped like a red flag above is not proposed as the improvement of the
   phase.** If the best idea found is a UI layer over a commercial model API with no local
   fallback, name that limitation instead of presenting it as the advancement.

---

*Deliberately under 130 lines, for the same reason the other skills are short.*
