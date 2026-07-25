# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .util import canonical_json, sha256_bytes


class AuditLedger:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event_type: str, details: dict) -> dict:
        previous_hash = "0" * 64
        if self.path.exists():
            lines = [
                line for line in self.path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            if lines:
                previous_hash = json.loads(lines[-1])["eventHash"]

        event = {
            "timestampUtc": datetime.now(timezone.utc).isoformat(),
            "eventType": event_type,
            "details": details,
            "previousHash": previous_hash,
        }
        event["eventHash"] = sha256_bytes(canonical_json(event))
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, sort_keys=True) + "\n")
        return event

    def verify(self) -> bool:
        previous_hash = "0" * 64
        if not self.path.exists():
            return True
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            event = json.loads(line)
            supplied = event.pop("eventHash")
            if event["previousHash"] != previous_hash:
                return False
            calculated = sha256_bytes(canonical_json(event))
            if supplied != calculated:
                return False
            previous_hash = supplied
        return True
