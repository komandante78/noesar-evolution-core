# SESSION HANDOFF

**Last updated:** 2026-08-18 · **Phase:** `s341` — `D-0539`…`D-0543` · **INSTALLED**
**Plan of record:** `MASTER_PROJECT/` · **Head:** `ecf2750` · **Live:** `noesar-evolution:d0539-model-chain-20260818T154206Z`

---

## ➜ LA PROSSIMA AZIONE

**Nothing is pending and nothing is half-built.** Committed (`ecf2750`), pushed, deployed and
verified live (`D-0539` ledger entry).

**The question that opened this phase is answered, and it decided the shape of the work.** *Can a
local inference runtime exist on this host without a host-level change?* Measured, not assumed:
no `ollama`, no `llama-server`, no `vllm`, no `llamafile`, no `python3` on this host; no runtime
named anywhere in `oci/`; nothing answering on `127.0.0.1:11434`. So the product does **not**
build an inference engine — shipping a binary would break rule 33 and the platform law — and it
does **not** refuse either: `LocalModelRuntime` was already an adapter that launches or attaches
to an OpenAI-compatible server the operator supplies. What was missing was the **last link**, and
that is what this phase built.

**Then, on a new instruction — the two candidates, in order of value:**

1. **`D-0541`, the health lane** (this phase's improvement proposal): a cheap periodic liveness
   reading for the derived provider, so a model that dies between messages is reported as gone
   *before* the next message fails instead of on it.
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

**Evidence, produced this session:**

- **The oracle was seen to fail first**: with the routing line reverted, 3 of the new tests fail;
  with it, 12/12 pass. An oracle that never failed has not been shown to work.
- `node tools/model-acquisition-e2e.mjs` → **PASS, 48/48**, including a **chat message answered by
  a real OpenAI-compatible server** and attributed to `local-runtime` — not a stub of the product,
  a stand-in for the *model*.
- `npm test` → **2645 tests, 2644 pass, 0 fail, 1 skipped**.
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
- A racing assertion in the browser suite read the update panel on the toast rather than on the
  re-render; it passed one run and failed the next on identical product behaviour. Fixed at the
  race.

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Starting a real model end to end is still `[UNVERIFIED]` on this host** — there is no runtime
  binary and no artefact here. What is proven is the chain against a real OpenAI-compatible
  server; what is not proven is a transformer decoding tokens on this machine.
- **The live installation's behaviour did not change**, as expected and as verified: the runtime is
  `disabled` here, so no derived provider exists and chat routes exactly as before.
- **`D-0541` was proposed, not built.** No liveness timer exists: the evidence a runtime is serving
  is a live child process or the last successful probe, and both can be minutes stale.
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
| `tools/accessibility-audit.mjs`, `tools/browser-e2e.mjs` | the two tool repairs above |
| `apps/webui-static/app.js`, `styles.css`, `i18n-catalog.js` | who answers, in the chooser; the read-only provider card; the 24×24 target |
| `oci/Dockerfile.phase4-model-chain` | **new** — the deployment overlay, rollback cost stated in the file |

---

## OPEN BLOCKERS

- `B-002` **stale premise** (`D-0257`): re-measured — `gitleaks` is genuinely absent offline.
- `B-011` low, deferred (`D-0258`): history rewritten on the Owner's explicit authorisation.

---

## THE IMPROVEMENT PROPOSAL — `D-0541`, awaiting the Owner

**A health lane for the model that is answering.** Today the derived provider exists on the
strength of a live child process or the last successful probe, both of which can be minutes stale;
the first message after a crash pays for the discovery. A cheap periodic liveness reading — the
probe the runtime already performs — would report the model as gone *before* the next message
fails, and would give the same signal to the status chips.

**Funding fit: Restack · traits 5 and 3** — measurable reliability of a local-first component, and
it strengthens the self-hosted path rather than an external one.
