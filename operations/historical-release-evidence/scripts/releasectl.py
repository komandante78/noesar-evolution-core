#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "release/RELEASE_INDEX.json"
STATUS_PATH = ROOT / "release/ACCEPTANCE_STATUS.json"


def digest_path(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_index() -> dict:
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def safe_infos(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    seen = set()
    infos = []
    for info in archive.infolist():
        name = info.filename.replace("\\", "/")
        pure = PurePosixPath(name)
        if pure.is_absolute() or ".." in pure.parts:
            raise RuntimeError(f"unsafe path: {name}")
        if name in seen:
            raise RuntimeError(f"duplicate path: {name}")
        seen.add(name)
        if ((info.external_attr >> 16) & 0o170000) == 0o120000:
            raise RuntimeError(f"symlink rejected: {name}")
        infos.append(info)
    bad = archive.testzip()
    if bad:
        raise RuntimeError(f"CRC failure: {bad}")
    return infos


def archive_map(index: dict) -> dict[int, dict]:
    return {item["number"]: item for item in index["archives"]}


def archive_bytes(number: int, index: dict, cache: dict[int, bytes]) -> bytes:
    if number in cache:
        return cache[number]
    items = archive_map(index)
    if number not in items:
        raise RuntimeError(f"unknown archive number: {number}")
    item = items[number]
    storage = item["storage"]

    if storage["type"] == "direct":
        data = (ROOT / storage["path"]).read_bytes()
    elif storage["type"] == "nested":
        container = archive_bytes(
            int(storage["containerNumber"]), index, cache
        )
        with zipfile.ZipFile(io.BytesIO(container), "r") as archive:
            safe_infos(archive)
            data = archive.read(storage["member"])
    else:
        raise RuntimeError(f"unsupported storage type: {storage['type']}")

    if digest_bytes(data) != item["sha256"]:
        raise RuntimeError(f"archive hash mismatch: {item['filename']}")
    cache[number] = data
    return data


def verify_manifest_bytes(data: bytes, expected_root: str) -> int:
    with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
        safe_infos(archive)
        manifest_name = f"{expected_root}/MANIFEST.sha256"
        if manifest_name not in archive.namelist():
            raise RuntimeError(f"missing manifest: {expected_root}")
        count = 0
        manifest = archive.read(manifest_name).decode("utf-8")
        for line in manifest.splitlines():
            expected, relative = line.split("  ", 1)
            member = f"{expected_root}/{relative}"
            if member not in archive.namelist():
                raise RuntimeError(f"manifest member missing: {member}")
            if digest_bytes(archive.read(member)) != expected:
                raise RuntimeError(f"manifest mismatch: {member}")
            count += 1
        return count


def verify() -> int:
    index = load_index()
    failures = []
    manifest_total = 0
    cache: dict[int, bytes] = {}

    if len(index["archives"]) != 4:
        failures.append("release index must contain ZIP 1-4")
    if index["externalProductZipCount"] != 5:
        failures.append("external product ZIP count must be five")
    if index["sixthProductZipCreated"] is not False:
        failures.append("sixth product ZIP flag must be false")
    if index["finalRelease"] is not False:
        failures.append("finalRelease must remain false")
    if index["productionReady"] is not False:
        failures.append("productionReady must remain false")

    for item in index["archives"]:
        try:
            data = archive_bytes(item["number"], index, cache)
            sidecar = ROOT / "SIDECARS" / f"{item['filename']}.sha256"
            if (
                not sidecar.is_file()
                or sidecar.read_text(encoding="utf-8").split()[0]
                != item["sha256"]
            ):
                failures.append(f"sidecar mismatch: {item['filename']}")
            count = verify_manifest_bytes(
                data, item["filename"].removesuffix(".zip")
            )
            if count != item["manifestFiles"]:
                failures.append(f"manifest count mismatch: {item['filename']}")
            manifest_total += count
        except Exception as exc:
            failures.append(f"{item['filename']}: {exc}")

    master = index["master"]
    master_path = ROOT / master["path"]
    if (
        not master_path.is_file()
        or digest_path(master_path) != master["sha256"]
    ):
        failures.append("master mismatch")
    else:
        try:
            count = verify_manifest_bytes(
                master_path.read_bytes(),
                master["filename"].removesuffix(".zip"),
            )
            if count != master["manifestFiles"]:
                failures.append("master manifest count mismatch")
            manifest_total += count
        except Exception as exc:
            failures.append(f"master manifest: {exc}")

    rollback = index["rollbackReference"]
    rollback_sidecar = (
        ROOT / "ROLLBACK_REFERENCE" / f"{rollback['filename']}.sha256"
    )
    if (
        not rollback_sidecar.is_file()
        or rollback_sidecar.read_text(encoding="utf-8").split()[0]
        != rollback["sha256"]
    ):
        failures.append("rollback reference sidecar mismatch")
    if rollback["embedded"] is not False:
        failures.append("rollback reference must remain external")

    security = index["securityAcceptance"]
    if security["implementationVerdict"] != "PASS_WITH_BLOCKERS":
        failures.append("implementation verdict mismatch")
    if security["finalProductVerdict"] != "BLOCKED":
        failures.append("final-product verdict mismatch")
    if security["regulatedUseVerdict"] != "NOT_EVALUATED":
        failures.append("regulated-use verdict mismatch")
    if security["audit"] != {"PASS": 27, "FAIL": 0, "TOTAL": 27}:
        failures.append("audit summary mismatch")
    if security["acceptance"] != {
        "PASS": 31, "BLOCKED": 7, "FAIL": 0
    }:
        failures.append("acceptance summary mismatch")
    if security["redTeam"] != {
        "PASS": 24, "NOT_EXECUTED": 7, "FAIL": 0
    }:
        failures.append("red-team summary mismatch")
    if security["findings"] != {
        "BLOCKER": 5, "HIGH": 5, "MEDIUM": 2, "CLOSED": 1
    }:
        failures.append("finding summary mismatch")

    if failures:
        print("VERDICT=FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("VERDICT=PASS")
    print("ARCHIVES_VERIFIED=4")
    print(f"INTERNAL_MANIFEST_FILES={manifest_total}")
    print("STORAGE_STRATEGY=DEDUPLICATED_RECURSIVE_LINEAGE")
    print("EXECUTABLE_AUDIT=27/27 PASS")
    print("ACCEPTANCE=31 PASS / 7 BLOCKED / 0 FAIL")
    print("RED_TEAM=24 PASS / 7 NOT_EXECUTED / 0 FAIL")
    print("IMPLEMENTATION_VERDICT=PASS_WITH_BLOCKERS")
    print("FINAL_PRODUCT_VERDICT=BLOCKED")
    print("OPEN_BLOCKERS=5")
    print("FINAL_RELEASE=false")
    return 0


def list_archives() -> int:
    for item in load_index()["archives"]:
        storage = item["storage"]["type"]
        print(
            f"{item['number']}: {item['filename']}  "
            f"{item['sha256']}  storage={storage}"
        )
    return 0


def status() -> int:
    print(STATUS_PATH.read_text(encoding="utf-8"))
    return 0


def report(number: int) -> int:
    items = archive_map(load_index())
    if number not in items:
        raise SystemExit(f"unknown archive number: {number}")
    report_name = (
        items[number]["filename"].removesuffix(".zip")
        + "_PACKAGING_REPORT.txt"
    )
    path = ROOT / "REPORTS" / report_name
    if not path.is_file():
        raise SystemExit(f"report not found: {report_name}")
    print(path.read_text(encoding="utf-8"))
    return 0


def extract(number: int, destination: Path) -> int:
    index = load_index()
    items = archive_map(index)
    if number not in items:
        raise SystemExit(f"unknown archive number: {number}")

    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise SystemExit(f"destination must be empty: {destination}")

    data = archive_bytes(number, index, {})
    item = items[number]
    with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
        infos = safe_infos(archive)
        for info in infos:
            target = (destination / PurePosixPath(info.filename)).resolve()
            if target != destination and destination not in target.parents:
                raise RuntimeError(
                    f"extraction escaped destination: {info.filename}"
                )
        archive.extractall(destination)
        for info in infos:
            target = destination / PurePosixPath(info.filename)
            mode = (info.external_attr >> 16) & 0o777
            if mode and target.exists() and target.is_file():
                target.chmod(mode)

    print(f"EXTRACTED={item['filename']}")
    print(f"DESTINATION={destination}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="NOESAR V4 Implementation V0.5.0 release controller"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("verify")
    commands.add_parser("status")
    commands.add_parser("list")

    report_parser = commands.add_parser("report")
    report_parser.add_argument("number", type=int)

    extract_parser = commands.add_parser("extract")
    extract_parser.add_argument("number", type=int)
    extract_parser.add_argument("--destination", required=True, type=Path)

    args = parser.parse_args()
    if args.command == "verify":
        return verify()
    if args.command == "status":
        return status()
    if args.command == "list":
        return list_archives()
    if args.command == "report":
        return report(args.number)
    return extract(args.number, args.destination)


if __name__ == "__main__":
    raise SystemExit(main())
