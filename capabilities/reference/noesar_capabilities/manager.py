# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import json
import os
import secrets
import shutil
import time
from pathlib import Path
from zipfile import ZipFile

from .approval import issue_token, verify_token
from .audit import AuditLedger
from .builtins import BUILTINS
from .crypto import verify_ed25519
from .identity import Principal, require_action
from .policy import evaluate_policy
from .revocation import RevocationStore
from .util import (
    atomic_json_write,
    canonical_json,
    safe_extract,
    sha256_bytes,
    sha256_file,
    validate_archive_members,
    validate_manifest,
)


class CapabilityManager:
    def __init__(self, workspace: Path):
        self.workspace = workspace.resolve()
        self.state = self.workspace / "state"
        self.quarantine = self.workspace / "quarantine"
        self.active = self.workspace / "active"
        self.backups = self.workspace / "backups"
        self.keys = self.workspace / "trusted-keys"
        self.registry_path = self.state / "registry.json"
        self.publishers_path = self.state / "publishers.json"
        self.revocations_path = self.state / "revocations.json"
        self.approvals_path = self.state / "used-approvals.json"
        self.secret_path = self.state / "approval-secret.bin"
        for directory in [
            self.state, self.quarantine, self.active, self.backups, self.keys
        ]:
            directory.mkdir(parents=True, exist_ok=True)
            try:
                os.chmod(directory, 0o700)
            except OSError:
                pass
        if not self.secret_path.exists():
            self.secret_path.write_bytes(secrets.token_bytes(32))
            os.chmod(self.secret_path, 0o600)
        if not self.registry_path.exists():
            atomic_json_write(self.registry_path, {"capabilities": {}})
        if not self.publishers_path.exists():
            atomic_json_write(self.publishers_path, {"publishers": {}})
        if not self.approvals_path.exists():
            atomic_json_write(self.approvals_path, {"usedNonces": {}})
        self.audit = AuditLedger(self.workspace / "audit" / "events.jsonl")
        self.revocations = RevocationStore(self.revocations_path)

    def _load_registry(self) -> dict:
        return json.loads(self.registry_path.read_text(encoding="utf-8"))

    def _save_registry(self, value: dict) -> None:
        atomic_json_write(self.registry_path, value)

    def _load_publishers(self) -> dict:
        return json.loads(self.publishers_path.read_text(encoding="utf-8"))

    def _load_approvals(self) -> dict:
        return json.loads(self.approvals_path.read_text(encoding="utf-8"))

    def _consume_approval(self, payload: dict) -> None:
        value = self._load_approvals()
        nonce = payload["nonce"]
        if nonce in value["usedNonces"]:
            raise ValueError("approval token replay detected")
        value["usedNonces"][nonce] = {
            "usedAt": int(time.time()),
            "actorId": payload["actorId"],
            "capabilityId": payload["capabilityId"],
            "version": payload["version"],
        }
        atomic_json_write(self.approvals_path, value)

    def register_publisher(
        self,
        principal: Principal,
        publisher_id: str,
        trust_level: str,
        public_key: Path,
    ) -> dict:
        require_action(principal, "publisher.register", strong_reauth=True)
        if trust_level not in {
            "noesar-official", "certified-partner",
            "customer-private", "community"
        }:
            raise ValueError("invalid trust level")
        target = self.keys / f"{publisher_id}.pem"
        shutil.copy2(public_key, target)
        os.chmod(target, 0o600)
        fingerprint = sha256_file(target)
        publishers = self._load_publishers()
        record = {
            "trustLevel": trust_level,
            "publicKey": target.name,
            "fingerprintSha256": fingerprint,
            "status": "active",
            "registeredAt": int(time.time()),
            "registeredBy": principal.actor_id,
        }
        publishers["publishers"][publisher_id] = record
        atomic_json_write(self.publishers_path, publishers)
        self.audit.append("publisher.registered", {
            **principal.as_audit(),
            "publisherId": publisher_id,
            "trustLevel": trust_level,
            "fingerprintSha256": fingerprint,
        })
        return record

    def revoke_publisher(
        self,
        principal: Principal,
        publisher_id: str,
        reason: str,
    ) -> dict:
        require_action(principal, "publisher.revoke", strong_reauth=True)
        publishers = self._load_publishers()
        if publisher_id not in publishers["publishers"]:
            raise ValueError("publisher is not registered")
        publishers["publishers"][publisher_id]["status"] = "revoked"
        publishers["publishers"][publisher_id]["revokedAt"] = int(time.time())
        atomic_json_write(self.publishers_path, publishers)
        record = self.revocations.revoke_publisher(
            publisher_id,
            reason=reason,
            actor_id=principal.actor_id,
        )
        self.audit.append("publisher.revoked", {
            **principal.as_audit(),
            "publisherId": publisher_id,
            "reason": reason,
        })
        return record

    def revoke_package(
        self,
        principal: Principal,
        package_sha256: str,
        reason: str,
    ) -> dict:
        require_action(principal, "package.revoke", strong_reauth=True)
        record = self.revocations.revoke_package(
            package_sha256,
            reason=reason,
            actor_id=principal.actor_id,
        )
        self.audit.append("package.revoked", {
            **principal.as_audit(),
            "packageSha256": package_sha256,
            "reason": reason,
        })
        return record

    def inspect(self, principal: Principal, package: Path) -> dict:
        require_action(principal, "capability.inspect")
        with ZipFile(package, "r") as archive:
            validate_archive_members(archive)
            names = set(archive.namelist())
            if "manifest.json" not in names or "manifest.sig" not in names:
                raise ValueError("package requires manifest.json and manifest.sig")
            manifest_bytes = archive.read("manifest.json")
            manifest = json.loads(manifest_bytes)
            validate_manifest(manifest)
            payload_entries = {
                item["path"]: item for item in manifest.get("payload", [])
            }
            for payload_path, descriptor in payload_entries.items():
                if payload_path not in names:
                    raise ValueError(f"missing payload: {payload_path}")
                content = archive.read(payload_path)
                if len(content) != descriptor["bytes"]:
                    raise ValueError(f"payload size mismatch: {payload_path}")
                if sha256_bytes(content) != descriptor["sha256"]:
                    raise ValueError(f"payload SHA-256 mismatch: {payload_path}")
            undeclared = sorted(
                name for name in names
                if not name.endswith("/")
                and name not in {"manifest.json", "manifest.sig"}
                and name not in payload_entries
            )
            if undeclared:
                raise ValueError(f"undeclared package files: {undeclared}")
            return {
                "manifest": manifest,
                "manifestBytes": manifest_bytes,
                "signature": archive.read("manifest.sig"),
                "packageSha256": sha256_file(package),
            }

    def verify(self, principal: Principal, package: Path) -> dict:
        require_action(principal, "capability.verify")
        inspected = self.inspect(principal, package)
        manifest = inspected["manifest"]
        publisher_id = manifest["publisher"]["id"]
        publishers = self._load_publishers()["publishers"]
        publisher = publishers.get(publisher_id)
        if not publisher:
            raise ValueError("publisher is not trusted")
        if publisher.get("status") != "active":
            raise ValueError("publisher is not active")
        if publisher["trustLevel"] != manifest["publisher"]["trustLevel"]:
            raise ValueError("publisher trust level mismatch")
        key_path = self.keys / publisher["publicKey"]
        if sha256_file(key_path) != publisher["fingerprintSha256"]:
            raise ValueError("trusted publisher key fingerprint mismatch")
        if not verify_ed25519(
            key_path,
            inspected["manifestBytes"],
            inspected["signature"],
        ):
            raise ValueError("manifest signature is invalid")
        self.revocations.assert_allowed(
            publisher_id=publisher_id,
            package_sha256=inspected["packageSha256"],
            capability_id=manifest["id"],
            version=manifest["version"],
        )
        self.audit.append("package.verified", {
            **principal.as_audit(),
            "capabilityId": manifest["id"],
            "version": manifest["version"],
            "packageSha256": inspected["packageSha256"],
        })
        return inspected

    def plan(
        self,
        principal: Principal,
        package: Path,
        *,
        external_execution_enabled: bool = False,
    ) -> dict:
        require_action(principal, "capability.plan")
        inspected = self.verify(principal, package)
        manifest = inspected["manifest"]
        decision = evaluate_policy(
            manifest,
            principal,
            external_execution_enabled=external_execution_enabled,
        )
        plan_without_hash = {
            "capabilityId": manifest["id"],
            "version": manifest["version"],
            "kind": manifest["kind"],
            "trustLevel": manifest["publisher"]["trustLevel"],
            "publisherId": manifest["publisher"]["id"],
            "permissions": sorted(manifest.get("permissions", [])),
            "network": manifest.get("network", []),
            "filesystem": manifest.get("filesystem", []),
            "entrypoint": manifest["entrypoint"],
            "industry": manifest.get("industry"),
            "decision": decision.decision,
            "reasons": list(decision.reasons),
            "sandboxProfile": decision.sandbox_profile,
            "strongReauthRequired": decision.strong_reauth_required,
            "packageSha256": inspected["packageSha256"],
            "backupRequired": True,
            "rollbackSupported": manifest.get("rollback", {}).get("supported", False),
            "actorId": principal.actor_id,
            "role": principal.role,
            "sessionId": principal.session_id,
            "organizationId": principal.organization_id,
            "projectId": principal.project_id,
        }
        plan = dict(plan_without_hash)
        plan["planHash"] = sha256_bytes(canonical_json(plan_without_hash))
        self.audit.append("plan.created", {
            **principal.as_audit(),
            "capabilityId": manifest["id"],
            "version": manifest["version"],
            "decision": decision.decision,
            "planHash": plan["planHash"],
        })
        return plan

    def approve(
        self,
        principal: Principal,
        plan: dict,
        *,
        ttl_seconds: int = 300,
    ) -> str:
        require_action(principal, "capability.install")
        if plan["decision"] == "deny":
            raise ValueError("denied plans cannot be approved")
        if plan["actorId"] != principal.actor_id:
            raise PermissionError("only the plan actor may approve this reference plan")
        if plan.get("strongReauthRequired") and not principal.strong_reauthenticated:
            raise PermissionError("plan approval requires strong reauthentication")
        token = issue_token(
            self.secret_path.read_bytes(),
            principal=principal,
            capability_id=plan["capabilityId"],
            version=plan["version"],
            plan_hash=plan["planHash"],
            ttl_seconds=ttl_seconds,
        )
        self.audit.append("plan.approved", {
            **principal.as_audit(),
            "capabilityId": plan["capabilityId"],
            "version": plan["version"],
            "planHash": plan["planHash"],
        })
        return token

    def install(
        self,
        principal: Principal,
        package: Path,
        plan: dict,
        approval_token: str | None,
    ) -> dict:
        require_action(principal, "capability.install")
        inspected = self.verify(principal, package)
        manifest = inspected["manifest"]
        if manifest["id"] != plan["capabilityId"] or manifest["version"] != plan["version"]:
            raise ValueError("package does not match the plan")
        if inspected["packageSha256"] != plan["packageSha256"]:
            raise ValueError("package hash does not match the plan")
        if plan["actorId"] != principal.actor_id or plan["sessionId"] != principal.session_id:
            raise PermissionError("plan identity does not match current principal")
        if plan["decision"] == "deny":
            raise ValueError("policy denied this package")
        if plan["decision"] == "approval-required":
            if not approval_token:
                raise ValueError("approval token is required")
            payload = verify_token(
                self.secret_path.read_bytes(),
                approval_token,
                principal=principal,
                capability_id=manifest["id"],
                version=manifest["version"],
                plan_hash=plan["planHash"],
            )
            self._consume_approval(payload)

        destination = self.quarantine / manifest["id"] / manifest["version"]
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True)
        with ZipFile(package, "r") as archive:
            safe_extract(archive, destination)

        registry = self._load_registry()
        registry["capabilities"].setdefault(manifest["id"], {})
        registry["capabilities"][manifest["id"]].update({
            "version": manifest["version"],
            "state": "quarantined",
            "planHash": plan["planHash"],
            "packageSha256": inspected["packageSha256"],
            "publisherId": manifest["publisher"]["id"],
            "trustLevel": manifest["publisher"]["trustLevel"],
            "installedAt": int(time.time()),
            "installedBy": principal.actor_id,
            "organizationId": principal.organization_id,
            "projectId": principal.project_id,
        })
        self._save_registry(registry)
        self.audit.append("capability.quarantined", {
            **principal.as_audit(),
            "capabilityId": manifest["id"],
            "version": manifest["version"],
        })
        return registry["capabilities"][manifest["id"]]

    def activate(self, principal: Principal, capability_id: str) -> dict:
        require_action(principal, "capability.activate")
        registry = self._load_registry()
        entry = registry["capabilities"].get(capability_id)
        if not entry or entry["state"] != "quarantined":
            raise ValueError("capability is not quarantined")
        version = entry["version"]
        source = self.quarantine / capability_id / version
        manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
        industry = manifest.get("industry")
        if industry and industry.get("riskClass") in {"high", "safety-critical"}:
            require_action(
                principal,
                "capability.activate",
                strong_reauth=True,
            )
            if principal.role != "owner":
                raise PermissionError("high-risk industry activation requires Owner")
        self.revocations.assert_allowed(
            publisher_id=entry["publisherId"],
            package_sha256=entry["packageSha256"],
            capability_id=capability_id,
            version=version,
        )

        destination = self.active / capability_id
        if destination.exists():
            backup = self.backups / capability_id / str(int(time.time_ns()))
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(destination), str(backup))
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(destination))
        entry["state"] = "active"
        entry["activatedAt"] = int(time.time())
        entry["activatedBy"] = principal.actor_id
        self._save_registry(registry)
        self.audit.append("capability.activated", {
            **principal.as_audit(),
            "capabilityId": capability_id,
            "version": version,
        })
        return entry

    def disable(self, principal: Principal, capability_id: str) -> dict:
        require_action(principal, "capability.disable")
        registry = self._load_registry()
        entry = registry["capabilities"].get(capability_id)
        if not entry or entry["state"] != "active":
            raise ValueError("capability is not active")
        entry["state"] = "disabled"
        entry["disabledAt"] = int(time.time())
        entry["disabledBy"] = principal.actor_id
        self._save_registry(registry)
        self.audit.append("capability.disabled", {
            **principal.as_audit(),
            "capabilityId": capability_id,
        })
        return entry

    def uninstall(self, principal: Principal, capability_id: str) -> dict:
        require_action(principal, "capability.uninstall")
        registry = self._load_registry()
        entry = registry["capabilities"].get(capability_id)
        if not entry:
            raise ValueError("capability is not registered")
        current = self.active / capability_id
        backup_path = None
        if current.exists():
            backup = self.backups / capability_id / str(int(time.time_ns()))
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(current), str(backup))
            backup_path = str(backup)
        entry["state"] = "uninstalled"
        entry["uninstalledAt"] = int(time.time())
        entry["uninstalledBy"] = principal.actor_id
        entry["latestBackup"] = backup_path
        self._save_registry(registry)
        self.audit.append("capability.uninstalled", {
            **principal.as_audit(),
            "capabilityId": capability_id,
            "backup": backup_path,
        })
        return entry

    def rollback(self, principal: Principal, capability_id: str) -> dict:
        require_action(principal, "capability.rollback")
        registry = self._load_registry()
        entry = registry["capabilities"].get(capability_id)
        if not entry:
            raise ValueError("capability is not registered")
        backup_root = self.backups / capability_id
        backups = sorted(
            [path for path in backup_root.iterdir() if path.is_dir()],
            key=lambda path: path.name,
            reverse=True,
        ) if backup_root.exists() else []
        if not backups:
            raise ValueError("no rollback backup is available")
        destination = self.active / capability_id
        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(str(backups[0]), str(destination))
        entry["state"] = "active"
        entry["rolledBackAt"] = int(time.time())
        entry["rolledBackBy"] = principal.actor_id
        self._save_registry(registry)
        self.audit.append("capability.rolled-back", {
            **principal.as_audit(),
            "capabilityId": capability_id,
        })
        return entry

    def invoke_builtin(
        self,
        principal: Principal,
        capability_id: str,
        payload: dict,
    ) -> dict:
        require_action(principal, "capability.invoke")
        registry = self._load_registry()
        entry = registry["capabilities"].get(capability_id)
        if not entry or entry["state"] != "active":
            raise ValueError("capability is not active")
        if entry["organizationId"] != principal.organization_id:
            raise PermissionError("capability organization scope mismatch")
        if entry.get("projectId") and entry["projectId"] != principal.project_id:
            raise PermissionError("capability project scope mismatch")
        self.revocations.assert_allowed(
            publisher_id=entry["publisherId"],
            package_sha256=entry["packageSha256"],
            capability_id=capability_id,
            version=entry["version"],
        )
        manifest = json.loads(
            (self.active / capability_id / "manifest.json").read_text(encoding="utf-8")
        )
        entrypoint = manifest["entrypoint"]
        if entrypoint["type"] != "builtin":
            raise ValueError("reference implementation invokes only built-ins")
        function = BUILTINS.get(entrypoint["value"])
        if not function:
            raise ValueError("unknown built-in capability")
        result = function(payload)
        self.audit.append("capability.invoked", {
            **principal.as_audit(),
            "capabilityId": capability_id,
            "entrypoint": entrypoint["value"],
        })
        return result

    def list(self, principal: Principal) -> dict:
        require_action(principal, "capability.invoke")
        return self._load_registry()
