# SESSION HANDOFF

**Last updated:** 2026-08-19 · **Phase:** `s346` — `D-0554`/`D-0555` (after `s345`, `D-0551`) · **COMMITTED, no code changed**
**Plan of record:** `MASTER_PROJECT/` · **Live:** `noesar-evolution:d0544-health-lane-20260818T160214Z` (untouched)

---

## ➜ LA PROSSIMA AZIONE

**Read [`docs/GAP_REGISTER.md`](GAP_REGISTER.md) first.** It is new, and it is now the only place
that answers *"what remains to finish the project"* with a date and a command per row.

**Three candidates, the Owner chooses:**

1. **`G-01`, the acceptance matrix** inside `MASTER_PROJECT/` — ids, severities, traceability, risk
   register. `WORK_PLAN_V5_REWRITE.md` §5 declared this missing on 2026-08-03 and nobody closed it.
   **It blocks every other row**, because without it "done" is an opinion.
2. **`G-02`, prove `oci/Dockerfile` reproduces the live image** — 86 overlay Dockerfiles were never
   folded back, and the delivery ZIPs have no honest provenance until this is measured.
3. **`D-0555`, make the register measure itself** — this phase's proposal.

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**The Owner asked what is missing to finish, and no document could answer.** That was the finding,
and it mattered more than any single gap: all four candidates were stale, and two said so about
themselves.

| Document | Last measured | Why it could not answer |
|---|---|---|
| `MASTER_PROJECT/09_PIANO.md` §1 | 2026-07-26 | 4 of 15 rows measured **false** today |
| `docs/WORK_PLAN_V5_REWRITE.md` | 2026-08-03 | self-declares *"piano storico, non stato corrente"* |
| `docs/REMAINING_WORK.md` | 2026-07-26 | measures against the **retired V4 ruler** (`D-0219`) |
| `PROJECT_STATE.deferred_items` | various | two entries measured **false** today |

`REMAINING_WORK.md`'s banner said the live list "now lives in `docs/SESSION_HANDOFF.md`" — wrong in
practice: this file is capped at 150 lines and describes the current phase, by design. Corrected.

**Four rows of the plan's own table were false, and in the good direction** — the work exists:

```text
ReasoningProvider   reasoning.mjs   356 lines · 5 importers · 3 test files
capability token    capability.mjs  264 lines · 8 importers · 18 test files
shadow execution    shadow.mjs      433 lines · 5 importers · 5 test files
OIDC / SCIM         oidc.mjs 144 · scim.mjs 213
```

**Two `deferred_items` were false and are corrected in place, original text kept** so the change is
visible: passkey/WebAuthn "absent" against `webauthn.mjs` (251 lines, imported by `auth.mjs:17`);
`oci/Dockerfile` "no postgres, no supervisor, bare `node server.mjs`" against 31 matches and
`ENTRYPOINT ["/opt/noesar/bin/noesar-supervisord"]`.

**`09_PIANO.md` was deliberately NOT edited.** Its SHA-256 still matches
`MASTER_PROJECT/PROVENANCE.sha256` — verified this session, before and after — and that intact
checksum is what makes it the plan **as delivered**. The correction lives in the register instead.

**The first measuring instrument was wrong, and was discarded rather than published.** Matching by
first `grep` hit, it reported `scim.mjs` as the SAML implementation — a file that names SAML only
to explain why SAML is the one deliberately not attempted — and Emergency Stop as present on the
strength of `safety_interlock: { emergencyStop: false }`, a hardware flag in a module catalogue.
**Two false positives in nineteen rows**, on exactly the question the register exists to answer.
The corrected method matches the *owning module by name* and is stated in the register so it can be
challenged.

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

**`G-01` is not built.** A gap register says what is missing; an acceptance matrix says what "done"
means, with an id and a severity per row. Only the second lets a phase close controllably, and this
phase did not build it — the Owner authorised corrections.

**No code changed, so no suite was re-run beyond validating the state file parses.** Declared rather
than implied: `node -e JSON.parse` on `PROJECT_STATE.json`, and the provenance checksum. Running the
full battery would have measured nothing this phase touched.

**`[UNVERIFIED]`, and it is `G-02`:** whether `oci/Dockerfile` reproduces the running image. The
three specific claims in the old record are false today; the *general* claim was never measured by
anyone, and measuring it needs a build no phase has run.

**The register's own rows prove presence, reachability and the existence of tests — not
completeness or correctness.** That limit is written into the register itself, because a table of
green rows is exactly what a reader over-reads.

**Budget:** declared ~25 tool calls, spent ~50. The overrun is reported rather than hidden: the
measurement had to be built twice after the first method was found wrong.

---

## FILES THIS PHASE CHANGED

```text
NEW  docs/GAP_REGISTER.md              the live register — read this first
MOD  docs/REMAINING_WORK.md            banner pointer corrected (content kept verbatim, rule 12)
MOD  PROJECT_STATE.json                2 deferred_items corrected in place; phase keys
MOD  docs/DECISION_LOG.md              D-0554, D-0555
BAK  BACKUPS/PROJECT_STATE.json.s346_<UTC> · BACKUPS/REMAINING_WORK.md.<UTC>
NOT  MASTER_PROJECT/09_PIANO.md        deliberately untouched — provenance checksum intact
```

---

## OPEN BLOCKERS

`B-002` (stale premise: gitleaks *is* wired, the image is simply absent on this host) and `B-011`
(git history rewritten on the Owner's authorisation, bundle backup taken) — both unchanged. No new
blocker. `production_ready: false` stands, correctly.

---

## THE IMPROVEMENT PROPOSAL — `D-0555`, awaiting the Owner

`tools/measure-capabilities.mjs`: the corrected measurement as a runnable tool, plus a test that
fails when the register's table stops matching what the tool reports. This phase repaired four
stale rows by hand and nothing stops the fifth — every register in this project has rotted the same
way, written once and measured never again. **Funding fit — Restack · trait 5:** self-verifying
documentation is the only kind that survives a year.
