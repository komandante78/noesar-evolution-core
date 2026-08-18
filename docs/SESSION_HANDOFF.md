# SESSION HANDOFF

**Last updated:** 2026-08-18 · **Phase:** `s342` — `D-0544`/`D-0545` (after `s341`, `D-0539`…`D-0543`) · **INSTALLED**
**Plan of record:** `MASTER_PROJECT/` · **Head:** `8182f28` · **Live:** `noesar-evolution:d0544-health-lane-20260818T160214Z`

---

## ➜ LA PROSSIMA AZIONE

**Nothing is pending and nothing is half-built.** Two phases closed back to back — `s341` built
the chain (`D-0539`), `s342` built its health lane (`D-0544`, the Owner's authorisation of the
`D-0541` proposal). Committed (`8182f28`), pushed, deployed and verified live.

**`s342`, in one paragraph.** `lastProbe` was written only by `attach()`, which an operator calls
once: in attach mode a server that died stayed `ok: true` for ever and the first chat message
after the death was what discovered it. Now `liveness()` re-reads the endpoint at most once per
15 s, in the background, never blocking a reader; `attach()` is the **single observer**, recording
the monotone "last seen" and the failure counter; the provider is withdrawn after **two**
consecutive failures, never one; and an `unref()`-ed heartbeat drives the same reading so an
installation with nobody watching still notices. **Three defects the tests found**, each fixed at
its source: `attach()` success was not recording "last seen"; `servingEvidence` still read
`lastProbe.ok`, so one failure wiped the evidence and defeated the hysteresis beside it (found by
the e2e, not by reading); and `attach()` plus the probe both counted, so two failures read as four.

**The question that opened `s341` is answered, and it decided the shape of both phases.** *Can a
local inference runtime exist on this host without a host-level change?* Measured, not assumed:
no `ollama`, no `llama-server`, no `vllm`, no `llamafile`, no `python3` on this host; no runtime
named anywhere in `oci/`; nothing answering on `127.0.0.1:11434`. So the product does **not**
build an inference engine — shipping a binary would break rule 33 and the platform law — and it
does **not** refuse either: `LocalModelRuntime` was already an adapter that launches or attaches
to an OpenAI-compatible server the operator supplies. What was missing was the **last link**.

**Then, on a new instruction — the two candidates, in order of value:**

1. **`D-0545`, model availability as an observable signal** (this phase's proposal): emit the
   liveness state into the product's structured telemetry so an operator can alert on "the model
   has been down five minutes" without watching a page. Deliberately **not** `/readyz` — the
   product is correct without a model, and failing readiness would restart a healthy container
   over an absent one.
2. **`D-0537`, the signing tool** (still open from `s340`): `tools/sign-model-descriptor.mjs`, so a
   third party can actually satisfy "descriptors must be signed".

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**The model chosen with `/model` is the model that answers.**

Nothing joined `activateModel()` to the provider gateway. A person could choose a model, watch it
start, and be answered by something else — or by nothing, with `All streaming providers failed` —
and no surface said which had happened. `activeModelConsumers()` was honest by omission: it named
the Author and ATOM and never chat, because chat genuinely did not use the chosen model.

| | |
|---|---|
| `active-runtime-provider.mjs` **(new)** | derives a provider profile from the runtime's own status at every read, and stores nothing — so it stops existing the instant the runtime stops serving |
| `ProviderGateway` | routes at it, lists it first, and refuses (409) to let it be edited as if it were stored |
| `route()` | now separates an explicit per-message ask from a standing preference: the ask still wins outright, the preference keeps **exactly** its own chain, and the running model leads in front of it |
| `server.mjs` | `chat: { answers, model, reason }` on the listing `/model` answers from **and** on the activation — key order included, because `detailLines` keeps ten lines and the reason chat will *not* answer is the line most needed |
| both shells + `#/coden` | one field, one renderer: `/model` over `ssh` and the browser chooser show the same sentence; the providers page draws the derived profile read-only instead of offering controls the server refuses |

**`D-0540` — the property that keeps it safe.** The derived profile is `external: false`, which is
what lets it answer with no consent grant and no credential. So an endpoint that is not loopback
or a private address is **refused rather than dialled**, reusing `address-guard`'s audited
predicate rather than a second copy of the rule. Without it, `endpoint: https://api.example.com`
in the runtime configuration would have become an unconsented outbound call wearing the word
"local".

**Evidence, produced this session** (`s341` unless marked `s342`)**:**

- **The oracle was seen to fail first**: with the routing line reverted, 3 of the new tests fail;
  with it, 12/12 pass. An oracle that never failed has not been shown to work.
- `node tools/model-acquisition-e2e.mjs` → **PASS, 48/48**, including a **chat message answered by
  a real OpenAI-compatible server** and attributed to `local-runtime` — not a stub of the product,
  a stand-in for the *model*.
- `npm test` → **2645 / 0 fail** (`s341`), **2650 / 0 fail** (`s342`, +5 liveness tests).
- `s342`: `model-acquisition-e2e` **PASS 52/52** — a real inference server **killed mid-run**, the
  surface flipping on the **second** failure and not the first; and a disabled runtime measured at
  **0 `fetch` calls**, so §8 is untouched by the heartbeat.
- `bash tools/run-browser-e2e.sh` → **504/505**; the one FAIL is the declared gap `F-I18N-002` and
  this phase grew it by **zero** (closable **647**, unchanged).
- Accessibility → **27/27** (was 2 FAIL — see below). ESLint **0/426** · `SOURCE_VERIFY=PASS` ·
  i18n `VERDICT=COVERED`.

**Two defects the hunt found and repaired, not filed (`D-0542`, `D-0543`):**

- `#codenModelPickerOpen` was a **14×11 px** target — WCAG 2.5.8 requires 24×24. Repaired: the
  glyph stays small, the press area does not.
- The audit's four "no focus indicator" hits on `#/models` were a **false positive** — the controls
  sit in a closed `<details>` and are not focusable. Current Chrome no longer renders a closed
  disclosure with `display:none`, so the audit's `visible()` predicate let them through. **The
  audit was fixed, not the page**, and the exclusion is counted like the disabled one.
- A racing assertion in the browser suite read the panel on the toast, not on the re-render —
  green one run, red the next, on identical product behaviour. Fixed at the race (`D-0543`).

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Starting a real model end to end is still `[UNVERIFIED]` on this host** — there is no runtime
  binary and no artefact here. What is proven is the chain against a real OpenAI-compatible
  server; what is not proven is a transformer decoding tokens on this machine.
- **The live installation's behaviour did not change**, as expected and as verified: the runtime is
  `disabled` here, so no derived provider exists and chat routes exactly as before.
- **No UI change in `s342`, stated rather than implied.** The chooser reports the death through the
  reason it already renders; "last seen 4 s ago" while healthy is carried in the payload
  (`chat.lastSeenAt`) and is **not** drawn yet. The browser suite was therefore not re-run this
  phase — its last green run was `s341`'s, 504/505.
- **The heartbeat's `unref()` is by construction, not separately measured**: this is the product's
  main process, which is meant to stay up. `[INFERRED]`.
- **`D-0545` was proposed, not built.**
- **`MANIFEST.sha256` not regenerated** — `F-MANIFEST-001` is open and needs its own phase.
- **No delete route, no discovery, no download resume, no quarantine retention.** Unchanged.
- **`gitleaks` is absent** (image not present, offline). The secret scan was **heuristic** and is
  declared as such: no key, token, password or credential-bearing string in the diff.

---

## FILES THIS PHASE CHANGED

| File | What |
|---|---|
| `services/…/src/ai-workspace/active-runtime-provider.mjs` | **new** — the derivation, every refusal with its own reason, and the outward-endpoint refusal |
| `services/…/src/ai-workspace/provider-gateway.mjs` | derived profile in `get`/`list`/`route`; mutation refused with 409 |
| `services/…/src/ai-workspace/chat-orchestrator.mjs` | the two intents kept apart instead of collapsed with `??` |
| `services/…/src/server.mjs` | the thunk into the gateway, `chat` on both model surfaces, `chat` among the consumers |
| `services/…/test/active-runtime-provider.test.mjs` | **new** — 12 tests, half of them against a real HTTP server |
| `tools/model-acquisition-e2e.mjs` | +12 checks: the chain from chosen to answering, through the real control plane |
| `apps/webui-static/app.js`, `styles.css`, `i18n-catalog.js` | who answers, in the chooser; the read-only provider card; the 24×24 target |
| `oci/Dockerfile.phase4-model-chain` | **new** — the deployment overlay, rollback cost stated in the file |

---

## OPEN BLOCKERS

- `B-002` **stale premise** (`D-0257`): re-measured — `gitleaks` is genuinely absent offline.
- `B-011` low, deferred (`D-0258`): history rewritten on the Owner's explicit authorisation.

---

## THE IMPROVEMENT PROPOSAL — `D-0545`, awaiting the Owner

**Model availability as an observable signal.** The health lane now KNOWS the model is gone; only
a human looking at a screen learns it. Emitting the state change and a counter into the structured
telemetry the product already writes would let an operator alert on it. Not `/readyz`: a product
that is correct without a model must not fail readiness over an absent one.

**Funding fit: Restack · traits 5 and 2** — measurable reliability, and an availability signal is
reusable by anyone running the component, not only by this product's own UI.
