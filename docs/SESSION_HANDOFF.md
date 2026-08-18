# SESSION HANDOFF

**Last updated:** 2026-08-18 · **Phase:** `s338` — `D-0523`/`D-0524` · **BUILT AND TESTED, NOT COMMITTED**
**Plan of record:** `MASTER_PROJECT/` · **Head:** `3bb236f` · **Live:** `noesar-evolution:d0520-model-transport-20260818T023243Z` (still `s337` — this phase is not deployed)

---

## ➜ LA PROSSIMA AZIONE

**Waiting on the Owner for three things, in this order:**

1. **Commit** — 11 files (2 new). Nothing staged; the diff has been reviewed.
2. **Push** — `origin/main` is level with `3bb236f`.
3. **Deploy** (§3a: build → bytes-equal-tree → stop with grace → backup stopped → preserve
   predecessor → start with config read back → live verify → §5a cleanup).

**Then, and only on a new instruction: the `/model` chain the Owner named** («poi vai avanti con
/model»). It was deliberately **not** started — rule 9, one phase per invocation. Its first
measurement, before any code: *can a local inference runtime exist on this host without a
host-level change?* (platform law §60-64). Today `NOESAR_LOCAL_MODEL_RUNTIME` is `disabled` on the
container, no model artefact is present and no runtime binary is in the image — which is exactly
why "starting a real model end to end" has been `[UNVERIFIED]` for three phases running.

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

`D-0520` made an artefact startable only if its bytes match the sha256 **the publisher declared**.
That digest is a field of a document **nobody had signed**: the chain was strong at the wrong link.

**A descriptor is now accepted only if an ACTIVE key of a registered publisher signed it.**

| Property | How it is held |
|---|---|
| the signature covers `source` and `hashes.sha256` | ed25519 over `canonicalJsonBytes(document minus its signature)` — the shape `sector-modules.mjs` already uses, not a second format |
| a revocation applies **retroactively** | verified on **every read**, never cached at import |
| not checking cannot pass | `descriptorAuthenticity: null` refuses with `NOT_CHECKED` — an omission must never read as a permission |
| an unsigned descriptor is **visible** | shown with *why*, and unacquirable. Hiding it teaches nobody anything (`MC-002`'s posture) |
| an air-gapped installation can still import | the paste door uses **no network at all**; the fetch door is egress-consented |

**Evidence, produced this session:**

- `node tools/model-acquisition-e2e.mjs` → **`PASS`, 33/33** against the real control plane. New
  this phase: edited-after-signing refused `SIGNATURE_INVALID`; unsigned refused `NO_SIGNATURE` and
  **never written**; unsigned visible but `DESCRIPTOR_NOT_VERIFIED` on acquire; the origin policy
  applying to descriptors as to artefacts; re-import refused (rule 13); and **the imported document
  still verifying when read back from disk** — the round trip, not just the write.
- `node --test services/reference-control-plane/test/*.test.mjs` → **2614 tests, 2613 pass, 0 fail,
  1 skipped** (12 new authenticity tests, 2 new catalogue refusals).
- `bash tools/run-eslint.sh` → **0 errors, 0 warnings, 418 files**.
- `node tools/verify-source.mjs` → `SOURCE_VERIFY=PASS`. i18n → `VERDICT=COVERED` (10 markup +
  10 runtime strings translated).

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Not committed, not pushed, not deployed.** The installation still serves `s337`.
- **The `/model` chain was not started.** It is the Owner's named next step, not this phase.
- **`F-MODEL-AUTH-001` opened, not repaired.** Authenticity gates **acquiring**, not **starting**,
  and neither `#/coden`'s chooser nor `/model` in the terminal displays it. Not repaired on purpose:
  the running model is synthesised with **no publisher**, so it is unsigned by construction, and
  gating activation would refuse to re-activate what the installation is already running. The fix
  is to distinguish *unsigned because nobody signed it* from *unsigned because we synthesised it* —
  its own phase.
- **The browser suite was not re-run after the UI change** — `[UNVERIFIED]`: the new card line and
  the import panel are proven by their markup/i18n gates and by the route-level e2e, not by a
  browser driving them. It runs with the deployment, against a probe (§3a 11e).
- **`tools/accessibility-audit.mjs` not run.** Named, not silently skipped.
- **`MANIFEST.sha256` not regenerated** — `F-MANIFEST-001`, still its own phase.
- **No delete, no discovery, no download resume, no quarantine retention.** Unchanged from `s337`.
- **`gitleaks` is absent.** The secret scan was **heuristic** and is declared as such.

---

## FILES THIS PHASE CHANGED

| File | What |
|---|---|
| `services/…/src/model-descriptor-authenticity.mjs` | **new** — sign, verify, and five named refusals: `NO_SIGNATURE`, `NO_PUBLISHER`, `NO_REGISTRY`, `KEY_NOT_TRUSTED`, `SIGNATURE_INVALID` |
| `services/…/src/model-transport.mjs` | `fetchDocument()` — same origin policy, cap, stall deadline and cancellation, integrity from the signature instead of a pre-declared digest. `fetchArtefact` keeps its digest requirement, unchanged |
| `services/…/src/model-catalog.mjs` | `DESCRIPTOR_NOT_VERIFIED` in `planAcquisition`; `authenticity` on every card |
| `services/…/src/server.mjs` | descriptors verified on read; `POST /api/v1/models/descriptors/import` with both doors; the authenticity passed into the acquisition plan |
| `schemas/model-descriptor.schema.json` | the `signature` object, previously impossible under `additionalProperties:false` |
| `apps/webui-static/{app.js,index.html,i18n-catalog.js}` | *signed by whom* / *unsigned and why* on every card; the import panel; 20 translations |
| `services/…/test/model-descriptor-authenticity.test.mjs` | **new** — 12 tests, each altering exactly one thing and requiring the answer to change |
| `services/…/test/model-catalog.test.mjs` | the two refusals, including "not checking is refused like failing" |
| `tools/model-acquisition-e2e.mjs` | the signed chain end to end, 33 checks |
| `docs/DECISION_LOG.md` | `D-0523`, `D-0524` |

---

## OPEN BLOCKERS

- `B-002` **stale premise** (`D-0257`): re-measured — `gitleaks` is genuinely absent, so the
  heuristic scan stands.
- `B-011` low, deferred (`D-0258`): history rewritten on the Owner's explicit authorisation.

---

## THE ONE IMPROVEMENT PROPOSAL — `D-0524`, awaiting the Owner

Publish the verified-acquisition layer (`model-transport.mjs` + `model-descriptor-authenticity.mjs`)
as a **documented, independently usable component** with its own conformance suite. It is already
shaped that way — the transport imports no `node:fs`, the verifier holds no policy, both take their
dependencies injected, and their 41 tests need no network and no container. "Fetch a
publisher-signed artefact under a cap, verify it, refuse it by name" is a problem every self-hosted
AI project has, and most solve it by shelling out to one vendor's CLI.
