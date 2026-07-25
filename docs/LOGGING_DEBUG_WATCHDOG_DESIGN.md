# Logging, Debug and Watchdog Design

What exists today, and what has to be built. Verified against the source, not assumed.

---

## 1. What exists

| Capability | State | Evidence |
|---|---|---|
| Secret redaction | **IMPLEMENTED** | `ai-workspace/privacy-redaction.mjs`, wired into `provider-gateway.mjs` |
| Audit records | **PARTIAL** | `src/data-plane.mjs`, `/api/v1/audit`; PostgreSQL `0004_audit_ledger.sql`; `noesar-audit-ledger` Rust crate |
| Audit hash chain | **PARTIAL** | designed in `docs/AUDIT_HASH_CHAIN_V060.md`; implemented in the Rust crate, which is **not in the Node image** |
| `/healthz` | **IMPLEMENTED** | `server.mjs:147` |
| `/livez` `/readyz` `/metrics` `/diagnostics` | **MISSING** | no route matches any of them |
| Structured JSON logging | **MISSING** | no logger module; no correlation ID |
| Log rotation / retention | **MISSING** | — |
| Debug mode | **MISSING** | — |
| Watchdog | **MISSING** | named only in `MASTER_REFERENCE/02_ARCHITECTURE/20_TARGET_ARCHITECTURE.md` |
| Internal supervisor | **NOT PRESENT** (by design) | single-process `ENTRYPOINT`; Docker `--restart unless-stopped` is the supervisor |

So: redaction and audit are real; **observability is largely greenfield**.

---

## 2. Logging

### Format

One JSON object per line, on stdout (Docker captures it), plus a rotated file in
`/workspace/logs/` for the WebUI viewer.

```json
{"ts":"2026-07-25T06:05:31.412Z","level":"INFO","event":"http.request",
 "correlation_id":"01J...","actor":"owner","component":"control-plane",
 "msg":"request completed","http":{"method":"POST","path":"/api/v1/chat/stream","status":200,"ms":142}}
```

Rules:
- `ts` is **always UTC with `Z`** (see `docs/TIMEZONE_AND_LOCALIZATION_DESIGN.md` §2);
- levels `TRACE DEBUG INFO WARN ERROR FATAL`; default `INFO`, `TRACE`/`DEBUG` only under debug mode;
- **`correlation_id`** generated per inbound request and propagated through chat,
  provider calls, agent runs, tool executions and workflow steps, so one user action is
  reconstructable end to end;
- messages are English (project rule), user-facing localisation is separate.

### Operational logs vs audit — separate by construction

| | Operational log | Audit ledger |
|---|---|---|
| Purpose | debugging, performance | who did what, security-relevant |
| Mutability | rotated, expirable | **append-only, tamper-evident** |
| Retention | size/time bounded | retained; never dropped by rotation |
| Store | `/workspace/logs/` + stdout | data plane / `noesar-audit-ledger` |

Rotation must never be able to delete audit history. They are different stores, not
different levels of the same store.

### Redaction — mandatory, at the sink

`privacy-redaction.mjs` runs on the **write path of the logger**, not at call sites, so
a new call site cannot forget it. Redacted: credentials, tokens, cookies,
`Authorization` headers, provider keys, prompt and document content by default.
`redaction: "on"` is asserted in the diagnostic bundle header.

### Rotation, compression, retention, quota

| Setting | Default |
|---|---|
| Rotate at | 64 MiB or daily |
| Keep | 14 files |
| Compress | gzip on rotation |
| Hard quota | 2 GiB for `/workspace/logs/`; oldest dropped first, with a WARN |

A quota matters here specifically: the host has **no swap** and the workspace shares a
filesystem with the data plane, so unbounded logs are a real availability risk.

### WebUI search and diagnostic bundle

Owner-only log view with filters (time range, level, component, `correlation_id`,
free text). **Diagnostic bundle**: a redacted, single-file export — versions, host
capability summary, recent logs, health snapshots, watchdog history, update history —
with **no secrets, no conversation content, no documents**. Generated on demand,
never uploaded automatically.

---

## 3. Debug mode

| Property | Rule |
|---|---|
| Default | **off** |
| Who | **owner only** |
| Scope | explicit subsystem selection — API, provider, RAG, memory, agents, tools, MCP, workflow |
| Duration | **time-boxed**, max 60 min, auto-expiring; no indefinite mode |
| Content | never secrets; payloads truncated and redacted |
| Audit | activation, scope, duration, deactivation all recorded |

```text
POST /api/v1/debug/enable    {scopes:[...], ttl_minutes:30}   owner-only, audited
POST /api/v1/debug/disable
GET  /api/v1/debug/status     what is on, and when it expires
GET  /api/v1/debug/bundle     redacted support bundle
```

Auto-expiry is the point: a debug switch left on becomes a permanent verbose-logging
vulnerability, and on this host that also means unbounded disk growth.

---

## 4. Watchdog

### Monitored subjects

control plane · WebUI · authority · scheduler · agents and tools · database /
data plane · vector store · queues · CPU · RAM · disk · GPU · providers · logging
subsystem · update manager.

Each declares: a probe, an interval, a failure threshold, and the **maximum recovery
level** it is allowed to trigger.

### Recovery ladder

| Level | Action | Notes |
|---|---|---|
| 0 | observe | record only |
| 1 | retry | idempotent operations only |
| 2 | restart internal component | e.g. re-open the provider pool |
| 3 | restart runtime | in-process restart of the service |
| 4 | request container restart | exit with a non-zero code; Docker `unless-stopped` restarts |
| 5 | **safe mode** | start with providers, agents and tools disabled; WebUI and audit read-only |

Escalation is one level at a time, on repeated failure, never skipping.

Level 4 is how a single-process container recovers: the process exits deliberately and
Docker restarts it. That is the correct design here precisely **because** there is no
internal supervisor.

### Crash-loop detection and backoff

- **Crash loop**: ≥3 restarts within 10 minutes.
- **Backoff**: exponential, 5 s → 5 min cap, with jitter.
- On crash loop, **stop escalating and enter safe mode (level 5)** rather than
  restarting forever — a restart loop against a corrupt data plane destroys more than
  it fixes.
- **Checkpoint** before each escalation ≥3: current health, last errors, versions —
  so the post-mortem survives the restart.
- **Owner notification** on any escalation ≥3, on entering safe mode, and on crash loop.
- **After a failed update**: watchdog failure at level ≥4 within the post-update window
  triggers the Update Manager rollback (`docs/UPDATE_MANAGER_DESIGN.md` §3 step 10).

### Endpoints

| Endpoint | Semantics | Status |
|---|---|---|
| `/livez` | process alive; **no dependency checks**; never fails on a slow database | **to build** |
| `/readyz` | ready to serve — data plane reachable, config loaded, not in safe mode | **to build** |
| `/healthz` | detailed component status | **exists**, extend with component detail |
| `/diagnostics` | owner-only structured snapshot, redacted | **to build** |
| `/metrics` | Prometheus text format | **to build** |

The `/livez` vs `/readyz` split is the part that matters operationally: the container
`HEALTHCHECK` should use `/livez` (restart only a genuinely dead process) while a proxy
or the watchdog uses `/readyz` (stop routing traffic to an unready instance). Today
both roles collapse onto `/healthz`, so a transient dependency failure could restart a
perfectly alive process.

### Suggested metrics

`noesar_up`, `noesar_build_info`, `noesar_http_requests_total{route,status}`,
`noesar_http_request_duration_seconds`, `noesar_provider_calls_total{provider,outcome}`,
`noesar_agent_runs_total{outcome}`, `noesar_watchdog_escalations_total{level}`,
`noesar_safe_mode`, `noesar_data_plane_up`, `noesar_log_bytes`, `noesar_update_state`.

---

## 5. Phase placement

| Work | Phase |
|---|---|
| Structured logger + correlation ID + rotation/quota | 3 |
| `/livez`, `/readyz`, `/metrics`, `/diagnostics` | 3 |
| Debug mode with TTL | 3 |
| Watchdog levels 0–4 | 3 |
| Safe mode (level 5) | 3 |
| Audit hash chain in the Node data plane | 3 or later — the Rust crate already implements it |
| Acceptance for all of the above | 4 |

**None of this blocks installation.** `/healthz` plus the container `HEALTHCHECK` and
`--restart unless-stopped` are sufficient to install and verify in Phase 3. The gap is
recorded as work, not as a blocker.
