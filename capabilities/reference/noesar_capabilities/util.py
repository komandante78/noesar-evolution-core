# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, ZipInfo


ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,127}$")
VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$")


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_manifest(manifest: dict) -> None:
    required = {
        "schemaVersion", "id", "version", "kind", "publisher",
        "license", "entrypoint", "permissions", "payload",
    }
    missing = sorted(required - set(manifest))
    if missing:
        raise ValueError(f"manifest missing required fields: {missing}")
    if manifest["schemaVersion"] != "4.0":
        raise ValueError("unsupported manifest schema version")
    if not ID_PATTERN.fullmatch(manifest["id"]):
        raise ValueError("invalid capability id")
    if not VERSION_PATTERN.fullmatch(manifest["version"]):
        raise ValueError("invalid capability version")
    if manifest["publisher"].get("trustLevel") not in {
        "noesar-official", "certified-partner", "customer-private", "community"
    }:
        raise ValueError("invalid publisher trust level")
    if not isinstance(manifest["permissions"], list):
        raise ValueError("permissions must be an array")
    payload_paths = [item.get("path") for item in manifest["payload"]]
    if len(payload_paths) != len(set(payload_paths)):
        raise ValueError("duplicate payload path")
    for path in payload_paths:
        pure = PurePosixPath(str(path).replace("\\", "/"))
        if pure.is_absolute() or ".." in pure.parts:
            raise ValueError(f"unsafe payload path: {path}")


def validate_archive_members(archive: ZipFile) -> list[ZipInfo]:
    seen: set[str] = set()
    members: list[ZipInfo] = []
    for info in archive.infolist():
        normalized = info.filename.replace("\\", "/")
        pure = PurePosixPath(normalized)
        if pure.is_absolute() or ".." in pure.parts:
            raise ValueError(f"unsafe archive path: {normalized}")
        if normalized in seen:
            raise ValueError(f"duplicate archive path: {normalized}")
        seen.add(normalized)
        mode = (info.external_attr >> 16) & 0o170000
        if mode == 0o120000:
            raise ValueError(f"symbolic link rejected: {normalized}")
        members.append(info)
    return members


def safe_extract(archive: ZipFile, destination: Path) -> None:
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    members = validate_archive_members(archive)
    for info in members:
        target = (destination / PurePosixPath(info.filename)).resolve()
        if target != destination and destination not in target.parents:
            raise ValueError(f"archive escaped destination: {info.filename}")
    archive.extractall(destination)


def atomic_json_write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)
