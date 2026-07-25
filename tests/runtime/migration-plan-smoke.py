#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    manifest_path = ROOT / "database/postgres-baseline-v0.5.0/MIGRATIONS.json"
    with tempfile.TemporaryDirectory(prefix="noesar-v050-migration-plan-") as directory:
        output = Path(directory) / "plan.json"
        result = subprocess.run(
            [
                "python3",
                str(ROOT / "operations/runtime/postgres/migration-plan.py"),
                "--output",
                str(output),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stdout + result.stderr)
        value = json.loads(output.read_text(encoding="utf-8"))
        if value["release"] != "0.5.0":
            raise RuntimeError("migration plan release mismatch")
        if value["legacyV030Rejected"] is not True:
            raise RuntimeError("legacy migration was not rejected")
        if value["baselineV040Preserved"] is not True:
            raise RuntimeError("V0.4.0 baseline was not preserved")
        if value["manifestSha256"] != digest(manifest_path):
            raise RuntimeError("migration manifest hash mismatch")
        if len(value["migrations"]) != 10:
            raise RuntimeError("migration count mismatch")
        if [item["version"] for item in value["migrations"]] != [
            f"{number:04d}" for number in range(1, 11)
        ]:
            raise RuntimeError("migration order mismatch")
        if len(value["postApplyAcceptance"]) != 7:
            raise RuntimeError("post-apply acceptance list mismatch")

    print("MIGRATION_PLAN_V050_SMOKE=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
