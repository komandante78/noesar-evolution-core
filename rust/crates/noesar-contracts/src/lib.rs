// SPDX-License-Identifier: AGPL-3.0-or-later
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivacyState { LocalOnlyVerified, ExternalMetadataOnly, ExternalConnectorActive, RemoteModelActive, PolicyViolationBlocked }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthorizationMode { Normal, OwnerBypass }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathAuthorizationRequest {
    pub request_id: Uuid,
    pub actor_id: String,
    pub mode: AuthorizationMode,
    pub path: String,
    pub operation: String,
    pub recursive: bool,
    pub commands: Vec<String>,
    pub dependencies: Vec<String>,
    pub network_requested: bool,
    pub secrets_requested: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub allowed: bool,
    pub risk: String,
    pub reason: String,
    pub requires_strong_reauthentication: bool,
    pub non_bypassable_invariants: Vec<String>,
}
