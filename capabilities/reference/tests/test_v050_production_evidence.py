# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from noesar_capabilities.execution_authority import CapabilityExecutionAuthority
from noesar_capabilities.execution_ticket import (
    ExecutionTicketIssuer,
    verify_execution_ticket,
)
from noesar_capabilities.identity import Principal
from noesar_capabilities.production_evidence import (
    verify_capability_production_evidence,
)
from noesar_capabilities.sandbox_attestation import (
    verify_production_sandbox_attestation,
)

NOW = 1_800_000_000
PROFILE_SHA = "d04474156f37808d2f25abed45ea5a55061e39b1ba0fba206ebade49dfaa37ea"
PLAN_HASH = "a" * 64


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class V050ProductionEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="noesar-v050-evidence-")
        self.root = Path(self.temp.name)
        self.principal = Principal(
            actor_id="owner-1",
            role="owner",
            session_id="session-1",
            authenticated_at=NOW,
            strong_reauth_until=NOW + 300,
        )
        self.paths = self.make_evidence()

    def tearDown(self):
        self.temp.cleanup()

    def write_json(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
        return path

    def make_evidence(self):
        package = self.root / "capability.zip"
        policy = self.root / "policy.json"
        launcher = self.root / "launcher"
        seccomp = self.root / "seccomp.json"
        escape = self.root / "escape.json"
        package.write_bytes(b"capability-package-v050\n")
        policy.write_text('{"decision":"allow","planHash":"' + PLAN_HASH + '"}\n', encoding="utf-8")
        launcher.write_bytes(b"production-launcher-v050\n")
        seccomp.write_text('{"defaultAction":"SCMP_ACT_ERRNO"}\n', encoding="utf-8")
        escape.write_text('{"verdict":"PASS"}\n', encoding="utf-8")

        authority = self.write_json("authority.json", {
            "schemaVersion":"3.0",
            "kind":"rust-authority",
            "release":"0.5.0",
            "protocolVersion":"1.1",
            "canonicalJsonConformancePassed":True,
            "hmacConformancePassed":True,
            "authenticatedIpc":True,
            "peerCredentialsVerified":True,
            "frameBoundaryTestsPassed":True,
            "testsPassed":True,
            "transport":"unix-domain-socket",
        })
        postgres = self.write_json("postgres.json", {
            "schemaVersion":"3.0",
            "kind":"postgresql-data-plane",
            "release":"0.5.0",
            "serverVersionNumber":180000,
            "pgvectorVersion":"0.8.0",
            "connected":True,
            "migrationsVerified":True,
            "roleSeparationVerified":True,
            "publicSchemaRevocationVerified":True,
            "applicationRoleNoBypassRls":True,
            "rowLevelSecurityVerified":True,
            "immutableLedgersVerified":True,
            "securityAcceptanceViewVerified":True,
            "repositoryAdapterActive":True,
            "backupRestoreVerified":True,
            "legacyV030Rejected":True,
            "baselineV040Preserved":True,
        })
        readiness = self.write_json("readiness.json", {
            "schemaVersion":"1.0",
            "release":"0.5.0",
            "productionReady":True,
            "checks":{
                "rustAuthority":True,
                "postgresDataPlane":True,
                "productionSandbox":True,
                "platformMatrix":True,
                "updateTrust":True,
                "penetrationTest":True,
            },
            "blockers":[],
        })

        sandbox_value = {
            "schemaVersion":"3.0",
            "kind":"capability-os-sandbox",
            "release":"0.5.0",
            "profile":"os-isolated",
            "profileSha256":PROFILE_SHA,
            "capabilityId":"com.noesar.test",
            "capabilityVersion":"1.0.0",
            "planHash":PLAN_HASH,
            "authorityProtocolVersion":"1.1",
            "runtimeVersion":"0.5.0",
            "adapter":"linux-namespace-seccomp-launcher",
            "launcherPath":str(launcher),
            "launcherSha256":digest(launcher),
            "seccompProfilePath":str(seccomp),
            "seccompProfileSha256":digest(seccomp),
            "escapeTestReportPath":str(escape),
            "escapeTestReportSha256":digest(escape),
            "authorityAttestationSha256":digest(authority),
            "postgresAttestationSha256":digest(postgres),
            "capabilityPackageSha256":digest(package),
            "policyDecisionSha256":digest(policy),
            "runtimeReadinessSha256":digest(readiness),
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
            "createdUtc":"2026-07-23T00:00:00Z",
        }
        sandbox = self.write_json("sandbox.json", sandbox_value)

        evidence_value = {
            "schemaVersion":"1.0",
            "kind":"capability-production-evidence",
            "release":"0.5.0",
            "capabilityId":"com.noesar.test",
            "capabilityVersion":"1.0.0",
            "planHash":PLAN_HASH,
            "profileSha256":PROFILE_SHA,
            "authorityProtocolVersion":"1.1",
            "runtimeVersion":"0.5.0",
            "capabilityPackagePath":str(package),
            "capabilityPackageSha256":digest(package),
            "policyDecisionPath":str(policy),
            "policyDecisionSha256":digest(policy),
            "authorityAttestationPath":str(authority),
            "authorityAttestationSha256":digest(authority),
            "postgresAttestationPath":str(postgres),
            "postgresAttestationSha256":digest(postgres),
            "sandboxAttestationPath":str(sandbox),
            "sandboxAttestationSha256":digest(sandbox),
            "runtimeReadinessPath":str(readiness),
            "runtimeReadinessSha256":digest(readiness),
        }
        evidence = self.write_json("production-evidence.json", evidence_value)
        return {
            "package":package,
            "policy":policy,
            "launcher":launcher,
            "seccomp":seccomp,
            "escape":escape,
            "authority":authority,
            "postgres":postgres,
            "readiness":readiness,
            "sandbox":sandbox,
            "evidence":evidence,
        }

    def reload(self, key):
        return json.loads(self.paths[key].read_text(encoding="utf-8"))

    def persist(self, key, value):
        self.paths[key].write_text(json.dumps(value, sort_keys=True), encoding="utf-8")

    def verify(self):
        return verify_capability_production_evidence(
            self.paths["evidence"],
            expected_capability_id="com.noesar.test",
            expected_capability_version="1.0.0",
            expected_plan_hash=PLAN_HASH,
            expected_profile_sha256=PROFILE_SHA,
        )

    def plan(self):
        return {
            "capabilityId":"com.noesar.test",
            "version":"1.0.0",
            "actorId":"owner-1",
            "sessionId":"session-1",
            "planHash":PLAN_HASH,
            "decision":"allow",
            "sandboxProfile":"os-isolated",
        }

    def approval(self, nonce="approval-0123456789"):
        return {
            "nonce":nonce,
            "actorId":"owner-1",
            "sessionId":"session-1",
            "capabilityId":"com.noesar.test",
            "version":"1.0.0",
            "planHash":PLAN_HASH,
            "expiresAt":NOW + 60,
        }

    def authorization(self):
        return CapabilityExecutionAuthority().authorize_production(
            principal=self.principal,
            plan=self.plan(),
            approval=self.approval(),
            sandbox_profile_sha256=PROFILE_SHA,
            attestation_path=self.paths["sandbox"],
            production_evidence_path=self.paths["evidence"],
            expected_launcher_sha256=digest(self.paths["launcher"]),
            expected_seccomp_sha256=digest(self.paths["seccomp"]),
            now=NOW,
        )

    def test_01_valid_production_evidence(self):
        value = self.verify()
        self.assertEqual(value.capability_id, "com.noesar.test")
        self.assertEqual(len(value.evidence_sha256), 64)

    def test_02_capability_id_binding(self):
        with self.assertRaisesRegex(ValueError, "capabilityId mismatch"):
            verify_capability_production_evidence(
                self.paths["evidence"],
                expected_capability_id="other",
                expected_capability_version="1.0.0",
                expected_plan_hash=PLAN_HASH,
                expected_profile_sha256=PROFILE_SHA,
            )

    def test_03_capability_version_binding(self):
        with self.assertRaisesRegex(ValueError, "capabilityVersion mismatch"):
            verify_capability_production_evidence(
                self.paths["evidence"],
                expected_capability_id="com.noesar.test",
                expected_capability_version="2.0.0",
                expected_plan_hash=PLAN_HASH,
                expected_profile_sha256=PROFILE_SHA,
            )

    def test_04_plan_hash_binding(self):
        with self.assertRaisesRegex(ValueError, "planHash mismatch"):
            verify_capability_production_evidence(
                self.paths["evidence"],
                expected_capability_id="com.noesar.test",
                expected_capability_version="1.0.0",
                expected_plan_hash="b" * 64,
                expected_profile_sha256=PROFILE_SHA,
            )

    def test_05_profile_hash_binding(self):
        with self.assertRaisesRegex(ValueError, "profileSha256 mismatch"):
            verify_capability_production_evidence(
                self.paths["evidence"],
                expected_capability_id="com.noesar.test",
                expected_capability_version="1.0.0",
                expected_plan_hash=PLAN_HASH,
                expected_profile_sha256="b" * 64,
            )

    def test_06_authority_protocol_binding(self):
        value = self.reload("evidence")
        value["authorityProtocolVersion"] = "1.0"
        self.persist("evidence", value)
        with self.assertRaisesRegex(ValueError, "V1.1"):
            self.verify()

    def test_07_authority_peer_credentials_required(self):
        value = self.reload("authority")
        value["peerCredentialsVerified"] = False
        self.persist("authority", value)
        evidence = self.reload("evidence")
        evidence["authorityAttestationSha256"] = digest(self.paths["authority"])
        self.persist("evidence", evidence)
        sandbox = self.reload("sandbox")
        sandbox["authorityAttestationSha256"] = digest(self.paths["authority"])
        self.persist("sandbox", sandbox)
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "peerCredentialsVerified"):
            self.verify()

    def test_08_authority_transport_required(self):
        value = self.reload("authority")
        value["transport"] = "tcp"
        self.persist("authority", value)
        evidence = self.reload("evidence")
        evidence["authorityAttestationSha256"] = digest(self.paths["authority"])
        self.persist("evidence", evidence)
        sandbox = self.reload("sandbox")
        sandbox["authorityAttestationSha256"] = digest(self.paths["authority"])
        self.persist("sandbox", sandbox)
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "transport"):
            self.verify()

    def test_09_postgres_18_required(self):
        value = self.reload("postgres")
        value["serverVersionNumber"] = 170999
        self.persist("postgres", value)
        evidence = self.reload("evidence")
        evidence["postgresAttestationSha256"] = digest(self.paths["postgres"])
        self.persist("evidence", evidence)
        sandbox = self.reload("sandbox")
        sandbox["postgresAttestationSha256"] = digest(self.paths["postgres"])
        self.persist("sandbox", sandbox)
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "PostgreSQL 18"):
            self.verify()

    def test_10_pgvector_required(self):
        value = self.reload("postgres")
        value["pgvectorVersion"] = ""
        self.persist("postgres", value)
        evidence = self.reload("evidence")
        evidence["postgresAttestationSha256"] = digest(self.paths["postgres"])
        self.persist("evidence", evidence)
        sandbox = self.reload("sandbox")
        sandbox["postgresAttestationSha256"] = digest(self.paths["postgres"])
        self.persist("sandbox", sandbox)
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "pgvector"):
            self.verify()

    def test_11_postgres_rls_role_required(self):
        value = self.reload("postgres")
        value["applicationRoleNoBypassRls"] = False
        self.persist("postgres", value)
        evidence = self.reload("evidence")
        evidence["postgresAttestationSha256"] = digest(self.paths["postgres"])
        self.persist("evidence", evidence)
        sandbox = self.reload("sandbox")
        sandbox["postgresAttestationSha256"] = digest(self.paths["postgres"])
        self.persist("sandbox", sandbox)
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "applicationRoleNoBypassRls"):
            self.verify()

    def test_12_runtime_readiness_required(self):
        value = self.reload("readiness")
        value["productionReady"] = False
        self.persist("readiness", value)
        evidence = self.reload("evidence")
        evidence["runtimeReadinessSha256"] = digest(self.paths["readiness"])
        self.persist("evidence", evidence)
        sandbox = self.reload("sandbox")
        sandbox["runtimeReadinessSha256"] = digest(self.paths["readiness"])
        self.persist("sandbox", sandbox)
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "not production-ready"):
            self.verify()

    def test_13_runtime_blockers_rejected(self):
        value = self.reload("readiness")
        value["blockers"] = ["rustAuthority"]
        self.persist("readiness", value)
        evidence = self.reload("evidence")
        evidence["runtimeReadinessSha256"] = digest(self.paths["readiness"])
        self.persist("evidence", evidence)
        sandbox = self.reload("sandbox")
        sandbox["runtimeReadinessSha256"] = digest(self.paths["readiness"])
        self.persist("sandbox", sandbox)
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "blockers"):
            self.verify()

    def test_14_sandbox_authority_hash_binding(self):
        value = self.reload("sandbox")
        value["authorityAttestationSha256"] = "0" * 64
        self.persist("sandbox", value)
        evidence = self.reload("evidence")
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "authorityAttestationSha256"):
            self.verify()

    def test_15_sandbox_policy_hash_binding(self):
        value = self.reload("sandbox")
        value["policyDecisionSha256"] = "0" * 64
        self.persist("sandbox", value)
        evidence = self.reload("evidence")
        evidence["sandboxAttestationSha256"] = digest(self.paths["sandbox"])
        self.persist("evidence", evidence)
        with self.assertRaisesRegex(ValueError, "policyDecisionSha256"):
            self.verify()

    def test_16_capability_package_tampering(self):
        self.paths["package"].write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "capabilityPackageSha256 mismatch"):
            self.verify()

    def test_17_policy_decision_tampering(self):
        self.paths["policy"].write_text('{"decision":"deny"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "policyDecisionSha256 mismatch"):
            self.verify()

    def test_18_launcher_tampering(self):
        self.paths["launcher"].write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "launcherSha256 mismatch"):
            self.verify()

    def test_19_plain_os_authorization_is_not_production_eligible(self):
        value = CapabilityExecutionAuthority().authorize(
            principal=self.principal,
            plan=self.plan(),
            approval=self.approval(),
            sandbox_profile_sha256=PROFILE_SHA,
            attestation_path=self.paths["sandbox"],
            expected_launcher_sha256=digest(self.paths["launcher"]),
            expected_seccomp_sha256=digest(self.paths["seccomp"]),
            now=NOW,
        )
        self.assertFalse(value.production_eligible)
        self.assertTrue(value.attestation_verified)
        self.assertFalse(value.evidence_chain_verified)

    def test_20_production_authorization_verifies_chain(self):
        value = self.authorization()
        self.assertTrue(value.production_eligible)
        self.assertTrue(value.attestation_verified)
        self.assertTrue(value.evidence_chain_verified)
        self.assertEqual(len(value.evidence_sha256), 64)

    def test_21_execution_ticket_is_issued(self):
        authorization = self.authorization()
        evidence = self.verify()
        ticket = ExecutionTicketIssuer(b"k" * 32).issue(
            authorization=authorization,
            evidence=evidence,
            nonce="ticket-0123456789",
            now=NOW,
        )
        self.assertTrue(ticket["productionEligible"])
        self.assertEqual(ticket["evidenceSha256"], evidence.evidence_sha256)

    def test_22_execution_ticket_signature_tampering(self):
        authorization = self.authorization()
        evidence = self.verify()
        secret = b"k" * 32
        ticket = ExecutionTicketIssuer(secret).issue(
            authorization=authorization,
            evidence=evidence,
            nonce="ticket-0123456789",
            now=NOW,
        )
        ticket["planHash"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "signature mismatch"):
            verify_execution_ticket(
                secret,
                ticket,
                used_nonces=set(),
                expected_actor_id="owner-1",
                expected_session_id="session-1",
                expected_capability_id="com.noesar.test",
                expected_capability_version="1.0.0",
                expected_plan_hash=PLAN_HASH,
                expected_evidence_sha256=evidence.evidence_sha256,
                now=NOW,
            )

    def test_23_execution_ticket_binding_mismatch(self):
        authorization = self.authorization()
        evidence = self.verify()
        secret = b"k" * 32
        ticket = ExecutionTicketIssuer(secret).issue(
            authorization=authorization,
            evidence=evidence,
            nonce="ticket-0123456789",
            now=NOW,
        )
        with self.assertRaisesRegex(ValueError, "sessionId binding"):
            verify_execution_ticket(
                secret,
                ticket,
                used_nonces=set(),
                expected_actor_id="owner-1",
                expected_session_id="other",
                expected_capability_id="com.noesar.test",
                expected_capability_version="1.0.0",
                expected_plan_hash=PLAN_HASH,
                expected_evidence_sha256=evidence.evidence_sha256,
                now=NOW,
            )

    def test_24_execution_ticket_replay(self):
        authorization = self.authorization()
        evidence = self.verify()
        secret = b"k" * 32
        ticket = ExecutionTicketIssuer(secret).issue(
            authorization=authorization,
            evidence=evidence,
            nonce="ticket-0123456789",
            now=NOW,
        )
        used = {}
        verify_execution_ticket(
            secret,
            ticket,
            used_nonces=used,
            expected_actor_id="owner-1",
            expected_session_id="session-1",
            expected_capability_id="com.noesar.test",
            expected_capability_version="1.0.0",
            expected_plan_hash=PLAN_HASH,
            expected_evidence_sha256=evidence.evidence_sha256,
            now=NOW,
        )
        with self.assertRaisesRegex(ValueError, "replay"):
            verify_execution_ticket(
                secret,
                ticket,
                used_nonces=used,
                expected_actor_id="owner-1",
                expected_session_id="session-1",
                expected_capability_id="com.noesar.test",
                expected_capability_version="1.0.0",
                expected_plan_hash=PLAN_HASH,
                expected_evidence_sha256=evidence.evidence_sha256,
                now=NOW,
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
