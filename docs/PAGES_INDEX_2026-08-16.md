# Pages & links index — NOESAR EVOLUTION WebUI + CodeN Evolution

**2026-08-16. Inventory only, not an audit.** Every row below is either machine-generated
(`tools/measure-page-liveness.mjs --markdown`, run live this session — the same tool that
caught `D-0300`'s "14 vs 25 real addresses" drift) or read directly from the router source
(`apps/webui-static/app.js`) and the product's own help text (`apps/webui-static/page-help.js`,
never invented here). Purpose: a base list to review **one row at a time, in depth**, in a
future phase — "what works, what's missing, how to improve." **`Checked` is `NO` for every
row on purpose** — this phase only builds the list, per the Owner's own instruction.

Columns: **Address** = the `#/...` hash link. **What it is** = one-line summary of the
product's own description (full text in `page-help.js` where marked `[PAGE_HELP]`, otherwise
the panel name is the only source available — marked `[NAME ONLY]`). **Checked** = has this
row had its own in-depth review yet (`SI`/`NO`).

---

## 1. Top-level destinations (14) — `apps/webui-static/app.js` `ROUTES`

| # | Address | What it is | Checked |
|---|---|---|---|
| 1 | `#/home` | Starting point: projects, recent conversations, work queue, service health. `[PAGE_HELP]` | SI |
| 2 | `#/chat` | The conversation with its context graph — per-project chats, branches, memory, files, tools. `[PAGE_HELP]` | SI |
| 3 | `#/coden` | The workbench + session: one program, two shells (this + terminal), one live session. `[PAGE_HELP]` | SI |
| 4 | `#/tools` | Registered tools (HTTP/MCP/OpenAPI), disabled until consent is granted. `[PAGE_HELP]` | SI |
| 5 | `#/coden-tui` | Static instructions for reaching the real terminal shell (`coden_evolution`). `[PAGE_HELP]` | SI |
| 6 | `#/projects` | A project: one controlled scope — chats, instructions, files, memory, tools, agents. `[PAGE_HELP]` | SI |
| 7 | `#/documents` | Artifacts: documents, code, tables, charts, canvas, app specs, versioned. `[PAGE_HELP]` | SI |
| 8 | `#/knowledge` | Ingested sources, searched lexically + semantically, original passages kept. `[PAGE_HELP]` | SI |
| 9 | `#/memory` | What the product has learned about your work, written at session end. `[PAGE_HELP]` | SI |
| 10 | `#/agents` | Agents plan; a step that changes something waits for human approval with scope. `[PAGE_HELP]` | SI |
| 11 | `#/workflows` | Declared step effects, retries, compensation, replay; effectful steps wait for a person. `[PAGE_HELP]` | SI |
| 12 | `#/models` | Model catalogue — running/on-disk at top, publisher-declared elsewhere. `[PAGE_HELP]` | SI |
| 13 | `#/research` | Goal+criteria research, evidence per candidate, states what was NOT verified. `[PAGE_HELP]` | SI |
| 14 | `#/settings` | One destination holding every setting; itself static, each section loads its own. `[PAGE_HELP]` | SI |

## 2. Settings sections (16) — `apps/webui-static/app.js` `SETTINGS_SECTIONS`

| # | Address | What it is | Checked |
|---|---|---|---|
| 1 | `#/settings/sessions` | Your sessions: working list, archive, 30-day bin. `[PAGE_HELP]` | SI |
| 2 | `#/settings/appearance` | Theme, accent, text size, motion — device-local only. `[PAGE_HELP]` | SI |
| 3 | `#/settings/language` | Time zone and locale (UI language itself is in the top bar). `[PAGE_HELP]` | SI |
| 4 | `#/settings/about` | Version, edition, data plane, the open-core/ATOM boundary. `[PAGE_HELP]` | SI |
| 5 | `#/settings/licence` | Licence posture — static, deliberately empty (no licence state asserted). `[PAGE_HELP]` | SI |
| 6 | `#/settings/privacy` | Providers/connectors — local by default, external needs explicit scope. `[PAGE_HELP]` | SI |
| 7 | `#/settings/people` | Account directory — invite by token, MFA mandatory for owner/admin. `[PAGE_HELP]` | SI |
| 8 | `#/settings/security` | Your own account: password, recovery codes, authenticator, passkeys, sessions. `[PAGE_HELP]` | SI |
| 9 | `#/settings/models-hardware` | What the host has, what the runtime would choose — read-only discovery. `[PAGE_HELP]` | SI |
| 10 | `#/settings/storage` | Export, backup, retention — checksummed, restore refuses a mismatch. `[PAGE_HELP]` | SI |
| 11 | `#/settings/audit` | One queue for everything awaiting a human decision, any subsystem. `[PAGE_HELP]` | SI |
| 12 | `#/settings/health` | Watchdog observations, safe-mode status, log stream. `[PAGE_HELP]` | SI |
| 13 | `#/settings/updates` | Staged/approved/applied updates with rollback; nothing self-installs. `[PAGE_HELP]` | SI |
| 14 | `#/settings/skills` | Skill catalogue — payload is instructions, cost is context, nothing preloaded. `[PAGE_HELP]` | SI |
| 15 | `#/settings/modules` | Owner modules — signed, one-click install, open in a new tab, never embedded. `[PAGE_HELP]` | SI |
| 16 | `#/settings/remote-targets` | Scan a remote codebase over SSH; the analysing module never sees the credential. `[PAGE_HELP]` | SI |

*Note: `settings/hardware` also exists as a distinct `PAGE_HELP` entry (accelerator probe) —
`measure-page-liveness.mjs` did not list it as a separate live section; flag for the deep pass
to confirm whether it's a real second address or stale text.* **Resolved, `D-0481`: stale.**
`SETTINGS_SECTIONS` (`app.js:251`) has no `'hardware'` entry, only `'models-hardware'` — the
key is orphaned `page-help.js` text with no route ever reaching it, not a second address.

## 3. Live-measurement flags (`tools/measure-page-liveness.mjs`, run 2026-08-16) — cross-check, not a new list

Everything above is `live: yes` **except**: `coden-tui`, `settings` (itself, by design — static
shell), `settings/appearance` (flagged `live: no` by the tool — **resolved in the deep pass,
`D-0479`: correct by design**, `renderAppearance()` [app.js:4344] never calls `api()`, matching
its own copy, "stored on this device only, never leaves the installation"), `settings/licence`
(static by design, documented), `not-found`/`access-denied` (static by design, documented). All
others load real data on open.

## 4. CodeN Evolution — bench panels (20) — `data-bench-panel`, address `#/coden/bench/<name>`

| # | Address | What it is | Checked |
|---|---|---|---|
| 1 | `#/coden/bench/terminal` | Legacy tab: not a panel body, scrolls focus to the real terminal region below (`app.js:298`). `[VERIFIED, D-0485]` | SI |
| 2 | `#/coden/bench/editor` | Read-only view of a plan's proposed/promoted files — never a second write path. `[VERIFIED, D-0485]` | SI |
| 3 | `#/coden/bench/diff` | Diff against the shadow copy after Approve, never against reply text. `[VERIFIED, D-0485]` | SI |
| 4 | `#/coden/bench/preview` | Preview surface. `[NAME ONLY]` | NO |
| 5 | `#/coden/bench/tests` | Test results. `[NAME ONLY]` | NO |
| 6 | `#/coden/bench/problems` | Problems/diagnostics list. `[NAME ONLY]` | NO |
| 7 | `#/coden/bench/logs` | Log stream for the session. `[NAME ONLY]` | NO |
| 8 | `#/coden/bench/history` | Session history. `[NAME ONLY]` | NO |
| 9 | `#/coden/bench/tasks` | Task list. `[NAME ONLY]` | NO |
| 10 | `#/coden/bench/map` | Repository map. `[NAME ONLY]` | NO |
| 11 | `#/coden/bench/tools` | Tools available inside the bench. `[NAME ONLY]` | NO |
| 12 | `#/coden/bench/plugins` | Plugins panel. `[NAME ONLY]` | NO |
| 13 | `#/coden/bench/agents` | Agents panel (bench-side view). `[NAME ONLY]` | NO |
| 14 | `#/coden/bench/documentation` | Documentation panel. `[NAME ONLY]` | NO |
| 15 | `#/coden/bench/closure` | Closure/final-report panel. `[NAME ONLY]` | NO |
| 16 | `#/coden/bench/shadow` | Shadow-execution panel. `[NAME ONLY]` | NO |
| 17 | `#/coden/bench/favourites` | Favourites. `[NAME ONLY]` | NO |
| 18 | `#/coden/bench/recent` | Recent items. `[NAME ONLY]` | NO |
| 19 | `#/coden/bench/sessions` | Sessions panel (bench-side view). `[NAME ONLY]` | NO |
| 20 | `#/coden/bench/projects` | Projects panel (bench-side view). `[NAME ONLY]` | NO |

## 5. CodeN Evolution — agent column panels (5) — `data-agent-panel`, address `#/coden/agent/<name>`

| # | Address | What it is | Checked |
|---|---|---|---|
| 1 | `#/coden/agent/plan` | The current Plan awaiting/under authorization. `[NAME ONLY]` | NO |
| 2 | `#/coden/agent/authority` | What capability token/authority is currently granted. `[NAME ONLY]` | NO |
| 3 | `#/coden/agent/activity` | Live agent activity feed. `[NAME ONLY]` | NO |
| 4 | `#/coden/agent/conversation` | The agent-facing conversation view. `[NAME ONLY]` | NO |
| 5 | `#/coden/agent/invariants` | Declared invariants the agent must not violate. `[NAME ONLY]` | NO |

## 6. Legacy redirects (11) — informational only, not real pages, `LEGACY_ROUTES` in `app.js`

Old address → where it lands now. Listed so a bookmark/old note is not mistaken for a missing
page during the deep review.

| Old address | Redirects to |
|---|---|
| `#/tasks` | `#/home` |
| `#/tools` *(legacy sense)* | `#/coden` |
| `#/approvals` | `#/settings/audit` |
| `#/providers` | `#/settings/privacy` |
| `#/hardware` | `#/settings/models-hardware` |
| `#/users` | `#/settings/people` |
| `#/security` | `#/settings/security` |
| `#/health` | `#/settings/health` |
| `#/logs` | `#/settings/health` |
| `#/updates` | `#/settings/updates` |
| `#/backups` | `#/settings/storage` |
| `#/about` | `#/settings/about` |

## 7. Terminal-only surface — not a page, noted for completeness

`coden_evolution` (real SSH terminal) exposes the same CodeN Evolution capabilities via 17
slash commands — listed in `docs/TOOLS_MODULES_INDEX_2026-08-16.md` §2, not duplicated here,
since a command is a functionality, not a page/link.

## 8. Deep review log — 3 items per phase, in list order

### `D-0474` (2026-08-16) — items 1-3: `#/home`, `#/chat`, `#/coden`

**`#/home`** (`app.js:973-977`, `index.html:198-236`).
*Works, VERIFIED*: `renderHome()` reads real state (`/api/v1/ai/bootstrap`); entry/goal actions
render from a payload, not hardcoded six/ten buttons (`UI-060`/`UI-061`); the review-time metric
counts rejected changes rather than excluding them (`UI-070…072`, `app.js:4893-4900`); e2e covers
entry+goal clicks (`tools/browser-e2e.mjs:2266,3041-3088`).
*Missing, declared not hidden*: the "Intent Frame" (goal → Plan) does not exist — stated in the
page itself (`index.html:218`, `page-help.js:36`), not a silent gap.
*To change*: none urgent. Risk noted: the gap is asserted in two places (inline HTML comment +
`page-help.js`) — if Intent Frame ships, both need updating together or they drift.

**`#/chat`** (`app.js:979-1123`, `index.html:262-327`).
*Works, VERIFIED*: new/fork/compare/merge conversation and branch, all real API calls; work panel
(sources/plan/context) live-populated (`renderChatPlan` `app.js:1050`); dictation/read-aloud wired
to real handlers (`app.js:3172,3916-4022`), not placeholders; e2e covers the work-panel plan
attach gesture (`tools/browser-e2e.mjs:2449-2483`).
*Missing*: none found this pass beyond what's already tracked project-wide (I18N gap).
*To change*: none — no defect found; not itself re-audited for accessibility/i18n depth (out of
this pass's 3-item scope).

**`#/coden`** (`app.js` terminal wiring, `index.html:330-450`).
*Works, VERIFIED*: real WS terminal (`/ws/coden`) sharing one session with the SSH TUI, same
renderer (`apps/shared/coden/tui-screen.mjs`); slash-command routing e2e-checked
(`tools/browser-e2e.mjs:3367-3493`, `POINT-2B`, mostly PASS); status chips read real sources and
show `—` rather than guess when absent.
*Missing*: `F-SLASH-001` (address-command routed through the terminal) — root cause confirmed
`D-0463`, fix needs an Owner design pick (A: drive the terminal / B: declare-and-skip), still open;
25 legacy bench/agent panels (this index's §4-5) remain pending "slice 4" removal — those rows are
mostly not independently meaningful until that slice lands.
*To change*: nothing built this pass (no authorization); confirms `F-SLASH-001`'s design choice
is the one blocking item for this page's completeness.

### `D-0476` (2026-08-16) — items 4-9: `#/tools`, `#/coden-tui`, `#/projects`, `#/documents`,
`#/knowledge`, `#/memory`

**`#/tools`** (`index.html:650-660`, `app.js:1712`).
*Works, VERIFIED*: registration is real (`POST /api/v1/tools`); consent is enforced **server-side**,
default-deny — `tool-executor.mjs:36` (external tool) and `workflow-service.mjs:616` ("every tool
is default-deny") both reject an ungranted tool, not just the UI checkbox. Installable catalogues
correctly point to the one place (`Settings › Modules`), not duplicated here (`D-0283`/`D-0277`).
*Missing*: no dedicated e2e click-path found for this form (backend gate is proven, UI submit path
is not, this pass).
*To change*: none built; e2e gap noted, not urgent — the security-relevant half (the gate) is proven.

**`#/coden-tui`** (`index.html:662-701`).
*Works, VERIFIED*: single sign-on via 60-second attach code, e2e-covered (`tools/browser-e2e.mjs:
2993-3029`, mint + re-mint invalidation both checked); the page is honest about container vs.
source-install access paths and about what it is not (no arbitrary shell).
*Missing*: none found.
*To change*: none.

**`#/projects`** (`index.html:704-706`).
*Works, VERIFIED*: creation e2e-covered (`tools/browser-e2e.mjs:450-462`); knowledge-mode isolation
(hybrid/full-context/disabled) and conversation-scoped memory isolation unit-tested
(`ai-workspace.test.mjs:109`).
*Missing*: none found.
*To change*: none.

**`#/documents`** (`index.html:709-712`).
*Works, VERIFIED*: artifact creation/versioning real, backend-tested (`ai-workspace.test.mjs`,
`session-lifecycle.test.mjs`).
*Missing*: plain textarea only — no rich/code editor, no in-page version-diff view (diffing exists
for CodeN runs, `#/coden/bench/diff`, not for artifact versions here).
*To change*: not built this pass (no authorization); worth a future contract if artifact editing
turns out to be a real workflow bottleneck — not assumed without Owner input.

**`#/knowledge`** (`index.html:714-722`).
*Works, VERIFIED*: hybrid search real (`GET /api/v1/knowledge/search`); binary ingestion real,
routed through local extraction (`FileExtractor`, `file-extractors.mjs`); Notes-vs-Memory split is
deliberate and documented in two places (`index.html:719` comment, `page-help.js:64`), not a defect.
*Fixed this pass (HUNT AND FIX)*: `F4-011` in `PROJECT_STATE.json.open_findings` read "OPEN -
accepted — … no magic-byte sniffing", but `sniffContentType()` (`file-extractors.mjs:44`) already
does exactly that, landed before `D-0362` (2026-08-09) — a **stale declaration**, not a live gap.
Re-verified: `node --test .../file-extractor-sniffing.test.mjs` → 13/13 pass. Record corrected,
see `D-0475`.
*To change*: none further.

**`#/memory`** (`index.html:724-736`).
*Works, VERIFIED*: "Recently learned" pending queue with keep/discard, search, real backend
(`memory-service.mjs`, PostgreSQL-backed, `provenance`/`derivedFrom` already tracked per item).
*Missing*: none found.
*To change*: none.

**Improvement research this batch (requested explicitly, not the routine one-liner)**: while
reviewing `#/knowledge`, `file-extractors.mjs` (204 lines, zero imports outside `node:fs`/
`node:path`/`node:child_process`/`node:crypto` — already fully decoupled from the rest of the
control plane) turned out to be a strong NLnet-fit candidate against
`.claude/skills/noesar-evolution-funding-fit/SKILL.md`'s seven traits: **(1) delimited** — magic-byte
sniffing + safe local extraction, nothing else; **(2) reusable** — any local-first tool needing "what
is this file, safely, offline" could use it as-is; **(3) privacy/autonomy** — no network call, no
cloud dependency, ever; **(4) no lock-in** — pure Node core, no model, no provider. Proposal:
publish it as its own small, versioned, AGPL package (own README, own test entry point, the
existing 13-test suite as its acceptance contract) rather than leaving it filed inside
`ai-workspace/`, invisible to anyone outside this repository. **Benefit**: a concrete, low-risk,
genuinely reusable artifact for a funding narrative that currently has none at this granularity.
**Cost**: low — extraction, not a rewrite; the module already has no internal coupling to sever.
**Not executed this phase** — proposed only, per `noesar-evolution-budget` §5.

### `D-0477` (2026-08-16) — items 10-12: `#/agents`, `#/workflows`, `#/models`

**`#/agents`** (`index.html:738-761`, `app.js:1655-1720`).
*Works, VERIFIED*: agent creation, test-one-turn, archive (not delete — record kept), and
approval-aware plan runs all real (`POST /api/v1/agents`, `/agent-runs`, `/agent-runs/.../
approve`, `/execute`); a mutative tool always stops for approval, enforced by the run's own step
status (`awaiting_approval`), not by the UI hiding the button; e2e-covered
(`tools/browser-e2e.mjs:3271`), backend suites `ai-agent-service.test.mjs`,
`agents-archive-http.test.mjs`.
*Missing*: none found.
*To change*: none.

**`#/workflows`** (`index.html:763-784`).
*Works, VERIFIED*: step vocabulary loaded live (not hardcoded), a step with declared effects
waits for a person; e2e-covered (`tools/browser-e2e.mjs:1882-1909`), backend suites
`workflow-engine.test.mjs`, `workflow-interrupted-step.test.mjs` (retries/compensation/replay).
*Missing*: none found.
*To change*: none.

**`#/models`** (`index.html:786-817`, `app.js:5659-5734`).
*Works, VERIFIED*: "On this installation" and the available-publisher catalogue both live, never
paginate at the top; type/function shown as publisher-`declared` vs `undeclared`, never guessed
from a name; acquisition (egress) explicitly gated with a stated reason when off; e2e-covered
(`tools/browser-e2e.mjs:3318-3333`), backend suite `model-catalog.test.mjs`.
*Missing*: `F-MODEL-001` (already tracked, `D-0395`, open) — `servedBy` is not declared, so "On
this installation" can show a model actually served by a different deployment
(`atom-evolution-model`) without saying so. Still awaiting the Owner's choice; not re-litigated
here.
*To change*: none built this pass.

**Improvement note this batch (routine, per `noesar-evolution-budget` §3)**: no new defect and
no new funding-fit candidate surfaced in this trio — all three engines (agents, workflows,
models) are already server-authoritative with real approval/consent gates, which is itself the
correct baseline rather than a gap to close. The standing proposal from `D-0476`
(`file-extractors.mjs` packaging) remains the best open item; not duplicating it here.

### `D-0478` (2026-08-16) — items 13-14: `#/research`, `#/settings` (§1 now complete, 14/14)

**`#/research`** (`index.html:820-836`, `app.js:5510-5603`).
*Works, VERIFIED*: real two-gate pipeline — intent gate before anything leaves, content gate
before anything is shown, three outcomes (proceed/ask/refuse), each refusal named
(`services/reference-control-plane/src/research.mjs:197-229`, `research-gate.mjs`); the report
is reached through an ephemeral, revocable, session-gated link, not a public one; no provider
built in — configured and consented like any other connector. Backend coverage is thorough: 35
tests across `research.test.mjs`, `research-gate.test.mjs` and a dedicated
`research-gate-http-adversarial.test.mjs`.
*Missing*: no e2e check found driving the actual gesture (type objective, add criteria, run,
read the outcome panel) — `#/research` appears only in destination-reachability list checks
(`tools/browser-e2e.mjs:482,3519`), not in one exercising the form. The backend is thoroughly
proven; the UI wiring to it is not, in this suite.
*To change*: not built this pass (no authorization) — worth an e2e check given how well-tested
the backend already is and how thin the UI-side proof is by comparison.

**`#/settings`** (`index.html:838-867`, `app.js:743,503,538`).
*Works, VERIFIED*: static shell by design (confirmed live-measurement, §3 above); each of the 16
sections is independently deep-linkable (`#/settings/<section>`) and denies per-section when the
account may not open it (`#settingsDenied`, rendered rather than a blank 403) — the gate is
visible, not merely enforced.
*Missing*: none found at the shell level (sections reviewed individually, not yet started).
*To change*: none.

**Top-level destinations (§1) are now fully reviewed: 14 of 14.** No HUNT AND FIX this batch —
nothing found rose to a repairable in-scope defect; the `#/research` e2e gap is a coverage note,
not a broken behaviour.

### `D-0479` (2026-08-16) — §2 settings sections 1-3: `sessions`, `appearance`, `language`

**`#/settings/sessions`** (`index.html:872-931`).
*Works, VERIFIED*: three places (working list / archive / bin), each addressable
(`#/settings/sessions/archive`); select-all, delete-selected with confirmation, restore; the
terminal keyboard-parity table is checked against the client's real dispatch, not aspirational.
Extensive e2e coverage (`tools/browser-e2e.mjs:2505-2758`: archive, delete-selected, keyboard
focus) plus `session-lifecycle.test.mjs`.
*Missing*: none found.
*To change*: none.

**`#/settings/appearance`** (`index.html:933-990`, `app.js:4344`).
*Works, VERIFIED*: 9 themes + any-hue accent with live contrast readout (4.5:1 target, derived
not refused when the raw hue fails), 4-step text size, independent zoom, motion — all confirmed
device-local (`renderAppearance()` never calls `api()`). Contrast math has its own unit suite
(`webui-colour.test.mjs`); zoom/motion e2e-covered (`tools/browser-e2e.mjs:2645-2661`).
**Resolves the open question from §3 of this file**: the tool's `live: no` flag on this page is
**correct by design**, not a detection gap — confirmed by reading the render function, not
inferred.
*Missing*: no e2e click-path found for the theme grid or the accent picker/readout specifically
(zoom and motion are covered, theme and accent are not).
*To change*: not built this pass — coverage gap named, matches the shape of the `#/research`
gap from `D-0478`.

**`#/settings/language`** (`index.html:991-1001+`).
*Works, VERIFIED*: time zone resolution order (your preference → server default → host → UTC)
stated and backed by `timezone.test.mjs`; e2e-covered (`tools/browser-e2e.mjs:2248-2249`).
*Missing*: none found.
*To change*: none.

**No HUNT AND FIX this batch** beyond resolving the pre-existing open question above (a
clarification, not a defect — the behaviour was already correct). Two coverage gaps now on
record across the review so far, same shape: `#/research`'s form (`D-0478`) and
`#/settings/appearance`'s theme/accent picker (`D-0479`) — both well-tested at the logic layer,
neither driven end-to-end by the UI-facing suite.

### `D-0480` (2026-08-16) — §2 settings sections 4-6: `about`, `licence`, `privacy`

**`#/settings/about`** (`index.html:1011-1018`, `app.js:2770-2789`).
*Works, VERIFIED*: reads `GET /api/v1/bootstrap` live — product/edition/version, signed-in
identity, data-plane mode, authority mode, the open-core/ATOM boundary claim, and the advertised
feature list. The feature list is held honest by a dedicated suite,
`bootstrap-feature-claims.test.mjs`: every advertised feature has a probe, and no probe names a
feature bootstrap doesn't advertise — so what this page displays cannot silently drift into an
unverified claim.
*Missing*: no dedicated e2e content check (only appears in the destination-reachability list,
`tools/browser-e2e.mjs:485`), but the backend claims-integrity suite substitutes for most of what
such a check would prove here.
*To change*: none built this pass.

**`#/settings/licence`** (`index.html:1019-1022`).
*Works, VERIFIED*: deliberately static — "No code in this build reads or asserts a licence
state, so there is nothing here to display. Showing an invented one would be exactly the kind of
false declaration this product exists to remove." Matches `CLAUDE10.md` §15 (proposal, not
settled law) and `docs/LICENSE_STRATEGY.md` exactly; nothing to wire, nothing missing.
*To change*: none — correct as built.

**`#/settings/privacy`** (`index.html:1023-1026`, `app.js:1616-1622`).
*Works, VERIFIED*: provider registration, per-provider consent + anonymization toggles, fallback
routing, encrypted-key storage, live health check — all real (`POST /api/v1/providers`, consent
PUT). e2e specifically hardened against a render race (`tools/browser-e2e.mjs:2008-2035`, checks
a stale-DOM marker rather than trusting a re-render happened before assertion); 3 dedicated
backend suites (`ai-provider-gateway.test.mjs`, `provider-health-probe.test.mjs`,
`provider-gateway-success-paths.test.mjs`).
*Missing*: none found.
*To change*: none.

**Minor note, not a finding**: `#/settings/about` and `#/settings/privacy` use legacy element
ids (`view-about`, `view-providers`) rather than this file's `section-<name>` convention seen
elsewhere. Harmless — section switching reads `data-section`, never the id
(`app.js:480`) — named only for completeness, not worth a change.

**No HUNT AND FIX this batch** — nothing found rose to a repairable in-scope defect.

---

### `D-0481` (2026-08-16) — §2 settings sections 7-9: `people`, `security`, `models-hardware`

**`#/settings/people`** (`index.html:1027-1041`, `app.js:2333-2341`).
*Works, VERIFIED*: token-based invitation, role selection, account directory, all real
(`POST /api/v1/invitations`); e2e-covered (`tools/browser-e2e.mjs:3649,3709`), backend suite
`user-directory.test.mjs`.
*Missing*: none found.
*To change*: none.

**`#/settings/security`** (`index.html:1042-1104`, `app.js:2107-2206`).
*Works, VERIFIED*: password change, recovery-code regeneration, authenticator replacement
(two consecutive codes from the new one before the old one stops working — a half-finished swap
cannot lock the account out), passkeys, active-session revocation — all real, every mutation
gated on password + live TOTP; MFA replacement e2e-covered (`tools/browser-e2e.mjs:2179`);
backend suites `webauthn.test.mjs`, `totp-replay.test.mjs`, `auth.test.mjs`.
*Missing*: no e2e click-path found for password change or passkey add/remove specifically
(the authenticator-replacement flow is covered, these two are not) — third occurrence of the
"backend proven, UI gesture not driven" shape (`#/research` `D-0478`, theme/accent `D-0479`).
*To change*: not built this pass.

**`#/settings/models-hardware`** (`index.html:1106-1111`, `app.js:1900-1901`).
*Works, VERIFIED*: read-only accelerator discovery (`GET /api/v1/hardware`) plus an explained
runtime recommendation (`POST /api/v1/runtime/recommendation`) for a given model size and
quantisation — both real, backend suite `hardware.test.mjs` (CPU fallback, multi-GPU).
**Resolves the open question from §1 of this file** (the `settings/hardware` note): confirmed
**stale** — `SETTINGS_SECTIONS` (`app.js:251`) has no `'hardware'` entry, only
`'models-hardware'`; the `page-help.js` key is orphaned text with no route ever reaching it, not
a live second address. Corrected in §1's note above.
*Missing*: no e2e coverage found for this section specifically.
*To change*: not built this pass; the orphaned `page-help.js['settings/hardware']` key (harmless,
never rendered) is a candidate for a future cleanup phase, not fixed here without authorization.

**Pattern now at 3 occurrences**: `#/research`'s form (`D-0478`), theme/accent picker
(`D-0479`), and now password-change/passkeys (`D-0481`) — all thoroughly tested at the backend/
logic layer with no e2e proving the UI actually drives that logic. Worth treating as one finding
once §2 is done, not three separate small ones.

**No HUNT AND FIX this batch** beyond the stale-note correction above (a documentation
correction, not a functional defect).

---

### `D-0482` (2026-08-16) — §2 settings sections 10-12: `storage`, `audit`, `health`

**`#/settings/storage`** (`index.html:1112-1118`, `app.js:2730-2764`).
*Works, VERIFIED*: `POST /api/v1/database/backup` (`postgres-supervisor.mjs:775`) runs real
`pg_dump`, computes a SHA-256 sidecar, `0600`-permissions both files; `restore()` (line 795)
re-verifies that checksum before touching anything and **throws on mismatch** — the page's claim
is literally true in the code, not aspirational. Workspace export and retention (save/apply) are
separate, real endpoints. **No unit test exists for backup/restore** — architecturally so: both
spawn real `pg_dump`/`pg_restore` against a live PostgreSQL, which is T2/T3-tier territory
(`noesar-evolution-verify`), not something a unit suite can exercise without a live database.
Verified by **reading the implementation**, not by running it — labelled accordingly, not
claimed as tested.
*Missing*: none found within what a read-only review can establish; live-tier proof would need a
future T3 phase, not this one.
*To change*: none.

**`#/settings/audit`** (`index.html:1119-1122`, `app.js:4203-4227`).
*Works, VERIFIED*: `GET /api/v1/approvals` genuinely aggregates **four** subsystems —
`workflow-step`, `agent-step`, `update`, `memory-candidate` (`approval-queue.mjs:22,55-118`) —
by **reading** each owner's live state rather than duplicating it, so there is no second source
of truth to drift. The "one queue, any subsystem" claim is real, not a UI illusion over one
backend. Extensively e2e-covered, including a race-condition-proofed check on
run-started→refresh ordering (`tools/browser-e2e.mjs:1932-1961,2099-2120`); 10 backend tests
(`approval-queue.test.mjs`).
*Missing*: none found.
*To change*: none.

**`#/settings/health`** (`index.html:1123-1148`, `app.js:2355-2400,2696-2711`).
*Works, VERIFIED*: watchdog check, safe-mode status/exit, structured log search (level/
component/correlation/text), time-boxed debug mode (self-expires) — all real; `healthComponents`
e2e-covered (`tools/browser-e2e.mjs:637`); backend suites `watchdog.test.mjs`,
`debug-mode.test.mjs`, `logging.test.mjs` (55 tests across the three).
*Missing*: no e2e click-path found for log search or debug-mode toggle specifically (watchdog
status is covered, these two are not) — a 4th occurrence of the "backend proven, not e2e-driven"
pattern.
*To change*: not built this pass.

**§2 pattern update: 4 occurrences now** — `#/research` (`D-0478`), theme/accent (`D-0479`),
password-change/passkeys (`D-0481`), log-search/debug-mode (`D-0482`). Consistent enough across
independent sections that it reads as a property of the e2e suite's growth pattern (built
page-by-page, deepened unevenly) rather than four unrelated gaps.

**No HUNT AND FIX this batch** — nothing found rose to a repairable in-scope defect.

---

### `D-0483` (2026-08-16) — §2 settings sections 13-14: `updates`, `skills`

**`#/settings/updates`** (`index.html:1150-1157`, `app.js:2410-2452`).
*Works, VERIFIED*: check/channel-change/approve/apply/rollback all real (`/api/v1/updates/*`);
the page is honest about its own current limit — "no update channel key is pinned on this
installation, so nothing can currently be applied. This is stated rather than hidden" — matching
`CLAUDE10.md` rule 38 in spirit (no false PASS, here applied to the product's own copy). Backend
suites `update-manager.test.mjs`, `updates-channel-key-http.test.mjs`.
*Missing*: no e2e click-path found for any of the five buttons.
*To change*: not built this pass.

**`#/settings/skills`** (`index.html:1158-1161`, `app.js:5855-5873`).
*Works, VERIFIED*: search-only catalogue, zero skills loaded at rest, cost stated in bytes
before adoption — matches `noesar-evolution-context`'s own economy principle applied to the
product's skill system, not just to this session's own tooling. Backend suites
`skill-catalog.test.mjs`, `author-skill-composition.test.mjs`,
`plan-composes-adopted-skills.test.mjs` (adoption flow, not just the catalogue read).
*Missing*: no e2e click-path found for the catalogue search/adoption gesture.
*To change*: not built this pass.

**§2 pattern update: 6 occurrences now**, all in this session's own review —
`#/research` (`D-0478`), theme/accent (`D-0479`), password-change/passkeys (`D-0481`),
log-search/debug-mode (`D-0482`), updates, skills (`D-0483`). At 6 independent sightings across
8 sections reviewed, this is no longer a coincidence worth naming per-section — it is a
property of the e2e suite itself: interaction coverage was built page-by-page as each feature
shipped, and settings sections added after the suite's last major coverage pass never got their
own click-path, even though their backends are consistently well-tested.

**No HUNT AND FIX this batch** — nothing found rose to a repairable in-scope defect.

---

### `D-0484` (2026-08-16) — §2 settings sections 15-16: `modules`, `remote-targets` (§2 complete, 16/16)

**`#/settings/modules`** (`index.html:1162-1165`, `app.js:2512,2625-2652`).
*Works, VERIFIED*: owner-module catalog real (`owner-module-catalog.mjs`); registration/signing/
install run **server-side**, not by pasting a key around, matching the page's own claim exactly.
Backend suites `sector-modules.test.mjs`, `sector-modules-activation.test.mjs`.
*Missing*: no e2e click-path found (7th occurrence of the pattern).
*To change*: not built this pass.

**`#/settings/remote-targets`** (`index.html:1166-1183`, `app.js:2563-2624`).
*Works, VERIFIED*: host key is captured and **pinned in full** (`known_hosts` format, not just a
fingerprint) at registration (`remote-target-registry.mjs:16,56-60`); the SSH connection runs
`StrictHostKeyChecking=yes`, **never disabled** — a later mismatch genuinely refuses the
connection, matching the page's claim word-for-word
(`remote-target-fetch.mjs:106,140`). Private key is supplied only at activation, per target, and
removal deletes the stored key. 16 backend tests across `remote-target-registry.test.mjs`,
`remote-target-fetch.test.mjs`, `remote-target-http.test.mjs`.
*Missing*: no e2e click-path found (8th occurrence).
*To change*: not built this pass.

**§2 (settings, 16 sections) is now fully reviewed.** Final pattern tally for this section:
**8 occurrences** of "backend proven, not e2e-driven" —
`#/research`(§1, `D-0478`) + 7 more inside §2: theme/accent (`D-0479`), password-change/passkeys
(`D-0481`), log-search/debug-mode (`D-0482`), updates, skills (`D-0483`), modules,
remote-targets (`D-0484`). Every one of these also has thorough **backend** coverage — the
pattern is specifically about the UI-driving layer, not about correctness confidence overall.

**No HUNT AND FIX this batch** — nothing found rose to a repairable in-scope defect.

---

### `D-0485` (2026-08-16) — §3 CodeN Evolution bench panels, items 1-3: `terminal`, `editor`, `diff`

**Context, not repeated per item below**: these 20 panels are the pre-`D-0404` legacy bench
surface (`index.html:339-341` comment) — still live and functioning, scheduled for removal only
after "slice 4" proves the modern terminal replaces every one of them (§1's `#/coden` review,
`D-0474`, already confirmed the modern terminal itself is real and working). This batch reviews
whether the legacy panels *still function correctly* pending that removal, not whether they
should exist.

**`#/coden/bench/terminal`** (`index.html:464`, `app.js:298`).
*Works, VERIFIED*: **not** a panel body — the tab exists only to scroll focus to
`#benchTerminal`, the real terminal region below the bench, matching its own copy exactly ("not
a tab that disappears... this tab moves focus to it", `UI-033`). The table description above was
`[NAME ONLY]` and read as if this panel *were* the terminal surface; corrected to what the code
actually does.
*Missing*: none — correct as built once its actual behaviour is understood.
*To change*: the original inventory description was wrong (guessed from the name, as
`[NAME ONLY]` warned it might be); corrected in §4's table.

**`#/coden/bench/editor`** (`index.html:460`, `app.js:2926-2937`).
*Works, VERIFIED*: **genuinely read-only** — shows a run's proposed (pre-Approve) or promoted
(post-Approve) files, with the comment stating exactly why a live edit box would be wrong here:
it would let a byte reach the workspace without a plan, a token, or a shadow comparison. e2e
proves it shows the run's *actual* promoted content, not a placeholder
(`tools/browser-e2e.mjs:2843-2851`, asserts real file text appears).
*Missing*: none found.
*To change*: none.

**`#/coden/bench/diff`** (`index.html:461`, `app.js:2913-2921`).
*Works, VERIFIED*: computed against the shadow copy after Approve runs it, never against reply
text — matches the architecture's own "a reply describing a change is not the change" principle.
e2e asserts a real diff appears after Approve, not "no change to compare"
(`tools/browser-e2e.mjs:2839-2841`).
*Missing*: none found.
*To change*: none.

**No HUNT AND FIX this batch** beyond the description correction above (documentation, not a
functional defect — the code was already correct).

---

**Totals: 14 top-level + 16 settings + 20 bench panels + 5 agent panels = 55 real addressable
destinations, + 11 legacy redirects. 33 of 55 checked in depth.**
