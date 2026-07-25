# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import json
import time
from pathlib import Path

from .util import atomic_json_write


class RevocationStore:
    def __init__(self, path: Path):
        self.path = path
        if not path.exists():
            atomic_json_write(path, {
                "publishers": {},
                "packages": {},
                "capabilities": {},
            })

    def load(self) -> dict:
        return json.loads(self.path.read_text(encoding="utf-8"))

    def revoke_publisher(
        self,
        publisher_id: str,
        *,
        reason: str,
        actor_id: str,
    ) -> dict:
        value = self.load()
        record = {
            "reason": reason,
            "actorId": actor_id,
            "revokedAt": int(time.time()),
        }
        value["publishers"][publisher_id] = record
        atomic_json_write(self.path, value)
        return record

    def revoke_package(
        self,
        package_sha256: str,
        *,
        reason: str,
        actor_id: str,
    ) -> dict:
        value = self.load()
        record = {
            "reason": reason,
            "actorId": actor_id,
            "revokedAt": int(time.time()),
        }
        value["packages"][package_sha256] = record
        atomic_json_write(self.path, value)
        return record

    def revoke_capability(
        self,
        capability_id: str,
        version: str,
        *,
        reason: str,
        actor_id: str,
    ) -> dict:
        value = self.load()
        key = f"{capability_id}@{version}"
        record = {
            "reason": reason,
            "actorId": actor_id,
            "revokedAt": int(time.time()),
        }
        value["capabilities"][key] = record
        atomic_json_write(self.path, value)
        return record

    def assert_allowed(
        self,
        *,
        publisher_id: str,
        package_sha256: str,
        capability_id: str,
        version: str,
    ) -> None:
        value = self.load()
        if publisher_id in value["publishers"]:
            raise ValueError("publisher is revoked")
        if package_sha256 in value["packages"]:
            raise ValueError("package is revoked")
        if f"{capability_id}@{version}" in value["capabilities"]:
            raise ValueError("capability version is revoked")
