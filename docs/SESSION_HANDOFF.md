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


## SINCE THEN — a host cleanup the Owner authorised, and the guard defect it exposed

`D-0680`/`D-0681`/`D-0682`, 2026-08-24, **after** the six below. It touched no product code and
does not change the next action above.

- **The Owner amended `CLAUDE10.md` rule 12 with a fourth named exception** (*"autorizza la
  pulizia anche di altri"*), for host cache reclaim and superseded project directories under
  `/mnt/cachec`. It is **irreversible** and bounded by an explicit protected list, not by care.
- **`/mnt/cachec` 224G→69G used (49%→15%)**, plus 168.3 GB of Docker build cache. 21 directories
  removed by name through `tools/cache-cleanup.sh`, the only authorised mechanism.
  `NOESAR/`, `NOESAR_EVOLUTION*`, `ATOM*`, `NOESAR-ATOM-PRIVATE` verified present afterwards;
  non-project containers 38→38, volumes 75→75; installation `/livez` `/readyz` 200.
- **`F-HOOK-008`, a real hole in this project's own guard**: `find … -exec rm -rf {} +` and
  `find … -delete` were invisible to it, because it judged the command word. 89 GB outside
  `PROJECT_ROOT` went through unchecked before the fix. Repaired, with 4 oracle cases.
- **`NOESAR_BRAIN` (25 GB) and `DEBUG_EVOLUTION*` (2.8 GB) are gone** — the Owner classified them
  as projects, not modules, against this session's recommendation to keep them. Not recoverable.

## WHAT IS TRUE NOW THAT WAS NOT

Six decisions, all DEPLOYED and verified live. Full detail in `docs/DECISION_LOG.md`, which owns
history; condensed here because this file describes *now*.

| | What is true now | The measurement that made it necessary |
|---|---|---|
| `D-0672` | the chat knows what product it is, which model answers, and what it can actually do | asked *"chi sei?"* it answered **"Sono un modello sviluppato da Microsoft"**, in English |
| `D-0674` | the chat can call a tool and answer from the real result | `parseSse` discarded `delta.tool_calls`; `ToolExecutor` had two callers, neither the chat |
| `D-0675` | a health check says whether a provider can call tools at all | the configured model accepts a `tools` array and answers in prose (`B-016`) |
| `D-0676` | the voice says what it did, and a compound request keeps both halves | a performed command returned `reply:''` — the product acted in **total silence** |
| `D-0677` | `@noesar/spoken-intent`: SPEC, 60 vectors, and the SHIPPED resolver held to them | a spec with one implementation is a description of that implementation |
| `D-0678` | speech acts only on an exact match; anything else ends the turn silently | **10 of 45 noise fragments acted** — `"ok"` ran `/revoke`, `"no"` ran `/sweep` |
| `D-0679` | a spoken answer is asked for as speech, with a speakable model name | it read 562 characters aloud, including `/models/phi-4-q4_k_m.gguf` |

**Two scope defects worth carrying forward:** every chat turn this product ever served offered the
model **zero tools** (two independent causes, both fixed), and `project.toolIds` was written `[]`
at creation with **no writer anywhere in the repository** yet read as a deny-list.

**Three times this session the INSTRUMENT was the defect, not the product** — a raw
`translateString` returning an object, wrong provider field names, and a Kokoro voice check
comparing strings to objects. Each was caught before it became a false claim, and each is why the
next session should measure before believing a written premise, including its own.


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
- **`NOESAR_DEBUG_EVOLUTION_TOKEN` rotation** — not done: it authenticates this project to an
  external one, so rotating it here alone breaks that integration (`D-0666`).

## LOCAL, UNTRACKED, BY DESIGN

- `EVIDENCE/docker_inventory_pre_cleanup_*.txt` — the §5a inventories, gitignored: they list every
  container on this host, other projects included.
- `BACKUPS/pre_history_rewrite_20260823T134411Z.bundle` — pre-rewrite recovery point, rule 23.

## MEASURED AT CLOSE, FOR THE OWNER TO DECIDE

- **`F-DISK-001`** — the docker build cache is **168.3 GB, 153 GB reclaimable**, and this project
  holds **54 unique image layer-sets** because every deploy keeps its image as a documented
  rollback point. The filesystem is at 54% with 117 GB free, so it is **not urgent**. Deliberately
  **not acted on**: every `prune` is host-wide and forbidden without exception (`CLAUDE10.md`
  §21d) — it would destroy other projects' caches. Retiring old rollback images is an Owner
  decision under rule 12, not a cleanup.

## OPEN BLOCKERS

- `B-016` **OPEN, needs the Owner** — the configured model cannot emit tool calls. See above.
- `B-015` **OPEN** — `git push origin main` fails, no credential helper here. Everything is
  complete locally and **deployed live**, but not on `origin`. Same shape as `B-014`, which the
  Owner closed by supplying a PAT ad-hoc.
- `B-002` **STALE** (`D-0257`) — neither `gitleaks` nor `trufflehog` on `PATH`; this session's
  diffs were reviewed with a heuristic grep, clean, **declared as heuristic**.
- `B-011`, `B-013`, `B-014` closed previously.
