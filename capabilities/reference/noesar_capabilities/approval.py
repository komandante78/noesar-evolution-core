# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

from .identity import Principal
from .util import canonical_json


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_token(
    secret: bytes,
    *,
    principal: Principal,
    capability_id: str,
    version: str,
    plan_hash: str,
    scope: str = "operation",
    ttl_seconds: int = 300,
) -> str:
    if ttl_seconds < 1 or ttl_seconds > 3600:
        raise ValueError("approval TTL must be between 1 and 3600 seconds")
    now = int(time.time())
    payload = {
        "capabilityId": capability_id,
        "version": version,
        "planHash": plan_hash,
        "scope": scope,
        "actorId": principal.actor_id,
        "role": principal.role,
        "sessionId": principal.session_id,
        "organizationId": principal.organization_id,
        "projectId": principal.project_id,
        "issuedAt": now,
        "expiresAt": now + ttl_seconds,
        "nonce": secrets.token_hex(16),
    }
    encoded = base64.urlsafe_b64encode(canonical_json(payload)).rstrip(b"=")
    signature = hmac.new(secret, encoded, hashlib.sha256).digest()
    return (
        encoded.decode("ascii")
        + "."
        + base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")
    )


def verify_token(
    secret: bytes,
    token: str,
    *,
    principal: Principal,
    capability_id: str,
    version: str,
    plan_hash: str,
) -> dict:
    try:
        encoded_text, signature_text = token.split(".", 1)
        encoded = encoded_text.encode("ascii")
        expected = hmac.new(secret, encoded, hashlib.sha256).digest()
        supplied = _decode(signature_text)
        if not hmac.compare_digest(expected, supplied):
            raise ValueError("approval signature mismatch")
        payload = json.loads(_decode(encoded_text))
    except Exception as exc:
        raise ValueError("invalid approval token") from exc

    expected_fields = {
        "capabilityId": capability_id,
        "version": version,
        "planHash": plan_hash,
        "actorId": principal.actor_id,
        "role": principal.role,
        "sessionId": principal.session_id,
        "organizationId": principal.organization_id,
        "projectId": principal.project_id,
    }
    for key, expected_value in expected_fields.items():
        if payload.get(key) != expected_value:
            raise ValueError(f"approval {key} mismatch")
    if int(time.time()) > int(payload["expiresAt"]):
        raise ValueError("approval token expired")
    return payload
