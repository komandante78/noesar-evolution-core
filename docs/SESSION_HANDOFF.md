# SESSION HANDOFF

**The Owner set a deadline and named two shames.** 2026-08-24: *"devi fare in modo che il
progetto sia finito entro 11 giorni … la cosa che è veramente vergognosa è la voce e la chat"*.
Deadline **2026-09-04**, one day after NLnet's calls reopen. The plan is
`docs/PLAN_11_DAYS_TO_DELIVERY.md`.

**And on 2026-08-24 he said the working method itself was wrong** — *"perdi tempo e non fai ciò
che chiedo"*. He was right, and the cause was specific: a status report with a question at the
end instead of the work, and **his own page-by-page list left unused on disk**. That list is
`docs/OWNER_REVIEW_2026-08-21.md` §4. **Read it before deciding what to build.** Two of its rows
had been closed by me and were reopened by him in his own words — on the "NON MI PIACE" column
**the Owner decides**, so his word of today outranks any earlier closure.

## ➜ LA PROSSIMA AZIONE

**The Owner must LISTEN to the deployed voice** (`d0685-streamed-voice-20260824T174106Z`, live)
and say whether `§4#4`/`§4#5` are closed. Then one of two things:

- **if the wait is fixed but the voice still sounds wrong** → it is the TIMBRE, which `D-0645`
  already left as his runtime choice: move the running Kokoro container to the idle RTX 3060
  (fast, same voice), or bind a larger open model (XTTS-v2 / Chatterbox). **Neither is mine to
  do** — rule 16, another project's container.
- **if it is closed** → `§4#6`/`§4#7` (Knowledge/Memory identity, delegated to me in `D-0647`)
  and `§4#10` video are the remaining rows.

## WHAT WAS DEPLOYED AND VERIFIED THIS SESSION

`d0685-streamed-voice-20260824T174106Z` — byte-equal to the tree on five files, md5 compared
**inside the running container**. `running`/`healthy`, `/livez` `/readyz` 200, 0 auth-failure.

| | what is true now that was not |
|---|---|
| **`D-0683` · `§4#3` reopened** | the chat bar keeps only *where you are* (project › conversation, branch, provider); the nine actions moved behind one "⋯". `D-0641` had boxed ten permanent controls into three labelled cards — grouping was never the problem, **permanence** was |
| **`D-0683` · `§4#11` new** | **`Clear conversation` exists.** It had never been built: the only clear was the `/clear` COMMAND, display-only, watermarked in one browser's localStorage. The new one is **non-destructive** — a new empty branch, every message still readable on the branch it was written on. Real deletion stays in Sessions, 30-day bin |
| **`D-0685` · P5** | **the voice speaks the first sentence while the rest is still being written.** Measured before: ~5794 ms of silence, 4790 ms of it waiting for the last token |

**Three defects found by LOOKING at the rendered page**, not by reading the diff: two decorative
glyphs drew as tofu boxes (no font may be presumed, §62); the branch chip drew as a wide empty
pill before a conversation is open; the open menu was see-through onto the Work column.

**Measured:** hook suite **3203 tests / 3201 pass / 1 pre-existing skip / 0 fail** · ESLint
**505 files, 0/0/0** · new suites `voice-streamed-speech` 7/7, `voice-sentence-stream` 8/8,
`ai-context-graph` 4/4 · `voice-session` 25/25 unchanged · MANIFEST 6779 files.
**Oracle proven to have teeth:** with the streaming branch disabled **4 of 7 new tests fail**;
restored, 7/7.

## WHAT WAS **NOT** DONE

- **`§4#4` — the voice's TIMBRE is untouched.** Only the wait was removed. If it still sounds
  bad after listening, that is the container decision above, and it is the Owner's.
- **`§4#6`/`§4#7`/`§4#10`-video** — not started this session.
- **The i18n ratchet is red and stays red** (`D-0686`): `F-I18N-002` measures **654 closable of
  919** against a declared baseline of **607**. It was **not** re-baselined — raising a ratchet
  to whatever the code currently does turns the defect into the requirement. None of the 47 came
  from this session. `BROWSER_E2E_FAIL_UNDECLARED=0`.
- **Nothing was pushed** — see the blocker below.
- The composer's eight emoji icon-buttons still depend on an emoji font and drew as empty boxes
  on the probe (`D-0684`, proposed, not executed).

## OPEN BLOCKERS

- **`B-015` — 15 commits unpushed** (`git log origin/main..HEAD`). Needs the Owner: authorise the
  push, and decide whether to move `origin` to SSH so this stops recurring.
- **`B-016`** — the configured model cannot emit tool calls (`llama.cpp` needs `--jinja`, another
  project's container). Blocks P3 only.
- **`F-I18N-002`** — above. Recorded, not hidden, not re-baselined.

## THE METHOD THAT WAS CORRECTED, AND MUST NOT DRIFT BACK

1. **His list is the backlog.** Do not ask him to re-dictate what is already in
   `docs/OWNER_REVIEW_2026-08-21.md`.
2. **A row he reopens is open**, whatever a `D-0xxx` says. §0 of that file: on "NON MI PIACE"
   the Owner decides.
3. **Do not end a turn with a question when the work was already authorised.** Deliver, then ask
   only what genuinely needs him — a container, a push, a product direction.
4. **A UI surface is seen rendered before it is called done.** Three screenshots this session
   found three defects that no test would have.
