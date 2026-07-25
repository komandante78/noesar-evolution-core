// SPDX-License-Identifier: AGPL-3.0-or-later
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord { pub id: Uuid, pub timestamp: DateTime<Utc>, pub actor: String, pub action: String, pub result: String, pub previous_hash: String, pub hash: String }

pub fn build_record(actor: String, action: String, result: String, previous_hash: String) -> AuditRecord {
    let id = Uuid::new_v4(); let timestamp = Utc::now();
    let material = format!("{id}|{timestamp}|{actor}|{action}|{result}|{previous_hash}");
    let hash = hex::encode(Sha256::digest(material.as_bytes()));
    AuditRecord { id, timestamp, actor, action, result, previous_hash, hash }
}
