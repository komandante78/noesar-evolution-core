#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    failures: list[str] = []

    metadata = json.loads(
        (ROOT / "PACKAGE_METADATA.json").read_text(encoding="utf-8")
    )
    expected = {
        "version": "0.6.0",
        "nodeReferenceTests": 112,
        "rustProvenanceTests": 6,
        "authorityProtocolVersion": "1.1",
        "authorityMaxFrameBytes": 1048576,
        "rustAuthorityDaemonSource": True,
        "rustLinuxSoPeerCredSource": True,
        "rustLockedBuildScript": True,
        "rustBuildProvenanceTooling": True,
        "cargoLockIncluded": False,
        "rustBuildExecuted": False,
        "rustTestsExecuted": False,
        "rustBinaryIncluded": False,
        "postgresMigrationCount": 12,
        "postgresProductionAttestationLedger": True,
        "postgresProductionGate": True,
        "postgresAuditHashChainGuard": True,
        "postgresExecuted": False,
        "pgvectorExecuted": False,
        "productionReady": False,
        "finalProductReady": False,
        "final": False,
    }
    for field, value in expected.items():
        if metadata.get(field) != value:
            failures.append(f"metadata:{field}")

    # NOTE: this consolidated, zip-free candidate does not embed baseline/master/
    # release archives (NESTED_ZIPS=0 by design). Embedded-archive integrity
    # checks were removed here; historical packaging archives' sha256 sidecars
    # are preserved under evidence/history/master-packaging/ instead.

    for path in ROOT.rglob("*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            failures.append(f"json:{path.relative_to(ROOT)}:{exc}")

    for path in ROOT.rglob("*.sh"):
        result = subprocess.run(
            ["sh", "-n", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            failures.append(f"shell:{path.relative_to(ROOT)}")

    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if package.get("version") != "0.6.0":
        failures.append("node-package-version")

    migrations = json.loads(
        (ROOT / "database/postgres/MIGRATIONS.json").read_text(encoding="utf-8")
    )
    if (
        migrations.get("schemaVersion") != "4.0"
        or migrations.get("release") != "0.6.0"
        or migrations.get("baselineV050Preserved") is not True
        or len(migrations.get("migrations", [])) != 12
    ):
        failures.append("migration-manifest")

    required_tokens = {
        "services/reference-control-plane/src/authority-external-client.mjs": [
            "authority socket path must be absolute",
            "must not be world-writable",
            "must not be a symlink",
            "authority response ${field} binding mismatch",
            "serverPeerCredentialsVerified:false",
            "productionEligible:false",
        ],
        "rust/crates/noesar-authority-daemon/src/lib.rs": [
            "SO_PEERCRED",
            "DaemonPolicy",
            "verify_peer",
            "one authority request per connection is required",
            "production_ready: false",
        ],
        "rust/crates/noesar-authority-daemon/src/main.rs": [
            "NOESAR_AUTHORITY_SOCKET",
            "NOESAR_AUTHORITY_ALLOWED_UIDS",
            "NOESAR_AUTHORITY_HMAC_SECRET_FILE",
            "from_mode(0o600)",
            "non-Linux peer-credential transports remain unimplemented",
        ],
        "database/postgres/0011_production_attestation_ledger.sql": [
            "noesar_runtime.production_attestations",
            "noesar_runtime.production_gate",
            "noesar_production_attestations_immutable",
            "penetration-test",
        ],
        "database/postgres/0012_audit_chain_and_release_gate.sql": [
            "noesar_audit.enforce_hash_chain",
            "pg_advisory_xact_lock",
            "repeat('0', 64)",
            "count(*) = 12",
            "audit_hash_chain_guard",
            "production_attestation_ledger_immutable",
        ],
        "rust/build-authority-release.sh": [
            "cargo test --workspace --locked --all-targets",
            "Cargo.lock is required",
            "NOESAR_RUST_TEST_REPORT",
            "NOESAR_AUTHORITY_CONFORMANCE_REPORT",
        ],
    }
    for rel, tokens in required_tokens.items():
        text = (ROOT / rel).read_text(encoding="utf-8")
        for token in tokens:
            if token not in text:
                failures.append(f"source:{rel}:{token}")

    status = (ROOT / "STATUS.md").read_text(encoding="utf-8")
    for token in [
        "RUST_BUILD=NOT_EXECUTED",
        "RUST_TESTS=NOT_EXECUTED",
        "RUST_CANONICAL_AUTHORITY=false",
        "POSTGRES_EXECUTION=NOT_EXECUTED",
        "POSTGRES_MIGRATION_COUNT=12",
        "B001_RUST_SECURITY_KERNEL=OPEN",
        "B005_POSTGRES_DATA_PLANE=OPEN",
        "PRODUCTION_READY=false",
    ]:
        if token not in status:
            failures.append(f"status:{token}")

    env = {
        **os.environ,
        "NOESAR_SMOKE_PORT": "19076",
        "NOESAR_PYTHON": "/usr/bin/python3",
    }
    tests = subprocess.run(
        ["sh", "scripts/test.sh"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    output = tests.stdout + tests.stderr
    if (
        tests.returncode != 0
        or "# tests 112" not in output
        or "# pass 112" not in output
        or "# fail 0" not in output
        or "SOURCE_VERIFY=PASS" not in output
        or "AUTH_HTTP_SMOKE=PASS" not in output
        or "MIGRATIONS=12" not in output
        or "RUST_AUTHORITY_DAEMON_SOURCE=PASS" not in output
        or "Ran 6 tests" not in output
        or "OK" not in output
    ):
        failures.append("complete-test-suite")

    pem = re.compile(
        rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
        rb"\s+[A-Za-z0-9+/=\r\n]{80,}"
        rb"-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    )
    tokens = [
        re.compile(rb"\bAKIA[0-9A-Z]{16}\b"),
        re.compile(rb"\bghp_[A-Za-z0-9]{30,}\b"),
        re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    ]
    for path in ROOT.rglob("*"):
        if (
            not path.is_file()
            or path.suffix.lower() == ".zip"
            or path.stat().st_size > 5 * 1024 * 1024
        ):
            continue
        data = path.read_bytes()
        if pem.search(data) or any(pattern.search(data) for pattern in tokens):
            failures.append(f"secret:{path.relative_to(ROOT)}")

    if failures:
        print("VERDICT=FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("VERDICT=PASS")
    print("NODE_REFERENCE_TESTS=112/112 PASS")
    print("RUST_PROVENANCE_TESTS=6/6 PASS")
    print("AUTHORITY_EXTERNAL_CLIENT=PASS")
    print("RUST_AUTHORITY_DAEMON_SOURCE=PASS")
    print("POSTGRES_MIGRATIONS=12")
    print("POSTGRES_PRODUCTION_GATE_CONTRACT=PASS")
    print("POSTGRES_AUDIT_CHAIN_CONTRACT=PASS")
    print("PRODUCTION_READY=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
