#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def is_build_output(relative_parts: tuple[str, ...]) -> bool:
    """Return True only for cargo build-output paths.

    A path component named ``target`` is build output ONLY when it is not inside a
    vendored crate. Vendored crates legitimately ship source directories called
    ``target`` -- cc-1.3.0/src/target/{apple,generated,llvm,parser}.rs is the real
    example. Treating every directory named ``target`` as build output deleted that
    genuine upstream source and produced a vendor snapshot that could not build
    offline (blocker B-003).

    Note this inspects the path RELATIVE to the workspace. The previous version
    tested ``path.parts`` on the absolute path, so a workspace located under any
    directory called ``target`` would have excluded every file in the tree.

    Regression test: tools/test-packaging-filters.mjs
    Rules: docs/PACKAGING_FILTER_SAFETY_RULES.md
    """
    for index, part in enumerate(relative_parts):
        if part == "target" and "vendor" not in relative_parts[:index]:
            return True
    return False


def source_tree_digest(workspace: Path) -> str:
    candidates = [
        path for path in workspace.rglob("*")
        if path.is_file()
        and (
            path.name in {"Cargo.toml", "Cargo.lock"}
            or path.suffix == ".rs"
        )
        and not is_build_output(path.relative_to(workspace).parts)
    ]
    h = hashlib.sha256()
    for path in sorted(candidates):
        rel = path.relative_to(workspace).as_posix().encode("utf-8")
        h.update(len(rel).to_bytes(4, "big"))
        h.update(rel)
        content = path.read_bytes()
        h.update(len(content).to_bytes(8, "big"))
        h.update(content)
    return h.hexdigest()


def command_version(command: list[str]) -> str:
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"version command failed: {' '.join(command)}"
        )
    return (result.stdout + result.stderr).strip()


def report_passed(path: Path, field: str) -> bool:
    text = path.read_text(encoding="utf-8")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        value = None
    if isinstance(value, dict):
        verdict = value.get("verdict") or value.get("status")
        if verdict == "PASS":
            return True
        summary = value.get("summary")
        if isinstance(summary, dict) and summary.get("FAIL") == 0:
            return True
    return f"{field}=PASS" in text or "VERDICT=PASS" in text


def create_provenance(
    *,
    binary: Path,
    workspace: Path,
    tests_report: Path,
    conformance_report: Path,
    rustc_version: str,
    cargo_version: str,
    target_triple: str,
) -> dict:
    binary = binary.resolve()
    workspace = workspace.resolve()
    tests_report = tests_report.resolve()
    conformance_report = conformance_report.resolve()

    for path, field in [
        (binary, "binary"),
        (workspace / "Cargo.toml", "Cargo.toml"),
        (workspace / "Cargo.lock", "Cargo.lock"),
        (tests_report, "tests report"),
        (conformance_report, "conformance report"),
    ]:
        if not path.is_file():
            raise ValueError(f"{field} is required")

    if not report_passed(tests_report, "RUST_TESTS"):
        raise ValueError("Rust tests report is not PASS")
    if not report_passed(
        conformance_report,
        "AUTHORITY_CONFORMANCE",
    ):
        raise ValueError("authority conformance report is not PASS")
    if not rustc_version or not cargo_version or not target_triple:
        raise ValueError("toolchain and target metadata are required")

    return {
        "schemaVersion": "1.0",
        "kind": "rust-build-provenance",
        "release": "0.6.0",
        "binaryPath": str(binary),
        "binarySha256": digest(binary),
        "workspacePath": str(workspace),
        "workspaceManifestSha256": digest(workspace / "Cargo.toml"),
        "cargoLockSha256": digest(workspace / "Cargo.lock"),
        "sourceTreeSha256": source_tree_digest(workspace),
        "testsReportPath": str(tests_report),
        "testsReportSha256": digest(tests_report),
        "conformanceReportPath": str(conformance_report),
        "conformanceReportSha256": digest(conformance_report),
        "rustcVersion": rustc_version,
        "cargoVersion": cargo_version,
        "targetTriple": target_triple,
        "testsPassed": True,
        "authorityConformancePassed": True,
        "createdUtc": (
            datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--tests-report", required=True, type=Path)
    parser.add_argument("--conformance-report", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--rustc-version")
    parser.add_argument("--cargo-version")
    parser.add_argument("--target-triple")
    args = parser.parse_args()

    rustc_version = args.rustc_version or command_version(
        ["rustc", "--version", "--verbose"]
    )
    cargo_version = args.cargo_version or command_version(
        ["cargo", "--version", "--verbose"]
    )
    target_triple = args.target_triple
    if not target_triple:
        for line in rustc_version.splitlines():
            if line.startswith("host: "):
                target_triple = line.removeprefix("host: ").strip()
                break
    if not target_triple:
        raise SystemExit("unable to determine Rust target triple")

    value = create_provenance(
        binary=args.binary,
        workspace=args.workspace,
        tests_report=args.tests_report,
        conformance_report=args.conformance_report,
        rustc_version=rustc_version,
        cargo_version=cargo_version,
        target_triple=target_triple,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("RUST_BUILD_PROVENANCE=RECORDED")
    print(f"BINARY_SHA256={value['binarySha256']}")
    print(f"SOURCE_TREE_SHA256={value['sourceTreeSha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
