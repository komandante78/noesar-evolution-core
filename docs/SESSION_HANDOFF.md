# SESSION HANDOFF — NOESAR EVOLUTION

Last updated: 2026-08-12 · `phase_status = ATOM_TOKEN_ROTATED_AND_DOCUMENTED`
**`origin/main` = `57f803e`. The local branch is 4 ahead and NOT pushed.**

---

## ➜ LA PROSSIMA AZIONE

Nothing is blocking. Three independent things remain, **none implying the others**:

1. **A2 — the only end-to-end proof of the rotation.** Sign in and run one turn that uses
   reasoning: the indicator must read **`atom`**, not `reference`. Until then the evidence is
   strong but indirect — ATOM started and nothing logged an authentication failure.
2. **Deploy Voice V1.** It is committed (`20ed5b9`) and **not installed**: the running image is
   still `d0373-voice-conversation`, which predates it.
3. **OCI phase O1** — prove the repository rebuilds the running product. Prerequisite of
   internalising the four external containers that breach `MASTER_PROJECT/08_INSTALLAZIONE.md` §1.

Push is a separate authorisation and was not given.

---

## ➜ WHAT HAPPENED THIS SESSION

| | |
|---|---|
| `20ed5b9` | **Voice V1** — the spoken turn becomes an interruptible, cancellable state machine (`D-0388`) |
| `b3037ac` | its documentary closure (`D-0389`) |
| `67369cf` | **the close guard learns that a §3a replacement is not litter** (`D-0392`) + §21e inventory |
| *(this commit)* | the rotation's documentary closure (`D-0390`, `D-0391`) |

**`ATOM_TOKEN` is rotated and live** (`D-0391`). Downtime **0.8 s**; container
`3575d67aac1f…` → **`9ef797fa521a…`**; same image, no build, no pull, no product change.

**The first attempt failed and stopped production for 43.8 s** (`D-0390`). Cause: reads of
`--stop-timeout` and the log options placed *after* the rename — `D-0362`'s fault reproduced by a
patch written to prevent a different loss. Rolled back at once; no token change; nothing else
touched. It is written down because it happened, not because it is comfortable.

---

## ➜ WHAT WAS VERIFIED — evidence produced in this session

| Check | Result |
|---|---|
| Voice suite `voice-session.test.mjs` (`v1`) | **22/22**, exit 0 |
| the same suite, subject `legacy` (the oracle) | **8/9 red** — the 9th passes vacuously, recorded as such |
| full unit suite | **2394 tests, 2393 pass, 0 fail, 1 skipped** |
| ESLint | **391 files, 0 errors, 0 warnings, 0 no-undef** |
| rotation procedure, frozen at `sha256 e20c7542…` | fake-Docker fixture **52/52** over 9 scenarios, automatic rollback proven at four failure points |
| the reconstructed incident version, same fixture | **32 assertions fail**, installation left down — the oracle bites |
| live rotation | preflight PASS · healthy · four children · **0** auth-failure lines · **18/18** configuration fields identical |
| governance suites after the guard fix | **58/58 · 68/68 · 122/122** |
| container hygiene (§21b) | 53 → **52**; the 50 non-project containers, 10 networks and 63 volumes **unchanged** |

---

## ➜ WHAT WAS **NOT** DONE — declared

- **Nothing was pushed.** 4 commits ahead of `origin/main`.
- **Voice V1 is not deployed.** Committed only.
- **`OLD_TOKEN_REFUSED = UNVERIFIED`** — `atomd` listens on loopback inside the container, so
  proving a 401 needs `docker exec` or a disposable container, neither authorised. Not claimed.
- **A2 not performed** — it needs an Owner action.
- **T2/T3 were never run for Voice V1** (browser e2e, accessibility audit): they build an image and
  drive containers, excluded by the authorisation. Declared, not skipped silently.
- **The sensitive backups of both rotation attempts are kept**, `0700`/`0600`:
  `BACKUPS/atom_token_rotation_20260812T121329Z/` and `…T130147Z/`. They contain the workspace
  config directory. To be handled in a later closure — not deleted here.
- The rotation procedure and its fixture live **outside the repository**, in the session
  scratchpad. They are not committed.

---

## ➜ OPEN BLOCKERS

- **B-002** `[stale-premise]` — `gitleaks`/`trufflehog` absent; secret scanning is heuristic and
  declared heuristic every time (`CLAUDE10.md` rule 45).
- **B-011** `[low-deferred]` — git history rewritten on the Owner's authorisation (`D-0258`).
- Nothing new was opened.

---

## ➜ RESIDUAL DEBT

`oci/Dockerfile` builds the supervisor, PostgreSQL 18 + pgvector and the Rust peers — it is **not**
the stale file an old note claimed. What is genuinely missing is the four external containers
(`atom-evolution-model` = llama.cpp serving phi-4, **not** ATOM; `noesar-voice-hear`;
`noesar-voice-speak`; `noesar-search`): they exist only in the runtime and in prose, so a third
party cloning this repository does not get voice, search or a model. That is phase O6, and it is
the largest gap between "works here" and "self-hosted software".

---

## ➜ IMPROVEMENT PROPOSAL (recorded, not executed)

Make the deployment sequence a **script the repository owns**, not prose repeated by hand. The
rotation proved both halves of the argument in one session: the sequence is subtle enough to fail
on an expert (43.8 s of downtime from one misplaced read), and testable enough that a fake-Docker
fixture caught two further defects before they reached production — including one that would have
rolled back a perfectly successful deployment. *Benefit:* every future §3a deployment inherits the
preflight, the completeness guard and the automatic rollback. *Cost:* moving ~400 lines into
`tools/`, plus the fixture. **Owner's call.**
