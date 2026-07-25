# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from collections.abc import MutableMapping, MutableSet

from .execution_authority import ExecutionAuthorization
from .production_evidence import CapabilityProductionEvidence
from .util import canonical_json


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise ValueError("execution ticket signature encoding is invalid") from exc


def _secret(secret: bytes) -> None:
    if not isinstance(secret, bytes) or len(secret) < 32:
        raise ValueError("execution ticket secret must contain at least 32 bytes")


class ExecutionTicketIssuer:
    def __init__(self, secret: bytes) -> None:
        _secret(secret)
        self.secret = secret

    def issue(
        self,
        *,
        authorization: ExecutionAuthorization,
        evidence: CapabilityProductionEvidence,
        nonce: str | None = None,
        ttl_seconds: int = 20,
        now: int | None = None,
    ) -> dict:
        if not authorization.production_eligible:
            raise PermissionError("execution authorization is not production-eligible")
        if not authorization.evidence_chain_verified:
            raise PermissionError("production evidence chain is not verified")
        if authorization.evidence_sha256 != evidence.evidence_sha256:
            raise PermissionError("execution authorization evidence binding mismatch")
        if not 1 <= ttl_seconds <= 30:
            raise ValueError("execution ticket ttl_seconds must be between 1 and 30")
        nonce = nonce or secrets.token_urlsafe(18)
        if len(nonce) < 16:
            raise ValueError("execution ticket nonce must contain at least 16 characters")
        issued_at = int(time.time()) if now is None else int(now)
        body = {
            "schemaVersion": "1.0",
            "kind": "capability-execution-ticket",
            "release": "0.5.0",
            "ticketId": secrets.token_hex(16),
            "nonce": nonce,
            "actorId": authorization.actor_id,
            "sessionId": authorization.session_id,
            "capabilityId": authorization.capability_id,
            "capabilityVersion": authorization.capability_version,
            "planHash": authorization.plan_hash,
            "sandboxProfile": authorization.sandbox_profile,
            "productionEligible": True,
            "evidenceSha256": evidence.evidence_sha256,
            "authorityAttestationSha256": evidence.authority_attestation_sha256,
            "postgresAttestationSha256": evidence.postgres_attestation_sha256,
            "sandboxAttestationSha256": evidence.sandbox_attestation_sha256,
            "policyDecisionSha256": evidence.policy_decision_sha256,
            "capabilityPackageSha256": evidence.capability_package_sha256,
            "runtimeReadinessSha256": evidence.runtime_readiness_sha256,
            "issuedAt": issued_at,
            "expiresAt": issued_at + ttl_seconds,
        }
        body["signature"] = _encode(
            hmac.new(self.secret, canonical_json(body), hashlib.sha256).digest()
        )
        return body


def verify_execution_ticket(
    secret: bytes,
    ticket: dict,
    *,
    used_nonces: MutableMapping[str, int] | MutableSet[str],
    expected_actor_id: str,
    expected_session_id: str,
    expected_capability_id: str,
    expected_capability_version: str,
    expected_plan_hash: str,
    expected_evidence_sha256: str,
    now: int | None = None,
    max_clock_skew_seconds: int = 5,
) -> dict:
    _secret(secret)
    current = int(time.time()) if now is None else int(now)
    if isinstance(used_nonces, MutableMapping):
        for nonce, expires_at in list(used_nonces.items()):
            if int(expires_at) < current:
                del used_nonces[nonce]

    signature = ticket.get("signature")
    if not isinstance(signature, str):
        raise ValueError("execution ticket signature is required")
    body = dict(ticket)
    body.pop("signature", None)

    if (
        body.get("schemaVersion") != "1.0"
        or body.get("kind") != "capability-execution-ticket"
        or body.get("release") != "0.5.0"
    ):
        raise ValueError("invalid capability execution ticket")
    if body.get("productionEligible") is not True:
        raise PermissionError("execution ticket is not production-eligible")
    if not isinstance(body.get("nonce"), str) or len(body["nonce"]) < 16:
        raise ValueError("execution ticket nonce is invalid")
    if body["nonce"] in used_nonces:
        raise ValueError("execution ticket nonce replay detected")
    if not isinstance(body.get("issuedAt"), int) or not isinstance(
        body.get("expiresAt"), int
    ):
        raise ValueError("execution ticket timestamps must be integers")
    lifetime = body["expiresAt"] - body["issuedAt"]
    if lifetime < 1 or lifetime > 30:
        raise ValueError("execution ticket lifetime is invalid")
    if body["issuedAt"] > current + max_clock_skew_seconds:
        raise ValueError("execution ticket is from the future")
    if body["expiresAt"] < current - max_clock_skew_seconds:
        raise ValueError("execution ticket expired")

    expected_signature = hmac.new(
        secret, canonical_json(body), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(expected_signature, _decode(signature)):
        raise ValueError("execution ticket signature mismatch")

    bindings = {
        "actorId": expected_actor_id,
        "sessionId": expected_session_id,
        "capabilityId": expected_capability_id,
        "capabilityVersion": expected_capability_version,
        "planHash": expected_plan_hash,
        "evidenceSha256": expected_evidence_sha256,
    }
    for field, expected in bindings.items():
        if body.get(field) != expected:
            raise ValueError(f"execution ticket {field} binding mismatch")

    if isinstance(used_nonces, MutableMapping):
        used_nonces[body["nonce"]] = body["expiresAt"] + 120
    else:
        used_nonces.add(body["nonce"])
    return body
