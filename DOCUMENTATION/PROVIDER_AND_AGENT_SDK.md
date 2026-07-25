# Provider and Agent SDK Surface

Provider profiles describe local or external endpoints, protocol, model,
routing modes, fallback priority, data-class consent and redaction. Secrets are
stored through the credential vault rather than serialized in profiles.

Tool profiles support bounded local HTTP, OpenAPI HTTP, MCP HTTP JSON-RPC and
allowlisted MCP stdio. Agent runs retain plans, step status, intermediate output,
approvals and results. Mutative steps cannot execute before explicit approval.
