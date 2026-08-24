# SESSION HANDOFF

**The Owner set a deadline and named two shames.** 2026-08-24: *"devi fare in modo che il
progetto sia finito entro 11 giorni … la cosa che è veramente vergognosa è la voce e la chat"*.
Deadline **2026-09-04**, one day after NLnet's calls reopen. The plan is
`docs/PLAN_11_DAYS_TO_DELIVERY.md` — read it first; it carries the live measurements and the
three-block schedule. **P1, P2 and P4 are done and deployed, plus the extraction the Owner authorised (`D-0677`).**

## ➜ LA PROSSIMA AZIONE

**P5 proper: sentence-level streamed synthesis. It is the 6.7×, and it is now measured.**

Timed on the live installation this session — the first time the spoken turn was ever timed:

| stage | ms |
|---|---|
| `/api/v1/voice/interpret` round-trip | **204** |
| chat, first token | **66** |
| chat, COMPLETE answer (562 chars) | **4790** |
| TTS | ~800 |
| **silence before one word is heard** | **~5794** |
| **if synthesis began at the first sentence** | **~866** |

**Deliberately not started.** It changes `VoiceSession`'s generation and barge-in semantics, and
getting that wrong brings back `D-0373` — two voices talking over each other. That needs a fresh
session, not the tail of a long one. **Design constraint to carry in:** the `converse` adapter
returns a whole `{reply}` string today; streaming means yielding sentences, and every leg must
stay cancellable by the SAME generation token barge-in already uses.

**Two of my own premises died to measurement this session. Do not skip the measuring step.**
`PLAN` §3 blamed the `interpret` round-trip: it is **204 ms**. And I suspected the Kokoro voice
was wrong — a synthesize-then-transcribe round trip scored **WER 0.0%** with the Italian voice
against **81.8%** for a deliberately-wrong English-voice control. **The TTS is not the defect**,
and I nearly repaired a healthy component.

**`B-016` unchanged, still needs the Owner** (`llama.cpp` needs `--jinja`; another project's
container). Blocks P3 only.


## WHAT IS TRUE NOW THAT WAS NOT

**`D-0679` — a spoken answer is asked for as speech.** `spoken:true` travels from the browser to
the system prompt; the model is asked for two or three sentences, no markdown, no paths. And
because a prompt is a request rather than a guarantee — the q4 build read
`/models/phi-4-q4_k_m.gguf` aloud despite being told not to — the model name is made speakable
**deterministically**: `phi-4` spoken, exact string written. A/B on the live model: 441 → 289
characters. **Partial, and stated as partial:** ~20 seconds of speech remain, and the real fix is
the streaming above.

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

**`D-0672`, `D-0674`, `D-0675`, `D-0677` — the chat given an identity and a real tool-call loop, the
tool-calling capability probe, and `@noesar/spoken-intent` extracted with its conformance suite.
Full detail in `docs/DECISION_LOG.md`, unchanged since; not repeated here to stay inside the cap.
The two findings worth carrying: **every chat turn this product ever served offered the model zero
tools** (two independent scope defects, both fixed), and **the configured model cannot emit tool
calls at all** (`B-016`, the Owner's to clear).

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
