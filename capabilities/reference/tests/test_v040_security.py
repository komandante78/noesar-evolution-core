# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from noesar_capabilities.execution_authority import CapabilityExecutionAuthority
from noesar_capabilities.identity import Principal
from noesar_capabilities.ipc import create_envelope, verify_envelope
from noesar_capabilities.sandbox_attestation import (
    verify_production_sandbox_attestation,
)

PROFILE_SHA = "876fa735264b4a015470b40d41ccfbad4442212ea31eb51fd6cd4c6815335ec9"
NOW = 1_800_000_000


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class V040SecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="noesar-v040-security-")
        self.root = Path(self.temp.name)
        self.secret = b"k" * 32
        self.principal = Principal(
            actor_id="owner-1",
            role="owner",
            session_id="session-1",
            authenticated_at=NOW,
            strong_reauth_until=NOW + 300,
        )

    def tearDown(self):
        self.temp.cleanup()

    def envelope(self, **overrides):
        value = {
            "actor_id":"owner-1",
            "session_id":"session-1",
            "action":"capability.execute",
            "payload":{"operation":"run"},
            "nonce":"0123456789abcdef",
            "ttl_seconds":20,
            "now":NOW,
            "plan_hash":"a" * 64,
            "capability_id":"com.noesar.test",
            "capability_version":"1.0.0",
        }
        value.update(overrides)
        return create_envelope(self.secret, **value)

    def attestation(self, **overrides):
        launcher = self.root / "launcher"
        seccomp = self.root / "seccomp.json"
        report = self.root / "escape-report.json"
        launcher.write_bytes(b"attested launcher\n")
        seccomp.write_text('{"defaultAction":"SCMP_ACT_ERRNO"}\n', encoding="utf-8")
        report.write_text('{"verdict":"PASS"}\n', encoding="utf-8")
        value = {
            "schemaVersion":"2.0",
            "kind":"capability-os-sandbox",
            "release":"0.4.0",
            "profile":"os-isolated",
            "profileSha256":PROFILE_SHA,
            "capabilityId":"com.noesar.test",
            "capabilityVersion":"1.0.0",
            "adapter":"linux-namespace-seccomp-launcher",
            "launcherPath":str(launcher),
            "launcherSha256":digest(launcher),
            "seccompProfilePath":str(seccomp),
            "seccompProfileSha256":digest(seccomp),
            "escapeTestReportPath":str(report),
            "escapeTestReportSha256":digest(report),
            "platform":"linux",
            "kernel":"test-kernel",
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
        }
        value.update(overrides)
        path = self.root / "attestation.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        return path, launcher, seccomp, report

    def plan(self, profile="declarative", **overrides):
        value = {
            "capabilityId":"com.noesar.test",
            "version":"1.0.0",
            "actorId":"owner-1",
            "sessionId":"session-1",
            "planHash":"a" * 64,
            "decision":"allow",
            "sandboxProfile":profile,
        }
        value.update(overrides)
        return value

    def approval(self, **overrides):
        value = {
            "nonce":"approval-0123456789",
            "actorId":"owner-1",
            "sessionId":"session-1",
            "capabilityId":"com.noesar.test",
            "version":"1.0.0",
            "planHash":"a" * 64,
            "expiresAt":NOW + 60,
        }
        value.update(overrides)
        return value

    def test_01_ipc_rejects_short_secret(self):
        with self.assertRaisesRegex(ValueError, "at least 32"):
            create_envelope(
                b"x",
                actor_id="a",
                session_id="s",
                action="capability.execute",
                payload={},
                nonce="0123456789abcdef",
            )

    def test_02_ipc_rejects_unknown_action(self):
        with self.assertRaisesRegex(ValueError, "unsupported"):
            self.envelope(action="host.execute")

    def test_03_ipc_rejects_long_lifetime(self):
        with self.assertRaisesRegex(ValueError, "between 1 and 30"):
            self.envelope(ttl_seconds=31)

    def test_04_ipc_valid_envelope_verifies_with_bindings(self):
        used = {}
        body = verify_envelope(
            self.secret,
            self.envelope(),
            used_nonces=used,
            now=NOW,
            expected_actor_id="owner-1",
            expected_session_id="session-1",
            expected_action="capability.execute",
            expected_plan_hash="a" * 64,
        )
        self.assertEqual(body["capabilityId"], "com.noesar.test")
        self.assertIn("0123456789abcdef", used)

    def test_05_ipc_rejects_actor_binding_mismatch(self):
        with self.assertRaisesRegex(ValueError, "actorId binding"):
            verify_envelope(
                self.secret,
                self.envelope(),
                used_nonces=set(),
                now=NOW,
                expected_actor_id="other",
            )

    def test_06_ipc_rejects_session_binding_mismatch(self):
        with self.assertRaisesRegex(ValueError, "sessionId binding"):
            verify_envelope(
                self.secret,
                self.envelope(),
                used_nonces=set(),
                now=NOW,
                expected_session_id="other",
            )

    def test_07_ipc_rejects_plan_binding_mismatch(self):
        with self.assertRaisesRegex(ValueError, "planHash binding"):
            verify_envelope(
                self.secret,
                self.envelope(),
                used_nonces=set(),
                now=NOW,
                expected_plan_hash="b" * 64,
            )

    def test_08_ipc_rejects_future_envelope(self):
        with self.assertRaisesRegex(ValueError, "future"):
            verify_envelope(
                self.secret,
                self.envelope(now=NOW + 20),
                used_nonces=set(),
                now=NOW,
                max_clock_skew_seconds=5,
            )

    def test_09_ipc_rejects_replay(self):
        used = {}
        envelope = self.envelope()
        verify_envelope(self.secret, envelope, used_nonces=used, now=NOW)
        with self.assertRaisesRegex(ValueError, "replay"):
            verify_envelope(self.secret, envelope, used_nonces=used, now=NOW)

    def test_10_production_attestation_verifies_all_hashes(self):
        path, launcher, seccomp, _ = self.attestation()
        value = verify_production_sandbox_attestation(
            path,
            expected_profile_sha256=PROFILE_SHA,
            expected_capability_id="com.noesar.test",
            expected_capability_version="1.0.0",
            expected_launcher_sha256=digest(launcher),
            expected_seccomp_sha256=digest(seccomp),
        )
        self.assertTrue(value["escapeTestsPassed"])

    def test_11_production_attestation_rejects_launcher_tamper(self):
        path, launcher, _, _ = self.attestation()
        launcher.write_bytes(b"tampered\n")
        with self.assertRaisesRegex(ValueError, "launcherSha256 mismatch"):
            verify_production_sandbox_attestation(
                path,
                expected_profile_sha256=PROFILE_SHA,
            )

    def test_12_production_attestation_rejects_seccomp_tamper(self):
        path, _, seccomp, _ = self.attestation()
        seccomp.write_text('{"tampered":true}\n', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "seccompProfileSha256 mismatch"):
            verify_production_sandbox_attestation(
                path,
                expected_profile_sha256=PROFILE_SHA,
            )

    def test_13_production_attestation_rejects_report_tamper(self):
        path, _, _, report = self.attestation()
        report.write_text('{"verdict":"FAIL"}\n', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "escapeTestReportSha256 mismatch"):
            verify_production_sandbox_attestation(
                path,
                expected_profile_sha256=PROFILE_SHA,
            )

    def test_14_production_attestation_rejects_capability_mismatch(self):
        path, _, _, _ = self.attestation()
        with self.assertRaisesRegex(ValueError, "capabilityId mismatch"):
            verify_production_sandbox_attestation(
                path,
                expected_profile_sha256=PROFILE_SHA,
                expected_capability_id="other",
            )

    def test_15_production_attestation_rejects_network_policy(self):
        path, _, _, _ = self.attestation(networkPolicy="allow")
        with self.assertRaisesRegex(ValueError, "deny-by-default"):
            verify_production_sandbox_attestation(
                path,
                expected_profile_sha256=PROFILE_SHA,
            )

    def test_16_declarative_execution_is_authorized(self):
        value = CapabilityExecutionAuthority().authorize(
            principal=self.principal,
            plan=self.plan(),
            approval=self.approval(),
            sandbox_profile_sha256=PROFILE_SHA,
            now=NOW,
        )
        self.assertTrue(value.production_eligible)
        self.assertFalse(value.attestation_verified)

    def test_17_development_fixture_requires_explicit_gate(self):
        authority = CapabilityExecutionAuthority()
        with self.assertRaisesRegex(PermissionError, "explicit fixture"):
            authority.authorize(
                principal=self.principal,
                plan=self.plan("process-restricted-development-fixture"),
                approval=self.approval(),
                sandbox_profile_sha256=PROFILE_SHA,
                now=NOW,
            )

    def test_18_development_fixture_is_not_production_eligible(self):
        value = CapabilityExecutionAuthority().authorize(
            principal=self.principal,
            plan=self.plan("process-restricted-development-fixture"),
            approval=self.approval(),
            sandbox_profile_sha256=PROFILE_SHA,
            development_fixture=True,
            now=NOW,
        )
        self.assertFalse(value.production_eligible)

    def test_19_os_isolated_requires_attestation(self):
        with self.assertRaisesRegex(PermissionError, "requires"):
            CapabilityExecutionAuthority().authorize(
                principal=self.principal,
                plan=self.plan("os-isolated"),
                approval=self.approval(),
                sandbox_profile_sha256=PROFILE_SHA,
                now=NOW,
            )

    def test_20_os_isolated_accepts_bound_attestation(self):
        path, launcher, seccomp, _ = self.attestation()
        value = CapabilityExecutionAuthority().authorize(
            principal=self.principal,
            plan=self.plan("os-isolated"),
            approval=self.approval(),
            sandbox_profile_sha256=PROFILE_SHA,
            attestation_path=path,
            expected_launcher_sha256=digest(launcher),
            expected_seccomp_sha256=digest(seccomp),
            now=NOW,
        )
        self.assertFalse(value.production_eligible)
        self.assertTrue(value.attestation_verified)
        self.assertFalse(value.evidence_chain_verified)

    def test_21_approval_binding_mismatch_is_rejected(self):
        with self.assertRaisesRegex(PermissionError, "planHash binding"):
            CapabilityExecutionAuthority().authorize(
                principal=self.principal,
                plan=self.plan(),
                approval=self.approval(planHash="b" * 64),
                sandbox_profile_sha256=PROFILE_SHA,
                now=NOW,
            )

    def test_22_approval_replay_is_rejected(self):
        authority = CapabilityExecutionAuthority()
        plan = self.plan()
        approval = self.approval()
        authority.authorize(
            principal=self.principal,
            plan=plan,
            approval=approval,
            sandbox_profile_sha256=PROFILE_SHA,
            now=NOW,
        )
        with self.assertRaisesRegex(PermissionError, "replay"):
            authority.authorize(
                principal=self.principal,
                plan=plan,
                approval=approval,
                sandbox_profile_sha256=PROFILE_SHA,
                now=NOW,
            )

    def test_23_expired_approval_is_rejected(self):
        with self.assertRaisesRegex(PermissionError, "expired"):
            CapabilityExecutionAuthority().authorize(
                principal=self.principal,
                plan=self.plan(),
                approval=self.approval(expiresAt=NOW - 1),
                sandbox_profile_sha256=PROFILE_SHA,
                now=NOW,
            )

    def test_24_denied_plan_is_rejected(self):
        with self.assertRaisesRegex(PermissionError, "denied"):
            CapabilityExecutionAuthority().authorize(
                principal=self.principal,
                plan=self.plan(decision="deny"),
                approval=self.approval(),
                sandbox_profile_sha256=PROFILE_SHA,
                now=NOW,
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
