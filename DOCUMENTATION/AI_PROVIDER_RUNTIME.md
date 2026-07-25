# AI Provider Runtime

The runtime supports local OpenAI-compatible inference and optional external
OpenAI/ChatGPT, Anthropic/Claude, Moonshot/Kimi and custom OpenAI-compatible
APIs. External profiles are provisioned disabled and require encrypted
credentials plus explicit project/data-class consent. The gateway implements
streaming, stop, health probes, mode routing, fallback, parallel comparison,
outbound redaction and external URL/SSRF validation.
