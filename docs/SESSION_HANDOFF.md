# SESSION HANDOFF

**The Owner set a deadline and named two shames.** 2026-08-24: *"devi fare in modo che il
progetto sia finito entro 11 giorni … la cosa che è veramente vergognosa è la voce e la chat"*.
Deadline **2026-09-04**, one day after NLnet's calls reopen. The plan is
`docs/PLAN_11_DAYS_TO_DELIVERY.md`. His page-by-page list is the backlog:
`docs/OWNER_REVIEW_2026-08-21.md` §4 — **read it before deciding what to build**, and a row he
reopens is open whatever a `D-0xxx` says.

## ➜ LA PROSSIMA AZIONE

**P3 is closed and deployed.** Nothing is waiting on the Owner to continue. The next phase is
**P7** (closable open findings: `F-ROT-001`, `F-MODEL-001`, `F4-012`) or **P6** — and P6 is a
**re-measurement, not a build**: `voice-session.js` already re-arms on every path, so measure
what is actually missing before writing a line.

Two things need the Owner and only the Owner:

- **`B-015` — 19 commits unpushed.** Authorise the push, and decide whether `origin` moves to SSH.
- **`B-016` — the model emits no tool calls.** `atom-evolution-model` has no `--jinja`
  (verified this session with `docker inspect`, read-only). It belongs to another project, so
  it is not mine to restart. This is what stops a real end-to-end chat turn being demonstrated.

## WHAT WAS DEPLOYED AND VERIFIED THIS SESSION

`p3-engine-tools-20260825T030536Z` — 6 files md5-compared tree↔image, redeploy preflight
**498 byte-equal / 0 differing / 0 absent**. `running`/`healthy`, `/livez` `/readyz` 200,
0 auth-failure.

| | what is true now that was not |
|---|---|
| **`D-0687` · P3** | **the chat can call the engine it lives in.** All three existing tool transports left the process; the chat could reach a stranger's API and not this installation. 20 read-only engine methods are now tools, derived from `SESSION_METHOD_POLICY`, executed through the **same `sessionDispatch`** the terminal uses with the **caller's own `can`**. No authority is created; a call with no `can` is refused, not defaulted |
| **`D-0688`** | **five defects repaired**, four found by *looking* at the page: `actorId` was overridable from the request body (audit forgery → escalation once authority travelled with it); `tool-result.preview` showed the untrusted-content fence and never the result; `[object Object]` on all 15 components of the front page; the Home tools panel had no cap (4258px → 3358px); a built-in's reach was reported as `unknown` |
| **`D-0689`** | the i18n ratchet **measured A/B in one session**, which `D-0686` could not do: **680 → 659 closable**, net −21. Baseline stays **607** and was **not** re-taken |

**Live proof of the capability, not of the code:** startup log `tools.builtin-seeded added:20`;
live state **23 tools / 20 builtin / 0 disabled / 0 mutative / 0 write-or-destroy leaked in**.

**Measured:** unit **3139 / 3138 pass / 1 pre-existing skip / 0 fail** · `scripts/test.sh`
**22/22, 0 unavailable** · ESLint **507 files 0/0/0** · browser e2e **516 checks, 515 pass, 1
declared gap**, `BROWSER_E2E_FAIL_UNDECLARED=0` · MANIFEST **6781 files**.
**Oracle proven to have teeth:** with the authority gate removed, **2 of 17** new tests fail.

## WHAT WAS **NOT** DONE

- **A real end-to-end chat turn was never driven** — `B-016` above. Everything *below* the
  model is proven, by 17 tests that run the real orchestrator, the real executor and the real
  dispatch. The model itself is the missing half and it is a configuration choice.
- **The 8 write and 2 destroying engine methods are NOT registered.** Classified, schema'd,
  deliberately left off (`D-0687`). Letting a model approve a plan or purge a session changes
  what the product is — an Owner decision. What is genuinely missing first is a mid-turn
  approval the person gives.
- **`F-NAV-001` — REPAIRED** (`D-0692`). The register form and the tool cards now live in
  the bench panel at `coden/bench/tools`, which is where `D-0137` said tools live and where
  the markup had never followed. `D-0137` is not undone. The six-name `#navTools` preview,
  whose `data-jump` pointed at the screen it was already on, is gone — the panel holds the
  thing itself. Registering a tool, granting it consent and saving its key are reachable.
- **`F-I18N-002` stays red** at 659 against baseline 607, **not** re-baselined.
- **Nothing was pushed.**
- Owner list rows untouched this session: `§4#4` timbre (his), `§4#5` voiceFace, `§4#6`/`§4#7`
  Knowledge/Memory identity, `§4#8` research providers, `§4#9` agent creation, `§4#10` video.

## OPEN BLOCKERS

- **`B-015`** — 19 commits unpushed (`git log origin/main..HEAD`).
- **`B-016`** — the configured model cannot emit tool calls. Blocks the live demonstration of
  P3, not P3 itself.
- **`F-I18N-002`**, **`F-NAV-001`** — above.

## THE METHOD THAT WAS CORRECTED, AND MUST NOT DRIFT BACK

1. **His list is the backlog.** Do not ask him to re-dictate what is already written down.
2. **A row he reopens is open**, whatever a `D-0xxx` says.
3. **Do not end a turn with a question when the work was already authorised.** Deliver, then
   ask only what genuinely needs him — a container, a push, a product direction.
4. **A UI surface is seen rendered before it is called done.** Three of this session's five
   repairs came from screenshots and none from a test.
5. **A ratchet that rose is diffed, not re-baselined.** One controlled A/B run answers the
   question the number cannot.
