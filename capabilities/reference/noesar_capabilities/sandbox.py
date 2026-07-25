# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import hashlib
import json
import os
import resource
import shutil
import signal
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence

from .util import atomic_json_write
from .execution_ticket import verify_execution_ticket
from .sandbox_attestation import verify_production_sandbox_attestation


@dataclass(frozen=True)
class ResourceLimits:
    cpu_seconds: int = 2
    wall_seconds: float = 3.0
    memory_bytes: int = 128 * 1024 * 1024
    file_bytes: int = 8 * 1024 * 1024
    stdout_bytes: int = 128 * 1024
    open_files: int = 64
    processes: int = 8

    def validate(self) -> None:
        if not 1 <= self.cpu_seconds <= 60:
            raise ValueError("cpu_seconds must be between 1 and 60")
        if not 0.1 <= self.wall_seconds <= 300:
            raise ValueError("wall_seconds must be between 0.1 and 300")
        if not 16 * 1024 * 1024 <= self.memory_bytes <= 8 * 1024 * 1024 * 1024:
            raise ValueError("memory_bytes is outside the permitted range")
        if not 1024 <= self.stdout_bytes <= 16 * 1024 * 1024:
            raise ValueError("stdout_bytes is outside the permitted range")


@dataclass(frozen=True)
class SandboxStatus:
    adapter: str
    available: bool
    kernel_enforced_network_deny: bool
    filesystem_isolation: bool
    process_isolation: bool
    evidence: str


@dataclass(frozen=True)
class ExecutionReceipt:
    execution_id: str
    profile: str
    exit_code: int | None
    timed_out: bool
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    duration_ms: int
    workspace_destroyed: bool
    network_enforcement: str
    resource_limits: dict
    command_sha256: str


def probe_unshare() -> SandboxStatus:
    executable = shutil.which("unshare")
    if not executable:
        return SandboxStatus(
            "linux-unshare",
            False,
            False,
            False,
            False,
            "unshare executable is absent",
        )
    result = subprocess.run(
        [
            executable,
            "--user",
            "--map-root-user",
            "--net",
            "sh",
            "-c",
            "printf NOESAR_UNSHARE_PASS",
        ],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    available = (
        result.returncode == 0
        and result.stdout == "NOESAR_UNSHARE_PASS"
    )
    return SandboxStatus(
        "linux-unshare",
        available,
        available,
        available,
        available,
        "probe passed" if available else (
            result.stderr.strip() or f"probe exited {result.returncode}"
        ),
    )


def _limit_process(limits: ResourceLimits) -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (limits.cpu_seconds, limits.cpu_seconds))
    resource.setrlimit(resource.RLIMIT_AS, (limits.memory_bytes, limits.memory_bytes))
    resource.setrlimit(resource.RLIMIT_FSIZE, (limits.file_bytes, limits.file_bytes))
    resource.setrlimit(resource.RLIMIT_NOFILE, (limits.open_files, limits.open_files))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if hasattr(resource, "RLIMIT_NPROC"):
        resource.setrlimit(resource.RLIMIT_NPROC, (limits.processes, limits.processes))
    os.setsid()


def _truncate(value: bytes, limit: int) -> tuple[str, bool]:
    truncated = len(value) > limit
    return value[:limit].decode("utf-8", errors="replace"), truncated


class CapabilityExecutionBroker:
    """
    External arbitrary execution is fail-closed.

    `run_development_fixture` exists only for package-owned regression fixtures.
    It applies process resource limits but is not an OS sandbox.
    """

    def __init__(self, workspace: Path, *, profile_sha256: str | None = None):
        self.workspace = workspace.resolve()
        self.profile_sha256 = profile_sha256
        self.executions = self.workspace / "executions"
        self.receipts = self.workspace / "receipts"
        self.executions.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.receipts.mkdir(parents=True, exist_ok=True, mode=0o700)

    def status(self) -> SandboxStatus:
        return probe_unshare()

    def require_os_isolation(self) -> SandboxStatus:
        status = self.status()
        if not status.available:
            raise PermissionError(
                "OS-level capability isolation is unavailable; arbitrary external execution is denied"
            )
        return status

    def run_external(
        self,
        *,
        argv: Sequence[str],
        trusted_root: Path,
        permissions: Sequence[str],
        attestation_path: Path | None,
        capability_id: str,
        capability_version: str,
        actor_id: str | None = None,
        session_id: str | None = None,
        plan_hash: str | None = None,
        evidence_sha256: str | None = None,
        execution_ticket: dict | None = None,
        ticket_secret: bytes | None = None,
        used_ticket_nonces: dict[str, int] | set[str] | None = None,
        expected_launcher_sha256: str | None = None,
        expected_seccomp_sha256: str | None = None,
        limits: ResourceLimits | None = None,
    ) -> ExecutionReceipt:
        if not self.profile_sha256:
            raise PermissionError("sandbox profile hash is not configured")
        if attestation_path is None:
            raise PermissionError("verified production sandbox attestation is required")
        if (
            execution_ticket is None
            or ticket_secret is None
            or used_ticket_nonces is None
            or not actor_id
            or not session_id
            or not plan_hash
            or not evidence_sha256
        ):
            raise PermissionError(
                "verified V0.5.0 execution ticket and bindings are required"
            )
        verify_production_sandbox_attestation(
            attestation_path,
            expected_profile_sha256=self.profile_sha256,
            expected_capability_id=capability_id,
            expected_capability_version=capability_version,
            expected_launcher_sha256=expected_launcher_sha256,
            expected_seccomp_sha256=expected_seccomp_sha256,
            expected_plan_hash=plan_hash,
        )
        verify_execution_ticket(
            ticket_secret,
            execution_ticket,
            used_nonces=used_ticket_nonces,
            expected_actor_id=actor_id,
            expected_session_id=session_id,
            expected_capability_id=capability_id,
            expected_capability_version=capability_version,
            expected_plan_hash=plan_hash,
            expected_evidence_sha256=evidence_sha256,
        )
        self.require_os_isolation()
        raise PermissionError(
            "production sandbox adapter is not integrated; arbitrary external execution is denied"
        )

    def run_development_fixture(
        self,
        *,
        argv: Sequence[str],
        trusted_root: Path,
        permissions: Sequence[str] = (),
        limits: ResourceLimits | None = None,
    ) -> ExecutionReceipt:
        forbidden = {
            "network.external",
            "secret.read",
            "filesystem.host",
            "shell.execute",
            "physical.actuate",
        }
        requested = set(permissions)
        if requested & forbidden:
            raise PermissionError(
                f"development fixture profile denies: {sorted(requested & forbidden)}"
            )
        return self._run(
            argv=argv,
            trusted_root=trusted_root,
            permissions=permissions,
            limits=limits or ResourceLimits(),
            profile="process-restricted-development-fixture",
            unshare=None,
        )

    def _run(
        self,
        *,
        argv: Sequence[str],
        trusted_root: Path,
        permissions: Sequence[str],
        limits: ResourceLimits,
        profile: str,
        unshare: SandboxStatus | None,
    ) -> ExecutionReceipt:
        limits.validate()
        if isinstance(argv, (str, bytes)) or not argv:
            raise TypeError("argv must be a non-empty sequence; shell strings are forbidden")
        if any(not isinstance(item, str) or "\x00" in item for item in argv):
            raise ValueError("argv contains an invalid item")

        trusted_root = trusted_root.resolve(strict=True)
        executable = Path(argv[0])
        if not executable.is_absolute():
            raise ValueError("executable must be an absolute path")
        if executable.is_symlink():
            raise ValueError("symbolic-link executable is rejected")
        executable = executable.resolve(strict=True)
        if trusted_root != executable and trusted_root not in executable.parents:
            raise PermissionError("executable is outside the trusted root")
        if not executable.is_file():
            raise ValueError("executable is not a regular file")

        execution_id = hashlib.sha256(
            f"{time.time_ns()}:{os.getpid()}:{argv!r}".encode()
        ).hexdigest()[:24]
        workdir = Path(tempfile.mkdtemp(
            prefix=f"{execution_id}-",
            dir=self.executions,
        ))
        os.chmod(workdir, 0o700)
        started = time.monotonic()

        command = list(argv)
        network_enforcement = "policy-denied-not-kernel-enforced"
        if unshare is not None:
            command = [
                shutil.which("unshare") or "unshare",
                "--user",
                "--map-root-user",
                "--mount",
                "--pid",
                "--fork",
                "--net",
                "--ipc",
                "--uts",
                "--",
                *command,
            ]
            network_enforcement = "kernel-network-namespace"

        environment = {
            "PATH": "/usr/bin:/bin",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "HOME": str(workdir),
            "TMPDIR": str(workdir),
            "NOESAR_CAPABILITY_PROFILE": profile,
            "NOESAR_NETWORK_ACCESS": "denied",
        }
        exit_code: int | None = None
        timed_out = False
        raw_stdout = b""
        raw_stderr = b""

        try:
            process = subprocess.Popen(
                command,
                cwd=workdir,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False,
                close_fds=True,
                start_new_session=False,
                preexec_fn=lambda: _limit_process(limits),
            )
            try:
                raw_stdout, raw_stderr = process.communicate(
                    timeout=limits.wall_seconds
                )
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                raw_stdout, raw_stderr = process.communicate()
            exit_code = process.returncode
        finally:
            duration_ms = int((time.monotonic() - started) * 1000)
            stdout, stdout_truncated = _truncate(raw_stdout, limits.stdout_bytes)
            stderr, stderr_truncated = _truncate(raw_stderr, limits.stdout_bytes)
            shutil.rmtree(workdir, ignore_errors=True)
            destroyed = not workdir.exists()

        command_sha256 = hashlib.sha256(
            json.dumps(command, separators=(",", ":")).encode()
        ).hexdigest()
        receipt = ExecutionReceipt(
            execution_id=execution_id,
            profile=profile,
            exit_code=exit_code,
            timed_out=timed_out,
            stdout=stdout,
            stderr=stderr,
            stdout_truncated=stdout_truncated,
            stderr_truncated=stderr_truncated,
            duration_ms=duration_ms,
            workspace_destroyed=destroyed,
            network_enforcement=network_enforcement,
            resource_limits=asdict(limits),
            command_sha256=command_sha256,
        )
        persisted = asdict(receipt)
        persisted["stdout"] = ""
        persisted["stderr"] = ""
        persisted["stdout_sha256"] = hashlib.sha256(raw_stdout).hexdigest()
        persisted["stderr_sha256"] = hashlib.sha256(raw_stderr).hexdigest()
        persisted["stdout_bytes"] = len(raw_stdout)
        persisted["stderr_bytes"] = len(raw_stderr)
        atomic_json_write(
            self.receipts / f"{execution_id}.json",
            persisted,
        )
        return receipt
