#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def load(path: Path) -> dict:
    if not path.is_file():
        raise ValueError(f"evidence file missing: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--authority", required=True, type=Path)
    parser.add_argument("--postgres", required=True, type=Path)
    parser.add_argument("--sandbox", required=True, type=Path)
    parser.add_argument("--platform-matrix", required=True, type=Path)
    parser.add_argument("--update-trust", required=True, type=Path)
    parser.add_argument("--penetration-test", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    evidence = {
        "authority": load(args.authority),
        "dataPlane": load(args.postgres),
        "sandbox": load(args.sandbox),
        "platformMatrix": load(args.platform_matrix),
        "updateTrust": load(args.update_trust),
        "penetrationTest": load(args.penetration_test),
    }
    checks = {
        "rustAuthority": all([
            evidence["authority"].get("compiled"),
            evidence["authority"].get("testsPassed"),
            evidence["authority"].get("conformancePassed"),
            evidence["authority"].get("authenticatedIpc"),
            evidence["authority"].get("peerCredentialsVerified"),
            evidence["authority"].get("provenanceVerified"),
        ]),
        "postgresDataPlane": all([
            evidence["dataPlane"].get("connected"),
            int(evidence["dataPlane"].get("postgresMajor", 0)) >= 18,
            evidence["dataPlane"].get("pgvectorVersion"),
            evidence["dataPlane"].get("migrationsVerified"),
            evidence["dataPlane"].get("roleSeparationVerified"),
            evidence["dataPlane"].get("rowLevelSecurityVerified"),
            evidence["dataPlane"].get("immutableLedgersVerified"),
            evidence["dataPlane"].get("repositoryAdapterActive"),
            evidence["dataPlane"].get("backupRestoreVerified"),
        ]),
        "productionSandbox": all([
            evidence["sandbox"].get("adapterIntegrated"),
            evidence["sandbox"].get("attestationVerified"),
            evidence["sandbox"].get("escapeTestsPassed"),
        ]),
        "platformMatrix": bool(
            evidence["platformMatrix"].get("allSupportedTargetsPassed")
        ),
        "updateTrust": all([
            evidence["updateTrust"].get("tuf"),
            evidence["updateTrust"].get("sigstore"),
            evidence["updateTrust"].get("slsa"),
        ]),
        "penetrationTest": all([
            evidence["penetrationTest"].get("independent"),
            evidence["penetrationTest"].get("passed"),
        ]),
    }
    blockers = [name for name, passed in checks.items() if not passed]
    result = {
        "schemaVersion": "1.0",
        "release": "0.5.0",
        "productionReady": not blockers,
        "checks": checks,
        "blockers": blockers,
    }
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if not blockers else 2


if __name__ == "__main__":
    raise SystemExit(main())
