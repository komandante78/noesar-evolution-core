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
