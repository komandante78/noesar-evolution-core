# SESSION HANDOFF

**Last updated:** 2026-08-18 · **Phase:** `s339` — `D-0526`…`D-0534` · **INSTALLED**
**Plan of record:** `MASTER_PROJECT/` · **Head:** `25704e1` · **Live:** `noesar-evolution:d0526-verified-acquisition-20260818T083258Z`

---

## ➜ LA PROSSIMA AZIONE

**Nothing is pending and nothing is half-built.** The Owner authorised commit, then push and
deploy; all three were performed — `cb01846` + `25704e1` on `origin/main`, deployed and verified
live as `noesar-evolution:d0526-verified-acquisition-20260818T083258Z` (`D-0534`).

**The next phase is the `/model` chain** («poi vai avanti con /model»), scoped and **not started**.

**Its first measurement, before any code is written:** *can a local inference runtime exist on this
host without a host-level change?* (platform law §60-64). Today `NOESAR_LOCAL_MODEL_RUNTIME` is
`disabled` on the container, **no model artefact is on disk** and **no runtime binary is in the
image**. That is why "starting a real model end to end" has been `[UNVERIFIED]` for four phases,
and the honest answer decides whether that phase builds a runtime, an adapter to one the operator
installs, or a declared refusal. Do not start by writing code.

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**The guarantees are adoptable without the implementation.** `packages/verified-acquisition/`
carries `SPEC.md` — eleven normative requirements (`VA-001`…`VA-011`), written so the component can
be implemented in any language from that document alone — plus the suite that measures it.

| | |
|---|---|
| traceability, both directions | a requirement no case measures, or a case naming a requirement the spec does not state, **fails the package's own tests**. **59 cases, 11/11 requirements covered** |
| cross-language crypto vectors | 8 fixed ed25519 cases — signed, tampered, transplanted signature, revoked key — **public material only**; no private key is stored and none is needed, because verification is the operation under test |
| one implementation, not two | the three former paths in `services/…/src/` are **re-export shims**; nothing deleted (rule 12), originals backed up (rule 22) |
| the suite has been seen to fail | run against broken implementations — missing function, permissive origin policy, ignored byte cap |

**Governance changed too, and it binds every future phase:**

- **The funding skill was verified against its sources and was wrong.** It described NGI Zero as
  open two months after it closed. **NGI Zero has concluded**; calls resume after summer 2026 under
  the **Open Internet Stack** — **Restack** (€5k–50k, €7M to 2030), **CodeSupply**, **ELFA**. Six
  platforms now carry URLs, licence terms, the geography that disqualifies, and **the date each row
  was read**. Licence answer: all require a recognised free/open licence, and NLnet **explicitly
  permits additional proprietary licences alongside it** — AGPL plus a commercial licence is
  compatible, open core is not a disqualifier.
- **The session-close guard states §21b directly** — exactly two containers survive — instead of
  assuming one deployment per session. Stricter, not looser: two rollbacks now block. Its scope
  pattern also now catches the **dot-separated** probe names this project actually uses.
- **Every improvement proposal must name its funding platform and trait.** *"Fits none"* is a valid
  written answer.

**Five defects found and repaired, four of them in what this phase itself wrote:** the base image
did not copy `packages/` (a restart loop, not a wrong answer) · the import-closure walker read
comments as code · the container guard's scope pattern missed the dot · the conformance vector
runner built the trust store from the document's own claim about itself · a traceability test
asserted a table's shape while its comment claimed to be an oracle.

**Evidence, produced this session:** `npm test` **2626/2627** (1 pre-existing skip) · conformance
**59/59, 11/11 requirements** · `model-acquisition-e2e` **33/33** through the shims · ESLint
**0/424** · governance **6/6, 323 checks** · byte-equal tree↔image **9/9**, tree↔running **4/4** ·
`/livez` and `/readyz` **200** on both ports · the four model surfaces **401** anonymously ·
containers **50→50** non-project, volumes **65→65**, networks **10→10**.

**The restart-loop risk was removed before production was touched**, not after: the shim's import
was executed inside the built image, offline (`docker run --rm --network none --entrypoint node`),
and resolved.

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **The `/model` chain was not started.** It is the next phase, not this one.
- **The browser suite was not re-run**, and that is a scoping decision, not a gap: this phase
  changed no markup and no browser JavaScript. `tools/accessibility-audit.mjs` likewise.
- **Starting a real model end to end is still `[UNVERIFIED]`** — unchanged for four phases, for the
  reason stated at the top.
- **`F-MODEL-AUTH-001`** unchanged: descriptor authenticity gates **acquiring**, not **starting**,
  and neither shell displays it.
- **Publication and the licence question are Owner decisions, not taken.** The package is in no
  registry (rule 35), and whether a component meant for adoption should be more permissive than
  AGPL is about **adoption**, not eligibility — copyleft is penalised by no platform checked.
- **No delete route, no discovery, no download resume, no quarantine retention, `MANIFEST` not
  regenerated.** Unchanged.
- **`gitleaks` is absent.** Every secret scan this session was **heuristic** and declared as such.

---

## OPEN BLOCKERS

- `B-002` **stale premise** (`D-0257`): re-measured — `gitleaks` is genuinely absent.
- `B-011` low, deferred (`D-0258`): history rewritten on the Owner's explicit authorisation.

---

## THE IMPROVEMENT PROPOSAL — `D-0535`, awaiting the Owner

**Give `#/coden`'s chooser and `/model` the authenticity `#/models` already shows**, and
distinguish *unsigned because nobody signed it* from *unsigned because we synthesised it from the
running runtime* — the distinction `F-MODEL-AUTH-001` is blocked on. It would let **starting** a
model be gated the way **acquiring** one already is, without refusing to re-activate what the
installation is currently running.

**Funding fit: Restack · traits 3 and 5** — user-visible provenance for what a local system
executes, and reliability measured rather than asserted. Explicitly **not trait 2**: this part is
product surface, not a reusable component.
