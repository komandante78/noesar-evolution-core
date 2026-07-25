# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

from .identity import Principal
from .policy import evaluate_policy


def mcp_tool_to_manifest(server_id: str, tool: dict, publisher: dict) -> dict:
    return {
        "schemaVersion": "4.0",
        "id": f"mcp.{server_id}.{tool['name']}".lower().replace(" ", "-"),
        "version": "0.0.0",
        "kind": "tool",
        "publisher": publisher,
        "license": {"spdx": "LicenseRef-Customer-Private"},
        "entrypoint": {
            "type": "mcp",
            "value": tool["name"],
            "protocolVersion": tool.get("protocolVersion", "unspecified"),
        },
        "permissions": list(tool.get("permissions", [])),
        "payload": [{
            "path": "virtual/mcp-tool",
            "sha256": "0" * 64,
            "bytes": 0,
        }],
        "rollback": {"supported": False},
    }


def a2a_agent_to_manifest(agent: dict, publisher: dict) -> dict:
    return {
        "schemaVersion": "4.0",
        "id": f"a2a.{agent['agentId']}".lower().replace(" ", "-"),
        "version": "0.0.0",
        "kind": "agent",
        "publisher": publisher,
        "license": {"spdx": "LicenseRef-Customer-Private"},
        "entrypoint": {
            "type": "a2a",
            "value": agent["endpoint"],
            "protocolVersion": agent.get("protocolVersion", "unspecified"),
        },
        "permissions": list(agent.get("requestedPermissions", [])),
        "payload": [{
            "path": "virtual/a2a-agent",
            "sha256": "0" * 64,
            "bytes": 0,
        }],
        "rollback": {"supported": False},
    }


def evaluate_protocol_declaration(
    manifest: dict,
    principal: Principal,
) -> dict:
    decision = evaluate_policy(
        manifest,
        principal,
        external_execution_enabled=False,
    )
    return {
        "decision": decision.decision,
        "reasons": list(decision.reasons),
        "sandboxProfile": decision.sandbox_profile,
        "trusted": False,
    }
