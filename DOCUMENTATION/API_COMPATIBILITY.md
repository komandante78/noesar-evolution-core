
# API compatibility

Schemas and contracts are versioned. Consumers must reject unknown incompatible major versions, validate every inbound payload, preserve request/response binding and avoid assuming that a capability declaration implies authorization. Provider adapters may expose local or remote models, but network egress requires destination, purpose, data class and revocation controls.
