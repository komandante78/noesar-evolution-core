# Finding Register V0.5.0

## Closed

### C-002 — Authentication and session enforcement

Former finding: `B-002`

Status: `REMEDIATED_IN_REFERENCE_IMPLEMENTATION`

Evidence: Owner setup and TOTP; scrypt password derivation; server-side sessions; CSRF and RBAC; rate limiting and lockout; strong Owner reauthentication

Remaining dependencies: canonical Rust authority; PostgreSQL-backed identity repositories; independent penetration test

## Open

### B-001 — Canonical Rust Security Kernel is not compiled or active

Severity: **BLOCKER**

Area: Security authority

Evidence: ZIP 1 and ZIP 2 V0.5.0 pass source and reference tests. No Rust toolchain execution, compiled authority, OS peer-credential implementation or signed provenance was produced.

Required remediation: Compile and test the exact Rust workspace, implement authenticated local transport, execute cross-language conformance and issue signed provenance.

Progress:
- canonical JSON source implemented in Node and Rust
- Authority Protocol V1.1 implemented
- actor, session and action binding implemented
- authenticated peer and frame contracts implemented
- attestation V3 binds binary, provenance, peer credentials and schemas

### B-003 — Portable production OS sandbox is not accepted

Severity: **BLOCKER**

Area: Capability isolation

Evidence: ZIP 3 V0.5.0 verifies evidence and ticket contracts. No production adapter, signed sandbox attestation, portable escape-test matrix or real ticket issuance exists.

Required remediation: Integrate production adapters and execute independent escape tests with signed attestations on every supported platform.

Progress:
- sandbox attestation V3 implemented
- production evidence chain implemented
- execution ticket V1 implemented
- broker requires ticket and bindings
- native execution remains denied without adapter

### B-004 — Supported deployment platforms remain unexecuted

Severity: **BLOCKER**

Area: Deployment

Evidence: OCI build and Docker, Podman, Windows, macOS and Unraid runtime tests were not executed.

Required remediation: Build and execute the exact release candidate across the supported matrix with signed evidence.

Progress:
- V0.5.0 OCI and platform profiles updated
- production preflight and promotion compiler remain fail-closed

### B-005 — Production PostgreSQL and pgvector data plane is not active

Severity: **BLOCKER**

Area: Data architecture

Evidence: No PostgreSQL 18 server, pgvector extension, live repository, role acceptance, RLS adversarial test or backup/restore drill was executed.

Required remediation: Execute migrations and repository on PostgreSQL 18 with pgvector, verify roles/RLS/ledgers, perform backup/restore and issue signed evidence.

Progress:
- ten-migration V0.5.0 line implemented
- role separation and PUBLIC revocation implemented
- application role NOBYPASSRLS implemented
- security-acceptance view implemented
- attestation V3 requires RLS, immutable ledgers and backup/restore

### B-006 — Mandatory Master V4 subsystems remain incomplete

Severity: **BLOCKER**

Area: Product completeness

Evidence: The packages remain V4 Implementation V0.5.0 and do not implement or accept the complete Master V4 scope.

Required remediation: Complete all Master V4 requirements and pass final cross-subsystem acceptance.

Progress:
- authentication, authority, data-plane, runtime and capability controls advanced
- production readiness compiler formalizes the remaining evidence domains

### H-001 — Production TUF, Sigstore and SLSA pipeline is absent

Severity: **HIGH**

Area: Updates

Evidence: The readiness compiler requires update trust, but no production trust hierarchy or drill exists.

Required remediation: Implement threshold metadata, freshness, rollback/freeze protection, transparency and provenance.

### H-002 — Production WebUI build and dependency audit are unverified

Severity: **HIGH**

Area: WebUI

Evidence: No locked production React build, dependency audit, browser security or accessibility acceptance exists.

Required remediation: Produce and audit the production browser bundle.

### H-003 — MCP and A2A network gateways remain disabled

Severity: **HIGH**

Area: Protocols

Evidence: Default distrust exists; authenticated gateways and adversarial evidence are absent.

Required remediation: Implement brokered gateways with bounded credentials and red-team evidence.

### H-004 — Final release legal documents require review

Severity: **HIGH**

Area: Legal packaging

Evidence: License maps remain structural specifications rather than reviewed release documents.

Required remediation: Publish reviewed legal terms, notices and trademark policy.

### H-005 — Capability production gate is not integrated into the compiled Rust authority

Severity: **HIGH**

Area: Capability integration

Evidence: These controls remain Python reference implementation contracts; canonical Rust integration was not built or executed.

Required remediation: Integrate capability authorization, evidence verification and ticket issuance into the compiled Rust authority.

Progress:
- capability production evidence chain implemented
- execution ticket V1 implemented
- Authority Protocol V1.1 and runtime V3 binding implemented

### M-001 — Real accelerator and multi-GPU matrix is absent

Severity: **MEDIUM**

Area: Hardware

Evidence: Representative NVIDIA, AMD, Intel and Apple execution evidence is absent.

Required remediation: Run compatibility, fallback and multi-device acceptance.

### M-002 — Reference authentication master key remains file-backed

Severity: **MEDIUM**

Area: Secret storage

Evidence: OS keystore, TPM, HSM or Vault integration remains absent.

Required remediation: Implement platform and enterprise secret-provider adapters.
