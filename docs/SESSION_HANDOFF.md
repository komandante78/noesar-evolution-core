# SESSION HANDOFF — NOESAR EVOLUTION

Last updated: 2026-08-13 · `phase_status = DEPLOYED AND VERIFIED`

The installation is **`noesar-evolution:d0402-a11y-20260813T060132Z`**, live since
2026-08-13 06:02Z. It carries the three WCAG repairs (`D-0402`) **and** `D-0401`
(«Archivia agente»), which had been committed on 2026-08-12 and never installed. Ledger:
`docs/INSTALLATION_LEDGER.md`, last entry. The Owner authorised commit, deployment and push in
one answer; for the push, `git status -sb` is the only current truth.

---

## ➜ LA PROSSIMA AZIONE — due cose, tutte e due dell'Owner

### 1. A2 — still not done (needs a signed-in session; no automation here holds a credential)

```text
1. https://192.168.178.100:8443  →  sign in
2. go to  #/coden/agent/plan     (panel titled "Plan", badge "No plan yet")
3. fill the goal + at least ONE file path (+ File), press "Create plan"
   — NOT the "Plan run" form in #/agents: that one writes two canned steps and asks no provider
4. read BOTH:
     chip  reasoning atom | reasoning reference (degraded: …)   (CodeN top bar)
     line  provider: …                                          (#planResult box)
```

`updateReasoningChip()` has exactly one caller in the whole product — `app.js:2966`, the answer of
`POST /api/v1/workspace-actions/plan`. **A chat message does not touch that indicator.** `atom` on
the chip is a **negative** proof (`degradationSummary()` says `atom` when zero degradation events
exist); `provider:` is the **positive** one. A2 passes only if both say `atom`. Measure the
container log from the **current container's own start** — the marker at 426 lines
(`EVIDENCE/a2_log_marker_2.txt`) belongs to a container that no longer exists.

### 2. Answer `D-0395` — the `#/models` in-use lane

`phi-4-q4_k_m` is genuinely resident (10,348 of 12,288 MiB, RTX 3060) served by container
`atom-evolution-model` at `http://172.22.0.4:8420`. Choose: **(a)** the product must not present
another deployment's runtime as *"on this installation"* (product change, no runtime action) ·
**(b)** unload and reload (a container outside this project — explicit authorisation) ·
**(c)** a different model.

*While signed in:* the composer now draws its own focus ring, the `/` key in the hint is a
24×24 target, and the Archive button on `#/agents` reads «Archivia agente» instead of «Archivio».

---

## ➜ WHAT HAPPENED THIS SESSION (2026-08-13)

The short phase the previous handoff proposed: `F-A11Y-001..003` closed together, one audit run
(`D-0402`). Two of the three had been recorded as needing an Owner design call. One did not — and
that one was structural:

`.agent-prompt:focus-within` **did** draw a ring, but on the **wrapper**, while
`.agent-prompt textarea:focus{outline:none}` stripped it from the element itself. `.agent-prompt`
holds more than one control, so that ring says *something in here* has focus and never **which** —
which is exactly what 2.4.7 asks. It was a real defect, not an artefact of the audit.

Geometry was met with **floors, not fixed sizes** — `min-height:max(24px,1.6em)` on `#codenPrompt`,
`inline-flex` + `min-width/min-height:24px` on `.hint-key` — so the targets grow with the text
scale instead of being pinned at the minimum (1.4.4 stays satisfied).

**Rejected:** widening the audit's inline-link exception to cover `.hint-key`. That turns a
detector into a permission, and every future small target passes with it.

---

## ➜ WHAT WAS VERIFIED — measured in **this** sitting

| Check | Result |
|---|---|
| WCAG 2.2 AA audit | **`A11Y_TOTAL=27 · PASS=27 · FAIL=0`** (was 24/27) |
| — 1.3.5 input purpose | **0 of 13** identity fields without `autocomplete` |
| — 2.4.7 visible focus | **0 of 879** controls change nothing when focused (19 disabled skipped) |
| — 2.5.8 target size | **0** targets under 24×24, in views and in chrome |
| browser acceptance suite | **`BROWSER_E2E_TOTAL=475 · PASS=475 · FAIL=0`** |
| unit suite | **2402 pass · 0 fail · 1 skip** (2403 tests, 254 suites) |
| ESLint | **392 files, 0 errors, 0 warnings** |
| `tools/verify-source.mjs` | `SOURCE_VERIFY=PASS migrations=19 baseline=12/12 intact` |
| §5a hygiene | project containers **2** (installation + one rollback), total **52**, `webui-e2e`/`e2e-base` tags **0**, networks the two stable ones + `noesar-local` (V3, untouched) |
| secret scan | **heuristic** — `gitleaks` image absent and **not pulled** (rule 45); 0 hits on the added lines |
| **T3 · image bytes = tree** | 5 of 5 files identical by `sha256sum` inside the image vs on disk, **before** any mutation |
| **T3 · the installation serves those bytes** | `GET /styles.css` `9b28968a23cc…` · `/index.html` `c4a4efb4ba0f…` · `/app.js` `46dca2b5b189…` — all MATCH the tree |
| **T3 · health after deployment** | `running healthy` · `/livez` **200** · `/readyz` **200** · children `postgres api codev atom` · auth-failure lines **0** |
| **§5a cleanup** | containers **53 → 52**, networks **10 → 10**, volumes **63 → 63**, non-project **50 → 50**; two project containers survive; the removed rollback's image stays on disk |

Logs: `EVIDENCE/t2_accessibility_20260813.log`, `EVIDENCE/t2_browser_e2e_20260813_a11y.log`,
`EVIDENCE/deploy_d0402_20260813.log`. Backup: `BACKUPS/a11y_20260813T021934Z/`.
Rollback: `noesar-evolution-pre-20260813T060219Z`, one command, in the ledger.

---

## ➜ WHAT WAS **NOT** DONE — declared

- **The three repairs are `[UNVERIFIED]` as rendered by this container.** What is proven live is
  that the deployed bytes equal the tree the audit exercised, that the service is healthy and that
  the surfaces answer — never a suite that mutates the installation's data (§3a 11e). The WCAG
  measurement itself ran on a disposable probe built from the same bytes.
- **The red-first proof for these three is last session's** (`D-0400`,
  `EVIDENCE/t2_accessibility_20260812.log`, `FAIL=3` naming the same selectors), **not re-taken
  here.** The green is measured in this session; the red is cited.
- **`computed-style-snapshot.mjs` was judged irrelevant and not run**: no colour, token or theme
  value changed — only geometry and one outline drawn with the existing `--focus-ring`. Contrast
  is covered by the audit that ran.
- **A2 was NOT performed** — it needs a signed-in session.
- **`F-MANIFEST-001` still not fixed** (`D-0399`): 5898 entries against 6568 tracked files. This
  phase added no file, so the gap did not grow.
- **`F-MODEL-001` and `F-HOOK-005` remain open**, neither root cause found.
- **`F4-010`..`F4-013`, `F7-001` unchanged.**
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
`noesar-voice-hear`; `noesar-voice-speak`; `noesar-search`): they exist only in the runtime and in
prose, so a third party cloning this repository gets no voice, no search and no model. Phase O6 —
the largest gap between "works here" and "self-hosted software".

---

## ➜ IMPROVEMENT PROPOSAL (recorded, not executed)

**The audit measures the element and never its ancestors** (`D-0403`). The 2.4.7 failure repaired
today read, from the log line alone, exactly like a control with no indicator at all — it was a
control whose indicator sat one level up, and the two need opposite repairs. `focusSignature()`
should record the ancestor's reaction separately, which also catches the inverse nothing measures
today: one wrapper ring around N controls, counted as N passes. *Cost:* ~25 lines plus a seeded
case proving it fires. **Owner's call.**

*Still standing:* `activeModelReport()` must declare **who** serves the model (`F-MODEL-001`);
an agent's test turn should be replayable evidence (`D-0398`).
