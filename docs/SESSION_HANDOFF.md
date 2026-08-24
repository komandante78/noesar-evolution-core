# SESSION HANDOFF

**The Owner set a deadline and named two shames.** 2026-08-24: *"devi fare in modo che il
progetto sia finito entro 11 giorni … la cosa che è veramente vergognosa è la voce e la chat"*.
Deadline **2026-09-04**, one day after NLnet's calls reopen. The plan is
`docs/PLAN_11_DAYS_TO_DELIVERY.md` — read it first; it carries the live measurements and the
three-block schedule. **P1, P2 and P4 are done and deployed, plus the extraction the Owner authorised (`D-0677`).**

## ➜ LA PROSSIMA AZIONE

**P5 — voice latency. But time the turn before optimising any part of it.**

`docs/PLAN_11_DAYS_TO_DELIVERY.md` §4 Block 2. The plan asserts the
`/api/v1/voice/interpret` round-trip is a costly gate in the middle of a spoken turn. **That has
not been timed.** P4 is the reason this warning is here: its own stated premise turned out to be
mostly false when finally measured with the right instrument. Time STT, the interpret round-trip,
the chat generation and TTS separately, then optimise what the numbers name — not what the plan
text says.

**P6 is smaller than the plan claims** and the plan row now says so: `voice-session.js` **already**
re-arms on every path (`after-reply`, `after-command`, `after-not-understood`) when `continuous`
is set. What may be missing is reach — whether the setting is exposed, defaulted and explained,
and whether an explicit end exists. Re-measure before building.

**`B-016` is still the Owner's to clear, and still blocks P3 only.** The configured model cannot
emit tool calls: a healthy `llama.cpp` server accepts the `tools` array and answers in prose,
because it honours them only with `--jinja`. **That container belongs to a separate project and is
out of bounds from here** (`CLAUDE10.md` §5 rules 16-21, REGOLA ZERO). P3 (wiring the CodeN
commands in as tools) cannot be *demonstrated* until it clears, which is why P4 was taken first.

## WHAT IS TRUE NOW THAT WAS NOT

**`D-0672` — the chat knows what it is.** The whole system message used to be
`instructionForMode()`: three sentences. It is now composed from live state by
`ai-workspace/assistant-identity.mjs` — product, which model answers and whether it runs locally,
voice in all four states, workspace counts, enabled tools by name or an honest "none" — plus an
answering register. The citation instruction is conditional on evidence actually retrieved.
**A/B against the live phi-4** (`EVIDENCE/chat_identity_ab_20260824T041426Z.txt`): asked *"chi
sei?"* the old prompt answered **"Sono un modello di linguaggio sviluppato da Microsoft"**; asked
*"PERCHE NON FUNZIONI?"* it answered **in English** with a tutorial about checking the power
supply. The new one names the product and the real model, in Italian.

**`D-0674` — the chat can call tools.** `tool-call-stream.mjs` reassembles a fragmented call for
all three apiStyles; `parseSse()` emits it on a final frame; `ChatOrchestrator` runs a bounded
4-round call→execute→feed-back loop through `ToolExecutor`, streaming `tool-call`/`tool-result`
the WebUI renders as live rows. Refusals are by design: out-of-scope names refused **by name**,
malformed arguments never coerced to `{}`, tool results fenced and a detection closes the
agent-directive channel, a failing tool is a result not a failed turn.

**Two scope defects found while building it, either of which alone made the loop unreachable:**
`enforceToolScope` intersects granted with *requested*, and `sendChat()` has never sent `toolIds`
— **every chat turn this product ever served offered zero tools**. And `project.toolIds` is
written `[]` at creation with **no writer anywhere in the repository**, yet was read as a
deny-list, so attaching a conversation to a project disabled every tool permanently. Both fixed,
both pinned by tests.

**`D-0675` — reachable is not capable.** `probeToolCalling()` on the existing health route, which
the WebUI already renders verbatim. It is what measured `B-016`, and it names `--jinja` as the
remedy rather than reporting a bare failure.

**`D-0676` — the voice says what it did, and keeps both halves of a compound request.** It used
to perform a command and **stay silent**: `applyHeardText()` returned `reply:''`, which
`VoiceSession` treats as nothing to say, so the acknowledgement existed only as a *visual* note —
useless to the person hands-free voice is for. New `resolveCompound()` makes *"apri la memoria e
dimmi cosa c'è dentro"* navigate **and** answer in one spoken turn; it runs only where the
resolver already answered `NOTHING`, so nothing that works today can change. The destination is
spoken by its translated label ("Vado a Memoria"), not its slug.

**My own premise was wrong, and the correction is the most useful thing in this handoff.** `PLAN`
§3 said command-first routing hijacks natural speech. Measured against the real 42-entry list with
the real Italian translation: **pure navigation resolves correctly**, and all 9 of 20 utterances
that routed to a command had asked to navigate. An earlier reading said 1/20 — wrong, because the
probe passed `translateString` raw and it returns `{text, translated}`, so every handle was built
from an object and matched nothing. **The instrument was the defect, not the product.** The plan
now carries that correction in place.

**`D-0677` — the improvement proposal, executed on authorisation.** `packages/spoken-intent/`:
SPEC `SI-001`…`SI-008`, a reference implementation, 60 conformance vectors, and — the part that
makes it a contract rather than a description — the **shipped** browser resolver held to the same
suite, plus a test that drives both implementations over the same utterances and fails on any
disagreement. Writing that second binding found **two real defects in my own specification**: an
unwritten handle-expansion rule (the utterance is filler-stripped before matching, so a label with
a preposition in it could never match), and a filler set the shipped resolver had hardcoded so the
language it assumed was unoverridable. Live: the bytes the installation serves pass **60/60**.

**A hang found and fixed, worth keeping.** `assistant-identity.test.mjs` stopped terminating: an
unguarded `inspection.tools` threw, the rejection skipped the fixture's own `server.close()`, and
a live listener kept the process alive — so the **full suite reported a hang with zero failures**
rather than a failure. Fixed at both ends: the guard, and `after()`-based server cleanup in all
three new suites so a future failing assertion can never do it again.

## WHAT WAS **NOT** DONE

- **P3 and P5-P9** — not started. P3 is deliberately deferred behind `B-016` (see above).
- **The voice was never heard by me.** `D-0676` is proven by suite and by executing the resolver
  against the **bytes the live installation serves** — not by speaking into a microphone. What is
  `[UNVERIFIED]`: how the acknowledgement actually *sounds* through Kokoro, and whether the
  compound turn feels like one utterance or two when spoken. The Owner is the only one who can
  say that, and it is worth asking them to try it.
- **P4 did not do what `PLAN` §3 originally said**, because that premise was measured and found
  mostly wrong; the plan now carries the correction in place rather than an edited-away claim.
- **`llama.cpp` was not restarted with `--jinja`.** Forbidden from here — another project's
  container. This is the Owner's action, and it is the whole of `B-016`.
- **The model itself** remains the ceiling on felt quality. P1-P3 make the assistant grounded,
  capable and honest on whatever model runs; they do not make a 14B q4 build reason like a
  frontier model.
- **No browser e2e was run this phase.** The new UI element is created at runtime, so the static
  audit cannot see it; `webui-markup-structure.test.mjs` (52/52) covers the tokens and structure,
  and it caught two real defects here — an undefined `--font-mono` and a **UI-043 violation**
  where my `announceEvent` in the streaming branch would have read the answer aloud twice.
  Declared rather than implied: the rendered rows have **not** been seen in a browser.
- **FUNDING Phases F and G** — cannot be produced from inside this repository at any speed.
- `F-RUST-002`, `F-ROT-001`, `F-MODEL-001`, `F4-012`, `F4-013`, `F7-001`, `F-CAP4-001`,
  `F-I18N-002`, `F-HOOK-008` — unchanged, previously triaged; `F-ROT-001`/`F-MODEL-001` are P7.
- **`NOESAR_DEBUG_EVOLUTION_TOKEN` rotation** — still not done; it authenticates this project to
  an external one, so rotating it here alone breaks that integration (`D-0666`).

## LOCAL, UNTRACKED, BY DESIGN

- `EVIDENCE/docker_inventory_pre_cleanup_*.txt` — the §5a inventories; they list every container
  on this host, other projects included, which is why the pattern is gitignored.
- `BACKUPS/pre_history_rewrite_20260823T134411Z.bundle` — pre-rewrite recovery point, rule 23.

## OPEN BLOCKERS

- `B-016` **OPEN, needs the Owner** — the configured model cannot emit tool calls. See above.
- `B-015` **OPEN** — `git push origin main` fails, no credential helper here. Everything is
  complete locally and **deployed live**, but not on `origin`. Same shape as `B-014`, which the
  Owner closed by supplying a PAT ad-hoc.
- `B-002` **STALE** (`D-0257`) — neither `gitleaks` nor `trufflehog` on `PATH`; this session's
  diffs were reviewed with a heuristic grep, clean, **declared as heuristic**.
- `B-011`, `B-013`, `B-014` closed previously.
