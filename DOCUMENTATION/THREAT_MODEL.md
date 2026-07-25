
# Consolidated threat model

Primary threats include prompt injection, confused-deputy authorization, malicious capabilities, path traversal, credential theft, unapproved network egress, supply-chain substitution, replay, audit tampering, unsafe update/rollback, memory contamination and privilege escalation.

Core controls include default deny, scoped authorization, signed/canonical authority messages, peer credential checks, private secret files, anti-replay fields, request/response binding, capability manifests, publisher trust, quarantine, audit chaining and local-first egress disclosure.

Residual risk remains material until B003, B004 and B005 are closed through implementation and independent execution evidence.
