// SPDX-License-Identifier: AGPL-3.0-or-later
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorityMode {
    ReferenceNode,
    RustCanonical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthorityStatus {
    pub mode: AuthorityMode,
    pub canonical: bool,
    pub authenticated_ipc: bool,
    pub build_provenance_verified: bool,
    pub conformance_vectors_passed: bool,
    pub production_ready: bool,
}

impl AuthorityStatus {
    pub fn reference_node() -> Self {
        Self {
            mode: AuthorityMode::ReferenceNode,
            canonical: false,
            authenticated_ipc: false,
            build_provenance_verified: false,
            conformance_vectors_passed: false,
            production_ready: false,
        }
    }

    pub fn rust_candidate(
        authenticated_ipc: bool,
        build_provenance_verified: bool,
        conformance_vectors_passed: bool,
    ) -> Self {
        let production_ready =
            authenticated_ipc
            && build_provenance_verified
            && conformance_vectors_passed;
        Self {
            mode: AuthorityMode::RustCanonical,
            canonical: production_ready,
            authenticated_ipc,
            build_provenance_verified,
            conformance_vectors_passed,
            production_ready,
        }
    }
}

pub fn require_production_authority(status: &AuthorityStatus) -> Result<(), &'static str> {
    if status.mode != AuthorityMode::RustCanonical {
        return Err("production requires the Rust canonical authority");
    }
    if !status.production_ready {
        return Err("Rust authority evidence is incomplete");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_node_is_never_production_ready() {
        assert!(!AuthorityStatus::reference_node().production_ready);
    }

    #[test]
    fn rust_candidate_requires_all_evidence() {
        assert!(!AuthorityStatus::rust_candidate(true, true, false).production_ready);
        assert!(AuthorityStatus::rust_candidate(true, true, true).production_ready);
    }
}
