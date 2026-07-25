# Debug Mode

## Posture

| Property | Rule |
|---|---|
| Default | **off** |
| Who | **Owner only** — role `owner`, session required, CSRF token required |
| Scope | mandatory, explicit, from a fixed set |
| Duration | mandatory, maximum **60 minutes**, no indefinite mode exists |
| Expiry | automatic — enforced lazily on every check and actively by a 30-second sweep |
| Content | never secrets; payloads pass through the same sink redaction as every other log |
| Audit | activation, scope, duration and deactivation all recorded |

A debug switch left on becomes a permanent verbose-logging vulnerability, and on this
host — no swap, workspace sharing a filesystem with the data plane — it also becomes an
unbounded-disk problem. That is why the TTL is not optional and why expiry restores the
logger level rather than merely marking a flag.

## Scopes

`api` · `provider` · `rag` · `memory` · `agents` · `tools` · `mcp` · `workflow`

An unknown scope is refused by name. Only the selected scopes emit traces.

## API

```text
GET  /api/v1/debug/status     what is on, and when it expires
POST /api/v1/debug/enable     {"scopes":["provider","rag"],"ttlMinutes":30}
POST /api/v1/debug/disable
GET  /api/v1/debug/bundle     redacted support bundle
```

Observed live:

```text
POST /api/v1/debug/enable {"scopes":["provider","rag"],"ttlMinutes":5}
→ {"enabled":true,"scopes":["provider","rag"],"incidentId":"INC-379c674f-…",
   "expiresAt":"2026-07-25T07:44:32.161Z","remainingSeconds":300,"maxTtlMinutes":60}

POST /api/v1/debug/enable {"scopes":["everything"],…}  → "Unknown debug scope(s): everything."
POST /api/v1/debug/enable {"ttlMinutes":9999,…}        → "Debug mode cannot exceed 60 minutes."
```

## Incident id

Every activation mints `INC-<uuid>`. It appears on every trace record emitted during that
session and in the audit entries for enable and disable, so a support conversation can
refer to one identifier and the operator can retrieve exactly the right records with
`GET /api/v1/logs?q=INC-…`.

## Support bundle

`GET /api/v1/debug/bundle` (or `/diagnostics`) produces a single redacted object:
versions, host summary, timezone resolution, health snapshot, watchdog report, update
state, recent debug history and a log excerpt. It contains no secrets, no conversation
content, no documents and no credentials, and says so in its own header. It is generated
on demand and never sent anywhere automatically.

## What debug mode does not do

It does not disable authentication, does not widen tool scope, does not bypass safe mode,
and does not turn off redaction. There is no code path that can opt a trace out of the
sink redaction.
