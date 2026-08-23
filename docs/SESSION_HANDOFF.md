# SESSION HANDOFF

**Session continues:** deployed voice hands-free fix + 3 UX gaps (`D-0640/41`), fixed a
WCAG regression (`D-0646`), gave `#/knowledge` and `#/memory` a real identity (`D-0647`),
shipped direct agent-creation from chat (`D-0648`), decomposed `§4#10` multimodality into
three phases (`D-0649`), and closed the first of those three: uploaded audio/video files
are now transcribed via the already-running `noesar-voice-hear` (`D-0650`). Five deploys
this session, all verified live.

## ➜ LA PROSSIMA AZIONE

Two items remain from `D-0645`/`D-0649`, each its own phase (rule 9):
1. **Images — vision-caption fallback** — when OCR finds no text and a vision-capable
   provider is configured. Needs a new concept this codebase does not have yet: how a
   provider declares "I accept image input." Not yet designed.
2. **Kokoro TTS → GPU move** — infrastructure on `noesar-voice-speak`, a
   non-`noesar-evolution` container. Stopped here twice already on stale premises
   (Kokoro turned out to already be running; a "24px" symptom turned out to be CSS, not
   TTS). Needs an explicit, separate technical confirmation before touching a running
   container — not covered by a general "vai avanti".

## WHAT IS TRUE NOW THAT WAS NOT

See `docs/DECISION_LOG.md` `D-0640` through `D-0650` for the full session — seven
decision entries, five deploys, all with before/after evidence. `docs/INSTALLATION_
LEDGER.md` tail carries the same five deploys with byte-equal/health/test evidence per
entry, most recently `d0650-audio-transcription-…`.

**`D-0650`:** `file-extractors.mjs`'s media branch now calls the same `transcribe()`
(`voice-engine.mjs`) the live microphone route uses — one quality judgment for audio, not
two. `NOESAR_VOICE_TRANSCRIBE_ENDPOINT` is already set on this installation, so the
capability is live immediately, not dormant behind an unset variable. Unconfigured
installs keep the prior `transcription_required` behaviour unchanged.

## WHAT WAS **NOT** DONE

- Vision captioning, Kokoro→GPU — scoped, not built (see above).
- **No push** — `git push origin main` still fails, no GitHub credential in this
  container (`B-013`, unchanged all session). Commits are complete and correct locally.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; every
  diff this session was reviewed with a heuristic grep, clean, declared as heuristic.
- `B-011` low/deferred (`D-0258`): git history rewritten on Owner's explicit authorisation.
- `B-013` **still open**: `git push origin main` refused, no GitHub credential stored in
  this container. Commits keep queuing locally, correct and complete.
- No other new blocker.
