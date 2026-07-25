#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from noesar_capabilities import CapabilityManager, Principal


def principal_from(args) -> Principal:
    return Principal(
        actor_id=args.actor_id,
        role=args.role,
        session_id=args.session_id,
        authenticated_at=int(time.time()),
        strong_reauth_until=(
            int(time.time()) + 300 if args.strong_reauth else 0
        ),
        organization_id=args.organization_id,
        project_id=args.project_id,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="NOESAR authenticated capability lifecycle controller"
    )
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--actor-id", required=True)
    parser.add_argument("--role", choices=["owner", "admin", "developer", "user"], required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--organization-id", default="local")
    parser.add_argument("--project-id")
    parser.add_argument("--strong-reauth", action="store_true")
    commands = parser.add_subparsers(dest="command", required=True)

    register = commands.add_parser("register-publisher")
    register.add_argument("publisher_id")
    register.add_argument("trust_level")
    register.add_argument("public_key", type=Path)

    revoke = commands.add_parser("revoke-publisher")
    revoke.add_argument("publisher_id")
    revoke.add_argument("--reason", required=True)

    plan = commands.add_parser("plan")
    plan.add_argument("package", type=Path)

    install = commands.add_parser("install")
    install.add_argument("package", type=Path)
    install.add_argument("plan", type=Path)
    install.add_argument("--approval-token")

    approve = commands.add_parser("approve")
    approve.add_argument("plan", type=Path)

    for command in ["activate", "disable", "uninstall", "rollback"]:
        sub = commands.add_parser(command)
        sub.add_argument("capability_id")

    invoke = commands.add_parser("invoke")
    invoke.add_argument("capability_id")
    invoke.add_argument("payload", type=Path)

    commands.add_parser("list")
    commands.add_parser("sandbox-status")

    args = parser.parse_args()
    principal = principal_from(args)
    manager = CapabilityManager(args.workspace)

    if args.command == "register-publisher":
        value = manager.register_publisher(
            principal, args.publisher_id, args.trust_level, args.public_key
        )
    elif args.command == "revoke-publisher":
        value = manager.revoke_publisher(
            principal, args.publisher_id, args.reason
        )
    elif args.command == "plan":
        value = manager.plan(principal, args.package)
    elif args.command == "approve":
        plan_value = json.loads(args.plan.read_text(encoding="utf-8"))
        value = {"approvalToken": manager.approve(principal, plan_value)}
    elif args.command == "install":
        plan_value = json.loads(args.plan.read_text(encoding="utf-8"))
        value = manager.install(
            principal, args.package, plan_value, args.approval_token
        )
    elif args.command == "activate":
        value = manager.activate(principal, args.capability_id)
    elif args.command == "disable":
        value = manager.disable(principal, args.capability_id)
    elif args.command == "uninstall":
        value = manager.uninstall(principal, args.capability_id)
    elif args.command == "rollback":
        value = manager.rollback(principal, args.capability_id)
    elif args.command == "invoke":
        payload = json.loads(args.payload.read_text(encoding="utf-8"))
        value = manager.invoke_builtin(principal, args.capability_id, payload)
    elif args.command == "sandbox-status":
        from noesar_capabilities.sandbox import probe_unshare
        value = probe_unshare().__dict__
    else:
        value = manager.list(principal)

    print(json.dumps(value, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
