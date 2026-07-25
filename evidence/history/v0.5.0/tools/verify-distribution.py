#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    failures = []

    for path in ROOT.rglob("*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            failures.append(f"json:{path.relative_to(ROOT)}:{exc}")

    metadata = json.loads(
        (ROOT / "PACKAGE_METADATA.json").read_text(encoding="utf-8")
    )
    expected = {
        "version": "0.5.0",
        "referenceTests": 90,
        "sandboxAttestationV3": True,
        "productionEvidenceChain": True,
        "executionTicketV1": True,
        "brokerExecutionTicketGate": True,
        "productionSandboxAdapterIntegrated": False,
        "osLevelSandboxPortableVerified": False,
        "productionSandboxAttestationIssued": False,
        "productionEvidenceIssued": False,
        "productionExecutionTicketIssued": False,
        "arbitraryExternalExecutionEnabled": False,
        "final": False,
        "productionReady": False,
    }
    for field, value in expected.items():
        if metadata.get(field) != value:
            failures.append(f"metadata:{field}")

    direct = next(
        (
            item for item in metadata["baselineArchives"]
            if item["storage"] == "direct"
        ),
        None,
    )
    nested = next(
        (
            item for item in metadata["baselineArchives"]
            if item["storage"] == "nested-in-zip2"
        ),
        None,
    )
    if not direct or not nested:
        failures.append("lineage-descriptors")
    else:
        zip2 = ROOT / "BASELINES" / direct["filename"]
        if not zip2.is_file() or digest(zip2) != direct["sha256"]:
            failures.append("zip2-hash")
        else:
            member = f"{Path(direct['filename']).stem}/SOURCE/{nested['filename']}"
            try:
                with zipfile.ZipFile(zip2, "r") as archive:
                    data = archive.read(member)
                if hashlib.sha256(data).hexdigest() != nested["sha256"]:
                    failures.append("zip1-nested-hash")
            except Exception as exc:
                failures.append(f"zip1-nested:{exc}")

    rollback = metadata["rollbackReference"]
    rollback_sidecar = (
        ROOT / "ROLLBACK_REFERENCE" / f"{rollback['filename']}.sha256"
    )
    if (
        rollback.get("embedded") is not False
        or not rollback_sidecar.is_file()
        or rollback_sidecar.read_text(encoding="utf-8").split()[0]
        != rollback["sha256"]
    ):
        failures.append("rollback-reference")

    master = ROOT / "MASTER" / metadata["masterArchive"]["filename"]
    if (
        not master.is_file()
        or digest(master) != metadata["masterArchive"]["sha256"]
    ):
        failures.append("master-hash")

    profiles = ROOT / "security/sandbox-profiles.json"
    if digest(profiles) != metadata["sandboxProfileSha256"]:
        failures.append("sandbox-profile-hash")
    profile = json.loads(profiles.read_text(encoding="utf-8"))
    if (
        profile.get("schemaVersion") != "5.0"
        or profile.get("release") != "0.5.0"
        or profile["profiles"]["os-isolated"].get(
            "executionTicketRequired"
        ) is not True
    ):
        failures.append("sandbox-profile-version")

    env = {**os.environ, "PYTHONPATH": str(ROOT / "reference")}
    tests = subprocess.run(
        [
            sys.executable, "-m", "unittest", "discover",
            "-s", str(ROOT / "reference/tests"),
            "-p", "test_*.py", "-q",
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    output = tests.stdout + tests.stderr
    if (
        tests.returncode != 0
        or "Ran 90 tests" not in output
        or "OK" not in output
    ):
        failures.append("reference-tests")

    sdk = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from noesar_sdk import "
                "ProductionSandboxAttestationV3, "
                "CapabilityProductionEvidenceV1, "
                "CapabilityExecutionTicketV1; "
                "print('SDK_V050_IMPORT=PASS')"
            ),
        ],
        env={**os.environ, "PYTHONPATH": str(ROOT / "sdk/python")},
        capture_output=True,
        text=True,
        timeout=60,
    )
    if sdk.returncode != 0 or "SDK_V050_IMPORT=PASS" not in sdk.stdout:
        failures.append("sdk-import")

    source_checks = {
        "reference/noesar_capabilities/production_evidence.py": [
            "CapabilityProductionEvidence",
            "authority protocol V1.1 is required",
            "PostgreSQL 18 or newer is required",
            "runtime readiness is not production-ready",
            "sandbox {field} binding mismatch",
        ],
        "reference/noesar_capabilities/execution_ticket.py": [
            "capability-execution-ticket",
            "execution ticket nonce replay detected",
            "production evidence chain is not verified",
            "execution ticket {field} binding mismatch",
        ],
        "reference/noesar_capabilities/execution_authority.py": [
            "authorize_production",
            "evidence_chain_verified=True",
            "production_eligible=True",
            "production capability authorization requires os-isolated",
        ],
        "reference/noesar_capabilities/sandbox_attestation.py": [
            'schema_version not in {"2.0", "3.0"}',
            "authority protocol V1.1 is required",
            "runtime V0.5.0 is required",
            "sandbox planHash mismatch",
        ],
        "reference/noesar_capabilities/sandbox.py": [
            "verified V0.5.0 execution ticket and bindings are required",
            "verify_execution_ticket",
            "production sandbox adapter is not integrated",
            "arbitrary external execution is denied",
            "shell=False",
        ],
    }
    for rel, tokens in source_checks.items():
        text = (ROOT / rel).read_text(encoding="utf-8")
        for token in tokens:
            if token not in text:
                failures.append(f"source:{rel}:{token}")

    pyproject = (ROOT / "sdk/python/pyproject.toml").read_text(
        encoding="utf-8"
    )
    ts_package = json.loads(
        (ROOT / "sdk/typescript/package.json").read_text(encoding="utf-8")
    )
    if 'version = "0.5.0"' not in pyproject:
        failures.append("python-sdk-version")
    if ts_package.get("version") != "0.5.0":
        failures.append("typescript-sdk-version")

    status = (ROOT / "STATUS.md").read_text(encoding="utf-8")
    for token in [
        "SANDBOX_ATTESTATION_V3=IMPLEMENTED",
        "PRODUCTION_EVIDENCE_CHAIN=IMPLEMENTED",
        "EXECUTION_TICKET_V1=IMPLEMENTED",
        "BROKER_EXECUTION_TICKET_GATE=IMPLEMENTED",
        "PRODUCTION_SANDBOX_ADAPTER=NOT_INTEGRATED",
        "PRODUCTION_EVIDENCE=NOT_ISSUED",
        "ARBITRARY_EXTERNAL_CAPABILITY_EXECUTION=DENIED",
        "B003_CLOSED=false",
        "H005_CLOSED=false",
    ]:
        if token not in status:
            failures.append(f"status:{token}")

    if failures:
        print("VERDICT=FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("VERDICT=PASS")
    print("LINEAGE_HASHES=PASS")
    print("SANDBOX_PROFILE_V050=PASS")
    print("REFERENCE_TESTS=90/90 PASS")
    print("SDK_V050_IMPORT=PASS")
    print("PRODUCTION_EVIDENCE_CHAIN_STATIC=PASS")
    print("EXECUTION_TICKET_V1_STATIC=PASS")
    print("BROKER_EXECUTION_TICKET_GATE_STATIC=PASS")
    print("ARBITRARY_EXTERNAL_EXECUTION=DENIED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
