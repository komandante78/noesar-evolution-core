#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "reference"))

from noesar_capabilities import CapabilityManager


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--publisher-id", required=True)
    parser.add_argument("--trust-level", required=True)
    parser.add_argument("--public-key", required=True, type=Path)
    parser.add_argument("--package", required=True, type=Path)
    args = parser.parse_args()

    manager = CapabilityManager(args.workspace)
    manager.register_publisher(
        args.publisher_id,
        args.trust_level,
        args.public_key,
    )
    result = manager.verify(args.package)
    print(json.dumps({
        "verdict": "PASS",
        "capabilityId": result["manifest"]["id"],
        "version": result["manifest"]["version"],
        "packageSha256": result["packageSha256"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
