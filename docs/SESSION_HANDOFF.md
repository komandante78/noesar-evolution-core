# SESSION HANDOFF

**The Owner set a deadline and named two shames.** 2026-08-24: *"devi fare in modo che il
progetto sia finito entro 11 giorni … la cosa che è veramente vergognosa è la voce e la chat"*.
Deadline **2026-09-04**, one day after NLnet's calls reopen. The plan is
`docs/PLAN_11_DAYS_TO_DELIVERY.md` — read it first; it carries the live measurements and the
three-block schedule. **P1, P2 and P4 are done and deployed, plus the extraction the Owner authorised (`D-0677`).**

## ➜ LA PROSSIMA AZIONE

**Ask the Owner to listen again, before opening P5.**

They reported the deployed voice as *«fa schifo … parla a caso senza chiedere nulla»*. The second
half was a real, measured defect and is fixed (`D-0678`, below). The first half — *"fa schifo"* —
may be about the **sound**: the Kokoro voice, its prosody, the delay before it answers. Those are
different repairs, and guessing between them already cost a phase once — P4 was built on a premise
that measurement destroyed.

- If the complaint is **the sound**: that is P5 (latency, sentence-level streamed synthesis) plus
  the voice choice in `NOESAR_VOICE_RUNE` / `NOESAR_VOICE_ESTRELA`.
- If it is **still talking at random**: the residue is pinned in `voice-not-addressed.test.mjs`
  as exactly `["dove sei", "quanto costa"]`, and the honest remedy is a **wake word** — proposed
  in `D-0678` and deliberately not built inside a repair phase.

**`B-016` unchanged, still needs the Owner**: the configured model cannot emit tool calls
(`llama.cpp` honours them only with `--jinja`, and that container belongs to a separate
project). It blocks P3 only.


## WHAT IS TRUE NOW THAT WAS NOT

**`D-0678` — the voice stopped reacting to the room, and this was the Owner's own catch.**
Measured before changing anything: **10 of 45 realistic transcription fragments performed a real
action**. `"no"` ran `/sweep`. `"ok"` ran `/revoke`. `"senti"` ran `/model`. Saying "no" to
another person in the room swept the workspace. Every misfire matched at `WORD` (5) or
`SUBSTRING` (6) — the ranks meaning *the phrase is PART of something* — while every legitimate
phrase resolved at `NAME`, `SEGMENT` or `PROSE`. Two gates: speech acts only on an exact match
(`actFloor`), and anything neither exact nor request-shaped ends the turn **in silence**
(`addressedToProduct`). Live, against the served bytes: **15 of 15 noise fragments silent**, all
real phrases intact.

**This defect predates `D-0676` — my change is what made it audible.** The same fragments already
navigated; they did it silently, so the page jumped and nothing said why. Making a performed
command speak is what let the Owner finally hear a fault that had been shipping all along. The
microphone was **not** turned off, though that was the easy fix: `continuous` is the Owner's own
standing instruction (*«resti attiva finché non la fermo io»*), never withdrawn.

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
- **The voice still has not been heard by me, and the Owner says it sounds bad.** `D-0678` is
  verified against the bytes the installation serves, not through a speaker. *"fa schifo"* is
  `[UNVERIFIED]` and unactioned: it may be the Kokoro voice, the prosody or the latency, and
  those are different repairs. See LA PROSSIMA AZIONE.
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
