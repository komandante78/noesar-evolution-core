# SESSION HANDOFF

**`docs/OWNER_REVIEW_2026-08-21.md` triage continues — one real defect fixed, three UX gaps
closed, two items confirmed as already-handled, and the Owner asked directly for the four
that remain genuine product-vision decisions.** Still **no deploy** — commits keep queuing
for the one consolidated deploy already agreed with the Owner.

## ➜ LA PROSSIMA AZIONE

**Waiting on the Owner's answer to this session's question** (asked via `AskUserQuestion`):
visual identity for `#/knowledge` and `#/memory` (§4#6/#7), scope of NL-driven agent creation
in chat/CodeN (§4#9), scope of multimodality (§4#10), and whether to bind a recommended
self-hosted TTS model (§4#4, Kokoro-82M suggested — see `D-0642`).

**Once answered or explicitly deferred**: the sequence already agreed runs — **one
consolidated deploy** (this session's own commits plus the prior queue) → full `T2`
(`tools/run-browser-e2e.sh` + `tools/accessibility-audit.mjs`, neither run standalone this
session — both need the disposable image build) → benchmark against `docs/
OWNER_REVIEW_2026-08-21.md` §5's baseline numbers.

**`§3#6` is now fixed**, not open — see below. Nothing else in `§3` is open.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**Root cause of `§3#6` found and fixed.** Owner, verbatim: *"la voce si interrompe/blocca
durante l'uso, invece di restare attiva"* / *"resti attiva finché non la fermo io"*.
`VoiceSession#run()` (`apps/webui-static/voice-session.js`) only restarted listening after a
FULLY successful spoken reply — the three early-exit paths (silence for 6s, an unclear
utterance, a command with nothing to say) always dropped to `IDLE` regardless of
`this.#continuous`. A single 6-second pause was enough to silently end hands-free mode.
Fixed (`D-0640`): all three paths now restart exactly as the success path already did, still
gated on `continuous` and still NOT auto-restarting after a real `ERROR` (unchanged — a
failure must be told to the person, not looped over). 3 new regression tests, each seen red
against the pre-fix code.

**Three §4 UX gaps closed, none requiring guesswork about the Owner's taste (`D-0641`):**
- `§4#1` — model list "feels limited": added an opt-in **Show all on one page** toggle
  (`GET /api/v1/models/catalog?pageSize=`, server-capped at 500). The 6/page default
  (`D-0628`, Owner's own instruction) is untouched — this is the "way to see them all" the
  same review line asked for, not a change to the default.
- `§4#2` — no explanation of the catalogue: added an **ⓘ** disclosure in `modelCatalogPanel`
  explaining the three lanes and what Acquire/Load do.
- `§4#3` — chat toolbar "non si capisce nulla": the flat 8-control row is now three named,
  titled groups (**Where** / **Version** / **Model**) — no control moved or renamed.

**Two more §4 items triaged, not built (`D-0642`):**
- `§4#5` (voice window "statica... gioco per bambini") was **already repaired** by `dd08e3b`
  earlier in this same review session (radial 12-band spectrum + Catmull-Rom aura + breathing
  ring) — built, unit/lint/manifest-verified, **never deployed**. No further animation added
  on top of a fix the Owner has not seen live yet.
- `§4#4` (TTS "orribile, non sembra umana") is **not reachable in this repository**:
  `voice-engine.mjs` is a thin `POST /v1/audio/speech` adapter with zero synthesis logic —
  the voice's timbre is entirely a property of whichever external model is bound via
  `NOESAR_VOICE_SPEAK_ENDPOINT`/`NOESAR_VOICE_RUNE`/`NOESAR_VOICE_ESTRELA`. Recommendation put
  to the Owner rather than guessed at: a self-hosted, OpenAI-API-compatible TTS server such as
  Kokoro-82M (Apache-2.0, CPU-capable) bound to those variables — an installation choice.

**Improvement proposal, `D-0643`** (recorded, not built): `voice-session.js` is already a
pure, adapter-injected, headless-testable lifecycle with no DOM/fetch dependency — a genuine
candidate to extract as a standalone library for cancellable/interruptible voice turns over
any OpenAI-shaped speech API. Funding fit: Restack, traits 2 (reusable beyond this product)
and 4 (no vendor lock-in).

**Verified, not asserted:** unit 2976/2977 (1 pre-existing skip, 0 new failures), ESLint
474/0/0, `measure-ui-language-coverage.mjs` VERDICT=COVERED (12 new Italian strings added and
checked), manifest regenerated (6724 files, `MANIFEST=WRITTEN`).

## WHAT WAS **NOT** DONE

- **No deploy.** Commits keep queuing for the single consolidated deploy already agreed —
  now includes this session's `voice-session.js` fix and the three UX additions.
- **`accessibility-audit.mjs` and `tools/run-browser-e2e.sh` (T2) not run standalone** —
  `accessibility-audit.mjs` needs `puppeteer`, which this environment does not have outside
  the disposable image build; both are deferred to the consolidated deploy, the same declared
  pattern `dd08e3b` already used this session. Declared `[UNVERIFIED]` live, not claimed.
- **`§4#6/#7/#9/#10` still not built** — asked of the Owner this session, not implemented
  blind. Building them without an answer risks exactly the shallow/wrong placeholder rule 73
  forbids presenting as done.
- **No dedicated new browser-e2e checks** for `§3#6`'s fix or the three `§4` UX additions —
  the headless `voice-session.test.mjs` suite proves the state-machine property directly
  (no browser needed for that part); a live check that hands-free mode survives a real pause
  is still owed before calling the fix `PRODUCTION_GRADE` on the installation, not just in
  the state machine.
- **HUNT AND FIX** — scoped to this session's diff (`voice-session.js`,
  `voice-session.test.mjs`, `app.js`, `index.html`, `styles.css`, `i18n-catalog.js`,
  `server.mjs`, plus doc files). No new surface introduced, security/authority/installers
  untouched — a full sweep is not owed here.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): still neither `gitleaks` nor `trufflehog` on `PATH`; this
  session's own diff review was a heuristic grep for key/token/password/PEM markers, clean,
  declared as heuristic.
- `B-011` low/deferred (`D-0258`): git history rewritten on Owner's explicit authorisation.
- `B-013` **still open**: `git push origin main` refused, no GitHub credential stored in this
  container (by design, `B-001`). Commits keep queuing locally, correct and complete — only
  the push needs the Owner's token or a push from their own machine.
- No other new blocker.
