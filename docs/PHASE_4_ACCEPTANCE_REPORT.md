# Phase 4 — End-to-end acceptance report

| Field | Value |
|---|---|
| Phase | 4 — end-to-end acceptance, remediation, security and rollback |
| Status | `COMPLETED` |
| Date (UTC) | 2026-07-25 |
| Installed image | `noesar-evolution:phase4` (`sha256:1cf0ada84d2b46abfeb1f4a4826108adf1cfb9d18af4590024671038eac05973`) |
| Rollback preserved | `noesar-evolution.rollback-phase3-20260725T121648Z` on `noesar-evolution:phase3` |
| Acceptance checks | **136 — 132 PASS, 3 PARTIAL, 1 BLOCKED, 0 FAIL** |
| Unit tests | **351 / 351** (317 delivered baseline + 34 added) |
| Findings raised | 13 — 3 high, 3 medium, 3 low, 3 informational, 1 withdrawn |
| Findings closed | 9 (every high and medium) |
| Findings open | 4, all low or informational, each recorded with its reasoning |
| `NEXT_PHASE` | `5_READY` |

Evidence: `docs/ACCEPTANCE_RESULTS.tsv` (136 rows), `docs/OPEN_FINDINGS.tsv`,
`docs/REMEDIATION_LOG.md`, and the per-area reports listed at the end. Raw captured output
is under `$ARTIFACT_ROOT/phase4_evidence/`.

---

## 1. How the acceptance was driven

Three harnesses, because no single one can prove everything:

- **Host process.** The server run directly under Node 22 on throwaway workspaces
  (ports 8111–8117). Fast, isolated, and where the functional, auth and injection suites ran.
- **Container.** A hardened probe (`noesar-evolution-probe4`, port 8101) with the
  installation's own flags, and later the installation itself. This is the only place where a
  read-only rootfs, an empty capability set, a `noexec` tmpfs and real file extractors exist.
  The security suite was re-run here, which is what closed the PDF-injection check.
- **Unit suite.** 351 tests, the durable half of the evidence: everything a future change
  could regress lives here rather than in a shell transcript.

A local mock provider (`tools/acceptance/mock-provider.mjs`) speaks all three wire styles the
product implements plus MCP-over-HTTP, with switches for slow, failing, hostile and echoing
behaviour. **No real vendor was ever contacted**, and no real credential exists anywhere in
this phase: every secret is generated at run time and thrown away.

---

## 2. Owner bootstrap

The **real installation deliberately still has no Owner account.** Username, password and
TOTP are the Owner's interactive choice, and the installation is loopback-only, so it cannot
be reached from a browser on another machine. Fabricating credentials on the Owner's behalf
would defeat the point of an interactive bootstrap.

What *was* proven, end to end, on throwaway instances — **27 / 27 AUTH checks**:

setup refused without a token, with a wrong token, and with a weak password; TOTP enrolment
returning a secret and an `otpauth://` URI; confirmation refused on a wrong code and on a
wrong challenge; the owner created with `mfaEnabled: true` and a session cookie that is
`HttpOnly; SameSite=Strict`; the setup token **single-use** (a second attempt → 409);
password-only login returning `mfaRequired` with **no** session cookie issued; MFA refused on
a wrong code; **a replayed code refused** (F4-002, fixed in this phase); the login challenge
single-use; lockout and a 429 sliding-window limiter; a correct password still refused during
lockout; a critical action refused without recent strong reauthentication; step-up refused on
wrong credentials and succeeding on correct ones, then unlocking the action; logout
invalidating the session; and a stolen cookie useless afterwards.

**Passkey / WebAuthn does not exist.** The matrix says `MISSING`, not `PARTIAL`.

### What the Owner needs to do

The port is bound to `127.0.0.1` on the Unraid host, so from another machine:

```bash
ssh -L 8100:127.0.0.1:8100 root@192.168.178.100
```

then open `http://127.0.0.1:8100` in a **local** browser. Read the one-time token from
`/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/config/first-owner-setup.token` (mode 0600, owner
10001) and follow `docs/OWNER_BOOTSTRAP.md`. Choose the password yourself; store the TOTP
seed and recovery material in a password manager. Nothing about those values should reach
this repository, a log, or a chat transcript.

---

## 3. Functional acceptance — 35 / 35

**Chat and context.** Ask/Create/Act modes; conversation creation with an active branch;
messages appended and read back in order; **editing by supersession** (a `PATCH` produces a
new message carrying `supersedesId`, the original is never overwritten); per-branch exclusion
that the context inspector reflects (`tokenEstimate` 19 → 12); token/context inspection
exposing project, memories, sources, tools, provider, model and estimate; regeneration as a
new alternative; **fork, compare, merge and undo** across branches; real incremental
streaming (**9 SSE frames**, up from the 2 that were all the pre-fix code could ever
produce); stop releasing the run (`{"stopped":true}`); a provider failure surfaced as an
`event: error` frame without killing the service; persistence across a fresh read of the
store.

**Projects and memory.** Two projects created independently; memory at **global, project and
conversation** scope; project-scoped memory invisible from the other project; edit, delete
and export; retention set and applied.

**Search and RAG.** Hybrid retrieval returning the right passage with a citation
(`sourceId` + source name + passage text + lexical and semantic sub-scores); full-context
retrieval; **cross-project isolation proven with a canary** — a random marker in project B's
document appears in *no* project A result, and no foreign `sourceId` is returned; a purged
document is 404 and its vectors are gone from every subsequent search.

**Files.** Text, HTML, CSV, JSON, PDF (`pdftotext`), Office (`unzip` + XML), ZIP, image OCR
(`tesseract`) and media metadata (`ffprobe`) — all six extractors confirmed present *in the
container*, and honestly reported as absent on the host, which is why the file and injection
checks were re-run in-container.

**Artifacts.** All five declared types (document, code, table, chart, canvas) create; an
update produces a **new version** and keeps the previous one (`versions`,
`currentVersionId`, count 2); export excludes credentials (`credentialsIncluded: false`) and
import reproduces projects and conversations.

**Providers.** Three external providers present and **disabled by default with no consent
granted**; an external URL cannot be pointed at loopback, metadata, RFC1918, plain HTTP, and
cannot be reclassified as internal; a local provider configurable and reporting health;
streaming; stop; graceful failure; two-provider comparison; a credential never returned in
plaintext by the API, the export, or on disk; revocation effective.

---

## 4. Agents, tools and MCP

An agent run is planned, its steps recorded, and a **mutative step is refused before
approval** (403) and executes only after an explicit approval. MCP over HTTP works against
the mock; **MCP stdio refuses any executable outside `NOESAR_MCP_ALLOWED_EXECUTABLES`**,
which is empty in this deployment — `/bin/sh` → 403. Tool scope is an intersection of grants;
a disabled tool named by both the request and an ingested document is not advertised at all.

One structural fact deserves emphasis, because it is the main reason the injection risk is
low today and the main thing that changes if it is ever altered: **the chat orchestrator has
no tool-call loop.** Tool schemas are advertised to the provider, but a `tool_calls` field in
a reply is never parsed and never executed. Agent tool execution is a separate, explicitly
driven API. No agent has any path to the Docker socket — it is not in the container at all.

---

## 5. Security

Detail in `docs/SECURITY_TEST_REPORT.md`, `docs/PROMPT_INJECTION_TEST_REPORT.md` and
`docs/SANDBOX_TEST_REPORT.md`. Headline results:

- **Web/API — 13/13.** Host-header rejection (421), all seven security headers, a CSP with no
  `unsafe-inline`, no CORS grant ever emitted, CSRF enforced, no HTML reflection, no error
  disclosure, no traversal, rate limiting.
- **SSRF — 10/10 hostile endpoints refused at registration.** Egress proven by a *pair* of
  tests: consent refused before any connection, and consent granted reaching the network and
  failing on DNS — so the gate, not a lack of capability, is what stops it.
- **Files — 9/9.** Traversal filenames sanitised, null bytes handled, a 1300-entry archive
  refused, a 200 MiB compression bomb capped at the extraction limit with the service alive,
  uploaded executables inert, hostile SVG never served as an image, archive symlinks yielding
  nothing.
- **Secrets and audit — 4/4.** A per-run random canary leaked into **none** of five
  locations. Audit is append-only through the API and genuinely hash-chained: **151/151 links
  verify** across 152 records.
- **Prompt injection — 0 bypasses.** Untrusted text never reaches the `system` role; it is
  fenced with a data-not-instruction preamble; the fence cannot be closed from inside; scope
  is never widened by content; detections are audited with signals. Verified across text,
  HTML, CSV, JSON and PDF, plus **10 committed regression tests**.
- **Sandbox — 20/20.** uid 10001, `CapEff: 0000000000000000`, `NoNewPrivs: 1`,
  `Seccomp: 2` under **Docker's builtin profile** (no override), read-only rootfs, `noexec`
  tmpfs proven by a failed execution, no Docker socket, exactly one mount, kernel-enforced
  `pids.max=512` proven by a refused fork storm, loopback-only reachability.

---

## 6. Data plane, GPU, ATOM

- **PostgreSQL / pgvector: `B005=OPEN`.** Not installed, not active, and **not substituted
  with SQLite** — the runtime *fails closed* rather than pretending. Schemas, 12 migrations,
  pgvector and RLS all ship; none was executed. This blocks production promotion, not Phase 5.
  See `docs/DATABASE_ACCEPTANCE.md`.
- **GPU: `GPU_RUNTIME=NOT_IMPLEMENTED`.** Every GPU reference is inventory and planning; there
  is no inference backend of any kind. No GPU was allocated. `nvidia-smi` being visible proves
  the host has a GPU, not that this product can use one. See `docs/GPU_ACCEPTANCE.md`.
- **ATOM absent: `FOSS_CORE_DEPENDS_ON_ATOM=false`, now VERIFIED.** Zero ATOM references in
  everything the image ships; 351/351 tests and the whole acceptance matrix pass with nothing
  proprietary present. The public contract and boundary documentation remain, as intended.
  See `docs/ATOM_ABSENT_ACCEPTANCE.md`.

---

## 7. Findings

Full register with root cause, evidence, fix and regression test per finding:
`docs/OPEN_FINDINGS.tsv`. Chronology: `docs/REMEDIATION_LOG.md`.

| ID | Sev | Summary | Status |
|---|---|---|---|
| F4-004 | high | one malformed chat request **terminated the whole service** | CLOSED |
| F4-006 | high | **streaming chat never worked at all** (ReferenceError on every delta) | CLOSED |
| F4-002 | high | a TOTP code could be **replayed** within the 90-second window | CLOSED |
| F4-005 | medium | a *reachable* provider reported its health check as 500 | CLOSED |
| F4-008 | medium | two security-matrix rows described behaviour the code does not have | CLOSED |
| F4-009 | medium | a stale pooled connection surfaced as an unexplained transport error | CLOSED |
| F4-007 | low | `fetch` failures reported as the single word "fetch failed" | CLOSED |
| F4-001 | info | the analysis container modified its own ephemeral layer | CLOSED (wording corrected) |
| F4-003 | — | withdrawn: a misdiagnosis, recorded rather than quietly dropped | WITHDRAWN |
| F4-010 | low | URL validation checks the hostname, not the resolved address | OPEN, accepted |
| F4-011 | low | extraction routed by declared MIME, no content sniffing | OPEN, accepted |
| F4-012 | info | the 48 MiB ingestion limit is unreachable through the API | OPEN, recorded |
| F4-013 | info | a full workspace backup is unencrypted and holds the master key | OPEN, for Phase 5 docs |

Three of these deserve a note on *why* they survived delivery and Phase 3.

**F4-006 and F4-005 are the same defect twice**: an object-literal shorthand naming an
identifier that does not exist in scope. `node --check` cannot see it — it is valid syntax —
and every delivered test exercised the *failure* path of those functions (unreachable
provider, missing consent, disabled profile), so the offending lines had never executed. The
fix for the class was not a homegrown analyser. One was written, and **rejected**: a
file-scoped version missed both real defects and produced 25 false positives; a scope-aware
version caught both but still produced ~16 false positives per file, and a checker whose
output must be ignored trains the reader to skip it. It is preserved with that reasoning in
`$ARTIFACT_ROOT/phase4_evidence/rejected-tooling/`. What was shipped instead is
success-path coverage of every public `ProviderGateway` method (9 tests), the process-level
guards that turn this class from an outage into a logged error, and **B-006** recording that
the correct tool is a linter with `no-undef`, which rule 45 forbids installing.

**F4-009 began as a suspected test flake.** The first hypothesis — a stale socket after an
idle pause — was tested with an 8-second-idle probe and **refuted**. Only after adding cause
reporting (F4-007) did the real signature appear, `UND_ERR_SOCKET other side closed`, and the
fix turned two failing checks into passes. Had it been dismissed as flakiness, a real
intermittent failure of the product's primary feature would have shipped.

---

## 8. Test-harness defects found and fixed

Recorded because a wrong test is a real risk, not a footnote:

- The crash-loop fixture wrote `restarts` as plain timestamps; the schema stores objects, so
  `now - entry.at` was `NaN`, every entry was dropped and **safe mode never engaged while the
  test appeared to run**.
- The fork-pressure probe used `sleep 0.05`, so processes exited as fast as they spawned and
  never reached the pids cap — a test that passed without testing.
- Once corrected, that probe held pids-cgroup slots and made **eight later checks fail to
  fork**, reported as false negatives. Moving it last fixed it; a drain timer had not.
- Injection fixtures initially shared a project with a 46 MiB upload, so full-context
  retrieval buried the payload under 46 MiB of `0x41`.
- The RAG-based injection fixtures first used a query unrelated to the payload, so hybrid
  retrieval never returned it: the test measured retrieval relevance, not containment.
- Several early assertions were simply wrong about the API (`content` vs `message`,
  `branchId` required for exclusion, the export bundle nested under `data`), and each was
  corrected against the code rather than by loosening the assertion.
- After F4-002, three suites needed rewriting because they reused one TOTP code — including
  **two delivered unit tests** whose fixtures had encoded the vulnerable behaviour. The
  acceptance suite now *waits for the authenticator to roll over*, since fabricating a future
  code walks outside the ±1-step window.
- Phase 3's own seccomp regression guard **fired on this phase's sandbox script**, because an
  evidence string put `seccomp=` next to the profile filename. The script was reworded; the
  guard was left untouched.

---

## 8b. One unreproduced test flake, recorded

On one run of the full suite, 1 of 352 tests failed. The output was not captured before the
next run overwrote it, and the suite then passed **14 consecutive times** — 8 full runs and 6
targeted runs of the two most timing-sensitive files (`totp-replay`,
`provider-gateway-success-paths`).

So the suite is reported as **352/352 with one observed, unreproduced flake**, not as
deterministic. The likeliest candidates are the two tests that depend on real time rather than
a controlled clock: the TOTP "older code from within the window" case, which sits on a 30-second
step boundary and is already guarded against the exact-boundary race, and the stale-connection
retry test, which races a server configured with `keepAliveTimeout = 1`. Both would fail
*closed* — a spurious failure, never a spurious pass — so the risk this carries is a confusing
CI run, not a missed defect.

Recorded rather than dismissed: a flake nobody writes down is a flake nobody fixes. If it
recurs, capture the failing name first; both candidates can be made deterministic by injecting
a clock, which the watchdog tests already do.

## 9. Nothing else on this host was changed

`docker ps -a`, `docker network ls` and `docker volume ls` were captured before any mutation
and diffed at the end. Only the two intended differences:

```text
> noesar-evolution                                    Up       noesar-evolution:phase4
> noesar-evolution.rollback-phase3-20260725T121648Z   Exited   noesar-evolution:phase3
networks   IDENTICAL
volumes    IDENTICAL
```

The 37 other containers are untouched. `noesar-debuglab` was started for HUNT AND FIX and
**stopped again in the same phase**; its only writable host mount was re-hashed and is
byte-identical, and its writable layer was 77 files before and after. Its earlier Phase 3
deviation is F4-001.

Static analysis over the whole first-party surface: **0 findings** in `services/`,
`ai-workspace/`, `oci/`, `INSTALLATION/`, `deployment/`; `apps/` and `tools/` carry only
findings triaged as false positives with recorded evidence (see `docs/REMEDIATION_LOG.md` §4).

---

## 10. Acceptance criteria

```text
OWNER_BOOTSTRAP=PASS            27/27, flow proven end to end; the real installation is
                                deliberately un-bootstrapped pending the Owner's own choice
WEBUI_API=PASS                  WebUI served with CSP; API routes answer their documented codes
CORE_CHAT_WORKSPACE=PASS        35/35
PROJECT_ISOLATION=PASS          per project, canary-verified, including vector search
MEMORY_RAG=PASS                 three scopes, citations, purge removes vectors
FILES=PASS                      6 extractors, limits and quarantine-equivalent inertness
AGENTS_TOOLS=PASS               approval gates, allowlists, MCP HTTP and stdio
AUTH_RBAC_MFA=PASS              27/27 including replayed-code rejection
PROMPT_INJECTION=PASS           0 bypasses, 10 committed regression tests
WEB_API_SECURITY=PASS           13/13
SANDBOX=PASS                    20/20
LOGGING_DEBUG_WATCHDOG=PASS     safe mode induced and exited live
UPDATE_MANAGER=PASS             37 unit tests with test keys; owner-only and notify-only live
BACKUP_RESTORE=PASS             25/25 byte-identical restore, checksummed
RESTART_RECOVERY=PASS           13 live checks, no data loss across five restarts
ATOM_ABSENT_CORE=PASS           [UNVERIFIED] closed
NO_CRITICAL_FINDINGS=true
NO_HIGH_FINDINGS=true           all three high findings fixed with regression tests
```

Honest classification of the two named exceptions:

- **PostgreSQL / pgvector — `B005=OPEN`.** Mandatory for *production promotion*, which the
  product itself reports as `productionReady=false`. Phase 5 is documentation, licensing,
  release and packaging, so this does not block it.
- **GPU — `GPU_RUNTIME=NOT_IMPLEMENTED`.** Not a product requirement that exists to be met:
  there is no GPU workload to validate.

```text
NEXT_PHASE=5_READY
```

---

## 11. Residual risk

1. **Multi-user is not supported by this build.** Per-project isolation is verified; per-user
   isolation is neither implemented nor reachable in the reference data plane, and RLS lives
   only in the uninstalled Postgres schema. Adding user management before resolving this
   would expose every project to every authenticated user (F4-008).
2. **No TLS.** Loopback-only, so `NOESAR_SECURE_COOKIES=false` follows. Any exposure beyond
   loopback needs TLS first, and the Owner-bootstrap route needs an SSH tunnel until then.
3. **DNS rebinding is undefended** (F4-010), reachable only by an owner or admin.
4. **No independent penetration test.** The same party wrote the fixes and the tests.
5. **No SBOM**, only a declared-PARTIAL inventory (`docs/SBOM_STATUS.md`).
6. **Secret scanning on this host stays heuristic** (B-002), corroborated by `detect-secrets`
   and `semgrep` reporting zero.
7. **Backups are unencrypted and contain the master key** (F4-013) — an operator duty that
   Phase 5 must document.
8. **`--memory-swap` has no effect**: the kernel lacks swap accounting. The host has zero
   swap, so the intended outcome holds anyway.
9. **The Phase 4 image is an overlay on Phase 3**, so it inherits that apt layer. Deliberate:
   rebuilding from `oci/Dockerfile` needs network and would re-resolve the package set
   Phase 3 recorded. Phase 5 packaging should rebuild with a recorded network step.

## Companion reports

`docs/ACCEPTANCE_RESULTS.tsv` · `docs/OPEN_FINDINGS.tsv` · `docs/REMEDIATION_LOG.md` ·
`docs/SECURITY_TEST_REPORT.md` · `docs/PROMPT_INJECTION_TEST_REPORT.md` ·
`docs/SANDBOX_TEST_REPORT.md` · `docs/LOGGING_DEBUG_WATCHDOG_TEST_REPORT.md` ·
`docs/UPDATE_MANAGER_TEST_REPORT.md` · `docs/BACKUP_RESTORE_TEST_REPORT.md` ·
`docs/DATABASE_ACCEPTANCE.md` · `docs/GPU_ACCEPTANCE.md` ·
`docs/ATOM_ABSENT_ACCEPTANCE.md` · `docs/SBOM_STATUS.md` ·
`docs/SECURITY_IMPLEMENTATION_MATRIX.tsv`
