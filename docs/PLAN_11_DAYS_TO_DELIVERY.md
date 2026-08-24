# Work plan — 11 days to delivery (2026-08-24 → 2026-09-04)

Owner instruction, 2026-08-24: *"devi fare in modo che il progetto sia finito entro 11 giorni,
poi la cosa che è veramente vergognosa è la voce e la chat, la voce deve fare quello che chiedo
in modo naturale stile jarvis … poi la chat non risponde come una vera chat tipo claude o chat
gpt"*.

The deadline is not arbitrary: **NLnet's calls reopen 2026-09-03**
(`.claude/skills/noesar-evolution-funding-fit/SKILL.md` §0a). Day 11 is the day after.

---

## 1 — What was measured LIVE on 2026-08-24, not inferred

Every row below was produced this session against the **running installation**
(`noesar-evolution:d0671-toolbar-border-20260823T160319Z`, up 12h, healthy) or against the
tree. Nothing here is quoted from a previous session's record.

| # | Fact | Status |
|---|---|---|
| L1 | `https://192.168.178.100:8443` answers `200`; container healthy; ports 8089/8443/8100 mapped | `VERIFIED` |
| L2 | STT `noesar-voice-hear` (speaches, CUDA) and TTS `noesar-voice-speak` (kokoro) are **up 43h** and reachable **from inside** the product (`/health` → 200, `/v1/models` → 200 via `node fetch`) | `VERIFIED` |
| L3 | The product container has **no `curl` and no `wget`** — an earlier "ERR" reading was the missing binary, not a network fault. Recorded so it is not re-discovered. | `VERIFIED` |
| L4 | Local model runtime **is alive**: `http://172.22.0.4:8420/v1/models` → `phi-4-q4_k_m.gguf` | `VERIFIED` |
| L5 | 4 provider profiles enabled; default = the local phi-4. OpenAI/Anthropic/Kimi are profiles **without keys** | `VERIFIED` |
| L6 | Live workspace: 1 conversation, 50 messages, **3 tools** (all external Debug-Evolution), **0 memories, 0 sources**, 1 agent | `VERIFIED` |
| L7 | The chat **does** stream properly (SSE `run`/`delta`/`complete`, reader loop in `app.js:1266`) | `VERIFIED` |
| L8 | Voice **is** wired end-to-end and is **not** static: `app.js:4138` `converse → applyHeardText`, which falls through to `sendChat()` and speaks the answer, with barge-in and abort | `VERIFIED` |

## 2 — Why the chat "does not answer like a real chat" — three root causes, measured

**C1 · The assistant has no identity and no grounding.** The entire system message is
`instructionForMode()` (`chat-orchestrator.mjs:6-10`): three sentences about `ASK`/`CREATE`/`ACT`.
Nothing tells the model **what product it is inside**, what the installation can do, what is
configured, or who it is talking to. Live proof, from the real message log: the Owner asked
*"PERCHE NON FUNZIONI?"* and got a generic tutorial on software-debugging methodology — the
answer of a model that does not know it is anything. `VERIFIED`

**C2 · The chat cannot act. There is no tool-call loop, at two layers.**
- `provider-gateway.mjs:156` extracts **only** `choices[0].delta.content`. A `delta.tool_calls`
  frame is **discarded** — the channel never reaches the orchestrator.
- `ChatOrchestrator.streamToResponse()` builds a `tools` array and sends it, then accumulates
  text and stops. It never parses a call, never executes one, never feeds a result back.
  `ToolExecutor` has exactly two callers and **neither is the chat** (`workflow-service.mjs`,
  `agent-service.mjs`).

So tools are advertised to the model and are unreachable. This is the single largest difference
from Claude/ChatGPT, and it is structural, not cosmetic. `VERIFIED`

**C3 · The model is a 14B q4 local build.** Real, offline, correct for this project's posture —
and the ceiling on how "smart" any prompt can make the answer feel. This is the Owner's choice to
make, not a defect to fix. `VERIFIED`

## 3 — Why the voice is not Jarvis — and what is already right

**Already right, and worth not breaking:** the turn machine (`voice-session.js`, 328 lines) has
states, abort on every leg, barge-in detected locally, and the product-side engine
(`voice-engine.mjs`, 468 lines) so audio never leaves the installation. `D-0373` already removed
dictation-into-a-box. This is not a placeholder.

**V1 · ~~Command-first routing hijacks natural speech.~~ CORRECTED 2026-08-24 (`D-0676`) — this
was mostly wrong, and the correction is left visible rather than edited away.**

Driven against the real 42-entry list with the real Italian translation, **pure navigation
resolves correctly**: *"apri la memoria"*, *"fammi vedere i progetti"*, *"impostazioni"*,
*"modelli"* all navigate, which is what each one asked for. 9 of 20 sampled utterances route to a
command and **every one of them was a navigation request**. The resolver is exact-or-containing
with no fuzzy matching and it does its job. An earlier reading of this same question said 1/20 —
that number was wrong because the probe passed `translateString` raw, and it returns
`{text, translated}`, so every handle was built from an object and matched nothing. **The
instrument was the defect, not the product.**

What was really wrong, and is now fixed:
- **The product acted in silence.** A performed command returned `reply:''`, which
  `VoiceSession` (`voice-session.js:296`) treats as nothing to say. The acknowledgement existed
  only as a *visual* note — no use at all to the person hands-free voice exists for.
- **A compound request lost half of itself.** *"apri la memoria e dimmi cosa c'è dentro"*
  resolves to `NOTHING` (no handle matches the whole sentence), so the navigation was dropped and
  only the question survived.
- **The destination was spoken by its slug** — an Italian voice saying "Vado a memory".

`VERIFIED` — and the lesson is the one this project keeps relearning: measure with the real
instrument before believing a premise, including your own.

**V2 · A whole LLM round-trip sits in the middle of the turn.** When the deterministic resolver
misses, `/api/v1/voice/interpret` asks the model to *choose a menu entry* before the chat is even
reached — a serial extra generation on the same busy q4 model, in a chain that is already
STT → … → chat → TTS with no streamed synthesis. `VERIFIED`

**V3 · Voice inherits C1 and C2 exactly.** The spoken answer **is** the chat answer. A voice
cannot sound like Jarvis while the brain behind it does not know what it is and cannot do
anything. **The two complaints have one root cause and are fixed in one place.** `VERIFIED`

## 4 — The plan. Three blocks, eleven days.

Each phase is a full `noesar-evolution` cycle (contract → build → test → hunt → deploy → verify
live → clean → handoff), not a checkpoint.

### Block 1 — Give the chat a brain (days 1-3)

| Phase | What it makes true | Acceptance |
|---|---|---|
| **P1** | The assistant **knows what it is**: a composed system identity carrying product name, the installation's real capability inventory (models, voice, tools, projects), the current surface, and honest limits — built from live state, never hardcoded prose | a question about the product itself is answered from the installation's own state, not from the model's training; unit tests pin every field |
| **P2** | **The tool-call channel exists end to end**: gateway surfaces `tool_calls` deltas for all three API styles; the orchestrator runs a bounded multi-round call loop through `ToolExecutor`, streams each call and result as its own SSE event, and enforces the existing scope/consent gates | a chat turn that needs a tool calls it, shows the call, and answers from the result — measured, not asserted |
| **P3** | **Internal tools the chat can actually use**: the 17 CodeN engine commands and the workspace read surfaces become first-class tools, so the chat can inspect and act on the installation it lives in | the chat answers "what is broken here" by calling a real tool, not by describing methodology |

### Block 2 — Make the voice Jarvis (days 4-6)

| Phase | What it makes true | Acceptance |
|---|---|---|
| **P4** ✅ **DONE** (`D-0676`) | The voice **says what it did** instead of acting in silence; a compound *"apri la memoria e dimmi cosa c'è dentro"* both navigates and answers, as one spoken turn; the destination is named by its translated label | `voice-conversational.test.mjs` 12/12, all voice suites 84/84, and the resolver run **from the bytes the live installation serves** |
| **P5** | **The turn is fast enough to feel alive**: sentence-level streamed synthesis so speech begins before the answer is complete; the removed round-trip; measured end-to-end latency budget | `tools/acceptance/voice-latency.mjs` extended with a first-audio-out metric and a declared budget that the run meets |
| **P6** | ~~Continuous conversation~~ — **re-scoped 2026-08-24**: measured, `voice-session.js` **already** re-arms on every path (`after-reply`, `after-command`, `after-not-understood`) when `continuous` is set. What is left is not the mechanism but its **reach**: whether the setting is exposed, defaulted and explained, and whether an explicit end exists | do not build from this row — re-measure first and state what is actually missing |

### Block 3 — Close the product (days 7-11)

| Phase | What it makes true |
|---|---|
| **P7** | Closable open findings closed: `F-ROT-001` (stale allowed-host), `F-MODEL-001` (who serves the model), `F4-012`. `F-RUST-002` put to the Owner as the architecture question it is |
| **P8** | Full battery + live deploy of the whole block, §3a sequence, §5a cleanup, evidence on the running installation |
| **P9** | `docs/VOICE.md` and the funding dossier brought level with what the product now does; CodeSupply abstract/milestones/budget drafted (`D-0631`) against the 2026-09-03 opening |

## 5 — What will NOT be finished in 11 days, said now rather than discovered on day 11

Rule 38 forbids a false PASS, and a plan that promises everything is one.

- **FUNDING Phase G — independent penetration test.** External party by definition. Cannot be
  produced from inside this repository, at any speed.
- **FUNDING Phase F — cross-platform evidence on ≥2 real host classes.** Needs machines that are
  not this one. What *can* be done here is the capability-detection and declaration surface;
  the evidence itself cannot be manufactured (`CLAUDE10.md` §60-64).
- **`F-RUST-002`** — which control-plane implementation ships is an Owner architecture decision,
  not a defect to repair unilaterally (`D-0664`).
- **The model's own intelligence.** P1-P3 make the assistant grounded, capable and honest on
  whatever model runs. They do not make a 14B q4 build reason like a frontier model. If the
  Owner wants that felt quality, the lever is a stronger model behind the same interface — a
  configuration choice, deliberately left to the Owner, and the reason the product must never
  *require* one (`CLAUDE10.md` §14, `FOSS_CORE_DEPENDS_ON_ATOM = false`).

## 6 — Funding fit of this plan

**Restack · traits 1, 2, 4, 5.** P2's tool-call loop and P4's routing are a delimited, reusable
component (a local-first agentic turn that works against any OpenAI-compatible endpoint), they
reduce lock-in rather than deepen it, and P5 gives it a measurable reliability figure. The voice
chain is already fully local — no audio leaves the installation — which is trait 3 stated by the
architecture rather than by a claim.
