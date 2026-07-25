#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import platform
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

EXCLUDED_NAMES = {
    "auth.json",
    "auth-master.key",
    "first-owner-setup.token",
}
EXCLUDED_TOP_LEVEL = {
    "documents",
    "memory",
    "knowledge",
    "models",
    "skills",
    "licenses",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    workspace = args.workspace.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="noesar-support-") as directory:
        root = Path(directory)
        summary = {
            "createdUtc": datetime.now(timezone.utc).isoformat(),
            "platform": platform.platform(),
            "python": platform.python_version(),
            "workspaceExists": workspace.is_dir(),
            "included": [],
            "excludedPolicy": {
                "names": sorted(EXCLUDED_NAMES),
                "topLevel": sorted(EXCLUDED_TOP_LEVEL),
            },
        }

        for relative in [
            Path("audit/events.jsonl"),
            Path("logs"),
            Path("state/state.json"),
        ]:
            source = workspace / relative
            if not source.exists():
                continue
            if relative.parts and relative.parts[0] in EXCLUDED_TOP_LEVEL:
                continue
            if source.is_file():
                if source.name in EXCLUDED_NAMES:
                    continue
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
                summary["included"].append(relative.as_posix())
            else:
                for item in source.rglob("*"):
                    if not item.is_file() or item.name in EXCLUDED_NAMES:
                        continue
                    rel = item.relative_to(workspace)
                    if rel.parts[0] in EXCLUDED_TOP_LEVEL:
                        continue
                    target = root / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(item.read_bytes())
                    summary["included"].append(rel.as_posix())

        (root / "support-summary.json").write_text(
            json.dumps(summary, indent=2) + "\n",
            encoding="utf-8",
        )

        with tarfile.open(args.output, "w:gz") as archive:
            for item in sorted(root.rglob("*")):
                if item.is_file():
                    archive.add(item, arcname=item.relative_to(root))

    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
