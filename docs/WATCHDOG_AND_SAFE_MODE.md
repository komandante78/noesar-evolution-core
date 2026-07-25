# Watchdog and Safe Mode

## Shape

The watchdog is **internal**. There is no second container, and there will not be one:
this runtime is a single process, so the honest recovery of last resort is to exit with a
non-zero code and let Docker's `unless-stopped` policy restart it.

That is exactly why crash-loop detection matters. Restarting forever against a corrupt
data plane destroys more than it repairs, so past a threshold the watchdog stops
escalating and enters safe mode, which preserves the evidence and keeps documents
readable.

## Monitored subjects

17 subjects, each declaring a probe, an interval, a failure threshold, whether it is
essential for readiness, and the **maximum recovery level it may trigger**.

| Subject | Essential | Max level | Note |
|---|---|---|---|
| `control-plane` | yes | 4 | the process itself |
| `storage` | yes | 4 | write-and-remove probe under `/workspace/state` |
| `data-plane` | yes | 3 | reference-json store readable |
| `audit` | yes | 0 | ledger readable; never auto-restarted |
| `disk` | yes | 0 | free bytes; fails below 64 MiB |
| `webui` | yes | 0 | static root present |
| `logging` | no | 2 | bytes, archives, quota |
| `providers` | no | 2 | local configuration only — probing a provider would be egress, and external providers are default-deny |
| `agent-runner`, `tool-runner` | no | 2 | **not** retry-eligible: a step may have side effects |
| `scheduler` | no | 2 | |
| `update-manager` | no | 0 | |
| `cpu`, `memory` | no | 0 | |
| `gpu` | no | 0 | present on the host, deliberately not allocated |
| `authority-daemon` | no | 0 | not deployed in this installation; reported as absent, not failing |
| `code` | no | 0 | host mutation disabled |

## Recovery ladder

| Level | Action |
|---|---|
| 0 | observe — record only |
| 1 | retry — **idempotent operations only** |
| 2 | restart the internal component |
| 3 | restart the runtime in process |
| 4 | exit non-zero and let Docker restart the container |
| 5 | safe mode |

Escalation moves **one level at a time**, never skipping, never above the subject's
declared maximum. A subject that recovers resets to level 0.

Level 1 is skipped, with a `WARN`, when the subject declares itself non-idempotent:
re-running a mutation is worse than failing.

## Backoff

Exponential with jitter: 5 s base, doubling, capped at 5 minutes, multiplied by a random
factor in `[0.5, 1.0]`. Verified monotonic and capped by test.

## Crash-loop detection

- **Threshold:** 3 container restarts within 10 minutes.
- Restart requests are persisted to `/workspace/state/watchdog.json`, so the pattern
  survives the restart that caused it.
- On boot, a persisted crash loop puts the process **straight into safe mode** instead of
  trying again.
- Entries older than the window are discarded, so an old restart cannot poison a healthy
  installation.

## Checkpoints

Before any escalation at level 3 or above, the watchdog writes a checkpoint — current
health of every subject, the last error, the level — to `watchdog.json`. Anything at or
above level 3 loses in-memory context, so the post-mortem is written down **before** the
action, not after it.

## Owner notification

Every escalation at level 3 or above, every entry into safe mode, and every crash loop
raises a notification, recorded in the audit ledger as `owner.notification`. A
notification sink that throws cannot break recovery — verified by test.

## Safe mode

| Available | Refused |
|---|---|
| reading documents | any write |
| reading audit history | provider calls |
| `/livez`, `/readyz`, `/healthz`, `/diagnostics`, `/metrics` | agent runs |
| login, logout, reauthentication | tool execution |
| debug enable/disable | applying an update |
| **update rollback** — that is how you get out | |

The gate is **structural**: it sits ahead of the route table, so a new mutating route
cannot forget it. Any non-`GET/HEAD/OPTIONS` request outside a short allowlist is refused
with 503 and an explicit statement of what remains readable.

Login is deliberately on the allowlist: an operator must never be locked out of the
system they need to repair.

`/readyz` reports 503 with `reasons: ["safe-mode"]` while `/livez` stays 200 — the process
is alive, it is simply not serving. `noesar_safe_mode` goes to 1 in metrics.

Leaving safe mode is an explicit Owner action:
`POST /api/v1/watchdog/safe-mode/leave`. It clears the restart history and resets every
subject.

## Proven live

On a disposable probe container, a watchdog state file carrying three restarts inside the
window was injected and the container restarted. Observed:

```text
/healthz  status=safe-mode  safeMode=true  reason="crash loop detected: 3 restarts within 10 minutes"
/livez    200
/readyz   503  reasons=["safe-mode"]
POST /api/v1/projects → 503 "NOESAR is in safe mode; providers, agents, tools and state changes are disabled."
metrics   noesar_safe_mode 1
POST /api/v1/watchdog/safe-mode/leave → active:false, then /healthz status=healthy
```

## Endpoints

```text
GET  /api/v1/watchdog                    full report — owner only
POST /api/v1/watchdog/run                force one probe pass — owner only
POST /api/v1/watchdog/safe-mode/leave    owner only
```

`/healthz` carries a component summary for every subject and is unauthenticated by design,
because it is the operations contract; it exposes no secret, no prompt and no document.
