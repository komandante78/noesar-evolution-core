# NOESAR Evolution — Canonical Master Specification V4

## Product identity

NOESAR Evolution is a self-hosted, local-first AI operating environment and
extension platform combining task-first AI work, documents, projects, agents,
workflows, CodeN Ultra, model execution, hardware orchestration, memory,
search, evaluation and installable capabilities.

Customer prompts, documents, code, memory, workflows, agent state, model
input/output, private logs and secrets remain under customer control. No
mandatory NOESAR cloud runtime exists.

## Product boundary

The general-purpose core is not automatically a medical device, surgical
controller, certified airborne system, live trading system or industrial
safety controller. Regulated or safety-critical functions are separately
versioned Industry Modules with their own intended use, validation and evidence.

## Distribution

The same public core is available under:

```text
AGPL-3.0-or-later
OR
NOESAR Commercial License
```

Public SDKs, protocols and schemas may use Apache-2.0. Public documentation may
use CC BY-SA 4.0. Private repositories contain ATOM Evolution implementation,
Owner Unlocked issuance, commercial licensing infrastructure, private signing
infrastructure and official high-risk modules.

The public build must be useful, buildable and testable without private code,
ATOM or a commercial licensing server. It includes a functional reference
reasoning provider and complete public security controls.

## Technology architecture

- Rust: privileged Control Plane, policy, brokers, licensing, updates, audit,
  task supervision and hardware orchestration.
- TypeScript and React: WebUI and visual applications.
- Isolated Python workers: models, science, documents and multimodal workloads.
- Swift: optional authenticated macOS bridge for Metal, Core ML, Keychain and
  Secure Enclave.
- PostgreSQL: authoritative store.
- pgvector: default vector search.
- Qdrant: optional scale-out vector adapter.
- DuckDB: local analytics.
- Embedded reviewed policy engine, Wasmtime/WASI and OpenTelemetry.

## Deployment

Primary target is one external OCI container with no Docker-in-Docker, no
nested-container requirement, no mandatory Compose, cloud or Unraid dependency.
Optional Enterprise scale-out may externalize data and runtime services.

## User experience and privacy

The approved WebUI reference is binding. Modes are Simple, Professional,
Developer and Owner.

Chat and CodeN Ultra display:

> NOESAR runs locally on your device. No data is sent to external servers.

The text appears only while the Network Egress Broker verifies local-only
state. External search, connectors, models or update metadata change the state
and show destination, data class, purpose and revocation control.

## CodeN Ultra

Natural-language instructions never grant host authority. Every host/server
mutation passes through the Path Authorization Broker, showing canonical paths,
files, commands, dependencies, network, risks, backup, verification and
rollback.

Normal mode uses scoped consent. Owner Bypass is installation-specific,
strongly authenticated, scoped, timed and audited. It cannot disable
non-bypassable malware, credential-theft, physical-harm, update-integrity,
audit, destructive-action and emergency-stop controls.

## Security

```text
AI_PROPOSES
POLICY_DECIDES
USER_OR_POLICY_AUTHORIZES
SANDBOX_EXECUTES
VERIFIER_CHECKS
AUDIT_RECORDS
```

The model is never the security authority. Default-deny covers shell, host
filesystem, network, secrets, database mutation, memory promotion, model
installation, camera/microphone, physical actuation and core mutation.

## Hardware and models

Read-only discovery covers CPU, RAM, NUMA, storage, GPU/NPU, VRAM, drivers,
runtimes and topology. Versioned adapters cover CPU, CUDA/TensorRT/NCCL,
ROCm/HIP/MIGraphX, Metal/Core ML, OpenVINO, DirectML, ONNX Runtime and future
backends. The planner evaluates model format, quantization, context, batch,
concurrency, RAM, VRAM, offload, latency, throughput and power.

Automatic detection and recommendation are allowed. Automatic driver install,
runtime install, model download and host mutation are prohibited.

Every model has provenance, license, hash, signature, format, resource
requirements, validated context, benchmark evidence and advisories.

## ATOM and memory

ATOM Evolution is a private `ReasoningProvider` implementation behind a public
versioned contract. The public core has a useful reference provider.

MEVCM separates authoritative records, retrieval indexes, causal links,
salience, provenance, retention and contamination state. Untrusted content
cannot directly become authoritative memory.

## Industry modules

The core ships the Industry Module Framework, not complete regulated modules.
Trust levels are NOESAR Official, Certified Partner, Customer Private and
Community. High-risk deployments may allow only Official or reviewed Customer
Private modules.

## Compliance

Self-hosting reduces unnecessary disclosure but does not eliminate legal
obligations. NOESAR provides versioned compliance packs and evidence, not a
universal certification. Initial architecture supports EU, UK, US and future
jurisdiction packs. Customer counsel classifies the actual use case.

## Updates and funding

Product, security, runtime, hardware, model, capability, connector, compliance
and revocation updates use signed metadata, rollback protection, compatibility
analysis, quarantine, testing, explicit authorization, backup and verification.
No component is silently installed.

Public work proposed to NLnet, Open Internet Stack, Sovereign Tech or similar
programs must be fully FOSS, independently useful, public, measurable and free
of private dependencies.

## Final delivery

Exactly five final archives: Complete Product Source; Runtime and Deployment;
Capabilities and SDK; Security and Acceptance; Final Release and Operations.
No final archive may be a preview, mock, demo, skeleton or incomplete release.

This V4 package authorizes no implementation. The next gate is Owner review and
explicit authorization.
