#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A second implementation of the @noesar/capability-token wire format, written from
SPEC.md rather than translated from the JavaScript. Its only purpose is to be run against
conformance/vectors.json — see run_vectors.py — as the proof that the format is portable and
not accidentally coupled to Node's crypto module or to JavaScript's number formatting.

This is a conformance oracle, not a product component. Nothing in this repository imports it.
"""

import hashlib
import hmac as hmac_module

LIMIT_DIMENSIONS = (
    "memoryBytes",
    "cpuSeconds",
    "openFiles",
    "processes",
    "fileSizeBytes",
    "coreDumpBytes",
)

OPERATIONS = ("READ", "WRITE", "DELETE", "EXECUTE")


class CapabilityTokenFormatError(Exception):
    def __init__(self, kind, reason):
        super().__init__(reason)
        self.kind = kind


def canonical_limits(limits):
    """CT-003. `-` for an unset dimension, `none` for no envelope at all — never omit a
    dimension, and never let an unset value collide with an explicit zero."""
    if not limits:
        return "none"
    parts = []
    for dimension in LIMIT_DIMENSIONS:
        value = limits.get(dimension)
        parts.append(f"{dimension}={'-' if value is None else value}")
    return ";".join(parts)


def _feed_field(mac, value):
    """CT-002. UTF-8 bytes of `str(value)`, then its length as 8 raw bytes, little-endian.
    Python's `int.to_bytes` needs the width and byte order named explicitly — unlike
    JavaScript's `Buffer.writeBigUInt64LE`, there is no implicit default here, which is
    exactly the kind of silent divergence this vector suite exists to catch."""
    text = str(value)
    data = text.encode("utf-8")
    mac.update(data)
    mac.update(len(data).to_bytes(8, byteorder="little", signed=False))


def _feed_token(mac, token):
    """CT-004. The exact pre-image order: id, planDigest, stepId, each path in order, each
    operation lowercased in order, expiresAtUnix and usesGranted as decimal strings, then the
    canonical limits string."""
    _feed_field(mac, token["id"])
    _feed_field(mac, token["planDigest"])
    _feed_field(mac, token["stepId"])
    for path in token["paths"]:
        _feed_field(mac, path)
    for operation in token["operations"]:
        if operation not in OPERATIONS:
            raise CapabilityTokenFormatError("UNKNOWN_OPERATION", f"unknown operation `{operation}`")
        _feed_field(mac, operation.lower())
    # Python's str() of an int never grows a decimal point or scientific notation the way a
    # float would, which is exactly what "decimal string" in CT-004 requires — but only because
    # every caller here passes an int, never a float, for these two fields.
    _feed_field(mac, str(token["expiresAtUnix"]))
    _feed_field(mac, str(token["usesGranted"]))
    _feed_field(mac, canonical_limits(token.get("limits")))


def _require_secret(secret):
    if not isinstance(secret, (bytes, bytearray)) or len(secret) < 32:
        raise CapabilityTokenFormatError(
            "SECRET_TOO_SHORT", "a capability signing secret must be at least 32 bytes"
        )


def sign(token, secret):
    """CT-005. HMAC-SHA256 over the CT-004 pre-image. Returns lowercase hex."""
    _require_secret(secret)
    mac = hmac_module.new(secret, digestmod=hashlib.sha256)
    _feed_token(mac, token)
    return mac.hexdigest()


def verify(token, secret):
    """CT-006. Constant-time comparison via `hmac.compare_digest` — Python's own standard
    library already refuses to be a timing oracle here, which is the same property
    `node:crypto.timingSafeEqual` gives the JavaScript side."""
    _require_secret(secret)
    expected = sign(token, secret)
    supplied = str(token.get("mac", ""))
    return hmac_module.compare_digest(expected, supplied)
