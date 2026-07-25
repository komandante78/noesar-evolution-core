# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference"))

from noesar_capabilities import CapabilityManager, Principal, evaluate_policy
from noesar_capabilities.approval import issue_token, verify_token
from noesar_capabilities.protocols import (
    a2a_agent_to_manifest,
    evaluate_protocol_declaration,
    mcp_tool_to_manifest,
)
from noesar_capabilities.util import canonical_json


def principal(
    role: str,
    *,
    actor: str | None = None,
    session: str | None = None,
    strong: bool = False,
    organization: str = "local",
    project: str | None = "project-a",
) -> Principal:
    return Principal(
        actor_id=actor or f"{role}-1",
        role=role,
        session_id=session or f"session-{role}",
        authenticated_at=int(time.time()),
        strong_reauth_until=int(time.time()) + 300 if strong else 0,
        organization_id=organization,
        project_id=project,
    )


def make_keys(root: Path, prefix: str = "publisher") -> tuple[Path, Path]:
    private = root / f"{prefix}-private.pem"
    public = root / f"{prefix}-public.pem"
    subprocess.run(
        ["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(private)],
        check=True, capture_output=True
    )
    subprocess.run(
        ["openssl", "pkey", "-in", str(private), "-pubout", "-out", str(public)],
        check=True, capture_output=True
    )
    return private, public


def build_package(
    root: Path,
    private_key: Path,
    *,
    capability_id: str = "noesar.text-statistics",
    version: str = "0.2.0",
    permissions: list[str] | None = None,
    trust_level: str = "noesar-official",
    publisher_id: str = "noesar.foundation",
    kind: str = "tool",
    entrypoint_type: str = "builtin",
    entrypoint_value: str = "text-statistics",
    license_id: str = "Apache-2.0",
    industry: dict | None = None,
) -> Path:
    payload_data = b'{"description":"NOESAR capability"}\n'
    payload_path = "payload/definition.json"
    manifest = {
        "schemaVersion": "4.0",
        "id": capability_id,
        "version": version,
        "kind": kind,
        "publisher": {
            "id": publisher_id,
            "trustLevel": trust_level,
            "keyId": "test",
        },
        "license": {
            "spdx": license_id,
            "commercialUse": True,
        },
        "entrypoint": {
            "type": entrypoint_type,
            "value": entrypoint_value,
        },
        "permissions": permissions or [],
        "payload": [{
            "path": payload_path,
            "sha256": hashlib.sha256(payload_data).hexdigest(),
            "bytes": len(payload_data),
        }],
        "rollback": {
            "supported": True,
            "strategy": "restore-previous-version",
        },
    }
    if industry is not None:
        manifest["industry"] = industry
    manifest_bytes = canonical_json(manifest)
    message = root / f"{capability_id}-{version}-manifest.json"
    signature = root / f"{capability_id}-{version}-manifest.sig"
    message.write_bytes(manifest_bytes)
    subprocess.run(
        [
            "openssl", "pkeyutl", "-sign",
            "-inkey", str(private_key),
            "-rawin", "-in", str(message),
            "-out", str(signature),
        ],
        check=True, capture_output=True
    )
    package = root / f"{capability_id}-{version}.zip"
    with ZipFile(package, "w", ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", manifest_bytes)
        archive.writestr("manifest.sig", signature.read_bytes())
        archive.writestr(payload_path, payload_data)
    return package


class CapabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="noesar-cap-v020-")
        self.root = Path(self.temp.name)
        self.private, self.public = make_keys(self.root)
        self.manager = CapabilityManager(self.root / "workspace")
        self.owner = principal("owner", strong=True)
        self.admin = principal("admin")
        self.developer = principal("developer")
        self.user = principal("user")
        self.manager.register_publisher(
            self.owner,
            "noesar.foundation",
            "noesar-official",
            self.public,
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_01_owner_strong_reauth_required_for_publisher(self):
        weak_owner = principal("owner", strong=False)
        _, other_public = make_keys(self.root, "other")
        with self.assertRaisesRegex(PermissionError, "strong reauthentication"):
            self.manager.register_publisher(
                weak_owner, "other", "community", other_public
            )

    def test_02_admin_cannot_register_publisher(self):
        _, other_public = make_keys(self.root, "other-admin")
        with self.assertRaisesRegex(PermissionError, "requires role owner"):
            self.manager.register_publisher(
                self.admin, "other", "community", other_public
            )

    def test_03_signature_and_payload_verify(self):
        package = build_package(self.root, self.private)
        result = self.manager.verify(self.developer, package)
        self.assertEqual(result["manifest"]["id"], "noesar.text-statistics")

    def test_04_payload_tampering_rejected(self):
        package = build_package(self.root, self.private)
        tampered = self.root / "tampered.zip"
        with ZipFile(package) as source, ZipFile(tampered, "w", ZIP_DEFLATED) as target:
            for info in source.infolist():
                data = source.read(info.filename)
                if info.filename == "payload/definition.json":
                    data += b"tampered"
                target.writestr(info, data)
        with self.assertRaisesRegex(ValueError, "payload"):
            self.manager.verify(self.developer, tampered)

    def test_05_key_fingerprint_tampering_rejected(self):
        package = build_package(self.root, self.private)
        key_path = self.manager.keys / "noesar.foundation.pem"
        key_path.write_text("tampered\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            self.manager.verify(self.developer, package)

    def test_06_sensitive_permission_requires_approval(self):
        package = build_package(
            self.root, self.private, permissions=["network.external"]
        )
        plan = self.manager.plan(self.developer, package)
        self.assertEqual(plan["decision"], "approval-required")
        with self.assertRaisesRegex(ValueError, "approval token"):
            self.manager.install(self.developer, package, plan, None)

    def test_07_approval_bound_to_session(self):
        package = build_package(
            self.root, self.private, permissions=["network.external"]
        )
        plan = self.manager.plan(self.developer, package)
        token = self.manager.approve(self.developer, plan)
        other_session = principal(
            "developer",
            actor=self.developer.actor_id,
            session="different-session",
        )
        with self.assertRaisesRegex(PermissionError, "plan identity"):
            self.manager.install(other_session, package, plan, token)

    def test_08_approval_replay_rejected(self):
        package = build_package(
            self.root, self.private, permissions=["network.external"]
        )
        plan = self.manager.plan(self.developer, package)
        token = self.manager.approve(self.developer, plan)
        self.manager.install(self.developer, package, plan, token)
        with self.assertRaisesRegex(ValueError, "replay"):
            self.manager.install(self.developer, package, plan, token)

    def test_09_developer_cannot_activate(self):
        package = build_package(self.root, self.private)
        plan = self.manager.plan(self.developer, package)
        self.manager.install(self.developer, package, plan, None)
        with self.assertRaisesRegex(PermissionError, "requires role admin"):
            self.manager.activate(self.developer, "noesar.text-statistics")

    def test_10_admin_activates_and_user_invokes(self):
        package = build_package(self.root, self.private)
        plan = self.manager.plan(self.developer, package)
        self.manager.install(self.developer, package, plan, None)
        self.manager.activate(self.admin, "noesar.text-statistics")
        result = self.manager.invoke_builtin(
            self.user, "noesar.text-statistics", {"text": "local local safe"}
        )
        self.assertEqual(result["words"], 3)
        self.assertEqual(result["topWords"][0][0], "local")

    def test_11_project_scope_enforced(self):
        package = build_package(self.root, self.private)
        plan = self.manager.plan(self.developer, package)
        self.manager.install(self.developer, package, plan, None)
        self.manager.activate(self.admin, "noesar.text-statistics")
        other_project = principal("user", project="project-b")
        with self.assertRaisesRegex(PermissionError, "project scope"):
            self.manager.invoke_builtin(
                other_project, "noesar.text-statistics", {"text": "x"}
            )

    def test_12_publisher_revocation_blocks_invoke(self):
        package = build_package(self.root, self.private)
        plan = self.manager.plan(self.developer, package)
        self.manager.install(self.developer, package, plan, None)
        self.manager.activate(self.admin, "noesar.text-statistics")
        self.manager.revoke_publisher(
            self.owner, "noesar.foundation", "compromised test key"
        )
        with self.assertRaisesRegex(ValueError, "publisher is revoked"):
            self.manager.invoke_builtin(
                self.user, "noesar.text-statistics", {"text": "x"}
            )

    def test_13_package_revocation_blocks_activation(self):
        package = build_package(self.root, self.private)
        plan = self.manager.plan(self.developer, package)
        self.manager.install(self.developer, package, plan, None)
        self.manager.revoke_package(
            self.owner, plan["packageSha256"], "malicious package"
        )
        with self.assertRaisesRegex(ValueError, "package is revoked"):
            self.manager.activate(self.admin, "noesar.text-statistics")

    def test_14_unapproved_license_denied(self):
        package = build_package(
            self.root, self.private, license_id="LicenseRef-NonCommercial"
        )
        plan = self.manager.plan(self.developer, package)
        self.assertEqual(plan["decision"], "deny")

    def test_15_review_license_requires_approval(self):
        package = build_package(
            self.root, self.private, license_id="MPL-2.0"
        )
        plan = self.manager.plan(self.developer, package)
        self.assertEqual(plan["decision"], "approval-required")

    def test_16_external_worker_blocked(self):
        package = build_package(
            self.root,
            self.private,
            entrypoint_type="python-worker",
            entrypoint_value="payload/main.py",
        )
        plan = self.manager.plan(self.developer, package)
        self.assertEqual(plan["decision"], "deny")

    def test_17_physical_actuation_non_bypassable(self):
        package = build_package(
            self.root, self.private, permissions=["physical.actuate"]
        )
        plan = self.manager.plan(self.owner, package)
        self.assertEqual(plan["decision"], "deny")

    def test_18_high_risk_industry_requires_owner(self):
        industry = {
            "riskClass": "high",
            "intendedUse": ["research support"],
            "excludedUse": ["autonomous actuation"],
            "evidence": [{"type":"validation","reference":"EV-1","sha256":"1"*64}],
        }
        package = build_package(
            self.root, self.private,
            capability_id="noesar.medical-research",
            kind="industry-module",
            industry=industry,
        )
        plan = self.manager.plan(self.admin, package)
        self.assertEqual(plan["decision"], "deny")

    def test_19_high_risk_industry_requires_evidence(self):
        industry = {
            "riskClass": "high",
            "intendedUse": ["research support"],
            "excludedUse": ["autonomous actuation"],
            "evidence": [],
        }
        package = build_package(
            self.root, self.private,
            capability_id="noesar.medical-research",
            kind="industry-module",
            industry=industry,
        )
        plan = self.manager.plan(self.owner, package)
        self.assertEqual(plan["decision"], "deny")

    def test_20_high_risk_industry_owner_strong_reauth(self):
        industry = {
            "riskClass": "high",
            "intendedUse": ["research support"],
            "excludedUse": ["autonomous actuation"],
            "evidence": [{"type":"validation","reference":"EV-1","sha256":"1"*64}],
        }
        package = build_package(
            self.root, self.private,
            capability_id="noesar.medical-research",
            kind="industry-module",
            industry=industry,
        )
        weak_owner = principal("owner", strong=False)
        plan = self.manager.plan(weak_owner, package)
        self.assertEqual(plan["decision"], "approval-required")
        self.assertTrue(plan["strongReauthRequired"])
        with self.assertRaisesRegex(PermissionError, "strong reauthentication"):
            self.manager.approve(weak_owner, plan)

    def test_21_community_industry_module_denied(self):
        community_private, community_public = make_keys(self.root, "community")
        self.manager.register_publisher(
            self.owner, "community.publisher", "community", community_public
        )
        industry = {
            "riskClass": "standard",
            "intendedUse": ["internal workflow"],
            "excludedUse": ["certified decision"],
            "evidence": [],
        }
        package = build_package(
            self.root, community_private,
            capability_id="community.industry",
            publisher_id="community.publisher",
            trust_level="community",
            kind="industry-module",
            industry=industry,
        )
        plan = self.manager.plan(self.developer, package)
        self.assertEqual(plan["decision"], "deny")

    def test_22_mcp_default_distrust(self):
        manifest = mcp_tool_to_manifest(
            "example",
            {"name":"host-read","permissions":["filesystem.host"]},
            {"id":"external.mcp","trustLevel":"community"},
        )
        result = evaluate_protocol_declaration(manifest, self.developer)
        self.assertFalse(result["trusted"])
        self.assertEqual(result["decision"], "deny")

    def test_23_a2a_default_distrust(self):
        manifest = a2a_agent_to_manifest(
            {
                "agentId":"remote",
                "endpoint":"https://example.invalid/a2a",
                "requestedPermissions":["network.external"],
            },
            {"id":"external.a2a","trustLevel":"community"},
        )
        result = evaluate_protocol_declaration(manifest, self.developer)
        self.assertEqual(result["decision"], "deny")

    def test_24_disable_uninstall_rollback(self):
        package = build_package(self.root, self.private)
        plan = self.manager.plan(self.developer, package)
        self.manager.install(self.developer, package, plan, None)
        self.manager.activate(self.admin, "noesar.text-statistics")
        self.manager.disable(self.admin, "noesar.text-statistics")
        self.manager.uninstall(self.admin, "noesar.text-statistics")
        rolled = self.manager.rollback(self.admin, "noesar.text-statistics")
        self.assertEqual(rolled["state"], "active")

    def test_25_audit_chain(self):
        package = build_package(self.root, self.private)
        self.manager.verify(self.developer, package)
        self.assertTrue(self.manager.audit.verify())

    def test_26_archive_traversal_rejected(self):
        package = self.root / "unsafe.zip"
        with ZipFile(package, "w") as archive:
            archive.writestr("../../escape", b"x")
            archive.writestr("manifest.json", b"{}")
            archive.writestr("manifest.sig", b"x")
        with self.assertRaisesRegex(ValueError, "unsafe archive path"):
            self.manager.inspect(self.developer, package)


if __name__ == "__main__":
    unittest.main(verbosity=2)
