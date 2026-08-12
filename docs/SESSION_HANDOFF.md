# SESSION HANDOFF — NOESAR EVOLUTION

Last updated: 2026-08-12 · `phase_status = SOURCE_COMPLETE_AWAITING_COMMIT_AUTHORISATION`
**`origin/main` is behind and nothing is pushed** — for how far, run `git status -sb`: a number
written here goes stale on the next commit.

---

## ➜ LA PROSSIMA AZIONE — tre cose, in quest'ordine

### 1. Authorise the commits — nothing from this phase is committed

Two commits, deliberately split. **They cannot be split further**: the state files carry both
this phase and the previous sitting, and no hunk-level split is available here.

| Commit | Files |
|---|---|
| **A** `feat(phase-4): D-0397 …` | `services/reference-control-plane/src/ai-workspace/agent-service.mjs` · `services/reference-control-plane/src/server.mjs` · `apps/webui-static/index.html` · `apps/webui-static/app.js` · `apps/webui-static/i18n-catalog.js` · `services/reference-control-plane/test/ai-agent-service.test.mjs` · `services/reference-control-plane/test/agents-archive-http.test.mjs` (new) |
| **B** `docs(phase-4): …` | `PROJECT_STATE.json`, `docs/DECISION_LOG.md`, `docs/SESSION_HANDOFF.md`, `EVIDENCE/a2_log_marker_2.txt` (untracked) — **carries the previous sitting's measurements too**, and the message must say so |

### 2. A2 — still not done, and the recipe in the last handoff was WRONG

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
only if both say `atom`. Then measure the container log **past line 426**
(`EVIDENCE/a2_log_marker_2.txt`), not 118.

### 3. Answer `D-0395` — the `#/models` in-use lane

`phi-4-q4_k_m` is genuinely resident (10,348 of 12,288 MiB, RTX 3060) served by container
`atom-evolution-model` at `http://172.22.0.4:8420`. Choose: **(a)** the product must not present
another deployment's runtime as *"on this installation"* (product change, no runtime action) ·
**(b)** unload and reload (a container outside this project — explicit authorisation) ·
**(c)** a different model.

**Then:** deploy — Voice V1 **and** `D-0397` are both committed-only ·
`git push origin main` (never forced) · OCI phase O1.

---

## ➜ WHAT HAPPENED THIS SESSION (2026-08-12, third sitting)

The Owner reported that on `#/agents` nothing said what to type, a created agent could not be
tested, and it could not be removed. All three were real, and one was structural (`D-0397`):

| Measured | |
|---|---|
| guidance | `view-agents`: **5 inputs, 0 placeholders, 0 hints** — the barest view in the product |
| removal | routes were `GET`/`POST` only; `archived` was written at creation and filtered on read, and **nothing could set it** |
| the dead run | `#runForm` builds `Analyze goal` with no `toolId`; Execute rendered only `if(step.toolId)`; `executeStep` threw `409`. **Every run this screen created was unfinishable** |
| agents and the model | `grep -c reasoning agent-service.mjs` = **0** — no agent had ever asked a provider anything |

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

---

## ➜ WHAT WAS **NOT** DONE — declared

- **Nothing is committed and nothing is pushed.** Eleven files are dirty (7 from this phase,
  4 from the previous sitting).
- **Nothing was deployed or installed.** No container, image, network, volume, database, ATOM or
  host was touched. The running installation still serves the old bytes — Voice V1 **and**
  `D-0397` are both undeployed.
- **T2 was NOT run**: `tools/browser-e2e.mjs` and `tools/accessibility-audit.mjs` are owed by the
  markup change (change map) and were **not executed** — they build an image and drive
  containers, outside the standing authorisation. Requested, not skipped silently.
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
replayed and compared instead of read once and lost. *Benefit:* a self-hosted installation can
ask the question it actually has — *does this agent still answer the same way after a model
swap?* *Cost:* ~60 lines plus a test. **Owner's call.**

*Still standing:* `activeModelReport()` must declare **who** serves the model, not only the
endpoint (`F-MODEL-001`, `D-0395`).
