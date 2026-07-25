# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from collections.abc import MutableMapping, MutableSet

from .util import canonical_json


ACTIONS = frozenset({
    "capability.plan",
    "capability.approve",
    "capability.execute",
    "capability.disable",
    "capability.rollback",
    "capability.status",
})


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise ValueError("IPC signature encoding is invalid") from exc


def _validate_secret(secret: bytes) -> None:
    if not isinstance(secret, bytes) or len(secret) < 32:
        raise ValueError("IPC secret must contain at least 32 bytes")


def create_envelope(
    secret: bytes,
    *,
    actor_id: str,
    session_id: str,
    action: str,
    payload: dict,
    nonce: str,
    ttl_seconds: int = 20,
    now: int | None = None,
    plan_hash: str | None = None,
    capability_id: str | None = None,
    capability_version: str | None = None,
) -> dict:
    _validate_secret(secret)
    if action not in ACTIONS:
        raise ValueError("unsupported capability IPC action")
    if not actor_id or not session_id:
        raise ValueError("actor_id and session_id are required")
    if not isinstance(nonce, str) or len(nonce) < 16:
        raise ValueError("IPC nonce must contain at least 16 characters")
    if not 1 <= ttl_seconds <= 30:
        raise ValueError("IPC ttl_seconds must be between 1 and 30")
    if plan_hash is not None and (
        not isinstance(plan_hash, str)
        or len(plan_hash) != 64
    ):
        raise ValueError("plan_hash must be a SHA-256 digest")

    issued_at = int(time.time()) if now is None else int(now)
    body = {
        "schemaVersion": "2.0",
        "actorId": actor_id,
        "sessionId": session_id,
        "action": action,
        "payload": payload,
        "nonce": nonce,
        "issuedAt": issued_at,
        "expiresAt": issued_at + ttl_seconds,
        "planHash": plan_hash,
        "capabilityId": capability_id,
        "capabilityVersion": capability_version,
    }
    body["signature"] = _encode(
        hmac.new(secret, canonical_json(body), hashlib.sha256).digest()
    )
    return body


def _prune_nonces(
    used_nonces: MutableMapping[str, int] | MutableSet[str],
    now: int,
) -> None:
    if isinstance(used_nonces, MutableMapping):
        for nonce, expires_at in list(used_nonces.items()):
            if int(expires_at) < now:
                del used_nonces[nonce]


def verify_envelope(
    secret: bytes,
    envelope: dict,
    *,
    used_nonces: MutableMapping[str, int] | MutableSet[str],
    now: int | None = None,
    max_clock_skew_seconds: int = 5,
    expected_actor_id: str | None = None,
    expected_session_id: str | None = None,
    expected_action: str | None = None,
    expected_plan_hash: str | None = None,
) -> dict:
    _validate_secret(secret)
    current = int(time.time()) if now is None else int(now)
    _prune_nonces(used_nonces, current)

    signature = envelope.get("signature")
    if not isinstance(signature, str):
        raise ValueError("IPC signature is required")
    body = dict(envelope)
    body.pop("signature", None)

    if body.get("schemaVersion") not in {"1.0", "2.0"}:
        raise ValueError("unsupported IPC schemaVersion")
    if body.get("schemaVersion") == "2.0" and body.get("action") not in ACTIONS:
        raise ValueError("unsupported capability IPC action")
    if not body.get("actorId") or not body.get("sessionId"):
        raise ValueError("IPC actorId and sessionId are required")
    if not isinstance(body.get("nonce"), str) or len(body["nonce"]) < 16:
        raise ValueError("IPC nonce is invalid")
    if not isinstance(body.get("issuedAt"), int) or not isinstance(
        body.get("expiresAt"), int
    ):
        raise ValueError("IPC timestamps must be integers")
    lifetime = body["expiresAt"] - body["issuedAt"]
    if lifetime < 1 or lifetime > 30:
        raise ValueError("IPC envelope lifetime is invalid")
    if body["issuedAt"] > current + max_clock_skew_seconds:
        raise ValueError("IPC envelope is from the future")
    if body["expiresAt"] < current - max_clock_skew_seconds:
        raise ValueError("IPC envelope expired")
    if body["nonce"] in used_nonces:
        raise ValueError("IPC nonce replay detected")

    expected = hmac.new(
        secret,
        canonical_json(body),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(expected, _decode(signature)):
        raise ValueError("IPC signature mismatch")

    expectations = {
        "actorId": expected_actor_id,
        "sessionId": expected_session_id,
        "action": expected_action,
        "planHash": expected_plan_hash,
    }
    for field, expected_value in expectations.items():
        if expected_value is not None and body.get(field) != expected_value:
            raise ValueError(f"IPC {field} binding mismatch")

    if isinstance(used_nonces, MutableMapping):
        used_nonces[body["nonce"]] = body["expiresAt"] + 120
    else:
        used_nonces.add(body["nonce"])
    return body
