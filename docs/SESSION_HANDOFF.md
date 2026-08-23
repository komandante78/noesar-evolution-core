# SESSION HANDOFF

**Session continues:** deployed voice hands-free fix + 3 UX gaps (`D-0640/41`), fixed a
WCAG regression (`D-0646`), gave `#/knowledge` and `#/memory` a real identity (`D-0647`),
shipped direct agent-creation from chat (`D-0648`), decomposed `§4#10` multimodality into
three phases (`D-0649`), closed the audio item (`D-0650`), and closed the images item
(`D-0651`) — both `§4#10` gaps D-0649 found are now built. Six deploys this session, all
verified live.

## ➜ LA PROSSIMA AZIONE

One item remains from `D-0645`/`D-0649`:

**Kokoro TTS → GPU move** — infrastructure on `noesar-voice-speak`, a
non-`noesar-evolution` container. Stopped here twice already on stale premises (Kokoro
turned out to already be running; a "24px" symptom turned out to be CSS, not TTS). Needs
an explicit, separate technical confirmation before touching a running container — not
covered by a general "vai avanti".

## WHAT IS TRUE NOW THAT WAS NOT

See `docs/DECISION_LOG.md` `D-0640` through `D-0651` for the full session — eight
decision entries, six deploys, all with before/after evidence. `docs/INSTALLATION_
LEDGER.md` tail carries the same six deploys with byte-equal/health/test evidence per
entry, most recently `d0651-image-caption-…`.

**`D-0650`:** `file-extractors.mjs`'s media branch calls the same `transcribe()`
(`voice-engine.mjs`) the live microphone route uses. `NOESAR_VOICE_TRANSCRIBE_ENDPOINT`
is already set on this installation, so the capability is live immediately.

**`D-0651`:** `file-extractors.mjs`'s image branch now falls back to a vision-model
caption (`vision-caption.mjs`) when OCR finds no text. New concept: `visionCapable` on a
provider profile (Settings → Providers checkbox), declared by the operator, never probed
— no provider style here reports "I understand images". Only `openai-chat` and
`anthropic-messages` are supported; `openai-responses`' own multipart shape has never
been exercised by this product and is refused rather than guessed. **Dormant on this
installation** — no provider is yet marked `visionCapable` here; that is the Owner's own
action, not a build gap.

## WHAT WAS **NOT** DONE

- Kokoro→GPU — scoped, not built (see above).
- **No push** — `git push origin main` still fails, no GitHub credential in this
  container (`B-013`, unchanged all session). Commits are complete and correct locally.

## LOCAL, UNTRACKED, BY DESIGN

- `EVIDENCE/docker_{ps,network,volume}_post_cleanup_*.txt` — the §5a cleanup inventories
  from the `D-0650`/`D-0651` deploys. Not staged, not committed: they list every container
  on this host, other projects included — the same reason `EVIDENCE/docker_inventory_*.txt`
  is gitignored (`.gitignore` line 135). Their content is already summarised, host-detail
  stripped, in each deploy's `docs/INSTALLATION_LEDGER.md` entry. Safe to leave or delete;
  never to commit.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; every
  diff this session was reviewed with a heuristic grep, clean, declared as heuristic.
- `B-011` low/deferred (`D-0258`): git history rewritten on Owner's explicit authorisation.
- `B-013` **still open**: `git push origin main` refused, no GitHub credential stored in
  this container. Commits keep queuing locally, correct and complete.
- No other new blocker.
