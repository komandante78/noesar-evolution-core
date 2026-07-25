# Phase 3 — Implementation and Installation Report

**Result:** `PHASE_3 = COMPLETED` · `NEXT_PHASE = 4_READY`
**Date (UTC):** 2026-07-25
**Scope:** implement the runtime subsystems Phase 2 designed, repair what was broken,
build one candidate image, and install it on this Unraid host in isolation.

Everything below is what was actually observed. Where something was not verified it is
labelled `[UNVERIFIED]`.

---

## 1. Summary

| | |
|---|---|
| Implemented | timezone/locale, health endpoints, metrics, structured logging, debug mode, watchdog + safe mode, local update manager, setup-token handling, prompt-injection containment |
| Tests | **317 / 317** pass (`node --test`), from 137 at the start of the phase |
| Extra regressions | installer hardening **48/48**, packaging filters **12/12** (Python half unverifiable on this host), vendor Rust **113 crates / 5 094 files / 0 corrupt / 0 missing** |
| Image | `noesar-evolution:phase3`, `sha256:24dfc492…` |
| Base image | `node:22-bookworm-slim@sha256:6c74791e…` (authorised pull) |
| Installed | container `noesar-evolution`, `127.0.0.1:8100 → 8088`, network `noesar-evolution-net` |
| Health | `/livez` 200 · `/readyz` ready · `/healthz` healthy, 17 components, 0 degraded |
| Restart + persistence | PASS, `RestartCount=0`, no crash loop |
| Other containers | **unchanged** — 37 pre-existing containers still `Exited`, no image, network or volume of any other system touched |
| Repository manifest | `MANIFEST.sha256` **5 630 / 5 630 OK** |

---

## 2. Defects found and repaired in this phase

The phase cycle requires that defects are repaired, not filed. Nine were found; eight
were fixed here and one is recorded as out of scope.

### D1 — Log rotation silently destroyed logs (`logging.mjs`)
Two rotations inside the same millisecond produced the same archive filename and the
second overwrote the first. Found by a test asserting that every written record stays
recoverable: 41 records written, 27 recoverable.
**Fix:** every archive carries a zero-padded sequence suffix in a fixed shape, so
lexicographic order stays chronological, and an existing archive is never overwritten.
**Evidence:** `rotation never overwrites an archive, even within the same millisecond` —
60 records written under a frozen clock, 60 recovered.

### D2 — `Logger.child()` threw on every call
`Object.create(this)` produces an object that is not an instance of the class, so the
private write method was unreachable (`Receiver must be an instance of class Logger`).
**Fix:** explicit delegation via `BoundLogger`.

### D3 — Three delivered installers weakened the container sandbox
`INSTALLATION/install-unraid.sh`, `deployment/unraid/install-complete.sh` and
`deployment/docker/run.sh` all passed
`--security-opt seccomp=…/seccomp-noesar.json`. That profile is
`defaultAction: SCMP_ACT_ALLOW` with a 24-syscall denylist; passing it **replaces**
Docker's builtin deny-by-default allowlist and therefore weakens the sandbox — on a host
with neither AppArmor nor SELinux, where seccomp is the only MAC layer.
Phase 2 recorded the decision not to pass it (D-0024) but only for the manual `docker run`;
it did not notice that the shipped installers do pass it.
**Fix:** the flag is removed from all three, the profile is marked
`x-noesar-status: NOT_FOR_USE` in its own body, and
`tools/test-installer-hardening.mjs` fails the build if it ever returns.

### D4 — Two installers published the WebUI to the whole LAN
Both Unraid installers used `--publish "${PORT}:8088"` with no bind address, which Docker
resolves to `0.0.0.0`. The security matrix claimed "port not reachable from LAN".
**Fix:** `BIND_ADDRESS="${NOESAR_BIND_ADDRESS:-127.0.0.1}"`, used in the publish and in
the printed URL. Verified live: a request to `192.168.178.100:8100` is refused while
`127.0.0.1:8100` answers.

### D5 — All three installers fail on Docker 29
`--mount "type=bind,…,dst=/workspace,rw"` is rejected:
`invalid field 'rw' must be a key=value pair`. Found by running the real installers.
**Fix:** `readonly=false`, plus a regression check.

### D6 — Retrieved document text was injected into the `system` message
`chat-orchestrator.mjs` concatenated retrieved source passages into the system prompt.
Third-party document content therefore occupied the highest-trust position available —
the textbook indirect prompt-injection vector, and the reason the security matrix's
`PARTIAL` claim (pointing at `workspace-service.mjs`) was not supported by any code.
**Fix:** `ai-workspace/untrusted-content.mjs` — retrieved passages move to their own
non-system message, fenced, behind an explicit "this is data, not instruction" policy;
fence markers are stripped from the content so a document cannot close the fence; tool
scope is an intersection of granted and requested, never a union; detections are written
to the audit ledger. Ingestion marks every source `trust: "untrusted"` and records its
scan result.
**Deliberately not claimed:** detection is a signal, not a gate. Containment is
structural. A heuristic that can be evaded must not be what stands between a document and
a tool call.

### D7 — The documented bootstrap token file was never implemented
`oci/Dockerfile` sets `NOESAR_SETUP_TOKEN_FILE=/workspace/config/first-owner-setup.token`
and both the Phase 3 plan and the security matrix describe reading the token from it —
but no code read that variable. The only way to bootstrap was
`NOESAR_SETUP_TOKEN` as an environment variable, which is visible in `docker inspect`
and `/proc/<pid>/environ`.
**Fix:** `src/setup-token.mjs` generates a 32-byte CSPRNG token on first run, writes it
`0600`, repairs the mode if it drifts, rotates it after a TTL, and never logs it —
only a 12-hex fingerprint. Verified live: the file is `0600 10001:10001`, its
fingerprint matches the startup log, and only the *path* appears in the container
environment.

### D8 — The installer's `TZ` was silently ignored
On first boot the runtime reported `timezone=Etc/UTC, source_tier=3` despite
`TZ=Europe/Berlin`. Inside a container `/etc/localtime` describes the **image**, not the
host, so tier 3 shadowed the operator's explicit setting with an image default.
**Fix:** when `/.dockerenv` is present, tier 3 is unavailable unless the host zoneinfo
was deliberately exposed via `NOESAR_HOST_LOCALTIME`. Verified live: now
`timezone=Europe/Berlin, source_tier=4 (installer-tz)`, offset `+120` in July.

### D9 — Self-inflicted, caught before commit
The first attempt at D3 put the explanatory comment **inside** the `docker run`
backslash continuation. That is syntactically valid — `bash -n` passes — and silently
truncates the command, discarding every flag after it including all the hardening.
Caught by running the installers against a stub `docker`. This is why
`tools/test-installer-hardening.mjs` exists and asserts that the image argument still
arrives.

### Recorded, not fixed
`tools/verify-package.py` imports `sys` without using it (ruff `F401`). Pre-existing,
cosmetic, no test can express it. Recorded for Phase 5.

---

## 3. Findings dismissed, with the evidence

| Finding | Why it is not a defect |
|---|---|
| `SC1007` on `ROOT=$(CDPATH= cd -- …)` | `CDPATH=` is a deliberate empty assignment scoped to `cd`, the correct idiom |
| semgrep `insecure-file-permissions`: "0o700 is widely permissive, use 0o644" | `0o644` is world-readable and therefore *less* restrictive; the advice is inverted |
| bandit/ruff `B603 B607 S603 S607` in `tools/*.py` | fixed literal argv, repo-local paths from `rglob`, no external input; build tooling |
| semgrep `insecure-object-assign` in `apps/webui-static/app.js` | mis-anchored snippet on a single-line file; the code spreads internally built header objects, no user-controlled keys, no redirect |

`semgrep` and `detect-secrets` reported **0 findings** across `services/`, `ai-workspace/`,
`capabilities/`, `oci/`, `deployment/unraid/` and the new tests.
A clean scan proves the scanner found nothing, not that the code is correct — which is
why D3–D9 were found by reading, by running, and by writing tests, not by scanning.

---

## 4. What was implemented

| Subsystem | Module | Tests |
|---|---|---|
| Structured logging | `src/logging.mjs` | 18 |
| Timezone and locale | `src/timezone.mjs` | 29 |
| Health, readiness, diagnostics | `src/observability.mjs` | 16 (HTTP) |
| Metrics | `src/metrics.mjs` | covered by HTTP + watchdog tests |
| Debug mode | `src/debug-mode.mjs` | 15 |
| Watchdog and safe mode | `src/watchdog.mjs` | 27 |
| Update manager | `src/update-manager.mjs` | 37 |
| Bootstrap token | `src/setup-token.mjs` | 11 |
| Prompt-injection containment | `src/ai-workspace/untrusted-content.mjs` | 27 (security) |

Detail in `LOGGING_SCHEMA.md`, `DEBUG_MODE_GUIDE.md`, `WATCHDOG_AND_SAFE_MODE.md`,
`UPDATE_MANAGER_IMPLEMENTATION.md`, `TIMEZONE_AND_LOCALIZATION_IMPLEMENTATION.md`,
`OWNER_BOOTSTRAP.md`.

---

## 5. Live verification (§11 of the phase specification)

| Check | Result |
|---|---|
| container running | `running`, health `healthy` |
| `/livez` | 200 |
| `/readyz` | 200, `ready`, no reasons |
| `/healthz` | 200, `healthy`, 17 components, 0 degraded |
| WebUI HTTP | 200 |
| API basic | `/api/v1/auth/status` 200 |
| startup logs redacted | yes — secret-bearing keys `[REDACTED]`, content `[OMITTED_CONTENT]` |
| audit initialised | yes — refused setup attempts appended and hash-chained |
| runtime writable only in allowed volumes | write to `/opt/noesar` and `/etc` refused; `/workspace` allowed |
| root filesystem read-only | `ReadonlyRootfs=true` |
| container user | `10001:10001`, confirmed from inside |
| capabilities | `CapDrop=[ALL]`, `CapAdd=[]` |
| no Docker socket | 0 socket mounts |
| port only on 127.0.0.1:8100 | binding `127.0.0.1:8100`; LAN probe to `192.168.178.100:8100` refused |
| dedicated network | `noesar-evolution-net` only |
| restart policy | `unless-stopped` |
| timezone detected | `Europe/Berlin`, tier 4 (installer) |
| safe mode available | proven live (§6) |
| watchdog active | 17 subjects, no essential failures |
| tmpfs hardened | `/tmp` and `/run` `rw,nosuid,nodev,noexec`; exec from `/tmp` denied |

**Controlled restart:** `docker restart noesar-evolution` → healthy within seconds,
`RestartCount=0`, no crash loop, workspace state and setup token unchanged, log appended
not truncated, timezone still `Europe/Berlin`.

---

## 6. Bootstrap and safe mode, proven without creating the Owner's credentials

The product requires the Owner to choose a username, a password and to enrol TOTP. Those
are interactive choices, so **no definitive Owner account was created on the real
installation** — as the phase specification requires.

What was verified on the real installation:
- the token file exists, is `0600`, owned by `10001:10001`, and its fingerprint matches
  the startup log;
- setup **without** a token is refused; setup with a **wrong** token is refused; both
  refusals are written to the audit ledger;
- only the token *path*, never its value, appears in the container environment.

The full first-run flow was then proven in a **disposable probe container** on a throwaway
workspace (port 8101), so the real installation stayed pristine:
- setup with the file-provided token succeeds and returns a TOTP enrolment secret;
- confirmation issues an `HttpOnly; SameSite=Strict` session cookie;
- a **second** setup attempt is refused — `NOESAR is already initialized` (single use);
- login without TOTP does not issue a session; a wrong TOTP is refused; a correct one
  logs in as `owner` with `mfaEnabled=true`;
- all owner-only routes answer 200 with a session and 401 without one.

**Safe mode and crash-loop detection were proven live** on the same probe: a watchdog
state file carrying three restarts inside the ten-minute window was injected, the
container restarted, and it came up in safe mode — `/livez` 200, `/readyz` 503
(`reasons: ["safe-mode"]`), a `POST` refused with 503 and an explicit list of what stays
readable, `noesar_safe_mode 1` in metrics, and the Owner able to leave safe mode.
The probe container was removed afterwards; its audit evidence is preserved in the
backup directory.

---

## 7. Honest limits

1. **`--memory-swap=8g` was not applied.** The kernel reports
   `Your kernel does not support swap limit capabilities`, and
   `/sys/fs/cgroup/memory.swap.max` reads `max`. The host has **zero swap**
   (`swap_total_bytes=0`), so the practical outcome is the intended one — memory capped
   at 8 GiB with no swap to spill into — but the flag itself did not take effect. Stated
   rather than claimed.
2. **The packaging-filter regression is PARTIAL.** `python3` is absent from this host, so
   only the 12 `.gitignore` cases ran; the Python filter half is `[UNVERIFIED]` here. It
   was verified in Phase 1 inside a container that had Python.
3. **`FOSS_CORE_DEPENDS_ON_ATOM=false` is still `[UNVERIFIED]` at runtime.** It holds at
   source level and the container runs with no ATOM implementation present, but the
   ATOM-absent acceptance run is Phase 4.
4. **Prompt-injection containment is structural, not proven complete.** The detector has
   nine signals and is deliberately advisory. Adversarial evaluation is Phase 4.
5. **PostgreSQL/pgvector, the Rust authority daemon, GPU allocation, external providers,
   TLS and any `noesar.com` connectivity were not installed** — all out of scope by the
   phase specification.
6. **The GPU is present but not allocated.** Reported as `allocated: false` with the host
   accelerator count; enabling it is Phase 4.
7. **`noesar-debuglab` was started and stopped** during the HUNT AND FIX step, as the one
   named exception in the operating authority permits. It is `Exited (0)` again and the
   host is back to exactly one running container.
