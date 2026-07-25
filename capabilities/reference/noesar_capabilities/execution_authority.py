# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from .identity import Principal
from .production_evidence import verify_capability_production_evidence
from .sandbox_attestation import verify_production_sandbox_attestation


@dataclass(frozen=True)
class ExecutionAuthorization:
    capability_id: str
    capability_version: str
    actor_id: str
    session_id: str
    plan_hash: str
    sandbox_profile: str
    production_eligible: bool
    attestation_verified: bool
    evidence_chain_verified: bool = False
    evidence_sha256: str | None = None


class CapabilityExecutionAuthority:
    def __init__(self) -> None:
        self.used_approval_nonces: set[str] = set()

    def authorize(
        self,
        *,
        principal: Principal,
        plan: dict,
        approval: dict,
        sandbox_profile_sha256: str,
        attestation_path: Path | None = None,
        expected_launcher_sha256: str | None = None,
        expected_seccomp_sha256: str | None = None,
        development_fixture: bool = False,
        now: int | None = None,
    ) -> ExecutionAuthorization:
        current = int(time.time()) if now is None else int(now)
        required_plan = [
            "capabilityId",
            "version",
            "actorId",
            "sessionId",
            "planHash",
            "decision",
            "sandboxProfile",
        ]
        for field in required_plan:
            if field not in plan:
                raise ValueError(f"plan.{field} is required")

        if plan["decision"] == "deny":
            raise PermissionError("denied capability plans cannot execute")
        if plan["actorId"] != principal.actor_id:
            raise PermissionError("plan actor binding mismatch")
        if plan["sessionId"] != principal.session_id:
            raise PermissionError("plan session binding mismatch")

        required_approval = [
            "nonce",
            "actorId",
            "sessionId",
            "capabilityId",
            "version",
            "planHash",
            "expiresAt",
        ]
        for field in required_approval:
            if field not in approval:
                raise ValueError(f"approval.{field} is required")
        if approval["nonce"] in self.used_approval_nonces:
            raise PermissionError("approval nonce replay detected")
        if int(approval["expiresAt"]) < current:
            raise PermissionError("approval expired")

        bindings = {
            "actorId": principal.actor_id,
            "sessionId": principal.session_id,
            "capabilityId": plan["capabilityId"],
            "version": plan["version"],
            "planHash": plan["planHash"],
        }
        for field, expected in bindings.items():
            if approval.get(field) != expected:
                raise PermissionError(f"approval {field} binding mismatch")

        profile = plan["sandboxProfile"]
        attestation_verified = False
        production_eligible = False
        if profile == "declarative":
            production_eligible = True
        elif profile == "process-restricted-development-fixture":
            if not development_fixture:
                raise PermissionError(
                    "development fixture profile requires an explicit fixture gate"
                )
        elif profile == "os-isolated":
            if attestation_path is None:
                raise PermissionError(
                    "os-isolated execution requires a production sandbox attestation"
                )
            verify_production_sandbox_attestation(
                attestation_path,
                expected_profile_sha256=sandbox_profile_sha256,
                expected_capability_id=plan["capabilityId"],
                expected_capability_version=plan["version"],
                expected_launcher_sha256=expected_launcher_sha256,
                expected_seccomp_sha256=expected_seccomp_sha256,
            )
            attestation_verified = True
            production_eligible = False
        else:
            raise PermissionError("blocked or unknown sandbox profile")

        self.used_approval_nonces.add(approval["nonce"])
        return ExecutionAuthorization(
            capability_id=plan["capabilityId"],
            capability_version=plan["version"],
            actor_id=principal.actor_id,
            session_id=principal.session_id,
            plan_hash=plan["planHash"],
            sandbox_profile=profile,
            production_eligible=production_eligible,
            attestation_verified=attestation_verified,
        )

    def authorize_production(
        self,
        *,
        principal: Principal,
        plan: dict,
        approval: dict,
        sandbox_profile_sha256: str,
        attestation_path: Path,
        production_evidence_path: Path,
        expected_launcher_sha256: str | None = None,
        expected_seccomp_sha256: str | None = None,
        now: int | None = None,
    ) -> ExecutionAuthorization:
        authorization = self.authorize(
            principal=principal,
            plan=plan,
            approval=approval,
            sandbox_profile_sha256=sandbox_profile_sha256,
            attestation_path=attestation_path,
            expected_launcher_sha256=expected_launcher_sha256,
            expected_seccomp_sha256=expected_seccomp_sha256,
            now=now,
        )
        if authorization.sandbox_profile != "os-isolated":
            raise PermissionError(
                "production capability authorization requires os-isolated"
            )
        evidence = verify_capability_production_evidence(
            production_evidence_path,
            expected_capability_id=authorization.capability_id,
            expected_capability_version=authorization.capability_version,
            expected_plan_hash=authorization.plan_hash,
            expected_profile_sha256=sandbox_profile_sha256,
        )
        return ExecutionAuthorization(
            capability_id=authorization.capability_id,
            capability_version=authorization.capability_version,
            actor_id=authorization.actor_id,
            session_id=authorization.session_id,
            plan_hash=authorization.plan_hash,
            sandbox_profile=authorization.sandbox_profile,
            production_eligible=True,
            attestation_verified=True,
            evidence_chain_verified=True,
            evidence_sha256=evidence.evidence_sha256,
        )
