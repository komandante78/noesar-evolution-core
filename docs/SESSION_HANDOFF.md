# SESSION HANDOFF

**Last updated:** 2026-08-17 · **Phase:** `s336` — `D-0515` / `D-0516` / `D-0517`
**Plan of record:** `MASTER_PROJECT/` · **Head at close:** see `PROJECT_STATE.json.last_commit`

---

## ➜ LA PROSSIMA AZIONE

**Nothing is half-built, and two things need the Owner — in this order:**

1. **Authorise the commit.** The work below is complete, verified and **uncommitted**: 12 files,
   +502/−21. `CLAUDE10.md` §77 stops at commit and push, and this session did not cross it.
2. **Authorise the deployment, or say no.** The repair the Owner reported (`/model` →
   «Nothing named `mode`») is **in the tree and not on the installation**. The live container is
   `noesar-evolution:d0493-password-form-fix-20260816T155232Z` (2026-08-16), which still has the
   dead end. Until it is deployed, the Owner keeps seeing the defect he reported.

**Then the next phase, which is already scoped and NOT started** — the rest of what the Owner
asked for on 2026-08-17, in dependency order:

| Next | What | Blocked by |
|---|---|---|
| `s337` | `#/models` redesigned: rows get real **Use** and **Delete** buttons with confirmations, grouped by declared type with an explanation of what each is for | nothing — `Use` already has its route (`D-0516`); **Delete has no route and must be built** |
| `s338` | The **download transport**: `POST /api/v1/models/acquire` plans correctly and then answers `501 NO_TRANSPORT` — the bytes are never fetched | an Owner decision on egress; see `D-0517` |
| `s339` | **Automatic discovery** of new models from curated sources | egress, so **off by default** (`CLAUDE10.md` §8 rules 30-32) — a design decision, not a switch |

---

## OPEN BLOCKERS

**None opened this phase.** What `PROJECT_STATE.json.blockers` carries is unchanged: `B-011`
(token rotation deliberately deferred by the Owner, history already rewritten) and `B-002`
(stale premise, kept for history, superseded by `B-011`).

**One finding was found and deliberately left open:**

| id | severity | why it is not fixed |
|---|---|---|
| `F-I18N-002` | low | The e2e run's only failure: the catalogue-closable gap reads **643 of 911 recorded** against a declared baseline of **607**. It did not rise this phase (the last recorded reading was 644) and the finding's own protocol forbids re-baselining before the full diff is read. The new UI strings all go through `t()`, so they are inside the localization layer (rule 50) — they are simply not translated yet. |

`F-HOOK-008` (quote mask per line, fail-safe) also remains open from the previous phase.

---

## WHAT WAS VERIFIED — measured this session

| Check | Result |
|---|---|
| `tools/run-browser-e2e.sh`, full run against a disposable probe | **504 PASS · 1 FAIL**, the one failure being `F-I18N-002`, a declared gap. `RETENTION=delete only-declared-gaps-failed`, exit 0 |
| the four new chooser checks, in the browser | **all PASS** — it opens from the chip (`expanded=true`), it answers from the installation instead of sitting on its loading line, an empty result **says why** it is empty, and closing it reports `aria-expanded=false` |
| `tools/auth-http-smoke.mjs` | **PASS** with four new assertions: `models/installed` 200 + `{models,activeId}`, `models/activate` **403** without CSRF, **400** with no id, **404** (not 500) for an unknown id with its reason preserved |
| `tools/http-smoke.mjs` | **PASS** — `models/installed` added to the anonymous-401 boundary list |
| targeted unit suites | **168/168** (`coden-view-model`, `coden-terminal-client`, `coden-shell-parity`, `model-catalog`, `session-protocol`) |
| `tools/run-eslint.sh` | **411 files, 0 errors, 0 warnings** |
| **seen red first** | the pre-repair `planTurn` returns **exactly the Owner's sentence** (`Nothing named \`mode\`. Type / for the list.`) with `suggestions: undefined`; `segmentInput` did not exist and its wiring assertion was false — both checked against `git show HEAD:` |
| the `/` menu itself | **17 entries, all resolve** (`CE-036` green). Grouped WORK 15 · CONFIGURE 1 · SESSION 1. The Owner's pasted list started mid-address-book, so the missing WORK group was **scrolled off**, not filtered away |
| §5a cleanup | the probe, the runner and the probe image were removed by the tool; inventory in `EVIDENCE/docker_inventory_post_e2e_20260817T150751Z.txt`. **0** e2e containers, **0** e2e image tags, **0** stamped networks. Other projects' containers untouched |
| the live installation | `running/healthy`, `RestartCount=0`, `/livez` **200 alive**, `/readyz` **200 ready:true** — unchanged by this phase, which deployed nothing |

---

## WHAT WAS **NOT** DONE — deliberately

- **No commit, no push, no deployment.** All three are Owner decisions (`CLAUDE10.md` §77).
- **The `#/models` page was not touched.** Its cards still have no buttons — that is `s337`, and
  it is named above rather than half-started here.
- **No download and no delete.** `acquire` still answers `501 NO_TRANSPORT`; no delete route
  exists. Both were measured, not assumed, and both are separate phases.
- **The `/model` chain to a running model was never exercised end to end**, because no model
  descriptor and no local runtime exist on the probe: the chooser was proven up to the choice,
  and the empty state it drew is the honest one. Starting a real model is `[UNVERIFIED]`.
- **`F-I18N-002` was not re-baselined** and the new strings were not added to the catalogue.
- **`MANIFEST.sha256` was not touched** — the tracked file **set** did not change.

---

## FILES THIS PHASE CHANGED

| File | What |
|---|---|
| `apps/shared/coden/terminal-input.mjs` | **new** `segmentInput()` — a chunk carrying an embedded newline submits instead of swallowing the line |
| `apps/webui-static/coden-terminal.js` | `onData` feeds segments to a named `handleInput`, never the raw chunk |
| `apps/webui-static/coden-view-model.js` | `planTurn`'s `unknown` branch suggests up to three offered entries and carries `suggestions` |
| `apps/webui-static/app.js` | the CodeN model chooser: render, states, confirmation, activation, chip refresh; the chip label moved to its own element |
| `apps/webui-static/index.html`, `styles.css` | the chip's opener button, the chooser panel, its styles in both themes |
| `services/reference-control-plane/src/server.mjs` | `GET /api/v1/models/installed`, `POST /api/v1/models/activate`; `installedModelList` / `activateInstalledModelById` hoisted so the bridge and HTTP share one decision |
| `tools/auth-http-smoke.mjs`, `tools/http-smoke.mjs`, `tools/browser-e2e.mjs` | the new routes and the chooser, driven rather than asserted from source |
| `services/…/test/coden-view-model.test.mjs`, `coden-terminal-client.test.mjs` | +11 tests (3 suggestion, 7 segmentation, 1 pinning the pre-repair decoder) |
| `docs/DECISION_LOG.md` | `D-0515`, `D-0516`, `D-0517` |

---

## THE ONE IMPROVEMENT PROPOSAL — `D-0517`, awaiting the Owner

Build the model transport as a **delimited, reusable component** — publisher-signed descriptor,
capped stream, digest verified before the artefact is ever startable — rather than as a download
button wired into a page. It is what `s338` needs anyway, and as a component it answers the
funding criteria this project measures itself against (`noesar-evolution-funding-fit` traits
1, 2, 3, 5) instead of the red flag of a WebUI over someone else's model API.
