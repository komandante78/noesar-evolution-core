# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

TrustLevel = Literal[
    "noesar-official",
    "certified-partner",
    "customer-private",
    "community",
]
Role = Literal["owner", "admin", "developer", "user"]


@dataclass(frozen=True)
class IdentityContext:
    actor_id: str
    role: Role
    session_id: str
    organization_id: str = "local"
    project_id: str | None = None
    strong_reauthenticated: bool = False


@dataclass(frozen=True)
class CapabilityManifest:
    id: str
    version: str
    kind: str
    publisher_id: str
    trust_level: TrustLevel
    entrypoint_type: str
    entrypoint_value: str
    permissions: tuple[str, ...] = ()
    payload_paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class CapabilityPlan:
    capability_id: str
    version: str
    decision: Literal["allow", "approval-required", "deny"]
    reasons: tuple[str, ...]
    permissions: tuple[str, ...]
    plan_hash: str
    sandbox_profile: str
    actor_id: str
    session_id: str
    strong_reauth_required: bool = False


@dataclass(frozen=True)
class PublisherRecord:
    publisher_id: str
    trust_level: TrustLevel
    fingerprint_sha256: str
    status: Literal["active", "revoked"]


@dataclass(frozen=True)
class RuntimeAdapterDescriptor:
    id: str
    version: str
    vendor: str
    backend: str
    platforms: tuple[str, ...]
    devices: tuple[str, ...]
    capabilities: tuple[str, ...]
    requires_host_bridge: bool = False


@dataclass(frozen=True)
class IndustryModuleDescriptor:
    id: str
    version: str
    publisher: str
    trust_level: TrustLevel
    sector: tuple[str, ...]
    intended_use: tuple[str, ...]
    excluded_use: tuple[str, ...]
    risk_class: Literal["standard", "elevated", "high", "safety-critical"]


@dataclass(frozen=True)
class ResourceLimits:
    cpu_seconds: int
    wall_seconds: float
    memory_bytes: int
    file_bytes: int
    stdout_bytes: int
    open_files: int
    processes: int


@dataclass(frozen=True)
class SandboxAttestation:
    profile_sha256: str
    platform: str
    kernel: str
    test_report_sha256: str
    escape_tests_passed: bool


@dataclass(frozen=True)
class CapabilityExecutionRequest:
    capability_id: str
    version: str
    actor_id: str
    session_id: str
    plan_hash: str
    profile: str
    argv: tuple[str, ...]
    permissions: tuple[str, ...]
    limits: ResourceLimits


@dataclass(frozen=True)
class CapabilityExecutionReceipt:
    execution_id: str
    profile: str
    exit_code: int | None
    timed_out: bool
    duration_ms: int
    workspace_destroyed: bool
    network_enforcement: str
    command_sha256: str


@dataclass(frozen=True)
class CapabilityIpcEnvelopeV2:
    actor_id: str
    session_id: str
    action: str
    nonce: str
    issued_at: int
    expires_at: int
    plan_hash: str | None
    capability_id: str | None
    capability_version: str | None
    signature: str


@dataclass(frozen=True)
class ProductionSandboxAttestationV2:
    profile_sha256: str
    capability_id: str
    capability_version: str
    adapter: str
    launcher_sha256: str
    seccomp_profile_sha256: str
    escape_test_report_sha256: str
    platform: str
    kernel: str


@dataclass(frozen=True)
class CapabilityProductionEvidenceV1:
    capability_id: str
    capability_version: str
    plan_hash: str
    profile_sha256: str
    evidence_sha256: str
    authority_attestation_sha256: str
    postgres_attestation_sha256: str
    sandbox_attestation_sha256: str
    policy_decision_sha256: str
    capability_package_sha256: str
    runtime_readiness_sha256: str


@dataclass(frozen=True)
class CapabilityExecutionTicketV1:
    ticket_id: str
    nonce: str
    actor_id: str
    session_id: str
    capability_id: str
    capability_version: str
    plan_hash: str
    sandbox_profile: str
    evidence_sha256: str
    issued_at: int
    expires_at: int
    signature: str


@dataclass(frozen=True)
class ProductionSandboxAttestationV3:
    profile_sha256: str
    capability_id: str
    capability_version: str
    plan_hash: str
    authority_protocol_version: Literal["1.1"]
    runtime_version: Literal["0.5.0"]
    launcher_sha256: str
    seccomp_profile_sha256: str
    escape_test_report_sha256: str
    authority_attestation_sha256: str
    postgres_attestation_sha256: str
    capability_package_sha256: str
    policy_decision_sha256: str
    runtime_readiness_sha256: str
