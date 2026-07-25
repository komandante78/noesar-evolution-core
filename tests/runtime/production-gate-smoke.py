#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# NOTE: verify-production-attestations.py was never carried into this candidate
# during import (no "runtime/bin/" tree exists anywhere in PRODUCT). This smoke
# test is BLOCKED until that verifier module is sourced or reimplemented.
# See REPORTS/CODE_CONSOLIDATION_V1/11_OPEN_BLOCKERS.txt.
VERIFIER_PATH = ROOT / "runtime/bin/verify-production-attestations.py"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_verifier():
    spec = importlib.util.spec_from_file_location(
        "noesar_v050_production_attestation_verifier",
        VERIFIER_PATH,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load attestation verifier")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def expect_failure(operation, label: str) -> None:
    try:
        operation()
    except ValueError:
        return
    raise RuntimeError(f"{label} was accepted")


def main() -> int:
    verifier = load_verifier()
    vectors = ROOT / "conformance/authority-vectors.json"
    envelope = ROOT / "schemas/authority-ipc-envelope.schema.json"
    frame = ROOT / "schemas/authority-ipc-frame.schema.json"
    migrations = ROOT / "database/postgres/MIGRATIONS.json"

    with tempfile.TemporaryDirectory(prefix="noesar-v050-attestations-") as directory:
        temp = Path(directory)
        binary = temp / "noesar-authority-test-artifact"
        provenance = temp / "provenance.json"
        conformance = temp / "conformance.json"
        peer_report = temp / "peer-credentials.json"
        postgres_report = temp / "postgres-acceptance.txt"

        binary.write_bytes(b"test artifact, not a production Rust binary\n")
        provenance.write_text('{"testOnly":true}\n', encoding="utf-8")
        conformance.write_text('{"verdict":"PASS"}\n', encoding="utf-8")
        peer_report.write_text('{"verdict":"PASS"}\n', encoding="utf-8")
        postgres_report.write_text("POSTGRES_TEST_ONLY=PASS\n", encoding="utf-8")

        authority_path = temp / "authority.json"
        postgres_path = temp / "postgres.json"

        authority = {
            "schemaVersion":"3.0",
            "kind":"rust-authority",
            "release":"0.5.0",
            "protocolVersion":"1.1",
            "binaryPath":str(binary),
            "binarySha256":digest(binary),
            "buildProvenancePath":str(provenance),
            "buildProvenanceSha256":digest(provenance),
            "conformanceReportPath":str(conformance),
            "conformanceReportSha256":digest(conformance),
            "peerCredentialReportPath":str(peer_report),
            "peerCredentialReportSha256":digest(peer_report),
            "conformanceVectorSha256":digest(vectors),
            "authorityEnvelopeSchemaSha256":digest(envelope),
            "authorityFrameSchemaSha256":digest(frame),
            "canonicalJsonConformancePassed":True,
            "hmacConformancePassed":True,
            "authenticatedIpc":True,
            "peerCredentialsVerified":True,
            "frameBoundaryTestsPassed":True,
            "testsPassed":True,
            "transport":"unix-domain-socket",
        }
        postgres = {
            "schemaVersion":"3.0",
            "kind":"postgresql-data-plane",
            "release":"0.5.0",
            "serverVersionNumber":180000,
            "pgvectorVersion":"0.8.0-test",
            "migrationManifestSha256":digest(migrations),
            "acceptanceReportPath":str(postgres_report),
            "acceptanceReportSha256":digest(postgres_report),
            "connected":True,
            "migrationsVerified":True,
            "roleSeparationVerified":True,
            "publicSchemaRevocationVerified":True,
            "applicationRoleNoBypassRls":True,
            "rowLevelSecurityVerified":True,
            "immutableLedgersVerified":True,
            "securityAcceptanceViewVerified":True,
            "repositoryAdapterActive":True,
            "backupRestoreVerified":True,
            "legacyV030Rejected":True,
            "baselineV040Preserved":True,
        }

        def persist():
            authority_path.write_text(json.dumps(authority), encoding="utf-8")
            postgres_path.write_text(json.dumps(postgres), encoding="utf-8")

        persist()
        verifier.verify_authority(authority_path, vectors, envelope, frame)
        verifier.verify_postgres(postgres_path, migrations)

        binary.write_bytes(b"tampered\n")
        expect_failure(
            lambda: verifier.verify_authority(
                authority_path, vectors, envelope, frame
            ),
            "tampered Rust binary",
        )
        binary.write_bytes(b"test artifact, not a production Rust binary\n")

        authority["authorityFrameSchemaSha256"] = "0" * 64
        persist()
        expect_failure(
            lambda: verifier.verify_authority(
                authority_path, vectors, envelope, frame
            ),
            "frame schema tampering",
        )
        authority["authorityFrameSchemaSha256"] = digest(frame)

        authority["peerCredentialsVerified"] = False
        persist()
        expect_failure(
            lambda: verifier.verify_authority(
                authority_path, vectors, envelope, frame
            ),
            "unverified peer credentials",
        )
        authority["peerCredentialsVerified"] = True

        postgres["serverVersionNumber"] = 170999
        persist()
        expect_failure(
            lambda: verifier.verify_postgres(postgres_path, migrations),
            "PostgreSQL 17",
        )
        postgres["serverVersionNumber"] = 180000

        postgres["applicationRoleNoBypassRls"] = False
        persist()
        expect_failure(
            lambda: verifier.verify_postgres(postgres_path, migrations),
            "RLS bypass role",
        )
        postgres["applicationRoleNoBypassRls"] = True

        postgres["securityAcceptanceViewVerified"] = False
        persist()
        expect_failure(
            lambda: verifier.verify_postgres(postgres_path, migrations),
            "unverified security acceptance view",
        )

    print("PRODUCTION_ATTESTATION_V3_GATE_SMOKE=PASS")
    print("ATTESTATION_TAMPER_CASES=6/6 PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
