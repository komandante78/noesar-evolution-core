# SESSION HANDOFF

**Last updated:** 2026-08-18 · **Phase:** `s340` — `D-0536` · **BUILT AND TESTED, NOT COMMITTED**
**Plan of record:** `MASTER_PROJECT/` · **Head:** `d943e8e` · **Live:** `noesar-evolution:d0526-verified-acquisition-20260818T083258Z` (still `s339`)

---

## ➜ LA PROSSIMA AZIONE

**Waiting on the Owner:** commit → push → deploy of `D-0536`. 7 files. Nothing staged; the diff has
been reviewed and the working tree is otherwise clean.

**`F-MODEL-AUTH-001` is closed by this phase.** Nothing about it remains open.

**Then, on a new instruction: the `/model` chain.** Its first measurement, before any code: *can a
local inference runtime exist on this host without a host-level change?* (platform law §60-64).
`NOESAR_LOCAL_MODEL_RUNTIME` is `disabled` on the container, no model artefact is on disk, no
runtime binary is in the image. The honest answer decides whether that phase builds a runtime, an
adapter to one the operator installs, or a declared refusal. **Do not start by writing code.**

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Starting a model is gated by WHO said so, not only by what the bytes hash to.**

The artefact check answers *"do these bytes match the digest the descriptor declares"*. It cannot
answer *"and who declared that digest"* — an unsigned descriptor vouches for itself. Both questions
are now asked, on the surfaces that start a model.

| | |
|---|---|
| `installedModelList()` | carries `authenticity` per entry — the listing `/model` answers from |
| `activateModel` | **403** for an unattested descriptor, **and** for a caller that did not check at all |
| `#/coden`'s chooser | draws the provenance beside each row; the **Use** button is drawn **disabled with its reason** when the descriptor does not verify (MC-006's posture) |
| both shells, one renderer | `detailLines` serialises the call result, so `/model` shows the same field over `ssh` and in the browser — **measured before building**, which is why this phase wrote one field instead of two renderings |

**The distinction that unblocked it — and why it belongs to the product, not the package.**
`model-descriptor-authenticity.mjs` reports what it *sees*: a record with no signature is
`NO_SIGNATURE`. Only `server.mjs` knows it **wrote one of those records itself**, from what the
runtime reports it is running. That record is marked `synthesised` and reported as a third kind:

- **`NO_SIGNATURE`** — a publisher placed a document here and did not sign it. Something was
  claimed and nothing backs it. **Not started.**
- **`SYNTHESISED`** — nobody claimed anything. There is no signature to look for and its absence is
  not evidence of anything. **Reported prominently, and started**, because refusing it would make
  an installation unable to describe what it is running.

Collapsing the two is exactly what `F-MODEL-AUTH-001` was blocked on. The package stays generic, so
`SPEC.md` and the conformance suite are untouched.

**`undefined` refuses; `null` is a statement.** A caller that did not check is refused — an
omission must never read as a permission, the same rule `planAcquisition` carries. An explicit
`null`, from a caller with no registry saying so, is accepted.

**Evidence, produced this session:**

- **The gate was observed to fire against real callers**, not against a synthetic fixture: the
  moment it landed, **five pre-existing tests failed** because they started models without
  checking. They now state what they checked.
- 6 new tests, one per condition: unchecked · unsigned · revoked key · `SYNTHESISED` starts ·
  verified starts · explicit `null` starts.
- `node tools/model-acquisition-e2e.mjs` → **`PASS`, 36/36**, including three new checks that a
  downloaded, signed model reaches `/api/v1/models/installed` **carrying who signed it**.
- `npm test` → **2633 tests, 2632 pass, 0 fail, 1 skipped**.
- `bash tools/run-browser-e2e.sh` → **504/505**; the one FAIL is the declared gap `F-I18N-002` and
  this phase grew it by **zero** (647 closable, unchanged; recorded 905→908). `route coden` green.
- ESLint **0/424** · `SOURCE_VERIFY=PASS` · i18n `VERDICT=COVERED`.

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Not committed, not pushed, not deployed.** The installation still serves `s339`.
- **The `/model` chain was not started.** Next phase.
- **Starting a real model end to end is still `[UNVERIFIED]`** — no runtime, no artefact, no binary
  on this host. This phase gates a start; it does not make one possible.
- **`tools/accessibility-audit.mjs` not run.** Named, not silently skipped.
- **The live installation's behaviour does not change.** `models/catalog/` is empty there, so no
  start that works today stops working — `[INFERRED]` from that emptiness, and the deployment's own
  verification is what will confirm it.
- **No delete route, no discovery, no download resume, no quarantine retention, `MANIFEST` not
  regenerated.** Unchanged.
- **`gitleaks` is absent.** The secret scan was **heuristic** and is declared as such.

---

## FILES THIS PHASE CHANGED

| File | What |
|---|---|
| `services/…/src/server.mjs` | the synthesised record is marked; `productAuthenticity()` reports `SYNTHESISED`; `installedModelList()` carries `authenticity`; the activation call states what it checked |
| `services/…/src/local-model-runtime.mjs` | `activateModel` gains the authenticity gate, with the `SYNTHESISED` carve-out that makes it installable |
| `apps/webui-static/app.js`, `i18n-catalog.js` | provenance beside each chooser row; **Use** disabled and explained when unattested; one new string |
| `services/…/test/local-model-runtime.test.mjs` | 6 new tests, and every existing call now states what it checked |
| `services/…/test/session-protocol.test.mjs` | the same, on the wiring the shells drive |
| `tools/model-acquisition-e2e.mjs` | three checks that authenticity reaches the starting surface |
| `docs/DECISION_LOG.md` | `D-0536` |

---

## OPEN BLOCKERS

- `B-002` **stale premise** (`D-0257`): re-measured — `gitleaks` is genuinely absent.
- `B-011` low, deferred (`D-0258`): history rewritten on the Owner's explicit authorisation.

---

## THE IMPROVEMENT PROPOSAL — `D-0537`, awaiting the Owner

**Make the descriptor a publisher can produce without reading our source.** Signing one today means
knowing the exact canonical-JSON rule and writing an ed25519 signature by hand; the product ships
`signModelDescriptor` but no *tool* a publisher can run. A tiny `tools/sign-model-descriptor.mjs`
— key in, descriptor in, signed descriptor out, refusing to sign anything that does not already
validate against `schemas/model-descriptor.schema.json` — turns "signed descriptors are required"
from a rule into something a third party can actually satisfy.

**Funding fit: Restack · traits 2 and 6** — it is what makes the format adoptable by someone other
than us, and ecosystem impact is the trait that asks *who else can use this*. Without it the
signature requirement is a wall with no door.
