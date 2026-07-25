# Phase 4 — logging, debug mode and watchdog test report

## Summary

| Area | Result |
|---|---|
| Structured logging | PASS — asserted by 22 unit tests plus live inspection of the running container |
| Log rotation, retention, compression, quota | PASS — unit tests, including the F-006 record-loss regression |
| Redaction at the sink | PASS — SEC-36 found a random canary in none of five locations |
| Audit hash chain | PASS — SEC-38: 152 records, 151/151 links verify |
| Debug mode owner-only, scoped, TTL-bounded | PASS — 14 unit tests plus live 401 for an unauthenticated caller |
| Watchdog ladder 0–5, backoff, no infinite loop | PASS — 20 unit tests |
| Crash loop → safe mode, live | PASS — REC-06, induced deterministically on a real container |
| Safe mode blocks mutation, keeps reads | PASS — REC-07 |
| Return to normal | PASS — REC-09 |
| Owner notification at escalation ≥3 | PASS — unit test |

## Logging, live

The running container's log is one JSON object per line, UTC with a `Z` suffix, carrying a
correlation id that is also returned to the client as `x-request-id` / `x-correlation-id`:

```json
{"ts":"2026-07-25T11:35:36.620Z","level":"ERROR","event":"http.request.failed",
 "component":"control-plane","correlation_id":"44d8d6cb-…",
 "http":{"method":"GET","path":"/api/v1/providers/…/health","status":500},
 "error":"providerId is not defined"}
```

That line is worth keeping in this report: it is how F4-005 was found. The logging subsystem
did its job — it recorded the exact reason a request failed, and the reason turned out to be
a real defect in another module.

Redaction happens **at the sink**, not at the call sites, which is why a new call site
cannot forget it. The design choice is Phase 3's; Phase 4 tested its consequence with a
per-run random canary (SEC-36) rather than with a fixed string that a previous run could
have left behind.

One observed detail, not a defect: the sink redacts things that look like IPv4 addresses and
phone numbers, and it will redact a UUID fragment that matches the phone pattern — a
correlation id appeared in one captured line as `84e3009d-7cc7-[REDACTED_PHONE]-11452f465c86`.
Over-redaction of an identifier is the safe direction, and the startup line already
compensates deliberately: it reports `bind_scope: single-interface` instead of the literal
address, precisely because the sink would otherwise turn the useful part into
`[REDACTED_IP]`.

## Debug mode

Unauthenticated `GET /api/v1/debug/status` and `/api/v1/debug/bundle` both answer **401**
(SEC-08). The remaining properties — owner-only, mandatory scope, TTL capped at 60 minutes,
auto-expiry that also restores the log level, incident id, redacted bundle, audit on
activation and deactivation — are covered by `debug-mode.test.mjs` and were re-run as part
of the 351-test suite. The diagnostic bundle was also searched for the canary and for
conversation content: neither is present.

## Watchdog: what was injected, and what happened

The full ladder (levels 0–5, one level at a time, never above a subject's declared maximum,
threshold before escalation, exponential backoff with jitter and a cap, retry only for
idempotent operations, checkpoint written before any escalation ≥3, owner notification) is
asserted by 20 unit tests with a controlled clock. Fault injection against a real container
covered what unit tests cannot show:

**Crash loop → safe mode (REC-06).** Three restart entries inside the ten-minute window were
written into `state/watchdog.json` and the container restarted:

```text
/livez  200        the process is alive, so Docker must not kill it
/readyz 503        {"ready":false,"status":"not-ready","reasons":["safe-mode"]}
```

The liveness/readiness split is the point. A container whose `HEALTHCHECK` used `/readyz`
would be killed and restarted forever by the very condition safe mode exists to stop; the
Dockerfile uses `/livez` and carries a comment explaining why.

Getting this test right took two attempts, and the first failure is instructive: the fixture
wrote `restarts` as an array of plain timestamps, but the real schema stores objects
(`{at, atUtc, reason}`). `now - entry.at` was `NaN`, the crash-loop filter silently dropped
every entry, and safe mode never engaged — a fixture that tested nothing while appearing to
test something.

**Safe mode behaviour (REC-07).** Mutations refused, reads available, `/healthz` still
answering. The gate is structural, placed ahead of the route table in `server.mjs`, so a
newly added mutating route cannot forget it.

**Leaving safe mode (REC-08).** Owner-only: unauthenticated
`POST /api/v1/watchdog/safe-mode/leave` → 401. Rollback stays available in safe mode by
design, because that is how an operator gets out.

**Return to normal (REC-09).** Clearing the restart history and restarting returns
`/readyz` to 200 with no reasons, and the workspace marker survived all five restarts
(REC-10).

## Process-level failure containment, added in this phase

`server.mjs` had no `unhandledRejection` or `uncaughtException` handler, which is half of why
F4-004 was fatal. Both now exist, with deliberately different policies:

- `unhandledRejection` — logged as an ERROR with a truncated stack, and the process keeps
  serving. A rejection reaching that point is a defect and is reported as one, but a
  self-hosted single-process product should not die because one request threw.
- `uncaughtException` — logged, then `process.exit(1)`. State may be inconsistent, so the
  supervisor restarts it, and the crash-loop detector and safe mode can see it.

This is a last resort, not a substitute for handling errors where they happen: the actual fix
for F4-004 was to await the call and validate before writing headers.
