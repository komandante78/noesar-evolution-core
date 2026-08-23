// SPDX-License-Identifier: AGPL-3.0-or-later
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DataPlaneMode {
    ReferenceJson,
    PostgreSql,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataPlaneStatus {
    pub mode: DataPlaneMode,
    pub connected: bool,
    pub migrations_verified: bool,
    pub row_level_security_verified: bool,
    pub pgvector_verified: bool,
    pub production_ready: bool,
}

impl DataPlaneStatus {
    pub fn reference_json() -> Self {
        Self {
            mode: DataPlaneMode::ReferenceJson,
            connected: false,
            migrations_verified: false,
            row_level_security_verified: false,
            pgvector_verified: false,
            production_ready: false,
        }
    }

    pub fn postgresql_candidate(
        connected: bool,
        migrations_verified: bool,
        row_level_security_verified: bool,
        pgvector_verified: bool,
    ) -> Self {
        let production_ready =
            connected
            && migrations_verified
            && row_level_security_verified
            && pgvector_verified;
        Self {
            mode: DataPlaneMode::PostgreSql,
            connected,
            migrations_verified,
            row_level_security_verified,
            pgvector_verified,
            production_ready,
        }
    }
}

pub fn require_production_data_plane(status: &DataPlaneStatus) -> Result<(), &'static str> {
    if status.mode != DataPlaneMode::PostgreSql {
        return Err("production requires PostgreSQL");
    }
    if !status.production_ready {
        return Err("PostgreSQL acceptance evidence is incomplete");
    }
    Ok(())
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepositoryContext {
    pub actor_id: String,
    pub workspace_id: String,
    pub project_id: Option<String>,
}

impl RepositoryContext {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.actor_id.is_empty() || self.workspace_id.is_empty() {
            return Err("actor and workspace are required");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepositoryHealth {
    pub connected: bool,
    pub server_version: Option<String>,
    pub pgvector_version: Option<String>,
    pub postgres_18_or_newer: bool,
    pub migrations_verified: bool,
    pub row_level_security_verified: bool,
    pub immutable_ledgers_verified: bool,
    pub application_role_no_bypassrls: bool,
    pub audit_hash_chain_guard_verified: bool,
    pub production_attestation_ledger_verified: bool,
    pub production_gate_verified: bool,
    pub repository_adapter_active: bool,
    pub backup_restore_verified: bool,
}

impl RepositoryHealth {
    pub fn production_ready(&self) -> bool {
        self.connected
            && self.server_version.is_some()
            && self.pgvector_version.is_some()
            && self.postgres_18_or_newer
            && self.migrations_verified
            && self.row_level_security_verified
            && self.immutable_ledgers_verified
            && self.application_role_no_bypassrls
            && self.audit_hash_chain_guard_verified
            && self.production_attestation_ledger_verified
            && self.production_gate_verified
            && self.repository_adapter_active
            && self.backup_restore_verified
    }
}

// D-0661 (F-RUST-001). This crate's two production-readiness gates are both large AND
// expressions over booleans (4 terms, 13 terms). That shape is exactly where a dropped or
// inverted condition goes unnoticed: every existing caller only ever sees "not ready" for the
// right reason during development, and "ready" once everything happens to be true. Mutation
// coverage — flip exactly one condition, confirm the gate still refuses — is the only way to
// prove each term actually participates in the AND rather than being dead weight.
#[cfg(test)]
mod tests {
    use super::*;

    fn all_true_health() -> RepositoryHealth {
        RepositoryHealth {
            connected: true,
            server_version: Some("18.0".into()),
            pgvector_version: Some("0.8.0".into()),
            postgres_18_or_newer: true,
            migrations_verified: true,
            row_level_security_verified: true,
            immutable_ledgers_verified: true,
            application_role_no_bypassrls: true,
            audit_hash_chain_guard_verified: true,
            production_attestation_ledger_verified: true,
            production_gate_verified: true,
            repository_adapter_active: true,
            backup_restore_verified: true,
        }
    }

    #[test]
    fn reference_json_status_is_never_production_ready() {
        let status = DataPlaneStatus::reference_json();
        assert_eq!(status.mode, DataPlaneMode::ReferenceJson);
        assert!(!status.connected);
        assert!(!status.production_ready);
    }

    #[test]
    fn postgresql_candidate_is_production_ready_only_when_all_four_conditions_hold() {
        let ready = DataPlaneStatus::postgresql_candidate(true, true, true, true);
        assert!(ready.production_ready);

        assert!(!DataPlaneStatus::postgresql_candidate(false, true, true, true).production_ready, "connected");
        assert!(!DataPlaneStatus::postgresql_candidate(true, false, true, true).production_ready, "migrations_verified");
        assert!(!DataPlaneStatus::postgresql_candidate(true, true, false, true).production_ready, "row_level_security_verified");
        assert!(!DataPlaneStatus::postgresql_candidate(true, true, true, false).production_ready, "pgvector_verified");
    }

    #[test]
    fn require_production_data_plane_refuses_reference_json_regardless_of_flags() {
        let mut status = DataPlaneStatus::postgresql_candidate(true, true, true, true);
        status.mode = DataPlaneMode::ReferenceJson; // production_ready still true, mode is not
        assert_eq!(require_production_data_plane(&status), Err("production requires PostgreSQL"));
    }

    #[test]
    fn require_production_data_plane_refuses_postgresql_with_incomplete_evidence() {
        let status = DataPlaneStatus::postgresql_candidate(true, true, true, false);
        assert_eq!(require_production_data_plane(&status), Err("PostgreSQL acceptance evidence is incomplete"));
    }

    #[test]
    fn require_production_data_plane_accepts_postgresql_with_complete_evidence() {
        let status = DataPlaneStatus::postgresql_candidate(true, true, true, true);
        assert_eq!(require_production_data_plane(&status), Ok(()));
    }

    #[test]
    fn repository_context_requires_a_nonempty_actor_and_workspace() {
        let base = RepositoryContext { actor_id: "u1".into(), workspace_id: "w1".into(), project_id: None };
        assert_eq!(base.validate(), Ok(()));
        assert!(RepositoryContext { actor_id: "".into(), ..base.clone() }.validate().is_err());
        assert!(RepositoryContext { workspace_id: "".into(), ..base.clone() }.validate().is_err());
    }

    #[test]
    fn repository_context_project_id_is_optional() {
        let with_project = RepositoryContext {
            actor_id: "u1".into(), workspace_id: "w1".into(), project_id: Some("p1".into()),
        };
        assert_eq!(with_project.validate(), Ok(()));
    }

    #[test]
    fn repository_health_is_production_ready_when_every_condition_holds() {
        assert!(all_true_health().production_ready());
    }

    #[test]
    fn repository_health_refuses_when_any_single_condition_is_false() {
        // Mutation coverage: every one of the 13 conditions must, alone, flip the gate.
        let cases: Vec<(&str, RepositoryHealth)> = vec![
            ("connected", RepositoryHealth { connected: false, ..all_true_health() }),
            ("server_version", RepositoryHealth { server_version: None, ..all_true_health() }),
            ("pgvector_version", RepositoryHealth { pgvector_version: None, ..all_true_health() }),
            ("postgres_18_or_newer", RepositoryHealth { postgres_18_or_newer: false, ..all_true_health() }),
            ("migrations_verified", RepositoryHealth { migrations_verified: false, ..all_true_health() }),
            ("row_level_security_verified", RepositoryHealth { row_level_security_verified: false, ..all_true_health() }),
            ("immutable_ledgers_verified", RepositoryHealth { immutable_ledgers_verified: false, ..all_true_health() }),
            ("application_role_no_bypassrls", RepositoryHealth { application_role_no_bypassrls: false, ..all_true_health() }),
            ("audit_hash_chain_guard_verified", RepositoryHealth { audit_hash_chain_guard_verified: false, ..all_true_health() }),
            ("production_attestation_ledger_verified", RepositoryHealth { production_attestation_ledger_verified: false, ..all_true_health() }),
            ("production_gate_verified", RepositoryHealth { production_gate_verified: false, ..all_true_health() }),
            ("repository_adapter_active", RepositoryHealth { repository_adapter_active: false, ..all_true_health() }),
            ("backup_restore_verified", RepositoryHealth { backup_restore_verified: false, ..all_true_health() }),
        ];
        assert_eq!(cases.len(), 13, "production_ready() ANDs 13 conditions -- a missing case here would silently stop covering one");
        for (field, health) in cases {
            assert!(!health.production_ready(), "flipping only `{field}` must make production_ready() false");
        }
    }
}
