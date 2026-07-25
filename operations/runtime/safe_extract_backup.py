#!/usr/bin/env python3
from __future__ import annotations

import sys
import tarfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: safe_extract_backup.py ARCHIVE DESTINATION", file=sys.stderr)
        return 2

    archive = Path(sys.argv[1]).resolve()
    destination = Path(sys.argv[2]).resolve()
    destination.mkdir(parents=True, exist_ok=True)

    with tarfile.open(archive, "r:gz") as tf:
        members = tf.getmembers()
        for member in members:
            name = member.name.replace("\\", "/")
            parts = [part for part in name.split("/") if part not in ("", ".")]
            if name.startswith("/") or ".." in parts:
                raise SystemExit(f"Unsafe backup path: {name}")
            if member.issym() or member.islnk():
                raise SystemExit(f"Links are not accepted during restore: {name}")
            if member.isdev():
                raise SystemExit(f"Device entries are not accepted during restore: {name}")

            target = (destination / Path(*parts)).resolve()
            if destination != target and destination not in target.parents:
                raise SystemExit(f"Backup entry escapes destination: {name}")

        tf.extractall(destination, members=members, filter="data")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
