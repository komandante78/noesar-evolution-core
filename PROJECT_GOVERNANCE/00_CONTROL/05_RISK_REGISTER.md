# Risk Register

| ID | Risk | Severity | Required treatment |
|---|---|---:|---|
| R-001 | Public core unusable without ATOM | Critical | Independent build and reference provider gate |
| R-002 | Contributor rights block commercial relicensing | High | Counsel-reviewed CLA and provenance policy |
| R-003 | Privacy banner false during external access | Critical | Derive UI from Network Egress Broker |
| R-004 | Owner bypass becomes a backdoor | Critical | Device binding, re-auth, scope, timeout and audit |
| R-005 | Prompt injection authorizes tools | Critical | Separate untrusted content from authority |
| R-006 | Capability escapes sandbox | Critical | Layered OS/WASM isolation and deny-by-default |
| R-007 | Malicious model/update compromises product | Critical | Signature, hash, provenance, quarantine, rollback |
| R-008 | Vendor compatibility drifts | High | Signed matrices and local probes |
| R-009 | Mixed-vendor multi-GPU is overpromised | Medium | Capability matrix and task-level scheduling |
| R-010 | Self-hosting is marketed as compliance | High | Claims policy and counsel review |
| R-011 | Core is treated as medical/flight certified | Critical | Intended-use boundary and separate module |
| R-012 | Cyber-physical actuation bypasses safety | Critical | External certified interlocks and default prohibition |
| R-013 | Grant work is a wrapper around private code | High | Independent work packages and public tests |
| R-014 | License incompatibility contaminates release | High | Dependency/model license gates |
| R-015 | One-container requirement weakens isolation | High | Process sandbox, Landlock/seccomp/WASM |
| R-016 | Regulatory packs become stale | High | Versioned packs, source dates and notifications |
| R-017 | Old working archives are mistaken for canonical | High | Deprecation registry and hash policy |
