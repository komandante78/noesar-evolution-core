#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
POSTGRES = ROOT / "database/postgres-baseline-v0.5.0"
BASELINE = ROOT / "database/postgres-baseline-v0.4.0"
LEGACY = ROOT / "database/postgres-legacy-v0.3.0"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    manifest = json.loads(
        (POSTGRES / "MIGRATIONS.json").read_text(encoding="utf-8")
    )
    if (
        manifest.get("schemaVersion") != "3.0"
        or manifest.get("release") != "0.5.0"
        or manifest.get("legacyV030Executable") is not False
        or manifest.get("baselineV040Preserved") is not True
    ):
        raise SystemExit("invalid V0.5.0 migration manifest")
    if len(manifest.get("migrations", [])) != 10:
        raise SystemExit("V0.5.0 requires exactly ten migrations")

    legacy = (LEGACY / "LEGACY_STATUS.md").read_text(encoding="utf-8")
    if (
        "LEGACY_MIGRATION_SET=INVALID" not in legacy
        or "EXECUTION_ALLOWED=false" not in legacy
    ):
        raise SystemExit("legacy V0.3.0 quarantine is invalid")

    baseline = json.loads(
        (BASELINE / "MIGRATIONS.json").read_text(encoding="utf-8")
    )
    if baseline.get("release") != "0.4.0":
        raise SystemExit("V0.4.0 baseline was not preserved")

    plan = {
        "schemaVersion": "2.0",
        "release": "0.5.0",
        "legacyV030Rejected": True,
        "baselineV040Preserved": True,
        "manifestSha256": digest(POSTGRES / "MIGRATIONS.json"),
        "migrations": [],
        "postApplyAcceptance": [
            "postgresql-18-or-newer",
            "pgvector-installed",
            "ten-migrations-recorded",
            "forced-row-level-security",
            "immutable-audit-ledger",
            "immutable-migration-ledger",
            "application-role-no-bypassrls",
        ],
    }
    for item in manifest["migrations"]:
        path = POSTGRES / item["filename"]
        if not path.is_file() or digest(path) != item["sha256"]:
            raise SystemExit(f"migration checksum mismatch: {item['filename']}")
        plan["migrations"].append({
            "version": item["version"],
            "filename": item["filename"],
            "sha256": item["sha256"],
            "bytes": path.stat().st_size,
        })

    rendered = json.dumps(plan, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
