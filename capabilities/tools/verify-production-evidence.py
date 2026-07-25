#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "reference"))

from noesar_capabilities.production_evidence import (
    verify_capability_production_evidence,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--capability-id", required=True)
    parser.add_argument("--capability-version", required=True)
    parser.add_argument("--plan-hash", required=True)
    parser.add_argument("--profile-sha256", required=True)
    args = parser.parse_args()

    value = verify_capability_production_evidence(
        args.evidence,
        expected_capability_id=args.capability_id,
        expected_capability_version=args.capability_version,
        expected_plan_hash=args.plan_hash,
        expected_profile_sha256=args.profile_sha256,
    )
    print("VERDICT=PASS")
    print(f"EVIDENCE_SHA256={value.evidence_sha256}")
    print(f"AUTHORITY_ATTESTATION_SHA256={value.authority_attestation_sha256}")
    print(f"POSTGRES_ATTESTATION_SHA256={value.postgres_attestation_sha256}")
    print(f"SANDBOX_ATTESTATION_SHA256={value.sandbox_attestation_sha256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
