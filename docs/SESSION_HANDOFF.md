# SESSION HANDOFF

**Session continues:** deployed voice hands-free fix + 3 UX gaps (`D-0640/41`), fixed a
WCAG regression (`D-0646`), gave `#/knowledge` and `#/memory` a real identity (`D-0647`),
shipped direct agent-creation from chat (`D-0648`), decomposed `§4#10` multimodality into
three phases (`D-0649`), closed the audio item (`D-0650`), and closed the images item
(`D-0651`) — both `§4#10` gaps D-0649 found are now built. Six deploys this session, all
verified live. Reclassified Kokoro→GPU out of scope (`D-0652`). Built and tested
`packages/capability-token/` — Phase D of the funding work plan (`D-0653`). Built the
authority-conformance fixture and closed Phase E's JS half (`D-0654`).

## ➜ LA PROSSIMA AZIONE

No deploy-blocking item is open. Two independent threads are both at a clean stop:

**Product/§4#10:** closed — see `D-0645`/`D-0649`/`D-0650`/`D-0651`/`D-0652`.

**Funding (`FUNDING/19_WORK_PLAN_TO_BETA.md`):** Phase D done (`D-0653`,
`packages/capability-token/`, 32/32 JS + 17/17 Python conformance, byte-identical against the
live `TokenMinter`). Phase E's JS half done (`D-0654`): Proof-of-Session was already
`RECORDED_MET` (`SESS-001/002/003`), and the genuinely missing authority-conformance suite now
proves the real `TokenMinter` contains an adversarial, never-filtering `ReasoningProvider` — 5/5
cases. **Not built**: the same proof for the Rust authority daemon (named open in `D-0654`).
Remaining: Phase F (cross-platform evidence on ≥2 real host classes) and Phase G (independent
pentest — external party only, cannot be scheduled by this project alone). Neither is due before
the NLnet deadline (3 Nov 2026) — they are the funded work itself, not a submission
prerequisite. The actual next action for the deadline is writing the CodeSupply
abstract/milestones/budget (`D-0631`, not started) once the application form publishes
(~3 Sep 2026).

No further action on Kokoro→GPU unless the Owner amends `CLAUDE10.md` with a named exception.

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

**`D-0653`:** `packages/capability-token/` specifies and ships the capability token's wire
format only (`SPEC.md` `CT-001`–`CT-007`) — canonical encoding, MAC pre-image, canonical
limits string, constant-time verify — explicitly excluding the minting/authorization
policy, which stays in `rust/crates/noesar-capability`/`capability.mjs`. Every `mac`
conformance vector was minted live by the real `TokenMinter` this session; the package's
`sign()` reproduces it byte-for-byte (proven, `services/reference-control-plane/test/
capability-token-package-extraction.test.mjs`). A from-spec Python implementation passes
17/17 vectors in a disposable container. **Neither production minter imports this package
yet** — named as an open decision in the package's own `README.md`, not done silently.

**`D-0654`:** `src/fixtures/adversarial-reasoning-provider.mjs` is a second, real
`ReasoningProvider` implementation — identical to the reference one except `constrain()` never
refuses. `test/reasoning-authority-conformance.test.mjs` drives it through the REAL
`TokenMinter.mint()`/`authorizePlan()` (nothing mocked) and proves workspace-escape and
step-membership containment hold regardless of whether the backend's own filtering ran. One
case found genuinely red first during authoring (a test bug, not a product bug), fixed,
re-verified.

## WHAT WAS **NOT** DONE

- Kokoro→GPU — out of scope (`D-0652`), not built.
- Production Rust/JS minters were **not** rewired to import `packages/capability-token/`
  — real architecture change to security-critical code, deliberately left as an open
  decision rather than taken inside this phase (`D-0653`).
- The Rust-side equivalent of `D-0654`'s authority-conformance proof — not built, named
  open in `D-0654`. The JS half is proven; the Rust authority daemon is not, yet.
- FUNDING Phases F/G — not started, and not due before the deadline (see above).
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
