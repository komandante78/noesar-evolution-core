#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CURRENT = ROOT / "database/postgres"
LEGACY = ROOT / "database/postgres-legacy-v0.3.0"
BASELINE_V040 = ROOT / "database/postgres-baseline-v0.4.0"
BASELINE_V050 = ROOT / "database/postgres-baseline-v0.5.0"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    failures = []
    manifest = json.loads(
        (CURRENT / "MIGRATIONS.json").read_text(encoding="utf-8")
    )
    files = sorted(CURRENT.glob("0*.sql"))

    expected_names = [
        "0001_schemas_and_extensions.sql",
        "0002_identity_and_sessions.sql",
        "0003_workspaces_projects_members.sql",
        "0004_audit_ledger.sql",
        "0005_publishers_capabilities.sql",
        "0006_documents_memory_models.sql",
        "0007_row_level_security.sql",
        "0008_migration_ledger.sql",
        "0009_roles_and_privileges.sql",
        "0010_runtime_security_acceptance.sql",
        "0011_production_attestation_ledger.sql",
        "0012_audit_chain_and_release_gate.sql",
        "0013_multi_user_identity.sql",
        "0014_multi_user_resources.sql",
        "0015_multi_user_row_level_security.sql",
        "0016_application_privileges.sql",
        "0017_memory_cubes.sql",
        "0018_memory_cube_typed_views.sql",
        "0019_memory_all_cubes_view.sql",
    ]

    if manifest.get("schemaVersion") != "4.0":
        failures.append("manifest-schema-version")
    if manifest.get("release") != "0.6.0":
        failures.append("manifest-release")
    if manifest.get("legacyV030Executable") is not False:
        failures.append("legacy-execution-flag")
    if manifest.get("baselineV040Preserved") is not True:
        failures.append("v040-baseline-flag")
    if manifest.get("baselineV050Preserved") is not True:
        failures.append("v050-baseline-flag")
    if [path.name for path in files] != expected_names:
        failures.append("migration-sequence")

    entries = {
        item["filename"]: item
        for item in manifest.get("migrations", [])
    }
    if len(entries) != len(expected_names):
        failures.append("manifest-migration-count")

    for path in files:
        content = path.read_text(encoding="utf-8")
        if not re.search(
            r"^\s*(?:--[^\n]*\n)*BEGIN\s*;",
            content,
            re.I,
        ):
            failures.append(f"begin:{path.name}")
        if not re.search(r"COMMIT\s*;\s*$", content, re.I):
            failures.append(f"commit:{path.name}")
        if re.search(r"\bDROP\s+(DATABASE|SCHEMA)\b", content, re.I):
            failures.append(f"destructive:{path.name}")
        entry = entries.get(path.name)
        if (
            not entry
            or entry.get("sha256") != digest(path)
            or entry.get("bytes") != path.stat().st_size
        ):
            failures.append(f"manifest-entry:{path.name}")

    combined = "\n".join(
        path.read_text(encoding="utf-8")
        for path in files
    )
    required = [
        "CREATE EXTENSION IF NOT EXISTS vector",
        "USING hnsw",
        "ENABLE ROW LEVEL SECURITY",
        "FORCE ROW LEVEL SECURITY",
        "noesar_runtime.schema_migrations",
        "CREATE ROLE noesar_migrator",
        "CREATE ROLE noesar_app",
        "CREATE ROLE noesar_auditor",
        "NOBYPASSRLS",
        "CREATE TABLE IF NOT EXISTS noesar_runtime.production_attestations",
        "noesar_runtime.production_gate",
        "noesar_production_attestations_immutable",
        "noesar_audit.enforce_hash_chain",
        "pg_advisory_xact_lock",
        "noesar_audit_events_hash_chain",
        "count(*) = 12",
        "audit_hash_chain_guard",
        "production_attestation_ledger_immutable",
    ]
    for token in required:
        if token not in combined:
            failures.append(f"required:{token}")

    forbidden = [
        r"REFERENCES\s+noesar_users\b",
        r"REFERENCES\s+noesar_sessions\b",
        r"REFERENCES\s+noesar_workspaces\b",
        r"REFERENCES\s+noesar_projects\b",
        r"CREATE ROLE\s+noesar_app\b(?:(?!NOBYPASSRLS).)*\sBYPASSRLS\b",
    ]
    for pattern in forbidden:
        if re.search(pattern, combined, re.I | re.S):
            failures.append(f"forbidden:{pattern}")

    legacy_status = LEGACY / "LEGACY_STATUS.md"
    if not legacy_status.is_file():
        failures.append("legacy-status-missing")
    else:
        text = legacy_status.read_text(encoding="utf-8")
        if (
            "LEGACY_MIGRATION_SET=INVALID" not in text
            or "EXECUTION_ALLOWED=false" not in text
        ):
            failures.append("legacy-status-invalid")

    for baseline, release, count in [
        (BASELINE_V040, "0.4.0", 8),
        (BASELINE_V050, "0.5.0", 10),
    ]:
        manifest_path = baseline / "MIGRATIONS.json"
        status_path = baseline / "BASELINE_STATUS.md"
        if not manifest_path.is_file() or not status_path.is_file():
            failures.append(f"baseline-missing:{release}")
            continue
        value = json.loads(manifest_path.read_text(encoding="utf-8"))
        if value.get("release") != release:
            failures.append(f"baseline-release:{release}")
        if len(value.get("migrations", [])) != count:
            failures.append(f"baseline-count:{release}")

    if failures:
        print("VERDICT=FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("VERDICT=PASS")
    print(f"MIGRATIONS={len(expected_names)}")
    print("SCHEMA_QUALIFICATION=PASS")
    print("TRANSACTION_BOUNDARIES=PASS")
    print("CHECKSUMS=PASS")
    print("ROLE_SEPARATION=PASS")
    print("APPLICATION_ROLE_NOBYPASSRLS=PASS")
    print("PRODUCTION_ATTESTATION_LEDGER=PASS")
    print("PRODUCTION_GATE=PASS")
    print("AUDIT_HASH_CHAIN_GUARD=PASS")
    print("ADVISORY_TRANSACTION_LOCK=PASS")
    print("ROW_LEVEL_SECURITY=PASS")
    print("PGVECTOR_SCHEMA=PASS")
    print("LEGACY_V030_QUARANTINE=PASS")
    print("BASELINE_V040_PRESERVED=PASS")
    print("BASELINE_V050_PRESERVED=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
