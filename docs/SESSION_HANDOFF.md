# SESSION HANDOFF

**The Owner set a deadline and named two shames.** 2026-08-24: *"devi fare in modo che il
progetto sia finito entro 11 giorni … la cosa che è veramente vergognosa è la voce e la chat"*.
Deadline **2026-09-04**, one day after NLnet's calls reopen. The plan is
`docs/PLAN_11_DAYS_TO_DELIVERY.md` — read it first; it carries the live measurements and the
three-block schedule. **P1 and P2 are done and deployed.**

## ➜ LA PROSSIMA AZIONE

**Put `B-016` to the Owner, then start P4 — not P3.**

`B-016`, measured live twice: **the configured model cannot emit tool calls.** A healthy
`llama.cpp` server accepts the `tools` array and answers in prose. It honours tools only when
started with `--jinja`. **That container belongs to a separate project and is out of bounds from
here** (`CLAUDE10.md` §5 rules 16-21, REGOLA ZERO) — the Owner restarts it, or points a provider
profile at a tool-capable endpoint. The loop is proven by suite (14/14 end to end) and the
limitation is declared in the product itself, not hidden.

**Why P4 and not P3:** P3 (wiring the CodeN commands in as tools) cannot be *demonstrated*
end-to-end until a tool-capable model is reachable, so building it now means building blind.
**P4 (voice conversation-first routing) depends on the loop EXISTING, not on it being drivable on
this host today**, so it is not blocked. Do P4, and take P3 the moment `B-016` clears.

**P4, first thing to measure:** `applyHeardText()` (`app.js:3511`) runs `heardResult(text)` on the
**raw utterance first**, so any sentence containing a destination word navigates and returns
`reply:''` — silence. Natural speech must reach the conversation; acting belongs inside the answer
now that P2 exists.

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

**A hang found and fixed, worth keeping.** `assistant-identity.test.mjs` stopped terminating: an
unguarded `inspection.tools` threw, the rejection skipped the fixture's own `server.close()`, and
a live listener kept the process alive — so the **full suite reported a hang with zero failures**
rather than a failure. Fixed at both ends: the guard, and `after()`-based server cleanup in all
three new suites so a future failing assertion can never do it again.

## WHAT WAS **NOT** DONE

- **P3 and P5-P9** — not started. P3 is deliberately deferred behind `B-016` (see above).
- **The voice is still untouched.** Diagnosis complete in `PLAN` §3; P4 is next.
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
