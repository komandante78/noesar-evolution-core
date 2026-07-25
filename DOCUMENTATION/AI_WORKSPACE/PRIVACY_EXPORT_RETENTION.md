# Privacy, export, deletion and retention

NOESAR is local-first. External model and tool egress is denied unless explicitly enabled and consented.

Outbound redaction recognizes bearer tokens, common API-key forms, email addresses, payment-number patterns, phone numbers and IPv4 addresses. Redaction occurs only when the profile consent enables anonymization. Counts, not values, are audited.

Ordinary export includes projects, chat graph, visible memory, artifacts, source metadata, tasks, tools, agents and settings but excludes encrypted and ephemeral credentials. Import supports merge or replace for the declared schema version.

Project purge removes related messages, memories, artifacts, source metadata, knowledge chunks, conversations, branches, tasks and agent runs, then deletes associated binary blob directories. Retention can be configured and applied without relying on a cloud service.
