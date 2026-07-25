# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import hashlib
import json
from pathlib import Path


LEGACY_REQUIRED_TRUE = (
    "userNamespace",
    "mountNamespace",
    "pidNamespace",
    "networkNamespace",
    "ipcNamespace",
    "utsNamespace",
    "seccomp",
    "resourceLimits",
    "filesystemIsolation",
    "escapeTestsPassed",
)

PRODUCTION_REQUIRED_TRUE = (
    "noNewPrivileges",
    "userNamespace",
    "uidMapRestricted",
    "gidMapRestricted",
    "mountNamespace",
    "pidNamespace",
    "networkNamespace",
    "ipcNamespace",
    "utsNamespace",
    "seccomp",
    "resourceLimits",
    "filesystemIsolation",
    "processIsolation",
    "escapeTestsPassed",
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _required_file(value: object, field: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} is required")
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"{field} does not exist")
    return path


def _required_sha(value: object, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64:
        raise ValueError(f"{field} must be a SHA-256 digest")
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError(f"{field} must be hexadecimal") from exc
    return value


def _verify_file_hash(
    value: dict,
    path_field: str,
    hash_field: str,
) -> Path:
    path = _required_file(value.get(path_field), path_field)
    expected = _required_sha(value.get(hash_field), hash_field)
    if digest(path) != expected:
        raise ValueError(f"{hash_field} mismatch")
    return path


def verify_legacy_sandbox_attestation(
    value: dict,
    *,
    expected_profile_sha256: str,
) -> dict:
    if value.get("schemaVersion") != "1.0":
        raise ValueError("unsupported legacy sandbox attestation schema")
    if value.get("kind") != "capability-os-sandbox":
        raise ValueError("invalid sandbox attestation kind")
    if value.get("profileSha256") != expected_profile_sha256:
        raise ValueError("sandbox profile hash mismatch")
    for field in LEGACY_REQUIRED_TRUE:
        if value.get(field) is not True:
            raise ValueError(f"sandbox attestation missing {field}")
    if not value.get("platform") or not value.get("kernel"):
        raise ValueError("platform and kernel are required")
    _required_sha(value.get("testReportSha256"), "testReportSha256")
    return value


def verify_production_sandbox_attestation(
    path: Path,
    *,
    expected_profile_sha256: str,
    expected_capability_id: str | None = None,
    expected_capability_version: str | None = None,
    expected_launcher_sha256: str | None = None,
    expected_seccomp_sha256: str | None = None,
    expected_plan_hash: str | None = None,
) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    schema_version = value.get("schemaVersion")
    if schema_version not in {"2.0", "3.0"}:
        raise ValueError(
            "production sandbox attestation schema 2.0 or 3.0 is required"
        )
    if value.get("kind") != "capability-os-sandbox":
        raise ValueError("invalid sandbox attestation kind")
    expected_release = "0.5.0" if schema_version == "3.0" else "0.4.0"
    if value.get("release") != expected_release:
        raise ValueError("sandbox attestation release mismatch")
    if value.get("profileSha256") != expected_profile_sha256:
        raise ValueError("sandbox profile hash mismatch")
    if value.get("profile") != "os-isolated":
        raise ValueError("production sandbox profile must be os-isolated")
    if value.get("adapter") not in {
        "bubblewrap",
        "linux-namespace-seccomp-launcher",
        "windows-appcontainer",
        "macos-sandbox-exec",
        "wasi-preview2",
    }:
        raise ValueError("unsupported sandbox adapter")

    if (
        expected_capability_id is not None
        and value.get("capabilityId") != expected_capability_id
    ):
        raise ValueError("sandbox capabilityId mismatch")
    if (
        expected_capability_version is not None
        and value.get("capabilityVersion") != expected_capability_version
    ):
        raise ValueError("sandbox capabilityVersion mismatch")

    launcher = _verify_file_hash(
        value,
        "launcherPath",
        "launcherSha256",
    )
    seccomp = _verify_file_hash(
        value,
        "seccompProfilePath",
        "seccompProfileSha256",
    )
    _verify_file_hash(
        value,
        "escapeTestReportPath",
        "escapeTestReportSha256",
    )

    if (
        expected_launcher_sha256 is not None
        and digest(launcher) != expected_launcher_sha256
    ):
        raise ValueError("attested launcher does not match the configured adapter")
    if (
        expected_seccomp_sha256 is not None
        and digest(seccomp) != expected_seccomp_sha256
    ):
        raise ValueError("attested seccomp profile does not match the configured adapter")

    for field in PRODUCTION_REQUIRED_TRUE:
        if value.get(field) is not True:
            raise ValueError(f"production sandbox attestation missing {field}")

    if not value.get("platform") or not value.get("kernel"):
        raise ValueError("platform and kernel are required")
    if not value.get("createdUtc"):
        raise ValueError("createdUtc is required")
    if value.get("networkPolicy") != "deny-by-default":
        raise ValueError("network policy must be deny-by-default")
    if value.get("filesystemPolicy") != "allowlisted-readonly-root":
        raise ValueError("filesystem policy must be allowlisted-readonly-root")

    if schema_version == "3.0":
        if value.get("authorityProtocolVersion") != "1.1":
            raise ValueError("authority protocol V1.1 is required")
        if value.get("runtimeVersion") != "0.5.0":
            raise ValueError("runtime V0.5.0 is required")
        if expected_plan_hash is not None and value.get("planHash") != expected_plan_hash:
            raise ValueError("sandbox planHash mismatch")
        for field in (
            "authorityAttestationSha256",
            "postgresAttestationSha256",
            "capabilityPackageSha256",
            "policyDecisionSha256",
            "runtimeReadinessSha256",
            "planHash",
        ):
            _required_sha(value.get(field), field)
    return value


def verify_sandbox_attestation(
    path: Path,
    *,
    expected_profile_sha256: str,
) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schemaVersion") == "1.0":
        return verify_legacy_sandbox_attestation(
            value,
            expected_profile_sha256=expected_profile_sha256,
        )
    return verify_production_sandbox_attestation(
        path,
        expected_profile_sha256=expected_profile_sha256,
    )
