#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="noesar-v050-readiness-") as directory:
        temp = Path(directory)
        values = {
            "authority": {
                "compiled": True,
                "testsPassed": True,
                "conformancePassed": True,
                "authenticatedIpc": True,
                "peerCredentialsVerified": True,
                "provenanceVerified": True,
            },
            "postgres": {
                "connected": True,
                "postgresMajor": 18,
                "pgvectorVersion": "0.8.0",
                "migrationsVerified": True,
                "roleSeparationVerified": True,
                "rowLevelSecurityVerified": True,
                "immutableLedgersVerified": True,
                "repositoryAdapterActive": True,
                "backupRestoreVerified": True,
            },
            "sandbox": {
                "adapterIntegrated": True,
                "attestationVerified": True,
                "escapeTestsPassed": True,
            },
            "platform": {"allSupportedTargetsPassed": True},
            "update": {"tuf": True, "sigstore": True, "slsa": True},
            "pentest": {"independent": True, "passed": True},
        }
        paths = {}
        for name, value in values.items():
            path = temp / f"{name}.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            paths[name] = path

        command = [
            "python3",
            str(ROOT / "operations/runtime/compile-production-readiness.py"),
            "--authority", str(paths["authority"]),
            "--postgres", str(paths["postgres"]),
            "--sandbox", str(paths["sandbox"]),
            "--platform-matrix", str(paths["platform"]),
            "--update-trust", str(paths["update"]),
            "--penetration-test", str(paths["pentest"]),
        ]
        valid = subprocess.run(command, capture_output=True, text=True)
        if valid.returncode != 0:
            raise RuntimeError(valid.stdout + valid.stderr)
        value = json.loads(valid.stdout)
        if value["productionReady"] is not True or value["blockers"]:
            raise RuntimeError("complete evidence was not accepted")

        values["authority"]["compiled"] = False
        paths["authority"].write_text(
            json.dumps(values["authority"]),
            encoding="utf-8",
        )
        blocked = subprocess.run(command, capture_output=True, text=True)
        if blocked.returncode != 2:
            raise RuntimeError("incomplete evidence did not block readiness")
        value = json.loads(blocked.stdout)
        if value["productionReady"] is not False:
            raise RuntimeError("incomplete evidence was production-ready")
        if "rustAuthority" not in value["blockers"]:
            raise RuntimeError("Rust blocker was not reported")

    print("PRODUCTION_READINESS_COMPILER_SMOKE=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
