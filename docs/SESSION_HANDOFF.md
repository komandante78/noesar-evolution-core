# SESSION HANDOFF

**The Owner set a deadline and named two shames.** 2026-08-24: *"devi fare in modo che il
progetto sia finito entro 11 giorni … la cosa che è veramente vergognosa è la voce e la chat"*.
The deadline is **2026-09-04**, one day after NLnet's calls reopen (2026-09-03). The plan is
`docs/PLAN_11_DAYS_TO_DELIVERY.md` — read it before anything else; it carries the live
measurements this session took and the three-block schedule.

## ➜ LA PROSSIMA AZIONE

**P2 — the tool-call loop.** `docs/PLAN_11_DAYS_TO_DELIVERY.md` §4, Block 1.

Measured this session, not inferred: **the chat cannot act, at two layers.**
`provider-gateway.mjs:156` extracts only `choices[0].delta.content` and **discards
`delta.tool_calls`** — the channel never reaches the orchestrator. `streamToResponse()` builds a
`tools` array, sends it, accumulates text and stops: it never parses a call, never executes one,
never feeds a result back. `ToolExecutor` has exactly two callers (`workflow-service.mjs`,
`agent-service.mjs`) and **neither is the chat**. So tools are advertised to the model and are
unreachable.

**First thing to measure when P2 opens:** whether `parseSse()` can surface `tool_calls` for all
three `apiStyle`s (`openai-chat`, `openai-responses`, `anthropic-messages`) without breaking the
`{delta, usage}` contract 3117 tests currently depend on.

P1 makes this the *felt* limitation: the assistant now correctly offers the three Debug Evolution
tools by name — and cannot call any of them.

## WHAT IS TRUE NOW THAT WAS NOT

**`D-0672` — the chat knows what it is.** The whole system message used to be
`instructionForMode()`: three sentences about ASK/CREATE/ACT and nothing else. It is now composed
from live state by `ai-workspace/assistant-identity.mjs` — product, which model is answering and
whether it runs locally, whether voice is configured (all four states, including the two
half-configured ones), workspace counts, enabled tools by name or an honest statement that there
are none — plus an answering register. The citation instruction is now **conditional on evidence
actually being retrieved**; it used to be emitted on every turn, including every turn of an
installation with zero sources, which is this one.

**Measured A/B against the live phi-4** (`EVIDENCE/chat_identity_ab_20260824T041426Z.txt`): asked
*"chi sei?"*, the old prompt answered **"Sono un modello di linguaggio sviluppato da Microsoft"*.
Asked *"PERCHE NON FUNZIONI?"*, it answered **in English** with a generic tutorial about checking
the power supply and cables. The new prompt names the product and the real model, and answers in
Italian about this installation.

**Two live defects found by looking at the running system, not by review** — recorded because the
method is the lesson. Composing the prompt **inside the running container against the real
provider record** showed *"served by via Local OpenAI-compatible, running on an external
service"*: the snapshot read `profile.model` and `profile.kind` while the record carries
`defaultModel` and `external`, so the model was nameless and its locality backwards. **A
hand-written fixture would have carried the same wrong field names and agreed with the bug** — so
the regression test now builds its profile with the real `ProviderGateway`, and
`installationFromState()` was extracted as a pure exported function precisely so it could be
pinned that way. Second: `#buildContext` read `inspection.sources.length` unguarded and took a
whole turn down on a partial inspection, caught by CE-007's own containment fixture. Grounding is
decoration on the answer and must never be able to remove the answer.

**`D-0673`** — the surviving rollback is `…-pre-20260824T053620Z` (`d0671`), the last *published*
predecessor, not the literally-newer one that carried the defective intra-phase `d0672` build.

## WHAT WAS **NOT** DONE

- **P2 through P9 of the plan** — not started. That is the schedule, not a slip.
- **The voice was not touched this session.** Its diagnosis is complete and written up
  (`PLAN` §3): the turn machine is sound and is *not* static, but `applyHeardText()` (`app.js:3511`)
  resolves the **raw utterance against the menu first**, so natural speech containing a
  destination word navigates and answers nothing. Fixing it is P4, and it depends on P2 —
  "open the memory and tell me what is in it" needs a tool loop to be one answer instead of two.
- **The model itself is unchanged** and is the ceiling on felt quality: a 14B q4 local build.
  P1-P3 make the assistant grounded, capable and honest on *whatever* model runs; they do not
  make it reason like a frontier model. Named in `PLAN` §5 as the Owner's lever, not a defect.
- **FUNDING Phases F and G** — cannot be produced from inside this repository at any speed
  (G is an external pentest by definition; F needs host classes that are not this machine).
- `F-RUST-002`, `F-ROT-001`, `F-MODEL-001`, `F4-012`, `F4-013`, `F7-001`, `F-CAP4-001`,
  `F-I18N-002`, `F-HOOK-008` — unchanged, all previously triaged. `F-ROT-001` and `F-MODEL-001`
  are scheduled for P7.
- **`NOESAR_DEBUG_EVOLUTION_TOKEN` rotation** — still not done; it authenticates this project to
  the external `DEBUG_EVOLUTION` project, so rotating it here alone breaks that integration
  without Owner coordination on the other side (`D-0666`).

## LOCAL, UNTRACKED, BY DESIGN

- `EVIDENCE/docker_inventory_pre_cleanup_*.txt` — the §5a inventory; lists every container on
  this host, other projects included, which is why the pattern is gitignored. Its content is
  summarised, host-detail stripped, in the ledger entry.
- `BACKUPS/pre_history_rewrite_20260823T134411Z.bundle` — pre-rewrite recovery point, kept per
  rule 23.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; this session's
  diff was reviewed with a heuristic grep, clean, **declared as heuristic**.
- No other open blocker. `B-011`, `B-013`, `B-014` all closed previously.
