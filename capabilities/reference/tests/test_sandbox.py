# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference"))

from noesar_capabilities.ipc import create_envelope, verify_envelope
from noesar_capabilities.sandbox import (
    CapabilityExecutionBroker,
    ResourceLimits,
    probe_unshare,
)
from noesar_capabilities.sandbox_attestation import verify_sandbox_attestation

FIXTURES = ROOT / "reference/tests/fixtures"
PROFILE_SHA = "c4545be71b247c7267691dc685ed03ec44b5aa59289cdebcb33072e04e95147d"


class SandboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="noesar-sandbox-v030-")
        self.root = Path(self.temp.name)
        self.broker = CapabilityExecutionBroker(self.root / "workspace")

    def tearDown(self):
        self.temp.cleanup()

    def test_01_unshare_probe_is_truthful(self):
        status = probe_unshare()
        self.assertEqual(status.available, status.kernel_enforced_network_deny)
        self.assertTrue(status.evidence)


    def test_02_os_isolated_execution_is_fail_closed_without_adapter(self):
        launcher = self.root / "launcher"
        seccomp = self.root / "seccomp.json"
        report = self.root / "escape-report.json"
        launcher.write_bytes(b"launcher\n")
        seccomp.write_text('{"defaultAction":"SCMP_ACT_ERRNO"}\n', encoding="utf-8")
        report.write_text('{"verdict":"PASS"}\n', encoding="utf-8")
        attestation = self.root / "sandbox-attestation.json"
        attestation.write_text(json.dumps({
            "schemaVersion":"2.0",
            "kind":"capability-os-sandbox",
            "release":"0.4.0",
            "profile":"os-isolated",
            "profileSha256":PROFILE_SHA,
            "capabilityId":"com.noesar.fixture",
            "capabilityVersion":"1.0.0",
            "adapter":"linux-namespace-seccomp-launcher",
            "launcherPath":str(launcher),
            "launcherSha256":hashlib.sha256(launcher.read_bytes()).hexdigest(),
            "seccompProfilePath":str(seccomp),
            "seccompProfileSha256":hashlib.sha256(seccomp.read_bytes()).hexdigest(),
            "escapeTestReportPath":str(report),
            "escapeTestReportSha256":hashlib.sha256(report.read_bytes()).hexdigest(),
            "platform":"linux",
            "kernel":"test",
            "noNewPrivileges":True,
            "userNamespace":True,
            "uidMapRestricted":True,
            "gidMapRestricted":True,
            "mountNamespace":True,
            "pidNamespace":True,
            "networkNamespace":True,
            "ipcNamespace":True,
            "utsNamespace":True,
            "seccomp":True,
            "resourceLimits":True,
            "filesystemIsolation":True,
            "processIsolation":True,
            "escapeTestsPassed":True,
            "networkPolicy":"deny-by-default",
            "filesystemPolicy":"allowlisted-readonly-root",
            "createdUtc":"2026-07-22T00:00:00Z",
        }), encoding="utf-8")
        broker = CapabilityExecutionBroker(
            self.root / "os-workspace",
            profile_sha256=PROFILE_SHA,
        )
        with self.assertRaisesRegex(
            PermissionError,
            "execution ticket and bindings are required",
        ):
            broker.run_external(
                argv=[str(FIXTURES / "echo_worker.py")],
                trusted_root=FIXTURES,
                permissions=[],
                attestation_path=attestation,
                capability_id="com.noesar.fixture",
                capability_version="1.0.0",
                expected_launcher_sha256=hashlib.sha256(
                    launcher.read_bytes()
                ).hexdigest(),
                expected_seccomp_sha256=hashlib.sha256(
                    seccomp.read_bytes()
                ).hexdigest(),
            )
    
    def test_03_shell_string_is_rejected(self):
        with self.assertRaisesRegex(TypeError, "shell strings"):
            self.broker.run_development_fixture(
                argv="echo unsafe",
                trusted_root=FIXTURES,
            )

    def test_04_relative_executable_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "absolute path"):
            self.broker.run_development_fixture(
                argv=["python3", str(FIXTURES / "echo_worker.py")],
                trusted_root=FIXTURES,
            )

    def test_05_executable_outside_trusted_root_is_rejected(self):
        with self.assertRaisesRegex(PermissionError, "outside"):
            self.broker.run_development_fixture(
                argv=[sys.executable, str(FIXTURES / "echo_worker.py")],
                trusted_root=FIXTURES,
            )

    def test_06_symlink_executable_is_rejected(self):
        link = self.root / "worker-link"
        link.symlink_to(FIXTURES / "echo_worker.py")
        with self.assertRaisesRegex(ValueError, "symbolic-link"):
            self.broker.run_development_fixture(
                argv=[str(link)],
                trusted_root=self.root,
            )

    def test_07_fixture_executes_without_shell(self):
        receipt = self.broker.run_development_fixture(
            argv=[str(FIXTURES / "echo_worker.py"), "alpha", "beta"],
            trusted_root=FIXTURES,
        )
        self.assertEqual(receipt.exit_code, 0)
        result = json.loads(receipt.stdout)
        self.assertEqual(result["argv"], ["alpha", "beta"])
        self.assertEqual(result["network"], "denied")
        self.assertFalse(result["secretPresent"])

    def test_08_environment_is_sanitized(self):
        os.environ["NOESAR_TEST_SECRET"] = "must-not-leak"
        try:
            receipt = self.broker.run_development_fixture(
                argv=[str(FIXTURES / "echo_worker.py")],
                trusted_root=FIXTURES,
            )
        finally:
            os.environ.pop("NOESAR_TEST_SECRET", None)
        self.assertFalse(json.loads(receipt.stdout)["secretPresent"])

    def test_09_ephemeral_workspace_is_destroyed(self):
        receipt = self.broker.run_development_fixture(
            argv=[str(FIXTURES / "echo_worker.py")],
            trusted_root=FIXTURES,
        )
        self.assertTrue(receipt.workspace_destroyed)
        self.assertFalse(any((self.root / "workspace/executions").iterdir()))

    def test_10_timeout_is_enforced(self):
        receipt = self.broker.run_development_fixture(
            argv=[str(FIXTURES / "sleep_worker.py")],
            trusted_root=FIXTURES,
            limits=ResourceLimits(cpu_seconds=2, wall_seconds=0.25),
        )
        self.assertTrue(receipt.timed_out)
        self.assertLess(receipt.duration_ms, 5000)

    def test_11_stdout_is_truncated(self):
        receipt = self.broker.run_development_fixture(
            argv=[str(FIXTURES / "output_worker.py")],
            trusted_root=FIXTURES,
            limits=ResourceLimits(stdout_bytes=4096),
        )
        self.assertTrue(receipt.stdout_truncated)
        self.assertLessEqual(len(receipt.stdout.encode()), 4096)

    def test_12_sensitive_permissions_are_denied(self):
        for permission in [
            "network.external",
            "secret.read",
            "filesystem.host",
            "shell.execute",
            "physical.actuate",
        ]:
            with self.subTest(permission=permission):
                with self.assertRaisesRegex(PermissionError, "denies"):
                    self.broker.run_development_fixture(
                        argv=[str(FIXTURES / "echo_worker.py")],
                        trusted_root=FIXTURES,
                        permissions=[permission],
                    )

    def test_13_receipt_contains_no_command_arguments(self):
        marker = "TOP_SECRET_ARGUMENT"
        receipt = self.broker.run_development_fixture(
            argv=[str(FIXTURES / "echo_worker.py"), marker],
            trusted_root=FIXTURES,
        )
        receipt_path = (
            self.root
            / "workspace/receipts"
            / f"{receipt.execution_id}.json"
        )
        persisted = receipt_path.read_text(encoding="utf-8")
        self.assertNotIn(marker, persisted)
        self.assertEqual(len(receipt.command_sha256), 64)

    def test_14_valid_sandbox_attestation_is_accepted(self):
        path = self.root / "attestation.json"
        path.write_text(json.dumps({
            "schemaVersion":"1.0",
            "kind":"capability-os-sandbox",
            "profileSha256":PROFILE_SHA,
            "platform":"linux",
            "kernel":"test",
            "userNamespace":True,
            "mountNamespace":True,
            "pidNamespace":True,
            "networkNamespace":True,
            "ipcNamespace":True,
            "utsNamespace":True,
            "seccomp":True,
            "resourceLimits":True,
            "filesystemIsolation":True,
            "escapeTestsPassed":True,
            "testReportSha256":"1" * 64,
            "createdUtc":"2026-07-22T00:00:00Z",
        }), encoding="utf-8")
        value = verify_sandbox_attestation(
            path,
            expected_profile_sha256=PROFILE_SHA,
        )
        self.assertTrue(value["escapeTestsPassed"])

    def test_15_tampered_sandbox_attestation_is_rejected(self):
        path = self.root / "attestation.json"
        path.write_text(json.dumps({
            "schemaVersion":"1.0",
            "kind":"capability-os-sandbox",
            "profileSha256":"0" * 64,
            "platform":"linux",
            "kernel":"test",
            "userNamespace":True,
            "mountNamespace":True,
            "pidNamespace":True,
            "networkNamespace":True,
            "ipcNamespace":True,
            "utsNamespace":True,
            "seccomp":True,
            "resourceLimits":True,
            "filesystemIsolation":True,
            "escapeTestsPassed":True,
            "testReportSha256":"1" * 64,
            "createdUtc":"2026-07-22T00:00:00Z",
        }), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "profile hash"):
            verify_sandbox_attestation(
                path,
                expected_profile_sha256=PROFILE_SHA,
            )

    def test_16_authenticated_ipc_replay_is_rejected(self):
        secret = b"s" * 32
        used = set()
        envelope = create_envelope(
            secret,
            actor_id="owner",
            session_id="session",
            action="capability.execute",
            payload={"capabilityId":"test"},
            nonce="0123456789abcdef",
        )
        verified = verify_envelope(secret, envelope, used_nonces=used)
        self.assertEqual(verified["actorId"], "owner")
        with self.assertRaisesRegex(ValueError, "replay"):
            verify_envelope(secret, envelope, used_nonces=used)


if __name__ == "__main__":
    unittest.main(verbosity=2)
