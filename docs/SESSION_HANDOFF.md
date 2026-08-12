# SESSION HANDOFF — NOESAR EVOLUTION

Last updated: 2026-08-12 · `phase_status = SESSION_CLOSED_AWAITING_A2`
**`origin/main` = `57f803e`. The local branch is 7 ahead and NOT pushed.**

---

## ➜ LA PROSSIMA AZIONE — **A2**, e nient'altro

**A2 is the only end-to-end proof that the rotated `ATOM_TOKEN` is carried by BOTH consumers.**
It needs a signed-in session, so it is an Owner action: no automation here can hold a credential.

```text
1. open   https://192.168.178.100:8443        (or http://192.168.178.100:8100)
2. sign in
3. run ONE turn that uses reasoning — a chat message is enough
4. read the reasoning indicator: it must say  atom   and NOT  reference
```

**What the verdict means.** The two sides of the token live inside the same container: the
supervisor hands `ATOM_TOKEN` to the `atom` child, and the api sends
`NOESAR_RUST_REASONING_TOKEN` as the `x-atom-token` header. If the rotation had written them
differently, atomd would refuse and the product would **declare** the fallback (`D-0312`):
`degradationSummary()` returns `provider: 'reference'` the moment any degradation event exists,
and `atom` only while none does. So `atom` is the pair matching, observed end to end.

**Baseline captured for the verdict** (2026-08-12T13:44Z, before any A2 turn):

| | |
|---|---|
| `/readyz` | `200`, `ready: true`, `setupPending: false` |
| container log | **118 lines** — the marker, in `EVIDENCE/a2_log_marker.txt` |
| degradation / auth-failure lines | **0** |
| `atom` child | spawned, announced `provider=atom version=0.1.0 contract=1.0.0` |

After the turn, anything new past line 118 mentioning degradation or `x-atom-token` is the
counter-evidence; its absence plus an `atom` indicator is the pass.

**Then, in order:** deploy Voice V1 (`tools/deploy/redeploy.sh --image`, committed but not
installed) · `git push origin main` (7 commits, never forced) · OCI phase O1.

---

## ➜ WHAT HAPPENED THIS SESSION

| | |
|---|---|
| `20ed5b9` | **Voice V1** — the spoken turn becomes an interruptible, cancellable state machine (`D-0388`) |
| `b3037ac` | its documentary closure (`D-0389`) |
| `67369cf` | **the close guard learns that a §3a replacement is not litter** (`D-0392`) + §21e inventory |
| `0ba49a6` | the rotation's documentary closure (`D-0390`, `D-0391`) |
| `771b646` | **the §3a sequence becomes a tool**: `tools/deploy/redeploy.sh` + fixture + `docs/DEPLOYMENT.md` (`D-0393`) |
| `a6f00ab` | advance `last_commit` past it, so check 2 passes for the right reason |
| *(this commit)* | session closure: A2 as the single next action, and `F-ROT-001` recorded |

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
| deploy fixture `npm run test:redeploy` | **70/70** over 9 scenarios · oracle: **26 failures** on a copy carrying the incident defect |
| the new tool's `--check` on the LIVE installation | **PASS**, non-mutation verified externally (git, container id, backups, inventory all unchanged) |
| container hygiene (§21b) | 53 → **52**; the 50 non-project containers, 10 networks and 63 volumes **unchanged** |

---

## ➜ WHAT WAS **NOT** DONE — declared

- **Nothing was pushed.** 7 commits ahead of `origin/main`.
- **Voice V1 is not deployed.** Committed only.
- **`OLD_TOKEN_REFUSED = UNVERIFIED`** — `atomd` listens on loopback inside the container, so
  proving a 401 needs `docker exec` or a disposable container, neither authorised. Not claimed.
- **A2 not performed** — it needs an Owner action.
- **T2/T3 were never run for Voice V1** (browser e2e, accessibility audit): they build an image and
  drive containers, excluded by the authorisation. Declared, not skipped silently.
- **The sensitive backups of both rotation attempts are kept**, `0700`/`0600`:
  `BACKUPS/atom_token_rotation_20260812T121329Z/` and `…T130147Z/`. They contain the workspace
  config directory. To be handled in a later closure — not deleted here.
- **A2 was NOT performed** — it needs a signed-in session and no automation here holds a
  credential. The recipe and the baseline for its verdict are at the top of this file.
- **`F-ROT-001` recorded, not fixed**: `NOESAR_ALLOWED_HOSTS` still names the container IP from
  *before* the rotation. Nothing observed is broken — every host clients actually use answers
  200 — but a self-referential value went stale the moment the container was replaced, and
  nothing detects that class.
- **The new tool has deployed nothing.** It landed with its fixture green and its `--check` run
  against the live installation; no container was touched by it.

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

*The previous proposal — make the deployment sequence a tool the repository owns — was accepted
and is `D-0393`, in this commit.*

Next: **give the fixture a second fake, one that answers Go templates properly.** Today's fake
matches known format strings by substring, so it proves ordering and recovery but cannot catch a
template this project writes wrongly — and it has already written two wrongly in one session
(`$k` expanded by the shell, and `{{range , := …}}`). *Benefit:* the class of defect that reaches
production as an empty flag becomes visible in the fixture. *Cost:* ~80 lines, or a vendored
minimal template evaluator. **Owner's call.**
