# Phase 4 — Acceptance Plan

Real tests against the installed system. Every test states its **pass condition** and
its **evidence** — a test whose result cannot be shown is not a test.

Rules: no test may claim PASS without captured output; a test that cannot run is
`BLOCKED`, never silently skipped; tests that mutate state run against the installed
instance and are followed by the restore/rollback tests.

---

## A. Installation and lifecycle

| # | Test | Pass condition |
|---|---|---|
| A1 | Fresh install per `PHASE_3_EXECUTION_PLAN.md` | all 10 steps pass, no stop criterion hit |
| A2 | Container inspect | read-only rootfs, `cap-drop ALL`, `no-new-privileges`, pids/memory/cpu limits, publish bound to `127.0.0.1:8100` only |
| A3 | Non-root | process UID inside the container is `10001`, not 0 |
| A4 | Workspace persistence | data written, container restarted, data still present |
| A5 | Restart | `docker restart` → healthy within 60 s, no data loss |
| A6 | Reboot survival | after host reboot the container returns via `unless-stopped` |
| A7 | Uninstall | `INSTALLATION/uninstall-unraid.sh` removes container and network, **leaves the workspace intact** |
| A8 | Reinstall over existing name | aborts rather than clobbering |

## B. Service surface

| # | Test | Pass condition |
|---|---|---|
| B1 | `/healthz` | 200, `status: healthy` |
| B2 | `/livez` | 200 while the process is alive **even with the data plane degraded** (proves the liveness/readiness split) |
| B3 | `/readyz` | 200 when ready; non-200 in safe mode or with the data plane down |
| B4 | `/metrics` | Prometheus text format, parses, includes `noesar_up` and `noesar_build_info` |
| B5 | `/diagnostics` | owner-only; 403 unauthenticated; redacted content |
| B6 | WebUI | loads at `http://127.0.0.1:8100/`, assets 200, no console errors |
| B7 | API contract | the 39 declared `/api/v1/*` routes respond with their documented status codes |
| B8 | Not reachable off-host | the port is unreachable from the LAN address |

## C. Data and search

| # | Test | Pass condition |
|---|---|---|
| C1 | JSON data plane CRUD | conversations/projects/artifacts create, read, update, delete |
| C2 | Export / import | `/api/v1/data/export` → import into a clean instance reproduces state |
| C3 | Vector search | ingest documents, semantically related query returns them ranked |
| C4 | Retention / purge | purge removes content **and** its vectors |
| C5 | PostgreSQL + pgvector | **BLOCKED unless separately installed** — schema `0001–0007` applies, RLS active |

## D. Providers and chat

| # | Test | Pass condition |
|---|---|---|
| D1 | Default deny | with no credentials configured, **no external call is attempted** (verify by network capture, not by trust) |
| D2 | Local provider | if configured, chat completes end to end |
| D3 | External provider (mock) | with a **synthetic** key against a local mock, request/response works; the real vendor is never contacted |
| D4 | Streaming | `/api/v1/chat/stream` streams incrementally |
| D5 | Stop | cancelling a stream halts generation and releases the provider slot |
| D6 | Provider failure | unreachable provider degrades gracefully, no crash, error surfaced |

## E. Agents, tools, sandbox

| # | Test | Pass condition |
|---|---|---|
| E1 | Agent run | completes, is recorded, is auditable |
| E2 | Tool allowlist | an agent cannot invoke a tool outside its capability grant |
| E3 | Sandbox non-root | tool execution is non-root and cannot write outside its scope |
| E4 | Filesystem escape | `../` traversal in an artefact/upload path cannot escape `/workspace` |
| E5 | Resource limits | a runaway tool hits the pids/memory cap without taking down the host |
| E6 | Capability signature | an unsigned or tampered capability package is rejected |

## F. Security

| # | Test | Pass condition |
|---|---|---|
| F1 | Auth required | unauthenticated access to protected routes → 401 |
| F2 | RBAC | non-owner denied owner-only routes → 403 |
| F3 | MFA | login without TOTP rejected; with valid TOTP accepted; replayed code rejected |
| F4 | Brute force | repeated failures trigger lockout; lockout expires (`auth.mjs` sliding window) |
| F5 | Session | logout invalidates; sensitive ops require reauth |
| F6 | Setup token | single-use; a second setup attempt is rejected |
| F7 | Host header | request with a foreign `Host` rejected |
| F8 | CORS | cross-origin request outside the allowlist rejected |
| F9 | CSRF | forged cross-origin state-changing POST rejected |
| F10 | CSP / XSS | response carries CSP; a reflected-XSS probe does not execute |
| F11 | Stream origin | SSE from a disallowed origin rejected |
| F12 | SSRF | tool fetch to `169.254.169.254` and to RFC1918 addresses blocked |
| F13 | **Prompt injection (direct)** | an injected instruction in a user prompt does not escalate tool scope — **currently PARTIAL, expect findings** |
| F14 | **Prompt injection (indirect)** | a malicious instruction inside an ingested document does not trigger tool use — **currently PARTIAL** |
| F15 | Secret redaction | a known canary secret sent through the system never appears in logs or the diagnostic bundle |
| F16 | Credential vault | a stored provider key is not retrievable in plaintext via API or logs |
| F17 | **User/project isolation** | user A cannot read user B's project data via API **or** via vector search |
| F18 | Audit append-only | an audit record cannot be modified or deleted through the API |
| F19 | ZIP bomb | an oversized/nested archive is rejected without exhausting memory or disk |
| F20 | Uploaded file inert | an uploaded executable is never executed and is stored outside any exec path |
| F21 | **seccomp** | the container runs under Docker's builtin profile; a syscall outside its allowlist is denied |
| F22 | Red-team pass | a time-boxed adversarial session against E and F finds no unrecorded critical issue |

## G. Logging, debug, watchdog

| # | Test | Pass condition |
|---|---|---|
| G1 | Structured logs | every line valid JSON, UTC `Z` timestamps, level present |
| G2 | Correlation ID | one user action is traceable end to end across chat → provider → tool |
| G3 | Rotation and quota | logs rotate, compress, and respect the 2 GiB cap without touching audit |
| G4 | Audit separation | rotation never deletes audit history |
| G5 | Debug off by default | `/api/v1/debug/status` reports disabled on a fresh install |
| G6 | Debug TTL | enabling with `ttl_minutes=1` auto-expires; expiry is audited |
| G7 | Debug redaction | no secret appears in debug output |
| G8 | Diagnostic bundle | generates, is redacted, contains no conversation content |
| G9 | Watchdog escalation | an injected component failure escalates 0→1→2 in order, without skipping |
| G10 | Container restart (level 4) | a deliberate fatal exit is restarted by Docker and recovers |
| G11 | Crash-loop | ≥3 restarts in 10 min stops escalation and enters **safe mode**, not an infinite loop |
| G12 | Safe mode | providers/agents/tools disabled; WebUI and audit readable |
| G13 | Owner notification | escalation ≥3 notifies the owner |

## H. Update Manager

Runs **only against the implementation once it exists**; until then each is `BLOCKED`,
explicitly, not skipped.

| # | Test | Pass condition |
|---|---|---|
| H1 | Notify only | an available update is surfaced and **not** installed |
| H2 | Signed update applies | a correctly signed package stages, verifies, migrates, health-checks, promotes |
| H3 | Unsigned rejected | rejected before staging |
| H4 | Tampered payload rejected | hash mismatch → rejected |
| H5 | Stale metadata rejected | expired channel metadata → rejected |
| H6 | Wrong channel rejected | a `beta` artefact refused on `stable` |
| H7 | **Downgrade blocked** | an older version is refused by the anti-rollback check |
| H8 | Offline update | the same package applies with **no network at all**, using the same verification path |
| H9 | Failed-migration rollback | a deliberately failing migration triggers automatic rollback to `previous` |
| H10 | Failed-health rollback | a candidate that never becomes healthy is rolled back |
| H11 | Post-rollback integrity | data and audit intact after rollback |
| H12 | Update audit | every attempt recorded with versions, verification outcome and result |

## I. Backup, restore, rollback

| # | Test | Pass condition |
|---|---|---|
| I1 | Workspace backup | produces a verifiable, checksummed archive |
| I2 | Restore | restoring into a clean instance reproduces the working install |
| I3 | Container rollback | previous image tag restores a working install |
| I4 | Rollback after failed install | `ROLLBACK_AND_RECOVERY_PLAN.md` returns the host to its pre-install state |
| I5 | No collateral | no unrelated container, network, image, or dataset changed at any point |

## J. ATOM absence — closes the standing `[UNVERIFIED]`

| # | Test | Pass condition |
|---|---|---|
| J1 | Build without ATOM | the image builds with no ATOM component present |
| J2 | Start without ATOM | the container starts and serves |
| J3 | Tests without ATOM | the test suites pass with nothing proprietary present |
| J4 | Documented functionality | the core delivers what its documentation claims, unaided |
| J5 | No ATOM in tree | the pre-publication sweep finds no proprietary implementation, weights, corpora, or derived fixtures |

**J1–J4 passing is what converts `FOSS_CORE_DEPENDS_ON_ATOM=false` from a design claim
into a verified fact.** Until then it stays `[UNVERIFIED]`.

---

## Reporting

For each test: ID, command/steps, captured output, PASS / FAIL / BLOCKED, and for any
FAIL a severity and whether it blocks Phase 5. Results go to
`docs/PHASE_4_ACCEPTANCE_REPORT.md` with remediation tracked in the ledger.

**Expected failures at first run** — these are already known-weak and are the point of
testing, not a surprise: F13, F14 (prompt injection, `PARTIAL`), F10/F11 (`UNVERIFIED`),
F19/F20 (`UNVERIFIED`), and the whole of section H (not implemented).
