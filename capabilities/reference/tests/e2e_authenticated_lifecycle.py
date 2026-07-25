#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference"))

from noesar_capabilities import CapabilityManager, Principal
from noesar_capabilities.util import canonical_json


def main() -> int:
    temp = Path(tempfile.mkdtemp(prefix="noesar-capability-e2e-"))
    try:
        private = temp / "private.pem"
        public = temp / "public.pem"
        for command in [
            ["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(private)],
            ["openssl", "pkey", "-in", str(private), "-pubout", "-out", str(public)],
        ]:
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError(result.stderr)

        payload = b'{"description":"authenticated lifecycle"}\n'
        manifest = {
            "schemaVersion": "4.0",
            "id": "noesar.text-statistics",
            "version": "0.2.0",
            "kind": "tool",
            "publisher": {
                "id": "noesar.foundation",
                "trustLevel": "noesar-official",
                "keyId": "e2e",
            },
            "license": {
                "spdx": "Apache-2.0",
                "commercialUse": True,
            },
            "entrypoint": {
                "type": "builtin",
                "value": "text-statistics",
            },
            "permissions": ["filesystem.write.project"],
            "payload": [{
                "path": "payload/definition.json",
                "sha256": hashlib.sha256(payload).hexdigest(),
                "bytes": len(payload),
            }],
            "rollback": {
                "supported": True,
                "strategy": "restore-previous-version",
            },
        }
        manifest_bytes = canonical_json(manifest)
        manifest_file = temp / "manifest.json"
        signature_file = temp / "manifest.sig"
        package = temp / "package.zip"
        manifest_file.write_bytes(manifest_bytes)

        sign = subprocess.run(
            [
                "openssl", "pkeyutl", "-sign",
                "-inkey", str(private),
                "-rawin", "-in", str(manifest_file),
                "-out", str(signature_file),
            ],
            capture_output=True,
            text=True,
        )
        if sign.returncode != 0:
            raise RuntimeError(sign.stderr)

        with ZipFile(package, "w", ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", manifest_bytes)
            archive.writestr("manifest.sig", signature_file.read_bytes())
            archive.writestr("payload/definition.json", payload)

        now = int(time.time())
        owner = Principal(
            "owner-e2e", "owner", "session-owner", now,
            now + 300, "local", "project-a"
        )
        developer = Principal(
            "developer-e2e", "developer", "session-developer", now,
            0, "local", "project-a"
        )
        admin = Principal(
            "admin-e2e", "admin", "session-admin", now,
            0, "local", "project-a"
        )
        user = Principal(
            "user-e2e", "user", "session-user", now,
            0, "local", "project-a"
        )

        manager = CapabilityManager(temp / "workspace")
        manager.register_publisher(
            owner, "noesar.foundation", "noesar-official", public
        )
        plan = manager.plan(developer, package)
        if plan["decision"] != "approval-required":
            raise RuntimeError(f"unexpected plan: {plan}")
        approval = manager.approve(developer, plan)
        installed = manager.install(developer, package, plan, approval)
        if installed["state"] != "quarantined":
            raise RuntimeError("package was not quarantined")
        active = manager.activate(admin, "noesar.text-statistics")
        if active["state"] != "active":
            raise RuntimeError("capability was not activated")
        result = manager.invoke_builtin(
            user,
            "noesar.text-statistics",
            {"text": "local local verified"},
        )
        if result["words"] != 3:
            raise RuntimeError(f"unexpected invocation result: {result}")
        if not manager.audit.verify():
            raise RuntimeError("audit chain verification failed")

        print("AUTHENTICATED_E2E_LIFECYCLE=PASS")
        return 0
    finally:
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
