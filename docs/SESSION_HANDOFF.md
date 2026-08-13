# SESSION HANDOFF — NOESAR EVOLUTION

Last updated: 2026-08-13 · `phase_status = DESIGN AUTHORISED, IMPLEMENTATION NOT STARTED`

The installation is **`noesar-evolution:d0402-a11y-20260813T060132Z`**, live since 06:02Z,
healthy, carrying `D-0402` (three WCAG repairs) and `D-0401` («Archivia agente»).
For the push, `git status -sb` is the only current truth.

---

## ➜ LA PROSSIMA AZIONE

### 1. Read `docs/CODEN_EVOLUTION_TERMINAL_DESIGN.md` — it is the whole job

The Owner authorised, on 2026-08-13, the collapse of **CodeN Evolution into one surface**: the
TUI already in this repository, rendered in the browser by a vendored terminal emulator over a
WebSocket, filling the **CodeN content region** (not the browser viewport), reached from the
sidebar entry that exists today. Decisions `D-0404` (architecture), `D-0405` (the two shared
sources), `D-0406` (`/`). **Nothing is implemented.**

### 2. Then slice 1 — and it is not the obvious one

Slice 1 is **not** the terminal. It is moving two shared sources out of `apps/webui-static/`,
because the terminal depends on the web folder it is about to replace:

```text
trap 1  parseCodenAddressBook() regex-scrapes index.html for the 25 panels,
        their <h3> and their declared-empty paragraphs   (coden-address-book.mjs:104-130)
trap 2  tui-fullscreen.mjs:26 and tui-client.mjs:37 import
        ../apps/webui-static/agent-commands.js
```

Delete the web CodeN before this move and the product **kills its own terminal by editing a web
page**. Slice 1 is additive and reversible: move, update the import paths, keep green the tests
that already assert them (`coden-view-model.test.mjs:138-140`).

Slices 2-4 (bridge · page · removal) are in the design, in that order. **Removal is last.**

### 3. Still open, still the Owner's — unchanged by this session

- **A2** on the live installation: sign in at `https://192.168.178.100:8443`, go to
  `#/coden/agent/plan`, fill the goal plus at least one file path, press **Create plan**, and
  read **both** the chip (`reasoning atom`) and the `provider:` line in the plan result box.
  `atom` on the chip is only the absence of a degradation event; `provider:` names who answered.
  Measure the container log from the **current** container's own start (06:02Z).
- **`D-0395`** — the `#/models` in-use lane: (a) the product must not present another
  deployment's runtime as *"on this installation"*, (b) unload and reload a container outside
  this project, (c) a different model.

---

## ➜ WHAT HAPPENED THIS SESSION (2026-08-13)

Three pieces of work, in order:

1. **`D-0402` — the three WCAG 2.2 AA failures closed**, built and deployed in the same phase
   (§3a). One of them was structural: the composer drew its focus ring on the **wrapper**
   (`.agent-prompt:focus-within`) while `textarea:focus{outline:none}` stripped it from the
   element; the wrapper holds more than one control, so that ring can never say *which* has
   focus. Geometry met with **floors** (`max(24px,1.6em)`, `min-*:24px` on `inline-flex`), so
   targets keep growing with the text scale.
2. **The Owner reported that CodeN is duplicated and ugly.** Measured: he was right and it is
   worse — `index.html` declares **two** CodeN destinations (`:157`, `:164`), the page still
   carries **25 panels**, and `#/coden-tui` is 42 lines of prose about a terminal client.
3. **`D-0404`/`D-0405`/`D-0406` — the design, authorised, not started.**

---

## ➜ WHAT WAS VERIFIED — measured in **this** sitting

| Check | Result |
|---|---|
| WCAG 2.2 AA audit | `A11Y_TOTAL=27 · PASS=27 · FAIL=0` (was 24/27) — 1.3.5 **0 of 13**, 2.4.7 **0 of 879**, 2.5.8 **0** under 24×24 |
| browser acceptance suite | `BROWSER_E2E_TOTAL=475 · PASS=475 · FAIL=0` |
| unit suite | **2402 pass · 0 fail · 1 skip** (2403 tests, 254 suites) |
| ESLint · `verify-source` | **392 files, 0 errors** · `SOURCE_VERIFY=PASS migrations=19 baseline=12/12` |
| T3 · image bytes = tree | 5 of 5 identical by `sha256sum`, before any mutation |
| T3 · the installation serves them | `/styles.css` `9b28968a23cc…` · `/index.html` `c4a4efb4ba0f…` · `/app.js` `46dca2b5b189…` |
| T3 · health | `running healthy` · `/livez` **200** · `/readyz` **200** · children `postgres api codev atom` · auth-failure lines **0** |
| §5a hygiene | containers **53 → 52**, networks **10 → 10**, volumes **63 → 63**, non-project **50 → 50** |
| the design's own facts | TUI ≈ **2,150 lines** + 7 test files · renderer width-parametric · **zero** third-party imports in the control plane · 2 CodeN entries · 20+5 panels · 7 menu groups · two `/` bindings still alive |

Logs: `EVIDENCE/t2_accessibility_20260813.log`, `EVIDENCE/t2_browser_e2e_20260813_a11y.log`,
`EVIDENCE/deploy_d0402_20260813.log`. Backup: `BACKUPS/a11y_20260813T021934Z/`.
Rollback: `noesar-evolution-pre-20260813T060219Z`, one command, in the ledger.

---

## ➜ WHAT WAS **NOT** DONE — declared

- **The terminal design is not implemented.** No product file changed after `D-0402`; the
  closing commit is documentation and state only.
- **Address coverage `25 of 25` in the terminal is `[INFERRED]`** — it is a past phase's
  measurement read out of `coden-address-views.mjs:154`, **not re-run today**. Criterion C of
  the design exists to prove it before slice 4 removes anything.
- **`MANIFEST.sha256` was not updated** for the new design document — consistent with
  `F-MANIFEST-001` (5898 entries against 6568 tracked files), declared rather than silently
  skipped. Nothing verifies the manifest, so nothing went red.
- **The three WCAG rows are `[UNVERIFIED]` as rendered by the running container**: live
  verification never runs a suite that mutates the installation's data (§3a 11e). What is proven
  is that the deployed bytes equal the tree the audit exercised.
- **A2 was NOT performed** — it needs a signed-in session; no automation here holds a credential.
- **`F-MODEL-001`, `F-HOOK-005`, `F-MANIFEST-001`, `F4-010`..`F4-013`, `F7-001`** remain open.
- **The font and `xterm.js` licences are NOT verified** — the design says so explicitly and
  slice 3 must verify them before either is committed.
- **The sensitive rotation backups are kept**, `0700`/`0600`:
  `BACKUPS/atom_token_rotation_20260812T121329Z/` and `…T130147Z/`.

---

## ➜ OPEN BLOCKERS

- **B-002** `[stale-premise]` — secret scanning is heuristic; declared heuristic every time (r45).
- **B-011** `[low-deferred]` — git history rewritten on the Owner's authorisation (`D-0258`).
- Nothing new was opened.

---

## ➜ RESIDUAL DEBT

`oci/Dockerfile` builds the supervisor, PostgreSQL 18 + pgvector and the Rust peers. Missing are
the four external containers (`atom-evolution-model` = llama.cpp serving phi-4, **not** ATOM;
`noesar-voice-hear`; `noesar-voice-speak`; `noesar-search`): they exist only in the runtime and
in prose, so a third party cloning this repository gets no voice, no search and no model.

---

## ➜ IMPROVEMENT PROPOSAL (recorded, not executed)

**One session, N viewports** (`D-0404` §3). A PTY has a single geometry and two clients fight
over it — the classic `tmux` problem. This product's renderer is already width-parametric, so
the same live session can be rendered **per viewport**: `ssh` at 80 columns and the browser at
200 simultaneously, each correct, with the session surviving a page reload. It is the point
where this is more advanced than a naive terminal bridge, and it is cheap **only because the
renderer was written width-parametric years of phases ago**.

*Still standing:* the audit measures the element and never its ancestors (`D-0403`);
`activeModelReport()` must declare **who** serves the model (`F-MODEL-001`).
