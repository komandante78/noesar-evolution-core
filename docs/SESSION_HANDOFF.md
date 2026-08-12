# SESSION HANDOFF — NOESAR EVOLUTION

Last updated: 2026-08-12 · `phase_status = V1_IMPLEMENTED_VERIFIED_NOT_COMMITTED`
**`origin/main` = local `HEAD` = `57f803e`.** The five governance commits of 2026-08-11 **were
pushed** — the previous handoff's "5 ahead, NOT PUSHED" was stale, confirmed by `git ls-remote`.
Working tree now carries the **uncommitted** V1 change: 4 files modified, 3 new.

---

## ➜ LA PROSSIMA AZIONE

**`OWNER_AUTHORIZATION_FOR_COMMIT`.** Voice phase V1 is implemented and green. Nothing is
half-done and nothing is blocking. One atomic commit is prepared and deliberately not made:

```text
fix(voice): the spoken turn becomes a state machine that can be stopped (D-0388)
  apps/webui-static/voice-session.js                        (new, 300 lines)
  apps/webui-static/app.js                                  (adapters + rendering only)
  apps/webui-static/index.html                              (the Stop control)
  apps/webui-static/styles.css                              (endpointing/transcribing/error states)
  apps/webui-static/i18n-catalog.js                         (7 strings, en + it)
  services/reference-control-plane/test/voice-session.test.mjs  (new, 22 tests + the oracle)
  tools/acceptance/voice-latency.mjs                        (new, the V0 bench)
  docs/VOICE.md · docs/DECISION_LOG.md · docs/SESSION_HANDOFF.md · PROJECT_STATE.json
```

Backup of every mutated file: `BACKUPS/voice_v1_20260812T024121Z/` (4 files).

---

## ➜ WHAT V1 CLOSED, WITH THE MEASURE

- **V-001 (CRITICAL) CLOSED.** `HTMLMediaElement.play()` resolves when playback *begins*; the
  shipped code awaited it and reopened the microphone (`app.js:3218-3222` + `:3622`), under a
  comment asserting the opposite. The playback adapter's contract is now *resolve when playback
  has ENDED*, and a source-level test asserts the defective shape cannot come back.
- **V-002 (HIGH) CLOSED.** One `AbortController` per generation, shared by STT, chat and TTS.
  Closing the window aborts all three; an aborted chat also POSTs the run stop, so the model is
  not left generating an answer nobody will hear.
- **Ghost turns and double answers are structurally impossible**, not merely unlikely: every
  awaited result is checked against its generation and dropped in silence if superseded.
- **Three ways to cut in**, ranked honestly: the Stop control and Escape are total; speaking over
  the reply is **best effort** (explicit `echoCancellation`, 700 ms grace, 300 ms sustain above a
  threshold higher than the endpointer's).
- **UI states the window could not previously say**: `endpointing`, `transcribing`, `interrupting`,
  `cancelling`, `error`. Before, `endpointing` was drawn as "Listening" (telling the person to keep
  talking after the product had stopped hearing) and every failure as "Ready to listen".

---

## ➜ WHAT WAS VERIFIED — evidence produced in this session

| Check | Result |
|---|---|
| `voice-session.test.mjs`, subject `v1` | **22/22 pass**, exit 0 |
| the same suite, subject `legacy` (`VOICE_SUBJECT=legacy`) | **8/9 fail** — the red, reproducible. The 9th (*repeated interruptions are idempotent*) passes **vacuously**: legacy's `interrupt()` is a no-op and its listen count is already 2 from the V-001 defect, so the assertion is satisfied by coincidence. It still bites against `v1`; the oracle does not prove it. Recorded, not rounded off |
| full unit suite | **2394 tests, 2393 pass, 0 fail, 1 skipped** |
| `tools/run-eslint.sh` | **391 files, 0 errors, 0 warnings, 0 no-undef** |
| `node tools/verify-source.mjs` | `SOURCE_VERIFY=PASS migrations=19 baseline=12/12` |
| UI language coverage | **841/841**, 0 dead entries |
| `tools/acceptance/voice-latency.mjs` | runs, prints 3 synthetic + 7 `BLOCKED` |
| live engines, read from their own logs | STT **102–118 ms** warm (3–4 s audio), **+928 ms** cold after the 300 s unload; TTS **635 ms** / 47 chars, **2 260 ms** / paragraph (CPU) |

The oracle lives **inside** the green suite: two tests assert the legacy sequencing still fails,
so the assertions are proven to have teeth rather than resting on a terminal output nobody can
reproduce.

---

## ➜ WHAT WAS **NOT** DONE — declared

- **Nothing was committed and nothing was pushed.** Both need a separate Owner authorisation.
- **No container, image, network, volume, runtime, database or ATOM was touched.** No build, no
  deploy, no restart. The installation still runs `d0373-voice-conversation` and does **not**
  carry this change.
- **T2 and T3 were not run**: `tools/browser-e2e.mjs` and `tools/accessibility-audit.mjs` build a
  product image and drive containers, which the authorisation excluded. The change touches markup,
  so the change map would normally call for both — **declared, not skipped silently.** The one
  ESLint analysis container is disposable (`docker run --rm`, `CLAUDE10.md` §16) and left nothing.
- **`REAL_MICROPHONE_ACCEPTANCE = BLOCKED_AWAITING_OWNER`.** Seven latencies stay `BLOCKED`; the
  procedure for each is printed by the bench, and none was estimated.
- **Barge-in by voice is not proven.** Only its lifecycle half is measured (synthetic, 0.28 ms from
  `interrupt()` to the adapter observing its abort). **No sub-200 ms claim is made.**
- **Not in V1, by the Owner's own exclusion**: streaming STT, streaming TTS, WebSocket/WebRTC
  (V2/V3), rate limiting and telemetry (V4), TUI voice parity and full accessibility (V5),
  reproducibility of the two voice containers (V6).
- The TUI still has **zero** voice — 0 occurrences in `tui-client.mjs` / `tui-fullscreen.mjs`.

---

## ➜ OPEN BLOCKERS

- **B-002** `[stale-premise]` — `gitleaks`/`trufflehog` absent on this host; secret scanning is
  heuristic and declared heuristic every time (`CLAUDE10.md` rule 45).
- **B-011** `[low-deferred]` — git history rewritten on the Owner's authorisation (D-0258).
- Nothing new was opened by V1.

---

## ➜ RESIDUAL DEBT NAMED BY THE AUDIT (not V1's scope)

`oci/Dockerfile` does not rebuild the running product; the two voice containers
(`noesar-voice-hear`, `noesar-voice-speak`) exist only in the runtime and in prose — a third party
cloning this repository does not get voice. That is V6, and it is the largest single gap between
"works here" and "self-hosted software".

---

## ➜ IMPROVEMENT PROPOSAL (recorded, not executed)

Give the session a **replayable turn journal**: `onState`/`onNote` already carry every transition
with its generation, so writing them to a bounded in-memory ring and exposing them on the voice
window would make a failed conversation reconstructible without a debugger — and would be the
data structure V4's telemetry needs anyway. *Benefit:* the first real defect report about voice
stops being "it did not answer". *Cost:* ~40 lines, one panel, no new dependency. **Owner's call.**
