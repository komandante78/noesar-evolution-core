# Logging Schema

## Record shape

One JSON object per line, on stdout (captured by Docker) and in a rotated file under
`/workspace/logs/`.

```json
{"ts":"2026-07-25T07:36:56.126Z","level":"INFO","event":"http.request",
 "component":"control-plane","correlation_id":"432a36b4-5310-4d6d-b7eb-1ec584932216",
 "http":{"method":"GET","path":"/livez","status":200,"ms":2}}
```

| Field | Meaning |
|---|---|
| `ts` | **always UTC with an explicit `Z`**, millisecond precision |
| `level` | `TRACE DEBUG INFO WARN ERROR FATAL`; default `INFO` |
| `event` | stable dotted identifier, e.g. `http.request`, `watchdog.escalation` |
| `component` | emitting subsystem — `control-plane`, `watchdog`, `auth`, `timezone`, `debug` |
| `correlation_id` | one per inbound request, also returned as the `x-correlation-id` response header |
| `project_id` `conversation_id` `task_id` | present when the work belongs to one |
| `incident_id` `debug_scope` | present on debug traces |

Messages are English. UI localisation is a separate layer and never reaches a log.

## Correlation

Every request gets a UUID, returned to the client in `x-correlation-id`. A user who
reports a failure can quote that value and the operator finds the exact request with
`GET /api/v1/logs?correlationId=…`. Verified end to end by test.

## Redaction — at the sink, not at call sites

Redaction runs on the logger's **write path**, so a new call site cannot forget it.

| Rule | Behaviour |
|---|---|
| secret-bearing key names (`password`, `secret`, `token`, `cookie`, `authorization`, `api_key`, `credential`, `private_key`, `session_id`, `csrf`, `totp`, `signature`, …) | value replaced with `[REDACTED]` |
| content key names (`prompt`, `content`, `messages`, `document`, `text`, `body`, `payload`, `completion`, `answer`, `excerpt`) | value replaced with `[OMITTED_CONTENT]` — redaction cannot make a prompt safe, only absence can |
| any string value | passed through the product's shared privacy rules: bearer tokens, API-key shapes, e-mail, payment numbers, phone numbers, IPv4 |
| numbers | left intact — so a 13-digit epoch is not mistaken for a payment number |
| depth / size | 6 levels, 64 array items, 4 096 characters per string |

Consequence worth knowing: an IPv4 literal in a string becomes `[REDACTED_IP]`. The
runtime therefore logs its bind *scope* (`all-interfaces`) rather than the address, so
the startup line stays useful.

## Operational logs are not the audit ledger

| | Operational log | Audit ledger |
|---|---|---|
| Location | `/workspace/logs/` + stdout | `/workspace/audit/events.jsonl` |
| Purpose | debugging, performance | who did what |
| Mutability | rotated, dropped under quota | append-only, SHA-256 hash chained |
| Retention | bounded by size and count | never dropped by rotation |

This is structural: the logger **throws** if its directory path contains an `audit`
segment, so rotation can never be pointed at audit history.

## Rotation, retention, compression, quota

| Setting | Default | Environment variable |
|---|---|---|
| Rotate above | 64 MiB, or on a UTC day change | `NOESAR_LOG_MAX_FILE_BYTES` |
| Keep | 14 archives | `NOESAR_LOG_KEEP_FILES` |
| Compress | gzip on rotation | — |
| Directory quota | 2 GiB, oldest dropped first with a `WARN` | `NOESAR_LOG_QUOTA_BYTES` |
| Minimum level | `INFO` | `NOESAR_LOG_LEVEL` |

Archives are named `noesar-<ISO-timestamp>-<4-digit sequence>.log.gz`. The sequence is
not decoration: without it two rotations in the same millisecond produced the same
filename and the second **overwrote** the first, losing records. That defect was found
and fixed in Phase 3 and is now covered by a test that writes N records under a frozen
clock and asserts all N are still recoverable.

The quota matters on this host specifically: there is no swap and the workspace shares a
filesystem with the data plane, so unbounded logs are a real availability risk.

## Search

```text
GET /api/v1/logs?level=&component=&correlationId=&event=&q=&since=&until=&limit=
```

Owner-only. Newest first, reads compressed archives as well as the active file, capped at
1 000 entries.

## Diagnostic bundle

`GET /diagnostics` and `GET /api/v1/debug/bundle` return a redacted bundle: versions,
host summary, timezone state, health, watchdog history, update state and a log excerpt.
It declares its own posture — `redaction: "on"` and an explicit
`contains: { secrets:false, conversationContent:false, documents:false, prompts:false,
credentials:false, userIdentifiers:false }` — and is never uploaded anywhere.
