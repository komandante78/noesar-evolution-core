# NOESAR EVOLUTION

A self-hosted AI workspace: chat, documents, coding agents and automation, running on
infrastructure the operator controls — any PC, server or OS, not a specific vendor or host.
The product is organized around three operating modes:

- **Ask** — research, source-grounded answers and controlled retrieval;
- **Create** — editable documents, code, tables, charts, canvases and apps;
- **Act** — agents, tools, approvals, scheduled tasks and auditable execution.

**[See `FEATURES.md` for the full list of what is built](FEATURES.md)** — chat and multimodal
input, documents and a code agent (CodeN Evolution), tools and agents, knowledge and memory,
capability-token security, and self-hosted installation with update and rollback.

The conversation model is a versioned context graph rather than an immutable message list.
Projects share conversations, files, instructions, memories, agents, tools and activities.
Model access is provider-neutral: local OpenAI-compatible servers by default; external
providers (OpenAI, Anthropic, Moonshot/Kimi, or a custom OpenAI-compatible endpoint) are
opt-in, disabled by default, credential-encrypted and consent-scoped.

The repository includes the WebUI, the AI workspace control plane, a Rust authority
workspace (capability tokens, sandboxing, the reasoning-provider contract), PostgreSQL
migrations and a repository adapter, SDKs, deployment assets, security policy, operations
tooling, tests, schemas, SBOM material and documentation.

## Status

Actively developed. `docs/SESSION_HANDOFF.md` states exactly what is done, what is in
progress and what is open, as of the most recent session — read that file for the current
picture rather than a number frozen at README-authoring time.

Representative counts, each reproducible from this repository:

- JavaScript/Node unit suite: `node --test services/reference-control-plane/test/*.test.mjs packages/*/test/*.test.mjs`
- Rust workspace: `cargo test --workspace --offline` (offline, vendored dependencies, no network)
- Static verification, linting and packaging checks: `scripts/test.sh`

## Architecture and governance

- `ARCHITECTURE.md` — system design.
- `SECURITY.md` — security posture and reporting.
- `docs/DECISION_LOG.md` — every non-trivial decision, with its evidence.
- `MASTER_PROJECT/` — the design documents this rewrite is built from.

## License

`AGPL-3.0-or-later` is the proposed open-core license, with an additional commercial license
planned — see `docs/LICENSE_STRATEGY.md`. This is a stated proposal, not a final legal
determination.
