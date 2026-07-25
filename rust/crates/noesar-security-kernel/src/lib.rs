// SPDX-License-Identifier: AGPL-3.0-or-later
use noesar_contracts::{AuthorizationMode, PathAuthorizationRequest, PolicyDecision};
use std::path::{Component, Path};

pub const NON_BYPASSABLE: &[&str] = &[
    "credential_theft_prevention", "malware_prevention", "illegal_cyberattack_prevention",
    "physical_harm_prevention", "signed_update_verification", "audit_integrity",
    "destructive_action_confirmation",
];

pub fn evaluate_path(request: &PathAuthorizationRequest, workspace: &Path) -> PolicyDecision {
    let requested = Path::new(&request.path);
    let has_parent = requested.components().any(|part| matches!(part, Component::ParentDir));
    let absolute_outside = requested.is_absolute() && !requested.starts_with(workspace);
    let destructive = request.operation == "delete" || request.recursive;
    let prohibited = has_parent || request.secrets_requested;
    let risk = if prohibited { "CRITICAL" } else if absolute_outside || destructive { "HIGH" } else { "LOW" };
    PolicyDecision {
        allowed: !prohibited,
        risk: risk.into(),
        reason: if prohibited { "Protected path or secret access rejected" } else { "Explicit bounded consent required before mutation" }.into(),
        requires_strong_reauthentication: matches!(request.mode, AuthorizationMode::OwnerBypass) || risk == "CRITICAL",
        non_bypassable_invariants: NON_BYPASSABLE.iter().map(|s| (*s).to_string()).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use noesar_contracts::AuthorizationMode;
    use uuid::Uuid;
    #[test]
    fn traversal_is_rejected() {
        let req = PathAuthorizationRequest { request_id:Uuid::new_v4(), actor_id:"owner".into(), mode:AuthorizationMode::Normal, path:"../etc".into(), operation:"write".into(), recursive:false, commands:vec![], dependencies:vec![], network_requested:false, secrets_requested:false };
        assert!(!evaluate_path(&req, Path::new("/workspace")).allowed);
    }
}
