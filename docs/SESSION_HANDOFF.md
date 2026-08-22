# SESSION HANDOFF

**Long session, real progress toward "finire il progetto":** deployed voice hands-free
fix + 3 UX gaps (`D-0640/41`), fixed a WCAG regression (`D-0646`), gave `#/knowledge`
and `#/memory` a real identity (`D-0647`), shipped direct agent-creation from chat
(`D-0648`), and decomposed `§4#10` multimodality into three phases, one already met
(`D-0649`). Four deploys this session, all verified live.

## ➜ LA PROSSIMA AZIONE

Three items remain from `D-0645`/`D-0649`, each its own phase (rule 9) — picked in this
order for size, smallest first:
1. **Audio transcription for uploaded files** — `file-extractors.mjs` already declares
   the gap (`status:'transcription_required'`); `noesar-voice-hear` (Whisper-compatible,
   GPU-attached) is already running for live voice, no new container. The real work: the
   extractor is currently fully **synchronous** (shell `run()` calls only) — adding a
   network call to an already-running service means either making extraction async or
   adding a follow-up async step. Not yet designed.
2. **Images — vision-caption fallback** — when OCR finds no text and a vision-capable
   provider is configured. Needs a new concept this codebase does not have yet: how a
   provider declares "I accept image input." Not yet designed.
3. **Kokoro TTS → GPU move** — infrastructure on `noesar-voice-speak`, a
   non-`noesar-evolution` container. Stopped here twice already this session on stale
   premises (Kokoro turned out to already be running; the search-box "24px" symptom
   turned out to be CSS, not TTS). Needs an explicit, separate technical confirmation
   before touching a running container — not covered by a general "vai avanti".

## WHAT IS TRUE NOW THAT WAS NOT

See `docs/DECISION_LOG.md` `D-0640` through `D-0649` for the full session — six decision
entries, four deploys, all with before/after evidence. Summary: `docs/INSTALLATION_
LEDGER.md` tail carries the same four deploys with byte-equal/health/test evidence per
entry, most recently `d0648-agent-directive-…`.

**`D-0649`'s finding, worth restating because it changes the backlog:** "documents" in
`§4#10`'s multimodality priority is **already done** — PDF/Office/ZIP/text ingestion,
indexing and RAG retrieval into chat all already exist and are already proven by
`prompt-injection-containment.test.mjs`. Only images and audio are real gaps.

## WHAT WAS **NOT** DONE

- Audio transcription, vision captioning, Kokoro→GPU — scoped, not built (see above).
- **No push** — `git push origin main` still fails, no GitHub credential in this
  container (`B-013`, unchanged all session). Commits are complete and correct locally,
  five commits ahead of what could be pushed.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; every
  diff this session was reviewed with a heuristic grep, clean, declared as heuristic.
- `B-011` low/deferred (`D-0258`): git history rewritten on Owner's explicit authorisation.
- `B-013` **still open**: `git push origin main` refused, no GitHub credential stored in
  this container. Commits keep queuing locally, correct and complete.
- No other new blocker.
