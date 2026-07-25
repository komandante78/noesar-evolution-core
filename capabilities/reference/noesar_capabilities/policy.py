# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

from dataclasses import dataclass

from .identity import Principal

NON_BYPASSABLE = {
    "physical.actuate",
}

OWNER_ONLY = {
    "filesystem.host",
    "runtime.install",
    "memory.promote",
}

HIGH_RISK = {
    "network.external",
    "secret.read",
    "shell.execute",
    "model.download",
    "camera.read",
    "microphone.read",
}

WRITE_RISK = {
    "filesystem.write.project",
    "memory.write",
}

ALLOWED_LICENSES = {
    "Apache-2.0",
    "MIT",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "AGPL-3.0-or-later",
    "LicenseRef-NOESAR-Commercial",
    "LicenseRef-Customer-Private",
}

REVIEW_LICENSES = {
    "MPL-2.0",
    "LGPL-3.0-or-later",
    "EPL-2.0",
}


@dataclass(frozen=True)
class PolicyDecision:
    decision: str
    reasons: tuple[str, ...]
    sandbox_profile: str
    strong_reauth_required: bool = False


def evaluate_policy(
    manifest: dict,
    principal: Principal,
    *,
    external_execution_enabled: bool = False,
) -> PolicyDecision:
    permissions = set(manifest.get("permissions", []))
    trust_level = manifest["publisher"]["trustLevel"]
    kind = manifest["kind"]
    entrypoint_type = manifest["entrypoint"]["type"]
    license_id = manifest["license"]["spdx"]
    reasons: list[str] = []
    strong_reauth = False

    forbidden = sorted(permissions & NON_BYPASSABLE)
    if forbidden:
        return PolicyDecision(
            "deny",
            tuple(f"non-bypassable permission: {value}" for value in forbidden),
            "blocked",
        )

    if license_id not in ALLOWED_LICENSES:
        if license_id in REVIEW_LICENSES:
            reasons.append("license requires legal and compatibility review")
        else:
            return PolicyDecision(
                "deny",
                (f"license is not approved by policy: {license_id}",),
                "blocked",
            )

    industry = manifest.get("industry")
    if kind == "industry-module":
        if not industry:
            return PolicyDecision(
                "deny",
                ("industry module requires an industry assurance declaration",),
                "blocked",
            )
        risk = industry.get("riskClass", "standard")
        evidence = industry.get("evidence", [])
        if trust_level == "community":
            return PolicyDecision(
                "deny",
                ("community industry modules are disabled",),
                "blocked",
            )
        if risk in {"high", "safety-critical"}:
            if trust_level not in {"noesar-official", "certified-partner"}:
                return PolicyDecision(
                    "deny",
                    ("high-risk industry modules require official or certified publisher",),
                    "blocked",
                )
            if principal.role != "owner":
                return PolicyDecision(
                    "deny",
                    ("high-risk industry modules require Owner authority",),
                    "blocked",
                )
            if not evidence:
                return PolicyDecision(
                    "deny",
                    ("high-risk industry module evidence is missing",),
                    "blocked",
                )
            reasons.append("high-risk industry module requires explicit Owner approval")
            strong_reauth = True

    if permissions & OWNER_ONLY:
        if principal.role != "owner":
            return PolicyDecision(
                "deny",
                ("Owner authority is required for host or system changes",),
                "blocked",
            )
        reasons.append("Owner-only permission requested")
        strong_reauth = True

    if entrypoint_type in {
        "wasi", "native-worker", "python-worker", "mcp", "a2a"
    } and not external_execution_enabled:
        return PolicyDecision(
            "deny",
            ("external execution runtime is not enabled",),
            "blocked",
        )

    if trust_level == "community":
        reasons.append("community publisher requires explicit approval")
    if permissions & HIGH_RISK:
        reasons.append("sensitive permission requires scoped approval")
    if permissions & WRITE_RISK:
        reasons.append("write permission requires scoped approval")

    if reasons:
        return PolicyDecision(
            "approval-required",
            tuple(reasons),
            "isolated-brokered",
            strong_reauth_required=strong_reauth,
        )

    return PolicyDecision(
        "allow",
        ("no sensitive permissions requested",),
        "declarative",
    )
