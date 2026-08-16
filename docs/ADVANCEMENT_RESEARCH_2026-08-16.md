# NOESAR EVOLUTION — Advancement Research & Checklist

**2026-08-16.** Owner-authorized research phase (`D-0470`/`D-0471`'s native-tooling
authorization applied for the first time): "audit everything left to do, scan for what makes
NOESAR EVOLUTION a genuine *evolution* — intuitive for daily professional use, fast, stable,
forward-looking, and pushed by real research into advanced fields — without copying anything
that exists." Deliverable for this phase, per the Owner's own instruction ("crea SOLO progetto
con le tue ricerche"): this document. No product code touched.

Method: read the project's own current-state documents first (not re-derived from scratch —
`noesar-evolution-context`'s own "don't re-audit what already has evidence" rule), then two
paced, read-only research agents (Owner: "manda solo 2 agenti alla volta con calma") — one
auditing the UI for hover-discoverable documentation, one researching genuinely new advanced
directions beyond what is already proposed.

---

## Part 1 — What is actually left, grounded in the current plan

NOESAR EVOLUTION already has an up-to-date, measured work plan, dated 2026-08-14, three days
before this session — this section does not reinvent it, it verifies it against what changed
since, and adds nothing already covered there. Source: `FUNDING/07_REMAINING_WORK_PACKAGES.md`,
`FUNDING/19_WORK_PLAN_TO_BETA.md`, `FUNDING/05_CURRENT_IMPLEMENTATION_STATUS.md`.

### 1.1 The backbone is built, not planned (`VERIFIED`, 2026-08-14 session, re-confirmed by this
session's own reading — no contradicting evidence found)

`ReasoningProvider` (11 surfaces), capability tokens + minting engine, the full policy pipeline
(`AI proposes → policy decides → sandbox executes → verifier checks → audit records`), shadow
execution, CodeN Evolution's 16-stage cycle with two shells on one live session, the
three-semantics memory model, OIDC/SCIM/sector-module/Technology Radar surfaces. This is the
part `MASTER_PROJECT/09_PIANO.md` (dated 2026-07-26) and `docs/WORK_PLAN_V5_REWRITE.md` (dated
2026-08-03) still describe as "zero file" in their body tables — **both documents are stale**;
their own corrective headers already say so, `FUNDING/05` is the current replacement. Minor
doc-hygiene item, not a functional gap: re-baseline or retire those two tables in a future
phase so a cold read of them does not report false absence.

### 1.2 The lettered work-plan (Phase A–H), status verified against yesterday's session

| Phase | WP | Status | What's actually left |
|---|---|---|---|
| A | — | **DONE** (2026-08-14) | Funding dossier itself |
| B | WP7 — CE-015 / `D-0433` / 4 opportunistic findings | **Mostly closed since.** Of the 4 findings `D-0435` surfaced: `F-COMMAND-001` (legacy prompt hidden mid-type) fixed+deployed `D-0457/458`; `F-INTENT-001` (intent classifier) fixed `D-0456`; `F-PANEL-001` (workspace-actions timeout) fixed `D-0461`. **`F-SLASH-001` still open** — root cause confirmed (`D-0463`), fix needs a test-strategy pick (drive the live terminal vs. declare-and-skip). `CE-015` and `D-0433` explicitly re-scoped out: `CE-015` needs a Fase-4 subsystem ("ricerca su fonti verificate") that has zero lines of code yet — not a WP7 fix. | **Your decision on `F-SLASH-001`'s design**, or authorize a Fase-4 web-search subsystem for `CE-015` |
| C | WP6 — Portable Sandbox Manager | **DONE except one command.** `rust/crates/noesar-sandbox` extracted, independent git history, public-ready repo (`github.com/komandante78/noesar-sandbox`), CI wired, 21/21 tests from a fresh clone against the real crates.io registry. | `cargo publish`, needs `CARGO_REGISTRY_TOKEN` supplied by you out of band (`secrets/crates_io_token`) — irreversible public act, correctly yours to trigger |
| D | WP4 — Capability Token open spec | **Not started.** This is the "Fase D" named in yesterday's handoff. | Extract the token wire format, grant/scope model and anti-replay design into a versioned spec + dependency-free reference encoder/decoder. Depends on nothing else being done first (Phase C's extraction *pattern* is proven and reusable). Estimate: 1-2 person-months |
| E | WP3 + WP5 — Conformance suite + Proof-of-Session format | **Not started.** Depends on D (both reference the token's shape). | — |
| F | WP2 — Cross-platform evidence | **Not started.** Depends on C (done) — needs a second physical/cloud host class, something this repository cannot manufacture by itself. | Requires you to provide or authorize access to a second host class |
| G | WP1 — Independent pentest | **Not started, cannot be scheduled by this repository alone.** Scope is ready (153 routes catalogued, `docs/security/INDEPENDENT_PENTEST_SCOPE.md`). | Requires you to engage an external tester |
| H | WP8 — Community governance/publication | **Not started.** Depends on F for its capability matrix. | — |

### 1.3 Open findings outside this WP structure (from `PROJECT_STATE.json`, verified this session)

| Finding | Weight | What's left |
|---|---|---|
| `F-MANIFEST-001` | medium | `MANIFEST.sha256` has 5,898 entries vs. 6,568 tracked files — pre-existing gap, not caused by a recent phase |
| `F-ROT-001` | low | `NOESAR_ALLOWED_HOSTS` still names the container IP from before a token rotation |
| `F-MODEL-001` | low | `#/models` shows the endpoint but never who serves it — awaiting your choice |
| `F-I18N-002` | low | i18n catalogue gap rose 607→644, not re-baselined |
| `F7-001` | low | DebugLab full-sweep of `capabilities/` found findings, recorded, out of scope for the phase that found them |
| `F4-010/011/012/013` | low/informational | Accepted/recorded provider-URL, extraction-MIME, and ingestion-limit edge cases |
| `LICENSE_STRATEGY.md` §5, items 2-6 | — | Open, explicitly deferred to Phase 5 |
| `ATOM_EVOLUTION`'s `LICENSE` file | — | Settled (AGPL-3.0-or-later, `D-0468`), not yet written — repository still empty |
| `a3-security.mjs` live run | — | Verified only by pattern-match, needs a disposable live server+mock to run for real |

**Nothing on this list is new** — this is a synthesis, not new findings. What's genuinely new
in this phase follows.

---

## Part 2 — Hover/tooltip UX audit ("al passaggio del mouse, cosa fa quella funzione")

`VERIFIED` by a read-only Explore agent against the live source (`apps/webui-static/`, plain
HTML/JS/CSS, no framework, confirmed — ~10,733 lines of live app JS, 2 HTML files, 2 CSS files;
the ~24,500-line figure quoted earlier in this project's own docs likely includes vendored
code, not audited here since it isn't the live UI).

**The gap is real and large, not anecdotal.** Of 143 static `<button>` elements in
`index.html` alone, only 11 carry `title=`/`aria-label=`. Grep-based estimate across the whole
UI: roughly 60-75 interactive elements out of several hundred have hover-discoverable text; the
large majority — including all 12 primary navigation buttons — rely on icon+short-label only,
or nothing.

**No shared tooltip mechanism exists.** Every current hover text is the native HTML `title=`
attribute, applied ad hoc. No `tooltip.js`, no `.tooltip` CSS class, no `data-tooltip`
attribute anywhere in the codebase.

**Concrete examples, both directions:**

| Covered (has real hover text) | Uncovered (none) |
|---|---|
| `index.html:116` `#globalSearch` — full `aria-label` + `title` explaining the shortcut | `index.html:127-174` — all 12 primary nav buttons, no `title=` at all |
| `index.html:280` `#chatDictate` — explains what dictation does and where it's heard | `app.js:5072` terminal tab buttons — `role="tab"` present, no `aria-label` |
| `index.html:389` `#codenCtxChip` — explains the token-budget chip | `index.html:389` `[data-mode="OWNER_BYPASS"]` — a consequential mode switch, zero explanation |
| `index.html:1259` `#voiceFaceStop` — `aria-label` + `title` with the keyboard shortcut | `index.html:652` `#toolMutative` checkbox — "Mutative" label only, no explanation of effect |
| `app.js:68` `#codenReasoningChip` — dynamic `title` set from D-0312 accessibility work | `index.html:960-963` text-size step buttons — no `title=` |

One correction to this phase's own initial framing: the recent accessibility work
(`F-A11Y-001..003`, `D-0402`) targeted autocomplete, focus indicators and touch-target size —
**not** hover descriptions, so it does not already cover this gap despite sitting in the same
neighborhood of the codebase.

**Recommendation — smallest mechanism that actually closes it.** Not a new tooltip component:
the native `title=` attribute already renders correctly everywhere it's used today, so the fix
is coverage, not mechanism. (1) A small Node script, run in CI/pre-commit alongside the
existing ESLint step, that fails when a `<button>`/icon-only control/`role="tablist"` item in
`index.html` or in `app.js`'s generated markup lacks `title=`, `aria-label=`, or genuine visible
descriptive text — the same shape as this project's own `verify-source.mjs`/manifest checks, so
the gap cannot silently regrow once closed. (2) One pass filling in the ~130+ missing `title=`
attributes, primarily in `index.html` and `app.js`, with minor touches in `coden-terminal.js`
and `page-help.js`. No new files, no new dependency. **Not executed this phase** — Owner
instruction was research only; this is the concrete, scoped next step, sized and ready.

**Declared gap in the audit itself:** dynamically injected DOM (settings/model/tool lists
rendered from live API data) was not traced element-by-element for runtime-added `title=`
calls beyond static-source grep — some coverage may exist that this audit's method can't see,
and conversely some elements counted as "labeled" may still read ambiguously to a first-time
user despite having visible text.

## Part 3 — Original research beyond the four already-proposed components

`INFERRED`/`VERIFIED`-mixed: produced by a research agent (WebSearch-equipped, grounded first
in `noesar-evolution-funding-fit/SKILL.md` and `FUNDING/18_ORIGINAL_IMPROVEMENT_PROPOSALS.md`
so it would not duplicate the four proposals already there). Citations are the agent's own
findings, not independently re-verified by this session — label them `INFERRED` until someone
opens the links.

**Honest negative result, stated first because the Owner explicitly asked for this field:**
**nanotechnology / advanced materials has no honest software application to this project.**
NOESAR EVOLUTION is infrastructure software on commodity servers, with no sensor, fabrication
or materials-science surface. Forcing a connection would itself be the exact "unsubstantiated
claim" the funding-fit red-flags list warns against — so nothing is proposed here, on purpose.

### 3.1 Post-quantum cryptographic agility for the capability-token / audit chain — strongest fit

**What.** NIST finalized FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA) in August 2024. Adoption is no
longer theoretical: Chrome, Firefox, Edge and Cloudflare's edge already run hybrid
X25519+ML-KEM-768 by default, reported reaching 30-50% of TLS 1.3 handshakes by early 2026
(Cloudflare Radar; postquantumsecurity.org — `INFERRED`, not independently re-fetched).
**Fit.** WP4 (Capability Token) and WP5 (Proof-of-Session) both mint signed, anti-replay
artifacts — presumably classical ECDSA/Ed25519 today (`INFERRED` — this session did not verify
which primitive the live code uses). A **crypto-agility layer** (algorithm-negotiable signing,
ML-DSA as an optional hybrid signer alongside the classical one) makes the token/audit format
durable against harvest-now-decrypt-later — relevant specifically *because* Proof-of-Session
records are meant to be replayable and audited later, so their signatures must outlive the
signing algorithm's own shelf life, a property ordinary TLS traffic does not need.
**Funding-fit screen.** Scoped to one artifact (the token/audit signature), reuses
NIST-standardized primitives rather than inventing cryptography, framed as agility (works with
or without ATOM, no vendor lock-in) — not a generic "we do PQC" claim.

### 3.2 Intelligence-per-Watt as a local expert-routing signal — most original, most reusable

**What.** A Stanford/Together AI paper, "Intelligence per Watt" (arXiv 2511.07885, Nov 2025),
defines IPW = task accuracy ÷ power draw across 20+ local models and 8 accelerators on 1M real
queries — reporting a 5.3x IPW improvement 2023-2025 and local models covering 88.7% of
real-world query types (`INFERRED` — figures as reported by the agent, not re-verified).
**Fit.** NOESAR's own claim ("+46% at equal size, composing small verified experts",
`MASTER_PROJECT/09_PIANO.md`) is an accuracy/quality metric. IPW is a genuinely different,
reproducible axis missing from the existing docs. Concretely buildable: instrument the local
expert router to log accuracy-per-watt per expert per query class, and use that as a **routing
signal**, not only a benchmark — directly serves self-hosted operators on modest hardware (a
named NLnet priority), and is publishable as a small, reusable measurement harness independent
of NOESAR itself, exactly the WP3/WP4-style "standalone artifact" shape NLnet favours.
**Funding-fit screen.** Delimited (a measurement + routing module, not "efficient AI" in the
abstract); adopts a cited external metric rather than asserting an unverifiable one of its own.

### 3.3 Quantum-inspired QUBO scheduling for local task/expert placement — weakest, record only

**What.** A 2025/2026 arXiv study on quantum-inspired QUBO methods for heterogeneous workflow
scheduling — classical solvers, no quantum hardware, CPU-runnable today (`INFERRED`, citation
as reported by the agent, not independently re-fetched — the arXiv id it returned did not
resolve cleanly on inspection and should be re-verified before this is cited externally).
**Fit.** NOESAR's expert/task scheduler already picks among local experts under CPU/RAM/GPU
constraints; reformulating that placement as a small QUBO instance solved by a classical
quantum-inspired solver is a bounded, testable tweak to an existing scheduler, not new
infrastructure.
**Funding-fit screen — the agent's own honest caveat, kept as given.** Weakest of the three:
smallest, least "infrastructure," easiest to overclaim as "quantum AI." Must be pitched
explicitly as classical, hardware-free and optional (a solver swap behind an existing
interface) or it becomes exactly the red-flag framing this project screens against. **Not
proposed as a standalone WP** — recorded as a minor future optimization only.

**Priority among the three.** 3.1 first (strongest NLnet fit, plugs directly into WP4/WP5
already in motion), 3.2 second (most original, most reusable beyond NOESAR, but net-new scope),
3.3 recorded, not proposed as work.

## Part 4 — What this phase declined, and the exact rule why

| Asked | Declined because | Rule |
|---|---|---|
| A standing Unraid container dedicated to running research for me, "so tokens aren't wasted" | Would be a persistent, host-coupled service — the exact class already removed once (`noesar-debuglab`) for being tied to one host. Only a *disposable, offline, read-only, same-phase* analysis container is authorized, and only for HUNT AND FIX. | `CLAUDE10.md` §5 rule 16, §16 rules 60-63 |
| Literal quantum-computing / nanotechnology R&D | NOESAR EVOLUTION is software running on ordinary self-hosted servers — there is no hardware lab to open. Translated into real software-applicable fields instead (post-quantum cryptography, quantum-inspired classical algorithms, formal verification) in Part 3, and any field found to have no honest software application is named as such rather than forced. | `noesar-evolution-funding-fit` red-flags list — "unsubstantiated claims" |

## Part 5 — Recommended priority, all parts landed

Four independent tracks, none blocking another — pick by what matters most to you next:

| Track | Ready to start? | Size | Depends on you for |
|---|---|---|---|
| **`cargo publish`** (Phase C's last step) | Yes, right now | one command | your `CARGO_REGISTRY_TOKEN` |
| **Phase D — Capability Token spec (WP4)** | Yes, right now | 1-2 person-months | nothing — no external dependency, no open design question |
| **Hover/title coverage fix (Part 2)** | Yes, right now | ~130 attribute additions + one CI check, 2-3 files mainly | nothing — scoped and sized |
| **PQC crypto-agility for tokens/audit (3.1)** | Needs design first | unscoped — a new capability, not a bug fix | your authorization to open an ENGINEERING CONTRACT for it |
| **Intelligence-per-Watt routing (3.2)** | Needs design first | unscoped — net-new measurement + routing logic | your authorization, and it's the most original but least de-risked of everything here |
| `F-SLASH-001` | Blocked | — | your test-strategy pick (`D-0463`) |
| Phase F/G (cross-platform, pentest) | Blocked | — | a second host / an external tester |

**This session's honest recommendation, one line each:** the hover/title fix is the highest
ratio of "professional-user impact" to "effort" of anything in this document — it is the most
direct answer to "simple and intuitive for people who work with it daily," and it is fully
scoped, needing only your go-ahead. Phase D is the highest-value unblocked *architectural*
work. Direction 3.1 (PQC agility) is the strongest candidate to become NOESAR EVOLUTION's fifth
original component if you want the research pushed into an actual proposal next.
