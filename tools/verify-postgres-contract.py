#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
repository = (
    ROOT / "services/reference-control-plane/src/postgres-repository.mjs"
).read_text(encoding="utf-8")
attestations = (
    ROOT / "database/postgres/0011_production_attestation_ledger.sql"
).read_text(encoding="utf-8")
chain = (
    ROOT / "database/postgres/0012_audit_chain_and_release_gate.sql"
).read_text(encoding="utf-8")

failures = []
for token in [
    "SELECT noesar_runtime.assert_context()",
    "FROM noesar_runtime.production_gate($1, $2)",
    "audit_hash_chain_guard",
    "production_attestation_ledger_immutable",
    "Object.values(checks).every(Boolean)",
    "production gate release must equal 0.6.0",
    "event.previousHash",
    "event.eventHash",
    "must be lowercase SHA-256 hex",
]:
    if token not in repository:
        failures.append(f"repository:{token}")

for token in [
    "CREATE TABLE IF NOT EXISTS noesar_runtime.production_attestations",
    "CREATE OR REPLACE FUNCTION noesar_runtime.production_gate",
    "migration-manifest",
    "penetration-test",
    "noesar_production_attestations_immutable",
    "REVOKE UPDATE, DELETE, TRUNCATE",
]:
    if token not in attestations:
        failures.append(f"attestation-ledger:{token}")

for token in [
    "CREATE OR REPLACE FUNCTION noesar_audit.enforce_hash_chain",
    "pg_advisory_xact_lock",
    "repeat('0', 64)",
    "noesar_audit_events_hash_chain",
    "count(*) = 12",
    "audit_hash_chain_guard",
    "production_attestation_ledger_immutable",
]:
    if token not in chain:
        failures.append(f"audit-chain:{token}")

if failures:
    print("VERDICT=FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("VERDICT=PASS")
print("POSTGRES_CONTEXT_ASSERTION=PASS")
print("POSTGRES_PRODUCTION_GATE_CONTRACT=PASS")
print("POSTGRES_ATTESTATION_LEDGER_CONTRACT=PASS")
print("POSTGRES_AUDIT_CHAIN_CONTRACT=PASS")
print("POSTGRES_EXECUTION=NOT_EXECUTED")
