# NOESAR Evolution V4 — Complete Product Source

This directory is the canonical implementation delivered as Package 1 of the
five-archive NOESAR EVOLUTION V4 product set. It is not a preview, draft,
skeleton or mock package.

The product now includes a professional AI workspace organized around three
operating modes:

- **Ask** — research, source-grounded answers and controlled retrieval;
- **Create** — editable documents, code, tables, charts, canvases and apps;
- **Act** — agents, tools, approvals, scheduled tasks and auditable execution.

The conversation model is a versioned context graph rather than an immutable
message list. Projects share conversations, files, instructions, memories,
agents, tools and activities. Users can fork, edit, regenerate, exclude, merge,
compare and undo context changes.

Model access is provider-neutral. Local OpenAI-compatible servers remain the
default. External OpenAI/ChatGPT, Anthropic/Claude, Moonshot/Kimi and custom
OpenAI-compatible APIs are optional, disabled by default, credential-encrypted,
consent-scoped and subject to outbound redaction and SSRF protections.

The source includes the WebUI, AI workspace control plane, Rust authority
workspace with locked offline vendor, PostgreSQL migrations and repository
adapter, capability framework, SDKs, deployment assets, security policy,
operations tooling, tests, schemas, SBOM material and documentation.

## Verification status

- Node test suite: **129/129 PASS**
- source verification: **PASS**
- authenticated HTTP smoke: **PASS**
- JavaScript/ESM syntax: **59 files PASS**
- JSON parsing: **85 files PASS**
- shell syntax: **33 files PASS**
- temporary server startup, health and static WebUI smoke: **PASS**
- Rust locked offline tests/release build and authority round-trip: **PASS**

The implementation is complete for packaging. Installation and acceptance on
the owner's Unraid server are the next operation; target-specific defects may
be remediated there without redefining the functional scope.
