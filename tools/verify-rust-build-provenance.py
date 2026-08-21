#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
from pathlib import Path

# The signature envelope: keys that describe signatures rather than facts. Neither signature
# covers them, which is what lets the symmetric (HMAC) and asymmetric (Ed25519) signatures live
# in one document without invalidating each other.
#
# `publicSignature` was added by `D-0589`. It is spelled in three places — here,
# `create-rust-build-provenance.py`, and `ENVELOPE_KEYS` in `tools/sign-build-provenance.mjs` —
# because they are three programs in two languages and there is no import path between them.
# What binds them is not care: `build-provenance-signature.test.mjs` reads the text of both
# Python files and fails if either set stops matching the JavaScript one. A rule spelled three
# times and checked nowhere is `D-0608` waiting to happen again.
ENVELOPE_KEYS = frozenset(
    {"signature", "signatureAlgorithm", "signingKeyId", "publiclyVerifiable", "publicSignature"}
)


def read_signing_key(path: Path) -> bytes:
    raw = path.read_bytes().strip()
    try:
        return bytes.fromhex(raw.decode("ascii"))
    except (ValueError, UnicodeDecodeError):
        return raw


def verify_signature(value: dict, key: bytes) -> None:
    """Recompute the signature from the document's own fields.

    The payload is rebuilt here from what the document actually contains, never read from a
    field the document supplies: a verdict handed over by the thing being judged is not a
    verdict. `compare_digest` because a byte-at-a-time comparison leaks where it stopped.
    """
    signature = value.get("signature")
    if not isinstance(signature, str) or not signature:
        raise ValueError("provenance is not signed")
    if value.get("signatureAlgorithm") != "HMAC-SHA256":
        raise ValueError("unsupported provenance signature algorithm")
    unsigned = {k: v for k, v in value.items() if k not in ENVELOPE_KEYS}
    payload = json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode("utf-8")
    expected = hmac.new(key, payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError("provenance signature mismatch")


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def required_path(value: object, field: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} is required")
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"{field} does not exist")
    return path


def verify(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if (
        value.get("schemaVersion") != "1.0"
        or value.get("kind") != "rust-build-provenance"
        or value.get("release") != "0.6.0"
    ):
        raise ValueError("invalid Rust build provenance")
    if value.get("testsPassed") is not True:
        raise ValueError("Rust tests were not accepted")
    if value.get("authorityConformancePassed") is not True:
        raise ValueError("authority conformance was not accepted")

    mappings = [
        ("binaryPath", "binarySha256"),
        ("testsReportPath", "testsReportSha256"),
        ("conformanceReportPath", "conformanceReportSha256"),
    ]
    for path_field, hash_field in mappings:
        artifact = required_path(value.get(path_field), path_field)
        if digest(artifact) != value.get(hash_field):
            raise ValueError(f"{hash_field} mismatch")

    workspace = Path(value.get("workspacePath", "")).expanduser().resolve()
    if not workspace.is_dir():
        raise ValueError("workspacePath does not exist")
    for rel, field in [
        ("Cargo.toml", "workspaceManifestSha256"),
        ("Cargo.lock", "cargoLockSha256"),
    ]:
        artifact = workspace / rel
        if not artifact.is_file() or digest(artifact) != value.get(field):
            raise ValueError(f"{field} mismatch")

    for field in [
        "sourceTreeSha256",
        "rustcVersion",
        "cargoVersion",
        "targetTriple",
        "createdUtc",
    ]:
        if not value.get(field):
            raise ValueError(f"{field} is required")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--signing-key-file", required=True, type=Path)
    args = parser.parse_args()
    value = verify(args.provenance)
    verify_signature(value, read_signing_key(args.signing_key_file))
    print("VERDICT=PASS")
    print("PROVENANCE_SIGNED=true")
    print(f"SIGNING_KEY_ID={value.get('signingKeyId')}")
    print(f"BINARY_SHA256={value['binarySha256']}")
    print(f"SOURCE_TREE_SHA256={value['sourceTreeSha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
