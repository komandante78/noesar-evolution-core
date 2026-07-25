# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

from dataclasses import dataclass
import time

ROLE_RANK = {
    "user": 10,
    "developer": 20,
    "admin": 30,
    "owner": 40,
}

ACTION_MINIMUM_ROLE = {
    "capability.inspect": "developer",
    "capability.verify": "developer",
    "capability.plan": "developer",
    "capability.install": "developer",
    "capability.activate": "admin",
    "capability.disable": "admin",
    "capability.uninstall": "admin",
    "capability.rollback": "admin",
    "capability.invoke": "user",
    "publisher.register": "owner",
    "publisher.revoke": "owner",
    "package.revoke": "owner",
    "policy.update": "owner",
}


@dataclass(frozen=True)
class Principal:
    actor_id: str
    role: str
    session_id: str
    authenticated_at: int
    strong_reauth_until: int = 0
    organization_id: str = "local"
    project_id: str | None = None

    def __post_init__(self) -> None:
        if self.role not in ROLE_RANK:
            raise ValueError(f"unknown role: {self.role}")
        if not self.actor_id or not self.session_id:
            raise ValueError("actor_id and session_id are required")

    @property
    def strong_reauthenticated(self) -> bool:
        return self.strong_reauth_until >= int(time.time())

    def as_audit(self) -> dict:
        return {
            "actorId": self.actor_id,
            "role": self.role,
            "sessionId": self.session_id,
            "organizationId": self.organization_id,
            "projectId": self.project_id,
            "strongReauthenticated": self.strong_reauthenticated,
        }


def require_action(
    principal: Principal,
    action: str,
    *,
    strong_reauth: bool = False,
) -> None:
    minimum = ACTION_MINIMUM_ROLE.get(action)
    if minimum is None:
        raise PermissionError(f"unknown protected action: {action}")
    if ROLE_RANK[principal.role] < ROLE_RANK[minimum]:
        raise PermissionError(
            f"{action} requires role {minimum}; received {principal.role}"
        )
    if strong_reauth and not principal.strong_reauthenticated:
        raise PermissionError(f"{action} requires strong reauthentication")
