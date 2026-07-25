# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .sandbox_attestation import verify_production_sandbox_attestation


AUTHORITY_REQUIRED_TRUE = (
    "canonicalJsonConformancePassed",
    "hmacConformancePassed",
    "authenticatedIpc",
    "peerCredentialsVerified",
    "frameBoundaryTestsPassed",
    "testsPassed",
)

POSTGRES_REQUIRED_TRUE = (
    "connected",
    "migrationsVerified",
    "roleSeparationVerified",
    "publicSchemaRevocationVerified",
    "applicationRoleNoBypassRls",
    "rowLevelSecurityVerified",
    "immutableLedgersVerified",
    "securityAcceptanceViewVerified",
    "repositoryAdapterActive",
    "backupRestoreVerified",
    "legacyV030Rejected",
    "baselineV040Preserved",
)


@dataclass(frozen=True)
class CapabilityProductionEvidence:
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


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sha(value: object, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64:
        raise ValueError(f"{field} must be a SHA-256 digest")
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError(f"{field} must be hexadecimal") from exc
    return value


def _file(value: dict, path_field: str, hash_field: str) -> Path:
    raw = value.get(path_field)
    if not isinstance(raw, str) or not raw:
        raise ValueError(f"{path_field} is required")
    path = Path(raw).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"{path_field} does not exist")
    expected = _sha(value.get(hash_field), hash_field)
    if digest(path) != expected:
        raise ValueError(f"{hash_field} mismatch")
    return path


def _load(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return value


def verify_capability_production_evidence(
    path: Path,
    *,
    expected_capability_id: str,
    expected_capability_version: str,
    expected_plan_hash: str,
    expected_profile_sha256: str,
) -> CapabilityProductionEvidence:
    value = _load(path)
    if (
        value.get("schemaVersion") != "1.0"
        or value.get("kind") != "capability-production-evidence"
        or value.get("release") != "0.5.0"
    ):
        raise ValueError("invalid capability production evidence")
    if value.get("capabilityId") != expected_capability_id:
        raise ValueError("production evidence capabilityId mismatch")
    if value.get("capabilityVersion") != expected_capability_version:
        raise ValueError("production evidence capabilityVersion mismatch")
    if value.get("planHash") != expected_plan_hash:
        raise ValueError("production evidence planHash mismatch")
    if value.get("profileSha256") != expected_profile_sha256:
        raise ValueError("production evidence profileSha256 mismatch")
    if value.get("authorityProtocolVersion") != "1.1":
        raise ValueError("authority protocol V1.1 is required")
    if value.get("runtimeVersion") != "0.5.0":
        raise ValueError("runtime V0.5.0 evidence is required")

    capability_package = _file(
        value, "capabilityPackagePath", "capabilityPackageSha256"
    )
    policy_decision = _file(
        value, "policyDecisionPath", "policyDecisionSha256"
    )
    authority_path = _file(
        value, "authorityAttestationPath", "authorityAttestationSha256"
    )
    postgres_path = _file(
        value, "postgresAttestationPath", "postgresAttestationSha256"
    )
    sandbox_path = _file(
        value, "sandboxAttestationPath", "sandboxAttestationSha256"
    )
    readiness_path = _file(
        value, "runtimeReadinessPath", "runtimeReadinessSha256"
    )

    authority = _load(authority_path)
    if (
        authority.get("schemaVersion") != "3.0"
        or authority.get("kind") != "rust-authority"
        or authority.get("release") != "0.5.0"
        or authority.get("protocolVersion") != "1.1"
    ):
        raise ValueError("invalid Rust authority V3 evidence")
    for field in AUTHORITY_REQUIRED_TRUE:
        if authority.get(field) is not True:
            raise ValueError(f"Rust authority evidence missing {field}")
    if authority.get("transport") not in {
        "unix-domain-socket",
        "windows-named-pipe",
    }:
        raise ValueError("unsupported authenticated authority transport")

    postgres = _load(postgres_path)
    if (
        postgres.get("schemaVersion") != "3.0"
        or postgres.get("kind") != "postgresql-data-plane"
        or postgres.get("release") != "0.5.0"
    ):
        raise ValueError("invalid PostgreSQL V3 evidence")
    if int(postgres.get("serverVersionNumber", 0)) < 180000:
        raise ValueError("PostgreSQL 18 or newer is required")
    if not postgres.get("pgvectorVersion"):
        raise ValueError("pgvector version is required")
    for field in POSTGRES_REQUIRED_TRUE:
        if postgres.get(field) is not True:
            raise ValueError(f"PostgreSQL evidence missing {field}")

    readiness = _load(readiness_path)
    if readiness.get("release") != "0.5.0":
        raise ValueError("runtime readiness release mismatch")
    if readiness.get("productionReady") is not True:
        raise ValueError("runtime readiness is not production-ready")
    checks = readiness.get("checks")
    if not isinstance(checks, dict) or not checks or not all(checks.values()):
        raise ValueError("runtime readiness checks are incomplete")
    if readiness.get("blockers") != []:
        raise ValueError("runtime readiness contains blockers")

    sandbox = verify_production_sandbox_attestation(
        sandbox_path,
        expected_profile_sha256=expected_profile_sha256,
        expected_capability_id=expected_capability_id,
        expected_capability_version=expected_capability_version,
        expected_plan_hash=expected_plan_hash,
    )
    bindings = {
        "authorityAttestationSha256": digest(authority_path),
        "postgresAttestationSha256": digest(postgres_path),
        "capabilityPackageSha256": digest(capability_package),
        "policyDecisionSha256": digest(policy_decision),
        "runtimeReadinessSha256": digest(readiness_path),
    }
    for field, expected in bindings.items():
        if sandbox.get(field) != expected:
            raise ValueError(f"sandbox {field} binding mismatch")

    return CapabilityProductionEvidence(
        capability_id=expected_capability_id,
        capability_version=expected_capability_version,
        plan_hash=expected_plan_hash,
        profile_sha256=expected_profile_sha256,
        evidence_sha256=digest(path),
        authority_attestation_sha256=digest(authority_path),
        postgres_attestation_sha256=digest(postgres_path),
        sandbox_attestation_sha256=digest(sandbox_path),
        policy_decision_sha256=digest(policy_decision),
        capability_package_sha256=digest(capability_package),
        runtime_readiness_sha256=digest(readiness_path),
    )
