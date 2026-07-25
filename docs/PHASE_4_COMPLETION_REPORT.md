# Phase 4 completion gate — report

**Scope:** close the requirements that were incompatible with a complete final delivery.
**Phase 5 was not started.** No documentation-for-release, no relicensing, no ZIP packaging.

---

## 1. Gate status

```text
POSTGRESQL_18=PASS
PGVECTOR=PASS
DATABASE_BACKUP_RESTORE=PASS
MULTI_USER_RUNTIME=PASS
ROW_LEVEL_SECURITY=PASS
PROJECT_USER_ISOLATION=PASS
NO_UNDEF_LINTER=PASS
TEST_SUITE_STRESS=PASS
SBOM_CYCLONEDX=PASS
SBOM_SPDX=PASS
NO_CRITICAL_FINDINGS=true
NO_HIGH_FINDINGS=true

GPU_RUNTIME_PATH=PASS
GPU_INFERENCE_TEST=BLOCKED_NO_LOCAL_MODEL

OWNER_BOOTSTRAP=AWAITING_OWNER_INTERACTION

NEXT_PHASE=5_READY
```

Because `OWNER_BOOTSTRAP` is awaiting the Owner, **Phase 5 may begin only for preliminary
documentation** — not for a final declaration and not for packaging.

## 2. What the gate asked for, and what it got

| Requirement | Outcome | Detail |
|---|---|---|
| PostgreSQL 18 + pgvector, really working | **done** — 18.4 / 0.8.5, one container, supervised in-process | `POSTGRESQL_18_PGVECTOR_IMPLEMENTATION.md` |
| Multi-user runtime, six roles | **done** — 29 unit + 29 live checks | `MULTI_USER_SECURITY_MODEL.md` |
| GPU and local models | **path done, inference blocked** | `GPU_LOCAL_MODEL_RUNTIME.md` |
| Owner bootstrap | **prepared, awaiting the Owner** | `OWNER_BOOTSTRAP.md`, §7 below |
| The unreproduced flake | **reproduced, root-caused, fixed** | `FLAKE_STRESS_REPORT.md` |
| `no-undef` static analysis | **done** — ESLint 9.39.5, 0 findings | `JAVASCRIPT_STATIC_ANALYSIS.md` |
| Complete SBOM | **done** — CycloneDX 1.7 + SPDX 2.3, image and source | `SBOM_REPORT.md` |
| Rebuild and reinstall | **done** — `noesar-evolution:phase4-complete` | §6 below |

## 3. Test and check totals

```text
unit tests            444/444      (352 at the end of Phase 4, +92)
postgres integration   47/47       in-container, from an empty data directory
post-install checks    15/15       against the installed instance
multi-user live        29/29       four accounts, three roles, real logins
eslint                136 files    0 errors, 0 warnings, 0 no-undef
linter self-test        3/3        canaries detected
flake stress          270 runs     0 failures
installer hardening    48/48       unchanged from Phase 4
```

## 4. Findings

**14 new findings** (`F4C-001` … `F4C-014`), on top of the 13 Phase 4 raised.

| Severity | Raised | Closed | Open |
|---|---|---|---|
| high | 5 | 5 | 0 |
| medium | 5 | 5 | 0 |
| low | 2 | 2 | 0 |
| informational | 2 | 1 | 1 |

Across the whole register (27 rows): **21 closed, 5 open, 1 withdrawn**. Every open row is
`low` or `informational`. `NO_CRITICAL_FINDINGS` and `NO_HIGH_FINDINGS` therefore hold.

### The five that mattered

1. **The delivered migration set could never have been applied.** (`F4C-001`) Migration
   0012 reshapes a view with `CREATE OR REPLACE VIEW`, which can only *append* columns.
   It fails deterministically on every cluster. This is not an edge case — it is proof
   that the SQL had never been run, which is exactly what `B005=OPEN` had been saying since
   Phase 3.

2. **The log redactor was corrupting 6.75% of all UUIDs.** (`F4C-009`) The phone-number
   rule matches inside a canonical UUID — `…-2822-4650-…` is nine characters of digits and
   hyphens — and rewrote the middle of it. Every string in every log record passes through
   it, so roughly one record in fifteen carried a correlation id, incident id or session id
   that matched nothing. The correlation id is the feature Phase 3 added *specifically* so
   that a user-visible failure could be found in the log. **This was the "unreproduced
   flake" Phase 4 recorded**, which it had attributed to timing races in two unrelated
   files. It was not a timing race and it was not a test problem.

3. **A crashed database would never have been restarted.** (`F4C-002`) My own supervisor
   scheduled its restart on an `unref`'d timer, so with nothing else pending the process
   exited — with status 0, reporting success — instead of recovering. Caught because the
   integration exercise ended at `restart.scheduled` and claimed to pass.

4. **Accounts were being created that could never log in.** (`F4C-004`) `completeLogin()`
   decrypts the TOTP envelope unconditionally, an assumption that held while there was
   exactly one account. My invitation flow created ordinary users without one. Found by
   end-to-end testing against a live server; no unit test covered it, because every fixture
   bootstrapped an owner.

5. **The Phase 4 remediation reintroduced the defect class it was fixing.** (`F4C-006`)
   Commit `04878c4` renamed the call sites of `fetchOnceRetryingStaleSocket` in two
   unshipped copies of `provider-gateway.mjs` without adding the definition. ESLint found
   it on its first run — the exact class B-006 predicted would recur, found by the exact
   tool B-006 asked for.

### Two more worth naming

* **Audit appends were impossible.** (`F4C-003`) `noesar_audit.events` had RLS forced with
  a `SELECT`-only policy, so `appendAuditEvent()` could never have written a row.
* **A documented setup-token fingerprint that never matched.** (`F4C-014`) The Phase 4
  handoff tells the Owner to expect `af6f7ca93c31`; the installation has had
  `db1cf03ef221` since at least 12:20 on the day Phase 4 ran — its own container logged
  it. An Owner following the handoff would have seen a mismatch on the one action they
  have to perform.

### Defects in my own work, found and fixed

Stated separately because they should be: `F4C-002` (unref'd restart timer), `F4C-004`
(unloginable accounts), `F4C-005` (invitation token reusable during enrolment), `F4C-007`
(a blanket grant that silently undid an audit revoke), `F4C-011` (a placeholder my own
redaction fix introduced, forgeable from attacker text). Five of the fourteen. Four were
found by running the thing rather than by reading it.

Two mistakes in the *harness* are recorded in `FLAKE_STRESS_REPORT.md`: an invalid stress
run caused by editing source while it executed, and a second caused by two overlapping runs
writing to one directory. Both were diagnosed from the failure pattern rather than assumed,
and neither is counted as a product finding.

## 5. Static analysis and SBOM

ESLint 9.39.5 runs from a container pinned by digest, with the repository mounted
read-only; nothing was installed on this host. `no-undef` is an error everywhere, no
first-party directory is ignored, and a unit test enforces both. The detector is
self-tested against three canaries reproducing the real defect shapes — a clean scan proves
only that the scanner found nothing.

syft 1.49.0, also pinned by digest, produced CycloneDX 1.7 and SPDX 2.3 for both the image
and the source tree: 8 476 image components (333 OS packages, 199 npm, 7 942 hashed files),
10 207 SPDX relationships, 3 586 cargo entries in the source scan. The image is scanned as
a `docker save` tar, so the SBOM container never receives the Docker socket.

## 6. Build and installation

```text
image      noesar-evolution:phase4-complete   sha256:ec2ac8bd4551…
lineage    node:22-bookworm-slim@sha256:6c74791e…
             -> noesar-evolution:phase3   (preserved)
             -> noesar-evolution:phase4   (preserved)
             -> noesar-evolution:phase4-complete
container  noesar-evolution                   Up, healthy, RestartCount=0
port       127.0.0.1:8100 -> 8088             loopback only; LAN probe refused
network    noesar-evolution-net               unchanged
hardening  read-only rootfs, cap-drop ALL, no-new-privileges, uid 10001,
           pids-limit 512, memory 8g, cpus 4, tmpfs noexec, no Docker socket
rollback   noesar-evolution.rollback-phase4-20260725T142301Z   (image :phase4, Exited 0)
           noesar-evolution.rollback-phase3-20260725T121648Z   (image :phase3, Exited 0)
```

Post-install verification: startup, readiness, database, vector operators, RLS, migration
ledger, credential modes, backup, restore, and a real `docker restart` with clean
PostgreSQL shutdown (`clean: true`) and no data loss. 15/15.

### Nothing else on this host changed

`docker ps -a`, `network ls` and `volume ls` were captured before any mutation and diffed
afterwards. The only differences are the `noesar-evolution` container's image and the new
phase-4 rollback container. Networks and volumes are identical. The 37 unrelated containers
are untouched and still `Exited`.

## 7. The Owner bootstrap

`OWNER_BOOTSTRAP=AWAITING_OWNER_INTERACTION`. No credential was generated or chosen.

The installation binds to `127.0.0.1` on the Unraid host, so from another machine:

```bash
ssh -L 8100:127.0.0.1:8100 root@192.168.178.100
# then open http://127.0.0.1:8100 in a LOCAL browser
```

The one-time token is at
`/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/config/first-owner-setup.token` (mode `0600`, owner
`10001`). **Verify its fingerprint against the `setup-token.available` line in
`docker logs noesar-evolution`, not against any value written in a document** — see
`F4C-014`. It currently reads `db1cf03ef221`, and it rotates on expiry.

The full flow was rehearsed end to end on a probe installation built from this exact image:
setup token accepted, Owner created with MFA, token refused afterwards, admin and two users
invited, real password + TOTP logins. What remains is only the part that requires a person
to choose a password and keep a TOTP seed.

Phase 5 cannot declare the installation complete until the Owner confirms: account created,
TOTP active, one-time token invalidated, recovery material stored privately, and login and
step-up authentication working.

## 8. Blockers

| Id | State |
|---|---|
| **B-001** | open, unchanged — `gh` absent, no remote, `GIT_PUSH=BLOCKED_NO_REMOTE` |
| **B-002** | open, reduced — the heuristic secret scan is unchanged, but ESLint and syft now cover surfaces that previously had nothing |
| **B-005** | **CLOSED** — PostgreSQL 18.4 with pgvector 0.8.5 installed, migrated, exercised and running |
| **B-006** | **CLOSED** — ESLint 9.39.5 with `no-undef`, self-tested, wired into the suite and the pre-commit gate |

## 9. What was deliberately not done

* **No Owner account** on the installed instance. The gate forbids generating or choosing
  Owner credentials, and doing so would hand over an installation with a password someone
  else picked.
* **No real GPU inference test** — no model and no inference runtime exist on this host
  that this gate is permitted to use. The exact minimum needed is documented.
* **No Phase 5 work**: no release documentation, no licensing decisions, no ZIP packaging.
* **No push** — there is no remote.
* **No independent penetration test.** The same party wrote the implementation, the tests
  and this report. That was true of Phase 4 and remains true here.
* **No TLS**, no external provider contacted, no `noesar.com` connectivity. Every
  credential used in this gate was synthetic and generated at run time.

## 10. Residual risk

* `productionReady=true` is now what the **database** reports. It is not a statement that
  the product as a whole is production-ready: the Owner bootstrap is outstanding, there has
  been no penetration test, and no installation has yet carried real data.
* Per-user isolation is enforced by RLS and verified, but only against data seeded by the
  test suites. No production dataset has exercised it.
* The multi-user live acceptance ran on a probe installation, because running it on the
  real one would have created the Owner account this gate must not create.
* 270 stress runs is not proof of determinism; it is evidence that two specific,
  understood failure modes are gone.

---

## 11. Superseded by the LAN access gate (2026-07-25)

A later gate made the WebUI reachable from the local network. Three statements in this
report no longer describe the installation, and one number in it was wrong when written.

| This report says | Now |
|---|---|
| the installation is published on `127.0.0.1:8100` | `192.168.178.100:8100`; loopback no longer answers |
| the image is `noesar-evolution:phase4-complete` | `noesar-evolution:phase4-complete-lan`, an offline two-file overlay on it |
| the Owner reaches it through an SSH tunnel | the Owner opens `http://192.168.178.100:8100` directly |

**The image ID recorded for `phase4-complete` in `PROJECT_STATE.json` was stale**
(`F4L-002`). It named `sha256:ec2ac8bd…`, but the tag had already been moved to
`sha256:52987fbb…` a minute before the container was created, so the digest in the state
file was never the one the installation ran. Corrected.

Everything else in this report — the gate criteria, the 444 tests, the 14 findings, the
database, the multi-user work, the SBOMs — stands unchanged. The LAN gate added 11 unit
tests (455 total) and 52 installer checks (100 total), and raised seven findings of its
own. See `docs/PHASE_4_LAN_ACCESS_REPORT.md`.

`OWNER_BOOTSTRAP=AWAITING_OWNER_INTERACTION` is still true, and still the reason nothing
here may be called production-ready.
