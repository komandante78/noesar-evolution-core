# NOESAR Evolution AI Workspace — P0 implementation

## Product model

NOESAR is organized around three explicit operating modes:

- **ASK** — answer with retrieved evidence, visible uncertainty and source passages;
- **CREATE** — produce editable, versioned artifacts;
- **ACT** — plan tool actions, expose intermediate steps and require approval before mutations.

The chat is not stored as an immutable list. `ContextGraph` stores messages as a directed acyclic graph with parent references, branch heads, exclusions, revisions, regenerations and merge nodes. Each project owns instructions, sources, memories, tools, agents, tasks and a configurable knowledge policy.

## Runtime modules

| Module | Responsibility |
|---|---|
| `atomic-store.mjs` | atomic versioned workspace state |
| `context-graph.mjs` | projects, conversations, message DAG, fork/merge/edit/undo |
| `workspace-service.mjs` | memory, artifacts, sources, hybrid search, tasks, export/import/purge/retention |
| `file-extractors.mjs` | secure binary storage and extraction for text, PDF, Office, images, ZIP and media metadata |
| `provider-gateway.mjs` | local/remote models, consent, routing, fallback, comparison, streaming and stop |
| `privacy-redaction.mjs` | explicit outbound anonymization/redaction |
| `chat-orchestrator.mjs` | Ask/Create/Act prompt assembly, RAG passages, citations and SSE lifecycle |
| `agent-service.mjs` | visible plans, approvals, intermediate outputs and run state |
| `tool-executor.mjs` | local HTTP, OpenAPI, MCP HTTP and allowlisted MCP stdio execution |
| `credential-vault.mjs` | AES-256-GCM persistent credentials and process-only ephemeral credentials |

## Knowledge policies

Each project selects one of:

- `hybrid`: lexical plus deterministic vector-feature retrieval with a passage limit;
- `full-context`: ordered source passages up to a configurable character budget;
- `disabled`: no knowledge source is added to model context.

Retrieved passages are labeled `[source:<sourceId>#<passage>]`. The UI distinguishes retrieval evidence from independent claim verification.

## Reliability rules

- SSE generation exposes run ID, provider chosen, deltas, completion, stop and explicit errors.
- Automatic routing supports ordered providers and configured fallback providers.
- Parallel model comparison returns individual status and latency, including partial failures.
- Provider and tool failures are never converted into silent success.
- External requests are default-deny and audited without logging prompt content or credentials.
