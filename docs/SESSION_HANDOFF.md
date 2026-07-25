# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. A cold session should be able to resume from this
file and `PROJECT_STATE.json` alone.**

---

## Current position

| Field | Value |
|---|---|
| Phase just completed | **4 — plus the Phase 4 completion gate** |
| Phase status | `COMPLETED_WITH_COMPLETION_GATE` |
| **Next phase** | **5 — documentation, licensing audit, release and final packaging** |
| `NEXT_PHASE` | `5_READY` — **but see the constraint below** |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Updated (UTC) | 2026-07-25 |

**The product is installed, running, and now has a real data plane.** Container
`noesar-evolution`, image `noesar-evolution:phase4-complete`, on `127.0.0.1:8100`, healthy
— with **PostgreSQL 18.4 and pgvector 0.8.5 running inside it**, and still
**un-bootstrapped by design**.

### The constraint on Phase 5

`OWNER_BOOTSTRAP=AWAITING_OWNER_INTERACTION`. Phase 5 may begin **only for preliminary
documentation**. It may **not** declare the installation complete and may **not** package
the release until the Owner confirms: account created, TOTP active, one-time token
invalidated, recovery codes stored privately, login and step-up authentication working.

---

## What the completion gate did

```text
POSTGRESQL_18=PASS             MULTI_USER_RUNTIME=PASS       NO_UNDEF_LINTER=PASS
PGVECTOR=PASS                  ROW_LEVEL_SECURITY=PASS       TEST_SUITE_STRESS=PASS
DATABASE_BACKUP_RESTORE=PASS   PROJECT_USER_ISOLATION=PASS   SBOM_CYCLONEDX=PASS
NO_CRITICAL_FINDINGS=true      NO_HIGH_FINDINGS=true         SBOM_SPDX=PASS

GPU_RUNTIME_PATH=PASS          GPU_INFERENCE_TEST=BLOCKED_NO_LOCAL_MODEL
OWNER_BOOTSTRAP=AWAITING_OWNER_INTERACTION
```

```text
unit tests            444/444    (352 at the end of Phase 4)
postgres integration   47/47     in-container, from an empty data directory
post-install checks    15/15     against the installed instance
multi-user live        29/29     four accounts, three roles, real password+TOTP logins
eslint                136 files  0 errors, 0 warnings, 0 no-undef
flake stress          270 runs   0 failures
findings              14 raised: 5 high, 5 medium, 2 low, 2 informational — 13 closed
```

### The three that mattered most

1. **The delivered migration set could never have been applied.** Migration 0012 reshapes a
   view with `CREATE OR REPLACE VIEW`, which can only *append* columns; it fails
   deterministically on every cluster. Proof that the SQL had never run — which is what
   `B005=OPEN` had been saying since Phase 3. (`F4C-001`)

2. **The log redactor was corrupting 6.75% of every UUID it saw.** The phone-number rule
   matches inside a canonical UUID and rewrote the middle of it, so roughly one log record
   in fifteen carried a correlation id, incident id or session id that matched nothing —
   defeating the correlation-id feature Phase 3 built. **This was the "unreproduced flake"
   Phase 4 recorded and attributed to timing races in two unrelated files.** It was neither
   a timing race nor a test problem. (`F4C-009`)

3. **The Phase 4 remediation reintroduced the defect class it was fixing.** Commit
   `04878c4` renamed the call sites of `fetchOnceRetryingStaleSocket` in two unshipped
   copies of `provider-gateway.mjs` without adding the definition. ESLint found it on its
   first run — the exact class B-006 predicted, found by the exact tool B-006 asked for.
   (`F4C-006`)

**Five of the fourteen findings were defects in work done during this gate**, and four of
the five high findings were found by *executing* the product rather than reading it.

Full register: `docs/OPEN_FINDINGS.tsv`. Narrative and dismissals:
`docs/REMEDIATION_LOG.md`. Everything else: `docs/PHASE_4_COMPLETION_REPORT.md`.

---

## What was verified, and where

| Claim | Evidence |
|---|---|
| PostgreSQL 18 + pgvector, one container, supervised in-process | 47/47 in-container checks from an empty data directory, under full hardening |
| No TCP listener, scram-sha-256 only, credentials 0600 and never in the environment | `DB-09`…`DB-13`, `PI-09`, `PI-10`, `PI-13`, `PI-14` |
| Migrations, ledger, immutability | 16/16 applied; the application role cannot write the ledger |
| Vector insert / search / delete, HNSW | `DB-14`…`DB-18`; on the installed instance `PI-02`, `PI-03` |
| Per-user isolation **inside one workspace and project** | `DB-34`…`DB-40`: a private document invisible to a co-member, a shared one visible, a readable row not writable, vector search never returning another user's private entry |
| Six roles, invitation, MFA, disable, revoke, export, erase, service accounts | 29 unit + 29 live checks across four separately authenticated accounts |
| Backup and restore | checksummed dump; a tampered archive refused; restore keeps ledger and pgvector |
| Failure recovery | SIGKILL of the postmaster → restarted, no committed data lost |
| Clean shutdown | `clean: true`, `postmaster.pid` removed, verified across a real `docker restart` |
| GPU runtime path | 20 unit tests + 3 live checks; hardware observed, **not allocated** |
| Static analysis | 136 files clean; detector self-tested against 3 canaries |
| SBOM | CycloneDX 1.7 + SPDX 2.3 for image and source, syft pinned by digest |
| Nothing else on this host touched | `network ls` and `volume ls` **identical**; only the `noesar-evolution` image changed, plus two new stopped containers this gate created |

---

## What was NOT done — do not assume otherwise

- **No Owner account exists on the real installation.** Deliberate. See the next section.
- **No real GPU inference test.** `GPU_INFERENCE_TEST=BLOCKED_NO_LOCAL_MODEL` — there is no
  model and no inference runtime on this host that this gate may use. The exact minimum
  needed is in `docs/GPU_LOCAL_MODEL_RUNTIME.md`.
- **The live multi-user acceptance ran on a probe installation**, not the real one, because
  running it on the real one would have created the Owner account this gate must not create.
  Same image, same hardening.
- **No TLS**, no external provider contacted, no `noesar.com` connectivity. Every credential
  used was synthetic and generated at run time.
- **No independent penetration test.** The same party wrote the implementation, the tests
  and the reports.
- **No Phase 5 work**: no release documentation, no licensing decisions, no ZIP packaging.
- **No push** — there is no remote (`B-001`).
- **`noesar-debuglab` was not started** in this gate.
- **The SBOM documents are not committed.** ~22 MB of generated JSON, reproducible from a
  pinned tool and a pinned image; checksums are recorded in `docs/SBOM_REPORT.md`.

---

## The one thing waiting for the Owner

The installation is bound to `127.0.0.1` on the Unraid host, so from another machine:

```bash
ssh -L 8100:127.0.0.1:8100 root@192.168.178.100
# then open http://127.0.0.1:8100 in a LOCAL browser
```

Read the one-time token from
`/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/config/first-owner-setup.token` (mode `0600`, owner
`10001`) and follow `docs/OWNER_BOOTSTRAP.md`. Choose the password yourself. Keep the TOTP
seed and recovery material in a password manager — none of it should reach this repository,
a log, or a chat transcript.

> **Correction to the previous handoff.** It told you to expect fingerprint
> `af6f7ca93c31`. That value does not match this installation and **never did** — the
> Phase 4 container itself logged `db1cf03ef221` at 12:20 on the day Phase 4 ran. It was
> most likely captured from the throwaway probe container used for the bootstrap rehearsal,
> which had its own workspace and therefore its own token (`F4C-014`).
>
> **Verify against the live log, not against any document:**
> ```bash
> docker logs noesar-evolution 2>&1 | grep setup-token.available | tail -1
> ```
> It currently reports `db1cf03ef221`. The token rotates on expiry, so any fingerprint
> written down goes stale by design.

The whole flow was rehearsed end to end on a probe built from this exact image, so what
remains is only the part that needs a person: choosing a password and keeping a TOTP seed.

---

## Open blockers

### B-001 — no GitHub remote · medium · unchanged
`gh` is not installed and no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. The local
repository is complete and committed. Resolve with `gh repo create NOESAR-EVOLUTION
--private --source . --remote origin --push`, or by creating the private repository
manually and adding `origin`. **Must be private.**

### B-002 — secret scan is heuristic · low · reduced
Neither `gitleaks` nor `trufflehog` is installed, and CLAUDE10 rule 45 forbids installing
tooling. Still heuristic — but ESLint and syft now cover surfaces that previously had no
tooling at all, and the heuristic scan was re-run over the full staged set.

### B-005 — **CLOSED**
PostgreSQL 18.4 with pgvector 0.8.5 is installed, migrated and exercised. Nothing was
substituted with SQLite.

### B-006 — **CLOSED**
ESLint 9.39.5 with `no-undef`, self-tested, wired into the suite and the pre-commit gate.

---

## Exact next action

**Do not start Phase 5 without explicit authorisation.** When it is authorised — and
remembering that it may only produce *preliminary* documentation until the Owner has
bootstrapped:

1. Read `PROJECT_STATE.json`, this file, `docs/PHASE_PLAN.md`,
   `docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md` — in that order.
2. The licensing backlog inherited from Phase 1 is still open and is Phase 5's largest
   item: **12 Rust crates and 2 Node packages declare no licence, there is no root
   `LICENSE`, and 86 sources have no SPDX header.** The three-way split (AGPL core /
   Apache-2.0 SDK / CC-BY-SA-4.0 docs) is still a **proposal**, not a decision.
3. `docs/SBOM_REPORT.md` records a related gap: the source scan surfaces **0 declared
   licences** for the Rust tree, so licence conclusions there still need doing by hand.
4. Enable the pre-commit gate in any fresh clone: `git config core.hooksPath .githooks`.

## Reproducing this gate's verification

```bash
npm test                                    # 444 unit tests
npm run lint                                # eslint, 136 files
npm run lint:self-test                      # prove the detector fires
node tools/generate-migration-manifest.mjs --check
node tools/flake-stress.mjs --isolated 50 --suite 20 --seed 20260725
tools/generate-sbom.sh noesar-evolution:phase4-complete

# in-container, needs the product image:
#   node tools/acceptance/postgres-integration.mjs
#   node tools/acceptance/post-install-checks.mjs
#   node tools/acceptance/multi-user-isolation.mjs <base-url> <setup-token>
```
