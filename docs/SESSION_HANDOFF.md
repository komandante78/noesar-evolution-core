# SESSION HANDOFF

**`#/knowledge` and `#/memory` now have a distinct, verified-live identity.** Owner
delegated `§4#6/#7` directly ("scrivile te fai una ricerca e implementa"); researched,
screenshotted the real render first, fixed a real terminology collision and a real
layout bug found in the process, and deployed. Three of four `D-0645` decisions remain.

## ➜ LA PROSSIMA AZIONE

Pick one of the three remaining `D-0645` decisions to open the next phase (each is its
own phase, rule 9):
1. **TTS**: move the already-running Kokoro-82M container (`noesar-voice-speak`) to the
   idle RTX 3060 GPU — infrastructure action, outside this project's own container
   authority, needs its own explicit scoping before it can be executed.
2. **`§4#9`**: chat/CodeN natural-language agent creation should create directly, no
   confirmation step.
3. **`§4#10`**: multimodality, in priority order — documents/files, images, audio.

## WHAT IS TRUE NOW THAT WAS NOT

**`D-0647`, deployed and verified live** (`d0645-knowledge-memory-identity-…`).
Screenshotted both pages live first, with a new reusable instrument
(`tools/page-screenshot.mjs` — signs in a throwaway Owner on the disposable e2e probe,
screenshots any route, prints base64 PNGs) instead of judging from markup. Found:
- The Knowledge page's hand-written "Notes" block used **"memory" vocabulary
  throughout** (`#memoryForm`, "Add memory", "Save memory") while its own header
  already said "separate from the Memory destination" — the controls contradicted
  their own disambiguating sentence. Renamed to `note*` ids/labels/JS
  (`renderNotes`, "Add note", "Visible notes"); backend route `/api/v1/memories`
  unchanged, DOM-facing vocabulary only.
- A **real, reproducible layout bug**: `#/memory`'s search input rendered at 24px
  wide — unusable. Root cause: a sibling `<select>`'s generic `width:100%` competed
  for flex space; the Knowledge search row never hits this because it has no
  `<select>`. Fixed with `.search-row select{flex:0 0 auto;width:auto}`.
- Both pages shared one generic panel/form template with zero visual distinction.
  Added a `.section-icon` badge echoing each page's own nav glyph (◈/✦); enriched
  every bare-text empty state with a one-sentence explanation.

Researched first (WebSearch, cited in `D-0647`): 2026 ChatGPT splits "saved memories"
(explicit) from "reference chat history" (implicit) — confirming this product's real
Notes-vs-Memory split needed disambiguation, not a redesign; dashboard convention is
icon+one-sentence empty states.

**Verified, not asserted:** unit 2976/2977 (1 pre-existing skip), ESLint 475/0/0,
browser-e2e 510/511 (`F-I18N-002` only, 0 undeclared), accessibility **27/27**,
`measure-ui-language-coverage.mjs` VERDICT=COVERED, bytes-equal tree↔image 476/476,
live `/livez` `/readyz` `/healthz` 200, two containers survive.

**Improvement proposal, `D-0647`:** `tools/page-screenshot.mjs` is worth keeping as a
standing instrument for "does this page actually look right" questions. **Funding fit:
none** — depends on this product's own auth-bootstrap flow.

## WHAT WAS **NOT** DONE

- Kokoro→GPU move, `§4#9` direct NL agent creation, `§4#10` multimodality — scoped in
  `D-0645`, not built. Each needs its own phase contract.
- **No push** — `git push origin main` still fails, no GitHub credential in this
  container (`B-013`, unchanged). Commits are complete and correct locally.
- No dedicated regression test added for the `.search-row select` flex bug
  specifically — the accessibility/browser suites already exercise `#/memory`'s
  render and would have caught a full regression; a pixel-width assertion for this
  one selector was judged not worth a new permanent check.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; this
  session's diff review was a heuristic grep, clean, declared as heuristic.
- `B-011` low/deferred (`D-0258`): git history rewritten on Owner's explicit authorisation.
- `B-013` **still open**: `git push origin main` refused, no GitHub credential stored in
  this container. Commits keep queuing locally, correct and complete.
- No other new blocker.
