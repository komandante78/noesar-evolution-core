#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--signature", required=True, type=Path)
    parser.add_argument("--public-key", required=True, type=Path)
    parser.add_argument("--artifact", required=True, type=Path)
    args = parser.parse_args()

    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    expected = metadata["artifact"]["sha256"]
    actual = digest(args.artifact)
    if expected != actual:
        print("VERDICT=FAIL")
        print("REASON=artifact_sha256_mismatch")
        return 1

    result = subprocess.run([
        "openssl", "pkeyutl", "-verify", "-pubin",
        "-inkey", str(args.public_key),
        "-rawin", "-in", str(args.metadata),
        "-sigfile", str(args.signature)
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print("VERDICT=FAIL")
        print("REASON=signature_invalid")
        return 1

    print("VERDICT=PASS")
    print(f"ARTIFACT_SHA256={actual}")
    print(f"VERSION={metadata.get('version', 'unknown')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
