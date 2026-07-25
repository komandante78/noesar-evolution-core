# Threat Model

Protected assets include customer documents/code, secrets, models, memory,
audit, signing/license state, host filesystem, connected devices and
safety-relevant workflows.

Adversaries include remote attackers, malicious users, compromised accounts,
malicious documents/web pages/models/capabilities/MCP servers, compromised
updates/dependencies, insiders and model-induced unsafe actions.

Mandatory attack classes: direct/indirect prompt injection, sensitive data
disclosure, excessive agency, command injection, traversal/symlink races, SSRF,
exfiltration, privilege escalation, sandbox escape, memory/retrieval poisoning,
model backdoors, dependency confusion, rollback/freeze/mix-and-match,
resource exhaustion, ransomware-like mutation, audit tampering and persistence.
Every threat needs prevention, detection, response, recovery and test evidence.
