# SESSION HANDOFF — NOESAR EVOLUTION

Last updated: 2026-08-12 · `phase_status = DEPLOYED_AND_VERIFIED`
**`origin/main` is behind and nothing is pushed** — for how far, run `git status -sb`: a number
written here goes stale on the next commit.

**The installation is NEW**: `noesar-evolution:d0397-agents-20260812T163057Z`, live since
16:32Z. It carries `D-0397` **and** Voice V1 (`D-0388`), which had been committed and never
installed. Details in `docs/INSTALLATION_LEDGER.md`, last entry.

---

## ➜ LA PROSSIMA AZIONE — due cose, in quest'ordine

### 1. A2 — still not done, and the recipe in the last handoff was WRONG

**It is now worth more than before**: the installation is new, so the same run also proves the
deployment end to end.

The old recipe said *"send one chat message and read the reasoning indicator"*. Measured this
session: **a chat message does not touch that indicator.** `updateReasoningChip()` has exactly
one caller in the whole product — `app.js:2966`, the answer of `POST /api/v1/workspace-actions/plan`.

```text
1. https://192.168.178.100:8443  →  sign in
2. go to  #/coden/agent/plan     (panel titled "Plan", badge "No plan yet")
3. fill the goal + at least ONE file path (+ File), press "Create plan"
   — NOT the "Plan run" form in #/agents: that one writes two canned steps and asks no provider
4. read BOTH:
     chip  reasoning atom | reasoning reference (degraded: …)   (CodeN top bar)
     line  provider: …                                          (#planResult box)
```

`atom` on the chip is a **negative** proof (`degradationSummary()` says `atom` when zero
degradation events exist); `provider:` is the **positive** one — it names who answered. A2 passes
only if both say `atom`. The container is **new**, so measure its log from **its own start** —
the old marker at 426 lines (`EVIDENCE/a2_log_marker_2.txt`) belongs to the container that was
replaced and no longer applies.

*While you are signed in:* `#/agents` now has a list with **Test** and **Archive**, and the run
that sat in `planned` shows **Ask the model**.

### 2. Answer `D-0395` — the `#/models` in-use lane

`phi-4-q4_k_m` is genuinely resident (10,348 of 12,288 MiB, RTX 3060) served by container
`atom-evolution-model` at `http://172.22.0.4:8420`. Choose: **(a)** the product must not present
another deployment's runtime as *"on this installation"* (product change, no runtime action) ·
**(b)** unload and reload (a container outside this project — explicit authorisation) ·
**(c)** a different model.

**Then:** `git push origin main` (never forced) · a short phase closing `F-A11Y-001..003` with a
single audit run · OCI phase O1. **The deployment is done** — see the ledger.

---

## ➜ WHAT HAPPENED THIS SESSION (2026-08-12, third sitting)

The Owner reported that on `#/agents` nothing said what to type, a created agent could not be
tested, and it could not be removed. All three were real, and one was structural (`D-0397`):

Measured before the change (full detail in `D-0397`): `view-agents` had **5 inputs, 0
placeholders, 0 hints**; `archived` was written at creation and filtered on read while **nothing
could set it**; `#runForm` built `Analyze goal` with no `toolId`, which `executeStep` refused with
`409`, so **every run this screen created was unfinishable**; and `grep -c reasoning
agent-service.mjs` was **0**.

**Built:** guidance on all five controls · an agent list with **Test** (one real, non-mutative
turn) and **Archive** · `PATCH /api/v1/agents/:id` (`agent.manage` + CSRF) · a tool-less step now
executed by the model through the same `providers.route` → `completeWithFallback` path Chat uses,
**never** through `ChatOrchestrator`, so a test writes nothing into the operator's chat history.

---

## ➜ WHAT WAS VERIFIED — measured in **this** sitting

| Check | Result |
|---|---|
| full unit suite | **2402 pass · 0 fail · 1 skip** (2403 tests, 254 suites) |
| the 3 repair tests | **seen red first** against the `409`, then green |
| new assertions | **11** across `ai-agent-service.test.mjs` + `agents-archive-http.test.mjs` |
| ESLint | **392 files, 0 errors, 0 warnings** |
| `tools/verify-source.mjs` | `SOURCE_VERIFY=PASS migrations=19 baseline=12/12 intact` |
| `tools/auth-http-smoke.mjs` · `tools/http-smoke.mjs` | `PASS` · `PASS` |
| IT translation coverage | **856/856 (100%)** — 17 new markup strings, 13 runtime strings declared in `RUNTIME_ONLY` |
| the archive is honest | proved against `/api/v1/ai/bootstrap`, the payload the screen actually renders — not only against `/api/v1/agents` |
| **T2 · browser suite** | `BROWSER_E2E_TOTAL=472 · PASS=472 · FAIL=0` — disposable probe built from source, removed by the suite itself |
| **T2 · WCAG 2.2 AA audit** | `A11Y_TOTAL=27 · PASS=24 · FAIL=3` — all three pre-existing, `D-0400` |
| **T3 · image bytes = tree** | 5 of 5 files identical by `sha256sum` inside the image vs on disk, **before** any mutation |
| **T3 · the live installation serves the new bytes** | `GET /app.js` → `bc4f5fc4e05c…`, the tree's own checksum |
| **T3 · health after deployment** | `docker inspect` = `running healthy` · `/livez` **200** · `/readyz` **200** · children `postgres api codev atom` · auth-failure lines **0** |
| **§5a cleanup** | containers **53 → 52**, networks **10 → 10**, volumes **63 → 63**, non-project containers **50 → 50**; two project containers survive, zero `webui-e2e` tags, zero per-run networks |
| **`D-0401` · browser suite re-run** | `BROWSER_E2E_TOTAL=475 · PASS=475 · FAIL=0` — three new `AGENTS-1` steps create an agent, read the card's controls (`{"test":"Test","archive":"Archive agent","goalField":true}`) and archive it through the confirm, leaving `{"cards":0,"options":["Select agent"]}` |

---

## ➜ WHAT WAS **NOT** DONE — declared

- **Nothing is pushed.** `origin/main` is behind; see `git status -sb`.
- **`D-0401` is committed but NOT deployed.** The installation still serves the previous label, so
  in Italian the button reads «Archivio» (a place) instead of «Archivia agente» (the action).
  A second deployment of the same §3a sequence is what changes it — Owner's call.
- **Three WCAG 2.2 AA failures were found and NOT repaired** (`F-A11Y-001..003`, `D-0400`). All
  three are pre-existing — this phase's commits touch those elements **zero** times — and two of
  them change the geometry of the CodeN composer, which is a design decision, not a mechanical
  fix. They were already live before this deployment and still are.
- **`F-MANIFEST-001` still not fixed** (`D-0399`).
- **A2 was NOT performed** — it needs a signed-in session and no automation here holds a
  credential. Nothing requiring a session is proven by the deployment.
- **A2 was NOT performed** — it needs a signed-in session and no automation here holds a
  credential. The corrected recipe is at the top of this file.
- **`F-MANIFEST-001` recorded, not fixed** (`D-0399`): `MANIFEST.sha256` has **5898** entries
  against **6568** tracked files and zero entries for files earlier phases added. Pre-existing,
  out of this phase's scope, and nothing verifies it — so nothing ever went red.
- **`F-MODEL-001` and `F-HOOK-005` remain open**, neither root cause found.
- **The sensitive rotation backups are kept**, `0700`/`0600`:
  `BACKUPS/atom_token_rotation_20260812T121329Z/` and `…T130147Z/`.
- **No restore-from-archive screen.** An archived agent is recoverable through the API, not
  through the interface.
- **No streaming and no tool-calling loop** in an agent's turn: the model answers once, and does
  not call tools by itself. Extension point left in the step schema, not built.

---

## ➜ OPEN BLOCKERS

- **B-002** `[stale-premise]` — secret scanning is heuristic, declared heuristic every time (r45).
- **B-011** `[low-deferred]` — git history rewritten on the Owner's authorisation (`D-0258`).
- Nothing new was opened; the new item is a **finding**, not a blocker.

---

## ➜ RESIDUAL DEBT

`oci/Dockerfile` builds the supervisor, PostgreSQL 18 + pgvector and the Rust peers. Missing are
the four external containers (`atom-evolution-model` = llama.cpp serving phi-4, **not** ATOM;
`noesar-voice-hear`; `noesar-voice-speak`; `noesar-search`): they exist only in the runtime and in
prose, so a third party cloning this repository gets no voice, no search and no model. Phase O6 —
the largest gap between "works here" and "self-hosted software".

---

## ➜ IMPROVEMENT PROPOSAL (recorded, not executed)

**An agent's test turn should be replayable evidence** (`D-0398`): give the reasoning step the
same `fixtures(runId)` capture `workspace-actions.mjs:583` already takes, so an answer can be
replayed and compared instead of read once and lost. *Benefit:* the installation can ask the
question it has — *does this agent answer the same after a model swap?* *Cost:* ~60 lines plus a
test. **Owner's call.**

*Still standing:* `activeModelReport()` must declare **who** serves the model (`F-MODEL-001`).
