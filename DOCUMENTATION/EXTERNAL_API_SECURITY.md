# External API Security

External model and tool egress is opt-in. Profiles are disabled by default;
credentials are AES-256-GCM encrypted at rest or process-ephemeral; snapshots
and exports omit encrypted credential material. Consent is scoped to project
and data classes. Outbound redaction is applied before transport. External
endpoints require HTTPS and reject loopback, private, link-local and metadata
addresses. Tool mutations require explicit approval and all decisions are
written to the audit ledger.
