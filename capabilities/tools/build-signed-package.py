#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--payload-root", required=True, type=Path)
    parser.add_argument("--private-key", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    payload = []
    for descriptor in manifest.get("payload", []):
        path = (args.payload_root / descriptor["path"]).resolve()
        root = args.payload_root.resolve()
        if path != root and root not in path.parents:
            raise SystemExit(f"payload path escaped root: {descriptor['path']}")
        data = path.read_bytes()
        payload.append((descriptor["path"], data))
        descriptor["bytes"] = len(data)
        descriptor["sha256"] = hashlib.sha256(data).hexdigest()

    manifest_bytes = canonical_json(manifest)
    with tempfile.TemporaryDirectory() as directory:
        message = Path(directory) / "manifest.json"
        signature = Path(directory) / "manifest.sig"
        message.write_bytes(manifest_bytes)
        result = subprocess.run([
            "openssl", "pkeyutl", "-sign",
            "-inkey", str(args.private_key),
            "-rawin", "-in", str(message),
            "-out", str(signature),
        ], capture_output=True, text=True)
        if result.returncode:
            raise SystemExit(result.stderr)
        with ZipFile(args.output, "w", ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", manifest_bytes)
            archive.writestr("manifest.sig", signature.read_bytes())
            for path, data in payload:
                archive.writestr(path, data)
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
