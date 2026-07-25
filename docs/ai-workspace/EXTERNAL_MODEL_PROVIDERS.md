# Local models and external API providers

## Supported API styles

- Local OpenAI-compatible endpoints such as Ollama, vLLM, SGLang, llama.cpp servers and compatible gateways.
- OpenAI Responses API with `store:false` in generated requests.
- Anthropic Messages API.
- Kimi/Moonshot OpenAI-compatible Chat Completions API.
- Custom OpenAI-compatible HTTPS providers.

## Control model

External profiles are created disabled. Activation requires:

1. an explicit consent record;
2. approved project IDs when project scoping is used;
3. approved outbound data classes;
4. a credential when required;
5. HTTPS and SSRF validation;
6. optional redaction/anonymization, enabled by default.

Credentials can be process-only or encrypted on disk. They are never returned by the API, included in ordinary user exports or logged in the audit ledger.

## Routing

Profiles have mode eligibility (`ASK`, `CREATE`, `ACT`), priority and fallback provider IDs. A conversation can pin a provider or use automatic routing. The comparison API can call up to eight enabled profiles in parallel.

## Data classes

The gateway verifies consent for the exact classes assembled for a request: prompt, project instructions, selected messages, selected memory, selected source passages and tool schemas. A provider cannot receive a class that is absent from its consent record.
