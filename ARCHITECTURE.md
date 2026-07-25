# Architecture — CANONICAL_CANDIDATE_V1 (V0.6.0 base + V0.5.0 consolidated material)

```text
Node reference control plane
  -> signed Authority Protocol V1.1 envelope
  -> private Unix-domain socket
  -> length-prefixed canonical JSON
  -> Rust authority daemon source candidate
      -> Linux SO_PEERCRED UID/PID validation
      -> HMAC envelope verification and anti-replay
      -> request/response binding
      -> productionReady=false until compiled evidence exists

PostgreSQL 18 source line
  -> twelve ordered migrations (database/postgres/)
  -> transaction-local actor/workspace/project context
  -> append-only audit and migration ledgers
  -> per-workspace audit hash-chain serialization
  -> append-only production-attestation ledger
  -> seven-domain production gate
  -> repository productionReady=false until live evidence exists
  -> historical baselines retained alongside (v0.3.0 legacy, v0.4.0/v0.5.0
     baselines) and enforced-preserved by tools/verify-postgres-migrations.py

Capability layer (consolidated from 03_CAPABILITIES_V0_5_0)
  -> capabilities/reference/  Python capability manager, broker, execution
     ticket + production-evidence verification (noesar_capabilities package)
  -> capabilities/sandbox/    WASI sandbox profile + execution contract
  -> capabilities/security/   permission catalog, trust-level and license
     policy, role-action matrix, sandbox profiles
  -> packages/sdk/            canonical capability SDK: TypeScript client
     (merged from the fuller V0.5.0 implementation) + Python client
  -> schemas/                 all capability + product JSON Schemas, merged
     into one canonical location (18 capability schemas + product schemas;
     3 name collisions resolved in favor of the newer product schema, older
     versions preserved under evidence/history/v0.5.0/schemas/)

Deployment and operations layer (consolidated from 02_RUNTIME_V0_5_0,
05_OPERATIONS_V0_5_0)
  -> deployment/  docker, podman, linux, macos, windows, unraid,
     reverse-proxy, production env template
  -> operations/runtime/  backup/restore, OCI export/import, support bundle,
     production-readiness compiler, postgres apply/verify scripts
  -> UPDATED (BUILD_PREPARATION_V1): oci/Dockerfile, oci/Containerfile,
     deployment/linux/install-portable.sh, deployment/linux/noesar-evolution.service,
     deployment/macos/install-portable.sh and deployment/windows/Install-Noesar.ps1
     were corrected to copy/launch the real payload
     (services/reference-control-plane/ + apps/webui-static/, entry point
     services/reference-control-plane/src/server.mjs) instead of the
     nonexistent `runtime/noesar/` nested layout. Still BLOCKED (missing
     source, not fabricated): the runtime-bin/entrypoint.sh wrapper's exact
     original behavior (now bypassed via a direct node ENTRYPOINT, matching
     the existing scripts/run-reference.sh and Start-Noesar.ps1 pattern),
     runtime-bin/runtime-preflight.mjs (removed from Start-Noesar.ps1, no
     equivalent exists), and security/seccomp-noesar.json is now included in the complete delivery. Its
     target-kernel compatibility is verified during installation.

Evidence and historical material
  -> evidence/history/v0.5.0/   security acceptance, red-team, findings,
     release-controller tooling and schema/SDK versions superseded during
     consolidation
  -> evidence/history/master-packaging/  master-project packaging lineage
```

## Professional AI workspace — Ask, Create, Act

The user-facing product is organized around Ask, Create and Act rather than a
single undifferentiated prompt box. The implementation resides in
`services/reference-control-plane/src/ai-workspace/` and is exposed through the
static responsive WebUI in `apps/webui-static/`.

### Versioned context graph

Conversations are directed acyclic graphs. Message edits and regenerations
create new nodes; branches can be forked, compared, merged, excluded from active
context and undone. A context inspector exposes the selected model/provider,
project, branch, messages, sources, memories, tools and estimated token load.

### Project workspace and data model

The atomic workspace store groups conversations, files, knowledge chunks,
memories, artifacts, agents, tools and scheduled tasks by project. Memory scopes
are global, project or conversation. Export/import, purge and retention operate
on related graph entities and exclude encrypted credentials.

### Retrieval and sources

The knowledge layer supports hybrid lexical/vector-like deterministic search,
configurable retrieval, full-context mode, source passage previews and explicit
citation status. A retrieved passage is evidence presented to the model, not an
independent verification of the model's claim.

### Provider-neutral inference

`ProviderGateway` supports local OpenAI-compatible endpoints plus optional
OpenAI Responses, Anthropic Messages, Moonshot/Kimi OpenAI-compatible and custom
OpenAI-compatible providers. External providers are disabled by default and
require explicit project/data-class consent. Credentials are encrypted at rest;
outbound data can be redacted; external URLs are HTTPS/SSRF validated. Routing,
fallback, health probes, streaming and parallel comparison are implemented.

### Tools and agents

Tools may use bounded local HTTP, OpenAPI HTTP, MCP HTTP JSON-RPC or allowlisted
MCP stdio. Mutative agent steps require explicit approval. The execution record
retains plan, status, intermediate output, approval and result without exposing
stored credentials.

### Files and multimodality

Bounded ingestion covers text, code, datasets, PDF, Office/OpenDocument, ZIP,
images/OCR and audio/video metadata. The WebUI supports file upload, microphone,
camera and display capture. Speech transcription requires a configured local
transcriber or explicitly approved provider.
