# Tools, agents, MCP and OpenAPI

Tools are installable records with transport, endpoint/command, schemas, permissions, mutation flag, consent and encrypted credential state.

Supported execution transports:

- `local-http` — private/loopback JSON endpoint;
- `openapi` — validated HTTP operation contract;
- `mcp-http` — JSON-RPC `tools/call` over HTTPS or private local HTTP;
- `mcp-stdio` — JSON-RPC over a no-shell child process.

MCP stdio executables are denied unless present in `NOESAR_MCP_ALLOWED_EXECUTABLES`. Process environment is minimized, output and duration are bounded, and no shell interpolation is used.

External tools require explicit project-scoped consent. Mutative tools and mutative agent steps require explicit approval. Runs expose planned, awaiting-approval, pending, running, completed and failed states plus intermediate output and errors.

The implementation does not pass provider tokens through MCP servers. Tool credentials use the local credential vault.
