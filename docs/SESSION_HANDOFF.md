# SESSION HANDOFF

**Consolidated deploy done and verified live.** The commits that were queued (§3#6 voice
hands-free root-cause fix, §4#1/#2/#3 UX gaps) are now running in production, T2 is clean,
and a real WCAG regression T2 found in the new UI was fixed in the same phase before close.

## ➜ LA PROSSIMA AZIONE

**Owner still owes one thing**: a one-line definition of what `#/knowledge` and `#/memory`
should do/say (`§4#6/#7`) — Owner chose to write it directly rather than have a direction
proposed.

**Four product decisions were made this session (`D-0645`), none built yet — each is its own
future phase, one at a time (rule 9):**
1. TTS: move the already-running Kokoro-82M container (`noesar-voice-speak`) to the idle
   RTX 3060 GPU — infrastructure action, outside this project's own container authority
   (`CLAUDE10.md` rule 16), needs its own explicit scoping.
2. `§4#9` — chat/CodeN: natural-language agent creation should create directly, no
   confirmation step.
3. `§4#10` — multimodality priority order: documents/files, images, audio.
4. `§4#6/#7` — knowledge/memory page identity: waiting on the Owner's one-liner above.

**Pick one of the four (or the knowledge/memory answer) to open the next phase.**

## WHAT IS TRUE NOW THAT WAS NOT

**Deployed and verified (`d0640-voice-hunt-and-ux-20260822T131226Z`).** Byte-equal
tree↔image both builds (476/476). Live: `running`/`healthy`, `/livez` `/readyz` `/healthz`
200, 4 children, 0 auth-failures. Full detail: `docs/INSTALLATION_LEDGER.md` tail.

**T2 run twice, clean.** Browser e2e **511 · 510 pass · 1 fail** (pre-declared `F-I18N-002`
only) — stable across both builds. Accessibility **26/27 → 27/27** after the fix below.
Unit **2976/2977** (1 pre-existing skip), ESLint **474/0/0**, seeded-defect **19/19**.

**HUNT AND FIX found and repaired a real defect (`D-0646`):** T2's own accessibility audit
caught `#modelShowAll` (this phase's own §4#1 toggle) at 13×13 CSS px, under the WCAG 2.2
SC 2.5.8 24×24 minimum — same class of defect already fixed once for `.check` inputs, missed
here because the new control used a different label class. Fixed with one CSS selector,
rebuilt, redeployed, reverified 27/27.

**Environment/hygiene, this session:**
- Container litter from the interrupted prior session cleaned up: an orphaned older rollback
  (`…-pre-20260821T082532Z`) removed; exactly two survivors confirmed throughout.
- `.claude/settings.local.json` (personal permission mode) added to `.gitignore` — it was
  never meant to be tracked and was tripping the close-guard's diff check.
- `git config --global --add safe.directory` applied (container ownership mismatch,
  environment-level, not a project config change) — required for any git command to run.
- Owner set `permissions.defaultMode: bypassPermissions` for this operator's own sessions
  (local, gitignored file) — CLAUDE10.md's `deny` list and `destructive-command-guard.sh`
  stay active regardless of permission mode.

**Improvement proposal, `D-0646`'s closing note:** a stylelint rule enforcing 24×24 minimum
target size on new checkbox/radio controls, to catch this class of defect at commit time.
**Funding fit: none** — internal tooling, not reusable beyond this codebase.

## WHAT WAS **NOT** DONE

- The four `D-0645` decisions (TTS→GPU, direct NL agent creation, multimodality, knowledge/
  memory identity) — scoped and recorded, not built. Each needs its own phase contract.
- Knowledge/memory one-liner — still owed by the Owner, not yet supplied.
- **No push** — `git push origin main` still fails, no GitHub credential in this container
  (`B-013`, unchanged). Commits are complete and correct locally; only the push is blocked.
- No new browser-e2e case added for the WCAG fix specifically — the accessibility audit's
  existing 2.5.8 check already proves the property directly; a dedicated regression case
  would duplicate it for a one-line CSS fix.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; this session's
  diff review was a heuristic grep, clean, declared as heuristic.
- `B-011` low/deferred (`D-0258`): git history rewritten on Owner's explicit authorisation.
- `B-013` **still open**: `git push origin main` refused, no GitHub credential stored in this
  container. Commits keep queuing locally, correct and complete.
- No other new blocker.
