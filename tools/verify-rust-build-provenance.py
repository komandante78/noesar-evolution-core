#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


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
    args = parser.parse_args()
    value = verify(args.provenance)
    print("VERDICT=PASS")
    print(f"BINARY_SHA256={value['binarySha256']}")
    print(f"SOURCE_TREE_SHA256={value['sourceTreeSha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
